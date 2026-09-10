import { protectNativeCriticText } from './trackedAuthoring.js'
import type { DocumentCore, DocumentRevision, DocumentSourceEdit, MarkdownAstNode, SourceRange } from './documentCore.js'

export type DocumentAuthorForm = 'addition' | 'comment' | 'highlight' | 'substitution'
export interface DocumentAuthorAction {
  readonly form: DocumentAuthorForm
  readonly range: SourceRange
  readonly text: string
}
export interface DocumentAuthorPlan {
  readonly edit: DocumentSourceEdit
  readonly selection: SourceRange
}

/** Authors review syntax and its resulting selection in the common document stack. */
export const planAuthor = (
  activeCore: DocumentCore,
  activeRevision: DocumentRevision,
  request: DocumentAuthorAction,
  preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision
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
      request.range.end <= request.range.start ||
      request.range.end > activeRevision.sourceLength ||
      (request.form === 'substitution' && request.text.length === 0)
  ) { return undefined }
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
  const pendingAnnotations = [...activeRevision.annotations]
  while (pendingAnnotations.length > 0) {
    const annotation = pendingAnnotations.pop()
    if (annotation === undefined) break
    const overlaps =
        authoredRange.start < annotation.range.end && authoredRange.end > annotation.range.start
    const contains =
        authoredRange.start <= annotation.range.start && authoredRange.end >= annotation.range.end
    if (overlaps && !contains) return undefined
    for (const arm of annotation.arms) {
      pendingAnnotations.push(...arm.annotations)
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
  ): DocumentAuthorPlan | undefined => {
    const insert =
        request.form === 'addition'
          ? `{++${selected}++}`
          : request.form === 'comment'
            ? `{==${selected}==}{>>${authoredText}<<}`
            : request.form === 'highlight'
              ? `{==${selected}==}`
              : `{~~${selected}~>${authoredText}~~}`
    const edit = Object.freeze({
      start: authoredRange.start,
      end: authoredRange.end,
      insert
    })

      // The document owner's preview proves both the form and its exact arms.
      // The returned selection belongs to that same resulting syntax.
    const candidate = preview([edit])
    const selectedContent = (range: SourceRange): SourceRange => selected === rawSelected
      ? Object.freeze({
        start: range.start + request.range.start - authoredRange.start,
        end: range.start + request.range.end - authoredRange.start
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
      const annotation = candidate.annotations.find(
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
      const annotation = candidate.annotations.find(
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
    const highlight = candidate.annotations.find(
      (item) => item.kind === 'highlight' && item.range.start === authoredRange.start
    )
    const comment = candidate.annotations.find(
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
  const rawCandidate = candidateFor(rawSelected, request.text)
  if (rawCandidate !== undefined) return rawCandidate
  const protectedSelected = protectCriticPayload(rawSelected)
  if (protectedSelected !== rawSelected) {
    const selectedCandidate = candidateFor(protectedSelected, request.text)
    if (selectedCandidate !== undefined) return selectedCandidate
  }
  if (request.form === 'addition' || request.form === 'highlight') return undefined
  const protectedText = request.text.replace(
    /\{\+\+|\+\+\}|\{--|--\}|\{~~|~>|~~\}|\{==|==\}|\{>>|<</g,
    (token) => `\\${token}`
  )
  if (protectedText === request.text) return undefined
  return candidateFor(protectedSelected, protectedText)
}
