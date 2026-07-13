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
