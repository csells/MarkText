import type { MuyaMarkupPath, MuyaMarkupView } from './muyaMarkupView'
import { muyaViewItemAtPath, muyaViewItemsAtPath } from './muyaMarkupViewLookup'

/**
 * Reads a leaf's text as Revised shows it: the parts Core marks as suggested
 * deletions or replaced text are left out. Offsets and results are in the
 * leaf's Markup text, which already omits delimiters and comment bodies.
 * Returns undefined for a leaf this view does not hold with that text.
 */
export type MuyaRevisedTextReader = (
  path: MuyaMarkupPath,
  text: string,
  start: number,
  end: number
) => string | undefined

export function createMuyaRevisedTextReader(
  view: Pick<MuyaMarkupView, 'bindings' | 'decorations'>
): MuyaRevisedTextReader {
  return (path, text, start, end) => {
    if (muyaViewItemAtPath(view, 'bindings', path)?.text !== text) return undefined
    const omitted = muyaViewItemsAtPath(view, 'decorations', path)
      .filter(
        ({ range, mark }) =>
          range.end > range.start &&
          (mark.kind === 'deletion' || (mark.kind === 'substitution' && mark.arm === 'old'))
      )
      .map(({ range }) => range)
    let revised = ''
    let offset = start
    for (const range of omitted.sort((a, b) => a.start - b.start)) {
      if (range.end <= offset) continue
      if (range.start >= end) break
      if (range.start > offset) revised += text.slice(offset, range.start)
      offset = Math.max(offset, Math.min(range.end, end))
    }
    return offset < end ? revised + text.slice(offset, end) : revised
  }
}
