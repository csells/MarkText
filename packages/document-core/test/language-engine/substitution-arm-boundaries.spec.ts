import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type DocumentRevision,
  type MarkdownNode,
  type ParseConfiguration
} from '@marktext/document-core'
import { rootsOf, runsOf } from '../helpers/collections.js'

type CompleteRevision = Extract<DocumentRevision, { readonly kind: 'complete' }>

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

function open(source: string): CompleteRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete document revision')
  }
  return revision
}

function childKinds(node: MarkdownNode): readonly string[] {
  return Array.from(
    { length: node.childCount },
    (_, ordinal) => node.childAt(ordinal).kind
  )
}

function expectTwoCanonicalRoots(revision: CompleteRevision): void {
  expect(rootsOf(revision.criticMarkup).map((node) => ({
    kind: node.kind,
    range: node.range
  }))).toEqual([
    { kind: 'substitution', range: { start: 0, end: 14 } },
    { kind: 'addition', range: { start: 14, end: 27 } }
  ])
  expect(revision.ownership.ownerAt(14).owner).toMatchObject({
    kind: 'critic-marker',
    form: 'addition',
    role: 'open'
  })
}

describe('Profile 1 self-contained Substitution arms', () => {
  it('does not match a root opener to an arm-local closer', () => {
    const source = 'I really love *italic {~~fonts*~>font-styles*~~}.'
    const revision = open(source)

    const original = revision.projection('original')
    expect(original.source).toBe('I really love \\*italic fonts*.')
    expect(original.provenance.originAt(14)).toEqual({
      kind: 'generated',
      sourcePosition: 14,
      affinity: 'next'
    })
    expect(childKinds(original.markdown.root.childAt(0))).toEqual(['text'])

    const revised = revision.projection('revised')
    expect(revised.source).toBe('I really love \\*italic font-styles*.')
    expect(revised.provenance.originAt(14)).toEqual({
      kind: 'generated',
      sourcePosition: 14,
      affinity: 'next'
    })
    expect(childKinds(revised.markdown.root.childAt(0))).toEqual(['text'])
  })

  it('matches Markdown boundaries completed independently inside both arms', () => {
    const source = 'I really love {~~*italic fonts*~>*italic font-styles*~~}.'
    const revision = open(source)

    const original = revision.projection('original')
    expect(original.source).toBe('I really love *italic fonts*.')
    expect(childKinds(original.markdown.root.childAt(0))).toEqual([
      'text',
      'emphasis',
      'text'
    ])

    const revised = revision.projection('revised')
    expect(revised.source).toBe('I really love *italic font-styles*.')
    expect(childKinds(revised.markdown.root.childAt(0))).toEqual([
      'text',
      'emphasis',
      'text'
    ])
  })

  it('preserves arm-local emphasis nested inside enclosing emphasis', () => {
    const revision = open('*A{~~old~>b*c*~~}Z*')
    const paragraph = revision.projection('revised').markdown.root.childAt(0)

    expect(childKinds(paragraph)).toEqual(['emphasis'])
    expect(childKinds(paragraph.childAt(0))).toEqual([
      'text',
      'emphasis',
      'text'
    ])
  })

  it('respells enclosing emphasis with stable provenance and clean meaning', () => {
    const revision = open('*A{~~old~>b*c*~~}Z*')
    const revised = revision.projection('revised')

    expect(revised.source).toBe('_Ab*c*Z_')
    expect(revised.provenance.originAt(0)).toEqual({
      kind: 'generated',
      sourcePosition: 0,
      affinity: 'next'
    })
    expect(revised.provenance.originAt(3)).toEqual({
      kind: 'canonical',
      sourceOffset: 11
    })
    expect(revised.provenance.originAt(5)).toEqual({
      kind: 'canonical',
      sourceOffset: 13
    })
    expect(revised.provenance.originAt(7)).toEqual({
      kind: 'generated',
      sourcePosition: 18,
      affinity: 'next'
    })

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    const paragraph = clean.projection('revised').markdown.root.childAt(0)
    expect(childKinds(paragraph)).toEqual(['emphasis'])
    expect(childKinds(paragraph.childAt(0))).toEqual([
      'text',
      'emphasis',
      'text'
    ])
  })

  it('preserves nested emphasis when alternate markers are intraword', () => {
    const revision = open('x*a{~~old~>b*c*~~}d*y')
    const revised = revision.projection('revised')

    expect(revised.source).toBe('&#x78;_ab*c*d_&#x79;')
    expect(revised.provenance.originAt(0)).toEqual({
      kind: 'generated',
      sourcePosition: 0,
      affinity: 'next'
    })
    expect(revised.provenance.originAt(6)).toEqual({
      kind: 'generated',
      sourcePosition: 1,
      affinity: 'next'
    })
    expect(revised.provenance.originAt(8)).toEqual({
      kind: 'canonical',
      sourceOffset: 11
    })
    expect(revised.provenance.originAt(13)).toEqual({
      kind: 'generated',
      sourcePosition: 19,
      affinity: 'next'
    })
    expect(revised.provenance.originAt(14)).toEqual({
      kind: 'generated',
      sourcePosition: 20,
      affinity: 'next'
    })

    const paragraph = revised.markdown.root.childAt(0)

    expect(childKinds(paragraph)).toEqual(['text', 'emphasis', 'text'])
    expect(childKinds(paragraph.childAt(1))).toEqual([
      'text',
      'emphasis',
      'text'
    ])

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    const cleanParagraph = clean.projection('revised').markdown.root.childAt(0)
    expect(childKinds(cleanParagraph)).toEqual(['text', 'emphasis', 'text'])
    expect(childKinds(cleanParagraph.childAt(1))).toEqual([
      'text',
      'emphasis',
      'text'
    ])
  })

  it('keeps enclosing emphasis when an arm-local pair touches both endpoints', () => {
    const revised = open('*{~~old~>b*c*~~}*').projection('revised')

    expect(revised.source).toBe('_b*c*_')
    expect(revised.provenance.originAt(0)).toEqual({
      kind: 'generated',
      sourcePosition: 0,
      affinity: 'next'
    })
    expect(revised.provenance.originAt(1)).toEqual({
      kind: 'canonical',
      sourceOffset: 9
    })
    expect(revised.provenance.originAt(5)).toEqual({
      kind: 'generated',
      sourcePosition: 16,
      affinity: 'next'
    })
    const paragraph = revised.markdown.root.childAt(0)
    expect(childKinds(paragraph)).toEqual(['emphasis'])
    expect(childKinds(paragraph.childAt(0))).toEqual(['text', 'emphasis'])

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    const cleanParagraph = clean.projection('revised').markdown.root.childAt(0)
    expect(childKinds(cleanParagraph)).toEqual(['emphasis'])
    expect(childKinds(cleanParagraph.childAt(0))).toEqual([
      'text',
      'emphasis'
    ])
  })

  it('shares one flanking-scalar codec between adjacent emphasis repairs', () => {
    const revised = open(
      'x*a{~~o~>b*c*~~}d*z*e{~~o~>f*g*~~}h*y'
    ).projection('revised')

    expect(revised.source).toBe(
      '&#x78;_ab*c*d_&#x7a;_ef*g*h_&#x79;'
    )
    const generatedOrigins = [
      [0, 0],
      [6, 1],
      [13, 17],
      [14, 18],
      [20, 19],
      [27, 35],
      [28, 36]
    ] as const
    for (const [projectedOffset, sourcePosition] of generatedOrigins) {
      expect(revised.provenance.originAt(projectedOffset)).toEqual({
        kind: 'generated',
        sourcePosition,
        affinity: 'next'
      })
    }
    expect(revised.provenance.originAt(8)).toEqual({
      kind: 'canonical',
      sourceOffset: 9
    })
    const paragraph = revised.markdown.root.childAt(0)
    expect(childKinds(paragraph)).toEqual([
      'text',
      'emphasis',
      'text',
      'emphasis',
      'text'
    ])
    expect(childKinds(paragraph.childAt(1))).toEqual([
      'text',
      'emphasis',
      'text'
    ])
    expect(childKinds(paragraph.childAt(3))).toEqual([
      'text',
      'emphasis',
      'text'
    ])

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    const cleanParagraph = clean.projection('revised').markdown.root.childAt(0)
    expect(childKinds(cleanParagraph)).toEqual([
      'text',
      'emphasis',
      'text',
      'emphasis',
      'text'
    ])
    expect(childKinds(cleanParagraph.childAt(1))).toEqual([
      'text',
      'emphasis',
      'text'
    ])
    expect(childKinds(cleanParagraph.childAt(3))).toEqual([
      'text',
      'emphasis',
      'text'
    ])
  })

  it('preserves a lone UTF-16 unit while classifying emphasis flanking', () => {
    const revised = open(
      '\uD800*a{~~old~>b*c*~~}d*!'
    ).projection('revised')

    expect(revised.source).toBe('\uD800_ab*c*d_!')
    expect(revised.provenance.originAt(0)).toEqual({
      kind: 'canonical',
      sourceOffset: 0
    })
    expect(revised.provenance.originAt(1)).toEqual({
      kind: 'generated',
      sourcePosition: 1,
      affinity: 'next'
    })
    expect(revised.provenance.originAt(3)).toEqual({
      kind: 'canonical',
      sourceOffset: 11
    })
    expect(revised.provenance.originAt(8)).toEqual({
      kind: 'generated',
      sourcePosition: 19,
      affinity: 'next'
    })
    const paragraph = revised.markdown.root.childAt(0)
    expect(childKinds(paragraph)).toEqual(['text', 'emphasis', 'text'])
    expect(childKinds(paragraph.childAt(1))).toEqual([
      'text',
      'emphasis',
      'text'
    ])

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    const cleanParagraph = clean.projection('revised').markdown.root.childAt(0)
    expect(childKinds(cleanParagraph)).toEqual(['text', 'emphasis', 'text'])
    expect(childKinds(cleanParagraph.childAt(1))).toEqual([
      'text',
      'emphasis',
      'text'
    ])
  })

  it('preserves NUL while using its CommonMark replacement semantics', () => {
    const revised = open(
      '\u0000*a{~~old~>b*c*~~}d*!'
    ).projection('revised')

    expect(revised.source).toBe('\u0000_ab*c*d_!')
    expect(revised.provenance.originAt(0)).toEqual({
      kind: 'canonical',
      sourceOffset: 0
    })
    expect(revised.provenance.originAt(1)).toEqual({
      kind: 'generated',
      sourcePosition: 1,
      affinity: 'next'
    })
    expect(childKinds(revised.markdown.root.childAt(0))).toEqual([
      'text',
      'emphasis',
      'text'
    ])

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    expect(childKinds(clean.projection('revised').markdown.root.childAt(0)))
      .toEqual(['text', 'emphasis', 'text'])
  })

  it('does not classify every C0 control as punctuation', () => {
    const revised = open(
      '\u0001*a{~~old~>b*c*~~}d*!'
    ).projection('revised')

    expect(revised.source).toBe('&#x1;_ab*c*d_!')
    expect(revised.provenance.originAt(0)).toEqual({
      kind: 'generated',
      sourcePosition: 0,
      affinity: 'next'
    })
    expect(childKinds(revised.markdown.root.childAt(0))).toEqual([
      'text',
      'emphasis',
      'text'
    ])
  })

  it('encodes an astral flanking scalar as one semantic unit', () => {
    const revised = open(
      '\u{10400}*a{~~old~>b*c*~~}d*!'
    ).projection('revised')

    expect(revised.source).toBe('&#x10400;_ab*c*d_!')
    expect(revised.provenance.originAt(0)).toEqual({
      kind: 'generated',
      sourcePosition: 0,
      affinity: 'next'
    })
    expect(childKinds(revised.markdown.root.childAt(0))).toEqual([
      'text',
      'emphasis',
      'text'
    ])
  })

  it('ends an unmatched old-arm code opener before the following CM sibling', () => {
    const revision = open('{~~`~>plain~~}{++literal++}`')
    expectTwoCanonicalRoots(revision)

    const original = revision.projection('original')
    expect(original.source).toBe('``')
    expect(original.provenance.originAt(1)).toEqual({
      kind: 'canonical',
      sourceOffset: 27
    })
    expect(childKinds(original.markdown.root.childAt(0))).toEqual(['text'])

    const revised = revision.projection('revised')
    expect(revised.source).toBe('plainliteral`')
    expect(childKinds(revised.markdown.root.childAt(0))).toEqual(['text'])
  })

  it('protects a projected code pair split between a new arm and later source', () => {
    const revision = open('{~~plain~>`~~}{++literal++}`')
    expectTwoCanonicalRoots(revision)

    const original = revision.projection('original')
    expect(original.source).toBe('plain`')
    expect(childKinds(original.markdown.root.childAt(0))).toEqual(['text'])

    const revised = revision.projection('revised')
    expect(revised.source).toBe('\\`literal`')
    expect(revised.provenance.originAt(0)).toEqual({
      kind: 'generated',
      sourcePosition: 10,
      affinity: 'next'
    })
    expect(childKinds(revised.markdown.root.childAt(0))).toEqual(['text'])

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    expect(childKinds(clean.projection('revised').markdown.root.childAt(0)))
      .toEqual(['text'])
  })

  it('keeps code pairs complete inside or around a selected arm', () => {
    const inside = open('{~~plain~>`literal`~~}')
    const revisedInside = inside.projection('revised')
    expect(revisedInside.source).toBe('`literal`')
    expect(childKinds(revisedInside.markdown.root.childAt(0))).toEqual([
      'inline-code'
    ])

    const around = open('{++`++}{~~old~>new~~}{++`++}')
    const revisedAround = around.projection('revised')
    expect(revisedAround.source).toBe('`new`')
    expect(childKinds(revisedAround.markdown.root.childAt(0))).toEqual([
      'inline-code'
    ])
  })

  it('lengthens enclosing code delimiters around an arm-local backtick', () => {
    const revision = open('{++`++}A{~~old~>B`C~~}D{++`++}')

    expect(revision.projection('revised').source).toBe('``AB`CD``')
  })

  it('maps extended code delimiters to their canonical enclosing runs', () => {
    const revision = open('{++`++}A{~~old~>B`C~~}D{++`++}')
    const revised = revision.projection('revised')

    expect(revised.provenance.originAt(0)).toEqual({
      kind: 'generated',
      sourcePosition: 3,
      affinity: 'next'
    })
    expect(revised.provenance.originAt(1)).toEqual({
      kind: 'canonical',
      sourceOffset: 3
    })
    expect(revised.provenance.originAt(7)).toEqual({
      kind: 'generated',
      sourcePosition: 26,
      affinity: 'next'
    })
    expect(revised.provenance.originAt(8)).toEqual({
      kind: 'canonical',
      sourceOffset: 26
    })
  })

  it('reopens extended code delimiters as one code span', () => {
    const revision = open('{++`++}A{~~old~>B`C~~}D{++`++}')
    const revised = revision.projection('revised')
    expect(revised.markdown.root.childAt(0).childAt(0)).toMatchObject({
      kind: 'inline-code',
      attributes: { markerLength: 2 }
    })

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    expect(clean.projection('revised').markdown.root.childAt(0).childAt(0))
      .toMatchObject({
        kind: 'inline-code',
        attributes: { markerLength: 2 }
      })
  })

  it('extends retained code endpoints across assembled interior runs', () => {
    const revision = open(
      '{++`++}A{++`++}{++`++}X{~~old~>B`C~~}D{++`++}'
    )
    const revised = revision.projection('revised')

    expect(revised.source).toBe('```A``XB`CD```')
    const expectedOrigins = [
      { kind: 'generated', sourcePosition: 3, affinity: 'next' },
      { kind: 'generated', sourcePosition: 3, affinity: 'next' },
      { kind: 'canonical', sourceOffset: 3 },
      { kind: 'canonical', sourceOffset: 7 },
      { kind: 'canonical', sourceOffset: 11 },
      { kind: 'canonical', sourceOffset: 18 },
      { kind: 'canonical', sourceOffset: 22 },
      { kind: 'canonical', sourceOffset: 31 },
      { kind: 'canonical', sourceOffset: 32 },
      { kind: 'canonical', sourceOffset: 33 },
      { kind: 'canonical', sourceOffset: 37 },
      { kind: 'generated', sourcePosition: 41, affinity: 'next' },
      { kind: 'generated', sourcePosition: 41, affinity: 'next' },
      { kind: 'canonical', sourceOffset: 41 }
    ] as const
    for (const [offset, origin] of expectedOrigins.entries()) {
      expect(revised.provenance.originAt(offset)).toEqual(origin)
    }
    expect(revised.markdown.root).toMatchObject({
      kind: 'document',
      range: { start: 0, end: 14 }
    })
    expect(revised.markdown.root.childAt(0)).toMatchObject({
      kind: 'paragraph',
      range: { start: 0, end: 14 }
    })
    expect(revised.markdown.root.childAt(0).childAt(0)).toMatchObject({
      kind: 'inline-code',
      range: { start: 0, end: 14 },
      attributes: { markerLength: 3 }
    })

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    expect(clean.projection('revised').markdown.root.childAt(0).childAt(0))
      .toMatchObject({
        kind: 'inline-code',
        range: { start: 0, end: 14 },
        attributes: { markerLength: 3 }
      })
  })

  it('guards an assembled code run without inventing delimiter identity', () => {
    const revision = open(
      '{++`++}{++`++}A{~~old~>B``C~~}D{++`++}{++`++}'
    )
    const revised = revision.projection('revised')

    expect(revised.source).toBe('\\``AB\\``CD``')
    expect(revised.provenance.originAt(0)).toEqual({
      kind: 'generated',
      sourcePosition: 3,
      affinity: 'next'
    })
    expect(revised.provenance.originAt(1)).toEqual({
      kind: 'canonical',
      sourceOffset: 3
    })
    expect(revised.provenance.originAt(5)).toEqual({
      kind: 'generated',
      sourcePosition: 24,
      affinity: 'next'
    })
    expect(revised.provenance.originAt(6)).toEqual({
      kind: 'canonical',
      sourceOffset: 24
    })
    expect(childKinds(revised.markdown.root.childAt(0))).toEqual(['text'])

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    expect(childKinds(clean.projection('revised').markdown.root.childAt(0)))
      .toEqual(['text'])
  })

  it('protects a projected math pair split between a new arm and later source', () => {
    const revision = open('{~~plain~>$~~}{++literal++}$')
    expectTwoCanonicalRoots(revision)

    const original = revision.projection('original')
    expect(original.source).toBe('plain$')
    expect(childKinds(original.markdown.root.childAt(0))).toEqual(['text'])

    const revised = revision.projection('revised')
    expect(revised.source).toBe('\\$literal$')
    expect(revised.provenance.originAt(0)).toEqual({
      kind: 'generated',
      sourcePosition: 10,
      affinity: 'next'
    })
    expect(childKinds(revised.markdown.root.childAt(0))).toEqual(['text'])

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    expect(childKinds(clean.projection('revised').markdown.root.childAt(0)))
      .toEqual(['text'])
  })

  it('keeps math pairs complete inside or around a selected arm', () => {
    const inside = open('{~~plain~>$literal$~~}')
    const revisedInside = inside.projection('revised')
    expect(revisedInside.source).toBe('$literal$')
    expect(childKinds(revisedInside.markdown.root.childAt(0))).toEqual([
      'inline-math'
    ])

    const around = open('{++$++}{~~old~>new~~}{++$++}')
    const revisedAround = around.projection('revised')
    expect(revisedAround.source).toBe('$new$')
    expect(childKinds(revisedAround.markdown.root.childAt(0))).toEqual([
      'inline-math'
    ])
  })

  it('keeps enclosing math while escaping an arm-local dollar', () => {
    const revision = open('{++$++}A{~~old~>B$C~~}D{++$++}')
    const revised = revision.projection('revised')

    expect(revised.source).toBe('$AB\\$CD$')
    expect(revised.provenance.originAt(3)).toEqual({
      kind: 'generated',
      sourcePosition: 17,
      affinity: 'next'
    })
    expect(childKinds(revised.markdown.root.childAt(0))).toEqual([
      'inline-math'
    ])

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    expect(childKinds(clean.projection('revised').markdown.root.childAt(0)))
      .toEqual(['inline-math'])
  })

  it('terminates an arm-local fence before parsing the suffix', () => {
    const revision = open('{~~p~>```\ni~~}\n```\no')
    const original = revision.projection('original')
    const revised = revision.projection('revised')

    expect(original.source).toBe('p\n\n```\no')
    expect(original.provenance.originAt(1)).toEqual({
      kind: 'generated',
      sourcePosition: 4,
      affinity: 'next'
    })
    expect(childKinds(original.markdown.root)).toEqual([
      'paragraph',
      'code-block'
    ])
    expect(revised.source).toBe('```\ni\n```\n```\no')
    for (let offset = 5; offset <= 8; offset += 1) {
      expect(revised.provenance.originAt(offset)).toEqual({
        kind: 'generated',
        sourcePosition: 11,
        affinity: 'next'
      })
    }
    expect(childKinds(revised.markdown.root)).toEqual([
      'code-block',
      'code-block'
    ])

    const cleanOriginal = open(original.source)
    const cleanRevised = open(revised.source)
    expect(rootsOf(cleanOriginal.criticMarkup)).toEqual([])
    expect(rootsOf(cleanRevised.criticMarkup)).toEqual([])
    expect(cleanOriginal.projection('revised').source).toBe(original.source)
    expect(cleanRevised.projection('revised').source).toBe(revised.source)
    expect(childKinds(cleanOriginal.projection('revised').markdown.root))
      .toEqual(['paragraph', 'code-block'])
    expect(childKinds(cleanRevised.projection('revised').markdown.root))
      .toEqual(['code-block', 'code-block'])
  })

  it('terminates an arm-local blockquote before suffix prose', () => {
    const revision = open('{~~p~>> q~~}\ns')
    const original = revision.projection('original')
    const revised = revision.projection('revised')

    expect(original.source).toBe('p\n\ns')
    expect(original.provenance.originAt(1)).toEqual({
      kind: 'generated',
      sourcePosition: 4,
      affinity: 'next'
    })
    expect(childKinds(original.markdown.root)).toEqual([
      'paragraph',
      'paragraph'
    ])

    expect(revised.source).toBe('> q\n\ns')
    expect(revised.provenance.originAt(3)).toEqual({
      kind: 'generated',
      sourcePosition: 9,
      affinity: 'next'
    })
    expect(childKinds(revised.markdown.root)).toEqual([
      'blockquote',
      'paragraph'
    ])

    const cleanOriginal = open(original.source)
    const cleanRevised = open(revised.source)
    expect(rootsOf(cleanOriginal.criticMarkup)).toEqual([])
    expect(rootsOf(cleanRevised.criticMarkup)).toEqual([])
    expect(cleanOriginal.projection('revised').source).toBe(original.source)
    expect(cleanRevised.projection('revised').source).toBe(revised.source)
    expect(childKinds(cleanOriginal.projection('revised').markdown.root))
      .toEqual(['paragraph', 'paragraph'])
    expect(childKinds(cleanRevised.projection('revised').markdown.root))
      .toEqual(['blockquote', 'paragraph'])
  })

  it('terminates an arm-local list before suffix prose', () => {
    const revision = open('{~~p~>- q~~}\ns')
    const original = revision.projection('original')
    const revised = revision.projection('revised')

    expect(original.source).toBe('p\n\ns')
    expect(original.provenance.originAt(1)).toEqual({
      kind: 'generated',
      sourcePosition: 4,
      affinity: 'next'
    })
    expect(childKinds(original.markdown.root)).toEqual([
      'paragraph',
      'paragraph'
    ])

    expect(revised.source).toBe('- q\n\ns')
    expect(revised.provenance.originAt(3)).toEqual({
      kind: 'generated',
      sourcePosition: 9,
      affinity: 'next'
    })
    expect(childKinds(revised.markdown.root)).toEqual([
      'list',
      'paragraph'
    ])

    const cleanOriginal = open(original.source)
    const cleanRevised = open(revised.source)
    expect(rootsOf(cleanOriginal.criticMarkup)).toEqual([])
    expect(rootsOf(cleanRevised.criticMarkup)).toEqual([])
    expect(cleanOriginal.projection('revised').source).toBe(original.source)
    expect(cleanRevised.projection('revised').source).toBe(revised.source)
    expect(childKinds(cleanOriginal.projection('revised').markdown.root))
      .toEqual(['paragraph', 'paragraph'])
    expect(childKinds(cleanRevised.projection('revised').markdown.root))
      .toEqual(['list', 'paragraph'])
  })

  it('removes only structural indentation after an arm-local list', () => {
    const revision = open('{~~p~>- q~~}\n  s')
    const original = revision.projection('original')
    const revised = revision.projection('revised')

    expect(original.source).toBe('p\n\n  s')
    expect(original.provenance.originAt(1)).toEqual({
      kind: 'generated',
      sourcePosition: 4,
      affinity: 'next'
    })
    expect(childKinds(original.markdown.root)).toEqual([
      'paragraph',
      'paragraph'
    ])

    expect(revised.source).toBe('- q\n\n s')
    expect(revised.provenance.originAt(3)).toEqual({
      kind: 'generated',
      sourcePosition: 9,
      affinity: 'next'
    })
    expect(revised.provenance.originAt(4)).toEqual({
      kind: 'canonical',
      sourceOffset: 12
    })
    expect(revised.provenance.originAt(5)).toEqual({
      kind: 'canonical',
      sourceOffset: 13
    })
    expect(revised.provenance.originAt(6)).toEqual({
      kind: 'canonical',
      sourceOffset: 15
    })
    expect(childKinds(revised.markdown.root)).toEqual([
      'list',
      'paragraph'
    ])

    const cleanOriginal = open(original.source)
    const cleanRevised = open(revised.source)
    expect(rootsOf(cleanOriginal.criticMarkup)).toEqual([])
    expect(rootsOf(cleanRevised.criticMarkup)).toEqual([])
    expect(cleanOriginal.projection('revised').source).toBe(original.source)
    expect(cleanRevised.projection('revised').source).toBe(revised.source)
    expect(childKinds(cleanOriginal.projection('revised').markdown.root))
      .toEqual(['paragraph', 'paragraph'])
    expect(childKinds(cleanRevised.projection('revised').markdown.root))
      .toEqual(['list', 'paragraph'])
  })

  it('keeps a following CM sibling outside an unfinished arm-local link label', () => {
    const revision = open('{~~old~>[x~~}]({++literal++})')

    expect(rootsOf(revision.criticMarkup).map((node) => ({
      kind: node.kind,
      range: node.range
    }))).toEqual([
      { kind: 'substitution', range: { start: 0, end: 13 } },
      { kind: 'addition', range: { start: 15, end: 28 } }
    ])
    expect(revision.ownership.ownerAt(15).owner).toMatchObject({
      kind: 'critic-marker',
      form: 'addition',
      role: 'open'
    })
  })

  it('protects a projected link assembled from an unfinished arm-local label', () => {
    const revision = open('{~~old~>[x~~}]({++literal++})')

    const revised = revision.projection('revised')
    expect(revised.source).toBe('\\[x](literal)')
    expect(revised.provenance.originAt(0)).toEqual({
      kind: 'generated',
      sourcePosition: 8,
      affinity: 'next'
    })
    expect(childKinds(revised.markdown.root.childAt(0))).toEqual(['text'])

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    expect(childKinds(clean.projection('revised').markdown.root.childAt(0)))
      .toEqual(['text'])
  })

  it('does not export an arm-local reference definition to following source', () => {
    const revision = open('{~~old~>[x]: /new\n~~}[x]')

    const root = revision.projection('revised').markdown.root
    expect(root.childCount).toBe(2)
    expect(root.childAt(0).kind).toBe('definition')
    const paragraph = root.childAt(1)
    expect(paragraph.kind).toBe('paragraph')
    expect(childKinds(paragraph)).toEqual(['text'])
  })

  it('protects a following reference from an arm-local definition on reopen', () => {
    const revision = open('{~~old~>[x]: /new\n~~}[x]')

    const revised = revision.projection('revised')
    expect(revised.source).toBe('[x]: /new\n\\[x]')
    expect(revised.provenance.originAt(10)).toEqual({
      kind: 'generated',
      sourcePosition: 21,
      affinity: 'next'
    })

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    const paragraph = clean.projection('revised').markdown.root.childAt(1)
    expect(childKinds(paragraph)).toEqual(['text'])
  })

  it('protects an arm-local image bracket without exposing a link on reopen', () => {
    const revision = open('{~~old~>![x~~}]({++literal++})')

    const revised = revision.projection('revised')
    expect(revised.source).toBe('!\\[x](literal)')
    expect(revised.provenance.originAt(1)).toEqual({
      kind: 'generated',
      sourcePosition: 9,
      affinity: 'next'
    })
    expect(childKinds(revised.markdown.root.childAt(0))).toEqual(['text'])

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    expect(childKinds(clean.projection('revised').markdown.root.childAt(0)))
      .toEqual(['text'])
  })

  it('protects a link destination opened in an arm and closed outside it', () => {
    const revision = open('{~~old~>[x](de~~}st)')

    const revised = revision.projection('revised')
    expect(revised.source).toBe('[x]\\(dest)')
    expect(revised.provenance.originAt(3)).toEqual({
      kind: 'generated',
      sourcePosition: 11,
      affinity: 'next'
    })
    expect(childKinds(revised.markdown.root.childAt(0))).toEqual(['text'])

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    expect(childKinds(clean.projection('revised').markdown.root.childAt(0)))
      .toEqual(['text'])
  })

  it('invalidates a pending link destination when arm text intervenes', () => {
    const source = '[x]{~~old~>new~~}(u)'
    const revision = open(source)

    expect(revision.ownership.ownerAt(source.indexOf('(u)')).owner).toEqual({
      kind: 'markdown-text'
    })
    expect(revision.projection('revised').source).toBe('[x]new(u)')
    expect(childKinds(revision.projection('revised').markdown.root.childAt(0)))
      .toEqual(['text'])
  })

  it('continues guarding when one protection retargets a later reference', () => {
    const revision = open('[{~~q~>[x]~~}[x]\n\n[x]: /x')

    const revised = revision.projection('revised')
    expect(revised.source).toBe('[\\[x\\][x]\n\n[x]: /x')
    expect(revised.provenance.originAt(1)).toEqual({
      kind: 'generated',
      sourcePosition: 7,
      affinity: 'next'
    })
    expect(revised.provenance.originAt(4)).toEqual({
      kind: 'generated',
      sourcePosition: 9,
      affinity: 'next'
    })
    expect(childKinds(revised.markdown.root.childAt(0))).toEqual([
      'text',
      'link'
    ])

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    expect(childKinds(clean.projection('revised').markdown.root.childAt(0)))
      .toEqual(['text', 'link'])
  })

  it('invalidates an enclosing link label when either arm breaks the label', () => {
    const source = '[x{~~old~>\n\nnew~~}](u)'
    const revision = open(source)

    expect(revision.ownership.ownerAt(source.indexOf('(u)')).owner).toEqual({
      kind: 'markdown-text'
    })
  })

  it('does not assemble an image opener across an arm boundary', () => {
    const revision = open('!{~~old~>[x](u)~~}')

    const revised = revision.projection('revised')
    expect(revised.source).toBe('\\![x](u)')
    expect(revised.provenance.originAt(0)).toEqual({
      kind: 'generated',
      sourcePosition: 0,
      affinity: 'next'
    })
    expect(childKinds(revised.markdown.root.childAt(0))).toEqual([
      'text',
      'link'
    ])

    const clean = open(revised.source)
    expect(rootsOf(clean.criticMarkup)).toEqual([])
    expect(clean.projection('revised').source).toBe(revised.source)
    expect(childKinds(clean.projection('revised').markdown.root.childAt(0)))
      .toEqual(['text', 'link'])
  })
})
