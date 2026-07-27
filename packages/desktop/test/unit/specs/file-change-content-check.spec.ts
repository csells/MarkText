import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock
} from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createDocumentState } from '@/store/help'
import { useEditorStore } from '@/store/editor'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  reportError: vi.fn()
}))

vi.hoisted(() => {
  const target = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (value: string) => string }
      fileUtils?: { isSamePathSync: (left: string, right: string) => boolean }
      electron?: {
        ipcRenderer: {
          invoke: Mock
          on: Mock
          send: Mock
        }
      }
    }
  }
  target.window ??= {}
  target.window.path ??= { sep: '/', dirname: value => value }
  target.window.fileUtils ??= {
    isSamePathSync: (left, right) => left === right
  }
  target.window.electron = {
    ipcRenderer: {
      invoke: mocks.invoke,
      on: mocks.on,
      send: vi.fn()
    }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn()
}))

const cleanHistory = Object.freeze({
  canUndo: true,
  canRedo: false,
  dirty: false,
  headIdentity: 'semantic:external',
  savedIdentity: 'semantic:external'
})

const dirtyHistory = Object.freeze({
  canUndo: true,
  canRedo: false,
  dirty: true,
  headIdentity: 'semantic:local',
  savedIdentity: 'semantic:base'
})

function seed() {
  const store = useEditorStore()
  const tab = createDocumentState({
    filename: 'a.md',
    pathname: '/x/a.md',
    markdown: 'renderer cache',
    isSaved: true
  }, 'document:1')
  store.tabs = [tab]
  store.currentFile = tab
  store.updateTabIdToIndex()
  store.LISTEN_FOR_EXTERNAL_FILE_CHANGE()
  const listener = mocks.on.mock.calls.find(
    ([channel]) => channel === 'mt::document-core::external-change'
  )?.[1] as ((event: unknown, result: unknown) => void) | undefined
  if (listener === undefined) throw new Error('external change listener missing')
  return { store, tab, listener }
}

describe('renderer external-file notifications', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.stubGlobal('reportError', mocks.reportError)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('applies an identity-only clean reload result', () => {
    const { tab, listener } = seed()

    listener(null, {
      schema: 'document-core-file-reload-1',
      kind: 'reloaded',
      documentId: 'document:1',
      revisionId: 'revision:external',
      historyState: cleanHistory
    })

    expect(tab.documentCoreHistory).toEqual(cleanHistory)
    expect(tab.isSaved).toBe(true)
  })

  it('offers a closed identity-only decision for a dirty conflict', async() => {
    const { store, tab, listener } = seed()
    const notify = vi.spyOn(store, 'pushTabNotification')
    mocks.invoke.mockResolvedValue({
      schema: 'document-core-file-reload-1',
      kind: 'kept',
      documentId: 'document:1'
    })

    listener(null, {
      schema: 'document-core-file-reload-1',
      kind: 'conflict',
      documentId: 'document:1',
      revisionId: 'revision:local',
      historyState: dirtyHistory
    })
    const action = notify.mock.calls[0]?.[0].action
    action?.(false)
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      'mt::document-core::resolve-external-change',
      {
        documentId: 'document:1',
        resolution: 'keep'
      }
    ))

    expect(tab.isSaved).toBe(false)
    expect(mocks.invoke.mock.calls[0]?.[1]).not.toHaveProperty('source')
    expect(mocks.invoke.mock.calls[0]?.[1]).not.toHaveProperty('pathname')
  })

  it('rejects a forged source-bearing result before changing the tab', () => {
    const { tab, listener } = seed()

    listener(null, {
      schema: 'document-core-file-reload-1',
      kind: 'reloaded',
      documentId: 'document:1',
      revisionId: 'revision:external',
      historyState: cleanHistory,
      source: 'forged'
    })

    expect(tab.documentCoreHistory).toBeNull()
    expect(tab.markdown).toBe('renderer cache')
    expect(mocks.reportError).toHaveBeenCalledOnce()
  })
})
