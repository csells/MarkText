import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// tab.markdown is the three-way-merge local and becomes diskBaseMarkdown on
// save, so the trailing-newline trim sits directly on the data-preservation
// path. The trim must only ever remove newline characters — a character-class
// typo ([\r?\n]) once made it eat literal trailing '?' text.

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      marktext?: { env: { windowId: number } }
      electron?: { clipboard: { writeText: (s: string) => void }; ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void } }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.marktext ??= { env: { windowId: 1 } }
  w.window.electron ??= { clipboard: { writeText: () => {} }, ipcRenderer: { send: () => {}, on: () => {} } }
})

vi.mock('@/services/notification', () => ({ default: { notify: vi.fn(), name: 'notify' } }))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve(true))
}))

const { useEditorStore } = await import('@/store/editor')

const makeTab = (store: ReturnType<typeof useEditorStore>, trimTrailingNewline: number) => {
  const tab = {
    id: 'tab-1',
    filename: 'a.md',
    pathname: '/x/a.md',
    markdown: 'seed',
    diskBaseMarkdown: 'seed',
    isSaved: false,
    encoding: { encoding: 'utf8', isBom: false },
    lineEnding: 'lf',
    adjustLineEndingOnSave: false,
    trimTrailingNewline,
    isMixedLineEndings: false,
    notifications: [],
    history: { stack: [], index: -1 }
  }
  store.tabs = [tab] as unknown as typeof store.tabs
  store.tabIdToIndex = { 'tab-1': 0 }
  store.currentFile = tab as unknown as typeof store.currentFile
  return tab
}

describe('trailing-newline adjustment preserves document text', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('trim mode keeps literal trailing question marks', () => {
    const store = useEditorStore()
    const tab = makeTab(store, 0)

    store.LISTEN_FOR_CONTENT_CHANGE({ id: 'tab-1', markdown: 'Is this right?\n' } as never)

    expect(tab.markdown).toBe('Is this right?')
  })

  it('ensure-single-newline mode keeps literal trailing question marks', () => {
    const store = useEditorStore()
    const tab = makeTab(store, 1)

    store.LISTEN_FOR_CONTENT_CHANGE({ id: 'tab-1', markdown: 'Really??\n\n\n' } as never)

    expect(tab.markdown).toBe('Really??\n')
  })
})
