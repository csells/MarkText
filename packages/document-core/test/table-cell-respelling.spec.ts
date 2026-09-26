import { describe, expect, it } from 'vitest'
import { createDocumentCore, resolveTableCell, type DocumentTableCellSelection } from '../src/index.js'

const options = { autoPairBracket: false, autoPairMarkdownSyntax: false, autoPairQuote: false }

const typeInCell = (source: string, row: number, column: number, anchor: number, data: string, tracked: boolean) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: source.length - 1 }, row, column }, anchor, focus: anchor }
  const action = { selection, range: selection, inputType: 'insertText', data, options }
  const plan = core.planInput(revision, action, { tracked })
  const edits = core.inputEdits(revision, action, plan, tracked)
  if (edits === undefined) throw new Error('Cell input refused')
  const commit = core.apply(revision, edits)
  return { plan, source: commit.revision.source, selection: core.reconcileInput(revision, plan, commit, action).selection }
}

// Upstream (8d6c198c) writes the whole table afresh after a cell edit.
it('respells the table around an untracked cell edit, which stays its own operation', () => {
  const typed = typeInCell('|a|b|\n|:-|-:|\n|c|d|\n', 1, 0, 1, 'x', false)
  expect(typed.source).toBe('| a   | b   |\n|:--- | ---:|\n| cx  | d   |\n')
  expect(typed.plan.edits).toContainEqual({ start: 16, end: 16, insert: 'x' })
  expect(typed.selection).toEqual({ kind: 'table-cell', cell: { table: { start: 0, end: 41 }, row: 1, column: 0 }, anchor: 2, focus: 2 })
})

it('keeps the table spelling for a tracked cell edit and for an input of unknown tracking', () => {
  const source = '| a | b |\n| --- | --- |\n| c | d |\n'
  expect(typeInCell(source, 0, 0, 1, 'x', true).source).toBe('| a{++x++} | b |\n| --- | --- |\n| c | d |\n')
  const core = createDocumentCore()
  const revision = core.open(source)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: source.length - 1 }, row: 0, column: 0 }, anchor: 1, focus: 1 }
  expect(core.planInput(revision, { selection, range: selection, inputType: 'insertText', data: 'x', options }).edits).toEqual([{ start: 3, end: 3, insert: 'x' }])
})

// A cell holding only a comment has that comment as its content, as a cell's
// content includes the comments beside its text.
it('resolves a cell holding only a comment to the comment', () => {
  const source = '| {>>c<<} | d |\n| - | - |\n'
  const core = createDocumentCore()
  const revision = core.open(source)
  const cell = resolveTableCell(core, revision, { table: { start: 0, end: source.length - 1 }, row: 0, column: 0 })
  expect({ start: cell.start, end: cell.end }).toEqual({ start: 2, end: 9 })
  const typed = typeInCell(source, 0, 0, 0, 'z', false)
  expect(typed.source).toBe('| z{>>c<<} | d   |\n| -------- | --- |\n')
})

// Padding fits the written text: deleting an insertion's only text removes
// the insertion, so the column is as wide as for an empty cell.
it('pads a cell whose insertion a deletion empties', () => {
  const source = '| {++a++} | b |\n| - | - |\n| c | d |\n'
  const core = createDocumentCore()
  const revision = core.open(source)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: source.length - 1 }, row: 0, column: 0 }, anchor: 3, focus: 4 }
  const action = { selection, range: selection, inputType: 'deleteContentForward', data: null, options }
  const plan = core.planInput(revision, action, { tracked: false })
  const edits = core.inputEdits(revision, action, plan, false)
  if (edits === undefined) throw new Error('Cell deletion refused')
  const commit = core.apply(revision, edits)
  expect(commit.revision.source).toBe('|     | b   |\n| --- | --- |\n| c   | d   |\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ kind: 'table-cell', cell: { table: { start: 0, end: 41 }, row: 0, column: 0 }, anchor: 0, focus: 0 })
})

// Owner decision (plan 0012 G24): the table is padded as upstream pads it, but
// a row's text beyond the header's columns stays where upstream drops it.
describe('text beyond the header columns', () => {
  const undoOf = (source: string, row: number, column: number, anchor: number, data: string, tracked: boolean) => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: source.length - 1 }, row, column }, anchor, focus: anchor }
    const action = { selection, range: selection, inputType: 'insertText', data, options }
    const plan = core.planInput(revision, action, { tracked })
    const edits = core.inputEdits(revision, action, plan, tracked)
    if (edits === undefined) throw new Error('Cell input refused')
    const commit = core.apply(revision, edits)
    let shift = 0
    const inverse = commit.change.appliedEdits.map((edit) => {
      const start = edit.start + shift
      shift += edit.insert.length - (edit.end - edit.start)
      return { start, end: start + edit.insert.length, insert: source.slice(edit.start, edit.end) }
    })
    return core.apply(commit.revision, inverse).revision.source
  }

  it.each([
    { name: 'an extra cell', source: '|a|b|\n|-|-|\n|c|d|extra|\n', typed: '| ax  | b   |\n| --- | --- |\n| c   | d   |extra|\n' },
    { name: 'several extra cells without a closing pipe', source: '|a|b|\n|-|-|\n|c|d|e|f\n', typed: '| ax  | b   |\n| --- | --- |\n| c   | d   |e|f\n' },
    { name: 'short and long rows together', source: '|a|b|\n|-|-|\n|c|\n|d|e|f|g|\n', typed: '| ax  | b   |\n| --- | --- |\n| c   |     |\n| d   | e   |f|g|\n' },
    { name: 'an escaped pipe in an extra cell', source: '|a|b|\n|-|-|\n|c|d|x \\| y|\n', typed: '| ax  | b   |\n| --- | --- |\n| c   | d   |x \\| y|\n' },
    { name: 'CriticMarkup in an extra cell', source: '|a|b|\n|-|-|\n|c|d|{++new++} {>>note<<}|\n', typed: '| ax  | b   |\n| --- | --- |\n| c   | d   |{++new++} {>>note<<}|\n' },
    { name: 'CriticMarkup in a cell beside an extra cell', source: '|a|b|\n|-|-|\n|{--c--}|d|extra|\n', typed: '| ax      | b   |\n| ------- | --- |\n| {--c--} | d   |extra|\n' }
  ])('keeps $name when a header cell edit pads the table', ({ source, typed }) => {
    expect(typeInCell(source, 0, 0, 1, 'x', false).source).toBe(typed)
    expect(undoOf(source, 0, 0, 1, 'x', false)).toBe(source)
  })

  it('keeps an extra cell when a cell of its own row is edited', () => {
    expect(typeInCell('|a|b|\n|-|-|\n|c|d|extra|\n', 1, 1, 1, 'x', false).source).toBe('| a   | b   |\n| --- | --- |\n| c   | dx  |extra|\n')
  })

  it('leaves a tracked edit unpadded and every cell in place', () => {
    const source = '|a|b|\n|-|-|\n|c|d|extra|\n'
    expect(typeInCell(source, 0, 0, 1, 'x', true).source).toBe('|a{++x++}|b|\n|-|-|\n|c|d|extra|\n')
    expect(undoOf(source, 0, 0, 1, 'x', true)).toBe(source)
  })
})
