import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
const listOptions = { bulletListMarker: '-', orderListDelimiter: '.' }

it.each([
  { name: 'bullet to ordered', source: '- {++first++}{>>keep<<}\n- second\n', expected: '1. {++first++}{>>keep<<}\n2. second\n', change: { type: 'toggle', kind: 'ordered' } },
  { name: 'bullet to task', source: '- {++first++}{>>keep<<}\n- second\n', expected: '- [ ] {++first++}{>>keep<<}\n- [ ] second\n', change: { type: 'toggle', kind: 'task' } },
  { name: 'task to bullet', source: '- [ ] {++first++}{>>keep<<}\n- [x] second\n', expected: '- {++first++}{>>keep<<}\n- second\n', change: { type: 'toggle', kind: 'bullet' } },
  { name: 'nested bullet to ordered', source: '- outer\n  - {++first++}{>>keep<<}\n  - second\n', expected: '- outer\n  1. {++first++}{>>keep<<}\n  2. second\n', change: { type: 'toggle', kind: 'ordered' } },
  { name: 'literal continuation to ordered', source: '- {++first++}{>>keep<<}\n\n  ```js\n  let x = 1\n  ```\n- second\n', expected: '1. {++first++}{>>keep<<}\n\n   ```js\n   let x = 1\n   ```\n2. second\n', change: { type: 'toggle', kind: 'ordered' } },
  { name: 'tight to loose', source: '- {++first++}{>>keep<<}\n- second\n', expected: '- {++first++}{>>keep<<}\n\n- second\n', change: { type: 'toggle-tight' } },
  { name: 'loose to tight', source: '- {++first++}{>>keep<<}\n\n- second\n', expected: '- {++first++}{>>keep<<}\n- second\n', change: { type: 'toggle-tight' } },
  { name: 'reset list to paragraphs', source: '- {++first++}{>>keep<<}\n- second\n', expected: '{++first++}{>>keep<<}\n\nsecond\n', change: { type: 'reset' } },
  { name: 'toggle off every matching ancestor', source: '- outer\n\n  - {++first++}{>>keep<<}\n', expected: 'outer\n\n{++first++}{>>keep<<}\n', change: { type: 'toggle', kind: 'bullet' } },
  { name: 'front resets only its outermost list', source: '- outer\n\n  - {++first++}{>>keep<<}\n', expected: 'outer\n\n- {++first++}{>>keep<<}\n', change: { type: 'front', kind: 'bullet' } },
  { name: 'front preserves original bullet spelling for task conversion', source: '* {++first++}{>>keep<<}\n* second\n', expected: '* [ ] {++first++}{>>keep<<}\n* [ ] second\n', change: { type: 'front', kind: 'task' } }
].flatMap(example => ['\n', '\r\n', '\r'].map(eol => ({ ...example, eol }))))('plans $name from owned list syntax with $eol', ({ source: original, expected: expectedOriginal, change, eol }) => {
  const source = original.replaceAll('\n', eol)
  const expected = expectedOriginal.replaceAll('\n', eol)
  const core = createDocumentCore()
  const previous = core.open(source)
  const at = source.indexOf('first')
  const action = { kind: 'command', command: 'changeList', change, listOptions, selection: { ranges: [{ anchor: at + 1, focus: at + 4 }], primary: 0 }, options } as DocumentInputAction
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits!)
  expect(commit.revision.source).toBe(expected)
  const after = expected.indexOf('first')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: after + 1, focus: after + 4 }], primary: 0 })
  expect(core.open(commit.revision.source).source).toBe(expected)
})

it('keeps the selected payload and existing annotations separate from tracked multiline list edits', () => {
  const core = createDocumentCore()
  const source = '- {++first++}{>>keep<<}\n\n  ```js\n  let x = 1\n  ```\n- second\n'
  const previous = core.open(source)
  const action = { kind: 'command', command: 'changeList', change: { type: 'toggle', kind: 'ordered' }, listOptions, selection: { ranges: [{ anchor: source.indexOf('first'), focus: source.indexOf('first') + 5 }], primary: 0 }, options } as DocumentInputAction
  const plan = core.planInput(previous, action)
  expect(plan.edits.length).toBeGreaterThan(2)
  const commit = core.apply(previous, core.inputEdits(previous, action, plan, true)!)
  expect(commit.revision.source).toBe('{~~- ~>1. ~~}{++first++}{>>keep<<}\n\n{~~  ~>   ~~}```js\n{~~  ~>   ~~}let x = 1\n{~~  ~>   ~~}```\n{~~- ~>2. ~~}second\n')
  expect(commit.revision.annotations.map(annotation => annotation.kind)).toEqual([
    'substitution', 'addition', 'comment', 'substitution', 'substitution', 'substitution', 'substitution'
  ])
  expect(core.open(commit.revision.source).source).toBe(commit.revision.source)
  expect(core.project(commit.revision, 'original').markdown).toBe('- \n\n  ```js\n  let x = 1\n  ```\n- second\n')
  expect(core.project(commit.revision, 'revised').markdown).toBe('1. first\n\n   ```js\n   let x = 1\n   ```\n2. second\n')
  const at = commit.revision.source.lastIndexOf('first')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: at, focus: at + 5 }], primary: 0 })
})

it('retains the paragraph caret when unlisting combines a separator and marker removal', () => {
  const core = createDocumentCore()
  const source = '- {++first++}{>>keep<<}\n\n  ```js\n  const x = 1\n  ```\n- second\n'
  const previous = core.open(source)
  const at = source.indexOf('first')
  const action: DocumentInputAction = { kind: 'command', command: 'changeList', change: { type: 'toggle', kind: 'bullet' }, listOptions, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options }
  const plan = core.planInput(previous, action)
  const commit = core.apply(previous, core.inputEdits(previous, action, plan, false)!)
  expect(commit.revision.source).toBe('{++first++}{>>keep<<}\n\n```js\nconst x = 1\n```\n\nsecond\n')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 3, focus: 3 }], primary: 0 })
})
