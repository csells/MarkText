import type { DocumentTableClipboardAction, DocumentClipboardPlan } from './clipboardPlanning.js'
import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkupSyntax } from './documentCore.js'
import { copyDocumentSelection } from './sourceInputPlanning.js'
import { positionAfter } from './sourcePosition.js'
import { planTableRemoval } from './structuralInputPlanning.js'
import { resolveTableSelection, tableCellSelectionAtSource } from './tableSelection.js'

/** Cell selection is interpreted only by the table nodes of the current model. */
export function planTableClipboard(
  core: DocumentCore,
  revision: DocumentRevision,
  action: Extract<DocumentTableClipboardAction, { operation: 'delete' | 'cut' }>,
  preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision,
  previewSyntax: (edits: readonly DocumentSourceEdit[]) => MarkupSyntax,
  compileStructuralDeletion: (edits: readonly DocumentSourceEdit[]) => readonly DocumentSourceEdit[] | undefined
): DocumentClipboardPlan {
  const { syntax, selection, cells: selected, rowStart, rowEnd, columnStart, columnEnd } = resolveTableSelection(core, revision, action.selection)
  const first = selected[0]!
  const wholeRows = columnStart === 0 && columnEnd === first.table.children[0]!.children.length - 1
  const wholeColumns = rowStart === 0 && rowEnd === first.table.children.length - 1
  const inputEdits = selected.filter(cell => cell.start !== cell.end)
    .map(cell => ({ start: cell.start, end: cell.end, insert: '' }))
    .sort((left, right) => left.start - right.start)
  if (inputEdits.length === 0 || action.operation === 'cut' && wholeRows && wholeColumns) {
    if (wholeRows || wholeColumns) {
      const removal = planTableRemoval(core, revision, syntax, first.table, wholeRows
        ? { axis: 'row', first: rowStart, last: rowEnd }
        : { axis: 'column', first: columnStart, last: columnEnd })
      const wholeTable = wholeRows && wholeColumns
      const edits = action.tracked ? core.trackedEdits(revision, removal.edits) : wholeTable ? compileStructuralDeletion(removal.edits) : removal.edits
      if (edits === undefined) throw new RangeError('Table clipboard cannot preserve tracked source')
      if (wholeTable) preview(edits)
      // The structural owner selected this source location before compiling.
      // At the table's exterior start, remain before its retained deletion;
      // following content stays after the complete compiled source operation.
      const original = removal.selectionBeforeEdits
      const selection = action.tracked || wholeTable
        ? {
          start: positionAfter(edits, original.start, original.start > action.selection.table.start),
          end: positionAfter(edits, original.end, original.end > action.selection.table.start)
        }
        : removal.selection
      const cell = wholeTable ? undefined : tableCellSelectionAtSource(previewSyntax(edits), selection)
      if (!wholeTable && cell === undefined) throw new RangeError('Table removal has no accepted surviving cell')
      return Object.freeze({
        edits: Object.freeze(edits),
        selection: cell ?? { ranges: [{ anchor: selection.start, focus: selection.end }], primary: 0 }
      })
    }
    return Object.freeze({ edits: Object.freeze([]), selection: copyDocumentSelection({ kind: 'table-cell', cell: { table: selection.table, ...selection.anchor }, anchor: 0, focus: 0 }, revision.sourceLength) })
  }
  const edits = action.tracked ? core.trackedEdits(revision, inputEdits) : inputEdits
  if (edits === undefined) throw new RangeError('Table clipboard cannot preserve tracked source')
  preview(edits)
  const table = { start: positionAfter(edits, selection.table.start, false), end: positionAfter(edits, selection.table.end, true) }
  const resultSelection = action.operation === 'cut'
    ? { kind: 'table-cell' as const, cell: { table, ...selection.anchor }, anchor: 0, focus: 0 }
    : { ...selection, table }
  return Object.freeze({ edits: Object.freeze(edits), selection: copyDocumentSelection(resultSelection, revision.sourceLength + edits.reduce((sum, edit) => sum + edit.insert.length - (edit.end - edit.start), 0)) })
}
