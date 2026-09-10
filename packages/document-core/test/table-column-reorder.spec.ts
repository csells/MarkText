import { expect, it } from 'vitest'
import { createDocumentCore, rebaseDocumentInputSelection, type DocumentInputAction, type DocumentTableCellSelection } from '../src/index.js'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
const source = '| same | same |\n| :--- | ---: |\n| one{++kept++}{>>note<<} | onekept |\n'
const expected = '| same | same |\n| ---: | :--- |\n| onekept | one{++kept++}{>>note<<} |\n'

it('retains separate owned tables for a structural replacement', () => {
  const core = createDocumentCore()
  const revision = core.open(`{~~${source.slice(0, -1)}~>${expected.slice(0, -1)}~~}\n`)
  expect(core.project(revision, 'markup').syntax.ast.root.children.map(node => node.kind)).toEqual(['table', 'table'])
  expect(core.project(revision, 'original').markdown).toBe('| same | same |\n| :--- | ---: |\n| one | onekept |\n')
  expect(core.project(revision, 'revised').markdown).toBe('| same | same |\n| ---: | :--- |\n| onekept | onekept |\n')
})

it('moves the owned column even when its exposed cells are identical', () => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'moveTableColumn',
    target: { table: { start: 0, end: source.length - 1 }, row: 1, column: 0 },
    column: 1,
    selection: { kind: 'table-cell', cell: { table: { start: 0, end: source.length - 1 }, row: 1, column: 0 }, anchor: 1, focus: 1 },
    options
  }
  const policy = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, policy, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  expect(commit.revision.source).toBe(expected)
  const result = core.reconcileInput(revision, policy, commit, action)
  expect(result.selection).toEqual({ kind: 'table-cell', cell: { table: { start: 0, end: expected.length - 1 }, row: 1, column: 1 }, anchor: 1, focus: 1 })
  expect(rebaseDocumentInputSelection(core, revision, commit, action.selection, { affinity: 'before', operation: { kind: 'input', action, tracked: false } })).toEqual({ kind: 'mapped', selection: result.selection })
})

it('tracks a column move while preserving both owned projections', () => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const action: DocumentInputAction = {
    kind: 'command',
    command: 'moveTableColumn',
    target: { table: { start: 0, end: source.length - 1 }, row: 1, column: 0 },
    column: 1,
    selection: { kind: 'table-cell', cell: { table: { start: 0, end: source.length - 1 }, row: 1, column: 0 }, anchor: 1, focus: 1 },
    options
  }
  const policy = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, policy, true)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  expect(core.project(commit.revision, 'markup').syntax.ast.root.children.map(node => node.kind)).toEqual(['table', 'table'])
  expect(core.project(commit.revision, 'original').markdown).toBe('| same | same |\n| :--- | ---: |\n| one | onekept |\n')
  expect(core.project(commit.revision, 'revised').markdown).toBe('| same | same |\n| ---: | :--- |\n| onekept | onekept |\n')
  expect(commit.revision.source).toBe('{~~| same | same |\n| :--- | ---: |\n| one{++kept++}{>>note<<} | onekept |~>| same | same |\n| ---: | :--- |\n| onekept | one{++kept++}{>>note<<} |~~}\n')
  const selection = core.reconcileInput(revision, policy, commit, action).selection
  expect(selection).toEqual({ kind: 'table-cell', cell: { table: { start: 74, end: 146 }, row: 1, column: 1 }, anchor: 1, focus: 1 })
  expect(rebaseDocumentInputSelection(core, revision, commit, action.selection, { affinity: 'before', operation: { kind: 'input', action, tracked: true } })).toEqual({ kind: 'mapped', selection })
})

it.each([false, true])('keeps an omitted cell and an outside caret through a column move (Track %s)', tracked => {
  const core = createDocumentCore()
  const text = '| a | b | c |\r\n| --- | --- | --- |\r\n| x |\r\n\r\noutside\r\n'
  const revision = core.open(text)
  const retained: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: 41 }, row: 1, column: 2 }, anchor: 0, focus: 0 }
  const selection = { ranges: [{ anchor: 46, focus: 49 }], primary: 0 }
  const action: DocumentInputAction = { kind: 'command', command: 'moveTableColumn', target: { ...retained.cell, row: 0 }, column: 0, selection, options }
  const policy = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, policy, tracked)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  expect(core.project(commit.revision, 'revised').markdown).toBe('| c | a | b |\r\n| --- | --- | --- |\r\n|     | x |     |\r\n\r\noutside\r\n')
  const result = rebaseDocumentInputSelection(core, revision, commit, retained, { affinity: 'before', operation: { kind: 'input', action, tracked } })
  expect(result).toMatchObject({ kind: 'mapped', selection: { kind: 'table-cell', cell: { row: 1, column: 0 }, anchor: 0, focus: 0 } })
  const current = core.reconcileInput(revision, policy, commit, action).selection
  expect(current).toEqual({ ranges: [{ anchor: commit.revision.source.indexOf('outside') + 1, focus: commit.revision.source.indexOf('outside') + 4 }], primary: 0 })
})

it('moves a pending replacement table again without consuming its enclosing suggestion', () => {
  const core = createDocumentCore()
  const revision = core.open('{~~| same | same |\n| :--- | ---: |\n| one{++kept++}{>>note<<} | onekept |~>| same | same |\n| ---: | :--- |\n| onekept | one{++kept++}{>>note<<} |~~}\n')
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 74, end: 146 }, row: 1, column: 1 }, anchor: 1, focus: 1 }
  const action: DocumentInputAction = { kind: 'command', command: 'moveTableColumn', target: selection.cell, column: 0, selection, options }
  const policy = core.planInput(revision, action)
  const edits = core.inputEdits(revision, action, policy, true)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  expect(commit.revision.source).toBe('{~~| same | same |\n| :--- | ---: |\n| one{++kept++}{>>note<<} | onekept |~>| same | same |\n| :--- | ---: |\n| one{++kept++}{>>note<<} | onekept |~~}\n')
  expect(core.reconcileInput(revision, policy, commit, action).selection).toEqual({ kind: 'table-cell', cell: { table: { start: 74, end: 146 }, row: 1, column: 0 }, anchor: 1, focus: 1 })
})

it.each([false, true])('moves a row by ownership and retains its pending cell target (Track %s)', tracked => {
  const core = createDocumentCore()
  const text = '| same | same |\n| ---- | ---- |\n| sa{++me++}{>>note<<} | same |\n| same | same |\n'
  const moved = '| same | same |\n| ---- | ---- |\n| same | same |\n| sa{++me++}{>>note<<} | same |'
  const previous = core.open(text)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: text.length - 1 }, row: 1, column: 0 }, anchor: 1, focus: 1 }
  const action: DocumentInputAction = { kind: 'command', command: 'moveTableRow', target: selection.cell, row: 2, selection, options }
  const policy = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, policy, tracked)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits ?? [])
  expect(commit.revision.source).toBe(tracked ? `{~~${text.slice(0, -1)}~>${moved}~~}\n` : moved + '\n')
  const result = core.reconcileInput(previous, policy, commit, action).selection
  expect(result).toMatchObject({ kind: 'table-cell', cell: { row: 2, column: 0 }, anchor: 1, focus: 1 })
  expect(rebaseDocumentInputSelection(core, previous, commit, selection, { affinity: 'before', operation: { kind: 'input', action, tracked } })).toEqual({ kind: 'mapped', selection: result })
})

it.each([false, true])('moves a whole-row annotation with its row (Track %s)', tracked => {
  const core = createDocumentCore()
  const text = '| same | same |\n| ---- | ---- |\n{++| same | same |++}\n| same | same |\n'
  const moved = '| same | same |\n| ---- | ---- |\n| same | same |\n{++| same | same |++}'
  const previous = core.open(text)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: text.length - 1 }, row: 1, column: 0 }, anchor: 1, focus: 1 }
  const action: DocumentInputAction = { kind: 'command', command: 'moveTableRow', target: selection.cell, row: 2, selection, options }
  const policy = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, policy, tracked)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits ?? [])
  expect(commit.revision.source).toBe(tracked ? `{~~${text.slice(0, -1)}~>${moved}~~}\n` : moved + '\n')
  expect(core.reconcileInput(previous, policy, commit, action).selection).toMatchObject({ kind: 'table-cell', cell: { row: 2, column: 0 }, anchor: 1, focus: 1 })
  const selected = core.reconcileInput(previous, policy, commit, action).selection
  if (selected?.kind !== 'table-cell') throw new Error('Missing moved row selection')
  const back: DocumentInputAction = { ...action, selection: selected, target: selected.cell, row: 1 }
  const backPlan = core.planInput(commit.revision, back)
  const backEdits = core.inputEdits(commit.revision, back, backPlan, tracked)
  expect(backEdits).toBeDefined()
  const restored = core.apply(commit.revision, backEdits ?? [])
  expect(restored.revision.source).toBe(tracked ? `{~~${text.slice(0, -1)}~>${text.slice(0, -1)}~~}\n` : text)
})

it.each([false, true])('promotes an omitted-cell row to a complete editable header (Track %s)', tracked => {
  const core = createDocumentCore()
  const text = '| a | b |\n| --- | --- |\n| x |\n'
  const previous = core.open(text)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: text.length - 1 }, row: 1, column: 1 }, anchor: 0, focus: 0 }
  const action: DocumentInputAction = { kind: 'command', command: 'moveTableRow', target: selection.cell, row: 0, selection, options }
  const policy = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, policy, tracked)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits ?? [])
  expect(core.project(commit.revision, 'revised').markdown).toBe('| x |     |\n| --- | --- |\n| a | b |\n')
  expect(core.project(commit.revision, 'markup').syntax.ast.root.children.map(node => node.kind)).toEqual(tracked ? ['table', 'table'] : ['table'])
  expect(core.reconcileInput(previous, policy, commit, action).selection).toMatchObject({ kind: 'table-cell', cell: { row: 0, column: 1 }, anchor: 0, focus: 0 })
})
