import type { MuyaPlainTextAuthorSelection } from '@/documentAuthority/muyaPlainTextCoreAdapter'
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
      selection?: MuyaPlainTextAuthorSelection
      item?: NonNullable<CoreReviewItemReply['item']>
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
