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
