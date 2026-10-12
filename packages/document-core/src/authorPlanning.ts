import { CRITIC_TOKENS, commentPayloadCandidates } from './commentSpelling.js'
import { highlightCommentLayout, type HighlightCommentLayout, type HighlightCommentPair } from './commentedSpans.js'
import { protectNativeCriticText } from './trackedAuthoring.js'
import { spellSuggestion } from './internal/profile1/sourceTape.js'
import type { CriticMarkupAnnotation, DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, SourceRange } from './documentCore.js'

export type DocumentAuthorForm = 'addition' | 'comment' | 'highlight' | 'substitution'
export interface DocumentAuthorAction {
  readonly form: DocumentAuthorForm
  readonly range: SourceRange
  readonly text: string
}
export interface DocumentAuthorPlan {
  readonly edit: DocumentSourceEdit
  readonly selection: SourceRange
  /** Whether the spelling adds MarkText-only backslash escapes the author did not type (ADR 0015). */
  readonly escaped: boolean
}

/** Authors review syntax and its resulting selection in the common document stack. */
export const planAuthor = (
  activeCore: DocumentCore,
  activeRevision: DocumentRevision,
  request: DocumentAuthorAction,
  preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision,
  diagnosticsOf: (payload: string) => readonly { readonly range: SourceRange }[]
): DocumentAuthorPlan | undefined => {
  if (
    (request.form !== 'addition' &&
        request.form !== 'comment' &&
        request.form !== 'highlight' &&
        request.form !== 'substitution') ||
      request.range === null ||
      typeof request.range !== 'object' ||
      typeof request.text !== 'string' ||
      !Number.isSafeInteger(request.range.start) ||
      !Number.isSafeInteger(request.range.end) ||
      request.range.start < 0 ||
      request.range.end < request.range.start ||
      request.range.end > activeRevision.sourceLength ||
      (request.form === 'substitution' && request.text.length === 0)
  ) { return undefined }
  const layout = highlightCommentLayout(activeRevision.annotations)
  if (request.form === 'comment') {
    const around = innermostHighlightAround(layout, request.range)
    // A comment on text in a standalone highlight comments on that highlight;
    // in a commented passage it nests a new pair below.
    if (around !== undefined && layout.standalone.includes(around)) {
      return planHighlightComment(around, request.text, preview, diagnosticsOf)
    }
  }
  if (request.range.start === request.range.end) return undefined
  const projection = activeCore.project(activeRevision, 'revised')
  let authoredRange = request.range
  const visitForCompleteLink = (node: MarkdownAstNode): void => {
    if (node.kind === 'link' && node.children.length > 0) {
      const first = node.children[0]
      const last = node.children.at(-1)
      if (first !== undefined && last !== undefined) {
        const contentStart = projection.coordinates.toSource(first.range.start, 'next')
        const contentEnd = projection.coordinates.toSource(last.range.end, 'previous')
        if (contentStart === request.range.start && contentEnd === request.range.end) {
          authoredRange = Object.freeze({
            start: projection.coordinates.toSource(node.range.start, 'next'),
            end: projection.coordinates.toSource(node.range.end, 'previous')
          })
          return
        }
      }
    }
    for (const child of node.children) visitForCompleteLink(child)
  }
  visitForCompleteLink(projection.ast.root)
  const outside = outsideCommentedSpanEdges(layout.pairs, authoredRange)
  if (outside === undefined) return undefined
  authoredRange = outside
  // Every form nests inside any arm of any annotation, a Comment's payload
  // included (Profile 1 N1, N2), as Docs lets you highlight, suggest or
  // comment on text that is itself a suggestion. Pairing is properly nested,
  // so no form may cross an annotation's delimiters; Docs allows overlapping
  // comments, so a comment that overlaps highlighted text encloses all of it.
  for (let widened = true; widened;) {
    widened = false
    const pendingAnnotations = [...activeRevision.annotations]
    while (pendingAnnotations.length > 0) {
      const annotation = pendingAnnotations.pop()
      if (annotation === undefined) break
      const overlaps =
          authoredRange.start < annotation.range.end && authoredRange.end > annotation.range.start
      const contains =
          authoredRange.start <= annotation.range.start && authoredRange.end >= annotation.range.end
      if (overlaps && !contains) {
        const nested = annotation.arms.some(arm =>
          arm.range.start <= authoredRange.start && authoredRange.end <= arm.range.end)
        if (!nested && request.form !== 'comment') return undefined
        if (!nested) {
          const pair = layout.pairs.find(item => item.highlight === annotation || item.comment === annotation)
          const enclosed = pair === undefined
            ? annotation.kind === 'highlight' ? annotation.range : undefined
            : { start: pair.highlight.range.start, end: pair.comment.range.end }
          if (enclosed === undefined) return undefined
          authoredRange = Object.freeze({
            start: Math.min(authoredRange.start, enclosed.start),
            end: Math.max(authoredRange.end, enclosed.end)
          })
          widened = true
          break
        }
      }
      for (const arm of annotation.arms) {
        pendingAnnotations.push(...arm.annotations)
      }
    }
  }
  const protectCriticPayload = (source: string): string => {
    const protectedAnnotations: Array<
      Readonly<{
        readonly start: number
        readonly end: number
      }>
    > = []
    const pending = [...activeRevision.annotations]
    while (pending.length > 0) {
      const annotation = pending.pop()
      if (annotation === undefined) break
      if (
        annotation.range.start >= authoredRange.start &&
          annotation.range.end <= authoredRange.end
      ) {
        protectedAnnotations.push(annotation.range)
        continue
      }
      for (const arm of annotation.arms) pending.push(...arm.annotations)
    }
    protectedAnnotations.sort((left, right) => left.start - right.start || right.end - left.end)
    const parts: string[] = []
    let offset = 0
    for (const range of protectedAnnotations) {
      const start = range.start - authoredRange.start
      const end = range.end - authoredRange.start
      if (start < offset) continue
      parts.push(protectNativeCriticText(source.slice(offset, start)))
      parts.push(source.slice(start, end))
      offset = end
    }
    parts.push(protectNativeCriticText(source.slice(offset)))
    return parts.join('')
  }
  const rawSelected = activeCore.sourceSlice(activeRevision, authoredRange)
  const candidateFor = (
    selected: string,
    authoredText: string
  ): Omit<DocumentAuthorPlan, 'escaped'> | undefined => {
    const insert =
        request.form === 'addition'
          ? spellSuggestion('addition', selected)
          : request.form === 'comment'
            ? spellSuggestion('highlight', selected) + spellSuggestion('comment', authoredText)
            : request.form === 'highlight'
              ? spellSuggestion('highlight', selected)
              : spellSuggestion('substitution', selected, authoredText)
    const edit = Object.freeze({
      start: authoredRange.start,
      end: authoredRange.end,
      insert
    })

      // The document owner's preview proves both the form and its exact arms.
      // The returned selection belongs to that same resulting syntax.
    const candidate = preview([edit])
    // A form may nest inside another annotation, so its syntax can be below the top level.
    const authoredAnnotations = allAnnotations(candidate.annotations)
    const selectedContent = (range: SourceRange): SourceRange => selected === rawSelected
      ? Object.freeze({
        // The authored range can move off a commented span's hidden edges.
        start: range.start + Math.max(request.range.start, authoredRange.start) - authoredRange.start,
        end: range.start + Math.min(request.range.end, authoredRange.end) - authoredRange.start
      })
      : range
    const authoredEnd = authoredRange.start + insert.length
    if (
      candidate.diagnostics.some(
        (diagnostic) =>
          diagnostic.range.start < authoredEnd && diagnostic.range.end > authoredRange.start
      )
    ) { return undefined }
    if (request.form === 'substitution') {
      const annotation = authoredAnnotations.find(
        (item) =>
          item.kind === 'substitution' &&
            item.range.start === authoredRange.start &&
            item.range.end === authoredRange.start + insert.length
      )
      const oldArm = annotation?.arms.find((arm) => arm.name === 'old')
      const newArm = annotation?.arms.find((arm) => arm.name === 'new')
      return annotation !== undefined &&
          oldArm !== undefined &&
          newArm !== undefined &&
          newArm.annotations.length === 0 &&
          candidate.source.slice(oldArm.range.start, oldArm.range.end) === selected &&
          candidate.source.slice(newArm.range.start, newArm.range.end) === authoredText
        ? Object.freeze({ edit, selection: newArm.range })
        : undefined
    }
    if (request.form === 'addition' || request.form === 'highlight') {
      const annotation = authoredAnnotations.find(
        (item) =>
          item.kind === request.form &&
            item.range.start === authoredRange.start &&
            item.range.end === authoredRange.start + insert.length
      )
      const content = annotation?.arms.find((arm) => arm.name === 'content')
      return annotation !== undefined &&
          content !== undefined &&
          candidate.source.slice(content.range.start, content.range.end) === selected
        ? Object.freeze({ edit, selection: selectedContent(content.range) })
        : undefined
    }
    const highlight = authoredAnnotations.find(
      (item) => item.kind === 'highlight' && item.range.start === authoredRange.start
    )
    const comment = authoredAnnotations.find(
      (item) => item.kind === 'comment' && item.range.end === authoredRange.start + insert.length
    )
    const highlightContent = highlight?.arms.find((arm) => arm.name === 'content')
    const commentContent = comment?.arms.find((arm) => arm.name === 'comment')
    return highlight !== undefined &&
        comment !== undefined &&
        highlightContent !== undefined &&
        commentContent !== undefined &&
        commentContent.annotations.length === 0 &&
        highlight.range.end === comment.range.start &&
        candidate.source.slice(highlightContent.range.start, highlightContent.range.end) === selected &&
        candidate.source.slice(commentContent.range.start, commentContent.range.end) === authoredText
      ? Object.freeze({ edit, selection: selectedContent(highlightContent.range) })
      : undefined
  }
  const planned = (plan: Omit<DocumentAuthorPlan, 'escaped'> | undefined, selected: string, authoredText: string): DocumentAuthorPlan | undefined =>
    plan === undefined ? undefined : Object.freeze({ ...plan, escaped: selected !== rawSelected || authoredText !== request.text })
  const rawCandidate = planned(candidateFor(rawSelected, request.text), rawSelected, request.text)
  if (rawCandidate !== undefined) return rawCandidate
  const protectedSelected = protectCriticPayload(rawSelected)
  if (protectedSelected !== rawSelected) {
    const selectedCandidate = planned(candidateFor(protectedSelected, request.text), protectedSelected, request.text)
    if (selectedCandidate !== undefined) return selectedCandidate
  }
  if (request.form === 'addition' || request.form === 'highlight') return undefined
  if (request.form === 'comment') {
    for (const { payload } of commentPayloadCandidates(request.text, diagnosticsOf)) {
      if (payload === request.text) continue
      const commentCandidate = planned(candidateFor(protectedSelected, payload), protectedSelected, payload)
      if (commentCandidate !== undefined) return commentCandidate
    }
    return undefined
  }
  const protectedText = request.text.replace(CRITIC_TOKENS, (token) => `\\${token}`)
  if (protectedText === request.text) return undefined
  return planned(candidateFor(protectedSelected, protectedText), protectedSelected, protectedText)
}

/** The smallest Highlight whose content holds `range`, bounds included. */
function innermostHighlightAround(layout: HighlightCommentLayout, range: SourceRange): CriticMarkupAnnotation | undefined {
  let best: CriticMarkupAnnotation | undefined
  for (const highlight of [...layout.standalone, ...layout.pairs.map(pair => pair.highlight)]) {
    const content = highlight.arms.find(arm => arm.name === 'content')?.range
    if (content === undefined || content.start > range.start || range.end > content.end) continue
    if (best === undefined || highlight.range.end - highlight.range.start < best.range.end - best.range.start) best = highlight
  }
  return best
}

/**
 * Keeps an authored range's delimiters out of a commented span's gap and off
 * its hidden edges (Profile 2, V6): a range that starts at the end of
 * commented text starts after its Comment, one that ends at its start ends
 * before its Highlight, and one that covers all its text takes the Comment.
 */
function outsideCommentedSpanEdges(pairs: readonly HighlightCommentPair[], range: SourceRange): SourceRange | undefined {
  let { start, end } = range
  for (let pass = 0; pass <= pairs.length; pass += 1) {
    const before = [start, end]
    for (const { highlight, comment, content } of pairs) {
      const nonempty = content.start < content.end
      if (start === highlight.range.end || nonempty && start === content.end) start = comment.range.end
      if (nonempty && end === content.start) end = highlight.range.start
      if (end === highlight.range.end || nonempty && end === content.end) {
        if (start <= highlight.range.start) end = comment.range.end
        else if (end === highlight.range.end) end = content.end
      }
    }
    if (before[0] === start && before[1] === end) break
  }
  return start < end ? Object.freeze({ start, end }) : undefined
}

/** Adds a Comment directly after a standalone Highlight, forming one commented span. */
function planHighlightComment(
  highlight: CriticMarkupAnnotation,
  text: string,
  preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision,
  diagnosticsOf: (payload: string) => readonly { readonly range: SourceRange }[]
): DocumentAuthorPlan | undefined {
  const content = highlight.arms.find(arm => arm.name === 'content')?.range
  if (content === undefined || content.start === content.end) return undefined
  const at = highlight.range.end
  const payloads = [text, ...commentPayloadCandidates(text, diagnosticsOf).map(({ payload }) => payload).filter(payload => payload !== text)]
  for (const payload of payloads) {
    const edit = Object.freeze({ start: at, end: at, insert: spellSuggestion('comment', payload) })
    const candidate = preview([edit])
    const end = at + edit.insert.length
    if (candidate.diagnostics.some(diagnostic => diagnostic.range.start < end && diagnostic.range.end > at)) continue
    const pair = highlightCommentLayout(candidate.annotations).pairs.find(item =>
      item.highlight.range.start === highlight.range.start && item.highlight.range.end === at && item.comment.range.end === end)
    const arm = pair?.comment.arms.find(item => item.name === 'comment')
    if (arm === undefined || arm.annotations.length > 0 || candidate.source.slice(arm.range.start, arm.range.end) !== payload) continue
    return Object.freeze({ edit, selection: Object.freeze({ ...content }), escaped: payload !== text })
  }
  return undefined
}

/** Every annotation of the trees `roots`, nested ones included. */
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
