import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import bus from '@/bus'

const mocks = vi.hoisted(() => ({
  debouncedSendBufferedState: vi.fn(),
  invoke: vi.fn(),
  reportError: vi.fn(),
  send: vi.fn(),
  sendBufferedState: vi.fn(),
  on: vi.fn()
}))

vi.hoisted(() => {
  const root = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (value: string) => string }
      fileUtils?: { isSamePathSync: (left: string, right: string) => boolean }
      electron?: { ipcRenderer: { invoke: Mock; on: Mock; send: Mock } }
    }
  }
  root.window ??= {}
  root.window.path ??= { sep: '/', dirname: value => value }
  root.window.fileUtils ??= { isSamePathSync: (left, right) => left === right }
  root.window.electron = {
    ipcRenderer: { invoke: mocks.invoke, on: mocks.on, send: mocks.send }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: mocks.debouncedSendBufferedState,
  sendBufferedState: mocks.sendBufferedState
}))

import { AsyncTaskError } from '@marktext/document-view'
import { createDocumentState } from '../../../src/renderer/src/store/help'
import { useEditorStore } from '../../../src/renderer/src/store/editor'

describe('editor close persistence failure', () => {
  const flushListeners: Array<(request: unknown) => void> = []

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.invoke.mockResolvedValue({
      schema: 'document-core-lifecycle-receipt-1',
      kind: 'completed',
      savedDocumentIds: [],
      closedDocumentIds: []
    })
    vi.stubGlobal('reportError', mocks.reportError)
  })

  afterEach(() => {
    for (const listener of flushListeners.splice(0)) {
      bus.off('flush-active-editor', listener)
    }
    vi.unstubAllGlobals()
  })

  it('reports the persistence failure before continuing the close flow', async() => {
    const cause = new Error('buffer store unavailable')
    mocks.sendBufferedState.mockRejectedValue(cause)
    const store = useEditorStore()
    store.LISTEN_FOR_CLOSE()
    const closeListener = mocks.on.mock.calls.find(([channel]) => channel === 'mt::ask-for-close')?.[1]

    expect(closeListener).toBeTypeOf('function')
    closeListener()
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.reportError).toHaveBeenCalledWith(expect.objectContaining({
      name: 'AsyncTaskError',
      message: expect.stringContaining(
        'Buffered state persistence before closing failed'
      ),
      cause
    }))
    expect(mocks.reportError.mock.calls[0]?.[0]).toBeInstanceOf(AsyncTaskError)
    expect(mocks.invoke).toHaveBeenCalledWith(
      'mt::document-core::lifecycle',
      { kind: 'close-window' }
    )
    expect(mocks.reportError.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.invoke.mock.invocationCallOrder.at(-1) ?? Number.POSITIVE_INFINITY
    )
  })

  it('asks main to resolve the whole window without a renderer dirty list', async() => {
    mocks.sendBufferedState.mockResolvedValue(undefined)
    const store = useEditorStore()
    const dirty = createDocumentState({
      pathname: '',
      filename: 'Untitled-1',
      markdown: 'renderer cache',
      isSaved: false
    }, 'document:dirty')
    store.tabs = [dirty]
    store.currentFile = dirty
    store.LISTEN_FOR_CLOSE()
    const closeListener = mocks.on.mock.calls.find(([channel]) => channel === 'mt::ask-for-close')?.[1]

    closeListener()
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.invoke).toHaveBeenCalledWith(
      'mt::document-core::lifecycle',
      { kind: 'close-window' }
    )
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('settles the active editor before sending semantic save-all intent', async() => {
    const store = useEditorStore()
    const savedEmpty = createDocumentState({
      pathname: '/tmp/empty.md',
      filename: 'empty.md',
      markdown: '',
      isSaved: true
    }, 'document:saved-empty')
    const dirty = createDocumentState({
      pathname: '/tmp/dirty.md',
      filename: 'dirty.md',
      markdown: '',
      isSaved: false
    }, 'document:dirty')
    store.tabs = [savedEmpty, dirty]
    store.currentFile = dirty
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

    store.ASK_FOR_SAVE_ALL(false)

    expect(mocks.invoke).not.toHaveBeenCalledWith(
      'mt::document-core::lifecycle',
      expect.anything()
    )
    finish?.()
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      'mt::document-core::lifecycle',
      { kind: 'save-all' }
    ))
    expect(mocks.send).not.toHaveBeenCalled()
    bus.off('flush-active-editor', listener)
  })

  it('settles active input before deciding whether a window can close', async() => {
    mocks.sendBufferedState.mockResolvedValue(undefined)
    const store = useEditorStore()
    const file = createDocumentState({
      pathname: '/tmp/note.md',
      filename: 'note.md',
      markdown: 'renderer cache',
      isSaved: true
    }, 'document:1')
    store.tabs = [file]
    store.currentFile = file
    let finish: (() => void) | undefined
    const listener = (rawRequest: unknown) => {
      const request = rawRequest as {
        defer: () => void
        complete: () => void
      }
      request.defer()
      finish = () => {
        file.isSaved = false
        request.complete()
      }
    }
    flushListeners.push(listener)
    bus.on('flush-active-editor', listener)
    store.LISTEN_FOR_CLOSE()
    const closeListener = mocks.on.mock.calls.find(
      ([channel]) => channel === 'mt::ask-for-close'
    )?.[1]

    closeListener()
    await Promise.resolve()
    expect(mocks.sendBufferedState).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()

    finish?.()
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      'mt::document-core::lifecycle',
      { kind: 'close-window' }
    ))
    bus.off('flush-active-editor', listener)
  })

  it('buffers UI metadata without document source or engine cursor state', () => {
    const store = useEditorStore()
    const file = createDocumentState({
      pathname: '/tmp/note.md',
      filename: 'note.md',
      markdown: 'must remain main-owned',
      isSaved: false
    }, 'document:1')
    store.tabs = [file]
    store.currentFile = file

    const snapshot = store.CREATE_BUFFERED_STATE()

    expect(snapshot).toEqual({
      currentDocumentId: 'document:1',
      tabs: [{
        documentId: 'document:1',
        scrollTop: 0
      }]
    })
  })
})
