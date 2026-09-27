import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentRevision, type DocumentSourceEdit } from '../src/index.js'
import { projectionSignature } from '../src/trackedExtent.js'

// Incremental reuse is an optimization of one parse: applying an edit must
// read exactly as opening the resulting source does.

const documents = [
  'a\n\nb\n\nc\n',
  'a\nb\n\nc\n',
  'a\n\nb\nc\n\nd\n',
  'a\n\nb\n\n    c\n',
  'a\n\n    code\n\nb\n',
  'p\n\n```\ncode\n```\n\nq\n',
  'x\n\n<div>\nh\n</div>\n\ny\n',
  '- a\n\n  b\n\n- c\n',
  '1. a\n\n   b\n\n2. c\n',
  '> a\n>\n> b\n\nc\n',
  'a {++x++}\n\nb {--y--}\n\nc\n',
  'a\n\n{++b++}\n\nc\n',
  'a\n\nb {~~c~>d~~}\n\ne\n',
  'a\n\nb\n\n$$\nx\n$$\n\nc\n',
  '>- a\n>\n> b\n\nc\n',
  '> a\n>\n>- b\n>\n> c\n\nd\n',
  '{++a++}\n\n</div>\n>\n    code\n'
]

const insertions = ['    ', '  ', '\t', '```\n', '```', '~~~', '$$\n', '$$', '<div>', '<!--', '===\n', '---\n', '- ', '1. ', '> ', '# ', '\n', '\n\n']

/** Line starts and positions just after a container prefix character. */
function blockStarts(source: string): number[] {
  const starts = new Set<number>([0])
  for (let index = 0; index < source.length; index += 1) {
    const atLineStart = index === 0 || source[index - 1] === '\n'
    if (source[index] === '\n') starts.add(index + 1)
    if ((source[index] === ' ' || source[index] === '>') && (atLineStart || source[index - 1] === ' ' || source[index - 1] === '>')) {
      starts.add(index + 1)
    }
  }
  return [...starts].filter(start => start <= source.length).sort((left, right) => left - right)
}

function reading(core: ReturnType<typeof createDocumentCore>, revision: DocumentRevision): unknown {
  return {
    source: revision.source,
    syntax: projectionSignature(core.project(revision, 'markup').syntax.ast.root),
    revised: core.project(revision, 'revised').markdown,
    original: core.project(revision, 'original').markdown,
    annotations: revision.annotations.map(annotation => [annotation.kind, annotation.range.start, annotation.range.end]),
    diagnostics: revision.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.range.start, diagnostic.range.end])
  }
}

const cases = documents.flatMap(source => blockStarts(source).flatMap(start => [
  ...insertions.map(insert => ({ start, end: start, insert })),
  ...[1, 2, 4].filter(length => start + length <= source.length).map(length => ({ start, end: start + length, insert: '' }))
].map(edit => ({ source, edit, label: `${JSON.stringify(source)} ${JSON.stringify(edit)}` }))))

describe('incremental apply reads as a fresh open', () => {
  it.each(cases)('$label', ({ source, edit }: { source: string, edit: DocumentSourceEdit }) => {
    const core = createDocumentCore()
    const previous = core.open(source)
    reading(core, previous)
    const next = core.apply(previous, [edit]).revision
    const fresh = createDocumentCore()
    expect(reading(core, next)).toEqual(reading(fresh, fresh.open(next.source)))

    // A later edit reuses what this one retained.
    const end = next.source.length
    const later = core.apply(next, [{ start: end, end, insert: '\n\nz\n' }]).revision
    const laterFresh = createDocumentCore()
    expect(reading(core, later)).toEqual(reading(laterFresh, laterFresh.open(later.source)))
  })
})

describe('code spans and inline math end with their paragraph', () => {
  const blocks = (source: string): string[] => {
    const core = createDocumentCore()
    return core.project(core.open(source), 'markup').syntax.ast.root.children.map(node => node.kind)
  }

  it.each([
    ['a$$\n\n$$\nx\n$$\n', ['paragraph', 'math-block']],
    ['$$a\n\nb\n\n$$\nx\n$$\n', ['paragraph', 'paragraph', 'math-block']],
    ['# ```\ncode\n\n```\nx\n```\n', ['heading', 'paragraph', 'code-block']],
    ['# ```\ncode\n```\nx\n```\n', ['heading', 'paragraph', 'code-block']],
    ['a `b\n\n```\nx\n```\n', ['paragraph', 'code-block']],
    ['$$\nb\n\n$$\n', ['math-block']]
  ])('%j', (source, kinds) => {
    expect(blocks(source)).toEqual(kinds)
  })

  it('does not pair a backtick with a run after a blank line', () => {
    // A later paragraph's backtick run cannot close a code span, so the
    // suggestion between them stays a suggestion.
    const core = createDocumentCore()
    const revision = core.open('T`ext {++a++} x.\n\nb `c` d.\n')
    expect(revision.annotations.map(annotation => [annotation.kind, annotation.range.start, annotation.range.end]))
      .toEqual([['addition', 6, 13]])
  })
})

describe('an inline literal that its paragraph never closes owns no markers', () => {
  // A closing run on a later line counts only while every line up to it
  // continues the opener's paragraph; otherwise the suggestion stays active.
  const annotationsOf = (source: string): unknown => createDocumentCore().open(source).annotations
    .map(annotation => [annotation.kind, annotation.range.start, annotation.range.end])

  it.each([
    ['a $$ b {++x++}\n\nc $$ d\n', [['addition', 7, 14]]],
    ['a $b {++x++}\n\nc$ d\n', [['addition', 5, 12]]],
    ['{++ad$$ded++}\n\nx $$ y\n', [['addition', 0, 13]]],
    ['a ` b {++x++}\n# c`d\n', [['addition', 6, 13]]],
    ['# a ` b {++x++}\nc`d\n', [['addition', 8, 15]]],
    ['a ` b {++x++}\n===\nc`d\n', [['addition', 6, 13]]],
    ['a ` b {++x++}\n<div>\nc`d\n', [['addition', 6, 13]]],
    ['a ` b {++x++}\n```\nc`d\n```\n', [['addition', 6, 13]]],
    ['- a ` b {++x++}\n- c`d\n', [['addition', 8, 15]]],
    ['a $b {++x++}\n> c$ d\n', [['addition', 5, 12]]]
  ])('%j', (source, expected) => {
    expect(annotationsOf(source)).toEqual(expected)
  })

  it.each([
    'a ` b {++x++}\nc`d\n',
    '> a ` b {++x++}\nc`d\n',
    'a $$ b {++x++}\nc $$ d\n',
    '$$\nb {++x++}\n\nc $$ d\n'
  ])('%j keeps the span that closes in its paragraph', source => {
    expect(annotationsOf(source)).toEqual([])
  })

  it('reads the same after a regional edit adds the closing run', () => {
    const source = 'Text with {++added++} inside.\n\nPlain words.\n\nText {++x++} and $$ here.\n'
    const core = createDocumentCore()
    const previous = core.open(source)
    core.project(previous, 'markup')
    const next = core.apply(previous, [{ start: 15, end: 15, insert: '$$' }], { projections: ['markup'] }).revision
    const fresh = createDocumentCore()
    expect(reading(core, next)).toEqual(reading(fresh, fresh.open(next.source)))
    expect(next.annotations.map(annotation => annotation.kind)).toEqual(['addition', 'addition'])
  })
})

it('keeps editable blank paragraphs when Markup escapes generated text', () => {
  // A paragraph that reads `+}` after its suggestion is spelled with a
  // generated escape; the Markup view read its blocks from the Revised parse,
  // which has no editable blank paragraphs, while a regional reparse had them.
  const core = createDocumentCore()
  const blocks = core.project(core.open(' {+++++}+}\n\nt\n\n\n\n'), 'markup').syntax.ast.root.children
  expect(blocks.map(node => [node.kind, node.range.start, node.range.end]))
    .toEqual([['paragraph', 0, 5], ['paragraph', 7, 8], ['paragraph', 10, 10]])
})

it('splices a nested suggestion after a paragraph edit', () => {
  // Arm lanes of nested suggestions number depth first; the splice listed
  // them breadth first and rejected its own fork graph.
  const source = 'wo\n\nAn\n\n{~~{++++}~>~~}i'
  const core = createDocumentCore()
  const next = core.apply(core.open(source), [{ start: 0, end: 6, insert: '\n\n' }]).revision
  const fresh = createDocumentCore()
  expect(reading(core, next)).toEqual(reading(fresh, fresh.open(next.source)))
})
