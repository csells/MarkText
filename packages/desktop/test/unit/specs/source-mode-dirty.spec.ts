import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: {
          send: (...a: unknown[]) => void
          on: (...a: unknown[]) => void
          invoke: (...a: unknown[]) => Promise<unknown>
        }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {}, invoke: async() => false }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

import { useEditorStore } from '@/store/editor'

describe('useEditorStore main-owned document state', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  const makeSavedTab = (store: ReturnType<typeof useEditorStore>) => {
    const tab = {
      id: 'tab-1',
      filename: 'a.md',
      pathname: '/x/a.md',
      markdown: 'hello',
      isSaved: true,
      documentCoreHistory: {
        canUndo: false,
        canRedo: false,
        dirty: false,
        headIdentity: 'tab-1:history:0',
        savedIdentity: 'tab-1:history:0'
      }
    }
    store.tabs = [tab] as unknown as typeof store.tabs
    store.tabIdToIndex = { 'tab-1': 0 }
    return tab
  }

  it('marks the tab unsaved only from the main-owned dirty state', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)

    store.LISTEN_FOR_CONTENT_CHANGE({
      id: 'tab-1',
      markdown: 'hello world',
      documentCoreHistory: {
        canUndo: true,
        canRedo: false,
        dirty: true,
        headIdentity: 'tab-1:history:1',
        savedIdentity: 'tab-1:history:0'
      }
    })

    expect(tab.isSaved).toBe(false)
  })

  it('does not infer clean state from unchanged renderer content', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)

    store.LISTEN_FOR_CONTENT_CHANGE({
      id: 'tab-1',
      markdown: 'hello',
      documentCoreHistory: {
        canUndo: true,
        canRedo: false,
        dirty: true,
        headIdentity: 'tab-1:history:1',
        savedIdentity: 'tab-1:history:0'
      }
    })

    expect(tab.isSaved).toBe(false)
  })

  it('caches the exact verified publication without rewriting it', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    const exact = 'hello\r\n\r\n'

    store.LISTEN_FOR_CONTENT_CHANGE({
      id: 'tab-1',
      markdown: exact,
      documentCoreHistory: {
        canUndo: true,
        canRedo: false,
        dirty: true,
        headIdentity: 'tab-1:history:1',
        savedIdentity: 'tab-1:history:0'
      }
    })

    expect(tab.markdown).toBe(exact)
  })

  it('does not special-case a lone newline from authoritative dirty state', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.markdown = ''

    store.LISTEN_FOR_CONTENT_CHANGE({
      id: 'tab-1',
      markdown: '\n',
      documentCoreHistory: {
        canUndo: true,
        canRedo: false,
        dirty: true,
        headIdentity: 'tab-1:history:1',
        savedIdentity: 'tab-1:history:0'
      }
    })

    expect(tab.markdown).toBe('\n')
    expect(tab.isSaved).toBe(false)
  })

  it('rejects changed content that has no authoritative state', () => {
    const store = useEditorStore()
    makeSavedTab(store)

    expect(() => store.LISTEN_FOR_CONTENT_CHANGE({
      id: 'tab-1',
      markdown: 'hello world'
    })).toThrow(/without main-owned history state/)
  })

  it('marks a persisted revision clean only from main-returned history', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    store.APPLY_DOCUMENT_CORE_HISTORY_STATE('tab-1', {
      canUndo: true,
      canRedo: false,
      dirty: true,
      headIdentity: 'tab-1:history:1',
      savedIdentity: 'tab-1:history:0'
    })
    const cleanState = {
      canUndo: true,
      canRedo: false,
      dirty: false,
      headIdentity: 'tab-1:history:1',
      savedIdentity: 'tab-1:history:1'
    }
    store.APPLY_DOCUMENT_CORE_HISTORY_STATE('tab-1', cleanState)
    expect(tab.documentCoreHistory).toEqual(cleanState)
    expect(tab.isSaved).toBe(true)
  })

  it('stays dirty when a newer head follows the persisted revision', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    store.APPLY_DOCUMENT_CORE_HISTORY_STATE('tab-1', {
      canUndo: true,
      canRedo: false,
      dirty: true,
      headIdentity: 'tab-1:history:2',
      savedIdentity: 'tab-1:history:0'
    })
    store.APPLY_DOCUMENT_CORE_HISTORY_STATE('tab-1', {
      canUndo: true,
      canRedo: false,
      dirty: true,
      headIdentity: 'tab-1:history:2',
      savedIdentity: 'tab-1:history:1'
    })

    expect(tab.isSaved).toBe(false)
    expect(tab.documentCoreHistory?.savedIdentity).toBe('tab-1:history:1')
  })
})
