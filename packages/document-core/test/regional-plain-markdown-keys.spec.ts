import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'
import { inspectDocumentCore, planFromDocumentParse } from '../src/internal/documentCoreInspection.js'

// Plan 0012 G35: ordinary Markdown edits as fast as it does without
// suggestions. In a long document mixing every block kind, links, code
// spans, math and a reference definition, typing, Backspace, Delete and
// Enter in each kind of block take no document parse, tracked or not, and
// read as a core planning from its document parse reads them. A suggestion
// written around a code or HTML block changes the block's projection, which
// no region holds, so it costs the one parse apply() publishes.

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
type Key = 'insertText' | 'insertParagraph' | 'deleteContentBackward' | 'deleteContentForward'
const keys: readonly Key[] = ['insertText', 'deleteContentBackward', 'deleteContentForward', 'insertParagraph']

const action = (caret: number, inputType: Key): DocumentInputAction => ({
  range: inputType === 'deleteContentBackward'
    ? { start: caret - 1, end: caret }
    : inputType === 'deleteContentForward' ? { start: caret, end: caret + 1 } : { start: caret, end: caret },
  selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
  inputType,
  data: inputType === 'insertText' ? 'x' : null,
  options
}) as DocumentInputAction

function press(core: DocumentCore, revision: DocumentRevision, caret: number, key: Key, tracked: boolean): unknown {
  const input = action(caret, key)
  const plan = core.planInput(revision, input, { tracked })
  const edits = core.inputEdits(revision, input, plan, tracked)
  if (edits === undefined) return { plan }
  const commit = core.apply(revision, edits, { projections: ['markup'] })
  const selection = core.reconcileInput(revision, plan, commit, input).selection
  return { plan, edits, selection, source: commit.revision.source, annotations: commit.revision.annotations }
}

/** A revision reached by a regional edit, so it holds no document parse. */
function regional(core: DocumentCore, source: string): DocumentRevision {
  return core.apply(core.open(source), [{ start: 1, end: 1, insert: 'q' }], { projections: ['markup'] }).revision
}

const shapes: ReadonlyArray<Readonly<{ name: string, block: string, text: string, offset: number, trackedParse?: number }>> = [
  { name: 'paragraph', block: 'Writing a useful document takes careful editing.', text: 'careful', offset: 3 },
  { name: 'ATX heading', block: '## Section heading for the chapter', text: 'heading', offset: 3 },
  { name: 'setext heading', block: 'Setext heading title\n---', text: 'heading', offset: 3 },
  { name: 'link', block: 'See [the guide](http://example.com/guide) for the details.', text: 'details', offset: 3 },
  { name: 'unresolved label', block: 'Read [the notes] before you start.', text: 'before', offset: 3 },
  { name: 'code span', block: 'Call `render()` once and cache its result.', text: 'cache', offset: 2 },
  { name: 'math', block: 'The area $a^2 + b^2$ grows with each side.', text: 'grows', offset: 2 },
  { name: 'bullet list', block: '- first item of the list\n- second item here', text: 'second', offset: 3 },
  { name: 'ordered list', block: '1. first step\n2. second step to take', text: 'second', offset: 3 },
  { name: 'quote', block: '> A quoted remark that spans\n> two lines of text.', text: 'remark', offset: 3 },
  { name: 'table', block: '| Name | Value |\n| --- | --- |\n| alpha | one |', text: 'alpha', offset: 2 },
  { name: 'fenced code', block: '```js\nconst total = values.reduce(add, 0)\n```', text: 'total', offset: 2, trackedParse: 1 },
  { name: 'indented code', block: '    const total = values.reduce(add, 0)', text: 'total', offset: 2, trackedParse: 1 },
  { name: 'HTML block', block: '<div>\nsome html text here\n</div>', text: 'html', offset: 2, trackedParse: 1 },
  { name: 'emphasis', block: 'Some *emphasised words* and **strong words** here.', text: 'emphasised', offset: 3 }
]
const filler = shapes.map(shape => shape.block)

describe('ordinary Markdown keys in a long document', () => {
  it.each(shapes)('$name', ({ block, text, offset, trackedParse }) => {
    const paragraphs = ['Warm editing paragraph.', ...Array.from({ length: 300 }, (_, index) => filler[index % filler.length] ?? ''),
      '[other]: http://example.com/other']
    paragraphs[150] = `${block}\n\nThe marked block above.`
    const source = paragraphs.join('\n\n') + '\n'
    for (const tracked of [false, true]) {
      for (const key of keys) {
        const core = createDocumentCore()
        const revision = regional(core, source)
        const caret = revision.source.indexOf(`${block}\n\nThe marked`) + block.indexOf(text) + offset
        const before = inspectDocumentCore(core).documentParses
        const outcome = press(core, revision, caret, key, tracked)
        const label = `${key} tracked=${String(tracked)}`
        expect(inspectDocumentCore(core).documentParses - before, label).toBeLessThanOrEqual(tracked ? trackedParse ?? 0 : 0)
        const control = createDocumentCore()
        planFromDocumentParse(control)
        expect(outcome, label).toEqual(press(control, regional(control, source), caret, key, tracked))
      }
    }
  }, 120_000)
})

describe('document parses after regional block edits', () => {
  const shape = (core: DocumentCore, revision: DocumentRevision) => core.project(revision, 'markup').syntax.ast.root.children
    .map(child => `${child.kind}:${child.range.start}-${child.range.end}`)

  it('reads a table a regional edit made a paragraph as a paragraph after a later document parse', () => {
    const source = '| a | b |\n| --- | --- |\n| c | d |\n\nSome *emphasis* and **strong** words.x\n``js\nconst total = 1\n\n\n\n\n```\n'
    const core = createDocumentCore()
    let revision = core.open(source)
    for (const [start, end, insert] of [[9, 10, '$'], [94, 94, '\n']] as const) {
      revision = core.apply(revision, [{ start, end, insert }], { projections: ['markup'] }).revision
      const fresh = createDocumentCore()
      expect(shape(core, revision)).toEqual(shape(fresh, fresh.open(revision.source)))
    }
  })

  it('reads front matter an edit leaves unclosed to the next closing line', () => {
    const source = '---\n\n---\n\n\n\n    indented code[\n\n{++Whole paragraph addition.++}\n\n---\n\nCall `render()` once.\n\n---'
    const core = createDocumentCore()
    const revision = core.apply(core.open(source), [{ start: 6, end: 6, insert: '> ' }], { projections: ['markup'] }).revision
    const fresh = createDocumentCore().open(revision.source)
    expect(revision.annotations).toEqual(fresh.annotations)
  })
})

describe('the first suggestion in a document with an unfinished opener', () => {
  it('costs the one parse apply() publishes', () => {
    const source = 'Unfinished {== opener.\n\n' + Array.from({ length: 300 }, () => 'Plain words of a paragraph here.').join('\n\n') + '\n'
    const core = createDocumentCore()
    const revision = regional(core, source)
    const caret = Math.floor(revision.source.length / 2) + 3
    const before = inspectDocumentCore(core).documentParses
    const outcome = press(core, revision, caret, 'insertText', true)
    expect(inspectDocumentCore(core).documentParses - before).toBe(1)
    const control = createDocumentCore()
    planFromDocumentParse(control)
    expect(outcome).toEqual(press(control, regional(control, source), caret, 'insertText', true))
  })
})

describe('keys inside a label a definition resolves', () => {
  // Code and math spans bind before links, so a window reading the label as
  // text plans the key as the document does.
  it.each([
    ['plain label', 'Read [the notes] before you start.', 'notes'],
    ['label with a code span', 'Read [the `x` notes] before `you` start.', 'notes'],
    ['label with math', 'Read [the $a notes] before $b start.', 'notes'],
    ['label with an unclosed backtick', 'Read [the `notes] before you` start.', 'notes']
  ])('%s', (_name, block, text) => {
    const label = block.slice(block.indexOf('[') + 1, block.indexOf(']'))
    const paragraphs = ['Warm editing paragraph.', ...Array.from({ length: 200 }, () => 'Plain words of a paragraph here.'),
      `[${label}]: http://example.com/notes`]
    paragraphs[100] = block
    const source = paragraphs.join('\n\n') + '\n'
    for (const tracked of [false, true]) {
      for (const key of keys) {
        const core = createDocumentCore()
        const revision = regional(core, source)
        const caret = revision.source.indexOf(block) + block.indexOf(text) + 2
        const before = inspectDocumentCore(core).documentParses
        const outcome = press(core, revision, caret, key, tracked)
        const name = `${key} tracked=${String(tracked)}`
        expect(inspectDocumentCore(core).documentParses - before, name).toBeLessThanOrEqual(1)
        const control = createDocumentCore()
        planFromDocumentParse(control)
        expect(outcome, name).toEqual(press(control, regional(control, source), caret, key, tracked))
      }
    }
  }, 120_000)
})

describe('a key that changes nothing', () => {
  it('reconciles Backspace at the start of an HTML block without a document parse', () => {
    const block = '<div>\nhtml text block\n</div>'
    const paragraphs = ['Warm editing paragraph.', ...Array.from({ length: 200 }, () => 'Plain words of a paragraph here.')]
    paragraphs[100] = block
    const source = paragraphs.join('\n\n') + '\n'
    const core = createDocumentCore()
    const revision = regional(core, source)
    const caret = revision.source.indexOf(block)
    const before = inspectDocumentCore(core).documentParses
    const outcome = press(core, revision, caret, 'deleteContentBackward', false)
    expect(inspectDocumentCore(core).documentParses - before).toBe(0)
    const control = createDocumentCore()
    planFromDocumentParse(control)
    expect(outcome).toEqual(press(control, regional(control, source), caret, 'deleteContentBackward', false))
  })
})
