import { expect, it } from 'vitest'
import { copyDocumentSelection, createDocumentCore, projectTableSelection } from '../src/index.js'
import { resolveTableSelection } from '../src/tableSelection.js'

const source = '| a | b | c |\n| --- | --- | --- |\n| x |\n'
const rectangle = () => ({
  kind: 'table' as const,
  table: { start: 0, end: source.length - 1 },
  anchor: { row: 1, column: 1 },
  focus: { row: 1, column: 2 }
})

it('distinguishes implicit cells by their intrinsic table address without inventing source slots', () => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const selected = resolveTableSelection(core, revision, rectangle())
  expect(selected.cells.map(cell => [cell.row, cell.column])).toEqual([[1, 1], [1, 2]])
  expect(selected.cells.map(cell => [cell.start, cell.end])).toEqual([[source.length - 1, source.length - 1], [source.length - 1, source.length - 1]])
  expect(selected.cells.every(cell => cell.slotStart === undefined && cell.slotEnd === undefined)).toBe(true)
  expect(projectTableSelection(core, revision, rectangle()).markdown).toBe('|     |     |\n| --- | --- |')
})

it.each(['cut', 'delete'] as const)('%s of an implicit partial rectangle preserves exact source and returns the anchor cell caret', operation => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const plan = core.planClipboard(revision, { kind: 'table', operation, selection: rectangle(), tracked: false })
  expect(plan.edits).toEqual([])
  expect(plan.selection).toEqual({ kind: 'table-cell', cell: { table: rectangle().table, row: 1, column: 1 }, anchor: 0, focus: 0 })
  expect(revision.source).toBe(source)
})

it('deep-copies table addresses and preserves backward cell selections', () => {
  const selection = rectangle()
  const copied = copyDocumentSelection(selection, source.length)
  selection.table.end = 2
  selection.anchor.column = 2
  expect(copied).toEqual(rectangle())
  const caret = { kind: 'table-cell' as const, cell: { table: rectangle().table, row: 1, column: 2 }, anchor: 3, focus: 1 }
  const copiedCaret = copyDocumentSelection(caret, source.length)
  caret.cell.column = 0
  caret.cell.table.start = 2
  expect(copiedCaret).toEqual({ kind: 'table-cell', cell: { table: rectangle().table, row: 1, column: 2 }, anchor: 3, focus: 1 })
})

it('rejects stale table extents and out-of-table addresses at the model boundary', () => {
  const core = createDocumentCore()
  const revision = core.open(source)
  expect(() => resolveTableSelection(core, revision, { ...rectangle(), table: { start: 0, end: source.length } })).toThrow('current table')
  expect(() => resolveTableSelection(core, revision, { ...rectangle(), focus: { row: 1, column: 3 } })).toThrow('outside the current table')
  expect(() => copyDocumentSelection({ ...rectangle(), anchor: { row: -1, column: 0 } }, source.length)).toThrow()
})
