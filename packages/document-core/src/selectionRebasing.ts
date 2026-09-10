import { resolveModelTextSelection, rebaseModelTextPoint } from './modelText.js'
import { positionAfter } from './sourcePosition.js'
import { planTableMove } from './tableMovePlanning.js'
import { inputSourceRange } from './inputPlanning.js'
import { resolveTableCell, resolveTableSelection } from './tableSelection.js'
import { copyDocumentSelection, type DocumentTableCellAddress } from './sourceInputPlanning.js'
import type { DocumentCore, DocumentRevision, DocumentCommit, SourceRange, MarkdownAstNode, MarkupSyntax } from './documentCore.js'
import type { DocumentInputAction } from './inputPlanning.js'
import type { DocumentClipboardAction, DocumentClipboardSelection } from './clipboardPlanning.js'

export type DocumentSelectionMutation =
  | { readonly kind: 'input', readonly action: DocumentInputAction, readonly tracked: boolean }
  | { readonly kind: 'clipboard', readonly action: DocumentClipboardAction }
  | { readonly kind: 'edits' }

export type DocumentSelectionRebaseResult =
  | { readonly kind: 'mapped', readonly selection: DocumentClipboardSelection }
  | { readonly kind: 'conflict' }

/** Advance a retained position through an accepted operation in its sole model. */
export function rebaseDocumentInputSelection(
  core: DocumentCore,
  previous: DocumentRevision,
  commit: DocumentCommit,
  selection: DocumentClipboardSelection,
  options: { readonly affinity: 'before' | 'after', readonly operation: DocumentSelectionMutation }
): DocumentSelectionRebaseResult {
  const edits = commit.change.appliedEdits
  const conflict: DocumentSelectionRebaseResult = Object.freeze({ kind: 'conflict' })
  const mapped = (value: DocumentClipboardSelection): DocumentSelectionRebaseResult => Object.freeze({ kind: 'mapped', selection: 'start' in value ? Object.freeze({ ...value }) : copyDocumentSelection(value, commit.revision.sourceLength) })
  if ('kind' in selection && selection.kind === 'model-text') {
    resolveModelTextSelection(core, previous, selection)
    try {
      const result = { kind: 'model-text' as const, anchor: rebaseModelTextPoint(selection.anchor, edits), focus: rebaseModelTextPoint(selection.focus, edits) }
      resolveModelTextSelection(core, commit.revision, result)
      return mapped(result)
    } catch (error) {
      if (error instanceof RangeError) return conflict
      throw error
    }
  }
  if ('kind' in selection && selection.kind === 'table') {
    const rectangle = resolveTableSelection(core, previous, selection)
    const cells = rectangle.cells.map(cell => rebaseDocumentInputSelection(core, previous, commit, {
      kind: 'table-cell', cell: { table: selection.table, row: cell.row, column: cell.column }, anchor: 0, focus: cell.end - cell.start
    }, options))
    const addresses: DocumentTableCellAddress[] = []
    for (const cell of cells) {
      if (cell.kind !== 'mapped' || !('kind' in cell.selection) || cell.selection.kind !== 'table-cell') return conflict
      addresses.push(cell.selection.cell)
    }
    const first = addresses[0]
    if (first === undefined || addresses.some(cell => cell.table.start !== first.table.start || cell.table.end !== first.table.end)) return conflict
    const width = rectangle.columnEnd - rectangle.columnStart + 1
    if (addresses.some((cell, index) => cell.row !== first.row + Math.floor(index / width) || cell.column !== first.column + index % width)) return conflict
    const at = (point: typeof selection.anchor) => addresses[(point.row - rectangle.rowStart) * width + point.column - rectangle.columnStart]!
    const anchor = at(selection.anchor)
    const focus = at(selection.focus)
    return mapped({ kind: 'table', table: first.table, anchor: { row: anchor.row, column: anchor.column }, focus: { row: focus.row, column: focus.column } })
  }
  const range = inputSourceRange(core, previous, selection)
  core.sourceSlice(previous, range)
  core.sourceSlice(commit.revision, { start: 0, end: 0 })
  const overlaps = (range: SourceRange): boolean => edits.some(edit =>
    edit.start < range.end && range.start < edit.end || edit.start === edit.end && range.start < edit.start && edit.start < range.end)
  const shifted = (range: SourceRange): SourceRange => ({
    start: positionAfter(edits, range.start, range.start === range.end ? options.affinity === 'after' : true),
    end: positionAfter(edits, range.end, range.start === range.end ? options.affinity === 'after' : false)
  })
  if ('start' in selection) return overlaps(range) ? conflict : mapped(shifted(range))
  if ('ranges' in selection) {
    if (overlaps(range)) return conflict
    const primary = selection.ranges[selection.primary]
    if (primary === undefined) throw new RangeError('Retained selection has no primary range')
    const rebased = shifted(range)
    const forward = primary.anchor <= primary.focus
    return mapped({ ...selection, ranges: [{ anchor: forward ? rebased.start : rebased.end, focus: forward ? rebased.end : rebased.start }] })
  }
  const original = resolveTableCell(core, previous, selection.cell)
  const move = options.operation.kind === 'input' && 'kind' in options.operation.action && (options.operation.action.command === 'moveTableColumn' || options.operation.action.command === 'moveTableRow')
    ? options.operation.action
    : undefined
  if (move !== undefined && move.target.table.start === selection.cell.table.start && move.target.table.end === selection.cell.table.end) {
    const action = { ...move, selection }
    const result = core.reconcileInput(previous, planTableMove(core, previous, action), commit, action).selection
    if (result?.kind !== 'table-cell') return conflict
    const next = resolveTableCell(core, commit.revision, result.cell)
    if (core.sourceSlice(previous, original) !== core.sourceSlice(commit.revision, next)) return conflict
    return mapped(result)
  }
  if (edits.length === 0) return mapped(selection)
  const nextSyntax = core.project(commit.revision, 'markup').syntax
  const sourceRange = (syntax: MarkupSyntax, node: MarkdownAstNode): SourceRange => ({ start: syntax.coordinates.toSource(node.range.start, 'previous'), end: syntax.coordinates.toSource(node.range.end, 'next') })
  const slot = (syntax: MarkupSyntax, cell: MarkdownAstNode, delimiter = false): SourceRange | undefined => {
    const start = cell.attributes[delimiter ? 'delimiterStart' : 'cellStart']
    const end = cell.attributes[delimiter ? 'delimiterEnd' : 'cellEnd']
    return typeof start === 'number' && typeof end === 'number'
      ? { start: syntax.coordinates.toSource(start, 'previous'), end: syntax.coordinates.toSource(end, 'next') }
      : undefined
  }
  type CurrentCell = { table: MarkdownAstNode, row: number, column: number, slot?: SourceRange | undefined, delimiter?: SourceRange | undefined }
  const current: CurrentCell[] = []
  const visit = (node: MarkdownAstNode): void => {
    if (node.kind === 'table') node.children.forEach((row, rowIndex) => row.children.forEach((cell, column) => current.push({ table: node, row: rowIndex, column, slot: slot(nextSyntax, cell), ...(rowIndex === 0 ? { delimiter: slot(nextSyntax, cell, true) } : {}) })))
    else for (const child of node.children) visit(child)
  }
  visit(nextSyntax.ast.root)
  // An owned physical interval proves lineage only while some of its source
  // survives. Empty/omitted payload offsets never establish a row or column.
  const matches = (owned: SourceRange | undefined, delimiter = false): CurrentCell[] => {
    if (owned === undefined || owned.start === owned.end || edits.some(edit => edit.start !== edit.end && edit.start <= owned.start && edit.end >= owned.end)) return []
    const next = { start: positionAfter(edits, owned.start, true), end: positionAfter(edits, owned.end, false) }
    return current.filter(cell => {
      const candidate = delimiter ? cell.delimiter : cell.slot
      return candidate?.start === next.start && candidate.end === next.end
    })
  }
  const rowMatches = (original.table.children[original.row]?.children ?? []).flatMap(cell => matches(slot(original.syntax, cell)))
  const columnMatches = original.table.children.flatMap((row, index) => {
    const cell = row.children[original.column]
    return cell === undefined ? [] : [...matches(slot(original.syntax, cell)), ...(index === 0 ? matches(slot(original.syntax, cell, true), true) : [])]
  })
  // The actual operation supplies axis identity when a header is promoted or
  // the last physical body slot is removed. It is never inferred from a diff.
  let stableRows = false
  let stableColumns = false
  const sameTable = (table: SourceRange): boolean => table.start === selection.cell.table.start && table.end === selection.cell.table.end
  const operation = options.operation
  if (operation.kind === 'input' && 'kind' in operation.action && operation.action.command !== 'changeHeading' && operation.action.command !== 'changeBlockquote') {
    const action = operation.action
    let actionCell: ReturnType<typeof resolveTableCell> | undefined
    if (action.command === 'alignTableColumn') actionCell = resolveTableCell(core, previous, action.target)
    else if (action.selection.kind === 'table-cell') actionCell = resolveTableCell(core, previous, action.selection.cell)
    else {
      const at = inputSourceRange(core, previous, action.selection).start
      const candidates: { row: number, column: number }[] = []
      original.table.children.forEach((row, rowIndex) => row.children.forEach((cell, column) => {
        const content = sourceRange(original.syntax, cell)
        if (content.start <= at && at <= content.end && slot(original.syntax, cell) !== undefined) candidates.push({ row: rowIndex, column })
      }))
      const candidate = candidates.length === 1 ? candidates[0] : undefined
      if (candidate !== undefined) actionCell = resolveTableCell(core, previous, { table: selection.cell.table, ...candidate })
    }
    if (actionCell !== undefined && sameTable(sourceRange(actionCell.syntax, actionCell.table))) {
      stableRows = action.command === 'alignTableColumn' || action.command === 'insertTableColumn' || action.command === 'removeTableColumn'
      stableColumns = action.command === 'alignTableColumn' || action.command === 'insertTableRow' || action.command === 'removeTableRow'
      if (action.command === 'removeTableColumn' && actionCell.column === original.column ||
        action.command === 'removeTableRow' && actionCell.row === original.row) return conflict
    }
  } else if (operation.kind === 'clipboard' && operation.action.kind === 'table' && sameTable(operation.action.selection.table)) {
    const rectangle = resolveTableSelection(core, previous, operation.action.selection)
    if (rectangle.rowStart <= original.row && original.row <= rectangle.rowEnd && rectangle.columnStart <= original.column && original.column <= rectangle.columnEnd) return conflict
    stableRows = rectangle.rowStart === 0 && rectangle.rowEnd === original.table.children.length - 1
    stableColumns = rectangle.columnStart === 0 && rectangle.columnEnd === (original.table.children[0]?.children.length ?? 0) - 1
  }
  const tables = new Set([...rowMatches, ...columnMatches].map(cell => cell.table))
  if (tables.size !== 1) return conflict
  const table = [...tables][0]
  if (table === undefined) return conflict
  const rows = new Set(rowMatches.map(cell => cell.row))
  const columns = new Set(columnMatches.map(cell => cell.column))
  const row = rows.size === 1 ? [...rows][0] : rows.size === 0 && stableRows ? original.row : undefined
  const column = columns.size === 1 ? [...columns][0] : columns.size === 0 && stableColumns ? original.column : undefined
  if (row === undefined || column === undefined) return conflict
  const address = { table: sourceRange(nextSyntax, table), row, column }
  const next = resolveTableCell(core, commit.revision, address)
  if (original.slotStart === undefined) {
    const offset = options.affinity === 'after' ? next.end - next.start : 0
    return mapped({ kind: 'table-cell', cell: address, anchor: offset, focus: offset })
  }
  if (overlaps(range)) return conflict
  const rebased = shifted(range)
  if (next.start === next.end && next.slotStart !== undefined && next.slotEnd !== undefined &&
    next.slotStart <= rebased.start && rebased.end <= next.slotEnd) return mapped({ kind: 'table-cell', cell: address, anchor: 0, focus: 0 })
  if (rebased.start < next.start || rebased.end > next.end) return conflict
  const forward = selection.anchor <= selection.focus
  return mapped({ kind: 'table-cell', cell: address, anchor: (forward ? rebased.start : rebased.end) - next.start, focus: (forward ? rebased.end : rebased.start) - next.start })
}
