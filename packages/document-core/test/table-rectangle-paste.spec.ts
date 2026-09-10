import { expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

it.each([
  { source: '| a | b |\n| --- | --- |\n| c | d |\n', column: 0, expected: '| a | b |\n| --- | --- |\n| y | d |\n' },
  { source: '| a | b | c |\n| --- | --- | --- |\n| x |\n', column: 2, expected: '| a | b | c |\n| --- | --- | --- |\n| x |     |     y|\n' }
])('pastes through the owned frozen cell at column $column', ({ source, column, expected }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const plan = core.planClipboard(revision, {
    kind: 'table',
    operation: 'paste',
    markdown: 'y',
    tracked: false,
    selection: { kind: 'table', table: { start: 0, end: source.length - 1 }, anchor: { row: 1, column }, focus: { row: 1, column } }
  })
  const next = core.apply(revision, plan.edits).revision
  expect(next.source).toBe(expected)
  expect(plan.selection).toEqual({ kind: 'table-cell', cell: { table: { start: 0, end: expected.length - 1 }, row: 1, column }, anchor: 1, focus: 1 })
})

it('keeps the native multi-cell paste cancellation without changing source or rectangle', () => {
  const core = createDocumentCore()
  const source = '| a | b |\n| --- | --- |\n| c | d |\n'
  const revision = core.open(source)
  const selection = { kind: 'table' as const, table: { start: 0, end: source.length - 1 }, anchor: { row: 1, column: 0 }, focus: { row: 1, column: 1 } }
  const plan = core.planClipboard(revision, { kind: 'table', operation: 'paste', markdown: 'y', tracked: false, selection })
  expect(plan).toEqual({ edits: [], selection })
  expect(revision.source).toBe(source)
})
