import { onBeforeUnmount, watch, type Ref } from 'vue'
import type {
  ICriticMarkupTrackChangeRejection,
  TCriticMarkupTrackChangeRejectionReason
} from '@marktext/document-view'
import { useEditorStore } from '@/store/editor'
import { t } from '../../i18n'

export const TRACK_CHANGE_REJECTION_TITLE_KEY = 'editor.criticMarkup.trackChangeRejected.title'
export const TRACK_CHANGE_REJECTION_UNKNOWN_KEY =
  'editor.criticMarkup.trackChangeRejected.unknownReason'

type TrackChangeRejectionMessageKey =
  | 'editor.criticMarkup.trackChangeRejected.unmappableSourceEdit'
  | 'editor.criticMarkup.trackChangeRejected.parserConflict'
  | 'editor.criticMarkup.trackChangeRejected.unmappableTrackedSelection'
  | 'editor.criticMarkup.trackChangeRejected.missingTrackedSelectionBlock'
  | 'editor.criticMarkup.trackChangeRejected.commentPayloadTarget'

/**
 * The engine owns a closed rejection taxonomy; the renderer owns exhaustive,
 * localized presentation. Several machine reasons intentionally share one
 * actionable explanation, but no machine token is ever rendered to a person.
 */
export const TRACK_CHANGE_REJECTION_MESSAGE_KEYS = Object.freeze({
  'stale-selection':
    'editor.criticMarkup.trackChangeRejected.unmappableTrackedSelection',
  'selection-not-collapsed':
    'editor.criticMarkup.trackChangeRejected.unmappableTrackedSelection',
  'selection-collapsed':
    'editor.criticMarkup.trackChangeRejected.unmappableTrackedSelection',
  'nothing-to-undo':
    'editor.criticMarkup.trackChangeRejected.unmappableSourceEdit',
  'nothing-to-redo':
    'editor.criticMarkup.trackChangeRejected.unmappableSourceEdit',
  'no-source-change':
    'editor.criticMarkup.trackChangeRejected.unmappableSourceEdit',
  'invalid-command-argument':
    'editor.criticMarkup.trackChangeRejected.unmappableSourceEdit',
  'read-only-change-arm':
    'editor.criticMarkup.trackChangeRejected.unmappableSourceEdit',
  'read-only-projection':
    'editor.criticMarkup.trackChangeRejected.unmappableSourceEdit',
  'source-only-revision':
    'editor.criticMarkup.trackChangeRejected.parserConflict',
  'precommit-failed':
    'editor.criticMarkup.trackChangeRejected.parserConflict',
  'target-not-found':
    'editor.criticMarkup.trackChangeRejected.missingTrackedSelectionBlock',
  'wrong-target-kind':
    'editor.criticMarkup.trackChangeRejected.unmappableTrackedSelection',
  'invalid-source-range':
    'editor.criticMarkup.trackChangeRejected.unmappableTrackedSelection',
  'empty-comment-anchor':
    'editor.criticMarkup.trackChangeRejected.unmappableTrackedSelection',
  'empty-comment':
    'editor.criticMarkup.trackChangeRejected.unmappableSourceEdit',
  'invalid-comment-payload':
    'editor.criticMarkup.trackChangeRejected.unmappableSourceEdit',
  'selection-crosses-syntax-boundary':
    'editor.criticMarkup.trackChangeRejected.unmappableTrackedSelection',
  'selection-includes-hidden-comment':
    'editor.criticMarkup.trackChangeRejected.unmappableTrackedSelection',
  'selection-partially-intersects-critic-markup':
    'editor.criticMarkup.trackChangeRejected.unmappableTrackedSelection',
  'selection-inside-markdown-literal':
    'editor.criticMarkup.trackChangeRejected.unmappableTrackedSelection',
  'selection-partially-intersects-markdown-literal':
    'editor.criticMarkup.trackChangeRejected.unmappableTrackedSelection',
  'markdown-literal-source-only':
    'editor.criticMarkup.trackChangeRejected.parserConflict',
  'selection-has-no-revised-contribution':
    'editor.criticMarkup.trackChangeRejected.unmappableTrackedSelection',
  'selection-has-no-original-contribution':
    'editor.criticMarkup.trackChangeRejected.unmappableTrackedSelection',
  'hidden-comment-loss':
    'editor.criticMarkup.trackChangeRejected.parserConflict',
  'comment-payload-target':
    'editor.criticMarkup.trackChangeRejected.commentPayloadTarget',
  'candidate-source-only':
    'editor.criticMarkup.trackChangeRejected.parserConflict',
  'semantic-postcondition-failed':
    'editor.criticMarkup.trackChangeRejected.parserConflict'
} satisfies Record<
  TCriticMarkupTrackChangeRejectionReason,
  TrackChangeRejectionMessageKey
>)

const trackChangeRejectionMessageKey = (
  reason: unknown
): TrackChangeRejectionMessageKey | typeof TRACK_CHANGE_REJECTION_UNKNOWN_KEY => {
  if (
    typeof reason === 'string' &&
    Object.prototype.hasOwnProperty.call(
      TRACK_CHANGE_REJECTION_MESSAGE_KEYS,
      reason
    )
  ) {
    return TRACK_CHANGE_REJECTION_MESSAGE_KEYS[
      reason as TCriticMarkupTrackChangeRejectionReason
    ]
  }
  return TRACK_CHANGE_REJECTION_UNKNOWN_KEY
}

// A persisting conflict can reject every subsequent keystroke; replacing the
// previous banner instead of stacking keeps the advice readable.
export const TRACK_CHANGE_REJECTION_EXCLUSIVE_TYPE = 'criticMarkupTrackChangeRejected'

// The narrow, typed document-host subscription this notifier consumes.
interface TrackChangeRejectionSource {
  subscribeTrackChangeRejection: (
    listener: (rejection: ICriticMarkupTrackChangeRejection) => void
  ) => Readonly<{ dispose: () => void }>
}

interface NotificationSink {
  pushTabNotification: (data: {
    tabId: string
    msg: string
    showConfirm?: boolean
    style?: string
    exclusiveType?: string
  }) => void
}

// The tab banner renders a single message string, so the localized title and
// per-reason body are joined here rather than in the locale files.
export const presentTrackChangeRejection = (
  rejection: ICriticMarkupTrackChangeRejection,
  tabId: string,
  sink: NotificationSink,
  translate: (key: string) => string = t
): void => {
  const title = translate(TRACK_CHANGE_REJECTION_TITLE_KEY)
  const body = translate(trackChangeRejectionMessageKey(rejection.reason))
  sink.pushTabNotification({
    tabId,
    msg: `${title}: ${body}`,
    showConfirm: false,
    style: 'warn',
    exclusiveType: TRACK_CHANGE_REJECTION_EXCLUSIVE_TYPE
  })
}

interface CriticMarkupRejectionNotifierOptions {
  editor: Readonly<Ref<TrackChangeRejectionSource | null>>
  tabId: Readonly<Ref<string | null>>
}

/**
 * Presents the engine's fail-closed Track Changes rejections as a per-tab
 * warning banner. The engine has already discarded the edit by the time the
 * event fires; this only explains why nothing changed and what to try, so it
 * must never steal focus from the editor.
 */
export function useCriticMarkupRejectionNotifier(
  options: CriticMarkupRejectionNotifierOptions
): void {
  const editorStore = useEditorStore()
  let connectedEditor: TrackChangeRejectionSource | null = null
  let rejectionSubscription: Readonly<{ dispose: () => void }> | null = null

  const listener = (rejection: ICriticMarkupTrackChangeRejection): void => {
    const tabId = options.tabId.value
    if (!tabId) return
    presentTrackChangeRejection(rejection, tabId, editorStore)
  }

  const disconnectEditor = (): void => {
    rejectionSubscription?.dispose()
    rejectionSubscription = null
    connectedEditor = null
  }

  const stopEditorWatch = watch(
    options.editor,
    (nextEditor) => {
      if (nextEditor === connectedEditor) return
      disconnectEditor()
      connectedEditor = nextEditor
      if (connectedEditor) {
        rejectionSubscription =
          connectedEditor.subscribeTrackChangeRejection(listener)
      }
    },
    { immediate: true, flush: 'sync' }
  )

  onBeforeUnmount(() => {
    stopEditorWatch()
    disconnectEditor()
  })
}
