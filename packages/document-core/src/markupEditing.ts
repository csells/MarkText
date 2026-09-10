import type {
  DocumentCore, DocumentRevision, DocumentSourceEdit
} from './documentCore.js'
import { markupAnnotations, markupEditOwnership } from './markupEditOwnership.js'
import { protectNativeCriticText } from './trackedAuthoring.js'

/** Source ranges come exclusively from the revision's Markup event stream. */
export function createMarkupSourceEdits(
  core: DocumentCore,
  revision: DocumentRevision,
  edit: DocumentSourceEdit,
  preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision
): readonly DocumentSourceEdit[] | undefined {
  return createMarkupCompoundSourceEdits(core, revision, [edit], preview)
}

/** Compile one atomic ordinary action against the same original owned syntax. */
export function createMarkupCompoundSourceEdits(
  core: DocumentCore,
  revision: DocumentRevision,
  edits: readonly DocumentSourceEdit[],
  preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision,
  canonicalImport = false,
  scope: 'visible' | 'structure' = 'visible'
): readonly DocumentSourceEdit[] | undefined {
  const ownership = markupEditOwnership(core, revision, edits, scope)
  if (ownership === undefined) return undefined
  const { annotations, deleted, removed } = ownership
  const ranges: Array<{ start: number, end: number }> = []
  for (const range of deleted.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = ranges.at(-1)
    if (last !== undefined && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else ranges.push({ ...range })
  }
  const planned: DocumentSourceEdit[] = ranges.map(range => ({ ...range, insert: '' }))
  for (const edit of edits) {
    if (edit.insert.length === 0) continue
    const replacement = planned.findIndex(range => range.start <= edit.start && edit.start <= range.end)
    if (replacement >= 0) {
      const previous = planned[replacement]
      if (previous === undefined) throw new Error('Missing replacement range')
      planned[replacement] = { ...previous, insert: previous.insert + edit.insert }
    } else planned.push({ start: edit.start, end: edit.start, insert: edit.insert })
  }
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
    let insertionShift = 0
    const inserted = planned.map(edit => {
      const start = edit.start + insertionShift
      insertionShift += edit.insert.length - (edit.end - edit.start)
      return { start, end: start + edit.insert.length }
    })
    const actual = markupAnnotations(candidate.annotations).filter(annotation =>
      !canonicalImport || !inserted.some(range => range.start <= annotation.range.start && annotation.range.end <= range.end))
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
    if (canonicalImport) return undefined
    let changed = false
    for (let index = 0; index < planned.length; index += 1) {
      const item = planned[index]
      if (item === undefined) continue
      const insert = protectNativeCriticText(item.insert)
      if (insert !== item.insert) {
        changed = true
        planned[index] = { ...item, insert }
      }
    }
    if (!changed) return undefined
    if (!validates(planned)) return undefined
  }
  return Object.freeze(planned.map(item => Object.freeze(item)))
}
