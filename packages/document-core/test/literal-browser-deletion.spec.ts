import { expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

it.each([
  { source: 'before\n\n```js\nsame same\n```\n\nafter\n', backward: false },
  { source: 'before\n\n{++```js\nsame same\n```++}\n\nafter\n', backward: false },
  { source: 'before\n\n```js\nsame same\n```\n\nafter\n', backward: true },
  { source: 'before\n\n{++```js\nsame same\n```++}\n\nafter\n', backward: true }
])('confines a collapsed browser deletion to its literal payload ($backward, $source)', ({ source, backward }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const start = source.indexOf('same same')
  const end = start + 'same same'.length
  const caret = backward ? start : end
  const selection = { ranges: [{ anchor: caret, focus: caret }], primary: 0 }
  const action = { selection, range: backward ? { start: source.indexOf('js') + 2, end: caret } : { start: caret, end: source.indexOf('after') + 5 }, inputType: backward ? 'deleteWordBackward' : 'deleteHardLineForward', data: null, options }
  const plan = core.planInput(revision, action)
  expect(plan.edits.filter(edit => edit.start !== edit.end || edit.insert !== '')).toEqual([])
  expect(plan.selection).toEqual(selection)
  expect(core.inputEdits(revision, action, plan, false)).toEqual([])
})

it.each([false, true])('retains literal boundaries when deleting from normalized tab columns (backward=%s)', backward => {
  const core = createDocumentCore()
  const source = '  ```\n\tbody\n  ```\n\nafter\n'
  const revision = core.open(source)
  const point = { text: { start: 6, end: 7 }, offset: 1 }
  const selection = { kind: 'model-text' as const, anchor: point, focus: point }
  const range = { kind: 'model-text' as const, anchor: backward ? 0 : point, focus: backward ? point : source.indexOf('after') + 5 }
  const action = { selection, range, inputType: backward ? 'deleteWordBackward' : 'deleteHardLineForward', data: null, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  expect(edits).toBeDefined()
  if (edits === undefined) throw new Error('Expected owned deletion edits')
  expect(core.apply(revision, edits).revision.source).toBe(backward ? '  ```\n   body\n  ```\n\nafter\n' : '  ```\n   \n  ```\n\nafter\n')
})
