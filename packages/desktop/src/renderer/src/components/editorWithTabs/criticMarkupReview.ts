import type {
  CriticMarkupProjection,
  CriticMarkupPromptKind,
  CriticMarkupReviewAction,
  CriticMarkupSidebarItemAction,
  CriticMarkupSidebarState
} from '@shared/types/criticMarkup'
import type {
  ICriticMarkupReviewActions,
  ICriticMarkupReviewSnapshot
} from '@muyajs/core'

export type CriticMarkupTextRequest = (
  kind: CriticMarkupPromptKind
) => Promise<string | null>

const noTextRequest: CriticMarkupTextRequest = async() => null

export async function executeCriticMarkupReviewAction(
  editor: ICriticMarkupReviewActions,
  action: CriticMarkupReviewAction,
  requestText: CriticMarkupTextRequest = noTextRequest
): Promise<boolean> {
  switch (action) {
    case 'toggle-track-changes': {
      const enabled = !editor.getCriticMarkupReviewSnapshot().trackChanges
      editor.setOptions({ criticMarkupTrackChanges: enabled }, false)
      return true
    }
    case 'mark-addition':
      return editor.createCriticMarkup({ type: 'addition' })
    case 'mark-deletion':
      return editor.createCriticMarkup({ type: 'deletion' })
    case 'mark-highlight':
      return editor.createCriticMarkup({ type: 'highlight' })
    case 'suggest-replacement': {
      const replacement = await requestText('substitution')
      return replacement === null
        ? false
        : editor.createCriticMarkup({ type: 'substitution', replacement })
    }
    case 'add-comment': {
      const comment = await requestText('comment')
      return comment === null || comment.length === 0
        ? false
        : editor.createCriticMarkup({ type: 'comment', comment })
    }
    case 'previous':
      return editor.navigateCriticMarkup('previous') !== null
    case 'next':
      return editor.navigateCriticMarkup('next') !== null
    case 'accept-current':
      return editor.resolveCriticMarkup('accept')
    case 'reject-current':
      return editor.resolveCriticMarkup('reject')
    case 'accept-all':
      return editor.resolveAllCriticMarkup('accept') > 0
    case 'reject-all':
      return editor.resolveAllCriticMarkup('reject') > 0
    case 'show-marked':
      editor.setOptions({ criticMarkupProjection: 'marked' }, true)
      return true
    case 'show-original':
      editor.setOptions({ criticMarkupProjection: 'original' }, true)
      return true
    case 'show-revised':
      editor.setOptions({ criticMarkupProjection: 'revised' }, true)
      return true
    default: {
      const impossible: never = action
      throw new TypeError(`Unknown CriticMarkup review action: ${String(impossible)}`)
    }
  }
}

export function executeCriticMarkupSidebarItemAction(
  editor: ICriticMarkupReviewActions,
  payload: CriticMarkupSidebarItemAction,
  projection: CriticMarkupProjection,
  currentFileId: string
): boolean {
  if (payload.fileId !== currentFileId) return false

  if (projection !== 'marked') {
    editor.setOptions({ criticMarkupProjection: 'marked' }, true)
  }

  if (payload.action === 'focus') {
    return editor.focusCriticMarkup(payload.target) !== null
  }

  if (payload.action === 'accept' || payload.action === 'reject') {
    return editor.resolveCriticMarkup(payload.action, payload.target)
  }

  if (payload.action === 'remove-annotation') {
    return editor.resolveCriticMarkup('accept', payload.target)
  }

  const impossible: never = payload.action
  throw new TypeError(`Unknown CriticMarkup sidebar action: ${String(impossible)}`)
}

export function buildCriticMarkupSidebarState(
  fileId: string,
  snapshot: ICriticMarkupReviewSnapshot
): CriticMarkupSidebarState {
  return {
    fileId,
    available: true,
    items: snapshot.items,
    currentItemId: snapshot.currentItemId,
    trackChanges: snapshot.trackChanges,
    projection: snapshot.projection
  }
}
