import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, SourceRange } from './documentCore.js'
import { positionAfter } from './sourcePosition.js'
import { copyDocumentSelection, type DocumentTableSelection, type DocumentTableCellAddress, type DocumentTableCellSelection } from './sourceInputPlanning.js'

/** Resolve a current intrinsic table; byte extents identify its revision-bound owner. */
function resolveTable(syntax: MarkupSyntax, range: SourceRange) {
  const tables: MarkdownAstNode[] = []
  const visit = (node: MarkdownAstNode): void => {
    if (node.kind === 'table' && syntax.coordinates.toSource(node.range.start, 'previous') === range.start &&
      syntax.coordinates.toSource(node.range.end, 'next') === range.end) tables.push(node)
    for (const child of node.children) visit(child)
  }
  visit(syntax.ast.root)
  if (tables.length !== 1) throw new RangeError('Selection does not identify one current table')
  return { syntax, table: tables[0]! }
}

/**
 * A cell's content in source. The editing syntax omits comments, so a cell
 * holding only comments has no text there and sits at its closing pipe; its
 * content is then the source those comments occupy between its padding, as a
 * cell's content includes the comments beside its text.
 */
export function tableCellContentRange(syntax: MarkupSyntax, cell: MarkdownAstNode): SourceRange {
  const start = syntax.coordinates.toSource(cell.range.start, 'previous')
  const end = syntax.coordinates.toSource(cell.range.end, 'next')
  const { cellStart, cellEnd } = cell.attributes
  if (start !== end || typeof cellStart !== 'number' || typeof cellEnd !== 'number') return { start, end }
  let hidden: SourceRange | undefined
  for (let at = cellStart; at <= cellEnd; at++) {
    const before = syntax.coordinates.toSource(at, 'previous')
    const after = syntax.coordinates.toSource(at, 'next')
    if (before < after) hidden = { start: hidden?.start ?? before, end: after }
  }
  return hidden ?? { start, end }
}

function cellOf(syntax: MarkupSyntax, table: MarkdownAstNode, row: number, column: number) {
  const cell = table.children[row]?.children[column]
  if (cell?.kind !== 'table-cell') throw new RangeError('Cell address is outside the current table')
  const { start, end } = tableCellContentRange(syntax, cell)
  const slot = typeof cell.attributes.cellStart === 'number' && typeof cell.attributes.cellEnd === 'number'
    ? { slotStart: syntax.coordinates.toSource(cell.attributes.cellStart, 'previous'), slotEnd: syntax.coordinates.toSource(cell.attributes.cellEnd, 'next') }
    : undefined
  return {
    table,
    cell,
    row,
    column,
    start,
    end,
    // Upstream keeps a space typed after a cell's text in the cell until the
    // table is written again, so a caret may follow the text into its padding.
    caretEnd: slot === undefined || start === end ? end : slot.slotEnd,
    ...slot
  }
}

/** Resolve the exact owned cell, including an implicit cell with no source slot. */
export function resolveTableCell(core: DocumentCore, revision: DocumentRevision, address: DocumentTableCellAddress) {
  const selection = copyDocumentSelection({ kind: 'table-cell', cell: address, anchor: 0, focus: 0 }, revision.sourceLength)
  if (selection.kind !== 'table-cell') throw new RangeError('Expected a table cell selection')
  return resolveTableCellInSyntax(core.project(revision, 'markup').syntax, selection.cell)
}

export function resolveTableCellInSyntax(syntax: MarkupSyntax, address: DocumentTableCellAddress) {
  const { table } = resolveTable(syntax, address.table)
  return { syntax, ...cellOf(syntax, table, address.row, address.column) }
}

/** Find the preceding cell only when no other editable block intervenes. */
export function previousTableCell(syntax: MarkupSyntax, address: DocumentTableCellAddress): DocumentTableCellAddress | undefined {
  const selected = resolveTableCellInSyntax(syntax, address)
  let previous: DocumentTableCellAddress | undefined
  const visit = (node: MarkdownAstNode): boolean => {
    if (node.kind === 'table') {
      const table = { start: syntax.coordinates.toSource(node.range.start, 'previous'), end: syntax.coordinates.toSource(node.range.end, 'next') }
      for (const [row, current] of node.children.entries()) {
        for (let column = 0; column < current.children.length; column++) {
          if (node === selected.table && row === address.row && column === address.column) return true
          previous = { table, row, column }
        }
      }
    } else if (['paragraph', 'heading', 'code-block', 'math-block', 'diagram', 'front-matter'].includes(node.kind) || node.children.length === 0) previous = undefined
    else for (const child of node.children) if (visit(child)) return true
    return false
  }
  visit(syntax.ast.root)
  return previous
}

/** Resolve a rectangle by intrinsic row/column identity, never invented byte slots. */
export function resolveTableSelection(core: DocumentCore, revision: DocumentRevision, input: DocumentTableSelection) {
  return resolveTableSelectionInSyntax(core.project(revision, 'markup').syntax, revision.sourceLength, input)
}

export function resolveTableSelectionInSyntax(ownedSyntax: MarkupSyntax, sourceLength: number, input: DocumentTableSelection) {
  const selection = copyDocumentSelection(input, sourceLength)
  if (selection.kind !== 'table') throw new RangeError('Table clipboard requires a table selection')
  const { syntax, table } = resolveTable(ownedSyntax, selection.table)
  const rowStart = Math.min(selection.anchor.row, selection.focus.row)
  const rowEnd = Math.max(selection.anchor.row, selection.focus.row)
  const columnStart = Math.min(selection.anchor.column, selection.focus.column)
  const columnEnd = Math.max(selection.anchor.column, selection.focus.column)
  cellOf(syntax, table, rowStart, columnStart)
  cellOf(syntax, table, rowEnd, columnEnd)
  const cells: ReturnType<typeof cellOf>[] = []
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let column = columnStart; column <= columnEnd; column++) cells.push(cellOf(syntax, table, row, column))
  }
  return { syntax, selection, table, cells, rowStart, rowEnd, columnStart, columnEnd }
}

/** Map one intrinsic cell selection through edits using the resulting owned syntax. */
export function tableCellSelectionAfter(
  syntax: MarkupSyntax,
  sourceLength: number,
  edits: readonly DocumentSourceEdit[],
  original: DocumentTableCellSelection,
  sourceAnchor?: number,
  sourceFocus = sourceAnchor
): DocumentTableCellSelection {
  const table = { start: positionAfter(edits, original.cell.table.start, false), end: positionAfter(edits, original.cell.table.end, true) }
  const cell = { ...original.cell, table }
  const accepted = resolveTableCellInSyntax(syntax, cell)
  // A caret left in a cell's padding, as when its whole text is removed, is
  // at the nearer edge of the cell's text.
  const offset = (position: number) => accepted.slotStart !== undefined && accepted.slotEnd !== undefined && accepted.slotStart <= position && position <= accepted.slotEnd
    ? Math.min(Math.max(position, accepted.start), accepted.end) - accepted.start
    : position - accepted.start
  const anchor = sourceAnchor === undefined ? original.anchor : offset(sourceAnchor)
  const focus = sourceFocus === undefined ? original.focus : offset(sourceFocus)
  if (anchor < 0 || focus < 0 || anchor > accepted.end - accepted.start || focus > accepted.end - accepted.start) throw new RangeError('Result selection is outside its cell')
  return copyDocumentSelection({ kind: 'table-cell', cell, anchor, focus }, sourceLength)
}

/** Resolve a physical structural survivor; implicit cell identity cannot be inferred from coincident offsets. */
export function tableCellSelectionAtSource(syntax: MarkupSyntax, selection: SourceRange): DocumentTableCellSelection | undefined {
  const addresses: DocumentTableCellSelection[] = []
  const visit = (node: MarkdownAstNode): void => {
    if (node.kind === 'table') {
      node.children.forEach((row, rowIndex) => row.children.forEach((cell, column) => {
        const { cellStart, cellEnd } = cell.attributes
        if (typeof cellStart !== 'number' || typeof cellEnd !== 'number') return
        const from = syntax.coordinates.toSource(cell.range.start, 'previous')
        const to = syntax.coordinates.toSource(cell.range.end, 'next')
        // A caret anywhere in an empty cell's padding is at its text.
        const empty = from === to && syntax.coordinates.toSource(cellStart, 'previous') <= selection.start && selection.end <= syntax.coordinates.toSource(cellEnd, 'next')
        if (empty || from <= selection.start && selection.end <= to) addresses.push({ kind: 'table-cell', cell: { table: { start: syntax.coordinates.toSource(node.range.start, 'previous'), end: syntax.coordinates.toSource(node.range.end, 'next') }, row: rowIndex, column }, anchor: empty ? 0 : selection.start - from, focus: empty ? 0 : selection.end - from })
      }))
    } else for (const child of node.children) visit(child)
  }
  visit(syntax.ast.root)
  if (addresses.length > 1) throw new RangeError('Structural input has an ambiguous accepted cell')
  return addresses[0]
}
