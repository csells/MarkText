import type { SourceRange } from '@marktext/document-core'
import type { MuyaMarkupPath, MuyaMarkupView } from './muyaMarkupView'

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
  const texts = new Map<string, string>()
  for (const binding of view.bindings) texts.set(JSON.stringify(binding.path), binding.text)
  const omitted = new Map<string, SourceRange[]>()
  for (const { path, range, mark } of view.decorations) {
    if (range.end <= range.start) continue
    if (mark.kind !== 'deletion' && !(mark.kind === 'substitution' && mark.arm === 'old')) continue
    const key = JSON.stringify(path)
    const ranges = omitted.get(key)
    if (ranges === undefined) omitted.set(key, [range])
    else ranges.push(range)
  }
  return (path, text, start, end) => {
    const key = JSON.stringify(path)
    if (texts.get(key) !== text) return undefined
    let revised = ''
    let offset = start
    for (const range of [...(omitted.get(key) ?? [])].sort((a, b) => a.start - b.start)) {
      if (range.end <= offset) continue
      if (range.start >= end) break
      if (range.start > offset) revised += text.slice(offset, range.start)
      offset = Math.max(offset, Math.min(range.end, end))
    }
    return offset < end ? revised + text.slice(offset, end) : revised
  }
}
