import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type DocumentTableCellSelection } from '../src/index.js'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }

it.each([
  { name: 'a nonempty first cell', source: '| sa{++me++}{>>note<<} | same |\n| ---- | ---- |\n| same | same |\n', expected: '| sa{++me++}{>>note<<} | same |\n| ---- | ---- |\n| same | same |\n' },
  { name: 'an empty table', source: '| | |\n| --- | --- |\n| | |\n', expected: '\n' },
  { name: 'a comment-only table', source: '| {>>keep<<} | |\n| --- | --- |\n| | |\n', expected: '| {>>keep<<} | |\n| --- | --- |\n| | |\n' },
])('Backspace respects the owned content of $name', ({ source, expected }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: source.length - 1 }, row: 0, column: 0 }, anchor: 0, focus: 0 }
  const action: DocumentInputAction = { kind: 'command', command: 'tableBoundaryBackspace', selection, options }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  expect(edits).toBeDefined()
  const commit = edits?.length ? core.apply(previous, edits) : null
  expect((commit?.revision ?? previous).source).toBe(expected)
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual(source === expected ? selection : { ranges: [{ anchor: 0, focus: 0 }], primary: 0 })
})

it('Backspace chooses the previous implicit cell by identity', () => {
  const core = createDocumentCore()
  const source = '| a | b | c |\n| --- | --- | --- |\n| x |\n'
  const previous = core.open(source)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: source.length - 1 }, row: 1, column: 2 }, anchor: 0, focus: 0 }
  const action: DocumentInputAction = { kind: 'command', command: 'tableBoundaryBackspace', selection, options }
  const plan = core.planInput(previous, action)
  expect(plan.edits).toEqual([])
  expect(core.reconcileInput(previous, plan, null, action).selection).toEqual({ ...selection, cell: { ...selection.cell, column: 1 } })
})

it('Backspace at an empty table follows the previous table without removing either', () => {
  const core = createDocumentCore()
  const source = '| a | b | c |\n| --- | --- | --- |\n| x |\n\n| |\n| --- |\n'
  const previous = core.open(source)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 41, end: source.length - 1 }, row: 0, column: 0 }, anchor: 0, focus: 0 }
  const action: DocumentInputAction = { kind: 'command', command: 'tableBoundaryBackspace', selection, options }
  const plan = core.planInput(previous, action)
  expect(plan.edits).toEqual([])
  expect(core.reconcileInput(previous, plan, null, action).selection).toEqual({ kind: 'table-cell', cell: { table: { start: 0, end: 39 }, row: 1, column: 2 }, anchor: 0, focus: 0 })
})

it('ArrowDown creates the same trailing paragraph as table Enter', () => {
  const core = createDocumentCore()
  const source = '| a{++a++} | bb |\n| --- | --- |\n| cc | dd |\n'
  const previous = core.open(source)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: source.length - 1 }, row: 1, column: 0 }, anchor: 0, focus: 0 }
  const action: DocumentInputAction = { kind: 'command', command: 'exitTable', selection, options }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits ?? [])
  expect(commit.revision.source).toBe(source + '\n')
  expect(core.reconcileInput(previous, plan, commit, action).selection).toEqual({ ranges: [{ anchor: source.length + 1, focus: source.length + 1 }], primary: 0 })
})

it('keeps typing outside an empty table after its tracked removal', () => {
  const core = createDocumentCore()
  const source = '| | |\n| --- | --- |\n| | |\n'
  const previous = core.open(source)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: source.length - 1 }, row: 0, column: 0 }, anchor: 0, focus: 0 }
  const action: DocumentInputAction = { kind: 'command', command: 'tableBoundaryBackspace', selection, options }
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, true)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits ?? [])
  expect(commit.revision.source).toBe('{--| | |\n| --- | --- |\n| | |--}\n')
  const nextSelection = core.reconcileInput(previous, plan, commit, action).selection
  expect(nextSelection).toEqual({ ranges: [{ anchor: 31, focus: 31 }], primary: 0 })
  if (nextSelection === undefined || nextSelection.kind === 'table-cell') throw new Error('Expected exterior caret')
  const input: DocumentInputAction = { selection: nextSelection, range: { start: 31, end: 31 }, inputType: 'insertText', data: 'X', options }
  const inputPlan = core.planInput(commit.revision, input)
  const typed = core.inputEdits(commit.revision, input, inputPlan, true)
  expect(typed).toBeDefined()
  expect(core.apply(commit.revision, typed ?? []).revision.source).toBe('{--| | |\n| --- | --- |\n| | |--}{++X++}\n')
})
