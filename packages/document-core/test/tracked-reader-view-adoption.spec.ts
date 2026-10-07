import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentRevision, type MarkdownAstNode } from '../src/index.js'

// A backtick typed on the empty line after a table pairs with one far below
// it, so no window can spell the key and the document compile searches it.
const source = '$$\nx + y\n$$\n\n| a | b |\n| - | - |\n| 1 | {++2++} |\n\n{=={--gone--}==}{>>only deleted<<} tail.\n\n{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n```\n~~}\n\n<div>\nhtml 0\n</div>\n\n    indented 0\n    indented 1\n\n$$\nx + y\n$$\n\nLine one {++x++}\nline two {--y--}.\n\nPara with `one` and `two` code spans {++here++}.\n\n| a | b |\n| - | - |\n| 1 | {++2++} |\n\n1. first `x` one\n2. second {++y++}\n3. third\n\n# Heading {++added++}\n\n# Heading {++added++}\n\nInline $a+b$ and `code` with [link](http://x.y) and *em*.\n\n```js\nconst a = 0\nconst b = 1\n```\n\nReview {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.\n\n- item `code a` words\n- item {++added++} text\n- item `code b` more\n- item {--gone--} more\n\n| a | b |\n| - | - |\n| 1 | {++2++} |\n\n$$\nx + y\n$$\n\n- item `code a` words\n- item {++added++} text\n- item `code b` more\n- item {--gone--} more\n\nReview {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.\n\nPara with `one` and `two` code spans {++here++}.\n\nInline $a+b$ and `code` with [link](http://x.y) and *em*.\n\n    indented 0\n    indented 1\n\n{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n```\n~~}\n\n- item `code a` words\n- item {++added++} text\n- item `code b` more\n- item {--gone--} more\n\n> quoted {~~a~>b~~} line\n\n- item `code a` words\n- item {++added++} text\n- item `code b` more\n- item {--gone--} more\n\nLine one {++x++}\nline two {--y--}.\n\n- item {++one++}\n- item {--two--}\n\n$$\nx + y\n$$\n\nLine one {++x++}\nline two {--y--}.\n\n- item {++one++}\n- item {--two--}\n'
const key = { start: 49, end: 49, insert: '`' }

const shape = (core: ReturnType<typeof createDocumentCore>, revision: DocumentRevision): string => {
  const nodes = (node: MarkdownAstNode): unknown => [(node as { nodeId?: unknown }).nodeId, node.kind, node.range, node.attributes,
    node.children.map(nodes)]
  return JSON.stringify([
    revision.source, revision.annotations, revision.diagnostics,
    nodes(core.project(revision, 'markup').syntax.ast.root),
    (['original', 'revised'] as const).map(name => {
      const projection = core.project(revision, name)
      return [projection.markdown, nodes(projection.ast.root)]
    })
  ])
}

describe('a document compile read from its candidates\' reader views', () => {
  // A key writing a label definition is the document's to compile: no
  // window reads the labels it could define. The spelling it settles on is
  // a candidate it read from reader views, which apply then parses whole.
  it.each([
    ['Para one.\n\nPara two {++x++}.\n', 9, '\n\n[a]: http://x\n'],
    ['Text [a] here.\n\n> quote {--y--}\n', 5, '[^1]']
  ])('publishes %j as a fresh open reads it', (text, at, insert) => {
    const core = createDocumentCore()
    const revision = core.open(text)
    const planned = core.trackedEdit(revision, { start: at, end: at, insert })
    expect(planned).toBeDefined()
    if (planned === undefined) return
    const applied = core.apply(revision, [planned]).revision
    const fresh = createDocumentCore()
    expect(shape(core, applied)).toBe(shape(fresh, fresh.open(applied.source)))
  })

  it('applies the spelling it settles on as a whole parse of it reads', () => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const action = {
      range: { start: key.start, end: key.end },
      selection: { ranges: [{ anchor: key.start, focus: key.start }], primary: 0 },
      inputType: 'insertText',
      data: key.insert,
      options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
    } as const
    const plan = core.planInput(revision, action, { tracked: true })
    const edits = core.inputEdits(revision, action, plan, true)
    expect(edits).toBeDefined()
    if (edits === undefined) return
    const applied = core.apply(revision, edits).revision
    const fresh = createDocumentCore()
    expect(shape(core, applied)).toBe(shape(fresh, fresh.open(applied.source)))
  })
})
