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
  // Comment display ASTs resolve references under comment scope, so they
  // observe the reference machinery no root view can.
  const commentDisplays: unknown[] = []
  for (
    let ordinal = 0;
    ordinal < revision.criticMarkup.rootCount;
    ordinal += 1
  ) {
    const root = revision.criticMarkup.rootAt(ordinal)
    if (root.kind !== 'comment') continue
    const display = revision.commentDisplay(root.nodeId)
    commentDisplays.push({
      source: display.source,
      markdown: markdownNodeRecord(display.markdown.root)
    })
  }
  return {
    source: revision.source.text,
    diagnostics: revision.diagnostics.count,
    criticRoots: revision.criticMarkup.rootCount,
    runs,
    commentDisplays,
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

  it('matches a full parse across marker shapes and regions', () => {
    const markerBodies = [
      'Nested {++outer {==inner==} tail++} forms sit here.',
      'Anchored {==span==}{>>note<<} comment pair rests.',
      'A {~~worse~>better~~} swap and {--gone--} deletion.'
    ]
    for (const markerBody of markerBodies) {
      for (const editWhere of ['tail', 'head'] as const) {
        const paragraphs = [
          'Opening paragraph of plain prose for the head edit target.',
          markerBody,
          'Middle paragraph of plain prose stands between regions.',
          markerBody.replaceAll('inner', 'inner2')
            .replaceAll('note', 'note2')
            .replaceAll('gone', 'gone2'),
          'Closing paragraph of plain prose for the tail edit target.'
        ]
        const source = paragraphs.join('\n\n') + '\n'
        const offset = editWhere === 'tail'
          ? source.length - 9
          : source.indexOf(' prose for the head') 
        const edit = { start: offset, end: offset, insert: ' edited' }
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
        const label = `${markerBody.slice(0, 18)} / ${editWhere}`
        expect(revisionRecord(reopened), label)
          .toEqual(revisionRecord(full))
        expect(spent, `${label} took the full pass`)
          .toBeLessThan(edited.length)
      }
    }
  })

  it('matches a full parse for multi-edit reopens through one bracket', () => {
    const source = prose(30, 'multi-edit case')
    const cases: readonly Readonly<{
      name: string
      edits: readonly Readonly<{
        start: number
        end: number
        insert: string
      }>[]
    }>[] = [
      {
        name: 'two edits in the final paragraph',
        edits: [
          {
            start: source.length - 30,
            end: source.length - 30,
            insert: 'first '
          },
          {
            start: source.length - 10,
            end: source.length - 10,
            insert: 'second '
          }
        ]
      },
      {
        name: 'edits in adjacent tail paragraphs',
        edits: [
          {
            start: source.lastIndexOf('Paragraph 28') + 12,
            end: source.lastIndexOf('Paragraph 28') + 12,
            insert: ' edited'
          },
          {
            start: source.length - 10,
            end: source.length - 10,
            insert: 'twice '
          }
        ]
      }
    ]
    for (const row of cases) {
      const ordered = [...row.edits].sort((a, b) => a.start - b.start)
      let edited = source
      for (const edit of [...ordered].reverse()) {
        edited =
          edited.slice(0, edit.start) + edit.insert + edited.slice(edit.end)
      }
      const engine = createLanguageEngine()
      const opened = engine.open(
        createSourceSnapshot(source),
        TEST_CONFIGURATION
      )
      expect(opened.kind).toBe('complete')
      const before = engine.traversalCounts().intrinsicSourceUnits
      const reopened = engine.reopen(
        opened,
        createSourceSnapshot(edited),
        ordered.map((edit) => ({
          start: edit.start,
          end: edit.end,
          insert: edit.insert
        }))
      )
      const spent = engine.traversalCounts().intrinsicSourceUnits - before
      const full = createLanguageEngine().open(
        createSourceSnapshot(edited),
        TEST_CONFIGURATION
      )
      expect(revisionRecord(reopened), row.name)
        .toEqual(revisionRecord(full))
      expect(spent, `${row.name} took the full pass`)
        .toBeLessThan(edited.length)
    }
  })

  it('matches a full parse on CR-only documents through the fallback', () => {
    const source = prose(12, 'cr case').replaceAll('\n', '\r')
    const engine = createLanguageEngine()
    const opened = engine.open(
      createSourceSnapshot(source),
      TEST_CONFIGURATION
    )
    expect(opened.kind).toBe('complete')
    const offset = source.length - 2
    const edited = source.slice(0, offset) + 'x' + source.slice(offset)
    const reopened = engine.reopen(
      opened,
      createSourceSnapshot(edited),
      [{ start: offset, end: offset, insert: 'x' }]
    )
    const full = createLanguageEngine().open(
      createSourceSnapshot(edited),
      TEST_CONFIGURATION
    )
    // CR-only endings are not yet routed through the splice; correctness
    // holds through the fallback, and a routing widening would assert the
    // spent bound here.
    expect(revisionRecord(reopened)).toEqual(revisionRecord(full))
  })

  it('takes the spliced route when reference definitions sit clear of the edit', () => {
    // Definitions re-key link resolution document-wide, so the splice must
    // hand emission a lookup rebuilt over the shifted literals. Both
    // placements matter: definitions after the bracket shift, definitions
    // before it hold their offsets, and links on both sides re-resolve.
    const layouts: readonly Readonly<{
      name: string
      source: string
    }>[] = [
      {
        name: 'definitions after the edit',
        source: [
          'Opening prose refers to [alpha] and to [beta] early on.',
          prose(12, 'defs-after').trimEnd(),
          'Closing prose refers to [alpha] once more.',
          '[alpha]: /alpha-destination "Alpha"',
          '[beta]: /beta-destination'
        ].join('\n\n') + '\n'
      },
      {
        name: 'definitions before the edit',
        source: [
          '[alpha]: /alpha-destination "Alpha"',
          '[beta]: /beta-destination',
          'Opening prose refers to [alpha] and to [beta] early on.',
          prose(12, 'defs-before').trimEnd(),
          'Closing prose refers to [alpha] once more.'
        ].join('\n\n') + '\n'
      },
      {
        name: 'duplicate labels straddle the edit',
        source: [
          '[alpha]: /first-wins',
          'Opening prose refers to [alpha] under the first definition.',
          prose(12, 'defs-dup').trimEnd(),
          'Closing prose refers to [alpha] as well.',
          '[alpha]: /second-loses'
        ].join('\n\n') + '\n'
      }
    ]
    for (const layout of layouts) {
      const source = layout.source
      const anchor = 'simply ends here.'
      const offset = source.indexOf(anchor)
      expect(offset, layout.name).toBeGreaterThan(0)
      const edited =
        source.slice(0, offset) + 'now ' + source.slice(offset)

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
        [{ start: offset, end: offset, insert: 'now ' }]
      )
      const spent =
        incremental.traversalCounts().intrinsicSourceUnits - before
      const full = createLanguageEngine().open(
        createSourceSnapshot(edited),
        TEST_CONFIGURATION
      )
      expect(revisionRecord(reopened), layout.name)
        .toEqual(revisionRecord(full))
      expect(spent, `${layout.name} took the full pass`)
        .toBeLessThan(edited.length)
    }
  })

  it('takes the spliced route for marker-bearing documents with definitions', () => {
    // Review documents carry both markers and reference definitions. The
    // splice must reproduce reference scope: a comment's body resolves only
    // against definitions in the same comment, never the document's.
    const layouts: readonly Readonly<{
      name: string
      source: string
    }>[] = [
      {
        name: 'markers and document-scope definitions',
        source: [
          'Opening prose refers to [alpha] with {++an addition++} nearby.',
          prose(10, 'marker-defs').trimEnd(),
          'A {==highlight==}{>>plain note<<} pair sits here.',
          'Closing prose refers to [alpha] again.',
          '[alpha]: /alpha-destination "Alpha"'
        ].join('\n\n') + '\n'
      },
      {
        name: 'reference inside a comment stays unresolved at comment scope',
        source: [
          'Opening prose refers to [alpha] at document scope.',
          prose(10, 'comment-ref').trimEnd(),
          'A {==span==}{>>see [alpha] for detail<<} pair sits here.',
          '[alpha]: /alpha-destination'
        ].join('\n\n') + '\n'
      },
      {
        name: 'definition inside a comment scopes to that comment',
        // The definition opens the comment body, so the virtual content
        // start admits it; [beta] resolves inside this comment and nowhere
        // else.
        source: [
          'Opening prose refers to [beta] at document scope.',
          prose(10, 'comment-def').trimEnd(),
          'A {==span==}{>>[beta]: /comment-scoped\nsee [beta] here<<} pair.',
          'Closing prose refers to [beta] once more.',
          '[gamma]: /document-scoped'
        ].join('\n\n') + '\n'
      }
    ]
    for (const layout of layouts) {
      const source = layout.source
      const anchor = 'simply ends here.'
      const offset = source.indexOf(anchor)
      expect(offset, layout.name).toBeGreaterThan(0)
      const edited =
        source.slice(0, offset) + 'now ' + source.slice(offset)

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
        [{ start: offset, end: offset, insert: 'now ' }]
      )
      const spent =
        incremental.traversalCounts().intrinsicSourceUnits - before
      const full = createLanguageEngine().open(
        createSourceSnapshot(edited),
        TEST_CONFIGURATION
      )
      expect(revisionRecord(reopened), layout.name)
        .toEqual(revisionRecord(full))
      expect(spent, `${layout.name} took the full pass`)
        .toBeLessThan(edited.length)
    }
  })

  it('falls back to the full pass when the edit reaches a definition', () => {
    // A bracket overlapping a definition may rewrite it; only the full pass
    // decides what the block now means.
    const source = [
      'Opening prose refers to [alpha] early on.',
      prose(6, 'defs-touched').trimEnd(),
      '[alpha]: /alpha-destination'
    ].join('\n\n') + '\n'
    const offset = source.indexOf('/alpha-destination') +
      '/alpha-destination'.length
    const edited = source.slice(0, offset) + '-x' + source.slice(offset)
    const engine = createLanguageEngine()
    const opened = engine.open(
      createSourceSnapshot(source),
      TEST_CONFIGURATION
    )
    expect(opened.kind).toBe('complete')
    const before = engine.traversalCounts().intrinsicSourceUnits
    const reopened = engine.reopen(
      opened,
      createSourceSnapshot(edited),
      [{ start: offset, end: offset, insert: '-x' }]
    )
    const spent = engine.traversalCounts().intrinsicSourceUnits - before
    const full = createLanguageEngine().open(
      createSourceSnapshot(edited),
      TEST_CONFIGURATION
    )
    expect(revisionRecord(reopened)).toEqual(revisionRecord(full))
    expect(spent).toBeGreaterThanOrEqual(edited.length)
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
