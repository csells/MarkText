import { expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

it('sets task flags and seats the next input at the clicked task content', () => {
  const core = createDocumentCore()
  const previous = core.open('- [ ] parent\n\n  - [ ] same\n  - [ ] same\n')
  const action = { kind: 'command', command: 'setTaskChecked', checked: true, autoCheck: true, autoMoveCheckedToEnd: false, selection: { ranges: [{ anchor: 6, focus: 6 }], primary: 0 }, options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true } } as const
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  const commit = core.apply(previous, edits!)
  expect(commit.revision.source).toBe('- [x] parent\n\n  - [x] same\n  - [x] same\n')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 6, focus: 6 }], primary: 0 })
})

it.each(['\n', '\r\n', '\r'])('keeps a tracked checkbox intrinsic in Markup and edits its new arm with %s', eol => {
  const core = createDocumentCore()
  const source = '- [{~~ ~>x~~}] {++same++}{>>keep<<}' + eol
  const previous = core.open(source)
  const syntax = core.project(previous, 'markup').syntax
  const item = syntax.ast.root.children[0]?.children[0]
  expect(item).toMatchObject({ kind: 'list-item', attributes: { task: true, checked: true } })
  expect(core.project(previous, 'original').markdown).toBe('- [ ] ' + eol)
  expect(core.project(previous, 'revised').markdown).toBe('- [x] same' + eol)
  const at = source.indexOf('same')
  const action = { kind: 'command', command: 'setTaskChecked', checked: false, autoCheck: false, autoMoveCheckedToEnd: false, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true } } as const
  const plan = core.planInput(previous, action)
  const commit = core.apply(previous, core.inputEdits(previous, action, plan, false)!)
  expect(commit.revision.source).toBe('- [{~~ ~> ~~}] {++same++}{>>keep<<}' + eol)
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual(action.selection)
})

it.each(['- [ x] text\n', '- [xx] text\n', '- [{++ ++}{++x++}] text\n', '- [{~~bad~>x~~}] text\n'])('does not turn malformed or unrelated task state text into a checkbox: %s', source => {
  const core = createDocumentCore()
  expect(core.project(core.open(source), 'markup').syntax.ast.root.children[0]?.children[0]?.attributes.task).not.toBe(true)
})

it('moves the clicked task with its complete annotations', () => {
  const core = createDocumentCore()
  const source = '- [ ] {++same++}{>>first<<}\n- [ ] same{>>second<<}\n- [x] final\n'
  const previous = core.open(source)
  const action = { kind: 'command', command: 'setTaskChecked', checked: true, autoCheck: false, autoMoveCheckedToEnd: true, selection: { ranges: [{ anchor: 9, focus: 9 }], primary: 0 }, options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true } } as const
  const plan = core.planInput(previous, action)
  const expected = '- [ ] same{>>second<<}\n- [x] {++same++}{>>first<<}\n- [x] final\n'
  const edits = core.inputEdits(previous, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits!)
  expect(commit.revision.source).toBe(expected)
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: expected.indexOf('same++}'), focus: expected.indexOf('same++}') }], primary: 0 })
})
