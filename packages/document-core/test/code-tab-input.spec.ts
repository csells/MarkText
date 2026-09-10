import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

it.each(['\n', '\r\n', '\r'])('tracks a code Tab through the common literal compiler and resulting selection (%s)', (ending) => {
  const core = createDocumentCore()
  const source = ['```js', 'ab', '```', ''].join(ending)
  const at = 6 + ending.length
  const previous = core.open(source)
  const action: DocumentInputAction = { kind: 'command', command: 'tab', shift: false, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true, tabSize: 4 } }
  const plan = core.planInput(previous, action)
  expect(plan.edits).toEqual([{ start: at, end: at, insert: '    ' }])
  const edits = core.inputEdits(previous, action, plan, true)
  expect(edits).toBeDefined()
  if (!edits) throw new Error('Expected tracked literal edit')
  const commit = core.apply(previous, edits)
  expect(commit.revision.source).toBe(['{~~```js', 'ab', '```', '~>```js', 'a    b', '```', '~~}'].join(ending))
  const result = core.reconcileInput(previous, plan, commit, action)
  expect(result.compilerReconciliation).toBeDefined()
  expect(result.selection).toEqual({ ranges: [{ anchor: 25 + 4 * ending.length, focus: 25 + 4 * ending.length }], primary: 0 })
})
