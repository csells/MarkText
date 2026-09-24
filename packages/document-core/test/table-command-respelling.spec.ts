import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type DocumentTableCellSelection } from '../src/index.js'

const options = { autoPairBracket: false, autoPairMarkdownSyntax: false, autoPairQuote: false }
const table = '| a | bb |\n|---|:-:|\n| ccc | d |\n'

type Command = { command: 'insertTableRow' | 'insertTableColumn', placement: 'before' | 'after' } |
  { command: 'removeTableRow' | 'removeTableColumn' } |
  { command: 'alignTableColumn', alignment: 'left' | 'center' | 'right' } |
  { command: 'moveTableRow', row: number } | { command: 'moveTableColumn', column: number }

const tableRange = (source: string) => ({ start: source.indexOf('|'), end: source.includes('\n\n') ? source.indexOf('\n\n') : source.trimEnd().length })

const run = (source: string, row: number, column: number, anchor: number, command: Command, tracked: boolean) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const cell = { table: tableRange(source), row, column }
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell, anchor, focus: anchor }
  const targeted = command.command === 'alignTableColumn' || command.command === 'moveTableRow' || command.command === 'moveTableColumn' ? { target: cell } : {}
  const action = { kind: 'command', selection, options, ...targeted, ...command } as DocumentInputAction
  const plan = core.planInput(revision, action, { tracked })
  const edits = core.inputEdits(revision, action, plan, tracked)
  if (edits === undefined) throw new Error('Command refused')
  const commit = core.apply(revision, edits)
  const result = core.reconcileInput(revision, plan, commit, action)
  // One admitted change: its inverse restores the exact original bytes.
  let shift = 0
  const inverse = commit.change.appliedEdits.map((edit) => {
    const start = edit.start + shift
    shift += edit.insert.length - (edit.end - edit.start)
    return { start, end: start + edit.insert.length, insert: source.slice(edit.start, edit.end) }
  })
  const undone = core.apply(commit.revision, inverse).revision.source
  return { source: commit.revision.source, selection: result.selection, undone }
}

const at = (source: string, row: number, column: number, offset: number) => ({
  kind: 'table-cell', cell: { table: tableRange(source), row, column }, anchor: offset, focus: offset
})

// Upstream (8d6c198c) serializes the table afresh from its cells after every
// table command, so each command writes the padded table and the caret lands
// in the cell upstream focuses.
describe('an untracked table command writes the table afresh', () => {
  it.each([
    { name: 'Cmd+Enter / insert row below', row: 1, column: 0, anchor: 1, command: { command: 'insertTableRow', placement: 'after' }, expected: '| a   | bb  |\n| --- |:---:|\n| ccc | d   |\n|     |     |\n', caret: [2, 0, 0] },
    { name: 'insert row above the header', row: 0, column: 0, anchor: 0, command: { command: 'insertTableRow', placement: 'before' }, expected: '|     |     |\n| --- |:---:|\n| a   | bb  |\n| ccc | d   |\n', caret: [0, 0, 0] },
    { name: 'insert row above a body row', row: 1, column: 1, anchor: 0, command: { command: 'insertTableRow', placement: 'before' }, expected: '| a   | bb  |\n| --- |:---:|\n|     |     |\n| ccc | d   |\n', caret: [1, 0, 0] },
    { name: 'insert column right', row: 0, column: 0, anchor: 1, command: { command: 'insertTableColumn', placement: 'after' }, expected: '| a   |     | bb  |\n| --- | --- |:---:|\n| ccc |     | d   |\n', caret: [0, 1, 0] },
    { name: 'insert column left', row: 1, column: 1, anchor: 0, command: { command: 'insertTableColumn', placement: 'before' }, expected: '| a   |     | bb  |\n| --- | --- |:---:|\n| ccc |     | d   |\n', caret: [0, 1, 0] },
    { name: 'remove body row', row: 1, column: 0, anchor: 1, command: { command: 'removeTableRow' }, expected: '| a   | bb  |\n| --- |:---:|\n', caret: [0, 0, 0] },
    { name: 'remove header row', row: 0, column: 0, anchor: 0, command: { command: 'removeTableRow' }, expected: '| ccc | d   |\n| --- |:---:|\n', caret: [0, 0, 0] },
    { name: 'remove column', row: 0, column: 1, anchor: 0, command: { command: 'removeTableColumn' }, expected: '| a   |\n| --- |\n| ccc |\n', caret: [0, 0, 0] },
    { name: 'align column right', row: 1, column: 0, anchor: 1, command: { command: 'alignTableColumn', alignment: 'right' }, expected: '| a   | bb  |\n| ---:|:---:|\n| ccc | d   |\n', caret: [1, 0, 1] },
    { name: 'toggle column alignment off', row: 1, column: 1, anchor: 1, command: { command: 'alignTableColumn', alignment: 'center' }, expected: '| a   | bb  |\n| --- | --- |\n| ccc | d   |\n', caret: [1, 1, 1] },
    { name: 'move row up', row: 1, column: 0, anchor: 2, command: { command: 'moveTableRow', row: 0 }, expected: '| ccc | d   |\n| --- |:---:|\n| a   | bb  |\n', caret: [0, 0, 2] },
    { name: 'move column right', row: 1, column: 0, anchor: 2, command: { command: 'moveTableColumn', column: 1 }, expected: '| bb  | a   |\n|:---:| --- |\n| d   | ccc |\n', caret: [1, 1, 2] }
  ] as const)('$name', ({ row, column, anchor, command, expected, caret }) => {
    const result = run(table, row, column, anchor, command as Command, false)
    expect(result.source).toBe(expected)
    expect(result.selection).toEqual(at(expected, caret[0], caret[1], caret[2]))
    expect(result.undone).toBe(table)
  })

  it('keeps a container prefix and CRLF endings', () => {
    const quoted = '> | a | bb |\r\n> |---|:-:|\r\n> | ccc | d |\r\n'
    const result = run(quoted, 1, 0, 1, { command: 'insertTableRow', placement: 'after' }, false)
    expect(result.source).toBe('> | a   | bb  |\r\n> | --- |:---:|\r\n> | ccc | d   |\r\n> |     |     |\r\n')
    expect(result.undone).toBe(quoted)
  })

  it('keeps each cell\'s annotations and inline syntax', () => {
    const annotated = '| a{++x++} | **b** |\n|---|---|\n| c | d |\n'
    const result = run(annotated, 1, 0, 1, { command: 'insertTableRow', placement: 'after' }, false)
    expect(result.source).toBe('| a{++x++} | **b** |\n| -------- | ----- |\n| c        | d     |\n|          |       |\n')
    expect(result.undone).toBe(annotated)
  })
})

it('leaves a following table alone when a command removes the whole table', () => {
  const source = '| a |\n|---|\n\n| b | c |\n|---|---|\n'
  const result = run(source, 0, 0, 0, { command: 'removeTableColumn' }, false)
  expect(result.source).not.toContain('| a')
  expect(result.source).toContain('| b | c |\n|---|---|\n')
  expect(result.undone).toBe(source)
})

it('completes short rows and drops cells beyond the header', () => {
  const source = '| a | b |\n|---|---|\n| c |\n| d | e | f |\n'
  const result = run(source, 1, 0, 1, { command: 'insertTableRow', placement: 'after' }, false)
  expect(result.source).toBe('| a   | b   |\n| --- | --- |\n| c   |     |\n|     |     |\n| d   | e   |\n')
  expect(result.selection).toEqual(at(result.source, 2, 0, 0))
  expect(result.undone).toBe(source)
})

describe('a tracked table command', () => {
  it('suggests only the structural change, never padding', () => {
    const tracked = run(table, 1, 0, 1, { command: 'alignTableColumn', alignment: 'right' }, true)
    expect(tracked.source).not.toContain('| a   |')
    expect(tracked.undone).toBe(table)
  })
})

describe('an untracked edit of a cell\'s text through another command', () => {
  const cellCaret = (source: string, row: number, column: number, anchor: number, focus = anchor): DocumentTableCellSelection =>
    ({ kind: 'table-cell', cell: { table: tableRange(source), row, column }, anchor, focus })

  it('pastes into a cell and writes the table afresh', () => {
    const core = createDocumentCore()
    const revision = core.open(table)
    const plan = core.planClipboard(revision, { kind: 'paste', selection: cellCaret(table, 1, 0, 3), markdown: 'xyz', tracked: false })
    const result = core.apply(revision, plan.edits).revision.source
    expect(result).toBe('| a      | bb  |\n| ------ |:---:|\n| cccxyz | d   |\n')
    expect(plan.selection).toEqual(cellCaret(result, 1, 0, 6))
  })

  it('suggests a tracked paste without padding', () => {
    const core = createDocumentCore()
    const revision = core.open(table)
    const plan = core.planClipboard(revision, { kind: 'paste', selection: cellCaret(table, 1, 0, 3), markdown: 'xyz', tracked: true })
    expect(core.apply(revision, plan.edits).revision.source).toBe('| a | bb |\n|---|:-:|\n| ccc{++xyz++} | d |\n')
  })

  it('formats a cell\'s text and writes the table afresh', () => {
    const core = createDocumentCore()
    const revision = core.open(table)
    const start = table.indexOf('ccc')
    const plan = core.planFormat(revision, { format: 'strong', selection: { ranges: [{ anchor: start, focus: start + 3 }], primary: 0 }, tracked: false })
    const result = core.apply(revision, plan.edits).revision.source
    expect(result).toBe('| a       | bb  |\n| ------- |:---:|\n| **ccc** | d   |\n')
    const formatted = result.indexOf('**ccc**')
    expect(plan.selection).toEqual({ ranges: [{ anchor: formatted + 2, focus: formatted + 5 }], primary: 0 })
  })

  it('cuts selected cells\' text and writes the table afresh', () => {
    const core = createDocumentCore()
    const revision = core.open(table)
    const selection = { kind: 'table' as const, table: tableRange(table), anchor: { row: 1, column: 0 }, focus: { row: 1, column: 0 } }
    const plan = core.planClipboard(revision, { kind: 'table', operation: 'cut', selection, tracked: false })
    const result = core.apply(revision, plan.edits).revision.source
    expect(result).toBe('| a   | bb  |\n| --- |:---:|\n|     | d   |\n')
    expect(plan.selection).toEqual(cellCaret(result, 1, 0, 0))
  })
})

describe('an untracked cut of a cell\'s text', () => {
  const cellCut = (source: string, row: number, column: number, anchor: number, focus: number) => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: { start: 0, end: source.trimEnd().length }, row, column }, anchor, focus }
    const plan = core.planClipboard(revision, { kind: 'cut', selection, tracked: false })
    return { source: core.apply(revision, plan.edits).revision.source, selection: plan.selection }
  }

  it.each([
    { name: 'the whole text of a body cell', source: table, row: 1, column: 0, anchor: 0, focus: 3, expected: '| a   | bb  |\n| --- |:---:|\n|     | d   |\n' },
    { name: 'the whole text of a header cell', source: table, row: 0, column: 0, anchor: 0, focus: 1, expected: '|     | bb  |\n| --- |:---:|\n| ccc | d   |\n' },
    { name: 'a header cell without outer pipes', source: 'a|b\n-|-\nc|d\n', row: 0, column: 0, anchor: 0, focus: 1, expected: '|     | b   |\n| --- | --- |\n| c   | d   |\n' },
    { name: 'a body cell without outer pipes', source: 'a|b\n-|-\nc|d\n', row: 1, column: 1, anchor: 0, focus: 1, expected: '| a   | b   |\n| --- | --- |\n| c   |     |\n' }
  ])('empties $name and writes the table afresh', ({ source, row, column, anchor, focus, expected }) => {
    const result = cellCut(source, row, column, anchor, focus)
    expect(result.source).toBe(expected)
    expect(result.selection).toEqual(at(expected, row, column, 0))
  })
})

describe('an untracked paragraph join into a table cell', () => {
  const initial = `${table}\npara\n`
  const joined = '| a   | bb    |\n| --- |:-----:|\n| ccc | dpara |\n'
  const join = (command: 'joinParagraphBackward' | 'joinParagraphForward', selection: DocumentInputAction['selection']) => {
    const core = createDocumentCore()
    const revision = core.open(initial)
    const action = { kind: 'command', command, selection, options } as DocumentInputAction
    const plan = core.planInput(revision, action, { tracked: false })
    const edits = core.inputEdits(revision, action, plan, false)
    if (edits === undefined) throw new Error('Join refused')
    const commit = core.apply(revision, edits)
    return { source: commit.revision.source, selection: core.reconcileInput(revision, plan, commit, action).selection }
  }
  const caret = (source: string) => source.indexOf('dpara') + 1

  it('Backspace at the paragraph start', () => {
    const start = initial.indexOf('para')
    const result = join('joinParagraphBackward', { ranges: [{ anchor: start, focus: start }], primary: 0 })
    expect(result.source).toBe(joined)
    expect(result.selection).toEqual({ ranges: [{ anchor: caret(joined), focus: caret(joined) }], primary: 0 })
  })

  it('Delete at the end of the last cell', () => {
    const result = join('joinParagraphForward', { kind: 'table-cell', cell: { table: tableRange(initial), row: 1, column: 1 }, anchor: 1, focus: 1 })
    expect(result.source).toBe(joined)
    expect(result.selection).toEqual(at(joined, 1, 1, 1))
  })

  it('suggests a tracked join without padding', () => {
    const core = createDocumentCore()
    const revision = core.open(initial)
    const start = initial.indexOf('para')
    const action = { kind: 'command', command: 'joinParagraphBackward', selection: { ranges: [{ anchor: start, focus: start }], primary: 0 }, options } as DocumentInputAction
    const plan = core.planInput(revision, action, { tracked: true })
    const edits = core.inputEdits(revision, action, plan, true)
    expect(core.apply(revision, edits ?? []).revision.source).not.toContain('| a   |')
  })
})

describe('an untracked edit addressed by a cell\'s model text', () => {
  const escaped = '| a\\|z | b |\n| --- | --- |\n| c | d |\n'
  // The caret after `a`, before the escaped pipe, in the text's model value.
  const point = { text: { start: 2, end: 6 }, offset: 1 }
  const edit = (inputType: string, data: string | null) => {
    const core = createDocumentCore()
    const revision = core.open(escaped)
    const selection = { kind: 'model-text' as const, anchor: point, focus: point }
    const range = data === null ? { ...selection, anchor: { ...point, offset: 0 } } : selection
    const action = { selection, range, inputType, data, options } as DocumentInputAction
    const plan = core.planInput(revision, action, { tracked: false })
    const edits = core.inputEdits(revision, action, plan, false)
    if (edits === undefined) throw new Error('Input refused')
    const commit = core.apply(revision, edits)
    return { source: commit.revision.source, selection: core.reconcileInput(revision, plan, commit, action).selection }
  }

  it('types text and writes the table afresh, keeping the pipe escaped', () => {
    const result = edit('insertText', 'x')
    expect(result.source).toBe('| ax\\|z | b   |\n| ----- | --- |\n| c     | d   |\n')
    expect(result.selection).toEqual({ ranges: [{ anchor: 4, focus: 4 }], primary: 0 })
  })

  it('deletes text and writes the table afresh, keeping the pipe escaped', () => {
    const result = edit('deleteContentBackward', null)
    expect(result.source).toBe('| \\|z | b   |\n| --- | --- |\n| c   | d   |\n')
    expect(result.selection).toEqual({ ranges: [{ anchor: 2, focus: 2 }], primary: 0 })
  })
})

// Upstream (8d6c198c) keeps the grid of a table a selection reaches into.
describe('an untracked replacement of a selection reaching into a table', () => {
  const withParagraph = `${table}\npara\n`
  const before = `para\n\n${table}`
  const replace = (source: string, from: string, fromOffset: number, to: string, toOffset: number, markdown?: string) => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const anchor = source.indexOf(from) + fromOffset
    const focus = source.indexOf(to) + toOffset
    const selection = { ranges: [{ anchor, focus }], primary: 0 }
    const plan = core.planClipboard(revision, markdown === undefined ? { kind: 'cut', selection, tracked: false } : { kind: 'paste', selection, markdown, tracked: false })
    return { source: core.apply(revision, plan.edits).revision.source, selection: plan.selection }
  }
  const caret = (source: string, at: number) => ({ ranges: [{ anchor: at, focus: at }], primary: 0 })

  it.each([
    { name: 'between cells of a row', source: withParagraph, from: '| a', fromOffset: 2, to: 'bb', toOffset: 1, expected: '| b   |     |\n| --- |:---:|\n| ccc | d   |\n\npara\n', at: 2 },
    { name: 'between rows', source: withParagraph, from: 'bb', fromOffset: 1, to: 'ccc', toOffset: 1, expected: '| a   | bcc |\n| --- |:---:|\n|     | d   |\n\npara\n', at: 9 },
    { name: 'from a cell into the following paragraph', source: withParagraph, from: '| d', fromOffset: 2, to: 'para', toOffset: 2, expected: '| a   | bb  |\n| --- |:---:|\n| ccc | ra  |\n', at: 36 },
    // The cell keeps the text after the selection, as upstream does (#5405).
    { name: 'from a paragraph into the following table', source: before, from: 'para', fromOffset: 2, to: '| a', toOffset: 2, expected: 'pa\n\n| a   | bb  |\n| --- |:---:|\n| ccc | d   |\n', at: 2 }
  ])('cuts $name', ({ source, from, fromOffset, to, toOffset, expected, at }) => {
    const result = replace(source, from, fromOffset, to, toOffset)
    expect(result.source).toBe(expected)
    expect(result.selection).toEqual(caret(expected, at))
  })

  it('pastes over it with the pasted pipe escaped', () => {
    const result = replace(withParagraph, '| a', 2, 'bb', 1, 'p|q')
    expect(result.source).toBe('| p\\|qb |     |\n| ----- |:---:|\n| ccc   | d   |\n\npara\n')
    expect(result.selection).toEqual(caret(result.source, 6))
  })

  it('types over it', () => {
    const core = createDocumentCore()
    const revision = core.open(withParagraph)
    const anchor = withParagraph.indexOf('bb') + 1
    const focus = withParagraph.indexOf('ccc') + 1
    const selection = { ranges: [{ anchor, focus }], primary: 0 }
    const action = { selection, range: { start: anchor, end: focus }, inputType: 'insertText', data: 'x', options } as DocumentInputAction
    const plan = core.planInput(revision, action, { tracked: false })
    const edits = core.inputEdits(revision, action, plan, false)
    if (edits === undefined) throw new Error('Input refused')
    const commit = core.apply(revision, edits)
    expect(commit.revision.source).toBe('| a   | bxcc |\n| --- |:----:|\n|     | d    |\n\npara\n')
    expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual(caret(commit.revision.source, commit.revision.source.indexOf('bx') + 2))
  })

  it('leaves a tracked cut to suggest the deletion', () => {
    const core = createDocumentCore()
    const revision = core.open(withParagraph)
    const anchor = withParagraph.indexOf('bb') + 1
    const focus = withParagraph.indexOf('ccc') + 1
    const plan = core.planClipboard(revision, { kind: 'cut', selection: { ranges: [{ anchor, focus }], primary: 0 }, tracked: true })
    expect(core.apply(revision, plan.edits).revision.source).not.toContain('| a   |')
  })
})

describe('an untracked edit of the cell a short row lacks', () => {
  const short = '| a | b |\n| --- | --- |\n| c |\n'
  const cell = { table: { start: 0, end: short.length - 1 }, row: 1, column: 1 }

  it('pastes a pipe escaped and writes the table afresh', () => {
    const core = createDocumentCore()
    const revision = core.open(short)
    const plan = core.planClipboard(revision, { kind: 'paste', selection: { kind: 'table-cell', cell, anchor: 0, focus: 0 }, markdown: 'p|q', tracked: false })
    const result = core.apply(revision, plan.edits).revision.source
    expect(result).toBe('| a   | b    |\n| --- | ---- |\n| c   | p\\|q |\n')
    expect(plan.selection).toEqual(at(result, 1, 1, 4))
  })

  it('types into it and writes the table afresh', () => {
    const core = createDocumentCore()
    const revision = core.open(short)
    const selection: DocumentTableCellSelection = { kind: 'table-cell', cell, anchor: 0, focus: 0 }
    const action = { selection, range: selection, inputType: 'insertText', data: 'x', options } as DocumentInputAction
    const plan = core.planInput(revision, action, { tracked: false })
    const edits = core.inputEdits(revision, action, plan, false)
    if (edits === undefined) throw new Error('Input refused')
    const commit = core.apply(revision, edits)
    expect(commit.revision.source).toBe('| a   | b   |\n| --- | --- |\n| c   | x   |\n')
    expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual(at(commit.revision.source, 1, 1, 1))
  })
})

it('writes the table afresh when Enter in its last row starts a paragraph', () => {
  const core = createDocumentCore()
  const revision = core.open(table)
  const selection: DocumentTableCellSelection = { kind: 'table-cell', cell: { table: tableRange(table), row: 1, column: 1 }, anchor: 1, focus: 1 }
  const action = { selection, range: selection, inputType: 'insertParagraph', data: null, options } as DocumentInputAction
  const plan = core.planInput(revision, action, { tracked: false })
  const edits = core.inputEdits(revision, action, plan, false)
  if (edits === undefined) throw new Error('Input refused')
  const commit = core.apply(revision, edits)
  expect(commit.revision.source).toBe('| a   | bb  |\n| --- |:---:|\n| ccc | d   |\n\n\n')
  // The caret starts the new paragraph after the blank line.
  expect(core.reconcileInput(revision, plan, commit, action).selection).toEqual({ ranges: [{ anchor: 43, focus: 43 }], primary: 0 })
})
