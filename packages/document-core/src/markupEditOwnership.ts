import type { CriticMarkupAnnotation, DocumentCore, DocumentRevision, DocumentSourceEdit, SourceRange } from './documentCore.js'

export const markupAnnotations = (roots: readonly CriticMarkupAnnotation[]): CriticMarkupAnnotation[] => {
  const result: CriticMarkupAnnotation[] = []
  const pending = [...roots].reverse()
  while (pending.length > 0) {
    const annotation = pending.pop()
    if (annotation === undefined) break
    result.push(annotation)
    for (const arm of [...annotation.arms].reverse()) pending.push(...[...arm.annotations].reverse())
  }
  return result
}

/** Every annotation of the trees `roots`, nested ones included, in no particular order. */
export function allAnnotations(roots: readonly CriticMarkupAnnotation[]): readonly CriticMarkupAnnotation[] {
  const all: CriticMarkupAnnotation[] = []
  const pending = [...roots]
  while (pending.length > 0) {
    const annotation = pending.pop()!
    all.push(annotation)
    for (const arm of annotation.arms) pending.push(...arm.annotations)
  }
  return all
}

/** Shared ownership of consumed visible source and annotation wrappers. */
export function markupEditOwnership(
  core: DocumentCore,
  revision: DocumentRevision,
  edits: readonly DocumentSourceEdit[],
  scope: 'visible' | 'structure'
) {
  const projection = core.project(revision, 'markup')
  const visible = projection.events.flatMap(event => event.kind === 'text' ? [event.sourceRange] : [])
  const annotations = markupAnnotations(revision.annotations)
  const annotationBoundaries = new Set(annotations.flatMap(annotation => [annotation.range.start, annotation.range.end]))
  // An emptied arm has no visible text; typing there writes that arm again.
  const emptyArms = new Set(annotations.flatMap(annotation => annotation.kind === 'comment'
    ? []
    : annotation.arms.flatMap(arm => arm.range.start === arm.range.end ? [arm.range.start] : [])))
  const deleted: SourceRange[] = []
  for (const edit of edits) {
    const insertion = edit.start === edit.end
    const boundary = (offset: number): boolean => (insertion && offset === revision.sourceLength) ||
      ((insertion || scope === 'structure') && annotationBoundaries.has(offset)) ||
      (insertion && emptyArms.has(offset)) ||
      visible.some(range => range.start <= offset && offset <= range.end)
    if (!boundary(edit.start) || !boundary(edit.end)) return undefined
    if (insertion) continue
    const intersections = visible.flatMap(range => {
      const start = Math.max(range.start, edit.start)
      const end = Math.min(range.end, edit.end)
      return start < end ? [{ start, end }] : []
    })
    if (intersections.length === 0) return undefined
    deleted.push(...intersections)
  }
  const covered = (range: SourceRange): boolean => {
    let cursor = range.start
    for (const edit of edits) {
      if (edit.end <= cursor) continue
      if (edit.start > cursor) return false
      cursor = Math.max(cursor, edit.end)
      if (cursor >= range.end) return true
    }
    return false
  }
  // Visible text by start, with the furthest end reached so far, so each
  // suggestion finds the text overlapping it without scanning all of it.
  const byStart = [...visible].sort((left, right) => left.start - right.start)
  const furthestEnd: number[] = []
  for (const range of byStart) furthestEnd.push(Math.max(furthestEnd.at(-1) ?? -Infinity, range.end))
  const overlapping = (target: SourceRange): SourceRange[] => {
    let low = 0
    let high = byStart.length
    while (low < high) {
      const middle = (low + high) >> 1
      if ((furthestEnd[middle] ?? -Infinity) > target.start) high = middle
      else low = middle + 1
    }
    const found: SourceRange[] = []
    for (let index = low; index < byStart.length; index += 1) {
      const range = byStart[index]
      if (range === undefined || range.start >= target.end) break
      if (range.end > target.start) found.push(range)
    }
    return found
  }
  const removed = new Set<CriticMarkupAnnotation>()
  for (const annotation of annotations) {
    if (scope === 'structure' && covered(annotation.range)) {
      removed.add(annotation)
      deleted.push(annotation.range)
      continue
    }
    if (annotation.kind === 'comment') continue
    // Visible replacement inside an arm edits that suggestion. Whole-structure
    // replacement also consumes wrappers whose complete visible content is owned.
    if (scope === 'visible' && edits.some(edit => edit.insert.length > 0 && annotation.arms.some(arm =>
      arm.range.start <= edit.start && edit.end <= arm.range.end
    ))) continue
    const contributions = overlapping(annotation.range)
    if (contributions.length === 0 || !contributions.every(covered)) continue
    removed.add(annotation)
    let start = annotation.range.start
    for (const arm of annotation.arms) {
      deleted.push({ start, end: arm.range.start })
      start = arm.range.end
    }
    deleted.push({ start, end: annotation.range.end })
  }
  return { annotations, deleted, removed }
}

/** Complete consumed annotation edges without changing a replacement within an arm. */
export function markupReplacementRange(core: DocumentCore, revision: DocumentRevision, edit: DocumentSourceEdit, scope: 'visible' | 'structure'): SourceRange | undefined {
  const ownership = markupEditOwnership(core, revision, [edit], scope)
  if (ownership === undefined) return undefined
  return {
    start: Math.min(edit.start, ...ownership.deleted.map(range => range.start)),
    end: Math.max(edit.end, ...ownership.deleted.map(range => range.end))
  }
}
