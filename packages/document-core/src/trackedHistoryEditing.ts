import type { CriticMarkupAnnotation, DocumentCore, DocumentRevision, DocumentSourceEdit, SourceRange } from './documentCore.js'
import { markupAnnotations } from './markupEditOwnership.js'
import { trackedPreviewFacts } from './trackedExtent.js'
import { annotationsOverlapping } from './internal/annotationsAround.js'

type Preview = (edits: readonly DocumentSourceEdit[]) => DocumentRevision

/** Arms whose text a reader already sees as proposed: the author's own draft. */
const draftArm = (annotation: CriticMarkupAnnotation, name: string): boolean =>
  annotation.kind === 'addition' && name === 'content' || annotation.kind === 'substitution' && name === 'new' ||
  annotation.kind === 'highlight' && name === 'content'

/**
 * Text a tracked edit may still change inside `range`. Deleted text (deletion
 * content, old arms), comments and annotation delimiters are already history
 * or syntax: as in Google Docs, deleting or replacing them again changes
 * nothing. An annotation the range encloses completely stays part of the edit.
 * With `enclosed`, an enclosed deletion's or substitution's deleted text and
 * syntax are frozen too, and an enclosed addition is a part of its own. Returns undefined when nothing inside the range is frozen; `history` says
 * whether deleted text or a comment is, rather than only a draft's delimiters.
 */
export function trackedEditableSpans(core: DocumentCore, revision: DocumentRevision, range: SourceRange, enclosed = false): (readonly SourceRange[] & { readonly history: boolean }) | undefined {
  if (range.start >= range.end) return undefined
  // Only annotations overlapping the range freeze or annotate its text.
  const roots = annotationsOverlapping(core, revision, range)
  const frozen: Array<SourceRange & { history: boolean }> = []
  const cuts: number[] = []
  const visit = (annotations: readonly CriticMarkupAnnotation[]): void => {
    for (const annotation of annotations) {
      if (annotation.range.end <= range.start || annotation.range.start >= range.end) continue
      const inside = range.start <= annotation.range.start && annotation.range.end <= range.end
      // An enclosed addition is one's own draft: it goes as a whole, apart
      // from the text around it.
      if (enclosed && inside && annotation.kind === 'addition') cuts.push(annotation.range.start, annotation.range.end)
      // Enclosed comments and highlights go with the text they annotate.
      if (inside && (!enclosed || annotation.kind !== 'deletion' && annotation.kind !== 'substitution')) continue
      const history = annotation.kind === 'deletion' || annotation.kind === 'substitution' || annotation.kind === 'comment'
      let cursor = annotation.range.start
      for (const arm of annotation.arms) {
        if (cursor < arm.range.start) frozen.push({ start: cursor, end: arm.range.start, history })
        if (draftArm(annotation, arm.name)) visit(arm.annotations)
        else frozen.push({ ...arm.range, history })
        cursor = arm.range.end
      }
      if (cursor < annotation.range.end) frozen.push({ start: cursor, end: annotation.range.end, history })
    }
  }
  visit(roots)
  const blocked = frozen.filter(span => span.end > range.start && span.start < range.end)
    .sort((left, right) => left.start - right.start)
  const cut = (span: SourceRange): SourceRange[] => {
    const points = [span.start, ...cuts.filter(point => span.start < point && point < span.end), span.end]
    return points.slice(1).map((end, index) => Object.freeze({ start: points[index]!, end }))
  }
  const spans: SourceRange[] = []
  let cursor = range.start
  for (const span of blocked) {
    if (span.start > cursor) spans.push(...cut({ start: cursor, end: Math.min(span.start, range.end) }))
    cursor = Math.max(cursor, span.end)
  }
  if (cursor < range.end) spans.push(...cut({ start: cursor, end: range.end }))
  // A comment alone is a note on text, not text a reader edits.
  const comments = markupAnnotations(roots).filter(annotation => annotation.kind === 'comment')
  const text = spans.filter(span => {
    let cursor = span.start
    for (const comment of comments.filter(comment => comment.range.start >= span.start && comment.range.end <= span.end)
      .sort((left, right) => left.range.start - right.range.start)) {
      if (comment.range.start > cursor) return true
      cursor = Math.max(cursor, comment.range.end)
    }
    return cursor < span.end
  })
  if (blocked.length === 0 && spans.length <= 1 && text.length === spans.length) return undefined
  return Object.freeze(Object.assign(text, { history: blocked.some(span => span.history) || text.length < spans.length }))
}

const historyArm = (annotation: CriticMarkupAnnotation) =>
  annotation.arms.find(arm => arm.name === (annotation.kind === 'deletion' ? 'content' : annotation.kind === 'substitution' ? 'old' : ''))

/**
 * A new deletion beside existing deleted text extends that deletion, as
 * repeated Backspace or Delete extends one Google Docs suggestion. `planned`
 * is the separate suggestion; the merge is admitted only when both read the
 * same in the Original and Revised views.
 */
export function mergedTrackedDeletion(
  core: DocumentCore,
  previous: DocumentRevision,
  deleted: SourceRange,
  planned: DocumentSourceEdit,
  preview: Preview
): DocumentSourceEdit | undefined {
  if (trackedPartsSeparate(core)) return undefined
  if (planned.start !== deleted.start || planned.end !== deleted.end || !planned.insert.startsWith('{--') || !planned.insert.endsWith('--}')) return undefined
  const payload = planned.insert.slice(3, -3)
  const annotations = markupAnnotations(previous.annotations)
  const left = annotations.find(annotation => annotation.kind === 'deletion' && annotation.range.end === deleted.start)
  const right = annotations.find(annotation => (annotation.kind === 'deletion' || annotation.kind === 'substitution') &&
    annotation.range.start === deleted.end)
  if (left === undefined && right === undefined) return undefined
  const leftContent = left === undefined ? undefined : historyArm(left)
  const rightHistory = right === undefined ? undefined : historyArm(right)
  if (left !== undefined && leftContent === undefined || right !== undefined && rightHistory === undefined) return undefined
  const opener = right?.kind === 'substitution' ? '{~~' : '{--'
  const merged = leftContent !== undefined && rightHistory !== undefined
    ? right!.kind === 'deletion'
      ? { start: leftContent.range.end, end: rightHistory.range.start, insert: payload }
      : { start: left!.range.start, end: rightHistory.range.start, insert: opener + core.sourceSlice(previous, leftContent.range) + payload }
    : leftContent !== undefined
      ? { start: leftContent.range.end, end: deleted.end, insert: payload + core.sourceSlice(previous, { start: leftContent.range.end, end: left!.range.end }) }
      : { start: deleted.start, end: rightHistory!.range.start, insert: opener + payload }
  const candidate = preview([merged])
  const separate = preview([planned])
  const facts = trackedPreviewFacts.get(candidate)
  const expected = trackedPreviewFacts.get(separate)
  if (facts === undefined || expected === undefined || facts.original !== expected.original || facts.revised !== expected.revised ||
      candidate.diagnostics.length !== previous.diagnostics.length) return undefined
  const start = left?.range.start ?? deleted.start
  const shift = merged.insert.length - (merged.end - merged.start)
  const end = (right?.range.end ?? deleted.end) + shift
  const kind = right?.kind ?? 'deletion'
  return markupAnnotations(candidate.annotations).some(annotation => annotation.kind === kind &&
    annotation.range.start === start && annotation.range.end === end)
    ? Object.freeze(merged)
    : undefined
}

/**
 * Text typed immediately before deleted text replaces it: one Substitution, as
 * Google Docs merges it into "Replace 'old' with 'new'". Admitted only when the
 * Revised view is the untracked insertion and the Original is unchanged.
 */
export function substitutionBeforeDeletion(
  core: DocumentCore,
  previous: DocumentRevision,
  at: number,
  payload: string,
  typed: string,
  preview: Preview
): DocumentSourceEdit | undefined {
  if (trackedPartsSeparate(core)) return undefined
  const annotations = markupAnnotations(previous.annotations)
  const deletion = annotations.find(annotation => annotation.kind === 'deletion' &&
    (annotation.range.start === at || annotation.arms.some(arm => arm.name === 'content' && arm.range.start === at)))
  const content = deletion === undefined ? undefined : historyArm(deletion)
  if (deletion === undefined || content === undefined) return undefined
  // Typing directly after one's own proposed text extends that proposal.
  if (annotations.some(annotation => (annotation.kind === 'addition' || annotation.kind === 'substitution') &&
    annotation.range.end === deletion.range.start && !withinHistory(previous.annotations, annotation.range))) return undefined
  const old = core.sourceSlice(previous, content.range)
  // A deleted block keeps text typed before it as its own Addition.
  if (/[\r\n]/u.test(old)) return undefined
  const insert = `{~~${old}~>${payload}~~}`
  const edit = Object.freeze({ start: deletion.range.start, end: deletion.range.end, insert })
  const candidate = preview([edit])
  const facts = trackedPreviewFacts.get(candidate)
  if (facts === undefined || candidate.diagnostics.length !== previous.diagnostics.length) return undefined
  if (facts.original !== core.project(previous, 'original').markdown) return undefined
  const revised = core.project(previous, 'revised')
  const point = revised.coordinates.toProjected(deletion.range.start, 'next')
  if (facts.revised !== revised.markdown.slice(0, point) + typed + revised.markdown.slice(point)) return undefined
  const substitution = markupAnnotations(candidate.annotations).find(annotation => annotation.kind === 'substitution' &&
    annotation.range.start === edit.start && annotation.range.end === edit.start + insert.length)
  const arms = substitution?.arms
  return arms?.find(arm => arm.name === 'old' && candidate.source.slice(arm.range.start, arm.range.end) === old) !== undefined &&
    arms.find(arm => arm.name === 'new' && candidate.source.slice(arm.range.start, arm.range.end) === payload) !== undefined
    ? edit
    : undefined
}

/**
 * A caret on an old arm's edge or its separator types into the Substitution's
 * proposed text, whose start follows the retained history.
 */
export function substitutionDraftInsertionPoint(previous: DocumentRevision, at: number): number | undefined {
  for (const annotation of markupAnnotations(previous.annotations)) {
    if (annotation.kind !== 'substitution') continue
    const old = annotation.arms.find(arm => arm.name === 'old')
    const next = annotation.arms.find(arm => arm.name === 'new')
    if (old === undefined || next === undefined) continue
    if (at === old.range.start || old.range.end <= at && at < next.range.start) return next.range.start
  }
  return undefined
}

/** The empty edit a tracked no-op compiles to. */
export const unchangedTrackedEdit = (edit: DocumentSourceEdit): boolean => edit.start === edit.end && edit.insert.length === 0

/**
 * A tracked edit that also covers deleted text or annotation syntax changes
 * only the rest, as Google Docs does: deleting deleted text again is a no-op,
 * and a replacement proposes its text for the first remaining part. `compile`
 * plans each part, which no longer reaches frozen text. The result is
 * ordered, disjoint and possibly empty.
 */
export function trackedEditableEdits(
  core: DocumentCore,
  edit: DocumentSourceEdit,
  editable: readonly SourceRange[],
  compile: (edit: DocumentSourceEdit) => DocumentSourceEdit | undefined
): readonly DocumentSourceEdit[] | undefined {
  if (editable.length === 0) {
    if (edit.insert.length === 0) return Object.freeze([])
    // Typing over deleted text only is typing at the selection's start.
    const typed = compile({ start: edit.start, end: edit.start, insert: edit.insert })
    return typed === undefined ? undefined : Object.freeze(unchangedTrackedEdit(typed) ? [] : [typed])
  }
  const planned: DocumentSourceEdit[] = []
  const compileAll = (): boolean => {
    for (const [index, span] of editable.entries()) {
      const part = compile({ ...span, insert: index === 0 ? edit.insert : '' })
      if (part === undefined) return false
      if (!unchangedTrackedEdit(part)) planned.push(part)
    }
    return true
  }
  // Separate parts do not merge into neighbouring suggestions, so they stay disjoint.
  if (!(editable.length === 1 ? compileAll() : separateTrackedParts(core, compileAll))) return undefined
  if (planned.some((part, index) => index > 0 && planned[index - 1]!.end > part.start)) return undefined
  return Object.freeze(planned)
}

/** One edit spelling ordered disjoint parts, with the untouched gaps verbatim. */
export function joinedTrackedEdit(core: DocumentCore, previous: DocumentRevision, at: number, parts: readonly DocumentSourceEdit[]): DocumentSourceEdit {
  const first = parts[0]
  const last = parts.at(-1)
  if (first === undefined || last === undefined) return Object.freeze({ start: at, end: at, insert: '' })
  let insert = ''
  let cursor = first.start
  for (const part of parts) {
    insert += core.sourceSlice(previous, { start: cursor, end: part.start }) + part.insert
    cursor = part.end
  }
  return Object.freeze({ start: first.start, end: last.end, insert })
}

/** Whether `range` lies inside deleted text or a comment, which a reader cannot type into. */
export const withinHistory = (annotations: readonly CriticMarkupAnnotation[], range: SourceRange): boolean =>
  markupAnnotations(annotations).some(annotation => annotation.arms.some(arm =>
    (annotation.kind === 'deletion' || arm.name === 'old' || arm.name === 'comment') &&
    arm.range.start <= range.start && range.end <= arm.range.end))

/**
 * Where typing at `at` lands: a caret inside a suggestion nested in deleted
 * text types before that suggestion, and one inside annotation syntax or a
 * comment types beside it, outside the comment (Google Docs).
 */
export function historyInsertionPoint(annotations: readonly CriticMarkupAnnotation[], at: number): number {
  const all = markupAnnotations(annotations)
  let point = at
  for (let guard = 0; guard < all.length + 1; guard += 1) {
    const nested = all.find(annotation => annotation.range.start < point && point < annotation.range.end &&
      withinHistory(annotations, annotation.range))
    if (nested !== undefined) {
      point = nested.range.start
      continue
    }
    const owner = all.find(annotation => annotation.range.start < point && point < annotation.range.end && !annotation.arms.some(arm =>
      arm.name !== 'comment' && arm.range.start <= point && point <= arm.range.end))
    const first = owner?.arms[0]
    const last = owner?.arms.at(-1)
    if (owner === undefined || first === undefined || last === undefined) return point
    if (point < first.range.start) point = owner.range.start
    else if (point > last.range.end || owner.kind === 'comment') point = owner.range.end
    else return point
  }
  return point
}

const separateCores = new WeakSet<DocumentCore>()

/** Compile with suggestions kept apart: no merge with, or rejoin of, neighbours. */
export function separateTrackedParts<T>(core: DocumentCore, compile: () => T): T {
  if (separateCores.has(core)) return compile()
  separateCores.add(core)
  try {
    return compile()
  } finally {
    separateCores.delete(core)
  }
}

export const trackedPartsSeparate = (core: DocumentCore): boolean => separateCores.has(core)
