import type {
  ICriticMarkupReviewSnapshot,
  TCriticMarkupProjection
} from '@marktext/document-view'

export type ReviewCommandMenuType = 'normal' | 'checkbox' | 'radio'
export type ReviewCommandGroup = 'tracking' | 'authoring' | 'navigation' | 'resolution' | 'projection'
export type ReviewMenuCapability = Extract<
  keyof ICriticMarkupReviewSnapshot,
  `can${string}`
>
export type ReviewProjection = TCriticMarkupProjection

export interface ReviewCommandDescriptor {
  readonly id: string
  readonly action: string
  readonly menuId: string
  readonly menuLabelKey: string
  readonly descriptionKey: string
  readonly menuType: ReviewCommandMenuType
  readonly group: ReviewCommandGroup
  readonly defaultKeybinding: string
  readonly menuCapability?: ReviewMenuCapability
  readonly requiresMarkedProjection?: boolean
  readonly projection?: ReviewProjection
  readonly checkedState?: 'trackChanges'
}

export type ReviewCommandAvailabilityState = Pick<
  ICriticMarkupReviewSnapshot,
  ReviewMenuCapability | 'projection'
> & {
  readonly available: boolean
}

export const isReviewCommandAvailable = (
  descriptor: ReviewCommandDescriptor,
  state: ReviewCommandAvailabilityState
): boolean => {
  const capability = descriptor.menuCapability
  return state.available &&
    (capability === undefined || state[capability]) &&
    (!descriptor.requiresMarkedProjection || state.projection === 'marked')
}

export const REVIEW_COMMAND_DESCRIPTORS = [
  {
    id: 'review.toggle-track-changes',
    action: 'toggle-track-changes',
    menuId: 'reviewTrackChangesMenuItem',
    menuLabelKey: 'menu.review.trackChanges',
    descriptionKey: 'commands.review.trackChanges',
    menuType: 'checkbox',
    group: 'tracking',
    defaultKeybinding: '',
    checkedState: 'trackChanges'
  },
  {
    id: 'review.mark-addition',
    action: 'mark-addition',
    menuId: 'reviewMarkAdditionMenuItem',
    menuLabelKey: 'menu.review.markAddition',
    descriptionKey: 'commands.review.markAddition',
    menuType: 'normal',
    group: 'authoring',
    defaultKeybinding: '',
    menuCapability: 'canCreateAddition'
  },
  {
    id: 'review.mark-deletion',
    action: 'mark-deletion',
    menuId: 'reviewMarkDeletionMenuItem',
    menuLabelKey: 'menu.review.markDeletion',
    descriptionKey: 'commands.review.markDeletion',
    menuType: 'normal',
    group: 'authoring',
    defaultKeybinding: '',
    menuCapability: 'canCreateDeletion'
  },
  {
    id: 'review.suggest-replacement',
    action: 'suggest-replacement',
    menuId: 'reviewSuggestReplacementMenuItem',
    menuLabelKey: 'menu.review.suggestReplacement',
    descriptionKey: 'commands.review.suggestReplacement',
    menuType: 'normal',
    group: 'authoring',
    defaultKeybinding: '',
    menuCapability: 'canCreateSubstitution'
  },
  {
    id: 'review.highlight',
    action: 'mark-highlight',
    menuId: 'reviewHighlightMenuItem',
    menuLabelKey: 'menu.review.highlight',
    descriptionKey: 'commands.review.highlight',
    menuType: 'normal',
    group: 'authoring',
    defaultKeybinding: '',
    menuCapability: 'canCreateHighlight'
  },
  {
    id: 'review.add-comment',
    action: 'add-comment',
    menuId: 'reviewAddCommentMenuItem',
    menuLabelKey: 'menu.review.addComment',
    descriptionKey: 'commands.review.addComment',
    menuType: 'normal',
    group: 'authoring',
    defaultKeybinding: '',
    menuCapability: 'canCreateComment'
  },
  {
    id: 'review.previous',
    action: 'previous',
    menuId: 'reviewPreviousMenuItem',
    menuLabelKey: 'menu.review.previous',
    descriptionKey: 'commands.review.previous',
    menuType: 'normal',
    group: 'navigation',
    defaultKeybinding: '',
    menuCapability: 'canNavigate'
  },
  {
    id: 'review.next',
    action: 'next',
    menuId: 'reviewNextMenuItem',
    menuLabelKey: 'menu.review.next',
    descriptionKey: 'commands.review.next',
    menuType: 'normal',
    group: 'navigation',
    defaultKeybinding: '',
    menuCapability: 'canNavigate'
  },
  {
    id: 'review.accept-current',
    action: 'accept-current',
    menuId: 'reviewAcceptCurrentMenuItem',
    menuLabelKey: 'menu.review.acceptCurrent',
    descriptionKey: 'commands.review.acceptCurrent',
    menuType: 'normal',
    group: 'resolution',
    defaultKeybinding: '',
    menuCapability: 'canResolveCurrent'
  },
  {
    id: 'review.reject-current',
    action: 'reject-current',
    menuId: 'reviewRejectCurrentMenuItem',
    menuLabelKey: 'menu.review.rejectCurrent',
    descriptionKey: 'commands.review.rejectCurrent',
    menuType: 'normal',
    group: 'resolution',
    defaultKeybinding: '',
    menuCapability: 'canResolveCurrent'
  },
  {
    id: 'review.accept-all',
    action: 'accept-all',
    menuId: 'reviewAcceptAllMenuItem',
    menuLabelKey: 'menu.review.acceptAll',
    descriptionKey: 'commands.review.acceptAll',
    menuType: 'normal',
    group: 'resolution',
    defaultKeybinding: '',
    menuCapability: 'canResolveAll'
  },
  {
    id: 'review.reject-all',
    action: 'reject-all',
    menuId: 'reviewRejectAllMenuItem',
    menuLabelKey: 'menu.review.rejectAll',
    descriptionKey: 'commands.review.rejectAll',
    menuType: 'normal',
    group: 'resolution',
    defaultKeybinding: '',
    menuCapability: 'canResolveAll'
  },
  {
    id: 'review.show-marked',
    action: 'show-marked',
    menuId: 'reviewShowMarkedMenuItem',
    menuLabelKey: 'menu.review.showMarked',
    descriptionKey: 'commands.review.showMarked',
    menuType: 'radio',
    group: 'projection',
    defaultKeybinding: '',
    projection: 'marked'
  },
  {
    id: 'review.show-original',
    action: 'show-original',
    menuId: 'reviewShowOriginalMenuItem',
    menuLabelKey: 'menu.review.showOriginal',
    descriptionKey: 'commands.review.showOriginal',
    menuType: 'radio',
    group: 'projection',
    defaultKeybinding: '',
    projection: 'original'
  },
  {
    id: 'review.show-revised',
    action: 'show-revised',
    menuId: 'reviewShowRevisedMenuItem',
    menuLabelKey: 'menu.review.showRevised',
    descriptionKey: 'commands.review.showRevised',
    menuType: 'radio',
    group: 'projection',
    defaultKeybinding: '',
    projection: 'revised'
  }
] as const satisfies readonly ReviewCommandDescriptor[]

export const REVIEW_CONTEXT_EDIT_COMMAND = Object.freeze({
  id: 'review.edit-context-comment',
  descriptionKey: 'contextMenu.editComment',
  defaultKeybinding: ''
})

export type CriticMarkupReviewAction = (typeof REVIEW_COMMAND_DESCRIPTORS)[number]['action']
export type ReviewCommandId = (typeof REVIEW_COMMAND_DESCRIPTORS)[number]['id']
export type ReviewCommand = (typeof REVIEW_COMMAND_DESCRIPTORS)[number]

const REVIEW_ACTIONS: ReadonlySet<string> = new Set(
  REVIEW_COMMAND_DESCRIPTORS.map(descriptor => descriptor.action)
)

export const isCriticMarkupReviewAction = (
  value: unknown
): value is CriticMarkupReviewAction =>
  typeof value === 'string' && REVIEW_ACTIONS.has(value)

export const REVIEW_COMMAND_CONSTANTS = Object.freeze({
  REVIEW_TOGGLE_TRACK_CHANGES: REVIEW_COMMAND_DESCRIPTORS[0].id,
  REVIEW_MARK_ADDITION: REVIEW_COMMAND_DESCRIPTORS[1].id,
  REVIEW_MARK_DELETION: REVIEW_COMMAND_DESCRIPTORS[2].id,
  REVIEW_SUGGEST_REPLACEMENT: REVIEW_COMMAND_DESCRIPTORS[3].id,
  REVIEW_MARK_HIGHLIGHT: REVIEW_COMMAND_DESCRIPTORS[4].id,
  REVIEW_ADD_COMMENT: REVIEW_COMMAND_DESCRIPTORS[5].id,
  REVIEW_PREVIOUS: REVIEW_COMMAND_DESCRIPTORS[6].id,
  REVIEW_NEXT: REVIEW_COMMAND_DESCRIPTORS[7].id,
  REVIEW_ACCEPT_CURRENT: REVIEW_COMMAND_DESCRIPTORS[8].id,
  REVIEW_REJECT_CURRENT: REVIEW_COMMAND_DESCRIPTORS[9].id,
  REVIEW_ACCEPT_ALL: REVIEW_COMMAND_DESCRIPTORS[10].id,
  REVIEW_REJECT_ALL: REVIEW_COMMAND_DESCRIPTORS[11].id,
  REVIEW_SHOW_MARKED: REVIEW_COMMAND_DESCRIPTORS[12].id,
  REVIEW_SHOW_ORIGINAL: REVIEW_COMMAND_DESCRIPTORS[13].id,
  REVIEW_SHOW_REVISED: REVIEW_COMMAND_DESCRIPTORS[14].id
})
