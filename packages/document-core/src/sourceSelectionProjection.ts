import { resolveModelTextSelection } from './modelText.js'
import type { DocumentCore, DocumentRevision } from './documentCore.js'
import { copyDocumentSelection, type DocumentSelection, type DocumentTextSelection } from './sourceInputPlanning.js'
import { resolveTableCell, resolveTableSelection } from './tableSelection.js'

/** Source presents intrinsic cells at their real source extents; history retains cell identity. */
export function projectSourceSelection(core: DocumentCore, revision: DocumentRevision, input: DocumentSelection): DocumentTextSelection {
  core.sourceSlice(revision, { start: 0, end: 0 })
  const selection = copyDocumentSelection(input, revision.sourceLength)
  if (selection.kind === 'model-text') {
    const resolved = resolveModelTextSelection(core, revision, selection)
    const sourcePoint = (value: typeof resolved.anchor, end: boolean): number => {
      if (typeof value.point === 'number') return value.point
      if (value.offset === 0) return value.range.start
      if (value.offset === value.text.length) return value.range.end
      return end ? value.range.end : value.range.start
    }
    return { ranges: [{ anchor: sourcePoint(resolved.anchor, resolved.backward), focus: sourcePoint(resolved.focus, !resolved.backward) }], primary: 0 }
  }
  if (selection.kind === 'table-cell') {
    const cell = resolveTableCell(core, revision, selection.cell)
    const length = cell.end - cell.start
    if (selection.anchor > length || selection.focus > length) throw new RangeError('Selection offset is outside its table cell')
    return Object.freeze({ ranges: Object.freeze([Object.freeze({ anchor: cell.start + selection.anchor, focus: cell.start + selection.focus })]), primary: 0 })
  }
  if (selection.kind === 'table') {
    const resolved = resolveTableSelection(core, revision, selection)
    const backward = selection.anchor.row > selection.focus.row || selection.anchor.row === selection.focus.row && selection.anchor.column > selection.focus.column
    const ranges = resolved.cells.map(cell => Object.freeze({ anchor: backward ? cell.end : cell.start, focus: backward ? cell.start : cell.end }))
    const primary = resolved.cells.findIndex(cell => cell.row === selection.focus.row && cell.column === selection.focus.column)
    return Object.freeze({ ranges: Object.freeze(ranges), primary })
  }
  return selection
}
