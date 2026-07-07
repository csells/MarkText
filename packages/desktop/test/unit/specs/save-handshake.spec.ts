import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The save handshake carries ground truth: main echoes the markdown it wrote
// in mt::tab-saved, and the renderer stamps diskBaseMarkdown (the three-way-
// merge base) from that echo — never from the live buffer, which the user may
// have kept editing during the async write. Stamping the live buffer
// corrupted the merge base: local edits made mid-save were treated as
// already-on-disk and could never merge again.

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      marktext?: { env: { windowId: number } }
      fileUtils?: { isSamePathSync: (a: string, b: string) => boolean }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.marktext ??= { env: { windowId: 1 } }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {} }
  }
})

vi.mock('@/services/notification', () => ({ default: { notify: vi.fn(), name: 'notify' } }))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve(true))
}))

const { useEditorStore } = await import('@/store/editor')

type IpcHandler = (...args: unknown[]) => void

const makeTab = (store: ReturnType<typeof useEditorStore>) => {
  const tab = {
    lastSavedHistoryId: undefined as number | undefined,
    id: 'tab-1',
    filename: 'a.md',
    pathname: '/x/a.md',
    markdown: 'saved content\n',
    diskBaseMarkdown: 'old base\n',
    isSaved: false,
    encoding: { encoding: 'utf8', isBom: false },
    lineEnding: 'lf',
    adjustLineEndingOnSave: false,
    trimTrailingNewline: 1,
    isMixedLineEndings: false,
    notifications: [],
    cursor: null,
    wordCount: { paragraph: 0, word: 2, character: 13, all: 14 },
    searchMatches: { index: -1, matches: [], value: '' },
    scrollTop: 0,
    muyaIndexCursor: null,
    history: { stack: [{ id: 7 }], index: 0, lastEditIndex: 0 }
  }
  store.tabs = [tab] as unknown as typeof store.tabs
  store.tabIdToIndex = { 'tab-1': 0 }
  store.currentFile = tab as unknown as typeof store.currentFile
  return tab
}

const captureHandlers = () => {
  const handlers = new Map<string, IpcHandler>()
  vi.spyOn(window.electron.ipcRenderer, 'on').mockImplementation(((
    channel: string,
    handler: IpcHandler
  ) => {
    handlers.set(channel, handler)
  }) as never)
  return handlers
}

describe('save handshake stamps the merge base from the bytes actually written', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('a mid-save edit keeps the tab dirty and bases on the written snapshot', () => {
    const store = useEditorStore()
    const tab = makeTab(store)
    const handlers = captureHandlers()
    const sent: unknown[][] = []
    vi.spyOn(window.electron.ipcRenderer, 'send').mockImplementation(((...args: unknown[]) => {
      sent.push(args)
    }) as never)

    store.LISTEN_FOR_SET_PATHNAME()
    store.FILE_SAVE()
    const saveRequest = sent.find((args) => args[0] === 'mt::response-file-save')
    expect(saveRequest?.[4]).toBe('saved content\n')

    // The user keeps typing while the async write is in flight; main echoes
    // the bytes it actually wrote.
    tab.markdown = 'saved content PLUS EDITS\n'

    handlers.get('mt::tab-saved')!(null, 'tab-1', 'saved content\n')

    expect(tab.diskBaseMarkdown).toBe('saved content\n')
    expect(tab.isSaved).toBe(false)
  })

  it('an unchanged buffer completes the save clean, based on the snapshot', () => {
    const store = useEditorStore()
    const tab = makeTab(store)
    const handlers = captureHandlers()
    vi.spyOn(window.electron.ipcRenderer, 'send').mockImplementation((() => {}) as never)

    store.LISTEN_FOR_SET_PATHNAME()
    store.FILE_SAVE()
    handlers.get('mt::tab-saved')!(null, 'tab-1', 'saved content\n')

    expect(tab.diskBaseMarkdown).toBe('saved content\n')
    expect(tab.isSaved).toBe(true)
    expect(tab.lastSavedHistoryId).toBe(7)
  })

  it('a tab-saved echo without the saved markdown is refused loudly, not guessed', () => {
    const store = useEditorStore()
    const tab = makeTab(store)
    const handlers = captureHandlers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    store.LISTEN_FOR_SET_PATHNAME()
    handlers.get('mt::tab-saved')!(null, 'tab-1')

    expect(tab.isSaved).toBe(false)
    expect(tab.diskBaseMarkdown).toBe('old base\n')
    expect(consoleError).toHaveBeenCalled()
  })
})
