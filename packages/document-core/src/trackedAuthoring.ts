import type {
  CriticMarkupAnnotation, DocumentCore, DocumentRevision,
  DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, SourceRange
} from './documentCore.js'
import { markupAnnotations as annotationTree, markupReplacementRange } from './markupEditOwnership.js'

/** Protective spelling retains exactly where the language compiler inserts escapes. */
export const nativeCriticSpelling = (value: string): Readonly<{ text: string, escapes: readonly number[] }> => {
  const escapes: number[] = []
  const text = value.replace(
    /\{\+\+|\+\+\}|\{--|--\}|\{~~|~>|~~\}|\{==|==\}|\{>>|<<\}/g,
    (token, offset: number) => {
      escapes.push(offset)
      return `\\${token}`
    }
  )
  return Object.freeze({ text, escapes: Object.freeze(escapes) })
}

/** Protective spelling for native text, shared by tracked and ordinary authoring. */
export const protectNativeCriticText = (value: string): string => nativeCriticSpelling(value).text

/** Enclose an authored block before compiling its tracked arms. */
export function prepareTrackedBlockEdit(
  core: DocumentCore,
  revision: DocumentRevision,
  edit: DocumentSourceEdit,
  syntax: MarkupSyntax
): DocumentSourceEdit {
  const insertedEnd = edit.start + edit.insert.length
  const pending = [syntax.ast.root]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) break
    pending.push(...node.children)
    if (node.kind !== 'html-block' || node.attributes.termination !== 'blank-line') continue
    const start = syntax.coordinates.toSource(node.range.start, 'next')
    const end = syntax.coordinates.toSource(node.range.end, 'previous')
    if (start < edit.start || start >= insertedEnd || end < insertedEnd) continue
    // The literal can swallow later blocks until we terminate it. The actual
    // operation owns only its insertion and the immediately retained EOL,
    // never that later text, regardless of the candidate literal's extent.
    const suffix = core.sourceSlice(revision, { start: edit.end, end: Math.min(edit.end + 2, revision.sourceLength) })
      .match(/^(?:\r\n|\r|\n)/u)?.[0] ?? ''
    const originalEnd = edit.end + suffix.length
    const eol = suffix.match(/\r\n|\r|\n/u)?.[0] ?? edit.insert.match(/\r\n|\r|\n/u)?.[0] ?? '\n'
    const payload = edit.insert + suffix
    const terminated = payload.endsWith(eol + eol) ? payload : payload.endsWith(eol) ? payload + eol : payload + eol + eol
    return Object.freeze({ start: edit.start, end: originalEnd, insert: terminated })
  }
  return edit
}

/** Pending draft arms use ordinary replacement ownership, including nested marks. */
export function createTrackedPendingArmEdits(
  core: DocumentCore,
  revision: DocumentRevision,
  edits: readonly DocumentSourceEdit[]
): readonly DocumentSourceEdit[] | undefined {
  if (!edits.some(edit => edit.start < edit.end)) return undefined
  const annotations = annotationTree(revision.annotations)
  let owner: CriticMarkupAnnotation | undefined
  for (const annotation of annotations) {
    const content = annotation.arms.find(arm =>
      arm.name === (annotation.kind === 'addition' ? 'content' : annotation.kind === 'substitution' ? 'new' : ''))
    if (content !== undefined && edits.every(edit =>
      content.range.start <= edit.start && edit.end <= content.range.end) &&
      (owner === undefined || annotation.range.end - annotation.range.start < owner.range.end - owner.range.start)) {
      owner = annotation
    }
  }
  const content = owner?.arms.find(arm => arm.name === (owner.kind === 'addition' ? 'content' : 'new'))
  if (content === undefined || content.annotations.length === 0) return undefined
  // A replacement of the enclosing draft may remove nested suggestions, but
  // typing within an existing old/deleted/comment arm cannot rewrite its history.
  if (annotations.some(annotation => annotation.arms.some(arm =>
    (arm.name === 'old' || arm.name === 'comment' || annotation.kind === 'deletion') &&
    edits.some(edit => arm.range.start <= edit.start && edit.end <= arm.range.end)))) return undefined
  const planned = core.markupEdits(revision, edits)
  if (planned === undefined || planned.some(edit => edit.start < content.range.start || edit.end > content.range.end)) return undefined
  return planned
}

/** Literal payloads cannot contain active CM; suggest a replacement of their owned syntax. */
export function createTrackedLiteralSourceEdit(
  core: DocumentCore,
  revision: DocumentRevision,
  edit: DocumentSourceEdit,
  preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision
): DocumentSourceEdit | undefined {
  const { ast, coordinates } = core.project(revision, 'markup').syntax
  let owner: SourceRange | undefined
  const visit = (node: MarkdownAstNode): void => {
    if (['inline-code', 'code-block', 'inline-math', 'math-block', 'inline-html', 'html-block', 'front-matter', 'diagram'].includes(node.kind)) {
      const start = coordinates.toSource(node.range.start, 'next')
      const end = coordinates.toSource(node.range.end, 'previous')
      if (start <= edit.start && edit.end <= end && (start !== edit.start || end !== edit.end)) {
        let covered = node.range.start
        for (const segment of coordinates.sourceSegments ?? []) {
          const from = Math.max(node.range.start, segment.projected.start)
          const to = Math.min(node.range.end, segment.projected.end)
          if (to <= from) continue
          if (from !== covered || segment.source.start + from - segment.projected.start !== start + from - node.range.start) return
          covered = to
        }
        if (covered === node.range.end && end - start === node.range.end - node.range.start) owner = { start, end }
      }
    }
    for (const child of node.children) visit(child)
  }
  visit(ast.root)
  if (owner === undefined) return undefined
  const original = core.sourceSlice(revision, owner)
  const insert = original.slice(0, edit.start - owner.start) + edit.insert + original.slice(edit.end - owner.start)
  if (insert === original) return undefined
  return createTrackedSourceEdit(core, revision, { ...owner, insert }, preview)
}

/** Exterior typing may extend an inline draft, but cannot acquire container syntax. */
function pendingArmOwnsInlineEdge(core: DocumentCore, revision: DocumentRevision, range: SourceRange, after: boolean): boolean {
  if (range.start === range.end) return true
  const syntax = core.project(revision, 'markup').syntax
  const edge = syntax.coordinates.toProjected(after ? range.end : range.start, after ? 'previous' : 'next')
  const visit = (node: MarkdownAstNode): boolean => {
    if (after ? node.range.start >= edge || node.range.end < edge : node.range.start > edge || node.range.end <= edge) return false
    if (['text', 'inline-code', 'inline-math', 'inline-html', 'autolink', 'image', 'footnote-reference'].includes(node.kind)) {
      const start = syntax.coordinates.toSource(node.range.start, 'next')
      const end = syntax.coordinates.toSource(node.range.end, 'previous')
      return start < range.end && end > range.start
    }
    return node.children.some(visit)
  }
  return visit(syntax.ast.root)
}

// Author tracked changes from the revision-owned syntax. Candidate validation
// preserves the exact arms before the caller admits the resulting source edit.
export const createTrackedSourceEdit = (
  activeCore: DocumentCore,
  activeRevision: DocumentRevision,
  edit: DocumentSourceEdit,
  preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision,
  preserveCanonicalMarkup = false,
  scope: 'visible' | 'structure' = 'visible'
): DocumentSourceEdit | undefined => {
  const request = { range: { start: edit.start, end: edit.end }, text: edit.insert }
  if (
    request.range === null || typeof request.range !== 'object' ||
    typeof request.text !== 'string' ||
    !Number.isSafeInteger(request.range.start) ||
    !Number.isSafeInteger(request.range.end) ||
    request.range.start < 0 || request.range.end < request.range.start ||
    request.range.end > activeRevision.sourceLength
  ) return undefined
  if (request.range.start < request.range.end && request.text.length > 0) {
    const range = markupReplacementRange(activeCore, activeRevision, edit, scope)
    if (range === undefined) return undefined
    request.range = range
  }
  const insertion = request.range.start === request.range.end && request.text.length > 0
  if (insertion) {
    const annotations = annotationTree(activeRevision.annotations)
    const deletionEdge = annotations.find(annotation => annotation.kind === 'deletion' &&
      annotation.arms.some(arm => arm.name === 'content' &&
        (arm.range.start === request.range.start || arm.range.end === request.range.start)))
    if (deletionEdge !== undefined) {
      const content = deletionEdge.arms.find(arm => arm.name === 'content')!
      const offset = request.range.start === content.range.end ? deletionEdge.range.end : deletionEdge.range.start
      // The editing view elides delimiters. Typing at a deletion edge creates
      // a new suggestion outside it, preserving the original deleted payload.
      request.range = { start: offset, end: offset }
    }
    const adjacent = annotations.find(annotation =>
      (annotation.kind === 'addition' || annotation.kind === 'substitution') &&
      annotation.range.end === request.range.start
    ) ?? annotations.find(annotation =>
      (annotation.kind === 'addition' || annotation.kind === 'substitution') &&
      annotation.range.start === request.range.start
    )
    const arm = adjacent?.arms.find(arm =>
      arm.name === (adjacent.kind === 'addition' ? 'content' : 'new')
    )
    if (adjacent !== undefined && arm !== undefined) {
      const after = adjacent.range.end === request.range.start
      if (pendingArmOwnsInlineEdge(activeCore, activeRevision, arm.range, after)) {
        const offset = after ? arm.range.end : arm.range.start
        request.range = { start: offset, end: offset }
      }
    }
  }
  const deletion = request.range.end > request.range.start && request.text.length === 0
  const substitution = request.range.end > request.range.start &&
    request.text.length > 0
  if (!insertion && !deletion && !substitution) return undefined
  const protect = (value: string, pattern: RegExp): string =>
    value.replace(pattern, token => `\\${token}`)
  const protectedNativeText = protectNativeCriticText(request.text)
  if (insertion) {
    const pending = [...activeRevision.annotations]
    let deepestAnnotation: CriticMarkupAnnotation | undefined
    while (pending.length > 0) {
      const annotation = pending.pop()
      if (annotation === undefined) break
      if (
        request.range.start > annotation.range.start &&
        request.range.start < annotation.range.end &&
        (deepestAnnotation === undefined ||
          annotation.range.end - annotation.range.start <
            deepestAnnotation.range.end - deepestAnnotation.range.start)
      ) deepestAnnotation = annotation
      for (const arm of annotation.arms) pending.push(...arm.annotations)
    }
    if (deepestAnnotation?.kind === 'highlight') {
      const content = deepestAnnotation.arms.find(arm => arm.name === 'content')
      if (content === undefined || request.range.start < content.range.start ||
          request.range.start > content.range.end) return undefined
      // A highlight annotates unchanged text. New typing remains a nested
      // suggestion, while additions and replacement arms extend their draft.
    } else if (deepestAnnotation !== undefined) {
      const content = deepestAnnotation.kind === 'addition'
        ? deepestAnnotation.arms.find(arm => arm.name === 'content')
        : deepestAnnotation.kind === 'substitution'
          ? deepestAnnotation.arms.find(arm => arm.name === 'new')
          : undefined
      if (
        content === undefined || request.range.start < content.range.start ||
        request.range.start > content.range.end
      ) return undefined
      const originalContent = activeCore.sourceSlice(activeRevision, content.range)
      const originalOld = deepestAnnotation.kind === 'substitution'
        ? deepestAnnotation.arms.find(arm => arm.name === 'old')
        : undefined
      const originalOldSource = originalOld === undefined
        ? undefined
        : activeCore.sourceSlice(activeRevision, originalOld.range)
      const localOffset = request.range.start - content.range.start
      const annotationCount = (annotations: readonly CriticMarkupAnnotation[]): number =>
        annotations.reduce((count, item) => count + 1 + item.arms.reduce(
          (armCount, arm) => armCount + annotationCount(arm.annotations),
          0
        ), 0)
      const originalAnnotationCount = annotationCount(content.annotations)
      const extensionCandidate = (payload: string): DocumentSourceEdit | undefined => {
        const candidate = preview([{ ...request.range, insert: payload }])
        const extended = annotationTree(candidate.annotations).find(item =>
          item.kind === deepestAnnotation.kind &&
          item.range.start === deepestAnnotation.range.start &&
          item.range.end === deepestAnnotation.range.end + payload.length
        )
        const extendedContent = extended?.arms.find(arm =>
          arm.name === (deepestAnnotation.kind === 'addition' ? 'content' : 'new')
        )
        const extendedOld = deepestAnnotation.kind === 'substitution'
          ? extended?.arms.find(arm => arm.name === 'old')
          : undefined
        return extended !== undefined && extendedContent !== undefined &&
          (deepestAnnotation.kind !== 'substitution' ||
            (extendedOld !== undefined && originalOldSource !== undefined &&
              candidate.source.slice(extendedOld.range.start, extendedOld.range.end) ===
                originalOldSource)) &&
          !candidate.diagnostics.some(diagnostic =>
            diagnostic.range.start < extended.range.end &&
            diagnostic.range.end > extended.range.start
          ) &&
          annotationCount(extendedContent.annotations) === originalAnnotationCount &&
          candidate.source.slice(extendedContent.range.start, extendedContent.range.end) ===
            originalContent.slice(0, localOffset) + payload +
            originalContent.slice(localOffset)
          ? Object.freeze({ ...request.range, insert: payload })
          : undefined
      }
      const rawExtension = extensionCandidate(request.text)
      if (rawExtension !== undefined) return rawExtension
      return protectedNativeText === request.text
        ? undefined
        : extensionCandidate(protectedNativeText)
    }
  }
  if (substitution) {
    const pending = [...activeRevision.annotations]
    let deepestAnnotation: CriticMarkupAnnotation | undefined
    while (pending.length > 0) {
      const annotation = pending.pop()
      if (annotation === undefined) break
      const content = annotation.kind === 'addition'
        ? annotation.arms.find(arm => arm.name === 'content')
        : annotation.kind === 'substitution'
          ? annotation.arms.find(arm => arm.name === 'new')
          : undefined
      if (
        content !== undefined && (content.annotations.length === 0 || preserveCanonicalMarkup) &&
        request.range.start >= content.range.start &&
        request.range.end <= content.range.end &&
        (deepestAnnotation === undefined ||
          annotation.range.end - annotation.range.start <
            deepestAnnotation.range.end - deepestAnnotation.range.start)
      ) deepestAnnotation = annotation
      for (const arm of annotation.arms) pending.push(...arm.annotations)
    }
    if (deepestAnnotation !== undefined) {
      const content = deepestAnnotation.kind === 'addition'
        ? deepestAnnotation.arms.find(arm => arm.name === 'content')
        : deepestAnnotation.arms.find(arm => arm.name === 'new')
      if (content === undefined) return undefined
      const originalContent = activeCore.sourceSlice(activeRevision, content.range)
      const localStart = request.range.start - content.range.start
      const localEnd = request.range.end - content.range.start
      const originalOld = deepestAnnotation.kind === 'substitution'
        ? deepestAnnotation.arms.find(arm => arm.name === 'old')
        : undefined
      const originalOldSource = originalOld === undefined
        ? undefined
        : activeCore.sourceSlice(activeRevision, originalOld.range)
      const replacementCandidate = (
        payload: string
      ): DocumentSourceEdit | undefined => {
        if (
          deepestAnnotation.kind === 'substitution' &&
          content.annotations.length === 0 &&
          originalOld?.annotations.length === 0 &&
          originalOldSource ===
            originalContent.slice(0, localStart) + payload +
            originalContent.slice(localEnd)
        ) {
          const candidate = preview([{
            ...deepestAnnotation.range,
            insert: originalOldSource
          }])
          const replacementEnd = deepestAnnotation.range.start +
            originalOldSource.length
          return candidate.annotations.every(item =>
            item.range.start >= replacementEnd ||
            item.range.end <= deepestAnnotation.range.start
          ) && !candidate.diagnostics.some(diagnostic =>
            diagnostic.range.start < replacementEnd &&
            diagnostic.range.end > deepestAnnotation.range.start
          )
            ? Object.freeze({
              start: deepestAnnotation.range.start,
              end: deepestAnnotation.range.end,
              insert: originalOldSource
            })
            : undefined
        }
        const candidate = preview([{ ...request.range, insert: payload }])
        const delta = payload.length - (request.range.end - request.range.start)
        const replaced = annotationTree(candidate.annotations).find(item =>
          item.kind === deepestAnnotation.kind &&
          item.range.start === deepestAnnotation.range.start &&
          item.range.end === deepestAnnotation.range.end + delta
        )
        const replacedContent = replaced?.arms.find(arm =>
          arm.name === (deepestAnnotation.kind === 'addition' ? 'content' : 'new')
        )
        const replacedOld = deepestAnnotation.kind === 'substitution'
          ? replaced?.arms.find(arm => arm.name === 'old')
          : undefined
        return replaced !== undefined && replacedContent !== undefined &&
          (replacedContent.annotations.length === 0 || preserveCanonicalMarkup) &&
          (deepestAnnotation.kind !== 'substitution' ||
            (replacedOld !== undefined && originalOldSource !== undefined &&
              candidate.source.slice(replacedOld.range.start, replacedOld.range.end) ===
                originalOldSource)) &&
          !candidate.diagnostics.some(diagnostic =>
            diagnostic.range.start < replaced.range.end &&
            diagnostic.range.end > replaced.range.start
          ) &&
          candidate.source.slice(replacedContent.range.start, replacedContent.range.end) ===
            originalContent.slice(0, localStart) + payload +
            originalContent.slice(localEnd)
          ? Object.freeze({ ...request.range, insert: payload })
          : undefined
      }
      const rawReplacement = replacementCandidate(request.text)
      if (rawReplacement !== undefined) return rawReplacement
      if (preserveCanonicalMarkup) return undefined
      return protectedNativeText === request.text
        ? undefined
        : replacementCandidate(protectedNativeText)
    }
  }
  if (deletion) {
    const annotations = annotationTree(activeRevision.annotations)
    const cancelled = annotations.find(annotation => annotation.kind === 'addition' &&
      annotation.range.start === request.range.start && annotation.range.end === request.range.end)
    if (cancelled !== undefined) {
      const retainedHistory = annotations.some(annotation => annotation !== cancelled && annotation.arms.some(arm =>
        (annotation.kind === 'deletion' || arm.name === 'old' || arm.name === 'comment') &&
        arm.range.start <= cancelled.range.start && cancelled.range.end <= arm.range.end))
      if (retainedHistory) return undefined
      // Cancelling proposed text uses the same owned deletion whether the
      // native selection encloses its complete wrapper or only its payload.
      const removal = Object.freeze({ ...cancelled.range, insert: '' })
      preview([removal])
      return removal
    }
    const pending = [...activeRevision.annotations]
    while (pending.length > 0) {
      const annotation = pending.pop()
      if (annotation === undefined) break
      const content = annotation.kind === 'addition'
        ? annotation.arms.find(arm => arm.name === 'content')
        : annotation.kind === 'substitution'
          ? annotation.arms.find(arm => arm.name === 'new')
          : undefined
      if (
        content !== undefined && content.annotations.length === 0 &&
        request.range.start >= content.range.start &&
        request.range.end <= content.range.end
      ) {
        const originalContent = activeCore.sourceSlice(activeRevision, content.range)
        const localStart = request.range.start - content.range.start
        const localEnd = request.range.end - content.range.start
        const remainingContent = originalContent.slice(0, localStart) +
          originalContent.slice(localEnd)
        const originalOld = annotation.kind === 'substitution'
          ? annotation.arms.find(arm => arm.name === 'old')
          : undefined
        const originalOldSource = originalOld === undefined
          ? undefined
          : activeCore.sourceSlice(activeRevision, originalOld.range)
        if (
          remainingContent.length === 0 && annotation.kind === 'substitution'
        ) {
          if (
            originalOld === undefined || originalOldSource === undefined ||
            originalOld.annotations.length > 0
          ) return undefined
          const insert = `{--${originalOldSource}--}`
          const candidate = preview([{ ...annotation.range, insert }])
          const replacement = annotationTree(candidate.annotations).find(item =>
            item.kind === 'deletion' &&
            item.range.start === annotation.range.start &&
            item.range.end === annotation.range.start + insert.length
          )
          const replacementContent = replacement?.arms.find(
            arm => arm.name === 'content'
          )
          return replacement !== undefined && replacementContent !== undefined &&
            replacementContent.annotations.length === 0 &&
            !candidate.diagnostics.some(diagnostic =>
              diagnostic.range.start < replacement.range.end &&
              diagnostic.range.end > replacement.range.start
            ) &&
            candidate.source.slice(replacementContent.range.start, replacementContent.range.end) ===
              originalOldSource
            ? Object.freeze({
              start: annotation.range.start,
              end: annotation.range.end,
              insert
            })
            : undefined
        }
        const candidate = preview([{
          ...(remainingContent.length === 0 ? annotation.range : request.range),
          insert: ''
        }])
        if (remainingContent.length === 0) {
          return candidate.annotations.every(item =>
            item.range.start < annotation.range.start ||
            item.range.end > annotation.range.end
          )
            ? Object.freeze({
              start: annotation.range.start,
              end: annotation.range.end,
              insert: ''
            })
            : undefined
        }
        const shrunk = annotationTree(candidate.annotations).find(item =>
          item.kind === annotation.kind &&
          item.range.start === annotation.range.start &&
          item.range.end === annotation.range.end -
            (request.range.end - request.range.start)
        )
        const shrunkContent = shrunk?.arms.find(arm =>
          arm.name === (annotation.kind === 'addition' ? 'content' : 'new')
        )
        const shrunkOld = annotation.kind === 'substitution'
          ? shrunk?.arms.find(arm => arm.name === 'old')
          : undefined
        return shrunk !== undefined && shrunkContent !== undefined &&
          (annotation.kind !== 'substitution' ||
            (shrunkOld !== undefined && originalOldSource !== undefined &&
              candidate.source.slice(shrunkOld.range.start, shrunkOld.range.end) ===
                originalOldSource)) &&
          !candidate.diagnostics.some(diagnostic =>
            diagnostic.range.start < shrunk.range.end &&
            diagnostic.range.end > shrunk.range.start
          ) &&
          shrunkContent.annotations.length === 0 &&
          candidate.source.slice(shrunkContent.range.start, shrunkContent.range.end) === remainingContent
          ? Object.freeze({ ...request.range, insert: '' })
          : undefined
      }
      for (const arm of annotation.arms) pending.push(...arm.annotations)
    }
  }
  if (!insertion) {
    const pending = [...activeRevision.annotations]
    while (pending.length > 0) {
      const annotation = pending.pop()
      if (annotation === undefined) break
      const overlaps = request.range.start < annotation.range.end &&
        request.range.end > annotation.range.start
      const contains = request.range.start <= annotation.range.start &&
        request.range.end >= annotation.range.end
      const highlightedContent = annotation.kind === 'highlight' && annotation.arms.some(arm =>
        arm.name === 'content' && arm.range.start <= request.range.start && request.range.end <= arm.range.end)
      if (overlaps && !contains && !highlightedContent) return undefined
      for (const arm of annotation.arms) pending.push(...arm.annotations)
    }
  }
  const selected = insertion
    ? ''
    : activeCore.sourceSlice(activeRevision, request.range)
  const expectedKind = insertion
    ? 'addition'
    : deletion
      ? 'deletion'
      : 'substitution'
  const candidateFor = (
    selectedPayload: string,
    insertedPayload: string,
    nativePayloadMustBeLiteral = false
  ): DocumentSourceEdit | undefined => {
    const payload = insertion ? insertedPayload : selectedPayload
    const insert = insertion
      ? `{++${payload}++}`
      : deletion
        ? `{--${payload}--}`
        : `{~~${selectedPayload}~>${insertedPayload}~~}`
    const candidate = preview([{ ...request.range, insert }])
    const annotation = annotationTree(candidate.annotations).find(item =>
      item.kind === expectedKind && item.range.start === request.range.start &&
      item.range.end === request.range.start + insert.length
    )
    if (annotation === undefined) return undefined
    const authoredEnd = request.range.start + insert.length
    if (
      nativePayloadMustBeLiteral && candidate.diagnostics.some(diagnostic =>
        diagnostic.range.start < authoredEnd &&
        diagnostic.range.end > request.range.start
      )
    ) return undefined
    if (substitution) {
      const oldArm = annotation.arms.find(arm => arm.name === 'old')
      const newArm = annotation.arms.find(arm => arm.name === 'new')
      return oldArm !== undefined && newArm !== undefined &&
        (!nativePayloadMustBeLiteral || newArm.annotations.length === 0) &&
        candidate.source.slice(oldArm.range.start, oldArm.range.end) === selectedPayload &&
        candidate.source.slice(newArm.range.start, newArm.range.end) === insertedPayload
        ? Object.freeze({ ...request.range, insert })
        : undefined
    }
    const content = annotation.arms.find(arm => arm.name === 'content')
    return content !== undefined &&
      (!nativePayloadMustBeLiteral || !insertion || content.annotations.length === 0) &&
      candidate.source.slice(content.range.start, content.range.end) === payload
      ? Object.freeze({ ...request.range, insert })
      : undefined
  }
  const rawCandidate = candidateFor(selected, request.text, !preserveCanonicalMarkup)
  if (rawCandidate !== undefined) return rawCandidate
  if (preserveCanonicalMarkup) return undefined
  const protectSelectedOutsideAnnotations = (
    value: string,
    pattern: RegExp
  ): string => {
    const ownedRanges: Array<Readonly<{ start: number, end: number }>> = []
    const pending = [...activeRevision.annotations]
    while (pending.length > 0) {
      const annotation = pending.pop()
      if (annotation === undefined) break
      if (
        annotation.range.start >= request.range.start &&
        annotation.range.end <= request.range.end
      ) {
        ownedRanges.push(annotation.range)
        continue
      }
      for (const arm of annotation.arms) pending.push(...arm.annotations)
    }
    ownedRanges.sort((left, right) =>
      left.start - right.start || right.end - left.end
    )
    const parts: string[] = []
    let offset = 0
    for (const range of ownedRanges) {
      const start = range.start - request.range.start
      const end = range.end - request.range.start
      if (start < offset) continue
      parts.push(protect(value.slice(offset, start), pattern))
      parts.push(value.slice(start, end))
      offset = end
    }
    parts.push(protect(value.slice(offset), pattern))
    return parts.join('')
  }
  const protectedSelected = insertion
    ? selected
    : deletion
      ? protectSelectedOutsideAnnotations(selected, /--\}/g)
      : protectSelectedOutsideAnnotations(selected, /~>|~~\}/g)
  const protectedInserted = insertion
    ? protectedNativeText
    : substitution
      ? protectedNativeText
      : request.text
  if (
    protectedSelected === selected && protectedInserted === request.text
  ) return undefined
  return candidateFor(protectedSelected, protectedInserted, true)
}
