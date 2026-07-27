import type {
  CriticMarkupProjection,
  CriticMarkupPromptKind,
  CriticMarkupSidebarState
} from '@shared/types/criticMarkup'
import { decodeCriticMarkupSidebarItemAction } from '@shared/types/criticMarkup'
import {
  REVIEW_COMMAND_DESCRIPTORS,
  isCriticMarkupReviewAction,
  isReviewCommandAvailable
} from '../../../../common/commands/review'
import type {
  ICriticMarkupReviewActions,
  ICriticMarkupReviewSnapshot
} from '@marktext/document-view'

export type CriticMarkupTextRequest = (
  kind: CriticMarkupPromptKind
) => Promise<string | null>

export type CriticMarkupReviewCommandOutcome =
  | Readonly<{ kind: 'executed' }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'unavailable' }>
  | Readonly<{ kind: 'stale' }>

export const CRITIC_MARKUP_REVIEW_COMMAND_OUTCOMES = Object.freeze({
  executed: Object.freeze({ kind: 'executed' as const }),
  cancelled: Object.freeze({ kind: 'cancelled' as const }),
  unavailable: Object.freeze({ kind: 'unavailable' as const }),
  stale: Object.freeze({ kind: 'stale' as const })
})

const {
  executed: EXECUTED,
  cancelled: CANCELLED,
  unavailable: UNAVAILABLE,
  stale: STALE
} = CRITIC_MARKUP_REVIEW_COMMAND_OUTCOMES

export const CRITIC_MARKUP_REVIEW_COMMAND_REJECTION_KEY =
  'sideBar.review.actionUnavailable'
export const CRITIC_MARKUP_REVIEW_COMMAND_REJECTION_EXCLUSIVE_TYPE =
  'criticMarkupReviewCommandRejected'

export interface CriticMarkupReviewCommandNotificationSink {
  pushTabNotification: (data: {
    tabId: string
    msg: string
    showConfirm?: boolean
    style?: string
    exclusiveType?: string
  }) => void
}

export const presentCriticMarkupReviewCommandOutcome = (
  outcome: CriticMarkupReviewCommandOutcome,
  tabId: string,
  sink: CriticMarkupReviewCommandNotificationSink,
  translate: (key: string) => string
): void => {
  if (outcome.kind === 'executed' || outcome.kind === 'cancelled') return
  sink.pushTabNotification({
    tabId,
    msg: translate(CRITIC_MARKUP_REVIEW_COMMAND_REJECTION_KEY),
    showConfirm: false,
    style: 'warn',
    exclusiveType: CRITIC_MARKUP_REVIEW_COMMAND_REJECTION_EXCLUSIVE_TYPE
  })
}

const mutationOutcome = (
  changed: boolean
): CriticMarkupReviewCommandOutcome => changed ? EXECUTED : STALE

const noTextRequest: CriticMarkupTextRequest = async() => null

export async function executeCriticMarkupReviewAction(
  editor: ICriticMarkupReviewActions,
  value: unknown,
  requestText: CriticMarkupTextRequest = noTextRequest
): Promise<CriticMarkupReviewCommandOutcome> {
  if (!isCriticMarkupReviewAction(value)) return UNAVAILABLE
  const action = value
  const descriptor = REVIEW_COMMAND_DESCRIPTORS.find(
    candidate => candidate.action === action
  )
  const snapshot = editor.getCriticMarkupReviewSnapshot()
  if (
    descriptor === undefined ||
    !isReviewCommandAvailable(descriptor, {
      ...snapshot,
      available: true
    })
  ) {
    return UNAVAILABLE
  }
  switch (action) {
    case 'toggle-track-changes': {
      const enabled = !snapshot.trackChanges
      await editor.configure({ criticMarkupTrackChanges: enabled })
      return EXECUTED
    }
    case 'mark-addition':
      return mutationOutcome(
        await editor.createCriticMarkup({ type: 'addition' })
      )
    case 'mark-deletion':
      return mutationOutcome(
        await editor.createCriticMarkup({ type: 'deletion' })
      )
    case 'mark-highlight':
      return mutationOutcome(
        await editor.createCriticMarkup({ type: 'highlight' })
      )
    case 'suggest-replacement': {
      const replacement = await requestText('substitution')
      return replacement === null
        ? CANCELLED
        : mutationOutcome(await editor.createCriticMarkup({
          type: 'substitution',
          replacement
        }))
    }
    case 'add-comment': {
      const comment = await requestText('comment')
      if (comment === null) return CANCELLED
      if (comment.length === 0) return UNAVAILABLE
      return mutationOutcome(
        await editor.createCriticMarkup({ type: 'comment', comment })
      )
    }
    case 'previous':
    case 'next': {
      const projection = snapshot.projection
      const item = editor.navigateCriticMarkup(action)
      if (item === null) return STALE
      if (projection !== 'marked') {
        await editor.configure({ criticMarkupProjection: 'marked' })
      }
      return EXECUTED
    }
    case 'accept-current':
    case 'reject-current': {
      const item = snapshot.items.find(
        candidate => candidate.id === snapshot.currentItemId
      )
      if (!item) return UNAVAILABLE
      return mutationOutcome(
        await editor.resolveCriticMarkup(
          action === 'accept-current' ? 'accept' : 'reject',
          {
            revisionId: snapshot.revisionId,
            nodeId: item.id
          }
        )
      )
    }
    case 'accept-all':
      return mutationOutcome(
        (await editor.resolveAllCriticMarkup('accept')) > 0
      )
    case 'reject-all':
      return mutationOutcome(
        (await editor.resolveAllCriticMarkup('reject')) > 0
      )
    case 'show-marked':
      await editor.configure({ criticMarkupProjection: 'marked' })
      return EXECUTED
    case 'show-original':
      await editor.configure({ criticMarkupProjection: 'original' })
      return EXECUTED
    case 'show-revised':
      await editor.configure({ criticMarkupProjection: 'revised' })
      return EXECUTED
    default: {
      const impossible: never = action
      throw new TypeError(`Unknown CriticMarkup review action: ${String(impossible)}`)
    }
  }
}

export async function executeCriticMarkupSidebarItemAction(
  editor: ICriticMarkupReviewActions,
  value: unknown,
  projection: CriticMarkupProjection,
  currentDocumentId: string
): Promise<CriticMarkupReviewCommandOutcome> {
  let payload
  try {
    payload = decodeCriticMarkupSidebarItemAction(value)
  } catch {
    return UNAVAILABLE
  }
  if (payload.documentId !== currentDocumentId) return STALE

  if (payload.action === 'focus') {
    const focused = editor.focusCriticMarkup(payload.target) !== null
    if (!focused) return STALE
    if (projection !== 'marked') {
      await editor.configure({ criticMarkupProjection: 'marked' })
    }
    return EXECUTED
  }

  let resolved: boolean
  if (payload.action === 'accept' || payload.action === 'reject') {
    resolved = await editor.resolveCriticMarkup(payload.action, payload.target)
  } else if (payload.action === 'remove-annotation') {
    resolved = await editor.resolveCriticMarkup('accept', payload.target)
  } else {
    const impossible: never = payload.action
    throw new TypeError(`Unknown CriticMarkup sidebar action: ${String(impossible)}`)
  }
  if (!resolved) return STALE
  if (projection !== 'marked') {
    await editor.configure({ criticMarkupProjection: 'marked' })
  }
  return EXECUTED
}

export function buildCriticMarkupSidebarState(
  documentId: string,
  snapshot: ICriticMarkupReviewSnapshot
): CriticMarkupSidebarState {
  return {
    documentId,
    revisionId: snapshot.revisionId,
    available: true,
    items: snapshot.items,
    currentItemId: snapshot.currentItemId,
    trackChanges: snapshot.trackChanges,
    projection: snapshot.projection
  }
}
