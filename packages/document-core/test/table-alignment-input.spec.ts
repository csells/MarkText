import { expect, it } from 'vitest'
import { createDocumentCore, rebaseDocumentInputSelection, projectTableSelection, type DocumentTableCellSelection, type DocumentInputAction } from '../src/index.js'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
const source = '| a{++a++} | bb |\r\n|  ---  | ---: |\r\n| cc | dd |\r\n'
const action = (text: string, alignment: 'left' | 'center' | 'right' = 'center'): Extract<DocumentInputAction, { command: 'alignTableColumn' }> => ({
  kind: 'command',
  command: 'alignTableColumn',
  alignment,
  target: { table: { start: 0, end: text.length - 2 }, row: 0, column: 0 },
  selection: { ranges: [{ anchor: text.indexOf('dd') + 1, focus: text.indexOf('dd') + 1 }], primary: 0 },
  options
})

it('changes only the owned delimiter slot and preserves another column caret', () => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const request = action(source)
  const plan = core.planInput(revision, request)
  const edits = core.inputEdits(revision, request, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  const expected = source.replace('  ---  ', '  :---:  ')
  expect(commit.revision.source).toBe(expected)
  expect(core.reconcileInput(revision, plan, commit, request).selection).toEqual({ ranges: [{ anchor: expected.indexOf('dd') + 1, focus: expected.indexOf('dd') + 1 }], primary: 0 })
  const next = core.planInput(commit.revision, action(expected))
  expect(core.apply(commit.revision, core.inputEdits(commit.revision, action(expected), next, false) ?? []).revision.source).toBe(source)
})

it('tracks alignment without altering CriticMarkup cell content', () => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const request = action(source, 'left')
  const plan = core.planInput(revision, request)
  const edits = core.inputEdits(revision, request, plan, true)
  expect(edits).toBeDefined()
  const commit = core.apply(revision, edits ?? [])
  expect(core.project(commit.revision, 'original').markdown).toBe(source.replace('{++a++}', ''))
  expect(core.project(commit.revision, 'revised').markdown).toBe(source.replace('{++a++}', 'a').replace('  ---  ', '  :---  '))
  expect(commit.revision.source).toBe(source.replace('  ---  ', '  {++:++}---  '))
  expect(core.reconcileInput(revision, plan, commit, request).selection).toBeDefined()
})

it('rejects a target from a table that no longer exists', () => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const revision = core.apply(previous, [{ start: 0, end: source.length, insert: 'plain\n' }]).revision
  expect(() => core.planInput(revision, { ...action(source), selection: { ranges: [{ anchor: 0, focus: 0 }], primary: 0 } })).toThrow()
})

it.each(['left', 'center', 'right'] as const)('preserves an omitted current cell and retained target during %s alignment', alignment => {
  const text = '| a | b | c |\n| --- | --- | --- |\n| x |\n'
  const core = createDocumentCore()
  const previous = core.open(text)
  const selected: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: text.length - 1 }, row: 1, column: 2 }, anchor: 0, focus: 0 }
  const request: DocumentInputAction = { kind: 'command', command: 'alignTableColumn', target: { ...selected.cell, row: 0 }, alignment, selection: selected, options }
  const plan = core.planInput(previous, request)
  const edits = core.inputEdits(previous, request, plan, false)
  expect(edits).toBeDefined()
  const commit = core.apply(previous, edits ?? [])
  const expected = { ...selected, cell: { ...selected.cell, table: { start: 0, end: commit.revision.source.length - 1 } } }
  expect(core.reconcileInput(previous, plan, commit, request).selection).toEqual(expected)
  expect(rebaseDocumentInputSelection(core, previous, commit, selected, { affinity: 'before', operation: { kind: 'input', action: request, tracked: false } })).toEqual({ kind: 'mapped', selection: expected })
  expect(commit.revision.source.endsWith('| x |\n')).toBe(true)
})

it('reuses shifted parser-owned delimiter token positions after incremental edits', () => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const revision = core.apply(previous, [{ start: 0, end: 0, insert: 'before\r\n\r\n' }]).revision
  const prefix = 'before\r\n\r\n'.length
  const request: DocumentInputAction = { ...action(revision.source), target: { table: { start: prefix, end: revision.source.length - 2 }, row: 0, column: 0 } }
  const plan = core.planInput(revision, request)
  const fresh = createDocumentCore()
  expect(plan).toEqual(fresh.planInput(fresh.open(revision.source), request))
  expect(core.apply(revision, core.inputEdits(revision, request, plan, false) ?? []).revision.source).toBe('before\r\n\r\n' + source.replace('  ---  ', '  :---:  '))
})

it('publishes delimiter token positions in the selected table projection coordinate domain', () => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const projected = projectTableSelection(core, revision, { kind: 'table', table: { start: 0, end: source.length - 2 }, anchor: { row: 0, column: 1 }, focus: { row: 1, column: 1 } })
  const cell = projected.ast.root.children[0]?.children[0]?.children[0]
  if (cell === undefined) throw new Error('Expected projected header')
  const from = cell.attributes.delimiterContentStart
  const to = cell.attributes.delimiterContentEnd
  if (typeof from !== 'number' || typeof to !== 'number') throw new Error('Expected intrinsic token positions')
  expect(projected.markdown.slice(from, to)).toBe('---:')
})

it.each(['left', 'center', 'right'] as const)('cancels pending colon additions when toggling tracked %s alignment off', alignment => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const first = action(source, alignment)
  const firstPlan = core.planInput(previous, first)
  const firstEdits = core.inputEdits(previous, first, firstPlan, true)
  expect(firstEdits).toBeDefined()
  const centered = core.apply(previous, firstEdits ?? []).revision
  const delimiter = alignment === 'center' ? '{++:++}---{++:++}' : alignment === 'left' ? '{++:++}---' : '---{++:++}'
  expect(centered.source).toBe(source.replace('  ---  ', `  ${delimiter}  `))
  const second = action(centered.source, alignment)
  const secondPlan = core.planInput(centered, second)
  const secondEdits = core.inputEdits(centered, second, secondPlan, true)
  expect(secondEdits).toBeDefined()
  const commit = core.apply(centered, secondEdits ?? [])
  expect(commit.revision.source).toBe(source)
  const result = core.reconcileInput(centered, secondPlan, commit, second)
  expect(result.selection).toEqual({ ranges: [{ anchor: source.indexOf('dd') + 1, focus: source.indexOf('dd') + 1 }], primary: 0 })
})
