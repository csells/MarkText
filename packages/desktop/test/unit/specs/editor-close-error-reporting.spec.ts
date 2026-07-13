import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  debouncedSendBufferedState: vi.fn(),
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
    ipcRenderer: { invoke: vi.fn(), on: mocks.on, send: mocks.send }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: mocks.debouncedSendBufferedState,
  sendBufferedState: mocks.sendBufferedState
}))

import { AsyncTaskError } from '../../../../muya/src/utils/asyncTask'
import { useEditorStore } from '../../../src/renderer/src/store/editor'

describe('editor close persistence failure', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.stubGlobal('reportError', mocks.reportError)
  })

  afterEach(() => {
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
      message: 'Buffered state persistence before closing failed.',
      cause
    }))
    expect(mocks.reportError.mock.calls[0]?.[0]).toBeInstanceOf(AsyncTaskError)
    expect(mocks.send).toHaveBeenCalledWith('mt::close-window')
    expect(mocks.reportError.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.send.mock.invocationCallOrder.at(-1) ?? Number.POSITIVE_INFINITY
    )
  })
})
