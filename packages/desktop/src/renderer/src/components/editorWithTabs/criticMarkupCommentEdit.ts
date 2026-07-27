import {
  decodeCriticMarkupCommandTarget,
  type CriticMarkupCommandTarget
} from '@shared/types/criticMarkup'

export type CriticMarkupCommentEditResult =
  | { outcome: 'saved' }
  | { outcome: 'rejected' }

export interface CriticMarkupCommentEditSubmission {
  documentId: string
  target: CriticMarkupCommandTarget
  text: string
  acknowledge: (result: CriticMarkupCommentEditResult) => void
}

/** Runtime guard for the renderer-local request/reply boundary carried by mitt. */
export const isCriticMarkupCommentEditSubmission = (
  value: unknown
): value is CriticMarkupCommentEditSubmission => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) return false
  const submission = value as Record<string, unknown>
  const keys = Reflect.ownKeys(submission)
  if (
    keys.length !== 4 ||
    keys.some(key =>
      key !== 'documentId' &&
      key !== 'target' &&
      key !== 'text' &&
      key !== 'acknowledge')
  ) return false
  try {
    decodeCriticMarkupCommandTarget(submission.target)
  } catch {
    return false
  }
  return typeof submission.documentId === 'string' &&
    submission.documentId.length > 0 &&
    submission.documentId.length <= 4096 &&
    !submission.documentId.includes('\0') &&
    typeof submission.text === 'string' &&
    typeof submission.acknowledge === 'function'
}
