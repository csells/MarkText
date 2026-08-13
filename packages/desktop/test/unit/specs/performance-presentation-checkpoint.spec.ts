import type { Page } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

import {
  captureExactCompositorPresentation,
  PERFORMANCE_PRESENTATION_BOUNDARY
} from '../../e2e/helpers/performancePresentationCheckpoint'
import {
  captureBrowserInputEventPresentation
} from '../../e2e/helpers/browserInputEventTrace'
import {
  captureInputLatencyPresentation
} from '../../e2e/helpers/inputLatencyTrace'

describe('hidden compositor presentation checkpoint', () => {
  it('captures one compositor surface and validates the retained checkpoint', async() => {
    const order: string[] = []
    const session = {
      send: vi.fn(async(method: string, params: unknown) => {
        order.push(`send:${method}`)
        expect(params).toEqual({
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: false
        })
        return { data: 'captured-png' }
      }),
      detach: vi.fn(async() => { order.push('detach') })
    }
    const page = {
      context: () => ({
        newCDPSession: vi.fn(async() => {
          order.push('attach')
          return session
        })
      })
    } as unknown as Page

    await expect(captureExactCompositorPresentation(page, {
      readAcknowledged: async() => {
        order.push('read-acknowledged')
        return {
          tEvent: 100,
          tAcknowledged: 104,
          expectedCheckpoint: { length: 12, hash: 'deadbeef' },
          acknowledgedCheckpoint: { length: 12, hash: 'deadbeef' }
        }
      },
      readPresented: async() => {
        order.push('read-presented')
        return {
          observedAt: 118,
          checkpoint: { length: 12, hash: 'deadbeef' }
        }
      }
    })).resolves.toEqual({
      boundary: PERFORMANCE_PRESENTATION_BOUNDARY,
      tEvent: 100,
      tAcknowledged: 104,
      tPresented: 118,
      t_echo: 4,
      t_present: 18
    })
    expect(order).toEqual([
      'read-acknowledged',
      'attach',
      'send:Page.captureScreenshot',
      'read-presented',
      'detach'
    ])
  })

  it('rejects a view checkpoint that changes across compositor capture', async() => {
    const detach = vi.fn(async() => {})
    const page = {
      context: () => ({
        newCDPSession: async() => ({
          send: async() => ({ data: 'captured-png' }),
          detach
        })
      })
    } as unknown as Page

    await expect(captureExactCompositorPresentation(page, {
      readAcknowledged: async() => ({
        tEvent: 100,
        tAcknowledged: 104,
        expectedCheckpoint: { length: 12, hash: 'deadbeef' },
        acknowledgedCheckpoint: { length: 12, hash: 'deadbeef' }
      }),
      readPresented: async() => ({
        observedAt: 118,
        checkpoint: { length: 13, hash: 'cafebabe' }
      })
    })).rejects.toMatchObject({ code: 'checkpoint-changed' })
    expect(detach).toHaveBeenCalledOnce()
  })

  it('fails one compositor capture at the exact deadline without retrying', async() => {
    vi.useFakeTimers()
    const send = vi.fn(() => new Promise<never>(() => {}))
    const detach = vi.fn(async() => {})
    const page = {
      context: () => ({
        newCDPSession: async() => ({ send, detach })
      })
    } as unknown as Page
    try {
      const presentation = captureExactCompositorPresentation(page, {
        readAcknowledged: async() => ({
          tEvent: 100,
          tAcknowledged: 104,
          expectedCheckpoint: { length: 12, hash: 'deadbeef' },
          acknowledgedCheckpoint: { length: 12, hash: 'deadbeef' }
        }),
        readPresented: async() => {
          throw new Error('A timed-out capture must not be admitted')
        }
      }, 30_000)
      const rejected = expect(presentation).rejects.toMatchObject({
        code: 'deadline-exceeded'
      })
      await vi.advanceTimersByTimeAsync(29_995)
      expect(detach).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await rejected
      expect(send).toHaveBeenCalledOnce()
      expect(detach).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds post-capture checkpoint validation inside the same exact deadline', async() => {
    vi.useFakeTimers()
    const detach = vi.fn(async() => {})
    const page = {
      context: () => ({
        newCDPSession: async() => ({
          send: async() => ({ data: 'captured-png' }),
          detach
        })
      })
    } as unknown as Page
    try {
      const presentation = captureExactCompositorPresentation(page, {
        readAcknowledged: async() => ({
          tEvent: 100,
          tAcknowledged: 104,
          expectedCheckpoint: { length: 12, hash: 'deadbeef' },
          acknowledgedCheckpoint: { length: 12, hash: 'deadbeef' }
        }),
        readPresented: () => new Promise<never>(() => {})
      }, 30_000)
      const rejected = expect(presentation).rejects.toMatchObject({
        code: 'deadline-exceeded'
      })
      await vi.advanceTimersByTimeAsync(29_996)
      await rejected
      expect(detach).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a completed capture observed after the input deadline', async() => {
    const page = {
      context: () => ({
        newCDPSession: async() => ({
          send: async() => ({ data: 'captured-png' }),
          detach: async() => {}
        })
      })
    } as unknown as Page

    await expect(captureExactCompositorPresentation(page, {
      readAcknowledged: async() => ({
        tEvent: 100,
        tAcknowledged: 104,
        expectedCheckpoint: { length: 12, hash: 'deadbeef' },
        acknowledgedCheckpoint: { length: 12, hash: 'deadbeef' }
      }),
      readPresented: async() => ({
        observedAt: 30_101,
        checkpoint: { length: 12, hash: 'deadbeef' }
      })
    }, 30_000)).rejects.toMatchObject({ code: 'deadline-exceeded' })
  })

  it('surfaces one failed capture with its cause after detaching', async() => {
    const cause = new Error('Page.captureScreenshot unavailable')
    const detach = vi.fn(async() => {})
    const page = {
      context: () => ({
        newCDPSession: async() => ({
          send: async() => { throw cause },
          detach
        })
      })
    } as unknown as Page

    await expect(captureExactCompositorPresentation(page, {
      readAcknowledged: async() => ({
        tEvent: 100,
        tAcknowledged: 104,
        expectedCheckpoint: { length: 12, hash: 'deadbeef' },
        acknowledgedCheckpoint: { length: 12, hash: 'deadbeef' }
      }),
      readPresented: async() => {
        throw new Error('Failed capture must not be admitted')
      }
    })).rejects.toMatchObject({ code: 'capture-failed', cause })
    expect(detach).toHaveBeenCalledOnce()
  })

  it('types an empty compositor capture as capture-failed', async() => {
    const page = {
      context: () => ({
        newCDPSession: async() => ({
          send: async() => ({ data: '' }),
          detach: async() => {}
        })
      })
    } as unknown as Page
    const checkpoint = { length: 12, hash: 'deadbeef' }

    await expect(captureExactCompositorPresentation(page, {
      readAcknowledged: async() => ({
        tEvent: 100,
        tAcknowledged: 104,
        expectedCheckpoint: checkpoint,
        acknowledgedCheckpoint: checkpoint
      }),
      readPresented: async() => ({ observedAt: 118, checkpoint })
    })).rejects.toMatchObject({ code: 'capture-failed' })
  })

  it('preserves a primary typed failure when CDP detach also fails', async() => {
    const detachCause = new Error('detach unavailable')
    const page = {
      context: () => ({
        newCDPSession: async() => ({
          send: async() => ({ data: 'captured-png' }),
          detach: async() => { throw detachCause }
        })
      })
    } as unknown as Page

    await expect(captureExactCompositorPresentation(page, {
      readAcknowledged: async() => ({
        tEvent: 100,
        tAcknowledged: 104,
        expectedCheckpoint: { length: 12, hash: 'deadbeef' },
        acknowledgedCheckpoint: { length: 12, hash: 'deadbeef' }
      }),
      readPresented: async() => ({
        observedAt: 118,
        checkpoint: { length: 13, hash: 'cafebabe' }
      })
    })).rejects.toMatchObject({ code: 'checkpoint-changed' })
  })

  it('surfaces CDP detach failure when capture and checkpoint succeed', async() => {
    const detachCause = new Error('detach unavailable')
    const checkpoint = { length: 12, hash: 'deadbeef' }
    const page = {
      context: () => ({
        newCDPSession: async() => ({
          send: async() => ({ data: 'captured-png' }),
          detach: async() => { throw detachCause }
        })
      })
    } as unknown as Page

    await expect(captureExactCompositorPresentation(page, {
      readAcknowledged: async() => ({
        tEvent: 100,
        tAcknowledged: 104,
        expectedCheckpoint: checkpoint,
        acknowledgedCheckpoint: checkpoint
      }),
      readPresented: async() => ({ observedAt: 118, checkpoint })
    })).rejects.toMatchObject({ code: 'capture-failed', cause: detachCause })
  })

  it.each([
    {
      label: 'WYSIWYG',
      capture: captureInputLatencyPresentation,
      checkpoint: { targetIndex: 2, textLength: 8, textHash: 'deadbeef' }
    },
    {
      label: 'Source',
      capture: captureBrowserInputEventPresentation,
      checkpoint: { valueLength: 8, valueHash: 'deadbeef' }
    }
  ])('maps the $label exact-echo adapter to the shared compositor seam', async({
    capture,
    checkpoint
  }) => {
    const detach = vi.fn(async() => {})
    const evaluate = vi.fn()
      .mockResolvedValueOnce({
        tEvent: 100,
        tAcknowledged: 104,
        expectedCheckpoint: checkpoint,
        acknowledgedCheckpoint: checkpoint
      })
      .mockResolvedValueOnce({ observedAt: 118, checkpoint })
    const page = {
      evaluate,
      context: () => ({
        newCDPSession: async() => ({
          send: async() => ({ data: 'captured-png' }),
          detach
        })
      })
    } as unknown as Page

    await expect(capture(page, 0, 30_000)).resolves.toEqual({
      sequence: 1,
      tEvent: 100,
      tEcho: 104,
      tPresent: 118
    })
    expect(evaluate).toHaveBeenCalledTimes(2)
    expect(detach).toHaveBeenCalledOnce()
  })
})
