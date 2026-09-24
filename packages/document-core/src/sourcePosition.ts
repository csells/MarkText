import type { DocumentSourceEdit } from './documentCore.js'

/**
 * Map a source position through an ordered edit set using explicit insertion
 * affinity, either for every insertion or decided per insertion.
 */
export function positionAfter(edits: readonly DocumentSourceEdit[], position: number, afterInsertion: boolean | ((edit: DocumentSourceEdit) => boolean)): number {
  let delta = 0
  for (const edit of edits) {
    if (edit.start > position) break
    if (edit.start === edit.end) {
      if (edit.start < position || (typeof afterInsertion === 'function' ? afterInsertion(edit) : afterInsertion)) delta += edit.insert.length
    } else if (position < edit.end) return edit.start + delta
    else delta += edit.insert.length - (edit.end - edit.start)
  }
  return position + delta
}
