import { expect, it } from 'vitest'
import { copyClipboardAction, createDocumentCore, type DocumentTableCellSelection } from '../src/index.js'

const source = '| a | b | c |\n| --- | --- | --- |\n| x |\n'
const cell = (text: string, row: number, column: number, anchor = 0, focus = anchor): DocumentTableCellSelection => ({
  kind: 'table-cell', cell: { table: { start: 0, end: text.length - 1 }, row, column }, anchor, focus
})
const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

it('pastes into the later implicit cell and uses that same model position for the next key', () => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const paste = core.planClipboard(previous, { kind: 'paste', selection: cell(source, 1, 2), markdown: 'y', tracked: false })
  const accepted = core.apply(previous, paste.edits).revision
  expect(accepted.source).toBe('| a | b | c |\n| --- | --- | --- |\n| x |     |     y|\n')
  expect(paste.selection).toEqual(cell(accepted.source, 1, 2, 1))
  if (!('kind' in paste.selection) || paste.selection.kind !== 'table-cell') throw new Error('Missing intrinsic paste caret')
  const action = { selection: paste.selection, range: paste.selection, inputType: 'insertText', data: 'X', options }
  const input = core.planInput(accepted, action)
  const edits = core.markupEdits(accepted, input.edits)
  if (edits === undefined) throw new Error('Next key rejected')
  const next = core.apply(accepted, edits)
  expect(next.revision.source).toBe('| a | b | c |\n| --- | --- | --- |\n| x |     |     yX|\n')
  expect(core.reconcileInput(accepted, input, next, action).selection).toEqual(cell(next.revision.source, 1, 2, 2))
  expect(core.open(next.revision.source).source).toBe(next.revision.source)
})

it('applies existing multiline table paste policy in a physical cell without changing neighbors', () => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const paste = core.planClipboard(previous, { kind: 'paste', selection: cell(source, 1, 0, 1), markdown: 'y\nz', tracked: false })
  const accepted = core.apply(previous, paste.edits).revision
  expect(accepted.source).toBe('| a | b | c |\n| --- | --- | --- |\n| xy<br/>z |\n')
  expect(paste.selection).toEqual(cell(accepted.source, 1, 0, 8))
})

it('deep-copies captured and current intrinsic clipboard targets', () => {
  const selection = { kind: 'table-cell' as const, cell: { table: { start: 0, end: source.length - 1 }, row: 1, column: 2 }, anchor: 0, focus: 0 }
  const currentSelection = { ...selection, cell: { ...selection.cell, column: 1, table: { ...selection.cell.table } } }
  const copied = copyClipboardAction({ kind: 'paste', selection, currentSelection, markdown: 'y', tracked: false })
  selection.cell.column = 0
  selection.cell.table.end = 2
  currentSelection.cell.column = 0
  expect(copied).toMatchObject({ selection: cell(source, 1, 2), currentSelection: cell(source, 1, 1) })
})

it('tracks only the pasted content when materializing a later implicit cell', () => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const paste = core.planClipboard(previous, { kind: 'paste', selection: cell(source, 1, 2), markdown: 'y', tracked: true })
  const accepted = core.apply(previous, paste.edits).revision
  expect(accepted.source).toBe('| a | b | c |\n| --- | --- | --- |\n| x |     |     {++y++}|\n')
  expect(paste.selection).toEqual(cell(accepted.source, 1, 2, 4))
  expect(accepted.annotations.map(annotation => annotation.range)).toEqual([{ start: accepted.source.indexOf('{++'), end: accepted.source.indexOf('{++') + 7 }])
  expect(core.project(accepted, 'original').markdown).toBe('| a | b | c |\n| --- | --- | --- |\n| x |     |     |\n')
})

it('retains a different current implicit cell while inserting at the captured cell', () => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const paste = core.planClipboard(previous, { kind: 'paste', selection: cell(source, 1, 2), currentSelection: cell(source, 1, 1), markdown: 'y', tracked: false })
  const accepted = core.apply(previous, paste.edits).revision
  expect(accepted.source).toBe('| a | b | c |\n| --- | --- | --- |\n| x |     |     y|\n')
  expect(paste.selection).toEqual(cell(accepted.source, 1, 1))
})

it.each([false, true])('pastes inside the owned pending arm with Track %s', tracked => {
  const core = createDocumentCore()
  const text = '| a{++bc++}d | e |\n| --- | --- |\n'
  const previous = core.open(text)
  const paste = core.planClipboard(previous, { kind: 'paste', selection: cell(text, 0, 0, 5), markdown: 'x', tracked })
  const accepted = core.apply(previous, paste.edits).revision
  expect(accepted.source).toBe('| a{++bxc++}d | e |\n| --- | --- |\n')
  expect(paste.selection).toEqual(cell(accepted.source, 0, 0, 6))
})
