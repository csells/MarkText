import debounce from 'lodash/debounce'
import { reportAsyncFailure } from '@marktext/document-view'
import { useEditorStore } from './editor'
import { useLayoutStore } from './layout'
import type {
  WindowUiCheckpointIntent
} from '@shared/types/bufferedState'

const BUFFERED_STATE_DEBOUNCE_MS = 1000

interface StoreCache {
  editorStore: ReturnType<typeof useEditorStore> | null
  layoutStore: ReturnType<typeof useLayoutStore> | null
}

const stores: StoreCache = {
  editorStore: null,
  layoutStore: null
}

export const createBufferedState = (): WindowUiCheckpointIntent | null => {
  if (!stores.editorStore) {
    stores.editorStore = useEditorStore()
  }
  if (!stores.layoutStore) {
    stores.layoutStore = useLayoutStore()
  }

  const editorState = stores.editorStore.CREATE_BUFFERED_STATE()
  if (!editorState) return null
  const layout = stores.layoutStore.CREATE_BUFFERED_STATE()
  if (layout === null) return null

  return Object.freeze({
    schema: 'document-core-window-ui-intent-1',
    ...editorState,
    layout
  })
}

export const sendBufferedState = async(): Promise<unknown> => {
  const snapshot = createBufferedState()
  if (snapshot) {
    return window.electron.ipcRenderer.invoke('update-buffer-state', snapshot)
  }

  return false
}

export const debouncedSendBufferedState = debounce(() => {
  sendBufferedState().catch((cause: unknown) => {
    reportAsyncFailure(cause, 'Buffered state persistence')
  })
}, BUFFERED_STATE_DEBOUNCE_MS)
