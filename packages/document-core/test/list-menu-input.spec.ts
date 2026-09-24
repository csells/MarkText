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

const planAndApply = (source: string, action: DocumentInputAction, tracked = false) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, tracked)
  if (edits === undefined) throw new Error('Expected list command edits')
  const commit = core.apply(previous, edits)
  return { core, commit, selection: core.reconcileInput(previous, plan, commit, action).selection }
}
const listCommand = (kind: 'bullet' | 'ordered' | 'task', anchor: number, focus = anchor, markers = listOptions): DocumentInputAction =>
  ({ kind: 'command', command: 'changeList', change: { type: 'toggle', kind }, listOptions: markers, selection: { ranges: [{ anchor, focus }], primary: 0 }, options })

it.each([
  { kind: 'bullet', prefix: '- ' },
  { kind: 'ordered', prefix: '1. ' },
  { kind: 'task', prefix: '- [ ] ' }
].flatMap(example => [false, true].map(tracked => ({ ...example, tracked }))) as { kind: 'bullet' | 'ordered' | 'task', prefix: string, tracked: boolean }[])('creates a $kind list from a paragraph owned by one multiline addition (tracked=$tracked)', ({ kind, prefix, tracked }) => {
  const source = '{++first\nsecond++}\n'
  const caret = source.indexOf('++}')
  const { core, commit, selection } = planAndApply(source, listCommand(kind, caret), tracked)
  // Upstream MarkText indents continuation lines by the marker's width.
  const indent = ' '.repeat(kind === 'ordered' ? 3 : 2)
  const expected = tracked
    ? `{++${prefix}first\n${indent}second++}\n`
    : `${prefix}{++first\n${indent}second++}\n`
  expect(commit.revision.source).toBe(expected)
  expect(core.project(commit.revision, 'markup').syntax.ast.root.children[0]?.kind).toBe('list')
  const after = expected.indexOf('second') + 'second'.length
  expect(selection).toEqual({ ranges: [{ anchor: after, focus: after }], primary: 0 })
  expect(core.open(expected).source).toBe(expected)
})

it.each([
  { name: 'plain paragraph as bullet', source: 'alpha\n', kind: 'bullet', expected: '- alpha\n' },
  { name: 'plain paragraph as ordered', source: 'alpha\n', kind: 'ordered', expected: '1. alpha\n' },
  { name: 'plain paragraph as task', source: 'alpha\n', kind: 'task', expected: '- [ ] alpha\n' },
  { name: 'multiline paragraph with continuation', source: 'alpha\nbeta\n', kind: 'ordered', expected: '1. alpha\n   beta\n' },
  { name: 'paragraph inside a blockquote', source: '> alpha\n> beta\n', kind: 'bullet', expected: '> - alpha\n>   beta\n' },
  { name: 'several selected paragraphs', source: 'alpha\n\nbeta\n\ngamma\n', kind: 'ordered', expected: '1. alpha\n\n2. beta\n\n3. gamma\n', select: ['alpha', 'gamma'] },
  { name: 'annotated line continuation', source: 'a{++a\nb++}c\n', kind: 'bullet', expected: '- a{++a\n  b++}c\n' }
] as { name: string, source: string, kind: 'bullet' | 'ordered' | 'task', expected: string, select?: [string, string] }[])('creates a list from $name', ({ source, kind, expected, select }) => {
  const anchor = select === undefined ? source.search(/[a-z]/u) + 1 : source.indexOf(select[0])
  const focus = select === undefined ? anchor : source.indexOf(select[1]) + select[1].length
  const { core, commit } = planAndApply(source, listCommand(kind, anchor, focus))
  expect(commit.revision.source).toBe(expected)
  expect(core.open(expected).source).toBe(expected)
})

it('creates a tight list from several paragraphs when loose list items are not preferred', () => {
  // Upstream MarkText joins the new items without blank lines in this mode.
  const source = 'alpha\n\nbeta\n\ngamma\n'
  const tight = { ...listOptions, preferLooseListItem: false }
  const { commit } = planAndApply(source, listCommand('ordered', 0, source.indexOf('gamma') + 5, tight))
  expect(commit.revision.source).toBe('1. alpha\n2. beta\n3. gamma\n')
})

it('creates lists with the configured marker spelling', () => {
  expect(planAndApply('alpha\n', listCommand('bullet', 1, 1, { bulletListMarker: '*', orderListDelimiter: ')' })).commit.revision.source).toBe('* alpha\n')
  expect(planAndApply('alpha\n', listCommand('ordered', 1, 1, { bulletListMarker: '*', orderListDelimiter: ')' })).commit.revision.source).toBe('1) alpha\n')
  expect(planAndApply('alpha\n', listCommand('task', 1, 1, { bulletListMarker: '+', orderListDelimiter: '.' })).commit.revision.source).toBe('+ [ ] alpha\n')
})

it('keeps an end-of-line caret on the unlisted paragraph instead of the inserted separator', () => {
  const source = '- {++first++}{>>keep<<}\n- second\n'
  const caret = source.indexOf('\n')
  const { commit, selection } = planAndApply(source, listCommand('bullet', caret))
  expect(commit.revision.source).toBe('{++first++}{>>keep<<}\n\nsecond\n')
  expect(selection).toEqual({ ranges: [{ anchor: caret - 2, focus: caret - 2 }], primary: 0 })
})

it.each([
  { source: '1. alpha\n2. beta\n', expected: '1. alpha\n   1. beta\n' },
  { source: '1) alpha\n2) beta\n   more\n', expected: '1) alpha\n   1) beta\n      more\n' },
  { source: '9. alpha\n10. beta\n    more\n', expected: '9. alpha\n   9. beta\n      more\n' },
  { source: '1. alpha\n2. beta\n3. gamma\n', expected: '1. alpha\n   1. beta\n2. gamma\n' },
  { source: '1. alpha\n   5. x\n2. beta\n3. gamma\n', expected: '1. alpha\n   5. x\n   6. beta\n2. gamma\n' },
  { source: '- alpha\n- beta\n', expected: '- alpha\n  - beta\n' }
])('nests an ordered item with upstream MarkText numbering: $source', ({ source, expected }) => {
  const caret = source.indexOf('beta') + 2
  const { commit, selection } = planAndApply(source, { kind: 'command', command: 'tab', shift: false, selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 }, options })
  expect(commit.revision.source).toBe(expected)
  const after = expected.indexOf('beta') + 2
  expect(selection).toEqual({ ranges: [{ anchor: after, focus: after }], primary: 0 })
})

it('outdents a nested ordered item with upstream MarkText numbering', () => {
  const source = '1. alpha\n   1. beta\n2. gamma\n'
  const caret = source.indexOf('beta') + 2
  const { commit, selection } = planAndApply(source, { kind: 'command', command: 'tab', shift: true, selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 }, options })
  expect(commit.revision.source).toBe('1. alpha\n2. beta\n3. gamma\n')
  const after = commit.revision.source.indexOf('beta') + 2
  expect(selection).toEqual({ ranges: [{ anchor: after, focus: after }], primary: 0 })
})
