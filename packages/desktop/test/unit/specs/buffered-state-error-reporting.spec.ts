import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  reportError: vi.fn()
}))

vi.mock('@/store/editor', () => ({
  useEditorStore: () => ({
    CREATE_BUFFERED_STATE: () => ({ editor: { tabs: [] } })
  })
}))
vi.mock('@/store/project', () => ({
  useProjectStore: () => ({ CREATE_BUFFERED_STATE: () => ({}) })
}))
vi.mock('@/store/layout', () => ({
  useLayoutStore: () => ({ CREATE_BUFFERED_STATE: () => ({}) })
}))

import { AsyncTaskError } from '../../../../muya/src/utils/asyncTask'
import { debouncedSendBufferedState } from '../../../src/renderer/src/store/bufferedState'

describe('buffered state error reporting', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.invoke.mockReset()
    mocks.reportError.mockReset()
    vi.stubGlobal('reportError', mocks.reportError)
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { ipcRenderer: { invoke: mocks.invoke } }
    })
  })

  afterEach(() => {
    debouncedSendBufferedState.cancel()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reports a failed debounced persistence attempt with context', async() => {
    const cause = new Error('buffer store unavailable')
    mocks.invoke.mockRejectedValue(cause)

    debouncedSendBufferedState()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(mocks.reportError).toHaveBeenCalledOnce()
    expect(mocks.reportError).toHaveBeenCalledWith(expect.objectContaining({
      name: 'AsyncTaskError',
      message: 'Buffered state persistence failed.',
      cause
    }))
    expect(mocks.reportError.mock.calls[0]?.[0]).toBeInstanceOf(AsyncTaskError)
  })

  it('turns a synchronous persistence failure into the same reported rejection', async() => {
    const cause = new Error('snapshot is not serializable')
    mocks.invoke.mockImplementation(() => {
      throw cause
    })

    debouncedSendBufferedState()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(mocks.reportError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Buffered state persistence failed.',
      cause
    }))
  })
})
