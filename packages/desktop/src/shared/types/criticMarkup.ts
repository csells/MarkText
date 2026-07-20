import type {
  ICriticMarkupReviewSnapshot,
  ICriticMarkupReviewItem
} from '@muyajs/core'
import type { ReviewProjection } from '../../common/commands/review'

export type { CriticMarkupReviewAction } from '../../common/commands/review'
export type CriticMarkupProjection = ReviewProjection
export type CriticMarkupPromptKind = 'substitution' | 'comment'
export type CriticMarkupType = ICriticMarkupReviewItem['type']
export type CriticMarkupSidebarItem = ICriticMarkupReviewItem

export interface CriticMarkupEditorContextRequest {
  requestId: string
  x: number
  y: number
}

export interface CriticMarkupCommentEditRequest {
  fileId: string
  target: CriticMarkupSidebarItem
}

const isFiniteOffset = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string'

/** Runtime guard for the opaque comment target crossing process boundaries. */
export const isCriticMarkupCommentTarget = (
  value: unknown
): value is CriticMarkupSidebarItem => {
  if (!value || typeof value !== 'object') return false
  const target = value as Record<string, unknown>
  if (
    typeof target.id !== 'string' || target.id.length === 0 ||
    target.type !== 'comment' ||
    typeof target.raw !== 'string' ||
    typeof target.content !== 'string' ||
    !Array.isArray(target.path) ||
    !target.path.every(part => typeof part === 'string' || isFiniteOffset(part)) ||
    !isFiniteOffset(target.start) ||
    !isFiniteOffset(target.end) ||
    !isFiniteOffset(target.sourceStart) ||
    !isFiniteOffset(target.sourceEnd) ||
    target.end < target.start ||
    target.sourceEnd < target.sourceStart ||
    !isOptionalString(target.anchorId) ||
    !isOptionalString(target.anchorText)
  ) {
    return false
  }

  return (target.anchorId === undefined) === (target.anchorText === undefined)
}

export const isCriticMarkupCommentEditRequest = (
  value: unknown
): value is CriticMarkupCommentEditRequest => {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  return typeof request.fileId === 'string' && request.fileId.length > 0 &&
    isCriticMarkupCommentTarget(request.target)
}

export type CriticMarkupEditorContextResponse = { requestId: string } & (
  | CriticMarkupCommentEditRequest
  | { fileId: null, target: null }
)

export type CriticMarkupSidebarState = Pick<
  ICriticMarkupReviewSnapshot,
  'items' | 'currentItemId' | 'trackChanges' | 'projection'
> & {
  fileId: string | null
  available: boolean
}

export interface CriticMarkupSidebarItemAction {
  fileId: string
  action: 'focus' | 'accept' | 'reject' | 'remove-annotation'
  target: CriticMarkupSidebarItem
}

export type CriticMarkupReviewMenuState = Pick<
  ICriticMarkupReviewSnapshot,
  | 'canCreateAddition'
  | 'canCreateDeletion'
  | 'canCreateSubstitution'
  | 'canCreateHighlight'
  | 'canCreateComment'
  | 'canResolveCurrent'
  | 'canResolveAll'
  | 'trackChanges'
  | 'projection'
> & {
  available: boolean
}
