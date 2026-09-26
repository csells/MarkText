import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type DocumentTableCellSelection } from '../src/index.js'

// Emptying a cell at the edge of a row without that outer pipe would merge the
// empty cell into the boundary and change the row's column count, destroying a
// header's table. The edit keeps the empty cell with the minimal pipe it needs
// (ADR 0015 protective spelling); every other byte is untouched (ADR 0007).
const options = { autoPairBracket: false, autoPairMarkdownSyntax: false, autoPairQuote: false }
const pipeless = 'a|b\n-|-\nc|d\n'
const at = (row: number, column: number, anchor: number, focus = anchor): DocumentTableCellSelection =>
  ({ kind: 'table-cell', cell: { table: { start: 0, end: pipeless.trimEnd().length }, row, column }, anchor, focus })

const cut = (selection: DocumentTableCellSelection) => {
  const core = createDocumentCore()
  const revision = core.open(pipeless)
  const plan = core.planClipboard(revision, { kind: 'cut', selection, tracked: false })
  return core.apply(revision, plan.edits).revision
}

const backspace = (selection: DocumentTableCellSelection) => {
  const core = createDocumentCore()
  const revision = core.open(pipeless)
  const action = { selection, range: { ...selection, anchor: selection.anchor - 1 }, inputType: 'deleteContentBackward', data: null, options } as DocumentInputAction
  const plan = core.planInput(revision, action, { tracked: false })
  const edits = core.inputEdits(revision, action, plan, false)
  if (edits === undefined) throw new Error('Input refused')
  return core.apply(revision, edits).revision
}

const columns = (source: string) => {
  const core = createDocumentCore()
  const syntax = core.project(core.open(source), 'markup').syntax
  const table = syntax.ast.root.children.find(node => node.kind === 'table')
  return table?.children.map(row => row.children.length)
}

it.each([
  { name: 'cutting the first header cell', run: () => cut(at(0, 0, 0, 1)), expected: '| |b\n-|-\nc|d\n' },
  { name: 'cutting the last header cell', run: () => cut(at(0, 1, 0, 1)), expected: 'a| |\n-|-\nc|d\n' },
  { name: 'deleting the first header cell\'s text', run: () => backspace(at(0, 0, 1)), expected: '| |b\n-|-\nc|d\n' }
])('$name keeps the table', ({ run, expected }) => {
  const revision = run()
  expect(revision.source).toBe(expected)
  expect(columns(revision.source)).toEqual([2, 2])
})

it('leaves a middle cell and a short body row as typed', () => {
  expect(cut(at(1, 1, 0, 1)).source).toBe('a|b\n-|-\nc|\n')
})
