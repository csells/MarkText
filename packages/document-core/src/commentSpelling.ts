import { createDocumentCore, type DocumentRevision, type DocumentSourceEdit, type MarkdownOptions, type SourceRange } from './documentCore.js'
import { markupAnnotations } from './markupEditOwnership.js'
import { CRITIC_MARKER_ALTERNATION, completeTrailingEscape } from './criticMarkers.js'

/** A Comment payload's source spelling. */
export interface DocumentCommentPayloadSpelling {
  readonly payload: string
  /**
   * Whether the spelling adds backslashes the author did not type. Profile 1
   * E1 escaping is a MarkText extension that other CriticMarkup tools show
   * literally (ADR 0015), so the UI discloses it.
   */
  readonly escaped: boolean
}

export interface DocumentCommentAction {
  /** The existing Comment annotation's complete source range. */
  readonly range: SourceRange
  /** The payload text the author supplied. */
  readonly text: string
}

export interface DocumentCommentPlan {
  readonly edit: DocumentSourceEdit
  readonly escaped: boolean
}

/** Every marker, with a bare `<<` standing in for the Comment closer. */
export const CRITIC_TOKENS = new RegExp(CRITIC_MARKER_ALTERNATION.replace(String.raw`<<\}`, '<<'), 'g')

/**
 * Payload spellings in the order a Comment prefers them: the author's exact
 * text, then E1 escapes on only the tokens the payload's own parse reports as
 * unpaired, then escapes on every CriticMarkup token. A Comment payload is an
 * isolated subdocument (R5), so properly nested CriticMarkup needs no escape.
 */
export function commentPayloadCandidates(
  text: string,
  diagnosticsOf: (payload: string) => readonly { readonly range: SourceRange }[]
): readonly DocumentCommentPayloadSpelling[] {
  const spellings: string[] = [text, completeTrailingEscape(text)]
  const diagnostics = diagnosticsOf(text)
  const selective = text.replace(CRITIC_TOKENS, (token: string, offset: number) =>
    diagnostics.some(({ range }) => range.start < offset + token.length && range.end > offset) ? `\\${token}` : token)
  spellings.push(completeTrailingEscape(selective))
  spellings.push(completeTrailingEscape(text.replace(CRITIC_TOKENS, token => `\\${token}`)))
  const unique = [...new Set(spellings)]
  return Object.freeze(unique.map(payload => Object.freeze({ payload, escaped: payload !== text })))
}

/** Whether a diagnostic-free Comment spans exactly `range` with `payload` as its payload source. */
const holdsComment = (revision: DocumentRevision, range: SourceRange, payload: string, slice: (range: SourceRange) => string, literal = false): boolean => {
  if (revision.diagnostics.some(diagnostic => diagnostic.range.start < range.end && diagnostic.range.end > range.start)) return false
  const comment = markupAnnotations(revision.annotations).find(annotation =>
    annotation.kind === 'comment' && annotation.range.start === range.start && annotation.range.end === range.end)
  const arm = comment?.arms.find(item => item.name === 'comment')
  return arm !== undefined && (!literal || arm.annotations.length === 0) && slice(arm.range) === payload
}

/**
 * The spelling a Comment would give `text` on its own, with the containing
 * document's syntax options. A composer uses it to disclose MarkText-only
 * escaping before the author saves. A `literal` payload is a new Comment's
 * text, which authoring keeps free of nested CriticMarkup; an edited payload
 * is the Comment's source and may nest it (R5).
 */
export function spellCommentPayload(
  text: string,
  options?: Readonly<Partial<MarkdownOptions>>,
  literal = false
): DocumentCommentPayloadSpelling | undefined {
  if (typeof text !== 'string') return undefined
  const core = createDocumentCore()
  for (const candidate of commentPayloadCandidates(text, payload => core.open(payload, options).diagnostics)) {
    const source = `{>>${candidate.payload}<<}`
    const revision = core.open(source, options)
    if (holdsComment(revision, { start: 0, end: source.length }, candidate.payload, range => source.slice(range.start, range.end), literal)) return candidate
  }
  return undefined
}

/**
 * Replaces an existing Comment's payload. Each candidate spelling is proved
 * in the document's own resulting syntax; the first that keeps the Comment and
 * exactly its payload is the edit.
 */
export function planCommentEdit(
  revision: DocumentRevision,
  action: DocumentCommentAction,
  diagnosticsOf: (payload: string) => readonly { readonly range: SourceRange }[],
  preview: (edits: readonly DocumentSourceEdit[]) => DocumentRevision
): DocumentCommentPlan | undefined {
  if (action === null || typeof action !== 'object' || typeof action.text !== 'string' || action.range === null || typeof action.range !== 'object') return undefined
  const { start, end } = action.range
  const comment = markupAnnotations(revision.annotations).find(annotation =>
    annotation.kind === 'comment' && annotation.range.start === start && annotation.range.end === end)
  if (comment === undefined) return undefined
  for (const candidate of commentPayloadCandidates(action.text, diagnosticsOf)) {
    const insert = `{>>${candidate.payload}<<}`
    const edit = Object.freeze({ start, end, insert })
    const result = preview([edit])
    if (holdsComment(result, { start, end: start + insert.length }, candidate.payload, range => result.source.slice(range.start, range.end))) {
      return Object.freeze({ edit, escaped: candidate.escaped })
    }
  }
  return undefined
}
