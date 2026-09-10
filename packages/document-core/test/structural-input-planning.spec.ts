import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction } from '../src/index.js'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

it.each([
  { source: 'aaaa\n', start: 2, end: 2, inputType: 'insertParagraph', insert: '\n\n' },
  { source: 'a{++aa++}a\n', start: 5, end: 5, inputType: 'insertParagraph', insert: '\n\n' },
  { source: 'a{++a++}a\n', start: 0, end: 5, inputType: 'insertParagraph', insert: '\n\n' },
  { source: 'aaaa\n', start: 2, end: 2, inputType: 'insertLineBreak', insert: '\n' }
])('plans $inputType from actual source selection in $source', ({ source, start, end, inputType, insert }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const selection = { start, end }
  const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: selection.start, focus: selection.end }], primary: 0 }, range: selection, inputType, data: '\n', options }
  const plan = core.planInput(previous, inputAction)
  expect(plan.edits).toEqual([{ start, end, insert }])
  expect(plan.selection).toEqual({ ranges: [{ anchor: start + insert.length, focus: start + insert.length }], primary: 0 })
})

it.each([
  { source: '- aaa\n', at: 3, insert: '\n- ', expected: '- a\n- aa\n' },
  { source: '> aaa\n', at: 3, insert: '\n> \n> ', expected: '> a\n> \n> aa\n' },
  { source: '# aaa\n', at: 3, insert: '\n\n', expected: '# a\n\naa\n' },
  { source: '- [x] aaa\n', at: 7, insert: '\n- [ ] ', expected: '- [x] a\n- [ ] aa\n' }
])('uses the existing $source container syntax for Enter', ({ source, at, insert, expected }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const selection = { start: at, end: at }
  const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: selection.start, focus: selection.end }], primary: 0 }, range: selection, inputType: 'insertParagraph', data: '\n', options }
  const plan = core.planInput(previous, inputAction)
  expect(plan.edits).toEqual([{ start: at, end: at, insert }])
  expect(core.apply(previous, core.inputEdits(previous, inputAction, plan, false) ?? []).revision.source).toBe(expected)
  expect(plan.selection).toEqual({ ranges: [{ anchor: at + insert.length, focus: at + insert.length }], primary: 0 })
})

it.each([
  { source: '- \n', at: 2, expected: '\n', caret: 0 },
  { source: '> \n', at: 2, expected: '\n', caret: 0 },
  { source: '> \n', at: 1, expected: '\n', caret: 0 },
  { source: '# aaa\n', at: 2, expected: '\n\n# aaa\n', caret: 4 },
  { source: 'aaa\n===\n', at: 1, expected: 'a\n===\n\naa\n', caret: 7 }
])('preserves native Enter structure at $at in $source', ({ source, at, expected, caret }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const selection = { start: at, end: at }
  const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: selection.start, focus: selection.end }], primary: 0 }, range: selection, inputType: 'insertParagraph', data: '\n', options }
  const plan = core.planInput(previous, inputAction)
  expect(core.apply(previous, core.inputEdits(previous, inputAction, plan, false) ?? []).revision.source).toBe(expected)
  expect(plan.selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
})

it.each([
  { source: 'aa\r\naa\r\n', at: 1, expected: 'a\r\n\r\na\r\naa\r\n' },
  { source: '- \n', at: 2, expected: '\n' },
  { source: 'aaa\n===\n', at: 1, expected: 'a\n===\n\naa\n' }
])('relates the exact raw Enter operation to the owned structural edits in $source', ({ source, at, expected }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const selection = { start: at, end: at }
  const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: selection.start, focus: selection.end }], primary: 0 }, range: selection, inputType: 'insertParagraph', data: '\n', options }
  const plan = core.planInput(previous, inputAction)
  const raw = core.apply(previous, [{ ...selection, insert: '\n' }]).revision
  expect(core.apply(raw, plan.reconciliation).revision.source).toBe(expected)
})

it('continues a later quote paragraph using its container marker without copying earlier text', () => {
  const source = '> first\n>\n> aaa\n'
  const core = createDocumentCore()
  const previous = core.open(source)
  const selection = { start: 13, end: 13 }
  const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: selection.start, focus: selection.end }], primary: 0 }, range: selection, inputType: 'insertParagraph', data: '\n', options }
  const plan = core.planInput(previous, inputAction)
  expect(core.apply(previous, core.inputEdits(previous, inputAction, plan, false) ?? []).revision.source).toBe('> first\n>\n> a\n> \n> aa\n')
})

it.each([
  { source: '- first\n  - aaa\n', at: 13, expected: '- first\n  - a\n  - aa\n' },
  { source: '> - aaa\n', at: 5, expected: '> - a\n> - aa\n' },
  { source: '1. aaa\n', at: 4, expected: '1. a\n2. aa\n' }
])('preserves the surrounding container prefix in $source', ({ source, at, expected }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const selection = { start: at, end: at }
  const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: selection.start, focus: selection.end }], primary: 0 }, range: selection, inputType: 'insertParagraph', data: '\n', options }
  const plan = core.planInput(previous, inputAction)
  expect(core.apply(previous, core.inputEdits(previous, inputAction, plan, false) ?? []).revision.source).toBe(expected)
})

it('turns an owned table header paragraph into a table on Enter without rewriting its cells', () => {
  const core = createDocumentCore()
  const previous = core.open('| a | b |\n')
  const selection = { start: 9, end: 9 }
  const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: selection.start, focus: selection.end }], primary: 0 }, range: selection, inputType: 'insertParagraph', data: '\n', options }
  const plan = core.planInput(previous, inputAction)
  const current = core.apply(previous, core.inputEdits(previous, inputAction, plan, false) ?? []).revision
  expect(current.source).toBe('| a | b |\n| --- | --- |\n| | |\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 26, focus: 26 }], primary: 0 })
  expect(core.project(current, 'markup').syntax.ast.root.children[0]?.kind).toBe('table')
})

it.each(['```js\n', '~~~js\n'])('completes the owned empty fence opener %s before entering its body', source => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const selection = { start: 5, end: 5 }
  const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: selection.start, focus: selection.end }], primary: 0 }, range: selection, inputType: 'insertParagraph', data: '\n', options }
  const plan = core.planInput(previous, inputAction)
  expect(core.apply(previous, core.inputEdits(previous, inputAction, plan, false) ?? []).revision.source).toBe(source.slice(0, 5) + '\n\n' + source.slice(0, 3) + '\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 6, focus: 6 }], primary: 0 })
})

it('uses the existing parser lane for a prospective table containing suggestions and comment pipes', () => {
  const source = '| {++a++}{>>ignore | extra<<} | b |\n'
  const core = createDocumentCore()
  const previous = core.open(source)
  const selection = { start: source.length - 1, end: source.length - 1 }
  const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: selection.start, focus: selection.end }], primary: 0 }, range: selection, inputType: 'insertParagraph', data: '\n', options }
  const plan = core.planInput(previous, inputAction)
  expect(core.apply(previous, core.inputEdits(previous, inputAction, plan, false) ?? []).revision.source).toBe('| {++a++}{>>ignore | extra<<} | b |\n| --- | --- |\n| | |\n')
})

it('completes the existing math opener grammar through the Enter operation', () => {
  const core = createDocumentCore()
  const previous = core.open('$$\n')
  const selection = { start: 2, end: 2 }
  const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: selection.start, focus: selection.end }], primary: 0 }, range: selection, inputType: 'insertParagraph', data: '\n', options }
  const plan = core.planInput(previous, inputAction)
  expect(core.apply(previous, core.inputEdits(previous, inputAction, plan, false) ?? []).revision.source).toBe('$$\n\n$$\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 3, focus: 3 }], primary: 0 })
})

it.each([
  { source: '```js\n  aaa\n```\n', at: 11, expected: '```js\n  aaa\n  \n```\n', caret: 14 },
  { source: '```js\n{}\n```\n', at: 7, expected: '```js\n{\n    \n}\n```\n', caret: 12 }
])('retains literal code indentation through model Enter in $source', ({ source, at, expected, caret }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const selection = { start: at, end: at }
  const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: selection.start, focus: selection.end }], primary: 0 }, range: selection, inputType: 'insertParagraph', data: '\n', options }
  const plan = core.planInput(previous, inputAction)
  expect(core.apply(previous, core.inputEdits(previous, inputAction, plan, false) ?? []).revision.source).toBe(expected)
  expect(plan.selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
})

it('keeps the literal fenced payload source range aligned with retained indentation', () => {
  const core = createDocumentCore()
  const revision = core.open('```js\n  aaa\n```\n')
  const syntax = core.project(revision, 'markup').syntax
  const code = syntax.ast.root.children[0]
  if (code === undefined) throw new Error('Missing fenced code syntax')
  expect(code.attributes.content).toBe('  aaa\n')
  expect(code.attributes.contentStart).toBe(6)
})

it.each([
  { source: '```js\naaa\n```\n', at: 7, expected: '```js\naaa\n```\n\n', caret: 15 },
  { source: '```js\naaa\n```\n\nafter\n', at: 7, expected: '```js\naaa\n```\n\nafter\n', caret: 15 }
])('moves out of a code block with Shift Enter in $source', ({ source, at, expected, caret }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const selection = { start: at, end: at }
  const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: selection.start, focus: selection.end }], primary: 0 }, range: selection, inputType: 'insertLineBreak', data: '\n', options }
  const plan = core.planInput(previous, inputAction)
  expect(core.apply(previous, core.inputEdits(previous, inputAction, plan, false) ?? []).revision.source).toBe(expected)
  expect(plan.selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
})

it('uses the actual tab size preference for literal Enter pairing', () => {
  const core = createDocumentCore()
  const revision = core.open('```js\n{}\n```\n')
  const selection = { start: 7, end: 7 }
  const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: selection.start, focus: selection.end }], primary: 0 }, range: selection, inputType: 'insertParagraph', data: '\n', options: { ...options, tabSize: 2 } }
  const plan = core.planInput(revision, inputAction)
  expect(core.apply(revision, core.inputEdits(revision, inputAction, plan, false) ?? []).revision.source).toBe('```js\n{\n  \n}\n```\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 10, focus: 10 }], primary: 0 })
})

it('moves table Enter to the first cell of the next owned row without editing source', () => {
  const source = '| aa | bb |\n| --- | --- |\n| cc | dd |\n'
  const core = createDocumentCore()
  const revision = core.open(source)
  const selection = { start: 3, end: 3 }
  const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: selection.start, focus: selection.end }], primary: 0 }, range: selection, inputType: 'insertParagraph', data: '\n', options }
  const plan = core.planInput(revision, inputAction)
  expect(plan.edits).toEqual([])
  expect(plan.selection).toEqual({ ranges: [{ anchor: 28, focus: 28 }], primary: 0 })
})

it('uses a line-break element for Shift Enter inside a table cell', () => {
  const core = createDocumentCore()
  const revision = core.open('| aa | bb |\n| --- | --- |\n| cc | dd |\n')
  const selection = { start: 3, end: 3 }
  const inputAction: DocumentInputAction = { selection: { ranges: [{ anchor: selection.start, focus: selection.end }], primary: 0 }, range: selection, inputType: 'insertLineBreak', data: '\n', options }
  const plan = core.planInput(revision, inputAction)
  expect(core.apply(revision, core.inputEdits(revision, inputAction, plan, false) ?? []).revision.source).toBe('| a<br/>a | bb |\n| --- | --- |\n| cc | dd |\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 8, focus: 8 }], primary: 0 })
})

it('inserts a native table row command without rewriting existing cells or their suggestions', () => {
  const core = createDocumentCore()
  const revision = core.open('| a{++a++} | bb |\n| --- | --- |\n| cc | dd |\n')
  const inputAction: DocumentInputAction = { kind: 'command', command: 'insertTableRow', placement: 'after', selection: { ranges: [{ anchor: 3, focus: 3 }], primary: 0 }, options }
  const plan = core.planInput(revision, inputAction)
  expect(core.apply(revision, core.inputEdits(revision, inputAction, plan, false) ?? []).revision.source).toBe('| a{++a++} | bb |\n| --- | --- |\n|     |     |\n| cc | dd |\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 38, focus: 38 }], primary: 0 })
})

it('inserts a row after the current body row while preserving its final newline', () => {
  const core = createDocumentCore()
  const revision = core.open('| aa | bb |\n| --- | --- |\n| cc | dd |\n')
  const inputAction: DocumentInputAction = { kind: 'command', command: 'insertTableRow', placement: 'after', selection: { ranges: [{ anchor: 29, focus: 29 }], primary: 0 }, options }
  const plan = core.planInput(revision, inputAction)
  expect(core.apply(revision, core.inputEdits(revision, inputAction, plan, false) ?? []).revision.source).toBe('| aa | bb |\n| --- | --- |\n| cc | dd |\n|     |     |\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 44, focus: 44 }], primary: 0 })
})

it('inserts an empty header above the current header and retains its alignment and annotated cells as a body row', () => {
  const core = createDocumentCore()
  const revision = core.open('away\n\n| a{++a++} | aa |\n| :--- | ---: |\n| aa | aa |\n')
  const inputAction: DocumentInputAction = { kind: 'command', command: 'insertTableRow', placement: 'before', selection: { ranges: [{ anchor: 8, focus: 8 }], primary: 0 }, options }
  const plan = core.planInput(revision, inputAction)
  expect(core.apply(revision, core.inputEdits(revision, inputAction, plan, false) ?? []).revision.source).toBe('away\n\n|     |     |\n| :--- | ---: |\n| a{++a++} | aa |\n| aa | aa |\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 12, focus: 12 }], primary: 0 })
})

it('maps a sparse tracked header insertion through the accepted annotation arms', () => {
  const core = createDocumentCore()
  const previous = core.open('away\n\n| a{++a++} | aa |\n| :--- | ---: |\n| aa | aa |\n')
  const inputAction: DocumentInputAction = { kind: 'command', command: 'insertTableRow', placement: 'before', selection: { ranges: [{ anchor: 8, focus: 8 }], primary: 0 }, options }
  const plan = core.planInput(previous, inputAction)
  const edits = core.inputEdits(previous, inputAction, plan, true)
  if (edits === undefined) throw new Error('Tracked header insertion was rejected')
  const committed = core.apply(previous, edits)
  const result = core.reconcileInput(previous, plan, committed, inputAction)
  expect(result.selection).toEqual({ ranges: [{ anchor: 15, focus: 15 }], primary: 0 })
  if (result.compilerReconciliation === undefined) throw new Error('Missing accepted coordinate mapping')
  const requested = 'away\n\n|     |     |\n| :--- | ---: |\n| a{++a++} | aa |\n| aa | aa |\n'
  const mapped = [...result.compilerReconciliation].reverse().reduce((text, edit) => text.slice(0, edit.start) + edit.insert + text.slice(edit.end), requested)
  expect(mapped).toBe('away\n\n{++|     |     |\n| :--- | ---: |\n++}| a{++a++} | aa |{--\n| :--- | ---: |--}\n| aa | aa |\n')
  expect(committed.revision.source).toBe(mapped)
})

it.each([
  { name: 'last body row', source: '| a{++a++} | aa |\n| :--- | ---: |\n| aa | aa |\n', at: 35, expected: '| a{++a++} | aa |\n| :--- | ---: |\n', caret: 2 },
  { name: 'header with annotated surviving body', source: '| aa | aa |\n| :--- | ---: |\n| a{++a++} | aa |\n', at: 2, expected: '| a{++a++} | aa |\n| :--- | ---: |\n', caret: 2 },
  { name: 'only row with following paragraph', source: '| aa | aa |\n| :--- | ---: |\n\nafter\n', at: 2, expected: '\n\nafter\n', caret: 2 },
  { name: 'only row in document', source: '| aa | aa |\n| :--- | ---: |\n', at: 2, expected: '\n', caret: 0 }
])('removes the $name through the common table command', ({ source, at, expected, caret }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const inputAction: DocumentInputAction = { kind: 'command', command: 'removeTableRow', selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options }
  const plan = core.planInput(previous, inputAction)
  const committed = core.apply(previous, core.inputEdits(previous, inputAction, plan, false) ?? [])
  expect(committed.revision.source).toBe(expected)
  expect(core.reconcileInput(previous, plan, committed, inputAction).selection).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
})

it('inserts a table column at the selected column through exact owned cell intervals', () => {
  const core = createDocumentCore()
  const previous = core.open('away\n\n| a{++a++} | aa |\n| :--- | ---: |\n| aa | aa |\n')
  const inputAction: DocumentInputAction = { kind: 'command', command: 'insertTableColumn', placement: 'before', selection: { ranges: [{ anchor: 20, focus: 20 }], primary: 0 }, options }
  const plan = core.planInput(previous, inputAction)
  const compiled = core.inputEdits(previous, inputAction, plan, false)
  if (compiled === undefined) throw new Error('Column insertion was rejected')
  const committed = core.apply(previous, compiled)
  expect(committed.revision.source).toBe('away\n\n| a{++a++} |     | aa |\n| :--- | --- | ---: |\n| aa |     | aa |\n')
  expect(core.reconcileInput(previous, plan, committed, inputAction).selection).toEqual({ ranges: [{ anchor: 23, focus: 23 }], primary: 0 })
})

it('removes only the selected column and retains the other cells and their annotations', () => {
  const core = createDocumentCore()
  const previous = core.open('away\n\n| a{++a++} | aa |\n| :--- | ---: |\n| aa | aa |\n')
  const inputAction: DocumentInputAction = { kind: 'command', command: 'removeTableColumn', selection: { ranges: [{ anchor: 20, focus: 20 }], primary: 0 }, options }
  const plan = core.planInput(previous, inputAction)
  const compiled = core.inputEdits(previous, inputAction, plan, false)
  if (compiled === undefined) throw new Error('Column removal was rejected')
  const committed = core.apply(previous, compiled)
  expect(committed.revision.source).toBe('away\n\n| a{++a++} |\n| :--- |\n| aa |\n')
  expect(core.reconcileInput(previous, plan, committed, inputAction).selection).toEqual({ ranges: [{ anchor: 8, focus: 8 }], primary: 0 })
})

it.each([
  { action: { command: 'insertTableColumn' as const, placement: 'before' as const }, at: 8, expected: '| aa |     | bb |\n|---| --- |---|\n| cc |     |\n' },
  { action: { command: 'insertTableColumn' as const, placement: 'after' as const }, at: 8, expected: '| aa | bb |     |\n|---|---| --- |\n| cc |     |     |\n' },
  { action: { command: 'removeTableColumn' as const }, at: 8, expected: '| aa |\n|---|\n| cc |\n' },
  { action: { command: 'removeTableColumn' as const }, at: 3, expected: '| bb |\n|---|\n||\n' }
])('preserves implicit body cells for $action at $at', ({ action, at, expected }) => {
  const core = createDocumentCore()
  const previous = core.open('| aa | bb |\n|---|---|\n| cc |\n')
  const inputAction: DocumentInputAction = { kind: 'command', ...action, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, options }
  const plan = core.planInput(previous, inputAction)
  const compiled = core.inputEdits(previous, inputAction, plan, false)
  if (compiled === undefined) throw new Error('Column operation was rejected')
  const committed = core.apply(previous, compiled)
  expect(committed.revision.source).toBe(expected)
  expect(core.reconcileInput(previous, plan, committed, inputAction).selection).toBeDefined()
})

it('removing a column consumes its hidden comments with the owned structure', () => {
  const core = createDocumentCore()
  const source = '| first | second |\r\n| :--- | ---: |\r\n| {++cell++}{>>note<<} | remove |\r\n'
  const previous = core.open(source)
  const action: DocumentInputAction = { kind: 'command', command: 'removeTableColumn', selection: { kind: 'table-cell', cell: { table: { start: 0, end: source.length - 2 }, row: 0, column: 0 }, anchor: 0, focus: 0 }, options }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  expect(edits).toBeDefined()
  expect(core.apply(previous, edits ?? []).revision.source).toBe('| second |\r\n| ---: |\r\n| remove |\r\n')
})

it.each(['\n', '\r\n', '\r'])('inserts a row within its actual list container (%j)', ending => {
  const core = createDocumentCore()
  const source = ['- {++first++}{>>note<<}', '- second', '', '  | col |', '  | --- |', '  | cell |', ''].join(ending)
  const previous = core.open(source)
  const action: DocumentInputAction = { kind: 'command', command: 'insertTableRow', placement: 'after', selection: { kind: 'table-cell', cell: { table: { start: source.indexOf('| col'), end: source.length - ending.length }, row: 1, column: 0 }, anchor: 0, focus: 0 }, options }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  expect(edits).toBeDefined()
  expect(core.apply(previous, edits ?? []).revision.source).toBe(source + '  |     |' + ending)
})

it.each([
  { source: '- {>>note<<}\n', expected: '{>>note<<}\n' },
  { source: '> {>>note<<}\n', expected: '{>>note<<}\n' }
])('preserves the comment when Enter exits an otherwise empty container ($source)', ({ source, expected }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const at = source.indexOf('\n')
  const input: DocumentInputAction = { selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, range: { start: at, end: at }, inputType: 'insertParagraph', data: '\n', options }
  const plan = core.planInput(previous, input)
  expect(core.apply(previous, core.inputEdits(previous, input, plan, false) ?? []).revision.source).toBe(expected)
})
