import {
  isCriticMarkupCommentTarget,
  type CriticMarkupSidebarItem
} from '@shared/types/criticMarkup'

export type CriticMarkupCommentEditResult =
  | { outcome: 'saved' }
  | { outcome: 'rejected' }

export interface CriticMarkupCommentEditSubmission {
  target: CriticMarkupSidebarItem
  text: string
  acknowledge: (result: CriticMarkupCommentEditResult) => void
}

/** Runtime guard for the renderer-local request/reply boundary carried by mitt. */
export const isCriticMarkupCommentEditSubmission = (
  value: unknown
): value is CriticMarkupCommentEditSubmission => {
  if (!value || typeof value !== 'object') return false
  const submission = value as Record<string, unknown>
  return isCriticMarkupCommentTarget(submission.target) &&
    typeof submission.text === 'string' &&
    typeof submission.acknowledge === 'function'
}
