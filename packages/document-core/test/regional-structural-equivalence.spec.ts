import { describe, expect, it } from 'vitest'
import {
  createDocumentCore,
  type DocumentCore,
  type DocumentRevision,
  type MarkupEvent,
  type MarkupMark,
  type MarkupProjection,
  type MarkupRegionReplacement,
  type SourceRange
} from '../src/index.js'

// Plan 0012 G35: a regional apply that splits, joins or annotates blocks is an
// optimization of one parse. Its annotations and its projection replacement,
// composed with the previous projection, must read exactly as a fresh open of
// the resulting source, and later regional edits must build on it exactly.

const lcg = (seed: number) => (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

const blocks = [
  'Plain words here.',
  'Another ordinary sentence with more words.',
  'Text with {++added++} inside.',
  'Text {--deleted--} and {~~old~>new~~} too.',
  'Note {==marked==}{>>comment<<} end.',
  '{++Whole paragraph addition.++}',
  '# Heading',
  '- item one\n- item two',
  '> quoted line',
  '```\ncode\n\nmore\n```',
  '    indented code',
  'Para *em* and `code` here.',
  'A [link](http://x.y) here.',
  'Multi\nline\nparagraph.'
]

const insertions = ['x', ' ', '\n', '\n\n', '\n\n\n\n', '{++n++}', '{--d--}', '{++', '++}', '# ', '- ', '    ', '*', '`', '$$', '[r]', '---', '===', '<div>']

function applyReplacement(previous: readonly MarkupEvent[], replacement: MarkupRegionReplacement): readonly MarkupEvent[] {
  const delta = replacement.next.source.end - replacement.previous.source.end
  const shift = (range: SourceRange): SourceRange => range.end <= replacement.previous.source.end
    ? range
    : { start: range.start + delta, end: range.end + delta }
  const marks = new Map<MarkupMark, MarkupMark>()
  const shiftMark = (mark: MarkupMark): MarkupMark => {
    const cached = marks.get(mark)
    if (cached !== undefined) return cached
    const shifted = { ...mark, annotationRange: shift(mark.annotationRange) } as MarkupMark
    marks.set(mark, shifted)
    return shifted
  }
  return [
    ...previous.slice(0, replacement.previous.events.start),
    ...replacement.events,
    ...previous.slice(replacement.previous.events.end).map(event => event.kind === 'text'
      ? { ...event, sourceRange: shift(event.sourceRange) }
      : { ...event, mark: shiftMark(event.mark) })
  ]
}

const blockShape = (projection: MarkupProjection) => projection.syntax.ast.root.children
  .map(node => ({ kind: node.kind, start: node.range.start, end: node.range.end }))

/** The previous view with the replaced region spliced in, as the desktop composes it. */
function composedShape(previous: MarkupProjection, replacement: MarkupRegionReplacement) {
  const delta = replacement.next.syntax.end - replacement.previous.syntax.end
  return [
    ...blockShape(previous).filter(node => node.start < replacement.previous.syntax.start),
    ...replacement.syntaxBlocks.map(node => ({ kind: node.kind, start: node.range.start, end: node.range.end })),
    ...blockShape(previous).filter(node => node.start >= replacement.previous.syntax.end)
      .map(node => ({ ...node, start: node.start + delta, end: node.end + delta }))
  ]
}

interface Session {
  readonly core: DocumentCore
  revision: DocumentRevision
  markup: MarkupProjection
  regional: number
}

function step(session: Session, start: number, end: number, insert: string, label: string): void {
  const { core, revision } = session
  const commit = core.apply(revision, [{ start, end, insert }], { projections: ['markup'] })
  const source = revision.source.slice(0, start) + insert + revision.source.slice(end)
  const oracle = createDocumentCore()
  const fresh = oracle.open(source)
  const freshMarkup = oracle.project(fresh, 'markup')
  expect(commit.revision.source, label).toBe(source)
  expect(commit.revision.annotations, label).toEqual(fresh.annotations)
  expect(commit.revision.diagnostics, label).toEqual(fresh.diagnostics)
  const change = commit.change.projections[0]
  if (change?.name === 'markup' && change.scope === 'regions') {
    session.regional += 1
    const replacement = change.replacements[0]
    if (replacement === undefined) throw new Error('Expected a replacement')
    expect(applyReplacement(session.markup.events, replacement), label).toEqual(freshMarkup.events)
    expect(composedShape(session.markup, replacement), label).toEqual(blockShape(freshMarkup))
  }
  session.revision = commit.revision
  session.markup = freshMarkup
}

function documentFrom(random: () => number): string {
  const count = 3 + Math.floor(random() * 10)
  const parts: string[] = []
  for (let index = 0; index < count; index += 1) {
    parts.push(blocks[Math.floor(random() * blocks.length)] ?? '')
    if (random() < 0.15) parts.push('')
  }
  const separator = random() < 0.1 ? '\r\n' : '\n'
  const text = parts.join('\n\n') + (random() < 0.8 ? '\n' : '')
  return separator === '\n' ? text : text.replace(/\n/gu, '\r\n')
}

describe('structural regional edits read as a fresh open', () => {
  // Seeds past the first 24 are ones a 4,000-seed run once found diverging.
  const regressionSeeds = [1012, 1063, 1107, 1139, 1152, 1225, 1261, 1274, 1296]
  it.each([...Array.from({ length: 24 }, (_, seed) => seed + 1), ...regressionSeeds])('seed %i', seed => {
    const random = lcg(seed * 7919)
    for (let documentIndex = 0; documentIndex < 20; documentIndex += 1) {
      const source = documentFrom(random)
      const core = createDocumentCore()
      const revision = core.open(source)
      const session: Session = { core, revision, markup: core.project(revision, 'markup'), regional: 0 }
      for (let edit = 0; edit < 8; edit += 1) {
        const length = session.revision.sourceLength
        const start = Math.floor(random() * (length + 1))
        const choice = random()
        let end = start
        let insert = ''
        if (choice < 0.55) {
          insert = insertions[Math.floor(random() * insertions.length)] ?? ''
        } else if (choice < 0.85) {
          end = Math.min(length, start + 1 + Math.floor(random() * 4))
        } else {
          end = Math.min(length, start + 1 + Math.floor(random() * 12))
          insert = random() < 0.5 ? 'Z' : '\n\n'
        }
        const label = `${JSON.stringify(session.revision.source)} [${start}, ${end}) ${JSON.stringify(insert)}`
        step(session, start, end, insert, label)
      }
    }
  })

  it('exercises regional splits, joins and new suggestions', () => {
    const paragraph = 'Plain words here.'
    const marked = [paragraph, 'A {++b++} c.', paragraph, 'D {--e--} f.', paragraph, paragraph, paragraph].join('\n\n') + '\n'
    const core = createDocumentCore()
    const revision = core.open(marked)
    const session: Session = { core, revision, markup: core.project(revision, 'markup'), regional: 0 }
    const tail = marked.lastIndexOf(paragraph) + 5
    step(session, tail, tail, '\n\n', 'split in the plain tail')
    step(session, tail, tail + 2, '', 'join in the plain tail')
    step(session, 5, 5, '\n\n', 'split before the first suggestion')
    step(session, 5, 7, '', 'join before the first suggestion')
    // Marker spelling reads against the whole document, so a new suggestion
    // stays regional only in a document spelling no other markers.
    step(session, tail, tail, '{++new++}', 'suggestion beside others')
    expect(session.regional).toBe(4)

    const plainCore = createDocumentCore()
    const plainSource = Array.from({ length: 6 }, () => paragraph).join('\n\n') + '\n'
    const plainRevision = plainCore.open(plainSource)
    const plain: Session = { core: plainCore, revision: plainRevision, markup: plainCore.project(plainRevision, 'markup'), regional: 0 }
    const middle = 3 * (paragraph.length + 2) + 5
    step(plain, middle, middle, '{++new++}', 'first suggestion')
    step(plain, middle + 3, middle + 3, '\n\n', 'split inside the suggestion')
    step(plain, middle + 3, middle + 5, '', 'join inside the suggestion')
    expect(plain.regional).toBe(3)
  })

  it.each([
    ['$$\n\n{--d--}\n', 7, 7, '$$'],
    ['$$\n\n{++.++} ', 11, 11, '$$'],
    ['$$\n{++++}\n\ne', 11, 11, '$$'],
    ['$$\n\nt', 4, 4, '$$'],
    ['$$\n\na\n\nb $$ {++c++}\n', 11, 13, ''],
    ['x$$\n\na\n\nb $$ {++c++}\n', 0, 1, '']
  ] as const)('re-pairs a $$ math block far from the edit in %j', (source, start, end, insert) => {
    // A `$$` alone on its line closes at the next `$$` anywhere later, so an
    // edit to a `$` can change a math block outside every reparsed window.
    const core = createDocumentCore()
    const revision = core.open(source)
    const session: Session = { core, revision, markup: core.project(revision, 'markup'), regional: 0 }
    step(session, start, end, insert, `${JSON.stringify(source)} [${start}, ${end}) ${JSON.stringify(insert)}`)
  })

  const replay = (source: string, edits: ReadonlyArray<readonly [number, number, string]>): void => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const session: Session = { core, revision, markup: core.project(revision, 'markup'), regional: 0 }
    for (const [start, end, insert] of edits) {
      step(session, start, end, insert, `${JSON.stringify(session.revision.source)} [${start}, ${end}) ${JSON.stringify(insert)}`)
    }
  }

  it.each([
    ['a\n\n=', 3, 3, '\n'],
    ['\n\n=', 2, 2, '\n'],
    ['a\n\nb\n', 3, 4, '']
  ] as const)('gives a blank line at a region start to the block before in %j', (source, start, end, insert) => {
    // The previous block's event owns the blank lines after it, so a region
    // may not begin with one.
    replay(source, [[start, end, insert]])
  })

  it('splices the unterminated last line out of the reused prefix', () => {
    // The finish that completed the old last line consumed nothing, so the
    // splice kept it with the prefix and lost the new block start.
    replay('Another ordinary sentence with more words.\n\nText {--deleted--} and {~~old~>new~~} too.\n\nPara *em* and `code` here.',
      [[102, 108, '\n\n'], [97, 97, '===']])
  })

  it('moves a plain block start that follows an edit inside the reparsed blocks', () => {
    // Deleting across a block start inside the window moved the next block's
    // start, but the plain index kept its old coordinate and a later edit
    // read past the end of the source.
    replay('Text with {++added++} inside.\n\nPlain words here.\n\nMulti\nline\nparagraph.',
      [[28, 39, '\n\n'], [10, 10, '# '], [57, 58, '\n\n'], [48, 59, '\n\n'], [50, 54, '']])
  })

  it('starts a region after a run of blank lines, not inside it', () => {
    // Which lines of a blank run read as empty paragraphs depends on the whole
    // run, so a region starting inside it misplaced the suggestion's first line.
    const source = 'a\n\n\n\n{++\n\nparagraph.++}\n'
    const core = createDocumentCore()
    const revision = core.open(source)
    const session: Session = { core, revision, markup: core.project(revision, 'markup'), regional: 0 }
    step(session, 14, 15, '', 'delete inside a suggestion after a blank run')
    expect(session.regional).toBe(1)
  })
})
