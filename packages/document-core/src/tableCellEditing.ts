import { emptyTableColumn } from '@marktext/input-policy'
import type { DocumentSourceEdit, MarkdownAstNode, MarkupSyntax } from './documentCore.js'
import type { resolveTableCell } from './tableSelection.js'

/** A promoted header must spell every column required by its delimiter row. */
export function tableRowCompletion(syntax: MarkupSyntax, row: MarkdownAstNode, columns: number): DocumentSourceEdit {
  const physical = row.children.filter(cell => typeof cell.attributes.cellStart === 'number')
  const final = physical.at(-1)
  const missing = columns - physical.length
  const at = syntax.coordinates.toSource(row.range.end, 'previous')
  const needsPipe = final !== undefined && typeof final.attributes.cellEnd === 'number' && syntax.coordinates.toSource(final.attributes.cellEnd, 'previous') === at
  return { start: at, end: at, insert: missing > 0 ? (needsPipe ? '|' : '') + (emptyTableColumn().cell + '|').repeat(missing) : '' }
}

/** Materialize only the missing physical slots required by an owned cell edit. */
export function materializeTableCellEdit(
  cell: ReturnType<typeof resolveTableCell>,
  edit: DocumentSourceEdit
): { edit: DocumentSourceEdit, prefixLength: number } {
  if (cell.slotStart !== undefined || edit.insert.length === 0 && edit.start === edit.end) return { edit, prefixLength: 0 }
  if (edit.start !== cell.start || edit.end !== cell.end) throw new RangeError('Implicit cell edit requires insertion into its empty content')
  const row = cell.table.children[cell.row]
  if (row === undefined) throw new RangeError('Input cell has no row')
  const physical = row.children.filter(cell => typeof cell.attributes.cellStart === 'number').length
  const padding = emptyTableColumn().cell
  const finalPhysical = row.children[physical - 1]
  const rowEnd = cell.syntax.coordinates.toSource(row.range.end, 'previous')
  const finalSlotEnd = finalPhysical?.attributes.cellEnd
  const needsSeparator = typeof finalSlotEnd === 'number' && cell.syntax.coordinates.toSource(finalSlotEnd, 'previous') === rowEnd
  const prefix = (needsSeparator ? '|' : '') + (padding + '|').repeat(cell.column - physical) + padding
  return { edit: { ...edit, insert: prefix + edit.insert + '|' }, prefixLength: prefix.length }
}
