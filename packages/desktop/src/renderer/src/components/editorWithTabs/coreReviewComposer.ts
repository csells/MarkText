import { spellCommentPayload, type MarkdownOptions } from '@marktext/document-core'
import type { MuyaPlainTextAuthorTarget } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import type { CoreReviewItemReply } from '@/documentAuthority/coreProtocol'

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
      entryStart?: number
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
