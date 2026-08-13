import debounce from 'lodash/debounce'
import { useEditorStore } from './editor'
import { useProjectStore } from './project'
import { useLayoutStore } from './layout'
import { coreDocumentSaveAuthority } from '../documentAuthority/coreDocumentSaveAuthority'

const BUFFERED_STATE_DEBOUNCE_MS = 1000
const BUFFERED_STATE_VERSION = 1

interface StoreCache {
  editorStore: ReturnType<typeof useEditorStore> | null
  projectStore: ReturnType<typeof useProjectStore> | null
  layoutStore: ReturnType<typeof useLayoutStore> | null
}

const stores: StoreCache = {
  editorStore: null,
  projectStore: null,
  layoutStore: null
}

export const createBufferedState = (): Record<string, unknown> | null => {
  if (!stores.editorStore) {
    stores.editorStore = useEditorStore()
  }
  if (!stores.projectStore) {
    stores.projectStore = useProjectStore()
  }
  if (!stores.layoutStore) {
    stores.layoutStore = useLayoutStore()
  }

  const editorState = stores.editorStore.CREATE_BUFFERED_STATE()
  if (!editorState) return null

  return {
    version: BUFFERED_STATE_VERSION,
    ...editorState,
    project: stores.projectStore?.CREATE_BUFFERED_STATE?.() || null,
    layout: stores.layoutStore?.CREATE_BUFFERED_STATE?.() || null
  }
}

export const sendBufferedState = (): Promise<unknown> => {
  const snapshot = createBufferedState()
  if (snapshot) {
    const tabs = Array.isArray(snapshot.tabs)
      ? snapshot.tabs.filter(
        (tab): tab is Record<string, unknown> & { id: string; markdown: string } =>
          typeof tab === 'object' && tab !== null &&
          typeof (tab as { id?: unknown }).id === 'string' &&
          typeof (tab as { markdown?: unknown }).markdown === 'string'
      )
      : []
    const sources = coreDocumentSaveAuthority.resolve(
      tabs.map(tab => ({ documentId: tab.id, fallbackSource: tab.markdown }))
    )
    const persist = (resolved: readonly { source: string }[]): Promise<unknown> => {
      // A Core edit can become acknowledged while its source barrier is in
      // flight. Re-read the live dirty bit after the barrier so recovery never
      // stores authoritative new bytes under the stale pre-barrier `isSaved`
      // value captured above.
      const liveTabs = new Map(
        (stores.editorStore?.CREATE_BUFFERED_STATE()?.tabs ?? [])
          .map(tab => [tab.id, tab] as const)
      )
      const authoritativeSnapshot = {
        ...snapshot,
        tabs: tabs.map((tab, index) => ({
          ...tab,
          markdown: resolved[index]!.source,
          ...(liveTabs.has(tab.id)
            ? { isSaved: liveTabs.get(tab.id)!.isSaved }
            : {})
        }))
      }
      return window.electron.ipcRenderer.invoke('update-buffer-state', authoritativeSnapshot)
    }
    return sources instanceof Promise ? sources.then(persist) : persist(sources)
  }

  return Promise.resolve(false)
}

export const debouncedSendBufferedState = debounce(() => {
  sendBufferedState().catch((err) => {
    console.error('Failed to update buffered state', err)
  })
}, BUFFERED_STATE_DEBOUNCE_MS)
