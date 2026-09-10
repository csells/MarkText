import { tableToMarkdownWithPositions, type TableMarkdownCellPosition } from '@marktext/input-policy'
import { DocumentCoreError } from './documentCore.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from './resourcePolicy.js'
import type { DocumentCore, DocumentRevision, MarkdownAst, MarkdownAstNode, MarkdownAttribute } from './documentCore.js'
import type { DocumentTableSelection } from './sourceInputPlanning.js'
import { resolveTableSelection } from './tableSelection.js'

export interface DocumentTableSelectionProjection {
  readonly name: 'revised'
  readonly markdown: string
  readonly ast: MarkdownAst
}

/** Copy existing semantic nodes into the spelling emitted by the shared table serializer. */
function copyCellNode(node: MarkdownAstNode, cell: MarkdownAstNode, output: TableMarkdownCellPosition): MarkdownAstNode {
  const position = (offset: number): number => {
    const mapped = output.offsets[offset - cell.range.start]
    if (mapped === undefined) throw new RangeError('Table clipboard node is outside its owned cell')
    return mapped
  }
  const attributes: Record<string, MarkdownAttribute> = {}
  for (const [key, value] of Object.entries(node.attributes)) {
    if (typeof value === 'number' && /(?:Start|End)$/.test(key)) {
      // References outside the selected fragment retain their resolved semantic
      // values, but cannot retain document coordinates in the clipboard AST.
      if (value >= cell.range.start && value <= cell.range.end) attributes[key] = position(value)
    } else attributes[key] = value
  }
  return Object.freeze({
    kind: node.kind,
    range: Object.freeze({ start: position(node.range.start), end: position(node.range.end) }),
    attributes: Object.freeze(attributes),
    ...(node.semanticTextSegments === undefined
      ? {}
      : {
        semanticTextSegments: Object.freeze(node.semanticTextSegments.map(segment => Object.freeze({
          range: Object.freeze({ start: position(segment.range.start), end: position(segment.range.end) }), value: segment.value
        })))
      }),
    children: Object.freeze(node.children.map(child => copyCellNode(child, cell, output)))
  })
}

/** Revised clipboard view of a canonical rectangle, without parsing its flattened text. */
export function projectTableSelection(core: DocumentCore, revision: DocumentRevision, selection: DocumentTableSelection): DocumentTableSelectionProjection {
  const resolved = resolveTableSelection(core, revision, selection)
  const projection = core.project(revision, 'revised')
  const revisedTables: MarkdownAstNode[] = []
  const visit = (node: MarkdownAstNode): void => {
    if (node.kind === 'table' && projection.coordinates.toSource(node.range.start, 'previous') === resolved.selection.table.start &&
      projection.coordinates.toSource(node.range.end, 'next') === resolved.selection.table.end) revisedTables.push(node)
    else node.children.forEach(visit)
  }
  visit(projection.ast.root)
  if (revisedTables.length !== 1) throw new RangeError('Selected table has no unique Revised syntax table')
  const revisedTable = revisedTables[0]!
  const rows: MarkdownAstNode[][] = []
  for (let row = resolved.rowStart; row <= resolved.rowEnd; row++) {
    const cells: MarkdownAstNode[] = []
    for (let column = resolved.columnStart; column <= resolved.columnEnd; column++) {
      const cell = revisedTable.children[row]?.children[column]
      if (cell?.kind !== 'table-cell') throw new RangeError('Selected table cell has no Revised syntax cell')
      cells.push(cell)
    }
    rows.push(cells)
  }
  if (rows.length === 1 && rows[0]!.length === 1) {
    const cell = rows[0]![0]!
    const markdown = projection.markdown.slice(cell.range.start, cell.range.end)
    const position: TableMarkdownCellPosition = {
      start: 0,
      end: markdown.length,
      slotStart: 0,
      slotEnd: markdown.length,
      offsets: Array.from({ length: markdown.length + 1 }, (_, offset) => offset)
    }
    const paragraph: MarkdownAstNode = Object.freeze({
      kind: 'paragraph',
      range: Object.freeze({ start: 0, end: markdown.length }),
      attributes: Object.freeze({}),
      children: Object.freeze(cell.children.map(child => copyCellNode(child, cell, position)))
    })
    return Object.freeze({
      name: 'revised',
      markdown,
      ast: Object.freeze({
        root: Object.freeze({
          kind: 'document', range: paragraph.range, attributes: Object.freeze({}), children: Object.freeze([paragraph])
        })
      })
    })
  }
  const serialized = tableToMarkdownWithPositions({
    children: rows.map(cells => ({
      children: cells.map(cell => ({
        text: projection.markdown.slice(cell.range.start, cell.range.end), meta: { align: String(cell.attributes.alignment ?? 'none') }
      }))
    }))
  }, '', DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits)
  if (serialized === undefined) {
    const limit = DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
    throw new DocumentCoreError('CM_RESOURCE_SOURCE_UNITS_EXCEEDED', { start: limit, end: limit }, { limit: String(limit), operation: 'table-clipboard-projection' })
  }
  const children: MarkdownAstNode[] = rows.map((cells, rowIndex) => {
    const outputRow = serialized.rows[rowIndex]!
    return Object.freeze({
      kind: 'table-row',
      range: Object.freeze({ start: outputRow.start, end: outputRow.end }),
      attributes: Object.freeze({ header: rowIndex === 0 }),
      children: Object.freeze(cells.map((cell, column) => {
        const output = outputRow.cells[column]!
        const copied = copyCellNode(cell, cell, output)
        return Object.freeze({
          ...copied,
          attributes: Object.freeze({
            ...copied.attributes,
            header: rowIndex === 0,
            cellStart: output.slotStart,
            cellEnd: output.slotEnd,
            ...(rowIndex === 0 ? { delimiterStart: serialized.delimiterCells[column]!.start, delimiterEnd: serialized.delimiterCells[column]!.end, delimiterContentStart: serialized.delimiterCells[column]!.contentStart, delimiterContentEnd: serialized.delimiterCells[column]!.contentEnd } : {})
          })
        })
      }))
    })
  })
  const range = Object.freeze({ start: 0, end: serialized.markdown.length })
  const table: MarkdownAstNode = Object.freeze({ kind: 'table', range, attributes: Object.freeze({}), children: Object.freeze(children) })
  return Object.freeze({
    name: 'revised',
    markdown: serialized.markdown,
    ast: Object.freeze({
      root: Object.freeze({
        kind: 'document', range, attributes: Object.freeze({}), children: Object.freeze([table])
      })
    })
  })
}
