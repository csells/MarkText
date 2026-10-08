import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import { planFromGeneralCompile } from '../src/internal/documentCoreInspection.js'

// A backtick typed on the empty line after a table pairs with one far below
// it: no spelling of it holds, in any window or in the document. The
// document's spelling search stops at its budget (owner decision, 8 October
// 2026) and the key takes its closest spelling, which Accept All and Reject
// All read as the untracked edit and the document as it was.
const source = '$$\nx + y\n$$\n\n| a | b |\n| - | - |\n| 1 | {++2++} |\n\n{=={--gone--}==}{>>only deleted<<} tail.\n\n{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n```\n~~}\n\n<div>\nhtml 0\n</div>\n\n    indented 0\n    indented 1\n\n$$\nx + y\n$$\n\nLine one {++x++}\nline two {--y--}.\n\nPara with `one` and `two` code spans {++here++}.\n\n| a | b |\n| - | - |\n| 1 | {++2++} |\n\n1. first `x` one\n2. second {++y++}\n3. third\n\n# Heading {++added++}\n\n# Heading {++added++}\n\nInline $a+b$ and `code` with [link](http://x.y) and *em*.\n\n```js\nconst a = 0\nconst b = 1\n```\n\nReview {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.\n\n- item `code a` words\n- item {++added++} text\n- item `code b` more\n- item {--gone--} more\n\n| a | b |\n| - | - |\n| 1 | {++2++} |\n\n$$\nx + y\n$$\n\n- item `code a` words\n- item {++added++} text\n- item `code b` more\n- item {--gone--} more\n\nReview {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.\n\nPara with `one` and `two` code spans {++here++}.\n\nInline $a+b$ and `code` with [link](http://x.y) and *em*.\n\n    indented 0\n    indented 1\n\n{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n```\n~~}\n\n- item `code a` words\n- item {++added++} text\n- item `code b` more\n- item {--gone--} more\n\n> quoted {~~a~>b~~} line\n\n- item `code a` words\n- item {++added++} text\n- item `code b` more\n- item {--gone--} more\n\nLine one {++x++}\nline two {--y--}.\n\n- item {++one++}\n- item {--two--}\n\n$$\nx + y\n$$\n\nLine one {++x++}\nline two {--y--}.\n\n- item {++one++}\n- item {--two--}\n'
const key = { start: 49, end: 49, insert: '`' }

const typed = (core: ReturnType<typeof createDocumentCore>, opened: ReturnType<ReturnType<typeof createDocumentCore>['open']>) => {
  const action = {
    range: { start: key.start, end: key.end },
    selection: { ranges: [{ anchor: key.start, focus: key.start }], primary: 0 },
    inputType: 'insertText',
    data: key.insert,
    options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
  } as const
  return core.inputEdits(opened, action, core.planInput(opened, action, { tracked: true }), true)
}

describe('a document-level spelling search past its budget', () => {
  it('takes the closest spelling, which resolves exactly', () => {
    const core = createDocumentCore()
    const opened = core.open(source)
    const planned = typed(core, opened)
    expect(planned).toEqual([{ start: 49, end: 49, insert: '{++`++}' }])
    if (planned === undefined) return
    // Accepting the suggestion it authors gives the untracked edit, and
    // rejecting it the document as it was, byte for byte.
    const [spelled] = planned
    if (spelled === undefined) return
    const tracked = source.slice(0, spelled.start) + spelled.insert + source.slice(spelled.end)
    const authored = { start: spelled.start, end: spelled.start + spelled.insert.length }
    expect(tracked.slice(0, authored.start) + key.insert + tracked.slice(authored.end))
      .toBe(source.slice(0, key.start) + key.insert + source.slice(key.end))
    expect(tracked.slice(0, authored.start) + tracked.slice(authored.end)).toBe(source)
  })

  it('as the unbudgeted reference spells it, where no spelling holds', () => {
    const reference = createDocumentCore()
    planFromGeneralCompile(reference)
    expect(typed(reference, reference.open(source))).toEqual([{ start: 49, end: 49, insert: '{++`++}' }])
  })
})
