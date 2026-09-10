import { expect, it } from 'vitest'
import { createDocumentCore, rebaseDocumentInputSelection, type DocumentTableCellSelection, type DocumentInputAction } from '../src/index.js'

const source = '| a | b | c |\n| --- | --- | --- |\n| x |\n'
const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
const cell = (row = 1, column = 2): DocumentTableCellSelection => ({ kind: 'table-cell', cell: { table: { start: 0, end: 39 }, row, column }, anchor: 0, focus: 0 })

it.each(['before', 'after'] as const)('retains ordinary collapsed %s insertion affinity', affinity => {
  const core = createDocumentCore()
  const previous = core.open('aaa')
  const commit = core.apply(previous, [{ start: 1, end: 1, insert: 'x' }])
  expect(rebaseDocumentInputSelection(core, previous, commit, { start: 1, end: 1 }, { affinity, operation: { kind: 'edits' } }))
    .toEqual({ kind: 'mapped', selection: { start: affinity === 'before' ? 1 : 2, end: affinity === 'before' ? 1 : 2 } })
})

it('keeps an omitted cell distinct when text before its table shifts source positions', () => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const commit = core.apply(previous, [{ start: 0, end: 0, insert: 'before\n\n' }])
  expect(rebaseDocumentInputSelection(core, previous, commit, cell(), { affinity: 'before', operation: { kind: 'edits' } }))
    .toEqual({ kind: 'mapped', selection: { ...cell(), cell: { table: { start: 8, end: 47 }, row: 1, column: 2 } } })
})

it.each([
  { command: 'insertTableColumn', placement: 'before', selected: cell(0, 1), row: 1, column: 3 },
  { command: 'removeTableColumn', selected: cell(0, 1), row: 1, column: 1 },
  { command: 'insertTableRow', placement: 'before', selected: cell(1, 0), row: 2, column: 2 },
  { command: 'removeTableRow', selected: cell(0, 0), row: 0, column: 2 }
] as const)('retains the same omitted cell through $command', ({ command, placement, selected, row, column }) => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const action = { kind: 'command', command, ...(placement === undefined ? {} : { placement }), selection: selected, options } as DocumentInputAction
  const plan = core.planInput(previous, action)
  const compiled = core.inputEdits(previous, action, plan, false)
  if (compiled === undefined) throw new Error('Structural edit refused')
  const commit = core.apply(previous, compiled)
  if (command === 'removeTableRow') expect(commit.revision.source).toBe('| x |     |     |\n| --- | --- | --- |\n')
  const result = rebaseDocumentInputSelection(core, previous, commit, cell(), { affinity: 'before', operation: { kind: 'input', action, tracked: false } })
  expect(result).toEqual({ kind: 'mapped', selection: { ...cell(), cell: { table: { start: 0, end: commit.revision.sourceLength - 1 }, row, column } } })
})

it.each(['removeTableColumn', 'removeTableRow'] as const)('conflicts when %s consumes the retained cell', command => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const action = { kind: 'command' as const, command, selection: cell(), options }
  const plan = core.planInput(previous, action)
  const compiled = core.inputEdits(previous, action, plan, false)
  if (compiled === undefined) throw new Error('Structural deletion refused')
  const commit = core.apply(previous, compiled)
  expect(rebaseDocumentInputSelection(core, previous, commit, cell(), { affinity: 'before', operation: { kind: 'input', action, tracked: false } })).toEqual({ kind: 'conflict' })
})

it.each(['before', 'after'] as const)('keeps %s affinity when another action materializes the same omitted cell', affinity => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const selection = cell(1, 1)
  const action = { selection, range: selection, inputType: 'insertText', data: 'y', options }
  const plan = core.planInput(previous, action)
  const compiled = core.inputEdits(previous, action, plan, false)
  if (compiled === undefined) throw new Error('Materialization refused')
  const commit = core.apply(previous, compiled)
  expect(rebaseDocumentInputSelection(core, previous, commit, selection, { affinity, operation: { kind: 'input', action, tracked: false } }))
    .toEqual({ kind: 'mapped', selection: { kind: 'table-cell', cell: { table: { start: 0, end: 46 }, row: 1, column: 1 }, anchor: affinity === 'before' ? 0 : 1, focus: affinity === 'before' ? 0 : 1 } })
})

it('rejects overlapping source replacement instead of moving a retained selection to a neighbor', () => {
  const core = createDocumentCore()
  const previous = core.open('abc')
  const commit = core.apply(previous, [{ start: 0, end: 2, insert: 'x' }])
  expect(rebaseDocumentInputSelection(core, previous, commit, { start: 1, end: 2 }, { affinity: 'before', operation: { kind: 'edits' } })).toEqual({ kind: 'conflict' })
})

it.each([false, true])('conflicts with removed target columns even when Track %s retains their source', tracked => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const action = { kind: 'command' as const, command: 'removeTableColumn' as const, selection: cell(0, 2), options }
  const plan = core.planInput(previous, action)
  const compiled = core.inputEdits(previous, action, plan, tracked)
  if (compiled === undefined) throw new Error('Column removal refused')
  const commit = core.apply(previous, compiled)
  expect(rebaseDocumentInputSelection(core, previous, commit, cell(), { affinity: 'before', operation: { kind: 'input', action, tracked } })).toEqual({ kind: 'conflict' })
})

it('retains the target row when a preceding row is marked deleted', () => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const action = { kind: 'command' as const, command: 'removeTableRow' as const, selection: cell(0, 0), options }
  const plan = core.planInput(previous, action)
  const compiled = core.inputEdits(previous, action, plan, true)
  if (compiled === undefined) throw new Error('Tracked header removal refused')
  const commit = core.apply(previous, compiled)
  const result = rebaseDocumentInputSelection(core, previous, commit, cell(), { affinity: 'before', operation: { kind: 'input', action, tracked: true } })
  expect(result).toMatchObject({ kind: 'mapped', selection: { kind: 'table-cell', cell: { row: 1, column: 2 }, anchor: 0, focus: 0 } })
})

it('never retargets an identical cell in another table', () => {
  const core = createDocumentCore()
  const previous = core.open(source + '\nother\n\n' + source)
  const target: DocumentTableCellSelection = { ...cell(), cell: { ...cell().cell, table: { start: 48, end: 87 } } }
  const action = { kind: 'command' as const, command: 'insertTableColumn' as const, placement: 'before' as const, selection: cell(0, 0), options }
  const plan = core.planInput(previous, action)
  const compiled = core.inputEdits(previous, action, plan, false)
  if (compiled === undefined) throw new Error('Column insertion refused')
  const commit = core.apply(previous, compiled)
  const delta = commit.revision.sourceLength - previous.sourceLength
  expect(rebaseDocumentInputSelection(core, previous, commit, target, { affinity: 'before', operation: { kind: 'input', action, tracked: false } }))
    .toEqual({ kind: 'mapped', selection: { ...target, cell: { ...target.cell, table: { start: 48 + delta, end: 87 + delta } } } })
})

it('advances a physical-cell caret through disjoint content input', () => {
  const core = createDocumentCore()
  const previous = core.open('| abc | b |\n| --- | --- |\n')
  const target: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: 25 }, row: 0, column: 0 }, anchor: 2, focus: 2 }
  const commit = core.apply(previous, [{ start: 2, end: 2, insert: 'x' }])
  expect(rebaseDocumentInputSelection(core, previous, commit, target, { affinity: 'before', operation: { kind: 'edits' } }))
    .toEqual({ kind: 'mapped', selection: { ...target, cell: { ...target.cell, table: { start: 0, end: 26 } }, anchor: 3, focus: 3 } })
})

it('conflicts when tracked input consumes a retained caret although source bytes remain in a deletion', () => {
  const core = createDocumentCore()
  const previous = core.open('| abc | b |\n| --- | --- |\n')
  const target: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: 25 }, row: 0, column: 0 }, anchor: 1, focus: 1 }
  const selection = { ...target, anchor: 0, focus: 3 }
  const action = { selection, range: selection, inputType: 'deleteContentBackward', data: null, options }
  const plan = core.planInput(previous, action)
  const compiled = core.inputEdits(previous, action, plan, true)
  if (compiled === undefined) throw new Error('Tracked content deletion refused')
  const commit = core.apply(previous, compiled)
  expect(commit.revision.source).toBe('| {--abc--} | b |\n| --- | --- |\n')
  expect(rebaseDocumentInputSelection(core, previous, commit, target, { affinity: 'before', operation: { kind: 'input', action, tracked: true } }))
    .toEqual({ kind: 'conflict' })
})
