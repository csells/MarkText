import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'
import { rootsOf, runsOf } from '../helpers/collections.js'

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

describe('LanguageEngine.open atomic Markdown and CriticMarkup graph', () => {
  it('owns every canonical code unit exactly once across Markdown and CM', () => {
    const sourceText = '\uFEFFa\r\n`{++literal++}`{++b++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const runs = Array.from(
      { length: revision.ownership.count },
      (_, ordinal) => revision.ownership.at(ordinal)
    )
    expect(runs).toEqual([
      {
        range: { start: 0, end: 1 },
        owner: { kind: 'trivia', role: 'virtual-bom' }
      },
      {
        range: { start: 1, end: 2 },
        owner: { kind: 'markdown-text' }
      },
      {
        range: { start: 2, end: 4 },
        owner: { kind: 'trivia', role: 'line-ending', spelling: 'crlf' }
      },
      {
        range: { start: 4, end: 19 },
        owner: {
          kind: 'markdown-literal',
          provider: 'inline-code',
          ownerRange: { start: 4, end: 19 }
        }
      },
      {
        range: { start: 19, end: 22 },
        owner: {
          kind: 'critic-marker',
          form: 'addition',
          role: 'open',
          nodeRange: { start: 19, end: 26 }
        }
      },
      {
        range: { start: 22, end: 23 },
        owner: { kind: 'markdown-text' }
      },
      {
        range: { start: 23, end: 26 },
        owner: {
          kind: 'critic-marker',
          form: 'addition',
          role: 'close',
          nodeRange: { start: 19, end: 26 }
        }
      }
    ])
    expect(runs.map((run) => sourceText.slice(run.range.start, run.range.end)).join(''))
      .toBe(sourceText)
    for (const run of runs) {
      for (let offset: number = run.range.start; offset < run.range.end; offset += 1) {
        expect(revision.ownership.ownerAt(offset)).toBe(run)
      }
    }
  })

  it('retains the Markdown owner that authenticated a CM arm literal', () => {
    const sourceText = '{++---\n{--literal--}\n---++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([
      { kind: 'addition', arms: [{ children: [] }] }
    ])
    expect(revision.ownership.ownerAt(7)).toEqual({
      range: { start: 7, end: 20 },
      owner: {
        kind: 'markdown-literal',
        provider: 'front-matter',
        ownerRange: { start: 3, end: 24 }
      }
    })
  })

  it('carries one retained fenced-code owner into the Revised Markdown CST', () => {
    const sourceText = '{++~~~\n{--literal--}\n~~~++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([
      {
        kind: 'addition',
        range: { start: 0, end: 27 },
        arms: [{ children: [] }]
      }
    ])
    expect(revision.ownership.ownerAt(7)).toEqual({
      range: { start: 7, end: 20 },
      owner: {
        kind: 'markdown-literal',
        provider: 'fenced-code',
        ownerRange: { start: 3, end: 24 }
      }
    })

    const revised = revision.projection('revised')
    expect(revised.source).toBe('~~~\n{--literal--}\n~~~')
    expect(revised.provenance.originAt(0)).toEqual({
      kind: 'canonical',
      sourceOffset: 3
    })
    expect(revised.provenance.originAt(20)).toEqual({
      kind: 'canonical',
      sourceOffset: 23
    })
    expect(revised.markdown.root.childCount).toBe(1)
    expect(revised.markdown.root.childAt(0)).toMatchObject({
      kind: 'code-block',
      range: { start: 0, end: 21 }
    })
    expect(
      revised.markdown
        .nodeAt(10, 'next')
        .slice(0, 2)
        .map((node) => node.kind)
    ).toEqual(['document', 'code-block'])
  })

  it('carries Markdown inline structure across zero-width CM markers', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('before *a{++b++}c* after'),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const summarizeChildren = (view: 'original' | 'revised'): unknown => {
      const root = revision.projection(view).markdown.root
      const paragraph = root.childAt(0)
      return Array.from({ length: paragraph.childCount }, (_, ordinal) => {
        const child = paragraph.childAt(ordinal)
        return {
          kind: child.kind,
          range: child.range,
          children: Array.from(
            { length: child.childCount },
            (_, childOrdinal) => ({
              kind: child.childAt(childOrdinal).kind,
              range: child.childAt(childOrdinal).range
            })
          )
        }
      })
    }

    expect(revision.projection('original').source).toBe('before *ac* after')
    expect(summarizeChildren('original')).toEqual([
      { kind: 'text', range: { start: 0, end: 7 }, children: [] },
      {
        kind: 'emphasis',
        range: { start: 7, end: 11 },
        children: [{ kind: 'text', range: { start: 8, end: 10 } }]
      },
      { kind: 'text', range: { start: 11, end: 17 }, children: [] }
    ])

    expect(revision.projection('revised').source).toBe('before *abc* after')
    expect(summarizeChildren('revised')).toEqual([
      { kind: 'text', range: { start: 0, end: 7 }, children: [] },
      {
        kind: 'emphasis',
        range: { start: 7, end: 12 },
        children: [{ kind: 'text', range: { start: 8, end: 11 } }]
      },
      { kind: 'text', range: { start: 12, end: 18 }, children: [] }
    ])
  })

  it('retains distinct mapped Markdown trees for Substitution alternatives', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{~~*old*~>**new**~~}'),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const summarize = (node: {
      readonly kind: string
      readonly range: { readonly start: number; readonly end: number }
      readonly childCount: number
      readonly childAt: (ordinal: number) => unknown
    }): unknown => ({
      kind: node.kind,
      range: node.range,
      children: Array.from(
        { length: node.childCount },
        (_, ordinal) => summarize(node.childAt(ordinal) as Parameters<typeof summarize>[0])
      )
    })

    const original = revision.projection('original')
    expect(original.markdown.source).toBe('*old*')
    expect(summarize(original.markdown.root)).toEqual({
      kind: 'document',
      range: { start: 0, end: 5 },
      children: [{
        kind: 'paragraph',
        range: { start: 0, end: 5 },
        children: [{
          kind: 'emphasis',
          range: { start: 0, end: 5 },
          children: [{
            kind: 'text',
            range: { start: 1, end: 4 },
            children: []
          }]
        }]
      }]
    })

    const revised = revision.projection('revised')
    expect(revised.markdown.source).toBe('**new**')
    expect(summarize(revised.markdown.root)).toEqual({
      kind: 'document',
      range: { start: 0, end: 7 },
      children: [{
        kind: 'paragraph',
        range: { start: 0, end: 7 },
        children: [{
          kind: 'strong',
          range: { start: 0, end: 7 },
          children: [{
            kind: 'text',
            range: { start: 2, end: 5 },
            children: []
          }]
        }]
      }]
    })
  })

  it('retains projection-specific block structure across a Substitution', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{~~# old~>- new~~}'),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const summarize = (node: {
      readonly kind: string
      readonly range: { readonly start: number; readonly end: number }
      readonly childCount: number
      readonly childAt: (ordinal: number) => unknown
    }): unknown => ({
      kind: node.kind,
      range: node.range,
      children: Array.from(
        { length: node.childCount },
        (_, ordinal) => summarize(node.childAt(ordinal) as Parameters<typeof summarize>[0])
      )
    })

    expect(summarize(revision.projection('original').markdown.root)).toEqual({
      kind: 'document',
      range: { start: 0, end: 5 },
      children: [{
        kind: 'heading',
        range: { start: 0, end: 5 },
        children: [{ kind: 'text', range: { start: 2, end: 5 }, children: [] }]
      }]
    })
    expect(summarize(revision.projection('revised').markdown.root)).toEqual({
      kind: 'document',
      range: { start: 0, end: 5 },
      children: [{
        kind: 'list',
        range: { start: 0, end: 5 },
        children: [{
          kind: 'list-item',
          range: { start: 0, end: 5 },
          children: [{
            kind: 'paragraph',
            range: { start: 2, end: 5 },
            children: [{ kind: 'text', range: { start: 2, end: 5 }, children: [] }]
          }]
        }]
      }]
    })
  })

  it('emits a projected blockquote CST when a CM carrier supplies the whole quote', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{++> quoted++}'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.projection('original').markdown.root.childCount).toBe(0)
    const revised = revision.projection('revised').markdown
    expect(revised.source).toBe('> quoted')
    expect(revised.root.childAt(0)).toMatchObject({
      kind: 'blockquote',
      range: { start: 0, end: 8 }
    })
    expect(revised.root.childAt(0).childAt(0)).toMatchObject({
      kind: 'paragraph',
      range: { start: 2, end: 8 }
    })
    expect(revised.root.childAt(0).childAt(0).childAt(0)).toMatchObject({
      kind: 'text',
      range: { start: 2, end: 8 }
    })
    expect(revised.nodeAt(4, 'next').map((node) => node.kind)).toEqual([
      'document',
      'blockquote',
      'paragraph',
      'text'
    ])
  })

  it('keeps multiline projected quote content in one blockquote paragraph', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{++> first\n> second++}'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const root = revision.projection('revised').markdown.root
    expect(root.childCount).toBe(1)
    const quote = root.childAt(0)
    expect(quote).toMatchObject({
      kind: 'blockquote',
      range: { start: 0, end: 16 },
      childCount: 1
    })
    const paragraph = quote.childAt(0)
    expect(paragraph).toMatchObject({
      kind: 'paragraph',
      range: { start: 2, end: 16 },
      childCount: 3
    })
    expect(
      Array.from({ length: paragraph.childCount }, (_, ordinal) => {
        const child = paragraph.childAt(ordinal)
        return { kind: child.kind, range: child.range }
      })
    ).toEqual([
      { kind: 'text', range: { start: 2, end: 7 } },
      { kind: 'soft-break', range: { start: 7, end: 8 } },
      { kind: 'text', range: { start: 10, end: 16 } }
    ])
  })

  it('emits one ordered-list CST from a projected CM carrier', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{++3. first\n4. second++}'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const root = revision.projection('revised').markdown.root
    expect(root.childCount).toBe(1)
    const list = root.childAt(0)
    expect(list).toMatchObject({
      kind: 'list',
      range: { start: 0, end: 18 },
      attributes: { ordered: true, start: 3 },
      childCount: 2
    })
    expect(list.childAt(0)).toMatchObject({
      kind: 'list-item',
      range: { start: 0, end: 8 }
    })
    expect(list.childAt(0).childAt(0)).toMatchObject({
      kind: 'paragraph',
      range: { start: 3, end: 8 }
    })
    expect(list.childAt(1)).toMatchObject({
      kind: 'list-item',
      range: { start: 9, end: 18 }
    })
    expect(list.childAt(1).childAt(0)).toMatchObject({
      kind: 'paragraph',
      range: { start: 12, end: 18 }
    })
  })

  it('retains interleaved list and blockquote container order through a CM carrier', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{++- outer\n  > quote\n  > - inner++}'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const summarizeKinds = (node: {
      readonly kind: string
      readonly childCount: number
      readonly childAt: (ordinal: number) => unknown
    }): unknown => ({
      kind: node.kind,
      children: Array.from(
        { length: node.childCount },
        (_, ordinal) => summarizeKinds(node.childAt(ordinal) as typeof node)
      )
    })

    expect(summarizeKinds(revision.projection('revised').markdown.root)).toEqual({
      kind: 'document',
      children: [{
        kind: 'list',
        children: [{
          kind: 'list-item',
          children: [
            {
              kind: 'paragraph',
              children: [{ kind: 'text', children: [] }]
            },
            {
              kind: 'blockquote',
              children: [
                {
                  kind: 'paragraph',
                  children: [{ kind: 'text', children: [] }]
                },
                {
                  kind: 'list',
                  children: [{
                    kind: 'list-item',
                    children: [{
                      kind: 'paragraph',
                      children: [{ kind: 'text', children: [] }]
                    }]
                  }]
                }
              ]
            }
          ]
        }]
      }]
    })
  })

  it('preserves heterogeneous container order independently in both Substitution arms', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{~~> - old~>- > new~~}'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const original = revision.projection('original').markdown
    expect(
      original.nodeAt(original.source.indexOf('old'), 'next')
        .map((node) => node.kind)
    ).toEqual([
      'document',
      'blockquote',
      'list',
      'list-item',
      'paragraph',
      'text'
    ])

    const revised = revision.projection('revised').markdown
    expect(
      revised.nodeAt(revised.source.indexOf('new'), 'next')
        .map((node) => node.kind)
    ).toEqual([
      'document',
      'list',
      'list-item',
      'blockquote',
      'paragraph',
      'text'
    ])
  })

  it('retains a list whose first item begins with a nested list', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('- - foo'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(
      revision.projection('revised').markdown.nodeAt(4, 'next')
        .map((node) => node.kind)
    ).toEqual([
      'document',
      'list',
      'list-item',
      'list',
      'list-item',
      'paragraph',
      'text'
    ])
  })

  it('retains multiple Markdown blocks inside one CM carrier', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{++# h\n\np++}'),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const revised = revision.projection('revised')
    expect(revised.source).toBe('# h\n\np')
    expect(revised.markdown.root.childCount).toBe(2)
    expect(revised.markdown.root.childAt(0)).toMatchObject({
      kind: 'heading',
      range: { start: 0, end: 3 },
      childCount: 1
    })
    expect(revised.markdown.root.childAt(0).childAt(0)).toMatchObject({
      kind: 'text',
      range: { start: 2, end: 3 }
    })
    expect(revised.markdown.root.childAt(1)).toMatchObject({
      kind: 'paragraph',
      range: { start: 5, end: 6 },
      childCount: 1
    })
    expect(revised.markdown.root.childAt(1).childAt(0)).toMatchObject({
      kind: 'text',
      range: { start: 5, end: 6 }
    })
    expect(revision.projection('original').markdown.root.childCount).toBe(0)
  })

  it('inherits the list-container checkpoint into both Substitution arms', () => {
    const oldArm = '~~~\n  {++oldlit++}\n  ~~~'
    const newArm = '~~~\n  {--newlit--}\n  ~~~'
    const sourceText = `- {~~${oldArm}~>${newArm}~~}\n`
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([
      {
        kind: 'substitution',
        arms: [
          { name: 'old', children: [] },
          { name: 'new', children: [] }
        ]
      }
    ])
    expect(revision.projection('original').source).toBe(`- ${oldArm}\n`)
    expect(revision.projection('revised').source).toBe(`- ${newArm}\n`)
    expect(
      revision.projection('original').markdown
        .nodeAt(revision.projection('original').source.indexOf('{++'), 'next')
        .map((node) => node.kind)
    ).toEqual(['document', 'list', 'list-item', 'code-block'])
    expect(
      revision.projection('revised').markdown
        .nodeAt(revision.projection('revised').source.indexOf('{--'), 'next')
        .map((node) => node.kind)
    ).toEqual(['document', 'list', 'list-item', 'code-block'])
  })

  it('preserves an inherited list-continuation fence without projection protection', () => {
    const sourceText =
      '-   item\n' +
      '    {++~~~\n' +
      '    {--literal--}\n' +
      '    ~~~++}\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toEqual([
      {
        kind: 'addition',
        range: { start: 13, end: 48 },
        markers: {
          open: { start: 13, end: 16 },
          close: { start: 45, end: 48 }
        },
        arms: [{
          name: 'content',
          range: { start: 16, end: 45 },
          children: []
        }]
      }
    ])
    expect(revision.ownership.ownerAt(24)).toEqual({
      range: { start: 20, end: 37 },
      owner: {
        kind: 'markdown-literal',
        provider: 'fenced-code',
        ownerRange: { start: 16, end: 45 }
      }
    })

    const revised = revision.projection('revised')
    expect(revised.source).toBe(
      '-   item\n' +
      '    ~~~\n' +
      '    {--literal--}\n' +
      '    ~~~\n'
    )
    expect(revised.provenance.originAt(21)).toEqual({
      kind: 'canonical',
      sourceOffset: 24
    })
    expect(revised.provenance.originAt(33)).toEqual({
      kind: 'canonical',
      sourceOffset: 36
    })
  })

  it('parses one mapped fenced block across adjacent CM carrier joins', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{++~~~\n++}{++body\n++}{++~~~\n++}'),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const revised = revision.projection('revised')
    expect(revised.source).toBe('~~~\nbody\n~~~\n')
    expect(revised.markdown.root.childCount).toBe(1)
    expect(revised.markdown.root.childAt(0)).toMatchObject({
      kind: 'code-block',
      range: { start: 0, end: 13 }
    })
    expect(
      revised.markdown.nodeAt(6, 'next').map((node) => node.kind)
    ).toEqual(['document', 'code-block'])
  })

  it('parses mapped inline-code meaning from the projected lane', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{==`x`==}'),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    for (const view of ['original', 'revised'] as const) {
      const projection = revision.projection(view)
      expect(projection.source).toBe('`x`')
      expect(projection.markdown.root.childAt(0).childAt(0)).toMatchObject({
        kind: 'inline-code',
        range: { start: 0, end: 3 }
      })
      expect(
        projection.markdown.nodeAt(1, 'next').map((node) => node.kind)
      ).toEqual(['document', 'paragraph', 'inline-code'])
    }
  })

  it('constructs mapped inline code across separate CM carriers', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{++`++}code{++`++}'),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([
      { kind: 'addition', arms: [{ children: [] }] },
      { kind: 'addition', arms: [{ children: [] }] }
    ])
    expect(revision.projection('original').source).toBe('code')
    const revised = revision.projection('revised')
    expect(revised.source).toBe('`code`')
    expect(revised.markdown.root.childAt(0).childAt(0)).toMatchObject({
      kind: 'inline-code',
      range: { start: 0, end: 6 }
    })
  })

  it('uses the parser-owned destination decision to emit a projected link CST', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{++[label](url)++}'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const paragraph = revision.projection('revised').markdown.root.childAt(0)
    expect(paragraph).toMatchObject({ kind: 'paragraph', childCount: 1 })
    const link = paragraph.childAt(0)
    expect(link).toMatchObject({
      kind: 'link',
      range: { start: 0, end: 12 },
      attributes: {
        destinationStart: 8,
        destinationEnd: 11
      },
      childCount: 1
    })
    expect(link.childAt(0)).toMatchObject({
      kind: 'text',
      range: { start: 1, end: 6 }
    })
  })

  it('isolates Comment literal state from the root continuation lane', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{>>`draft<<}`suffix {++literal++}`'),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([
      { kind: 'comment', arms: [{ children: [] }] }
    ])
    expect(revision.diagnostics.count).toBe(0)
    const expectedSource = '`suffix {++literal++}`'
    expect(revision.projection('original').source).toBe(expectedSource)
    const revised = revision.projection('revised')
    expect(revised.source).toBe(expectedSource)
    for (const offset of [12, 20, 33]) {
      expect(revision.ownership.ownerAt(offset)).toEqual({
        range: { start: 12, end: 34 },
        owner: {
          kind: 'markdown-literal',
          provider: 'inline-code',
          ownerRange: { start: 12, end: 34 }
        }
      })
    }
    expect(revised.markdown.root.childAt(0).childAt(0)).toMatchObject({
      kind: 'inline-code',
      range: { start: 0, end: 22 }
    })
  })

  it('parses one complete multiline link independently in each Substitution arm', () => {
    const sourceText =
      '{~~[x\n](old/{++oldlit++})~>[x\n](new/{--newlit--})~~}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toEqual([
      {
        kind: 'substitution',
        range: { start: 0, end: 52 },
        markers: {
          open: { start: 0, end: 3 },
          separator: { start: 25, end: 27 },
          close: { start: 49, end: 52 }
        },
        arms: [
          {
            name: 'old',
            range: { start: 3, end: 25 },
            children: []
          },
          {
            name: 'new',
            range: { start: 27, end: 49 },
            children: []
          }
        ]
      }
    ])

    expect(revision.ownership.ownerAt(12)).toEqual({
      range: { start: 7, end: 25 },
      owner: {
        kind: 'markdown-literal',
        provider: 'link-destination',
        ownerRange: { start: 7, end: 25 }
      }
    })
    expect(revision.ownership.ownerAt(36)).toEqual({
      range: { start: 31, end: 49 },
      owner: {
        kind: 'markdown-literal',
        provider: 'link-destination',
        ownerRange: { start: 31, end: 49 }
      }
    })

    const original = revision.projection('original')
    expect(original.source).toBe('[x\n](old/{++oldlit++})')
    expect(original.provenance.originAt(9)).toEqual({
      kind: 'canonical',
      sourceOffset: 12
    })
    expect(original.provenance.originAt(20)).toEqual({
      kind: 'canonical',
      sourceOffset: 23
    })

    const revised = revision.projection('revised')
    expect(revised.source).toBe('[x\n](new/{--newlit--})')
    expect(revised.provenance.originAt(9)).toEqual({
      kind: 'canonical',
      sourceOffset: 36
    })
    expect(revised.provenance.originAt(20)).toEqual({
      kind: 'canonical',
      sourceOffset: 47
    })
  })

  it('isolates Comment math state from the root continuation lane', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{>>$draft<<}$suffix {++literal++}$'),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([
      { kind: 'comment', arms: [{ children: [] }] }
    ])
    expect(revision.diagnostics.count).toBe(0)
    const expectedSource = '$suffix {++literal++}$'
    expect(revision.projection('original').source).toBe(expectedSource)
    expect(revision.projection('revised').source).toBe(expectedSource)
    for (const offset of [12, 20, 33]) {
      expect(revision.ownership.ownerAt(offset)).toEqual({
        range: { start: 12, end: 34 },
        owner: {
          kind: 'markdown-literal',
          provider: 'math',
          ownerRange: { start: 12, end: 34 }
        }
      })
    }
  })

  it('does not inherit a pending root link label into a Comment lane', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('[root]{>>(url/{++nested++})<<}'),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toEqual([
      {
        kind: 'comment',
        range: { start: 6, end: 30 },
        markers: {
          open: { start: 6, end: 9 },
          close: { start: 27, end: 30 }
        },
        arms: [{
          name: 'comment',
          range: { start: 9, end: 27 },
          children: [{
            kind: 'addition',
            range: { start: 14, end: 26 },
            markers: {
              open: { start: 14, end: 17 },
              close: { start: 23, end: 26 }
            },
            arms: [{
              name: 'content',
              range: { start: 17, end: 23 },
              children: []
            }]
          }]
        }]
      }
    ])
    expect(revision.ownership.ownerAt(14).owner).toMatchObject({
      kind: 'critic-marker',
      form: 'addition',
      role: 'open'
    })
  })

  it('bounds inline-code lookahead at the accepted Comment close', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{>>`draft {++nested++}<<}`'),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toEqual([
      {
        kind: 'comment',
        range: { start: 0, end: 25 },
        markers: {
          open: { start: 0, end: 3 },
          close: { start: 22, end: 25 }
        },
        arms: [{
          name: 'comment',
          range: { start: 3, end: 22 },
          children: [{
            kind: 'addition',
            range: { start: 10, end: 22 },
            markers: {
              open: { start: 10, end: 13 },
              close: { start: 19, end: 22 }
            },
            arms: [{
              name: 'content',
              range: { start: 13, end: 19 },
              children: []
            }]
          }]
        }]
      }
    ])
    expect(revision.diagnostics.count).toBe(0)
    expect(revision.projection('original').source).toBe('`')
    expect(revision.projection('revised').source).toBe('`')
    expect(revision.ownership.ownerAt(10).owner).toMatchObject({
      kind: 'critic-marker',
      form: 'addition',
      role: 'open'
    })
  })

  it('advances provider lookahead past an accepted same-kind child', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{++{++x++}$code {--literal--}$++}'),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.diagnostics.count).toBe(0)
    expect(rootsOf(revision.criticMarkup)).toEqual([{
      kind: 'addition',
      range: { start: 0, end: 33 },
      markers: {
        open: { start: 0, end: 3 },
        close: { start: 30, end: 33 }
      },
      arms: [{
        name: 'content',
        range: { start: 3, end: 30 },
        children: [{
          kind: 'addition',
          range: { start: 3, end: 10 },
          markers: {
            open: { start: 3, end: 6 },
            close: { start: 7, end: 10 }
          },
          arms: [{
            name: 'content',
            range: { start: 6, end: 7 },
            children: []
          }]
        }]
      }]
    }])
    expect(revision.ownership.ownerAt(16)).toEqual({
      range: { start: 10, end: 30 },
      owner: {
        kind: 'markdown-literal',
        provider: 'math',
        ownerRange: { start: 10, end: 30 }
      }
    })
    expect(revision.projection('original').source).toBe('')
    expect(revision.projection('revised').source).toBe('x$code {--literal--}$')
  })

  it('uses virtual-lane backslash parity across zero-width CM markers', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot(String.raw`{==\==}<a title="{++active++}">`),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.diagnostics.count).toBe(0)
    expect(rootsOf(revision.criticMarkup)).toEqual([
      {
        kind: 'highlight',
        range: { start: 0, end: 7 },
        markers: {
          open: { start: 0, end: 3 },
          close: { start: 4, end: 7 }
        },
        arms: [{
          name: 'content',
          range: { start: 3, end: 4 },
          children: []
        }]
      },
      {
        kind: 'addition',
        range: { start: 17, end: 29 },
        markers: {
          open: { start: 17, end: 20 },
          close: { start: 26, end: 29 }
        },
        arms: [{
          name: 'content',
          range: { start: 20, end: 26 },
          children: []
        }]
      }
    ])
    expect(revision.ownership.ownerAt(7).owner).toEqual({
      kind: 'markdown-text'
    })
    expect(revision.ownership.ownerAt(17).owner).toMatchObject({
      kind: 'critic-marker',
      form: 'addition',
      role: 'open'
    })
    expect(revision.projection('original').source).toBe(String.raw`\<a title="">`)
    expect(revision.projection('revised').source).toBe(String.raw`\<a title="active">`)
  })

  it('uses virtual-lane backslash parity to escape a CM opener', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot(String.raw`{==\==}{++active++}`),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toEqual([{
      kind: 'highlight',
      range: { start: 0, end: 7 },
      markers: {
        open: { start: 0, end: 3 },
        close: { start: 4, end: 7 }
      },
      arms: [{
        name: 'content',
        range: { start: 3, end: 4 },
        children: []
      }]
    }])
    expect(revision.ownership.ownerAt(7).owner).toEqual({
      kind: 'markdown-text'
    })
    expect(revision.projection('original').source)
      .toBe(String.raw`\{++active++}`)
    expect(revision.projection('revised').source)
      .toBe(String.raw`\{++active++}`)
  })

  it('invalidates an outer link label after resolving a nested link', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('[outer [inner](in/{--literal--})](out/{++active++})'),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.diagnostics.count).toBe(0)
    expect(rootsOf(revision.criticMarkup)).toEqual([{
      kind: 'addition',
      range: { start: 38, end: 50 },
      markers: {
        open: { start: 38, end: 41 },
        close: { start: 47, end: 50 }
      },
      arms: [{
        name: 'content',
        range: { start: 41, end: 47 },
        children: []
      }]
    }])
    expect(revision.ownership.ownerAt(18)).toEqual({
      range: { start: 14, end: 32 },
      owner: {
        kind: 'markdown-literal',
        provider: 'link-destination',
        ownerRange: { start: 14, end: 32 }
      }
    })
    expect(revision.ownership.ownerAt(38).owner).toMatchObject({
      kind: 'critic-marker',
      form: 'addition',
      role: 'open'
    })
    expect(revision.projection('original').source)
      .toBe('[outer [inner](in/{--literal--})](out/)')
    expect(revision.projection('revised').source)
      .toBe('[outer [inner](in/{--literal--})](out/active)')
  })

  it('clears open link labels at a blank-line paragraph boundary', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('[x\n\n](url/{++active++})'),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.diagnostics.count).toBe(0)
    expect(rootsOf(revision.criticMarkup)).toEqual([{
      kind: 'addition',
      range: { start: 10, end: 22 },
      markers: {
        open: { start: 10, end: 13 },
        close: { start: 19, end: 22 }
      },
      arms: [{
        name: 'content',
        range: { start: 13, end: 19 },
        children: []
      }]
    }])
    expect(revision.ownership.ownerAt(10).owner).toMatchObject({
      kind: 'critic-marker',
      form: 'addition',
      role: 'open'
    })
    expect(revision.projection('original').source).toBe('[x\n\n](url/)')
    expect(revision.projection('revised').source).toBe('[x\n\n](url/active)')
  })

  it('treats CRLF as one line ending inside a link title', () => {
    const sourceText = '[x](url "a\r\nb {++literal++}")'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.diagnostics.count).toBe(0)
    expect(rootsOf(revision.criticMarkup)).toEqual([])
    expect(revision.ownership.ownerAt(14)).toEqual({
      range: { start: 12, end: 29 },
      owner: {
        kind: 'markdown-literal',
        provider: 'link-destination',
        ownerRange: { start: 3, end: 29 }
      }
    })
    expect(revision.projection('original').source).toBe(sourceText)
    expect(revision.projection('revised').source).toBe(sourceText)
  })

  it('gives a root backtick fence precedence over inline code', () => {
    const sourceText = '```\n{++literal++}\n```\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.diagnostics.count).toBe(0)
    expect(rootsOf(revision.criticMarkup)).toEqual([])
    expect(revision.ownership.ownerAt(4)).toEqual({
      range: { start: 4, end: 17 },
      owner: {
        kind: 'markdown-literal',
        provider: 'fenced-code',
        ownerRange: { start: 0, end: 22 }
      }
    })
    for (const view of ['original', 'revised'] as const) {
      const projection = revision.projection(view)
      expect(projection.source).toBe(sourceText)
      expect(projection.markdown.root.childAt(0)).toMatchObject({
        kind: 'code-block',
        range: { start: 0, end: 22 }
      })
    }
  })

  it('gives a type-6 HTML block precedence over its inline opener at EOF', () => {
    const sourceText = '<div>\n{++literal++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.diagnostics.count).toBe(0)
    expect(rootsOf(revision.criticMarkup)).toEqual([])
    expect(revision.ownership.ownerAt(6)).toEqual({
      range: { start: 6, end: 19 },
      owner: {
        kind: 'markdown-literal',
        provider: 'html-block',
        ownerRange: { start: 0, end: 19 }
      }
    })
    for (const view of ['original', 'revised'] as const) {
      const projection = revision.projection(view)
      expect(projection.source).toBe(sourceText)
      expect(projection.markdown.root.childAt(0)).toMatchObject({
        kind: 'html-block',
        range: { start: 0, end: 19 }
      })
    }
  })

  it('terminates inline HTML at a blank-line paragraph boundary', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('before <a\n\n title="{++active++}">'),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.diagnostics.count).toBe(0)
    expect(rootsOf(revision.criticMarkup)).toEqual([{
      kind: 'addition',
      range: { start: 19, end: 31 },
      markers: {
        open: { start: 19, end: 22 },
        close: { start: 28, end: 31 }
      },
      arms: [{
        name: 'content',
        range: { start: 22, end: 28 },
        children: []
      }]
    }])
    expect(revision.ownership.ownerAt(19).owner).toMatchObject({
      kind: 'critic-marker',
      form: 'addition',
      role: 'open'
    })
    expect(revision.projection('original').source)
      .toBe('before <a\n\n title="">')
    expect(revision.projection('revised').source)
      .toBe('before <a\n\n title="active">')
  })

  it('retains an arm-local raw HTML block as one parser-owned literal', () => {
    const sourceText = '{++<script>\n{--literal--}\n</script>++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.diagnostics.count).toBe(0)
    expect(rootsOf(revision.criticMarkup)).toEqual([{
      kind: 'addition',
      range: { start: 0, end: 38 },
      markers: {
        open: { start: 0, end: 3 },
        close: { start: 35, end: 38 }
      },
      arms: [{
        name: 'content',
        range: { start: 3, end: 35 },
        children: []
      }]
    }])
    expect(revision.ownership.ownerAt(12)).toEqual({
      range: { start: 12, end: 25 },
      owner: {
        kind: 'markdown-literal',
        provider: 'html-block',
        ownerRange: { start: 3, end: 35 }
      }
    })
    expect(revision.projection('original').source).toBe('')
    const revised = revision.projection('revised')
    expect(revised.source).toBe('<script>\n{--literal--}\n</script>')
    expect(revised.markdown.root.childAt(0)).toMatchObject({
      kind: 'html-block',
      range: { start: 0, end: 32 }
    })
  })

  it('retains an arm-local reference definition as one parser-owned literal', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{++[ref]: /{--literal--}++}'),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.diagnostics.count).toBe(0)
    expect(rootsOf(revision.criticMarkup)).toEqual([{
      kind: 'addition',
      range: { start: 0, end: 27 },
      markers: {
        open: { start: 0, end: 3 },
        close: { start: 24, end: 27 }
      },
      arms: [{
        name: 'content',
        range: { start: 3, end: 24 },
        children: []
      }]
    }])
    expect(revision.ownership.ownerAt(11)).toEqual({
      range: { start: 3, end: 24 },
      owner: {
        kind: 'markdown-literal',
        provider: 'definition',
        ownerRange: { start: 3, end: 24 }
      }
    })
    expect(revision.projection('original').source).toBe('')
    const revised = revision.projection('revised')
    expect(revised.source).toBe('[ref]: /{--literal--}')
    expect(revised.markdown.root.childAt(0)).toMatchObject({
      kind: 'definition',
      range: { start: 0, end: 21 }
    })
  })

  it('inherits a list container across a blank line before a fenced CM arm', () => {
    const sourceText =
      '- item\n' +
      '\n' +
      '    {++~~~\n' +
      '    {--literal--}\n' +
      '    ~~~++}\n'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toEqual([
      {
        kind: 'addition',
        range: { start: 12, end: 47 },
        markers: {
          open: { start: 12, end: 15 },
          close: { start: 44, end: 47 }
        },
        arms: [{
          name: 'content',
          range: { start: 15, end: 44 },
          children: []
        }]
      }
    ])
    expect(revision.ownership.ownerAt(23)).toEqual({
      range: { start: 19, end: 36 },
      owner: {
        kind: 'markdown-literal',
        provider: 'fenced-code',
        ownerRange: { start: 15, end: 44 }
      }
    })
    expect(revision.projection('original').source).toBe('- item\n\n    \n')
    expect(revision.projection('revised').source).toBe(
      '- item\n' +
      '\n' +
      '    ~~~\n' +
      '    {--literal--}\n' +
      '    ~~~\n'
    )
  })

  it('forks inherited multiline list-container state into fenced Substitution arms', () => {
    const sourceText =
      '- item\n' +
      '{~~    ~~~\n' +
      '  {++oldlit++}\n' +
      '    ~~~\n' +
      '~>    ~~~\n' +
      '  {--newlit--}\n' +
      '    ~~~\n' +
      '~~}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(revision.diagnostics.count).toBe(0)
    expect(rootsOf(revision.criticMarkup)).toEqual([
      {
        kind: 'substitution',
        range: { start: 7, end: 77 },
        markers: {
          open: { start: 7, end: 10 },
          separator: { start: 41, end: 43 },
          close: { start: 74, end: 77 }
        },
        arms: [
          {
            name: 'old',
            range: { start: 10, end: 41 },
            children: []
          },
          {
            name: 'new',
            range: { start: 43, end: 74 },
            children: []
          }
        ]
      }
    ])

    expect(revision.ownership.ownerAt(20)).toEqual({
      range: { start: 18, end: 32 },
      owner: {
        kind: 'markdown-literal',
        provider: 'fenced-code',
        ownerRange: { start: 14, end: 41 }
      }
    })
    expect(revision.ownership.ownerAt(53)).toEqual({
      range: { start: 51, end: 65 },
      owner: {
        kind: 'markdown-literal',
        provider: 'fenced-code',
        ownerRange: { start: 47, end: 74 }
      }
    })

    const original = revision.projection('original')
    expect(original.source).toBe(
      '- item\n' +
      '    ~~~\n' +
      '  {++oldlit++}\n' +
      '    ~~~\n'
    )
    expect(original.provenance.originAt(17)).toEqual({
      kind: 'canonical',
      sourceOffset: 20
    })
    expect(original.provenance.originAt(28)).toEqual({
      kind: 'canonical',
      sourceOffset: 31
    })

    const revised = revision.projection('revised')
    expect(revised.source).toBe(
      '- item\n' +
      '    ~~~\n' +
      '  {--newlit--}\n' +
      '    ~~~\n'
    )
    expect(revised.provenance.originAt(17)).toEqual({
      kind: 'canonical',
      sourceOffset: 53
    })
    expect(revised.provenance.originAt(28)).toEqual({
      kind: 'canonical',
      sourceOffset: 64
    })
  })

  it('does not grant document BOF to a root arm after an empty CM sibling', () => {
    const sourceText = '{++++}{++---\n{--active--}\n---++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )

    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([
      { kind: 'addition', arms: [{ children: [] }] },
      {
        kind: 'addition',
        arms: [{ children: [{ kind: 'deletion' }] }]
      }
    ])
    expect(revision.projection('original').source).toBe('')
    expect(revision.projection('revised').source).toBe('---\n\n---')
  })

  it('materializes a Setext heading assembled inside a CM carrier', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{++title\n===++}'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const heading = revision.projection('revised').markdown.root.childAt(0)
    expect(heading).toMatchObject({
      kind: 'heading',
      range: { start: 0, end: 9 },
      attributes: { level: 1 },
      childCount: 1
    })
    expect(heading.childAt(0)).toMatchObject({
      kind: 'text',
      range: { start: 0, end: 5 }
    })
  })

  it('materializes hard and soft breaks from a multiline CM carrier', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{++hard  \nsoft\nnext++}'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const paragraph = revision.projection('revised').markdown.root.childAt(0)
    expect(
      Array.from({ length: paragraph.childCount }, (_, ordinal) => {
        const child = paragraph.childAt(ordinal)
        return { kind: child.kind, range: child.range }
      })
    ).toEqual([
      { kind: 'text', range: { start: 0, end: 4 } },
      { kind: 'hard-break', range: { start: 4, end: 7 } },
      { kind: 'text', range: { start: 7, end: 11 } },
      { kind: 'soft-break', range: { start: 11, end: 12 } },
      { kind: 'text', range: { start: 12, end: 16 } }
    ])
  })

  it('materializes GFM strikethrough assembled inside a CM carrier', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('{++before ~~old~~ after++}'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const paragraph = revision.projection('revised').markdown.root.childAt(0)
    expect(paragraph.childAt(1)).toMatchObject({
      kind: 'strikethrough',
      range: { start: 7, end: 14 },
      childCount: 1
    })
    expect(paragraph.childAt(1).childAt(0)).toMatchObject({
      kind: 'text',
      range: { start: 9, end: 12 }
    })
  })

  it('materializes a GFM table assembled inside a CM carrier', () => {
    const sourceText = '{++| a | b |\n| --- | :---: |\n| c | d |++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    const table = revision.projection('revised').markdown.root.childAt(0)
    expect(table).toMatchObject({ kind: 'table', childCount: 2 })
    expect(table.childAt(0)).toMatchObject({ kind: 'table-row', childCount: 2 })
    expect(table.childAt(0).childAt(0)).toMatchObject({
      kind: 'table-cell',
      attributes: { header: true, alignment: 'none' }
    })
    expect(table.childAt(0).childAt(1)).toMatchObject({
      kind: 'table-cell',
      attributes: { header: true, alignment: 'center' }
    })
    expect(table.childAt(1).childAt(0)).toMatchObject({
      kind: 'table-cell',
      attributes: { header: false, alignment: 'none' }
    })
  })

  it('materializes diagram and fenced-math owners inside CM carriers', () => {
    const sourceText =
      '{++```mermaid\n{--diagram literal--}\n```++}\n' +
      '{++```math\n{==math literal==}\n```++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([
      { kind: 'addition', arms: [{ children: [] }] },
      { kind: 'addition', arms: [{ children: [] }] }
    ])
    const revised = revision.projection('revised').markdown.root
    expect(revised.childAt(0)).toMatchObject({ kind: 'diagram' })
    expect(revised.childAt(1)).toMatchObject({ kind: 'math-block' })
  })

  it('materializes thematic breaks, images, and footnotes from CM lanes', () => {
    const sourceText =
      '{++***\n\n![alt](url) and note[^n]\n\n' +
      '[^n]: body {--literal--}++}'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(sourceText),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }

    expect(rootsOf(revision.criticMarkup)).toMatchObject([
      { kind: 'addition', arms: [{ children: [] }] }
    ])
    const root = revision.projection('revised').markdown.root
    expect(root.childAt(0)).toMatchObject({ kind: 'thematic-break' })
    const paragraph = root.childAt(1)
    expect(paragraph.childAt(0)).toMatchObject({ kind: 'image' })
    expect(paragraph.childAt(2)).toMatchObject({
      kind: 'footnote-reference',
      attributes: { label: 'n' }
    })
    expect(root.childAt(2)).toMatchObject({ kind: 'footnote-definition' })
  })
})
