import { expect, it } from 'vitest'
import { createDocumentCore, projectSourceSelection } from '../src/index.js'

const source = '| a | b | c |\r\n| --- | --- | --- |\r\n| x |\r\n'
const table = { start: 0, end: source.length - 2 }

it('projects distinct implicit cells to their actual Source row boundary without changing their identity', () => {
  const core = createDocumentCore()
  const revision = core.open(source)
  for (const column of [1, 2]) {
    const selection = { kind: 'table-cell', cell: { table, row: 1, column }, anchor: 0, focus: 0 } as const
    expect(projectSourceSelection(core, revision, selection)).toEqual({ ranges: [{ anchor: 41, focus: 41 }], primary: 0 })
    expect(selection.cell.column).toBe(column)
  }
})

it('projects a rectangle through physical cells and implicit row boundaries', () => {
  const core = createDocumentCore()
  const revision = core.open(source)
  expect(projectSourceSelection(core, revision, { kind: 'table', table, anchor: { row: 0, column: 1 }, focus: { row: 1, column: 2 } })).toEqual({
    ranges: [{ anchor: 6, focus: 7 }, { anchor: 10, focus: 11 }, { anchor: 41, focus: 41 }, { anchor: 41, focus: 41 }], primary: 3
  })
})

it('retains backward canonical offsets inside annotated cell content', () => {
  const core = createDocumentCore()
  const revision = core.open('| a{++b++}c |\n| --- |\n')
  expect(projectSourceSelection(core, revision, { kind: 'table-cell', cell: { table: { start: 0, end: 21 }, row: 0, column: 0 }, anchor: 8, focus: 1 })).toEqual({ ranges: [{ anchor: 10, focus: 3 }], primary: 0 })
})

it('rejects stale tables and offsets outside the actual cell', () => {
  const core = createDocumentCore()
  const revision = core.open(source)
  expect(() => projectSourceSelection(core, revision, { kind: 'table-cell', cell: { table, row: 1, column: 2 }, anchor: 1, focus: 0 })).toThrow()
  expect(() => projectSourceSelection(core, revision, { kind: 'table', table: { start: 0, end: source.length }, anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } })).toThrow()
})

it('requires this model revision even for a plain Source selection', () => {
  const core = createDocumentCore()
  const foreign = createDocumentCore().open('abc')
  expect(() => projectSourceSelection(core, foreign, { ranges: [{ anchor: 0, focus: 3 }], primary: 0 })).toThrow()
})
