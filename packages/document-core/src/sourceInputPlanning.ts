import type { DocumentCore, DocumentRevision, DocumentSourceEdit, SourceRange } from './documentCore.js'

/** Canonical UTF-16 selections shared by every document presentation. */
interface DocumentSelectionRanges {
  readonly ranges: readonly Readonly<{ anchor: number; focus: number }>[]
  readonly primary: number
}

export interface DocumentTextSelection extends DocumentSelectionRanges {
  readonly kind?: 'text'
}

/** A cell's intrinsic location within one parser-owned table in this revision. */
export interface DocumentTableCellAddress {
  readonly table: SourceRange
  readonly row: number
  readonly column: number
}

/** A cell rectangle, including implicit cells with no physical source slot. */
export interface DocumentTableSelection {
  readonly kind: 'table'
  readonly table: SourceRange
  readonly anchor: Readonly<{ row: number; column: number }>
  readonly focus: Readonly<{ row: number; column: number }>
}

/** Text offsets within an owned cell; zero offsets also identify implicit cells. */
export interface DocumentTableCellSelection {
  readonly kind: 'table-cell'
  readonly cell: DocumentTableCellAddress
  readonly anchor: number
  readonly focus: number
}

/** A precise point in source or in the value of one current parser-owned text node. */
export type DocumentModelTextPoint = number | Readonly<{ text: SourceRange, offset: number }>
export interface DocumentModelTextSelection {
  readonly kind: 'model-text'
  readonly anchor: DocumentModelTextPoint
  readonly focus: DocumentModelTextPoint
}

export type DocumentSelection = DocumentTextSelection | DocumentTableSelection | DocumentTableCellSelection | DocumentModelTextSelection

export interface DocumentSourceInputAction {
  readonly edits: readonly DocumentSourceEdit[]
  readonly beforeSelection: DocumentSelection
  readonly afterSelection: DocumentSelection
}

function copyTableRange(table: SourceRange, sourceLength: number): SourceRange {
  if (!table || !Number.isSafeInteger(table.start) || !Number.isSafeInteger(table.end) || table.start < 0 || table.end <= table.start || table.end > sourceLength) {
    throw new RangeError('Table selection is outside its source revision')
  }
  return Object.freeze({ start: table.start, end: table.end })
}

function copyCellPosition(position: Readonly<{ row: number; column: number }>): Readonly<{ row: number; column: number }> {
  if (!position || !Number.isSafeInteger(position.row) || !Number.isSafeInteger(position.column) || position.row < 0 || position.column < 0) {
    throw new RangeError('Invalid table cell address')
  }
  return Object.freeze({ row: position.row, column: position.column })
}

export function copyDocumentSelection<T extends DocumentSelection>(value: T, sourceLength: number): T
export function copyDocumentSelection(value: DocumentSelection, sourceLength: number): DocumentSelection {
  if (!value) throw new RangeError('Invalid document selection')
  if (value.kind === 'model-text') {
    const point = (point: DocumentModelTextPoint): DocumentModelTextPoint => {
      if (typeof point === 'number') {
        if (!Number.isSafeInteger(point) || point < 0 || point > sourceLength) throw new RangeError('Model text point is outside its revision')
        return point
      }
      if (!point || !Number.isSafeInteger(point.offset) || point.offset < 0) throw new RangeError('Invalid model text offset')
      return Object.freeze({ text: copyTableRange(point.text, sourceLength), offset: point.offset })
    }
    return Object.freeze({ kind: 'model-text', anchor: point(value.anchor), focus: point(value.focus) })
  }
  if (value.kind === 'table') {
    return Object.freeze({ kind: 'table', table: copyTableRange(value.table, sourceLength), anchor: copyCellPosition(value.anchor), focus: copyCellPosition(value.focus) })
  }
  if (value.kind === 'table-cell') {
    if (!value.cell || !Number.isSafeInteger(value.anchor) || !Number.isSafeInteger(value.focus) || value.anchor < 0 || value.focus < 0) {
      throw new RangeError('Invalid table cell text selection')
    }
    return Object.freeze({ kind: 'table-cell', cell: Object.freeze({ table: copyTableRange(value.cell.table, sourceLength), ...copyCellPosition(value.cell) }), anchor: value.anchor, focus: value.focus })
  }
  if ((value.kind !== undefined && value.kind !== 'text') || !Array.isArray(value.ranges) || value.ranges.length === 0 ||
      !Number.isSafeInteger(value.primary) || value.primary < 0 || value.primary >= value.ranges.length) {
    throw new RangeError('Invalid document selection')
  }
  const ranges = value.ranges.map(range => {
    if (!range || !Number.isSafeInteger(range.anchor) || !Number.isSafeInteger(range.focus) ||
        range.anchor < 0 || range.focus < 0 || range.anchor > sourceLength || range.focus > sourceLength) {
      throw new RangeError('Document selection is outside its source revision')
    }
    return Object.freeze({ anchor: range.anchor, focus: range.focus })
  })
  return Object.freeze({ ...(value.kind === undefined ? {} : { kind: value.kind }), ranges: Object.freeze(ranges), primary: value.primary })
}

/** Admits an exact native Source operation without interpreting its Markdown as an edit. */
export function planSourceInput(core: DocumentCore, previous: DocumentRevision, action: DocumentSourceInputAction): DocumentSourceInputAction {
  if (!Array.isArray(action.edits)) throw new RangeError('Source input requires exact edits')
  let end = 0
  let sourceLength = previous.sourceLength
  const edits = action.edits.map(edit => {
    if (!edit || !Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.end) ||
        edit.start < end || edit.end < edit.start || edit.end > previous.sourceLength || typeof edit.insert !== 'string') {
      throw new RangeError('Source input edit is outside its revision')
    }
    end = edit.end
    sourceLength += edit.insert.length - (edit.end - edit.start)
    return Object.freeze({ start: edit.start, end: edit.end, insert: edit.insert })
  })
  return Object.freeze({
    edits: Object.freeze(edits.filter(edit => core.sourceSlice(previous, edit) !== edit.insert)),
    beforeSelection: copyDocumentSelection(action.beforeSelection, previous.sourceLength),
    afterSelection: copyDocumentSelection(action.afterSelection, sourceLength)
  })
}
