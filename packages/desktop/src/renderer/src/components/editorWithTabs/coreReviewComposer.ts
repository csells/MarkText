import { spellCommentPayload, type MarkdownOptions } from '@marktext/document-core'
import type { MuyaPlainTextAuthorTarget } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import type {
  CoreReviewItemLocator,
  CoreReviewItemReply,
  CoreReviewOverviewEntry
} from '@/documentAuthority/coreProtocol'

export interface CoreReviewComposerState {
  open: boolean
  draft: string | undefined
  error: string
  target:
    | Readonly<{
      id: string
      revision: number
      text: string
      form?: 'comment' | 'substitution'
      /** A new item's text: the editor selection, or a highlight's source text. */
      selection?: MuyaPlainTextAuthorTarget
      item?: NonNullable<CoreReviewItemReply['item']>
      /** The review entry whose card holds the composer (Google Docs keeps it on its card). */
      entry?: CoreReviewItemLocator
      /** Where a new item's draft card sits among the entries. */
      draftStart?: number
    }>
    | undefined
}

/** Unsubmitted form input belongs to the document window, not a mounted editor. */
export const createCoreReviewComposer = (): CoreReviewComposerState => ({
  open: false,
  draft: undefined,
  error: '',
  target: undefined
})

/**
 * Whether saving the draft would add MarkText-only backslash escapes, which
 * the composer discloses (ADR 0015). A new Comment's text stays literal; an
 * edited Comment's text is its payload source.
 */
export const coreReviewComposerEscapes = (
  state: CoreReviewComposerState,
  options?: Readonly<Partial<MarkdownOptions>>
): boolean => {
  const target = state.target
  if (target === undefined || target.form === 'substitution') return false
  const draft = state.draft ?? target.text
  return spellCommentPayload(draft, options, target.item === undefined)?.escaped === true
}

/**
 * Where an open composer stands among the entries: on its entry's card, or as
 * a draft card at `draftStart`. Edits made while it is open, such as in
 * Source, move the entry, so the card is the entry of the same kind, length
 * and Comment nearest to where the entry was. When no such entry remains, the
 * composer stands as a draft card there, so unsubmitted input never vanishes
 * (G1); submitting it then reports that the document changed.
 */
export const coreReviewComposerPlacement = (
  target: CoreReviewComposerState['target'],
  entries: readonly CoreReviewOverviewEntry[]
): { composerStart?: number, draftStart?: number } => {
  const entry = target?.entry
  if (entry === undefined) return { draftStart: target?.draftStart }
  const length = entry.range.end - entry.range.start
  let nearest: number | undefined
  for (const candidate of entries) {
    const { kind, range } = candidate.item
    if (
      kind !== entry.kind ||
      range.end - range.start !== length ||
      (target?.item !== undefined && candidate.commentText !== target.text)
    ) continue
    if (
      nearest === undefined ||
      Math.abs(range.start - entry.range.start) < Math.abs(nearest - entry.range.start)
    ) nearest = range.start
  }
  return nearest === undefined ? { draftStart: entry.range.start } : { composerStart: nearest }
}
