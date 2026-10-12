import type {
  CriticMarkupAnnotation, DocumentCore, DocumentRevision,
  DocumentSourceEdit, MarkdownAstNode, MarkupSyntax, SourceRange
} from './documentCore.js'
import { createMarkupCompoundSourceEdits } from './markupEditing.js'
import { markupAnnotations as annotationTree, markupReplacementRange } from './markupEditOwnership.js'
import { historyInsertionPoint, substitutionBeforeDeletion, substitutionDraftInsertionPoint, trackedEditableSpans, trackedPartsSeparate, withinHistory } from './trackedHistoryEditing.js'
import { annotationsAround, annotationsOverlapping } from './internal/annotationsAround.js'
import { FENCED_LITERAL_BLOCKS } from './literalBlock.js'
import { lineStartBefore } from './sourceLines.js'
import { CRITIC_MARKER_ALTERNATION, spellSuggestion } from './internal/profile1/sourceTape.js'
import { createTrackedOracle, draftTrackedSourceEdit, equivalenceDeferred, escapesLiteralContent, isWindowCompileCore, markUnresolvedDraft, reachesWindowEdge, literalHistoryInsertionPoint, memoizedPreview, rejoinedTrackedHistoryEdit, splitTrackedHistoryEdit, trackedPreviewFacts, widenedTrackedSourceEdit } from './trackedExtent.js'

const CRITIC_MARKER = new RegExp(CRITIC_MARKER_ALTERNATION, 'g')

/** Protective spelling retains exactly where the language compiler inserts escapes. */
export const nativeCriticSpelling = (value: string): Readonly<{ text: string, escapes: readonly number[] }> => {
  const escapes: number[] = []
  const text = value.replace(
    CRITIC_MARKER,
    (token, offset: number) => {
      escapes.push(offset)
      return `\\${token}`
    }
  )
  return Object.freeze({ text, escapes: Object.freeze(escapes) })
}

/** Protective spelling for native text, shared by tracked and ordinary authoring. */
export const protectNativeCriticText = (value: string): string => nativeCriticSpelling(value).text

/** Moving previously deleted text retains its exact source history at the origin. */
export function retainedTrackedHistoryEdit(
  core: DocumentCore, revision: DocumentRevision, edit: DocumentSourceEdit
): DocumentSourceEdit | undefined {
  if (edit.insert.length > 0 || edit.start >= edit.end) return undefined
  const retained = annotationTree(annotationsOverlapping(core, revision, edit)).some(annotation => annotation.arms.some(arm =>
    (annotation.kind === 'deletion' && arm.name === 'content' || annotation.kind === 'substitution' && arm.name === 'old') &&
    arm.range.start <= edit.start && edit.end <= arm.range.end))
  return retained ? Object.freeze({ ...edit, insert: core.sourceSlice(revision, edit) }) : undefined
}

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
  edits: readonly DocumentSourceEdit[],
  compile: (edits: readonly DocumentSourceEdit[]) => readonly DocumentSourceEdit[] | undefined = edits => core.markupEdits(revision, edits)
): readonly DocumentSourceEdit[] | undefined {
  if (!edits.some(edit => edit.start < edit.end)) return undefined
  // Deleted text a draft holds stays deleted; only the rest is edited.
  if (edits.some(edit => trackedEditableSpans(core, revision, edit)?.history === true)) return undefined
  // Both the owning draft and any history arm hold an edit.
  const annotations = annotationTree(annotationsOverlapping(core, revision, {
    start: Math.min(...edits.map(edit => edit.start)),
    end: Math.max(...edits.map(edit => edit.end))
  }))
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
  const planned = compile(edits)
  if (planned === undefined || planned.some(edit => edit.start < content.range.start || edit.end > content.range.end)) return undefined
  return planned
}

/**
 * Whether an edit lies where a block literal no suggestion overlaps reads
 * every marker as its text: on an inner line of a fenced code or math block,
 * between its delimiter lines, or within one line of indented code past its
 * four columns of indentation, which a marker there leaves intact.
 */
function withinBlockLiteral(core: DocumentCore, revision: DocumentRevision, edit: DocumentSourceEdit): boolean {
  const { ast, coordinates } = core.project(revision, 'markup').syntax
  const block = ast.root.children.find(node => FENCED_LITERAL_BLOCKS.has(node.kind) &&
    coordinates.toSource(node.range.start, 'next') < edit.start && edit.end < coordinates.toSource(node.range.end, 'previous'))
  if (block === undefined) return false
  const start = coordinates.toSource(block.range.start, 'next')
  const end = coordinates.toSource(block.range.end, 'previous')
  if (annotationsOverlapping(core, revision, { start, end }).some(annotation => annotation.range.start < end && start < annotation.range.end)) {
    return false
  }
  const text = core.sourceSlice(revision, { start, end })
  const delimiter = /^ {0,3}(?:`{3,}|~{3,}|\$\$)/u
  if (delimiter.test(text)) {
    const firstLineEnd = text.search(/\r\n|\r|\n/u)
    const lastLineStart = Math.max(text.trimEnd().lastIndexOf('\n'), text.trimEnd().lastIndexOf('\r')) + 1
    return firstLineEnd >= 0 && start + firstLineEnd < edit.start && edit.end < start + lastLineStart &&
      delimiter.test(text.slice(lastLineStart))
  }
  const local = { start: edit.start - start, end: edit.end - start }
  const lineStart = lineStartBefore(text, local.start)
  return block.kind === 'code-block' && !/[\r\n]/u.test(edit.insert + text.slice(local.start, local.end)) &&
    text.startsWith('    ', lineStart) && local.start - lineStart >= 4
}

const ESCAPED_MARKER = new RegExp(String.raw`\\(?:${CRITIC_MARKER_ALTERNATION})`, 'u')

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
  // The compile of the whole literal reads its own text as the typed result,
  // marker spellings escaped included; a literal's text is its content byte
  // for byte, so the spelling is checked against the key as typed, and one
  // that escapes a marker spelling in it is left to the search for another.
  const planned = createTrackedSourceEdit(core, revision, { ...owner, insert }, preview)
  if (planned === undefined || !ESCAPED_MARKER.test(planned.insert)) return planned
  const source = core.sourceSlice(revision, { start: 0, end: revision.sourceLength })
  const typed = source.slice(0, owner.start) + insert + source.slice(owner.end)
  const literal = { start: owner.start, end: owner.start + insert.length }
  return escapesLiteralContent([planned], preview([planned]), typed, () => [literal]) ? undefined : planned
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

type TrackedRequest = { range: SourceRange, text: string }

/** The operation in source coordinates after tracked edge ownership moves it. */
function trackedRequest(
  activeCore: DocumentCore,
  activeRevision: DocumentRevision,
  edit: DocumentSourceEdit,
  scope: 'visible' | 'structure'
): TrackedRequest | undefined {
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
    // Suggestions inside deleted text are history too: typing beside them
    // splits the deletion instead of extending them. Only those touching the
    // caret are asked whether they lie in history: asking it of every
    // suggestion scanned them all once each.
    const tree = annotationTree(activeRevision.annotations)
    const outsideHistory = (annotation: CriticMarkupAnnotation): boolean =>
      !withinHistory(activeRevision.annotations, annotation.range)
    const deletionEdge = tree.find(annotation => annotation.kind === 'deletion' &&
      annotation.arms.some(arm => arm.name === 'content' &&
        (arm.range.start === request.range.start || arm.range.end === request.range.start)) &&
      outsideHistory(annotation))
    if (deletionEdge !== undefined) {
      const content = deletionEdge.arms.find(arm => arm.name === 'content')!
      const offset = request.range.start === content.range.end ? deletionEdge.range.end : deletionEdge.range.start
      // The editing view elides delimiters. Typing at a deletion edge creates
      // a new suggestion outside it, preserving the original deleted payload.
      request.range = { start: offset, end: offset }
    }
    const adjacent = tree.find(annotation =>
      (annotation.kind === 'addition' || annotation.kind === 'substitution') &&
      annotation.range.end === request.range.start && outsideHistory(annotation)
    ) ?? tree.find(annotation =>
      (annotation.kind === 'addition' || annotation.kind === 'substitution') &&
      annotation.range.start === request.range.start && outsideHistory(annotation)
    )
    const arm = adjacent?.arms.find(arm =>
      arm.name === (adjacent.kind === 'addition' ? 'content' : 'new')
    )
    if (adjacent !== undefined && arm !== undefined) {
      const after = adjacent.range.end === request.range.start
      // A draft that ends with a paragraph break continues with the text
      // typed at the start of that new paragraph (Enter then typing is one
      // Addition in Google Docs).
      const continuesParagraph = after && arm.range.end > arm.range.start && !/[\r\n]/u.test(request.text) &&
        /[\r\n]$/u.test(activeCore.sourceSlice(activeRevision, { start: arm.range.end - 1, end: arm.range.end }))
      if (continuesParagraph || pendingArmOwnsInlineEdge(activeCore, activeRevision, arm.range, after)) {
        const offset = after ? arm.range.end : arm.range.start
        request.range = { start: offset, end: offset }
      }
    }
  }
  return request
}

/**
 * Author tracked changes from the revision-owned syntax. A suggestion is
 * admitted when accepting it reproduces the untracked result and rejecting it
 * reproduces the previous Original; an inline suggestion that changes meaning
 * widens over the retained syntax whose parse it changes.
 */
export const createTrackedSourceEdit = (
  activeCore: DocumentCore,
  activeRevision: DocumentRevision,
  edit: DocumentSourceEdit,
  preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision,
  preserveCanonicalMarkup = false,
  scope: 'visible' | 'structure' = 'visible'
): DocumentSourceEdit | undefined => {
  if (edit.start === edit.end && edit.insert.length > 0) {
    // The walk stays within the root annotation holding the caret.
    const point = historyInsertionPoint(annotationsAround(activeCore, activeRevision, edit.start), edit.start)
    if (point !== edit.start) edit = Object.freeze({ start: point, end: point, insert: edit.insert })
  }
  if (scope === 'visible' && edit.start === edit.end && edit.insert.length > 0 && !/[\r\n]/u.test(edit.insert)) {
    const payload = preserveCanonicalMarkup ? edit.insert : protectNativeCriticText(edit.insert)
    const merged = substitutionBeforeDeletion(activeCore, activeRevision, edit.start, payload, edit.insert, preview)
    if (merged !== undefined) return merged
    const draft = substitutionDraftInsertionPoint(activeRevision, edit.start)
    if (draft !== undefined) edit = Object.freeze({ start: draft, end: draft, insert: edit.insert })
  }
  const request = trackedRequest(activeCore, activeRevision, edit, scope)
  if (request === undefined) return undefined
  preview = memoizedPreview(preview)
  retrimDraftEscape(activeCore, activeRevision, request)
  const { start, end } = request.range
  if (start === end && request.text.length > 0) {
    let deepest: CriticMarkupAnnotation | undefined
    for (const annotation of annotationTree(annotationsAround(activeCore, activeRevision, start))) {
      if (annotation.range.start < start && start < annotation.range.end &&
          (deepest === undefined || annotation.range.end - annotation.range.start < deepest.range.end - deepest.range.start)) deepest = annotation
    }
    const history = deepest?.arms.find(arm => arm.name === (deepest.kind === 'deletion' ? 'content' : deepest.kind === 'substitution' ? 'old' : ''))
    if (history !== undefined && history.range.start < start && start < history.range.end) {
      const target = deepest === undefined ? undefined : literalHistoryInsertionPoint(activeCore, activeRevision, deepest, start)
      if (target !== undefined) {
        const planned = createTrackedSourceEdit(activeCore, activeRevision, { start: target, end: target, insert: request.text },
          preview, preserveCanonicalMarkup, scope)
        if (planned === undefined) return undefined
        // A window cannot tell whether a placement reaching its edge stays
        // within the Substitution in the document: the document decides.
        const reached = reachesWindowEdge(activeCore, planned, activeRevision.sourceLength)
        if (reached !== undefined &&
            !(deepest !== undefined && deepest.range.start <= planned.start && planned.end <= deepest.range.end)) {
          markUnresolvedDraft(activeCore, reached)
        }
        // The proposed block takes the typing only where it stays within the
        // Substitution; typing that breaks the paragraph the Substitution
        // lives in splits its old arm instead (G34).
        if (deepest !== undefined && deepest.range.start <= planned.start && planned.end <= deepest.range.end) {
          // The caret domain holds the typing's own place as well.
          const from = Math.min(planned.start, start)
          const to = Math.max(planned.end, start)
          return Object.freeze({
            start: from,
            end: to,
            insert: activeCore.sourceSlice(activeRevision, { start: from, end: planned.start }) + planned.insert +
              activeCore.sourceSlice(activeRevision, { start: planned.end, end: to })
          })
        }
        return splitTrackedHistoryEdit(activeCore, activeRevision, start,
          preserveCanonicalMarkup ? request.text : protectNativeCriticText(request.text), preview, true)
      }
      return splitTrackedHistoryEdit(activeCore, activeRevision, start,
        preserveCanonicalMarkup ? request.text : protectNativeCriticText(request.text), preview)
    }
  }
  const raw = { start, end, insert: request.text }
  // The untracked compilation of the same operation defines its Revised result;
  // an operation the untracked compiler refuses has no tracked meaning either.
  let untrackedCompiled: { readonly edits: readonly DocumentSourceEdit[] | undefined } | undefined
  const compileUntracked = (): readonly DocumentSourceEdit[] | undefined => {
    untrackedCompiled ??= {
      edits: createMarkupCompoundSourceEdits(
        activeCore, activeRevision, [raw], preview, preserveCanonicalMarkup, preserveCanonicalMarkup ? scope : 'visible',
        raw.insert.length > 0 ? 'admit-typed' : 'refuse')
    }
    return untrackedCompiled.edits
  }
  // Markers inside a block literal read as its text, so no inline spelling
  // of an edit within one reads as the edit: none is weighed there.
  const direct = !equivalenceDeferred(activeCore) && withinBlockLiteral(activeCore, activeRevision, { start, end, insert: request.text })
    ? undefined
    : inlineTrackedSourceEdit(activeCore, activeRevision, request, preview, preserveCanonicalMarkup)
  if (direct === undefined) {
    if (compileUntracked() === undefined) return undefined
    const draft = draftTrackedSourceEdit(activeCore, activeRevision,
      preserveCanonicalMarkup ? raw : { ...raw, insert: protectNativeCriticText(raw.insert) }, preview)
    if (draft !== undefined) return draft
  }
  if (equivalenceDeferred(activeCore)) return direct
  // Plain words cannot open block syntax or pair with surrounding delimiters.
  if (direct !== undefined && /^[\p{L}\p{N}][\p{L}\p{N} ]*$/u.test(raw.insert) &&
      splicesRevised(activeCore, activeRevision, direct, raw, preview)) return direct
  // Extending one's own draft is the draft's untracked edit, so its oracle is
  // the draft accepted with the same edit: delimiters typed there can pair
  // differently once the arm boundary is gone.
  if (direct !== undefined && direct.start === raw.start && direct.end === raw.end && direct.insert === raw.insert) {
    const drafted = draftTrackedSourceEdit(activeCore, activeRevision, direct, preview)
    // A window that finds no valid spelling leaves the key to the document,
    // whose compile can reach past it.
    if (drafted === undefined && isWindowCompileCore(activeCore)) markUnresolvedDraft(activeCore)
    return drafted ?? direct
  }
  const untracked = compileUntracked()
  if (untracked === undefined) return direct
  const oracle = createTrackedOracle(activeCore, activeRevision, untracked, preview)
  if (oracle === undefined) return direct
  // A tracked edit spells only whole suggestions, so one that leaves a marker
  // unpaired beyond those the untracked edit leaves spells the change
  // otherwise.
  const allowed = Math.max(activeRevision.diagnostics.length, preview(untracked).diagnostics.length)
  const clean = (edit: DocumentSourceEdit): boolean => preview([edit]).diagnostics.length <= allowed
  if (direct !== undefined && oracle.accepts([direct], 'exact') && clean(direct)) return direct
  const literal = createTrackedLiteralSourceEdit(activeCore, activeRevision, raw, preview)
  if (literal !== undefined) return literal
  return widenedTrackedSourceEdit(activeCore, activeRevision, oracle) ??
    (direct !== undefined && oracle.accepts([direct], 'rendering') && clean(direct) ? direct : undefined)
}

/**
 * A draft ending in a completed escape (`\\` before its closer) renders one
 * backslash. Text typed after it that a backslash cannot escape replaces that
 * completion, so the draft keeps the author's single backslash.
 */
function retrimDraftEscape(core: DocumentCore, revision: DocumentRevision, request: TrackedRequest): void {
  const { start, end } = request.range
  if (start !== end || request.text.length === 0 || /^[!-/:-@[-`{-~]/u.test(request.text)) return
  const owner = annotationTree(revision.annotations).find(annotation => annotation.kind === 'addition' &&
    annotation.arms.some(arm => arm.range.end === start))
  const arm = owner?.arms.find(arm => arm.name === 'content')
  if (arm === undefined || arm.range.end - arm.range.start < 2) return
  const content = core.sourceSlice(revision, arm.range)
  let escapes = 0
  while (escapes < content.length && content[content.length - 1 - escapes] === '\\') escapes += 1
  if (escapes >= 2 && escapes % 2 === 0) request.range = { start: start - 1, end }
}

/**
 * The untracked result's Revised text is the previous Revised text with the
 * operation spliced in unless the operation changes surrounding meaning. A
 * candidate reproducing that splice exactly needs no separate untracked parse.
 */
function splicesRevised(
  core: DocumentCore,
  revision: DocumentRevision,
  candidate: DocumentSourceEdit,
  raw: DocumentSourceEdit,
  preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision
): boolean {
  const facts = trackedPreviewFacts.get(preview([candidate]))
  if (facts === undefined || facts.original !== core.project(revision, 'original').markdown) return false
  const revised = core.project(revision, 'revised')
  return (['previous', 'next'] as const).some(affinity => {
    const start = revised.coordinates.toProjected(raw.start, affinity)
    const end = raw.start === raw.end ? start : revised.coordinates.toProjected(raw.end, affinity)
    return end >= start && facts.revised === revised.markdown.slice(0, start) + raw.insert + revised.markdown.slice(end)
  })
}

function inlineTrackedSourceEdit(
  activeCore: DocumentCore,
  activeRevision: DocumentRevision,
  request: TrackedRequest,
  preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision,
  preserveCanonicalMarkup: boolean
): DocumentSourceEdit | undefined {
  const insertion = request.range.start === request.range.end && request.text.length > 0
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
      return (trackedPartsSeparate(activeCore) ? undefined : rejoinedTrackedHistoryEdit(activeCore, activeRevision, cancelled, preview)) ?? removal
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
          const insert = spellSuggestion('deletion', originalOldSource)
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
          const rejoined = annotation.kind === 'addition' && !trackedPartsSeparate(activeCore)
            ? rejoinedTrackedHistoryEdit(activeCore, activeRevision, annotation, preview)
            : undefined
          if (rejoined !== undefined) return rejoined
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
      ? spellSuggestion('addition', payload)
      : deletion
        ? spellSuggestion('deletion', payload)
        : spellSuggestion('substitution', selectedPayload, insertedPayload)
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
