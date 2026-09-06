import type {
  CriticMarkupAnnotation, DocumentCore, DocumentRevision, DocumentSourceEdit,
  SourceRange
} from './documentCore.js'
import { protectNativeCriticText } from './trackedAuthoring.js'

const annotationsOf = (roots: readonly CriticMarkupAnnotation[]): CriticMarkupAnnotation[] => {
  const result: CriticMarkupAnnotation[] = []
  const pending = [...roots].reverse()
  while (pending.length > 0) {
    const annotation = pending.pop()!
    result.push(annotation)
    for (const arm of [...annotation.arms].reverse()) pending.push(...[...arm.annotations].reverse())
  }
  return result
}

/** Source ranges come exclusively from the revision's Markup event stream. */
export function createMarkupSourceEdits(
  core: DocumentCore,
  revision: DocumentRevision,
  edit: DocumentSourceEdit,
  preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision
): readonly DocumentSourceEdit[] | undefined {
  const projection = core.project(revision, 'markup')
  const visible = projection.events.flatMap(event => event.kind === 'text' ? [event.sourceRange] : [])
  const insertion = edit.start === edit.end
  const boundary = (offset: number): boolean => (insertion && offset === revision.sourceLength) ||
    visible.some(range => range.start <= offset && offset <= range.end)
  if (!boundary(edit.start) || !boundary(edit.end)) return undefined
  const deleted: SourceRange[] = insertion
    ? []
    : visible.flatMap(range => {
      const start = Math.max(range.start, edit.start)
      const end = Math.min(range.end, edit.end)
      return start < end ? [{ start, end }] : []
    })
  if (!insertion && deleted.length === 0) return undefined
  const annotations = annotationsOf(revision.annotations)
  const removed = new Set<CriticMarkupAnnotation>()
  for (const annotation of annotations) {
    if (annotation.kind === 'comment') continue
    // Replacing an arm's payload edits that suggestion; only selections extending
    // outside the arm can replace its wrapper along with the surrounding text.
    if (edit.insert.length > 0 && annotation.arms.some(arm =>
      arm.range.start <= edit.start && edit.end <= arm.range.end
    )) continue
    const contributions = visible.filter(range =>
      range.start < annotation.range.end && range.end > annotation.range.start
    )
    if (contributions.length === 0 || !contributions.every(range =>
      edit.start <= range.start && edit.end >= range.end
    )) continue
    removed.add(annotation)
    let start = annotation.range.start
    for (const arm of annotation.arms) {
      deleted.push({ start, end: arm.range.start })
      start = arm.range.end
    }
    deleted.push({ start, end: annotation.range.end })
  }
  const ranges: Array<{ start: number, end: number }> = []
  for (const range of deleted.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = ranges.at(-1)
    if (last !== undefined && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else ranges.push({ ...range })
  }
  const planned: DocumentSourceEdit[] = ranges.map(range => ({ ...range, insert: '' }))
  const replacement = planned.findIndex(range => range.start <= edit.start && edit.start <= range.end)
  if (replacement >= 0) planned[replacement] = { ...planned[replacement]!, insert: edit.insert }
  else if (edit.insert.length > 0) planned.push({ start: edit.start, end: edit.start, insert: edit.insert })
  planned.sort((a, b) => a.start - b.start)
  const validates = (planned: readonly DocumentSourceEdit[]): boolean => {
    const candidate = preview(planned)
    const shift = (offset: number, side: 'start' | 'end'): number => {
      let delta = 0
      for (const item of planned) {
        if (item.end < offset || (item.end === offset && (item.start < item.end || side === 'start'))) {
          delta += item.insert.length - (item.end - item.start)
        } else if (item.start < offset) return item.start + delta + item.insert.length
      }
      return offset + delta
    }
    const remaining = annotations.filter(annotation => !removed.has(annotation))
    const actual = annotationsOf(candidate.annotations)
    if (remaining.length !== actual.length || remaining.some((annotation, index) => {
      const next = actual[index]
      return next === undefined || next.kind !== annotation.kind || next.range.start !== shift(annotation.range.start, 'start') ||
        next.range.end !== shift(annotation.range.end, 'end') ||
        next.arms.length !== annotation.arms.length || annotation.arms.some((arm, armIndex) => {
        const nextArm = next.arms[armIndex]
        return nextArm === undefined || nextArm.name !== arm.name || nextArm.range.start !== shift(arm.range.start, 'end') ||
            nextArm.range.end !== shift(arm.range.end, 'start')
      })
    })) return false
    if (candidate.diagnostics.length !== revision.diagnostics.length) return false
    return true
  }
  if (!validates(planned)) {
    const protectedText = protectNativeCriticText(edit.insert)
    if (protectedText === edit.insert) return undefined
    for (let index = 0; index < planned.length; index += 1) {
      const item = planned[index]!
      if (item.insert.length > 0) planned[index] = { ...item, insert: protectedText }
    }
    if (!validates(planned)) return undefined
  }
  return Object.freeze(planned.map(item => Object.freeze(item)))
}
