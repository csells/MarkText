import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
const listOptions = { bulletListMarker: '-', orderListDelimiter: '.' }

it.each([
  { name: 'only bullet item', source: '- a{++l++}pha{>>keep<<}\n', expected: 'a{++l++}pha{>>keep<<}\n' },
  { name: 'only task item', source: '- [x] a{++l++}pha{>>keep<<}\n', expected: 'a{++l++}pha{>>keep<<}\n' },
  { name: 'only ordered item', source: '42) a{++l++}pha{>>keep<<}\n', expected: 'a{++l++}pha{>>keep<<}\n' },
  { name: 'nested only item', source: '- outer\n\n  - a{++l++}pha{>>keep<<}\n', expected: '- outer\n\n  a{++l++}pha{>>keep<<}\n' },
  { name: 'compact nested only item', source: '- outer\n  - a{++l++}pha{>>keep<<}\n', expected: '- outer\n\n  a{++l++}pha{>>keep<<}\n' },
  { name: 'list following a paragraph', source: 'before\n- a{++l++}pha{>>keep<<}\n', expected: 'before\n\na{++l++}pha{>>keep<<}\n' },
  { name: 'quoted only item', source: '> - a{++l++}pha{>>keep<<}\n', expected: '> a{++l++}pha{>>keep<<}\n' },
  { name: 'multiline item', source: '- a{++l++}pha{>>keep<<}\n\n  ```js\n  let x = 1\n  ```\n\nafter\n', expected: 'a{++l++}pha{>>keep<<}\n\n```js\nlet x = 1\n```\n\nafter\n' }
].flatMap(example => ['\n', '\r\n', '\r'].map(eol => ({ ...example, eol }))))('unwraps $name from its parser-owned list boundary with $eol', ({ source: original, expected: output, eol }) => {
  const source = original.replaceAll('\n', eol)
  const expected = output.replaceAll('\n', eol)
  const core = createDocumentCore()
  const previous = core.open(source)
  const at = source.indexOf('a{++')
  const action = { kind: 'command', command: 'changeList', change: { type: 'backspace' }, listOptions, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options } as DocumentInputAction
  const plan = core.planInput(previous, action)
  const commit = core.apply(previous, core.inputEdits(previous, action, plan, false)!)
  expect(commit.revision.source).toBe(expected)
  const target = expected.indexOf('a{++')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: target, focus: target }], primary: 0 })
  expect(core.open(commit.revision.source).source).toBe(expected)
})

it.each([
  { source: '- target\n- same\n', expected: '{--- --}target\n{++\n++}- same\n' },
  { source: '- same\n- target\n- final\n', expected: '- same\n{~~- ~>\n  ~~}target\n- final\n' }
])('keeps the retained target boundary after a tracked list Backspace: $source', ({ source, expected }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const at = source.indexOf('target')
  const action = { kind: 'command', command: 'changeList', change: { type: 'backspace' }, listOptions, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options } as DocumentInputAction
  const plan = core.planInput(previous, action)
  const commit = core.apply(previous, core.inputEdits(previous, action, plan, true)!)
  expect(commit.revision.source).toBe(expected)
  const target = expected.indexOf('target')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: target, focus: target }], primary: 0 })
})

it.each([false, true])('preserves both retained selection endpoints during tracked list conversion (backward=%s)', (backward) => {
  const core = createDocumentCore()
  const previous = core.open('- first\n- last\n')
  const start = previous.source.indexOf('first')
  const end = previous.source.indexOf('last') + 4
  const action = { kind: 'command', command: 'changeList', change: { type: 'front', kind: 'ordered' }, listOptions, selection: { ranges: [{ anchor: backward ? end : start, focus: backward ? start : end }], primary: 0 }, options } as DocumentInputAction
  const plan = core.planInput(previous, action)
  const commit = core.apply(previous, core.inputEdits(previous, action, plan, true)!)
  const expected = '{~~- ~>1. ~~}first\n{~~- ~>2. ~~}last\n'
  expect(commit.revision.source).toBe(expected)
  const nextStart = expected.indexOf('first')
  const nextEnd = expected.indexOf('last') + 4
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: backward ? nextEnd : nextStart, focus: backward ? nextStart : nextEnd }], primary: 0 })
})

it.each([false, true])('keeps the selected text after a tracked heading prefix insertion (backward=%s)', (backward) => {
  const core = createDocumentCore()
  const previous = core.open('target\n')
  const action = { kind: 'command', command: 'changeHeading', change: { type: 'toggle', level: 1 }, selection: { ranges: [{ anchor: backward ? 6 : 0, focus: backward ? 0 : 6 }], primary: 0 }, options } as DocumentInputAction
  const plan = core.planInput(previous, action)
  const commit = core.apply(previous, core.inputEdits(previous, action, plan, true)!)
  expect(commit.revision.source).toBe('{++# ++}target\n')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: backward ? 14 : 8, focus: backward ? 8 : 14 }], primary: 0 })
})

it.each([
  { command: 'changeHeading', change: { type: 'quick-insert', level: 2 }, prefix: '## ' },
  { command: 'changeBlockquote', change: { type: 'quick-insert' }, prefix: '> ' }
] as const)('keeps the next key in the newly authored $command payload after consuming the whole trigger', ({ command, change, prefix }) => {
  const core = createDocumentCore()
  const source = '/tr{++i++}gger\n'
  const previous = core.open(source)
  const at = source.length - 1
  const action = { kind: 'command', command, change, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options } as DocumentInputAction
  const plan = core.planInput(previous, action)
  const commit = core.apply(previous, core.inputEdits(previous, action, plan, true)!)
  const expected = `{~~/tr{++i++}gger~>${prefix}~~}\n`
  expect(commit.revision.source).toBe(expected)
  const result = core.reconcileInput(previous, plan, commit, action)
  const caret = expected.indexOf('~~}')
  expect(result.selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
  const nextAction = { inputType: 'insertText', data: 'X', range: { start: caret, end: caret }, selection: result.selection!, options } as DocumentInputAction
  const nextPlan = core.planInput(commit.revision, nextAction)
  const typed = core.apply(commit.revision, core.inputEdits(commit.revision, nextAction, nextPlan, false)!)
  expect(typed.revision.source).toBe(expected.replace('~~}', 'X~~}'))
  expect(core.project(core.open(typed.revision.source), 'original').markdown).toBe('/trgger\n')
  expect(core.project(core.open(typed.revision.source), 'revised').markdown).toBe(prefix + 'X\n')
})

it('keeps tracked typing outside a prefix substitution at the retained text boundary', () => {
  const core = createDocumentCore()
  const source = '- first\n{~~- ~>\n  ~~}a{++l++}pha{>>keep<<}\n- final\n'
  const previous = core.open(source)
  const at = source.indexOf('a{++')
  const action: DocumentInputAction = { inputType: 'insertText', data: 'X', range: { start: at, end: at }, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options }
  const plan = core.planInput(previous, action)
  const commit = core.apply(previous, core.inputEdits(previous, action, plan, true)!)
  expect(commit.revision.source).toBe(source.slice(0, at) + '{++X++}' + source.slice(at))
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: at + 4, focus: at + 4 }], primary: 0 })
})
