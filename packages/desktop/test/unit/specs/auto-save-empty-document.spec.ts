import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      fileUtils?: { isSamePathSync: (a: string, b: string) => boolean }
      electron?: { ipcRenderer: { send: Mock; on: Mock } }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
  w.window.electron ??= { ipcRenderer: { send: vi.fn(), on: vi.fn() } }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve(true))
}))

import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'

// Regression: HANDLE_AUTO_SAVE used `latestTab.markdown || markdown`, so a
// document the user had emptied ('' is falsy) fell back to the stale markdown
// captured when the timer was armed — autosave resurrected the deleted content
// on disk and marked the tab saved.
describe('useEditorStore HANDLE_AUTO_SAVE — emptied document', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
    ;(window.electron.ipcRenderer.send as Mock).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const makeDirtyTab = (store: ReturnType<typeof useEditorStore>, markdown: string) => {
    const tab = {
      id: 'tab-1',
      filename: 'a.md',
      pathname: '/x/a.md',
      markdown,
      isSaved: false,
      encoding: { encoding: 'utf8', isBom: false },
      lineEnding: 'lf',
      adjustLineEndingOnSave: false,
      trimTrailingNewline: 0,
      isMixedLineEndings: false,
      notifications: [],
      history: { stack: [], index: -1 }
    }
    store.tabs = [tab] as unknown as typeof store.tabs
    store.tabIdToIndex = { 'tab-1': 0 }
    return tab
  }

  it("saves an emptied document as '' instead of the stale timer snapshot", () => {
    const store = useEditorStore()
    const preferencesStore = usePreferencesStore()
    // The document was emptied after the timer was armed with stale markdown.
    makeDirtyTab(store, '')

    store.HANDLE_AUTO_SAVE({
      id: 'tab-1',
      filename: 'a.md',
      pathname: '/x/a.md',
      markdown: 'stale content from when the timer was armed',
      options: {}
    } as Parameters<typeof store.HANDLE_AUTO_SAVE>[0])

    vi.advanceTimersByTime(preferencesStore.autoSaveDelay + 1)

    const send = window.electron.ipcRenderer.send as Mock
    const saveCall = send.mock.calls.find((c) => c[0] === 'mt::response-file-save')
    expect(saveCall).toBeTruthy()
    expect(saveCall![4]).toBe('')
  })

  it('still falls back to the payload markdown when the tab has no markdown yet', () => {
    const store = useEditorStore()
    const preferencesStore = usePreferencesStore()
    const tab = makeDirtyTab(store, 'ignored')
    ;(tab as { markdown?: string }).markdown = undefined

    store.HANDLE_AUTO_SAVE({
      id: 'tab-1',
      filename: 'a.md',
      pathname: '/x/a.md',
      markdown: 'payload fallback',
      options: {}
    } as Parameters<typeof store.HANDLE_AUTO_SAVE>[0])

    vi.advanceTimersByTime(preferencesStore.autoSaveDelay + 1)

    const send = window.electron.ipcRenderer.send as Mock
    const saveCall = send.mock.calls.find((c) => c[0] === 'mt::response-file-save')
    expect(saveCall).toBeTruthy()
    expect(saveCall![4]).toBe('payload fallback')
  })
})
