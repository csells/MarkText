import type { DocumentClipboardAction } from './clipboardPlanning.js'
import type { CriticMarkupAnnotation, DocumentRevision, DocumentSourceEdit, SourceRange } from './documentCore.js'
import type { DocumentInputAction, DocumentInputSelection, DocumentInputTarget } from './inputPlanning.js'
import type { DocumentTextSelection } from './sourceInputPlanning.js'

/**
 * A Highlight followed without a gap by a Comment in the same annotation list,
 * which Review presents as one commented span (ADR 0003). The relation is
 * derived from each revision, never stored.
 */
export interface HighlightCommentPair {
  readonly highlight: CriticMarkupAnnotation
  readonly comment: CriticMarkupAnnotation
  /** The Highlight's content arm. */
  readonly content: SourceRange
}

export interface HighlightCommentLayout {
  readonly pairs: readonly HighlightCommentPair[]
  /** Highlights no Comment follows without a gap. */
  readonly standalone: readonly CriticMarkupAnnotation[]
}

/**
 * Every Highlight in the Markup view, paired or standalone. Comment payloads
 * are isolated subdocuments (Profile 1 R5), so their annotations are skipped.
 */
export function highlightCommentLayout(roots: readonly CriticMarkupAnnotation[]): HighlightCommentLayout {
  const pairs: HighlightCommentPair[] = []
  const standalone: CriticMarkupAnnotation[] = []
  const pending: (readonly CriticMarkupAnnotation[])[] = [roots]
  while (pending.length > 0) {
    const list = pending.pop()!
    for (let index = 0; index < list.length; index += 1) {
      const annotation = list[index]!
      if (annotation.kind === 'comment') continue
      for (const arm of annotation.arms) pending.push(arm.annotations)
      if (annotation.kind !== 'highlight') continue
      const content = annotation.arms.find(arm => arm.name === 'content')
      if (content === undefined) continue
      const next = list[index + 1]
      if (next?.kind === 'comment' && next.range.start === annotation.range.end) {
        pairs.push(Object.freeze({ highlight: annotation, comment: next, content: content.range }))
      } else standalone.push(annotation)
    }
  }
  return Object.freeze({ pairs: Object.freeze(pairs), standalone: Object.freeze(standalone) })
}

/**
 * Where an insertion at `position` belongs so that it never enters the gap
 * between a Highlight and its Comment, and text typed at a commented span's
 * edges stays outside it, as Google Docs keeps text typed at the edge of
 * commented text out of the comment. The end edges lead after the Comment;
 * the start edge leads before the Highlight.
 */
function insertionOutsideCommentedSpans(pairs: readonly HighlightCommentPair[], position: number): number {
  let current = position
  // A nested pair can end where its enclosing pair's content ends.
  for (let pass = 0; pass <= pairs.length; pass += 1) {
    let moved = false
    for (const { highlight, comment, content } of pairs) {
      const nonempty = content.start < content.end
      if (current === highlight.range.end || nonempty && current === content.end) {
        current = comment.range.end
        moved = true
      } else if (nonempty && current === content.start) {
        current = highlight.range.start
        moved = true
      }
    }
    if (!moved) break
  }
  return current
}

/** The pairs whose Highlight touches `position`, found without walking unrelated annotations. */
function pairsTouching(roots: readonly CriticMarkupAnnotation[], position: number): HighlightCommentPair[] {
  const pairs: HighlightCommentPair[] = []
  const pending: (readonly CriticMarkupAnnotation[])[] = [roots]
  while (pending.length > 0) {
    const list = pending.pop()!
    for (let index = 0; index < list.length; index += 1) {
      const annotation = list[index]!
      if (annotation.range.start > position) break
      if (annotation.range.end < position || annotation.kind === 'comment') continue
      for (const arm of annotation.arms) pending.push(arm.annotations)
      const next = list[index + 1]
      const content = annotation.arms.find(arm => arm.name === 'content')
      if (annotation.kind === 'highlight' && content !== undefined && next?.kind === 'comment' && next.range.start === annotation.range.end) {
        pairs.push(Object.freeze({ highlight: annotation, comment: next, content: content.range }))
      }
    }
  }
  return pairs
}

const collapsedAt = (selection: DocumentInputSelection | DocumentInputTarget): number | undefined => {
  if ('start' in selection) return selection.start === selection.end ? selection.start : undefined
  if (!('ranges' in selection) || selection.ranges.length !== 1) return undefined
  const range = selection.ranges[0]
  return range !== undefined && range.anchor === range.focus ? range.anchor : undefined
}

const caretAt = (position: number): DocumentTextSelection =>
  Object.freeze({ ranges: Object.freeze([Object.freeze({ anchor: position, focus: position })]), primary: 0 })

/**
 * Moves a Markup insertion, drop or paste off a commented span's gap and
 * edges (plan 0012 G39). Source edits are not planned here: they keep the
 * bytes their author typed (ADR 0015).
 */
/**
 * `rootsAround` gives the root annotations around a position, as the
 * revision's roots in document order, with the root that directly follows
 * any of them; the revision's whole list when omitted.
 */
export function commentedSpanSafeInput(
  revision: DocumentRevision,
  action: DocumentInputAction,
  rootsAround: (position: number) => readonly CriticMarkupAnnotation[] = () => revision.annotations
): DocumentInputAction {
  if ('kind' in action) {
    if (action.command !== 'moveText') return action
    const at = collapsedAt(action.target)
    if (at === undefined) return action
    const moved = insertionOutsideCommentedSpans(pairsTouching(rootsAround(at), at), at)
    return moved === at ? action : { ...action, target: Object.freeze({ start: moved, end: moved }) }
  }
  if (!action.inputType.startsWith('insert') || !('ranges' in action.selection)) return action
  const at = collapsedAt(action.selection)
  if (at === undefined || collapsedAt(action.range) !== at) return action
  const moved = insertionOutsideCommentedSpans(pairsTouching(rootsAround(at), at), at)
  if (moved === at) return action
  return { ...action, selection: caretAt(moved), range: Object.freeze({ start: moved, end: moved }) }
}

export function commentedSpanSafeClipboard(
  revision: DocumentRevision,
  action: DocumentClipboardAction,
  rootsAround: (position: number) => readonly CriticMarkupAnnotation[] = () => revision.annotations
): DocumentClipboardAction {
  if (action.kind !== 'paste' || !('ranges' in action.selection)) return action
  const at = collapsedAt(action.selection)
  if (at === undefined) return action
  const moved = insertionOutsideCommentedSpans(pairsTouching(rootsAround(at), at), at)
  if (moved === at) return action
  const current = action.currentSelection === undefined ? undefined : collapsedAt(action.currentSelection as DocumentInputSelection)
  return {
    ...action,
    selection: caretAt(moved),
    ...(current === at ? { currentSelection: caretAt(moved) } : {})
  }
}

/**
 * Adjusts resolution edits so the Highlight/Comment relation stays meaningful
 * (Profile 2, "Editing around commented spans"; plan 0012 G39). `edits` each replace one whole annotation.
 * A commented passage whose text resolution removes loses its empty Highlight
 * and keeps a standalone Comment where it was (ADR 0003). A standalone Comment
 * that resolution would leave directly after a Highlight it was not paired
 * with moves to the end of that Highlight's text, which keeps its position
 * without making the two one commented span.
 */
export function commentPairPreservingResolution(
  roots: readonly CriticMarkupAnnotation[],
  edits: readonly DocumentSourceEdit[],
  slice: (range: SourceRange) => string
): readonly DocumentSourceEdit[] {
  let result = [...edits].sort((left, right) => left.start - right.start)
  const within = (range: SourceRange) => result.filter(edit => range.start <= edit.start && edit.end <= range.end)
  for (const { highlight, content } of highlightCommentLayout(roots).pairs) {
    if (content.start === content.end) continue
    const inside = within(content)
    if (inside.length === 0) continue
    let text = ''
    let offset = content.start
    for (const edit of inside) {
      text += slice({ start: offset, end: edit.start }) + edit.insert
      offset = edit.end
    }
    text += slice({ start: offset, end: content.end })
    if (text !== '') continue
    result = [...result.filter(edit => !inside.includes(edit)), Object.freeze({ ...highlight.range, insert: '' })]
      .sort((left, right) => left.start - right.start)
  }
  const removed = (annotation: CriticMarkupAnnotation) =>
    result.some(edit => edit.start === annotation.range.start && edit.end === annotation.range.end && edit.insert === '')
  const moves: DocumentSourceEdit[] = []
  const pending: (readonly CriticMarkupAnnotation[])[] = [roots]
  while (pending.length > 0) {
    const list = pending.pop()!
    for (let index = 0; index < list.length; index += 1) {
      const highlight = list[index]!
      if (highlight.kind !== 'comment') for (const arm of highlight.arms) pending.push(arm.annotations)
      const content = highlight.arms.find(arm => arm.name === 'content')
      if (highlight.kind !== 'highlight' || content === undefined || removed(highlight)) continue
      let end = highlight.range.end
      let next = index + 1
      while (list[next] !== undefined && list[next]!.range.start === end && list[next]!.kind !== 'comment' && removed(list[next]!)) {
        end = list[next]!.range.end
        next += 1
      }
      const comment = list[next]
      if (next === index + 1 || comment?.kind !== 'comment' || comment.range.start !== end || removed(comment)) continue
      moves.push(Object.freeze({ ...comment.range, insert: '' }))
      moves.push(Object.freeze({ start: content.range.end, end: content.range.end, insert: slice(comment.range) }))
    }
  }
  return Object.freeze([...result, ...moves].sort((left, right) => left.start - right.start || left.end - right.end))
}
