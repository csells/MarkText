import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import bus from '@/bus'
import { createDocumentState } from '@/store/help'
import { useEditorStore } from '@/store/editor'

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
        process: { env: Record<string, string> }
      }
    }
  }
  target.window ??= {}
  target.window.path ??= {
    sep: '/',
    dirname: pathname => pathname
  }
  target.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: {
      send: () => {},
      on: () => {},
      invoke: async() => undefined
    },
    process: { env: {} }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

function seed(pathname = '/tmp/note.md') {
  const store = useEditorStore()
  const file = createDocumentState({
    filename: 'note.md',
    pathname,
    markdown: 'renderer cache is not a save payload',
    isSaved: false
  }, 'document:1')
  store.currentFile = file
  store.tabs = [file]
  store.updateTabIdToIndex()
  return store
}

describe('editor save requests', () => {
  const flushListeners: Array<(request: unknown) => void> = []

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    for (const listener of flushListeners.splice(0)) {
      bus.off('flush-active-editor', listener)
    }
    vi.useRealTimers()
  })

  it('waits for unsettled editor input, then sends only identity and save mode', async() => {
    const store = seed()
    let finish: (() => void) | undefined
    const listener = (rawRequest: unknown) => {
      const request = rawRequest as {
        defer: () => void
        complete: () => void
      }
      request.defer()
      finish = request.complete
    }
    flushListeners.push(listener)
    bus.on('flush-active-editor', listener)
    const invoke = vi.spyOn(window.electron.ipcRenderer, 'invoke')
      .mockResolvedValue({ kind: 'cancelled', documentId: 'document:1' })

    store.FILE_SAVE()
    expect(invoke).not.toHaveBeenCalled()
    finish?.()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'mt::document-core::save',
      { documentId: 'document:1', mode: 'save' }
    ))
    expect(invoke.mock.calls[0]?.[1]).not.toHaveProperty('markdown')
    expect(invoke.mock.calls[0]?.[1]).not.toHaveProperty('revisionId')
    bus.off('flush-active-editor', listener)
  })

  it('requests save-as without renderer path, bytes, or file policy', async() => {
    const store = seed()
    const invoke = vi.spyOn(window.electron.ipcRenderer, 'invoke')
      .mockResolvedValue({ kind: 'cancelled', documentId: 'document:1' })

    store.FILE_SAVE_AS()

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'mt::document-core::save',
      { documentId: 'document:1', mode: 'save-as' }
    ))
  })

  it('autosaves through the same closed main transaction', async() => {
    vi.useFakeTimers()
    const store = seed()
    let finish: (() => void) | undefined
    const listener = (rawRequest: unknown) => {
      const request = rawRequest as {
        defer: () => void
        complete: () => void
      }
      request.defer()
      finish = request.complete
    }
    flushListeners.push(listener)
    bus.on('flush-active-editor', listener)
    const invoke = vi.spyOn(window.electron.ipcRenderer, 'invoke')
      .mockResolvedValue({
        schema: 'document-core-save-receipt-1',
        kind: 'written',
        documentId: 'document:1'
      })

    store.HANDLE_AUTO_SAVE({
      id: 'document:1',
      pathname: '/tmp/note.md'
    })
    await vi.runAllTimersAsync()

    expect(invoke).not.toHaveBeenCalled()
    finish?.()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'mt::document-core::save',
      { documentId: 'document:1', mode: 'autosave' }
    ))
    expect(invoke).toHaveBeenCalledWith(
      'mt::document-core::save',
      { documentId: 'document:1', mode: 'autosave' }
    )
    bus.off('flush-active-editor', listener)
  })

  it.each([
    ['move', (store: ReturnType<typeof useEditorStore>) =>
      store.MOVE_FILE_TO()],
    ['rename', (store: ReturnType<typeof useEditorStore>) =>
      store.RESPONSE_FOR_RENAME()]
  ])('routes untitled %s through the closed save transaction', async(
    _label,
    act
  ) => {
    const store = seed('')
    const invoke = vi.spyOn(window.electron.ipcRenderer, 'invoke')
      .mockResolvedValue({ kind: 'cancelled', documentId: 'document:1' })

    act(store)

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'mt::document-core::save',
      { documentId: 'document:1', mode: 'save' }
    ))
  })
})
