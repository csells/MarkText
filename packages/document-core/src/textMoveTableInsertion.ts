import { tableCellPaste, tableCellPasteCaret, tableToMarkdownWithPositions } from '@marktext/input-policy'
import type { DocumentCore, DocumentRevision, DocumentSourceEdit } from './documentCore.js'
import { inputSourceRange, type DocumentInputTarget } from './inputPlanning.js'
import { materializeModelTextEdit } from './modelText.js'
import type { MarkdownLineIndex } from './revision.js'
import { materializeTableCellEdit } from './tableCellEditing.js'
import { resolveTableCell, tableCellSelectionAtSource } from './tableSelection.js'

/** A text drop uses the same cell spelling and missing-slot policy as native editing. */
export function prepareTextMoveTableInsertion(
  core: DocumentCore,
  revision: DocumentRevision,
  target: DocumentInputTarget,
  payload: string,
  lines: MarkdownLineIndex,
  payloadCaret = payload.length
): { edit: DocumentSourceEdit, caret: number } | undefined {
  const range = inputSourceRange(core, revision, target)
  const selection = 'kind' in target && target.kind === 'table-cell'
    ? target
    : tableCellSelectionAtSource(core.project(revision, 'markup').syntax, range)
  if (selection === undefined) return undefined
  const cell = resolveTableCell(core, revision, selection.cell)
  const text = tableCellPaste(payload)
  const spelling = tableToMarkdownWithPositions({ children: [{ children: [{ text, meta: { align: 'none' } }] }] })
  const spelledCell = spelling.rows[0]?.cells[0]
  if (spelledCell === undefined) throw new RangeError('Text drop has no owned cell spelling')
  const insert = spelling.markdown.slice(spelledCell.start, spelledCell.end)
  const offset = spelledCell.offsets[tableCellPasteCaret(payload, payloadCaret)]
  if (offset === undefined) throw new RangeError('Text drop caret has no cell spelling')
  const insertion = 'kind' in target && target.kind === 'model-text'
    ? materializeModelTextEdit(core, revision, target, insert, lines)
    : { edit: { ...range, insert }, position: (offset: number) => range.start + offset }
  const materialized = materializeTableCellEdit(cell, insertion.edit)
  return { edit: materialized.edit, caret: insertion.position(offset - spelledCell.start) + materialized.prefixLength }
}
