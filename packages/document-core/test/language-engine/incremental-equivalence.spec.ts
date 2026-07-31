import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type DocumentRevision,
  type ParseConfiguration
} from '@marktext/document-core'
import type { MarkdownNode } from '@marktext/document-core'

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: {
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

function markdownNodeRecord(node: MarkdownNode): unknown {
  return {
    kind: node.kind,
    range: { start: node.range.start, end: node.range.end },
    attributes: node.attributes,
    children: Array.from(
      { length: node.childCount },
      (_, ordinal) => markdownNodeRecord(node.childAt(ordinal))
    )
  }
}

function revisionRecord(revision: DocumentRevision): unknown {
  if (revision.kind !== 'complete') {
    throw new Error('Equivalence rows require complete revisions')
  }
  const projection = (view: 'original' | 'revised' | 'editing') => {
    const projected = revision.projection(view)
    return {
      source: projected.source,
      markdown: markdownNodeRecord(projected.markdown.root)
    }
  }
  const runs: unknown[] = []
  for (let ordinal = 0; ordinal < revision.markup.runCount; ordinal += 1) {
    const run = revision.markup.runAt(ordinal)
    runs.push({
      text: run.text,
      sourceRange: {
        start: run.sourceRange.start,
        end: run.sourceRange.end
      },
      marks: run.marks.length
    })
  }
  return {
    source: revision.source.text,
    diagnostics: revision.diagnostics.count,
    criticRoots: revision.criticMarkup.rootCount,
    runs,
    original: projection('original'),
    revised: projection('revised'),
    editing: projection('editing')
  }
}

/** Prose paragraphs with varied lengths, blank-line separated. */
function prose(paragraphs: number, seedText: string): string {
  return `${Array.from({ length: paragraphs }, (_, index) =>
    `Paragraph ${index} ${seedText} spans words until it simply ends here.`
  ).join('\n\n')}\n`
}

/**
 * The incremental splice must be unobservable: a reopen that took the
 * spliced route publishes exactly the revision a fresh full parse of the
 * same bytes publishes. Every row compares the deep public record of both.
 */
describe('incremental reopen equivalence', () => {
  const editShapes: readonly Readonly<{
    name: string
    edit: (source: string) => Readonly<{
      start: number
      end: number
      insert: string
    }>
  }>[] = [
    {
      name: 'append one character before the final newline',
      edit: (source) => ({
        start: source.length - 1,
        end: source.length - 1,
        insert: 'x'
      })
    },
    {
      name: 'type inside the final paragraph',
      edit: (source) => ({
        start: source.length - 12,
        end: source.length - 12,
        insert: 'inserted words '
      })
    },
    {
      name: 'delete a word from the final paragraph',
      edit: (source) => ({
        start: source.length - 12,
        end: source.length - 6,
        insert: ''
      })
    },
    {
      name: 'replace the final paragraph tail',
      edit: (source) => ({
        start: source.length - 24,
        end: source.length - 1,
        insert: 'a fresh ending line'
      })
    },
    {
      name: 'append a new paragraph at the end',
      edit: (source) => ({
        start: source.length,
        end: source.length,
        insert: '\nA whole appended paragraph of plain prose.\n'
      })
    },
    {
      name: 'type inside the first paragraph',
      edit: (source) => {
        const offset = source.indexOf(' spans')
        return { start: offset, end: offset, insert: ' newly typed' }
      }
    },
    {
      name: 'delete a word from a middle paragraph',
      edit: (source) => {
        const middle = source.indexOf(
          'Paragraph 1 ',
          Math.floor(source.length / 3)
        )
        const anchor = middle >= 0 ? middle : Math.floor(source.length / 2)
        const wordStart = source.indexOf(' spans', anchor)
        return { start: wordStart, end: wordStart + 6, insert: '' }
      }
    },
    {
      name: 'replace a middle paragraph body',
      edit: (source) => {
        const sep = source.includes('\r\n') ? '\r\n\r\n' : '\n\n'
        const paragraphs = source.split(sep)
        const middleIndex = Math.floor(paragraphs.length / 2)
        const before = paragraphs.slice(0, middleIndex).join(sep)
        const start = middleIndex === 0 ? 0 : before.length + sep.length
        const end = start + (paragraphs[middleIndex]?.length ?? 0)
        return { start, end, insert: 'A wholly rewritten middle paragraph.' }
      }
    }
  ]

  for (const shape of editShapes) {
    it(`matches a full parse: ${shape.name}`, () => {
      for (const paragraphs of [3, 20, 60]) {
        const source = prose(paragraphs, `case ${shape.name}`)
        const edit = shape.edit(source)
        const edited =
          source.slice(0, edit.start) + edit.insert + source.slice(edit.end)

        const incremental = createLanguageEngine()
        const opened = incremental.open(
          createSourceSnapshot(source),
          TEST_CONFIGURATION
        )
        expect(opened.kind).toBe('complete')
        const before = incremental.traversalCounts().intrinsicSourceUnits
        const reopened = incremental.reopen(
          opened,
          createSourceSnapshot(edited),
          [{ start: edit.start, end: edit.end, insert: edit.insert }]
        )
        const spent =
          incremental.traversalCounts().intrinsicSourceUnits - before

        const full = createLanguageEngine().open(
          createSourceSnapshot(edited),
          TEST_CONFIGURATION
        )

        expect(
          revisionRecord(reopened),
          `${shape.name} @ ${String(paragraphs)} paragraphs`
        ).toEqual(revisionRecord(full))
        // The route itself is part of the claim: these shapes must take the
        // spliced path, not silently fall back to the full pass.
        expect(
          spent,
          `${shape.name} @ ${String(paragraphs)} paragraphs took the full pass`
        ).toBeLessThan(edited.length)
      }
    })
  }

  it('matches a full parse on CRLF documents through the spliced route', () => {
    for (const shapeName of [
      'append one character before the final newline',
      'replace a middle paragraph body'
    ]) {
      const shape = editShapes.find((entry) => entry.name === shapeName)
      if (shape === undefined) throw new Error(`missing shape ${shapeName}`)
      const source = prose(20, 'crlf case').replaceAll('\n', '\r\n')
      const edit = shape.edit(source)
      const edited =
        source.slice(0, edit.start) + edit.insert + source.slice(edit.end)

      const incremental = createLanguageEngine()
      const opened = incremental.open(
        createSourceSnapshot(source),
        TEST_CONFIGURATION
      )
      expect(opened.kind).toBe('complete')
      const reopened = incremental.reopen(
        opened,
        createSourceSnapshot(edited),
        [{ start: edit.start, end: edit.end, insert: edit.insert }]
      )
      const full = createLanguageEngine().open(
        createSourceSnapshot(edited),
        TEST_CONFIGURATION
      )
      expect(revisionRecord(reopened), shapeName)
        .toEqual(revisionRecord(full))
      expect(
        incremental.traversalCounts().intrinsicSourceUnits,
        `${shapeName} on CRLF took the full pass`
      ).toBeLessThan(source.length + edited.length)
    }
  })

  it('matches a full parse when retained regions carry literals', () => {
    const bodies = [
      'Uses `inline code` mid paragraph.',
      '```\nfenced code body\nstays verbatim\n```',
      '<div>\nan HTML block\n</div>',
      '~~~\ntilde fence body\n~~~'
    ]
    for (const body of bodies) {
      const source = [
        'Opening paragraph of plain prose stands first.',
        body,
        'Middle paragraph of plain prose sits between constructs.',
        'Closing paragraph of plain prose stands last for the edit.'
      ].join('\n\n') + '\n'
      const edit = {
        start: source.length - 10,
        end: source.length - 10,
        insert: 'freshly '
      }
      const edited =
        source.slice(0, edit.start) + edit.insert + source.slice(edit.end)

      const incremental = createLanguageEngine()
      const opened = incremental.open(
        createSourceSnapshot(source),
        TEST_CONFIGURATION
      )
      expect(opened.kind).toBe('complete')
      const before = incremental.traversalCounts().intrinsicSourceUnits
      const reopened = incremental.reopen(
        opened,
        createSourceSnapshot(edited),
        [{ start: edit.start, end: edit.end, insert: edit.insert }]
      )
      const spent =
        incremental.traversalCounts().intrinsicSourceUnits - before
      const full = createLanguageEngine().open(
        createSourceSnapshot(edited),
        TEST_CONFIGURATION
      )
      expect(revisionRecord(reopened), body.slice(0, 24))
        .toEqual(revisionRecord(full))
      expect(spent, `${body.slice(0, 24)} took the full pass`)
        .toBeLessThan(edited.length)
    }
  })

  it('matches a full parse when the window itself carries a code span', () => {
    const source = prose(12, 'window-literal case')
    const insert = '\nA tail paragraph with `new code` inside.\n'
    const engine = createLanguageEngine()
    const opened = engine.open(
      createSourceSnapshot(source),
      TEST_CONFIGURATION
    )
    expect(opened.kind).toBe('complete')
    const before = engine.traversalCounts().intrinsicSourceUnits
    const edited = source + insert
    const reopened = engine.reopen(
      opened,
      createSourceSnapshot(edited),
      [{ start: source.length, end: source.length, insert }]
    )
    const spent = engine.traversalCounts().intrinsicSourceUnits - before
    const full = createLanguageEngine().open(
      createSourceSnapshot(edited),
      TEST_CONFIGURATION
    )
    expect(revisionRecord(reopened)).toEqual(revisionRecord(full))
    expect(spent, 'window code span took the full pass')
      .toBeLessThan(edited.length)
  })

  it('a marker far from the edit takes the spliced route', () => {
    // The marker-bearing widening, landed: retained CriticMarkup nodes
    // replay their identity emissions into the outer registry and the fork
    // branches shift; the deep-equivalence row below proves the spliced
    // revision identical to a full parse.
    const source = [
      'Opening paragraph with an {++insertion++} marker.',
      'Middle paragraph of plain prose.',
      'Closing paragraph receives the edit here.'
    ].join('\n\n') + '\n'
    const engine = createLanguageEngine()
    const opened = engine.open(
      createSourceSnapshot(source),
      TEST_CONFIGURATION
    )
    expect(opened.kind).toBe('complete')
    const before = engine.traversalCounts().intrinsicSourceUnits
    const edit = {
      start: source.length - 6,
      end: source.length - 6,
      insert: 'now '
    }
    const edited =
      source.slice(0, edit.start) + edit.insert + source.slice(edit.end)
    engine.reopen(
      opened,
      createSourceSnapshot(edited),
      [{ start: edit.start, end: edit.end, insert: edit.insert }]
    )
    const spent = engine.traversalCounts().intrinsicSourceUnits - before
    expect(spent).toBeLessThan(edited.length)
  })

  it('matches a full parse when a marker sits far from the edit', () => {
    const source = [
      'Opening paragraph with an {++insertion++} marker.',
      'Middle paragraph of plain prose.',
      'Closing paragraph receives the edit here.'
    ].join('\n\n') + '\n'
    const engine = createLanguageEngine()
    const opened = engine.open(
      createSourceSnapshot(source),
      TEST_CONFIGURATION
    )
    expect(opened.kind).toBe('complete')
    const edit = {
      start: source.length - 6,
      end: source.length - 6,
      insert: 'now '
    }
    const edited =
      source.slice(0, edit.start) + edit.insert + source.slice(edit.end)
    const reopened = engine.reopen(
      opened,
      createSourceSnapshot(edited),
      [{ start: edit.start, end: edit.end, insert: edit.insert }]
    )
    const full = createLanguageEngine().open(
      createSourceSnapshot(edited),
      TEST_CONFIGURATION
    )
    expect(revisionRecord(reopened)).toEqual(revisionRecord(full))
  })

  it('falls back to the full pass when the window carries syntax', () => {
    const source = prose(20, 'fallback')
    const engine = createLanguageEngine()
    const opened = engine.open(
      createSourceSnapshot(source),
      TEST_CONFIGURATION
    )
    expect(opened.kind).toBe('complete')
    const insert = '\nA paragraph with a {++marker++} inside.\n'
    const edited = source + insert
    const reopened = engine.reopen(
      opened,
      createSourceSnapshot(edited),
      [{ start: source.length, end: source.length, insert }]
    )
    const full = createLanguageEngine().open(
      createSourceSnapshot(edited),
      TEST_CONFIGURATION
    )
    expect(revisionRecord(reopened)).toEqual(revisionRecord(full))
    expect(reopened.kind === 'complete' && reopened.criticMarkup.rootCount)
      .toBe(1)
  })
})
