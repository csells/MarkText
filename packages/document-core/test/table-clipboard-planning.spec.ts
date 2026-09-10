import { expect, it } from 'vitest'
import { createDocumentCore, projectSourceSelection, type DocumentTableSelection } from '../src/index.js'

const rectangle = (source: string, row: number, column: number): DocumentTableSelection => ({
  kind: 'table', table: { start: 0, end: source.length - 1 }, anchor: { row: 0, column: 0 }, focus: { row, column }
})

it('clears a selected cell rectangle atomically and returns the same intrinsic table selection', () => {
  const core = createDocumentCore()
  const source = '| a | b | c |\n| --- | --- | --- |\n| {++a++} | b{>>note<<} | d |\n| e | f | g |\n'
  const revision = core.open(source)
  const plan = core.planClipboard(revision, {
    kind: 'table',
    operation: 'delete',
    tracked: false,
    selection: rectangle(source, 1, 1)
  })
  const next = core.apply(revision, plan.edits).revision
  expect(next.source).toBe('|  |  | c |\n| --- | --- | --- |\n|  |  | d |\n| e | f | g |\n')
  expect(plan.selection).toEqual(rectangle(next.source, 1, 1))
})

it('drops an already empty partial rectangle without creating a source edit', () => {
  const core = createDocumentCore()
  const revision = core.open('|  |  | c |\n| --- | --- | --- |\n|  |  | d |\n| e | f | g |\n')
  const plan = core.planClipboard(revision, {
    kind: 'table',
    operation: 'delete',
    tracked: false,
    selection: rectangle(revision.source, 1, 1)
  })
  expect(plan.edits).toEqual([])
  expect(plan.selection).toEqual({ kind: 'table-cell', cell: { table: { start: 0, end: revision.sourceLength - 1 }, row: 0, column: 0 }, anchor: 0, focus: 0 })
})

it('refuses a rectangle outside the current table before source mutation', () => {
  const core = createDocumentCore()
  const revision = core.open('| a | b |\n| --- | --- |\n| c | d |\n')
  expect(() => core.planClipboard(revision, {
    kind: 'table',
    operation: 'delete',
    tracked: false,
    selection: rectangle(revision.source, 2, 1)
  })).toThrow('Cell address is outside the current table')
  expect(core.sourceSlice(revision, { start: 0, end: revision.sourceLength })).toBe('| a | b |\n| --- | --- |\n| c | d |\n')
})

it.each([
  {
    name: 'contiguous empty columns',
    source: '|  |  | c |\n| --- | --- | --- |\n|  |  | d |\n|  |  | g |\n',
    lastRow: 2,
    expected: '| c |\n| --- |\n| d |\n| g |\n',
    caret: 2
  },
  {
    name: 'contiguous empty header and body rows',
    source: '|  |  |\n| --- | --- |\n|  |  |\n| e | f |\n',
    lastRow: 1,
    expected: '| e | f |\n| --- | --- |\n',
    caret: 2
  }
])('removes $name as one source transaction', ({ source, lastRow, expected, caret }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const plan = core.planClipboard(revision, {
    kind: 'table',
    operation: 'delete',
    tracked: false,
    selection: rectangle(source, lastRow, 1)
  })
  const next = core.apply(revision, plan.edits).revision
  expect(next.source).toBe(expected)
  if ('start' in plan.selection) throw new Error('Table removal must return model selection')
  expect(plan.selection).toEqual({ kind: 'table-cell', cell: { table: { start: 0, end: next.sourceLength - 1 }, row: 0, column: 0 }, anchor: 0, focus: 0 })
  expect(projectSourceSelection(core, next, plan.selection)).toEqual({ ranges: [{ anchor: caret, focus: caret }], primary: 0 })
})

it('cuts a populated whole table as one structural removal', () => {
  const core = createDocumentCore()
  const revision = core.open('| {++a++} | a |\n| --- | --- |\n| a | a{>>note<<} |\n')
  const plan = core.planClipboard(revision, {
    kind: 'table',
    operation: 'cut',
    tracked: false,
    selection: rectangle(revision.source, 1, 1)
  })
  expect(core.apply(revision, plan.edits).revision.source).toBe('\n')
  expect(plan.selection).toEqual({ ranges: [{ anchor: 0, focus: 0 }], primary: 0 })
})

it('places partial cut input at the accepted empty cell content boundary', () => {
  const core = createDocumentCore()
  const revision = core.open('| a | b | c |\n| --- | --- | --- |\n| {++a++} | b{>>note<<} | d |\n| e | f | g |\n')
  const plan = core.planClipboard(revision, {
    kind: 'table',
    operation: 'cut',
    tracked: false,
    selection: rectangle(revision.source, 1, 1)
  })
  const next = core.apply(revision, plan.edits).revision
  expect(next.source).toBe('|  |  | c |\n| --- | --- | --- |\n|  |  | d |\n| e | f | g |\n')
  expect(plan.selection).toEqual({ kind: 'table-cell', cell: { table: { start: 0, end: next.sourceLength - 1 }, row: 0, column: 0 }, anchor: 0, focus: 0 })
})

it.each([
  {
    name: 'ordinary cells',
    source: '| a | z |\n| --- | --- |\n| a | z |\n',
    expected: '| {--a--} | z |\n| --- | --- |\n| {--a--} | z |\n',
    original: '| a | z |\n| --- | --- |\n| a | z |\n'
  },
  {
    name: 'an existing addition',
    source: '| a | z |\n| --- | --- |\n| {++a++} | z |\n',
    expected: '| {--a--} | z |\n| --- | --- |\n|  | z |\n',
    original: '| a | z |\n| --- | --- |\n|  | z |\n'
  },
  {
    name: 'a comment within a consumed cell',
    source: '| a | z |\n| --- | --- |\n| a{>>note<<} | z |\n',
    expected: '| {--a--} | z |\n| --- | --- |\n| {--a{>>note<<}--} | z |\n',
    original: '| a | z |\n| --- | --- |\n| a | z |\n'
  }
])('tracks rectangle clearing of $name through the shared compiler', ({ source, expected, original }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const plan = core.planClipboard(revision, {
    kind: 'table',
    operation: 'delete',
    tracked: true,
    selection: rectangle(source, 1, 0)
  })
  const next = core.apply(revision, plan.edits).revision
  expect(next.source).toBe(expected)
  expect(core.project(next, 'original').markdown).toBe(original)
  expect(core.project(next, 'revised').markdown).toBe('|  | z |\n| --- | --- |\n|  | z |\n')
  expect(plan.selection).toEqual(rectangle(expected, 1, 0))
})
