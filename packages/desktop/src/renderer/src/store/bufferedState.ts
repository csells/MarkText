import debounce from 'lodash/debounce'
import equal from 'deep-equal'
import { useEditorStore } from './editor'
import { useProjectStore } from './project'
import { useLayoutStore } from './layout'
import { coreDocumentSaveAuthority } from '../documentAuthority/coreDocumentSaveAuthority'

const BUFFERED_STATE_DEBOUNCE_MS = 1000
const BUFFERED_STATE_VERSION = 1

export const createBufferedState = () => {
  const editorState = useEditorStore().CREATE_BUFFERED_STATE()
  if (!editorState) return null
  return {
    version: BUFFERED_STATE_VERSION,
    ...editorState,
    project: useProjectStore().CREATE_BUFFERED_STATE(),
    layout: useLayoutStore().CREATE_BUFFERED_STATE()
  }
}

export type BufferedSnapshot = NonNullable<ReturnType<typeof createBufferedState>>
export type ResolvedSources = Awaited<ReturnType<typeof coreDocumentSaveAuthority.resolve>>

const authoritativeBufferedState = async(): Promise<{
  snapshot: BufferedSnapshot | null
  sources: ResolvedSources
}> => {
  for (;;) {
    const snapshot = createBufferedState()
    if (snapshot === null) return { snapshot, sources: [] }
    const sources = await coreDocumentSaveAuthority.resolve(
      snapshot.tabs.map((tab) => ({ documentId: tab.id, fallbackSource: tab.markdown }))
    )
    const live = createBufferedState()
    // A tab may be opened, closed or changed while another tab is settling.
    // Resolve again for that live set; never combine unrelated tab snapshots.
    if (
      live === null ||
      !equal(
        snapshot.tabs.map((tab) => tab.id),
        live.tabs.map((tab) => tab.id)
      ) ||
      sources.some(
        (source, index) =>
          source.authority === 'fallback' && source.source !== live.tabs[index]!.markdown
      )
    ) { continue }
    return {
      snapshot: {
        ...live,
        tabs: live.tabs.map((tab, index) => ({ ...tab, markdown: sources[index]!.source }))
      },
      sources
    }
  }
}

export const sendBufferedState = async(): Promise<unknown> => {
  const { snapshot } = await authoritativeBufferedState()
  return snapshot === null
    ? false
    : window.electron.ipcRenderer.invoke('update-buffer-state', snapshot)
}

// Quit has a stronger contract than a periodic checkpoint: a write that was
// current when dispatched may already be obsolete when main acknowledges it.
// Keep the final comparison and close authorization in the same continuation.
export const withPersistedBufferedState = async(
  close: (snapshot: BufferedSnapshot | null, sources: ResolvedSources) => void
): Promise<void> => {
  let current = await authoritativeBufferedState()
  for (;;) {
    if (current.snapshot !== null) {
      const persisted = await window.electron.ipcRenderer.invoke(
        'update-buffer-state',
        current.snapshot
      )
      if (persisted !== true) throw new Error('Window recovery checkpoint was not persisted')
    }
    const latest = await authoritativeBufferedState()
    if (equal(current, latest) && coreDocumentSaveAuthority.isCurrent(latest.sources)) {
      close(latest.snapshot, latest.sources)
      return
    }
    current = latest
  }
}

export const debouncedSendBufferedState = debounce(() => {
  sendBufferedState().catch((err) => {
    console.error('Failed to update buffered state', err)
  })
}, BUFFERED_STATE_DEBOUNCE_MS)
