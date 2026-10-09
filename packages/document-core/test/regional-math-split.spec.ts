import { beforeAll, describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentRevision, type DocumentSourceEdit } from '../src/index.js'
import { inspectDocumentCore, planFromGeneralCompile } from '../src/internal/documentCoreInspection.js'

// A blank line typed with Track Changes into a long document's `$$` block
// suggests the block again with the blank line in it. The proposed block's
// `$$` lines follow the divider, so the blank line leaves them unpaired in
// the intrinsic parse, as in the document (G45). Where no `$$` they could
// pair with lies beyond the blocks around the key, those blocks read the key
// as the document does, without parsing the document; where one does, the
// window reads on to it, within a bound past which the document is parsed.

const paragraph = 'Review {++new evidence++} alongside {--obsolete details--}, and {==a claim==}{>>Check this source.<<}.'
const math = '$$\n' + Array.from({ length: 5 }, (_, index) => `x_{${index}} + y`).join('\n') + '\n$$'

// 240 blocks, 25 KB: the windows read a few blocks of it, and a `$$` 100
// blocks after the key lies 10 KB past them.
const documentOf = (mathAt: readonly number[], length = 240): string => {
  const blocks = Array.from({ length }, () => paragraph)
  for (const at of mathAt) blocks[at] = math
  return blocks.join('\n\n') + '\n'
}

const generalPlan = (source: string, edit: DocumentSourceEdit): DocumentSourceEdit | undefined => {
  const control = createDocumentCore()
  planFromGeneralCompile(control)
  return control.trackedEdit(control.open(source), edit)
}

/** The key's plan and the document parses it and its apply cost, after one regional edit. */
const typeBlankLine = (source: string, term: string, last = false) => {
  const core = createDocumentCore()
  const revision = core.apply(core.open(source), [{ start: 0, end: 0, insert: 'q' }], { projections: ['markup'] }).revision
  const at = last ? revision.source.lastIndexOf(term) : revision.source.indexOf(term)
  const edit = { start: at, end: at, insert: '\n\n' }
  const before = inspectDocumentCore(core).documentParses
  const planned = core.trackedEdit(revision, edit)
  const planParses = inspectDocumentCore(core).documentParses - before
  if (planned === undefined) throw new Error('the key was refused')
  const applied: DocumentRevision = core.apply(revision, [planned], { projections: ['markup'] }).revision
  const applyParses = inspectDocumentCore(core).documentParses - before - planParses
  const fresh = createDocumentCore().open(applied.source)
  return { core, revision, edit, planned, planParses, applied, applyParses, fresh }
}

describe('a blank line typed into a long document\'s math block (G45)', () => {
  let typed: ReturnType<typeof typeBlankLine>
  beforeAll(() => {
    typed = typeBlankLine(documentOf([100]), 'x_{2}')
  })

  it('is planned and applied without parsing the document', () => {
    const { revision, edit, planned, planParses, applied, applyParses, fresh } = typed
    expect(planned.insert).toMatch(/^\{~~\$\$\n[^]*\n\$\$~>\$\$\n[^]*x_\{1\} \+ y\n\n\nx_\{2\}[^]*\n\$\$~~\}$/u)
    expect(planned).toEqual(generalPlan(revision.source, edit))
    expect(planParses).toBe(0)
    expect(applyParses).toBe(0)
    expect(applied.annotations).toEqual(fresh.annotations)
    expect(applied.diagnostics).toEqual(fresh.diagnostics)
  })

  it('reads the next key in the proposed block without parsing the document', () => {
    const { core, applied } = typed
    const at = applied.source.lastIndexOf('x_{3}')
    const edit = { start: at, end: at, insert: 'z' }
    const before = inspectDocumentCore(core).documentParses
    expect(core.trackedEdit(applied, edit)).toEqual(generalPlan(applied.source, edit))
    expect(inspectDocumentCore(core).documentParses).toBe(before)
  })

  it('reads past a math block before the key', () => {
    const { revision, edit, planned, planParses, applyParses } = typeBlankLine(documentOf([40, 100]), 'x_{2}', true)
    expect(planned).toEqual(generalPlan(revision.source, edit))
    expect(planParses + applyParses).toBe(0)
  })

  it('reads on to a math block shortly after the key', () => {
    const source = documentOf([100, 120])
    const { revision, edit, planned, planParses, applied, applyParses, fresh } = typeBlankLine(source, 'x_{2}')
    expect(planned).toEqual(generalPlan(revision.source, edit))
    expect(planParses + applyParses).toBe(0)
    expect(applied.annotations).toEqual(fresh.annotations)
  })

  // The proposed block's `$$` lines hold markers, so they pair within their
  // paragraphs however near the next `$$` is.
  it('reads past a math block far after the key', () => {
    const { revision, edit, planned, planParses, applied, applyParses, fresh } = typeBlankLine(documentOf([100, 200]), 'x_{2}')
    expect(planned).toEqual(generalPlan(revision.source, edit))
    expect(planParses + applyParses).toBe(0)
    expect(applied.annotations).toEqual(fresh.annotations)
  })
})

describe('a `$$` a window leaves unpaired reads as in the document', () => {
  // Each key leaves a `$$` line open in its blocks, before, beside or far
  // from a `$$` the document pairs it with.
  it.each([
    ['a blank line in a proposed block before a closed block', `Intro.\n\n{~~$$\nx\ny\n$$~>$$\nx\ny\n$$~~}\n\nText.\n\n${math}\n\nEnd.\n`, 'x\ny\n$$~~}', 1],
    ['a blank line in a proposed block before a $$ line', 'Intro.\n\n{~~$$\nx\ny\n$$~>$$\nx\ny\n$$~~}\n\nText.\n\n$$\n\nEnd.\n', 'x\ny\n$$~~}', 1],
    ['a blank line in a draft block before a closed block', `Intro.\n\n{~~a~>$$\nx\ny\n$$\n~~}\n\nText.\n\n${math}\n\nEnd.\n`, 'x\ny\n$$\n~~}', 1],
    ['a blank line in a plain block before a closed block', `Intro.\n\n${math}\n\nText.\n\n${math}\n\nEnd.\n`, 'x_{2}', 0],
    ['a blank line in a plain block after a $$ line', `Intro.\n\n$$\n\nText.\n\n${math}\n\nEnd.\n`, 'x_{2}', 0]
  ])('%s', (_name, source, anchor, offset) => {
    const at = source.indexOf(anchor) + offset
    const edit = { start: at, end: at, insert: '\n\n' }
    const core = createDocumentCore()
    expect(core.trackedEdit(core.open(source), edit)).toEqual(generalPlan(source, edit))
    const applied = createDocumentCore()
    const revision = applied.apply(applied.open(source), [edit], { projections: ['markup'] }).revision
    const fresh = createDocumentCore().open(revision.source)
    expect(revision.annotations).toEqual(fresh.annotations)
    expect(revision.diagnostics).toEqual(fresh.diagnostics)
  })
})

// A blank line typed before a `$$` that continued a paragraph makes it a
// line opening display math, which pairs with the first `$$` after it:
// here the opener of a closed block far down the document, which it takes
// in with every paragraph between. That block pairing with itself before
// the key does not keep it from pairing so after.
describe('a `$$` line a key opens reads on to the first `$$` after it', () => {
  const paragraphs = (count: number): string =>
    Array.from({ length: count }, (_, index) => `Plain paragraph number ${index} with some ordinary words in it.`).join('\n\n')
  // 150 paragraphs put the far block 9 KB past the key.
  it.each([[20, 0], [120, 0], [150, 0], [150, 300]])('past %i paragraphs, %i more after', (count, more) => {
    const source = `Intro {++a++}.\n\nx\n$$\n\n${paragraphs(count)}\n\n$$\nz\n$$\n\nEnd.\n` + (more === 0 ? '' : `\n${paragraphs(more)}\n`)
    const core = createDocumentCore()
    const revision = core.apply(core.open(source), [{ start: 0, end: 0, insert: 'q' }], { projections: ['markup'] }).revision
    const at = revision.source.indexOf('x\n$$') + 1
    const edit = { start: at, end: at, insert: '\n\n' }
    expect(core.trackedEdit(revision, edit)).toEqual(generalPlan(revision.source, edit))
    const parses = inspectDocumentCore(core).documentParses
    const applied = core.apply(revision, [edit], { projections: ['markup'] }).revision
    // The blocks from the key to the far block are read without the
    // document where they are its smaller part. (The tracked key's
    // suggestion leaves its `$$` line open past the window it is spelled in,
    // so the document spells it.)
    if (more !== 0) expect(inspectDocumentCore(core).documentParses).toBe(parses)
    const fresh = createDocumentCore()
    const opened = fresh.open(applied.source)
    const blocks = (target: typeof core, at: DocumentRevision) =>
      target.project(at, 'markup').syntax.ast.root.children.map(block => [block.kind, block.range.start, block.range.end])
    expect(blocks(core, applied)).toEqual(blocks(fresh, opened))
    expect(blocks(fresh, opened).filter(([kind]) => kind === 'math-block')).toHaveLength(1)
    expect(applied.annotations).toEqual(opened.annotations)
    expect(applied.diagnostics).toEqual(opened.diagnostics)
  })
})

// A line holding only a suggestion's closer is text to the intrinsic pass,
// so a paragraph reads on through it into a math block after it, whose `$$`
// then pairs with one in the paragraph: the window reads the block too (B16).
describe('a key that joins a paragraph to the math block after it', () => {
  it('reads the joined block as the document does', () => {
    const paragraph = 'Review {++new++} and {--old--} text.'
    const blocks = Array.from({ length: 40 }, () => paragraph)
    const head = 'costs $$5 and $3\n'
    const source = `${blocks.slice(0, 20).join('\n\n')}\n\n${head}\n$$\nx_0 + y\nx_1\n$$\n\n${blocks.slice(20).join('\n\n')}\n`
    const core = createDocumentCore()
    const revision = core.apply(core.open(source), [{ start: 0, end: 0, insert: 'q' }], { projections: ['markup'] }).revision
    const at = revision.source.indexOf(head) + head.length
    const applied = core.apply(revision, [{ start: at, end: at, insert: '{++x\n++}' }], { projections: ['markup'] }).revision
    const fresh = createDocumentCore().open(applied.source)
    expect(applied.annotations).toEqual(fresh.annotations)
    expect(applied.diagnostics).toEqual(fresh.diagnostics)
  })
})

// Where the `$$` line a key opens takes whole suggestions into its math, as
// in a document dense with them, those suggestions read as text and every
// other marker pairs as before, so the blocks to the far `$$` are read
// without the document (B3b). One it takes only part of is the document's.
describe('a `$$` line a key opens over whole suggestions', () => {
  const dense = (count: number): string =>
    Array.from({ length: count }, () => 'Review {++new evidence++} alongside {--obsolete details--}, and {==a claim==}{>>Check this source.<<}.').join('\n\n')
  it.each([
    ['past whole suggestions', `${dense(10)}\n\nx\n$$\n\n${dense(20)}\n\n$$\nz\n$$\n\n${dense(80)}\n`, true],
    ['into a suggestion it takes only part of', `${dense(10)}\n\nx\n$$\n\n${dense(20)}\n\n{++a\n\n$$\nz\n$$\n\nb++}\n\n${dense(80)}\n`, false]
  ] as const)('%s', (_name, source, regional) => {
    const core = createDocumentCore()
    const revision = core.apply(core.open(source), [{ start: 0, end: 0, insert: 'q' }], { projections: ['markup'] }).revision
    const at = revision.source.indexOf('x\n$$') + 1
    const parses = inspectDocumentCore(core).documentParses
    const applied = core.apply(revision, [{ start: at, end: at, insert: '\n\n' }], { projections: ['markup'] }).revision
    if (regional) expect(inspectDocumentCore(core).documentParses).toBe(parses)
    const fresh = createDocumentCore()
    const opened = fresh.open(applied.source)
    expect(applied.annotations).toEqual(opened.annotations)
    expect(applied.diagnostics).toEqual(opened.diagnostics)
    expect(fresh.project(opened, 'markup').syntax.ast.root.children.map(block => block.kind))
      .toEqual(core.project(applied, 'markup').syntax.ast.root.children.map(block => block.kind))
  })
})

// A key that touches a dollar or backtick run reads as it would with no
// `$$` before its window when every `$$` before the window closes a math
// block before it: no `$$` line left open there can take one the key moves
// (B19). Without that, each window the key tries leaves it to the document.
describe('a dollar key after closed math blocks', () => {
  it.each([
    ['a dollar after a closed block', 0, '$'],
    ['a backtick before inline math', 1, '`']
  ])('%s parses the document at most once', (_name, variant, insert) => {
    const blocks = Array.from({ length: 240 }, (_, index) => index % 40 === 5 ? math : paragraph)
    blocks[200] = variant === 0 ? 'Costs $5 and more words.' : 'Inline $a+b$ and `code` here.'
    const source = blocks.join('\n\n') + '\n'
    const at = source.lastIndexOf(variant === 0 ? 'Costs $5' : 'Inline $a') + (variant === 0 ? 6 : 0)
    const edit = { start: at, end: at, insert }
    const core = createDocumentCore()
    const opened = core.open(source)
    const before = inspectDocumentCore(core).documentParses
    const planned = core.trackedEdit(opened, edit)
    expect(inspectDocumentCore(core).documentParses - before).toBeLessThanOrEqual(1)
    expect(planned).toEqual(generalPlan(source, edit))
  })
})
