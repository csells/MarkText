export interface SourceEdit {
  readonly start: number
  readonly end: number
  readonly insert: string
}

export interface AppliedSourceEdit {
  readonly source: string
  readonly edit: SourceEdit
  readonly inverse: SourceEdit
}

function assertOffset(offset: number, sourceLength: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset > sourceLength) {
    throw new RangeError('Source edit offset is outside the revision')
  }
}

export function applySourceEdit(source: string, edit: SourceEdit): AppliedSourceEdit {
  assertOffset(edit.start, source.length)
  assertOffset(edit.end, source.length)
  if (edit.end < edit.start) {
    throw new RangeError('Source edit range is reversed')
  }

  const stableEdit = Object.freeze({
    start: edit.start,
    end: edit.end,
    insert: edit.insert
  })
  const removed = source.slice(stableEdit.start, stableEdit.end)
  const nextSource =
    source.slice(0, stableEdit.start) + stableEdit.insert + source.slice(stableEdit.end)
  const inverse = Object.freeze({
    start: stableEdit.start,
    end: stableEdit.start + stableEdit.insert.length,
    insert: removed
  })

  return Object.freeze({ source: nextSource, edit: stableEdit, inverse })
}
