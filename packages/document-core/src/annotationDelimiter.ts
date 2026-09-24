import type { CriticMarkupAnnotation } from './documentCore.js'

/** Whether a source unit is CriticMarkup delimiter syntax rather than payload. */
export function isAnnotationDelimiter(annotations: readonly CriticMarkupAnnotation[], position: number): boolean {
  let level = annotations
  for (;;) {
    let low = 0
    let high = level.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (level[middle]!.range.end <= position) low = middle + 1
      else high = middle
    }
    const annotation = level[low]
    if (annotation === undefined || annotation.range.start > position) return false
    const arm = annotation.arms.find(item => item.range.start <= position && position < item.range.end)
    if (arm === undefined) return true
    level = arm.annotations
  }
}
