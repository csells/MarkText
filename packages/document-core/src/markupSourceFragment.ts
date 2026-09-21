import type { CriticMarkupAnnotation, DocumentCore, DocumentRevision, SourceRange } from './documentCore.js'

type SourceMapping = { before: SourceRange; after: number }

/** Splitting a shared annotation retains its exact delimiters and arm identity. */
export function markupSourceFragment(core: DocumentCore, revision: DocumentRevision, range: SourceRange): { text: string; mappings: SourceMapping[] } {
  let text = ''
  const mappings: SourceMapping[] = []
  const append = (source: SourceRange): void => {
    const start = Math.max(source.start, range.start)
    const end = Math.min(source.end, range.end)
    if (start <= end) mappings.push({ before: { start, end }, after: text.length + start - source.start })
    text += core.sourceSlice(revision, source)
  }
  const clip = (selected: SourceRange, annotations: readonly CriticMarkupAnnotation[]): void => {
    let cursor = selected.start
    let low = 0
    let high = annotations.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (annotations[middle]!.range.end <= selected.start) low = middle + 1
      else high = middle
    }
    for (let ordinal = low; ordinal < annotations.length; ordinal++) {
      const annotation = annotations[ordinal]!
      if (annotation.range.start >= selected.end) break
      if (cursor < annotation.range.start) append({ start: cursor, end: Math.min(selected.end, annotation.range.start) })
      if (selected.start <= annotation.range.start && annotation.range.end <= selected.end) append(annotation.range)
      else if (annotation.arms.some(arm => Math.max(arm.range.start, selected.start) < Math.min(arm.range.end, selected.end))) {
        let delimiterStart = annotation.range.start
        for (const arm of annotation.arms) {
          append({ start: delimiterStart, end: arm.range.start })
          const start = Math.max(arm.range.start, selected.start)
          const end = Math.min(arm.range.end, selected.end)
          if (start < end) clip({ start, end }, arm.annotations)
          delimiterStart = arm.range.end
        }
        append({ start: delimiterStart, end: annotation.range.end })
      }
      cursor = Math.max(cursor, Math.min(annotation.range.end, selected.end))
    }
    if (cursor < selected.end) append({ start: cursor, end: selected.end })
  }
  clip(range, revision.annotations)
  return { text, mappings }
}
