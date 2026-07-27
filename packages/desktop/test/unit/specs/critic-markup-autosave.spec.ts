import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createDocumentState } from '@/store/help'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'

vi.hoisted(() => {
  const target = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (pathname: string) => string }
      electron?: {
        clipboard: { writeText: (text: string) => void }
        ipcRenderer: {
          send: (...args: unknown[]) => void
          on: (...args: unknown[]) => void
          invoke: (...args: unknown[]) => Promise<unknown>
        }
      }
    }
  }
  target.window ??= {}
  target.window.path ??= { sep: '/', dirname: pathname => pathname }
  target.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: {
      send: () => {},
      on: () => {},
      invoke: async() => undefined
    }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

const dirtyHistory = Object.freeze({
  canUndo: true,
  canRedo: false,
  dirty: true,
  headIdentity: 'history:1',
  savedIdentity: 'history:0'
})

describe('CriticMarkup autosave ownership', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('requests a main-owned autosave without renderer source or projection text', async() => {
    const store = useEditorStore()
    const preferences = usePreferencesStore()
    preferences.autoSave = true
    preferences.autoSaveDelay = 100
    const tab = createDocumentState({
      filename: 'review.md',
      pathname: '/tmp/review.md',
      markdown: 'A {++canonical++} review.\n',
      isSaved: true
    }, 'document:review')
    store.tabs = [tab]
    store.currentFile = tab
    store.updateTabIdToIndex()
    const invoke = vi.spyOn(window.electron.ipcRenderer, 'invoke')
      .mockResolvedValue({ kind: 'written' })

    store.LISTEN_FOR_CONTENT_CHANGE({
      id: tab.id,
      markdown: 'A {++canonical++} review.\n',
      documentCoreHistory: dirtyHistory
    })
    await vi.advanceTimersByTimeAsync(100)

    expect(invoke).toHaveBeenCalledWith(
      'mt::document-core::save',
      { documentId: 'document:review', mode: 'autosave' }
    )
    expect(invoke.mock.calls[0]?.[1]).not.toHaveProperty('markdown')
    expect(invoke.mock.calls[0]?.[1]).not.toHaveProperty('projection')
    expect(invoke.mock.calls[0]?.[1]).not.toHaveProperty('options')
  })

  it('skips the deferred autosave after the main receipt marks the tab clean', async() => {
    const store = useEditorStore()
    const preferences = usePreferencesStore()
    preferences.autoSave = true
    preferences.autoSaveDelay = 100
    const tab = createDocumentState({
      filename: 'review.md',
      pathname: '/tmp/review.md',
      markdown: '{==text==}{>>comment<<}\n',
      isSaved: true
    }, 'document:review')
    store.tabs = [tab]
    store.currentFile = tab
    store.updateTabIdToIndex()
    const invoke = vi.spyOn(window.electron.ipcRenderer, 'invoke')

    store.LISTEN_FOR_CONTENT_CHANGE({
      id: tab.id,
      markdown: tab.markdown,
      documentCoreHistory: dirtyHistory
    })
    tab.isSaved = true
    await vi.advanceTimersByTimeAsync(100)

    expect(invoke).not.toHaveBeenCalled()
  })
})
