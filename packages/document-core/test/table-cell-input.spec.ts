import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentTableCellSelection } from '../src/index.js'

const source = '| a | b | c |\n| --- | --- | --- |\n| x |\n'
const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

it('materializes the first missing cell only when typing after an unchanged cut', () => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const cut = core.planClipboard(revision, {
    kind: 'table',
    operation: 'cut',
    tracked: false,
    selection: { kind: 'table', table: { start: 0, end: 39 }, anchor: { row: 1, column: 1 }, focus: { row: 1, column: 2 } }
  })
  expect(cut.edits).toEqual([])
  const selection = cut.selection as DocumentTableCellSelection
  expect(selection).toEqual({ kind: 'table-cell', cell: { table: { start: 0, end: 39 }, row: 1, column: 1 }, anchor: 0, focus: 0 })
  const action = { selection, range: selection, inputType: 'insertText', data: 'y', options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  if (edits === undefined) throw new Error('Implicit cell input refused')
  const commit = core.apply(revision, edits)
  expect(commit.revision.source).toBe('| a | b | c |\n| --- | --- | --- |\n| x |     y|\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({
    kind: 'table-cell', cell: { table: { start: 0, end: 46 }, row: 1, column: 1 }, anchor: 1, focus: 1
  })
})

it('uses the ordinary pair policy while materializing a later missing cell', () => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: 39 }, row: 1, column: 2 }, anchor: 0, focus: 0 }
  const action = { selection, range: selection, inputType: 'insertText', data: '(', options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  if (edits === undefined) throw new Error('Implicit cell pairing refused')
  const commit = core.apply(revision, edits)
  expect(commit.revision.source).toBe('| a | b | c |\n| --- | --- | --- |\n| x |     |     ()|\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({
    kind: 'table-cell', cell: { table: { start: 0, end: 53 }, row: 1, column: 2 }, anchor: 1, focus: 1
  })
})

it.each(['deleteContentBackward', 'cancelComposition'])('does not materialize an untouched missing cell for %s', inputType => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: 39 }, row: 1, column: 2 }, anchor: 0, focus: 0 }
  const action = { selection, range: selection, inputType, data: null, options }
  const plan = core.planInput(revision, action)
  const commit = core.apply(revision, core.inputEdits(revision, action, plan, false) ?? [])
  expect(commit.revision.source).toBe(source)
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual(selection)
})

it('materializes a missing cell in a body row without a trailing pipe', () => {
  const core = createDocumentCore()
  const revision = core.open('| a | b | c |\n| --- | --- | --- |\n| x\n')
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: 37 }, row: 1, column: 1 }, anchor: 0, focus: 0 }
  const action = { selection, range: selection, inputType: 'insertText', data: 'y', options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  if (edits === undefined) throw new Error('Missing cell input refused')
  const commit = core.apply(revision, edits)
  expect(commit.revision.source).toBe('| a | b | c |\n| --- | --- | --- |\n| x|     y|\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toMatchObject({ kind: 'table-cell', cell: { row: 1, column: 1 }, anchor: 1, focus: 1 })
})

it.each([false, true])('keeps current physical cell identity and annotation ownership with Track %s', tracked => {
  const core = createDocumentCore()
  const revision = core.open('| a{++bc++}d | e |\n| --- | --- |\n')
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: 32 }, row: 0, column: 0 }, anchor: 5, focus: 5 }
  const action = { selection, range: selection, inputType: 'insertText', data: 'x', options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, tracked)
  if (edits === undefined) throw new Error('Physical cell input refused')
  const commit = core.apply(revision, edits)
  expect(commit.revision.source).toBe('| a{++bxc++}d | e |\n| --- | --- |\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toMatchObject({ kind: 'table-cell', cell: { row: 0, column: 0 }, anchor: 6, focus: 6 })
})

it('navigates Enter from an intrinsic header cell to the first body cell', () => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: 39 }, row: 0, column: 1 }, anchor: 1, focus: 1 }
  const action = { selection, range: selection, inputType: 'insertParagraph', data: null, options }
  const plan = core.planInput(revision, action)
  const commit = core.apply(revision, core.inputEdits(revision, action, plan, false) ?? [])
  expect(commit.revision.source).toBe(source)
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ kind: 'table-cell', cell: { table: { start: 0, end: 39 }, row: 1, column: 0 }, anchor: 0, focus: 0 })
})

it('navigates Enter out of an implicit final-row cell without materializing it', () => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: 39 }, row: 1, column: 2 }, anchor: 0, focus: 0 }
  const action = { selection, range: selection, inputType: 'insertParagraph', data: null, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  if (edits === undefined) throw new Error('Table exit refused')
  const commit = core.apply(revision, edits)
  expect(commit.revision.source).toBe(source + '\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 41, focus: 41 }], primary: 0 })
})

it.each(['insertTableColumn', 'removeTableColumn'] as const)('targets the addressed omitted column for %s', command => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: 39 }, row: 1, column: 2 }, anchor: 0, focus: 0 }
  const action = command === 'insertTableColumn'
    ? { kind: 'command' as const, command, placement: 'before' as const, selection, options }
    : { kind: 'command' as const, command, selection, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  if (edits === undefined) throw new Error('Addressed column command refused')
  const commit = core.apply(revision, edits)
  expect(commit.revision.source).toBe(command === 'insertTableColumn'
    ? '| a | b |     | c |\n| --- | --- | --- | --- |\n| x |     |     |\n'
    : '| a | b |\n| --- | --- |\n| x |\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toMatchObject({ kind: 'table-cell', cell: { row: 0, column: command === 'insertTableColumn' ? 2 : 1 }, anchor: 0, focus: 0 })
})

it('preserves the intrinsic cell after deleting its entire content', () => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: 39 }, row: 1, column: 0 }, anchor: 0, focus: 1 }
  const action = { selection, range: selection, inputType: 'deleteContentBackward', data: null, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, false)
  if (edits === undefined) throw new Error('Cell content deletion refused')
  const commit = core.apply(revision, edits)
  expect(commit.revision.source).toBe('| a | b | c |\n| --- | --- | --- |\n|  |\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ kind: 'table-cell', cell: { table: { start: 0, end: 38 }, row: 1, column: 0 }, anchor: 0, focus: 0 })
})

it('tracks omitted-cell materialization using the existing shared compiler', () => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: 39 }, row: 1, column: 1 }, anchor: 0, focus: 0 }
  const action = { selection, range: selection, inputType: 'insertText', data: 'y', options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, true)
  if (edits === undefined) throw new Error('Tracked cell input refused')
  const commit = core.apply(revision, edits)
  expect(core.project(commit.revision, 'original').markdown).toBe(source)
  expect(core.project(commit.revision, 'revised').markdown).toBe('| a | b | c |\n| --- | --- | --- |\n| x |     y|\n')
  expect(core.reconcileInput(revision, plan, commit, action).selection).toMatchObject({ kind: 'table-cell', cell: { row: 1, column: 1 }, anchor: 1, focus: 1 })
})

it.each(['removeTableRow', 'removeTableColumn'] as const)('keeps the caret outside a wholly deleted table for tracked %s', command => {
  const core = createDocumentCore()
  const source = command === 'removeTableRow' ? '| aa | aa |\n| :--- | ---: |\n' : '| aa |\n| :--- |\n| bb |\n'
  const revision = core.open(source)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: source.length - 1 }, row: 0, column: 0 }, anchor: 2, focus: 2 }
  const action = { kind: 'command' as const, command, selection, options }
  const plan = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, plan, true)
  if (edits === undefined) throw new Error('Tracked table removal refused')
  const commit = core.apply(revision, edits)
  expect(commit.revision.source).toBe('{--' + source.slice(0, -1) + '--}\n')
  const result = core.reconcileInput(revision, plan, commit, action)
  expect(result.selection).toEqual({ ranges: [{ anchor: source.length + 5, focus: source.length + 5 }], primary: 0 })
  if (result.selection === undefined) throw new Error('Table removal has no selection')
  const input = { selection: result.selection, range: { start: source.length + 5, end: source.length + 5 }, inputType: 'insertText', data: 'x', options }
  const next = core.planInput(commit.revision, input)
  const typed = core.inputEdits(commit.revision, input, next, true)
  if (typed === undefined) throw new Error('Typing after tracked removal refused')
  expect(core.apply(commit.revision, typed).revision.source).toBe('{--' + source.slice(0, -1) + '--}{++x++}\n')
})
