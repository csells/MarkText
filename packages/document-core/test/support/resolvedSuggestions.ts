import { createDocumentCore, type CriticMarkupAnnotation } from '../../src/index.js'

/**
 * The source with every suggestion accepted or rejected at once, as Accept
 * All and Reject All leave it: nested suggestions resolve within the arm
 * kept, and nothing is parsed again in between.
 */
export function resolveAll(source: string, decision: 'accept' | 'reject'): string {
  const resolve = (from: number, to: number, annotations: readonly CriticMarkupAnnotation[]): string => {
    let text = ''
    let cursor = from
    for (const annotation of annotations) {
      text += source.slice(cursor, annotation.range.start)
      const name = annotation.kind === 'addition'
        ? decision === 'accept' ? 'content' : ''
        : annotation.kind === 'deletion'
          ? decision === 'accept' ? '' : 'content'
          : annotation.kind === 'substitution'
            ? decision === 'accept' ? 'new' : 'old'
            : annotation.kind === 'highlight' ? 'content' : ''
      const kept = annotation.arms.find(arm => arm.name === name)
      if (kept !== undefined) text += resolve(kept.range.start, kept.range.end, kept.annotations)
      cursor = annotation.range.end
    }
    return text + source.slice(cursor, to)
  }
  return resolve(0, source.length, createDocumentCore().open(source).annotations)
}

/**
 * Whether a range lies in deleted or replaced text: a Deletion's content or a
 * Substitution's old arm, at any depth.
 */
export function inHistory(annotations: readonly CriticMarkupAnnotation[], start: number, end: number): boolean {
  for (const annotation of annotations) {
    if (!(annotation.range.start < start && end < annotation.range.end)) continue
    const arm = annotation.arms.find(candidate => candidate.range.start <= start && end <= candidate.range.end)
    if (arm === undefined) return false
    if (annotation.kind === 'deletion' || (annotation.kind === 'substitution' && arm.name === 'old')) return true
    return inHistory(arm.annotations, start, end)
  }
  return false
}

/** Whether `after` is `before` with `typed` inserted at one place. */
export function keepsTyping(after: string, before: string, typed: string): boolean {
  if (after.length !== before.length + typed.length) return false
  for (let at = 0; at <= before.length; at += 1) {
    if (after.startsWith(before.slice(0, at)) && after.startsWith(typed, at) && after.endsWith(before.slice(at))) return true
  }
  return false
}
