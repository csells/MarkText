import { onBeforeUnmount, watch, type Ref } from 'vue'
import type {
  ICriticMarkupTrackChangeRejection,
  TCriticMarkupTrackChangeRejectionReason
} from '@muyajs/core'
import { useEditorStore } from '@/store/editor'
import { t } from '../../i18n'

export const TRACK_CHANGE_REJECTION_TITLE_KEY = 'editor.criticMarkup.trackChangeRejected.title'

export const TRACK_CHANGE_REJECTION_BODY_KEYS: Record<
  TCriticMarkupTrackChangeRejectionReason,
  string
> = {
  'unmappable-source-edit': 'editor.criticMarkup.trackChangeRejected.unmappableSourceEdit',
  'parser-conflict': 'editor.criticMarkup.trackChangeRejected.parserConflict',
  'unmappable-tracked-selection':
    'editor.criticMarkup.trackChangeRejected.unmappableTrackedSelection',
  'missing-tracked-selection-block':
    'editor.criticMarkup.trackChangeRejected.missingTrackedSelectionBlock'
}

// A persisting conflict can reject every subsequent keystroke; replacing the
// previous banner instead of stacking keeps the advice readable.
export const TRACK_CHANGE_REJECTION_EXCLUSIVE_TYPE = 'criticMarkupTrackChangeRejected'

// The narrow slice of the Muya event surface this notifier consumes. The
// engine types `on`/`off` as (event: string, listener) => void, so the full
// instance remains assignable.
interface TrackChangeRejectionSource {
  on: (
    event: 'critic-markup-track-change-rejected',
    listener: (rejection: ICriticMarkupTrackChangeRejection) => void
  ) => void
  off: (
    event: 'critic-markup-track-change-rejected',
    listener: (rejection: ICriticMarkupTrackChangeRejection) => void
  ) => void
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
  const body = translate(TRACK_CHANGE_REJECTION_BODY_KEYS[rejection.reason])
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

  const listener = (rejection: ICriticMarkupTrackChangeRejection): void => {
    const tabId = options.tabId.value
    if (!tabId) return
    presentTrackChangeRejection(rejection, tabId, editorStore)
  }

  const disconnectEditor = (): void => {
    if (connectedEditor) {
      connectedEditor.off('critic-markup-track-change-rejected', listener)
    }
    connectedEditor = null
  }

  const stopEditorWatch = watch(
    options.editor,
    (nextEditor) => {
      if (nextEditor === connectedEditor) return
      disconnectEditor()
      connectedEditor = nextEditor
      if (connectedEditor) {
        connectedEditor.on('critic-markup-track-change-rejected', listener)
      }
    },
    { immediate: true, flush: 'sync' }
  )

  onBeforeUnmount(() => {
    stopEditorWatch()
    disconnectEditor()
  })
}
