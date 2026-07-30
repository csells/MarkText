import {
  closedRecord as decodeClosedRecord
} from './closedRecord'
import type {
  ICriticMarkupCommandTarget,
  ICriticMarkupReviewSnapshot,
  ICriticMarkupReviewItem
} from '@marktext/document-view'
import type { ReviewProjection } from '../../common/commands/review'

export type { CriticMarkupReviewAction } from '../../common/commands/review'
export type CriticMarkupProjection = ReviewProjection
export type CriticMarkupPromptKind = 'substitution' | 'comment'
export type CriticMarkupType = ICriticMarkupReviewItem['type']
export type CriticMarkupSidebarItem = ICriticMarkupReviewItem

export type CriticMarkupCommandTarget = ICriticMarkupCommandTarget

export interface CriticMarkupEditorContextRequest {
  requestId: string
  x: number
  y: number
}

export interface CriticMarkupCommentEditRequest {
  documentId: string
  target: CriticMarkupCommandTarget
}

const closedRecord = (
  value: unknown,
  fields: readonly string[],
  label: string
): Readonly<Record<string, unknown>> =>
  decodeClosedRecord(value, label, { required: fields })

const identity = (value: unknown, label: string): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    value.includes('\0')
  ) {
    throw new TypeError(`${label} must be one bounded non-empty identity`)
  }
  return value
}

export const decodeCriticMarkupCommandTarget = (
  value: unknown
): CriticMarkupCommandTarget => {
  const target = closedRecord(
    value,
    ['revisionId', 'nodeId'],
    'CriticMarkup command target'
  )
  return Object.freeze({
    revisionId: identity(target.revisionId, 'CriticMarkup revisionId'),
    nodeId: identity(target.nodeId, 'CriticMarkup nodeId')
  })
}

export const decodeCriticMarkupEditorContextRequest = (
  value: unknown
): CriticMarkupEditorContextRequest => {
  const request = closedRecord(
    value,
    ['requestId', 'x', 'y'],
    'CriticMarkup editor context request'
  )
  const coordinate = (candidate: unknown, label: string): number => {
    if (
      typeof candidate !== 'number' ||
      !Number.isSafeInteger(candidate) ||
      Math.abs(candidate) > 1_000_000
    ) {
      throw new TypeError(`${label} must be one bounded integer coordinate`)
    }
    return candidate
  }
  return Object.freeze({
    requestId: identity(request.requestId, 'CriticMarkup context requestId'),
    x: coordinate(request.x, 'CriticMarkup context x'),
    y: coordinate(request.y, 'CriticMarkup context y')
  })
}

export const isCriticMarkupCommentEditRequest = (
  value: unknown
): value is CriticMarkupCommentEditRequest => {
  try {
    decodeCriticMarkupCommentEditRequest(value)
    return true
  } catch {
    return false
  }
}

export type CriticMarkupEditorContextResponse = { requestId: string } & (
  | CriticMarkupCommentEditRequest
  | { documentId: null, target: null }
)

export const decodeCriticMarkupCommentEditRequest = (
  value: unknown
): CriticMarkupCommentEditRequest => {
  const request = closedRecord(
    value,
    ['documentId', 'target'],
    'CriticMarkup comment edit request'
  )
  return Object.freeze({
    documentId: identity(request.documentId, 'CriticMarkup documentId'),
    target: decodeCriticMarkupCommandTarget(request.target)
  })
}

export const decodeCriticMarkupEditorContextResponse = (
  value: unknown
): CriticMarkupEditorContextResponse => {
  const response = closedRecord(
    value,
    ['requestId', 'documentId', 'target'],
    'CriticMarkup editor context response'
  )
  const requestId = identity(
    response.requestId,
    'CriticMarkup context requestId'
  )
  if (response.documentId === null && response.target === null) {
    return Object.freeze({
      requestId,
      documentId: null,
      target: null
    })
  }
  const request = decodeCriticMarkupCommentEditRequest({
    documentId: response.documentId,
    target: response.target
  })
  return Object.freeze({ requestId, ...request })
}

export type CriticMarkupSidebarState = Pick<
  ICriticMarkupReviewSnapshot,
  'items' | 'currentItemId' | 'trackChanges' | 'projection'
> & {
  documentId: string | null
  revisionId: string | null
  available: boolean
}

export interface CriticMarkupSidebarItemAction {
  documentId: string
  action: 'focus' | 'accept' | 'reject' | 'remove-annotation'
  target: CriticMarkupCommandTarget
}

export const decodeCriticMarkupSidebarItemAction = (
  value: unknown
): CriticMarkupSidebarItemAction => {
  const command = closedRecord(
    value,
    ['documentId', 'action', 'target'],
    'CriticMarkup sidebar command'
  )
  if (
    command.action !== 'focus' &&
    command.action !== 'accept' &&
    command.action !== 'reject' &&
    command.action !== 'remove-annotation'
  ) {
    throw new TypeError('CriticMarkup sidebar command action is invalid')
  }
  return Object.freeze({
    documentId: identity(command.documentId, 'CriticMarkup documentId'),
    action: command.action,
    target: decodeCriticMarkupCommandTarget(command.target)
  })
}

export type CriticMarkupReviewMenuState = Pick<
  ICriticMarkupReviewSnapshot,
  | 'canCreateAddition'
  | 'canCreateDeletion'
  | 'canCreateSubstitution'
  | 'canCreateHighlight'
  | 'canCreateComment'
  | 'canNavigate'
  | 'canResolveCurrent'
  | 'canResolveAll'
  | 'canRemoveAllAnnotations'
  | 'trackChanges'
  | 'projection'
> & {
  available: boolean
}
