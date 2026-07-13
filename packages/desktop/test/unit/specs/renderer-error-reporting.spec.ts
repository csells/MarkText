import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportAsyncTask } from '../../../../muya/src/utils/asyncTask'
import { createRendererErrorHandler } from '../../../src/renderer/src/rendererError'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('renderer error reporting', () => {
  it('routes PromiseRejectionEvent.reason through the IPC reporter', () => {
    const send = vi.fn()
    const log = vi.fn()
    const cause = new Error('clipboard read failed')
    const event = Object.assign(new Event('unhandledrejection'), {
      reason: cause
    })
    const handler = createRendererErrorHandler({
      shouldSuppress: () => false,
      log,
      send,
      warn: vi.fn(),
      fallback: vi.fn()
    })

    handler(event)

    expect(log).toHaveBeenCalledWith(cause)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      message: 'clipboard read failed',
      name: 'Error'
    }))
  })

  it('normalizes non-Error rejection reasons instead of dropping them', () => {
    const send = vi.fn()
    const handler = createRendererErrorHandler({
      shouldSuppress: () => false,
      log: vi.fn(),
      send,
      warn: vi.fn(),
      fallback: vi.fn()
    })

    handler(Object.assign(new Event('unhandledrejection'), {
      reason: { code: 'E_IMAGE', retryable: false }
    }))

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('E_IMAGE'),
      name: 'RendererFailure'
    }))
  })

  it('preserves an async task cause through the global error event and IPC payload', async() => {
    const send = vi.fn()
    const handler = createRendererErrorHandler({
      shouldSuppress: () => false,
      log: vi.fn(),
      send,
      warn: vi.fn(),
      fallback: vi.fn()
    })
    vi.stubGlobal('reportError', (error: unknown) => {
      handler(Object.assign(new Event('error'), { error }))
    })

    const cause = new Error('disk quota exceeded')
    reportAsyncTask(Promise.reject(cause), 'Buffered state persistence')
    await Promise.resolve()
    await Promise.resolve()

    expect(send).toHaveBeenCalledWith({
      message: 'Buffered state persistence failed.',
      name: 'AsyncTaskError',
      stack: expect.any(String),
      cause: expect.objectContaining({
        message: 'disk quota exceeded',
        name: 'Error',
        stack: expect.any(String)
      })
    })
  })
})
