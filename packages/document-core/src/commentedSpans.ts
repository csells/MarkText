import type { DocumentClipboardAction } from './clipboardPlanning.js'
import type { CriticMarkupAnnotation, DocumentRevision, SourceRange } from './documentCore.js'
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
export function insertionOutsideCommentedSpans(pairs: readonly HighlightCommentPair[], position: number): number {
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
export function commentedSpanSafeInput(revision: DocumentRevision, action: DocumentInputAction): DocumentInputAction {
  if ('kind' in action) {
    if (action.command !== 'moveText') return action
    const at = collapsedAt(action.target)
    if (at === undefined) return action
    const moved = insertionOutsideCommentedSpans(pairsTouching(revision.annotations, at), at)
    return moved === at ? action : { ...action, target: Object.freeze({ start: moved, end: moved }) }
  }
  if (!action.inputType.startsWith('insert') || !('ranges' in action.selection)) return action
  const at = collapsedAt(action.selection)
  if (at === undefined || collapsedAt(action.range) !== at) return action
  const moved = insertionOutsideCommentedSpans(pairsTouching(revision.annotations, at), at)
  if (moved === at) return action
  return { ...action, selection: caretAt(moved), range: Object.freeze({ start: moved, end: moved }) }
}

export function commentedSpanSafeClipboard(revision: DocumentRevision, action: DocumentClipboardAction): DocumentClipboardAction {
  if (action.kind !== 'paste' || !('ranges' in action.selection)) return action
  const at = collapsedAt(action.selection)
  if (at === undefined) return action
  const moved = insertionOutsideCommentedSpans(pairsTouching(revision.annotations, at), at)
  if (moved === at) return action
  const current = action.currentSelection === undefined ? undefined : collapsedAt(action.currentSelection as DocumentInputSelection)
  return {
    ...action,
    selection: caretAt(moved),
    ...(current === at ? { currentSelection: caretAt(moved) } : {})
  }
}
