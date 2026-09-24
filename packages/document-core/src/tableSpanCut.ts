import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, SourceRange } from './documentCore.js'
import { respellTableInput } from './tableRespelling.js'

interface CellText {
  readonly table: MarkdownAstNode
  readonly row: MarkdownAstNode
  readonly start: number
  readonly end: number
  readonly slotStart: number
  readonly slotEnd: number
}

interface CellPoint extends CellText {
  readonly offset: number
  /** The point is in a missing cell after this, the row's last written cell. */
  readonly beyond: boolean
}

/** A table's physical cells in document order, with their text's source range. */
function cellTexts(syntax: MarkupSyntax, table: MarkdownAstNode): CellText[] {
  return table.children.flatMap(row => row.children.flatMap(cell => typeof cell.attributes.cellStart === 'number' && typeof cell.attributes.cellEnd === 'number'
    ? [{
      table,
      row,
      start: syntax.coordinates.toSource(cell.range.start, 'previous'),
      end: syntax.coordinates.toSource(cell.range.end, 'next'),
      slotStart: syntax.coordinates.toSource(cell.attributes.cellStart, 'previous'),
      slotEnd: syntax.coordinates.toSource(cell.attributes.cellEnd, 'next')
    }]
    : []))
}

/** Each table with the node that contains it. */
function tablesOf(root: MarkdownAstNode): Array<{ table: MarkdownAstNode, parent: MarkdownAstNode }> {
  const found: Array<{ table: MarkdownAstNode, parent: MarkdownAstNode }> = []
  const visit = (node: MarkdownAstNode) => {
    for (const child of node.children) {
      if (child.kind === 'table') found.push({ table: child, parent: node })
      else visit(child)
    }
  }
  visit(root)
  return found
}

/**
 * The cell whose slot holds `position`; a position in its padding is at its
 * text's nearer edge. A missing cell at the end of a short row has no source
 * of its own: its position follows the row's last written cell.
 */
function cellAt(syntax: MarkupSyntax, table: MarkdownAstNode, position: number): CellPoint | undefined {
  const cells = cellTexts(syntax, table)
  for (const cell of cells) {
    if (cell.slotStart <= position && position <= cell.slotEnd) {
      return { ...cell, offset: Math.min(Math.max(position, cell.start), cell.end) - cell.start, beyond: false }
    }
  }
  for (const row of table.children) {
    if (position < syntax.coordinates.toSource(row.range.start, 'previous') || position > syntax.coordinates.toSource(row.range.end, 'next')) continue
    const written = cells.filter(cell => cell.row === row && cell.slotEnd < position).at(-1)
    return written === undefined ? undefined : { ...written, offset: written.end - written.start, beyond: true }
  }
  return undefined
}

/**
 * Upstream MarkText replaces a selection that starts or ends in a table cell
 * without removing the table's grid: the start keeps its text before the
 * selection, then `insert`, then the end's text after it; the cells the
 * selection spans after its start are emptied, a paragraph it ends in is
 * removed, and the table is written afresh. A selection or insert this cannot
 * express, or a selection that overlaps an annotation, is left to the
 * ordinary replacement.
 */
export function planTableSpanCut(core: DocumentCore, revision: DocumentRevision, syntax: MarkupSyntax, range: SourceRange, insert = ''): { edits: readonly DocumentSourceEdit[], caret: number } | undefined {
  if (range.start === range.end || /[\r\n]/u.test(insert) || revision.annotations.some(annotation => annotation.range.start < range.end && range.start < annotation.range.end)) return undefined
  const source = (start: number, end: number) => core.sourceSlice(revision, { start, end })
  const tables = tablesOf(syntax.ast.root)
  const within = (position: number) => tables.find(({ table }) =>
    syntax.coordinates.toSource(table.range.start, 'previous') <= position && position <= syntax.coordinates.toSource(table.range.end, 'next'))
  const startTable = within(range.start)
  const endTable = within(range.end)
  const first = startTable === undefined ? undefined : cellAt(syntax, startTable.table, range.start)
  const last = endTable === undefined ? undefined : cellAt(syntax, endTable.table, range.end)
  const paragraphAt = (parent: MarkdownAstNode, position: number) => parent.children.find(node => (node.kind === 'paragraph' || node.kind === 'heading' && node.attributes.style !== 'setext') &&
    syntax.coordinates.toSource(node.range.start, 'previous') <= position && position <= syntax.coordinates.toSource(node.range.end, 'next'))
  const emptied = (cells: readonly CellText[]) => cells.filter(cell => cell.end > cell.start).map(cell => ({ start: cell.start, end: cell.end, insert: '' }))
  let edits: DocumentSourceEdit[]
  let caret: number
  let table: MarkdownAstNode
  if (first !== undefined && last !== undefined && startTable === endTable) {
    const cells = cellTexts(syntax, first.table)
    const from = cells.findIndex(cell => cell.start === first.start)
    const to = cells.findIndex(cell => cell.start === last.start)
    if (from < 0 || to < from || to === from && !last.beyond) return undefined
    const tail = source(last.start + last.offset, last.end)
    edits = [{ start: first.start + first.offset, end: first.end, insert: insert + tail }, ...emptied(cells.slice(from + 1, to + 1))]
    caret = first.start + first.offset + insert.length
    table = first.table
  } else if (first !== undefined && startTable !== undefined && endTable === undefined) {
    // A selection from a cell into a following paragraph moves the
    // paragraph's remaining text into the cell.
    const paragraph = paragraphAt(startTable.parent, range.end)
    const tableEnd = syntax.coordinates.toSource(first.table.range.end, 'previous')
    if (paragraph === undefined || syntax.coordinates.toSource(paragraph.range.start, 'previous') < tableEnd) return undefined
    const paragraphEnd = syntax.coordinates.toSource(paragraph.range.end, 'next')
    const tail = source(range.end, paragraphEnd)
    if (/[\r\n]/u.test(tail)) return undefined
    edits = [{ start: first.start + first.offset, end: first.end, insert: insert + tail }, { start: tableEnd, end: paragraphEnd, insert: '' }]
    caret = first.start + first.offset + insert.length
    table = first.table
  } else if (last !== undefined && endTable !== undefined && startTable === undefined) {
    // A selection from a preceding paragraph into a cell moves the cell's
    // remaining text into the paragraph and empties the cells before it.
    const paragraph = paragraphAt(endTable.parent, range.start)
    if (paragraph === undefined) return undefined
    const paragraphEnd = syntax.coordinates.toSource(paragraph.range.end, 'next')
    const tableStart = syntax.coordinates.toSource(last.table.range.start, 'previous')
    const following = endTable.parent.children.find(node => syntax.coordinates.toSource(node.range.start, 'previous') > paragraphEnd)
    if (following === undefined) return undefined
    const cells = cellTexts(syntax, last.table)
    const to = cells.findIndex(cell => cell.start === last.start)
    if (to < 0) return undefined
    edits = [
      { start: range.start, end: paragraphEnd, insert: insert + source(last.start + last.offset, last.end) },
      ...following === last.table ? [] : [{ start: syntax.coordinates.toSource(following.range.start, 'previous'), end: tableStart, insert: '' }],
      ...emptied(cells.slice(0, to + 1))
    ]
    caret = range.start + insert.length
    table = last.table
  } else {
    return undefined
  }
  edits = edits.filter(edit => edit.end > edit.start || edit.insert !== '')
  const respelled = respellTableInput(core, revision, syntax, table, { edits, selection: { start: caret, end: caret }, reconciliation: [] })
  return { edits: respelled.edits, caret: respelled.selection.start }
}
