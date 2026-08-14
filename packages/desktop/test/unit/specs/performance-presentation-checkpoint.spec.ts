import type { ElectronApplication, Page } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

import {
  bindExactElectronPageCapture,
  captureExactCompositorPresentation,
  captureInstalledElectronHiddenPage,
  PERFORMANCE_PRESENTATION_BOUNDARY,
  type PerformanceHiddenPageCapture
} from '../../e2e/helpers/performancePresentationCheckpoint'
import {
  captureBrowserInputEventPresentation
} from '../../e2e/helpers/browserInputEventTrace'
import {
  captureInputLatencyPresentation
} from '../../e2e/helpers/inputLatencyTrace'

const acknowledged = Object.freeze({
  tEvent: 100,
  tAcknowledged: 104,
  expectedCheckpoint: Object.freeze({ length: 12, hash: 'deadbeef' }),
  acknowledgedCheckpoint: Object.freeze({ length: 12, hash: 'deadbeef' })
})

const capture = (
  result: Readonly<{ readonly empty: boolean }> = { empty: false }
): PerformanceHiddenPageCapture => vi.fn(async() => result)

describe('hidden compositor presentation checkpoint', () => {
  it('binds the exact renderer target before measuring and always detaches', async() => {
    const order: string[] = []
    const targetCapture = vi.fn(async(targetId: string) => {
      order.push(`capture:${targetId}`)
      return Object.freeze({ empty: false })
    })
    const session = {
      send: vi.fn(async(method: string) => {
        order.push(`send:${method}`)
        return { targetInfo: { targetId: 'renderer-target-7' } }
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

    const bound = await bindExactElectronPageCapture(page, targetCapture)
    await expect(bound()).resolves.toEqual({ empty: false })
    expect(order).toEqual([
      'attach',
      'send:Target.getTargetInfo',
      'detach',
      'capture:renderer-target-7'
    ])
  })

  it('preserves target lookup failure when CDP detach also fails', async() => {
    const lookupCause = new Error('target lookup unavailable')
    const page = {
      context: () => ({
        newCDPSession: async() => ({
          send: async() => { throw lookupCause },
          detach: async() => { throw new Error('detach unavailable') }
        })
      })
    } as unknown as Page

    await expect(bindExactElectronPageCapture(page, vi.fn()))
      .rejects.toMatchObject({ code: 'capture-failed', cause: lookupCause })
  })

  it('types target-session attachment failure as capture-failed', async() => {
    const cause = new Error('CDP session unavailable')
    const page = {
      context: () => ({
        newCDPSession: async() => { throw cause }
      })
    } as unknown as Page

    await expect(bindExactElectronPageCapture(page, vi.fn()))
      .rejects.toMatchObject({ code: 'capture-failed', cause })
  })

  it('surfaces target-session detach failure when lookup succeeds', async() => {
    const detachCause = new Error('detach unavailable')
    const page = {
      context: () => ({
        newCDPSession: async() => ({
          send: async() => ({ targetInfo: { targetId: 'renderer-target-7' } }),
          detach: async() => { throw detachCause }
        })
      })
    } as unknown as Page

    await expect(bindExactElectronPageCapture(page, vi.fn()))
      .rejects.toMatchObject({ code: 'capture-failed', cause: detachCause })
  })

  it('resolves the exact Electron window and uses hidden capture options', async() => {
    const exactContents = {
      isDestroyed: () => false,
      capturePage: vi.fn(async(
        rect: unknown,
        options: Readonly<Record<string, boolean>>
      ) => {
        expect(rect).toBeUndefined()
        expect(options).toEqual({ stayHidden: true, stayAwake: true })
        return { isEmpty: () => false }
      })
    }
    const otherContents = { isDestroyed: () => false }
    const exactWindow = {
      isDestroyed: () => false,
      isVisible: () => true,
      getOpacity: () => 0,
      isFocused: () => false,
      isFocusable: () => false,
      isAlwaysOnTop: () => false,
      isVisibleOnAllWorkspaces: () => true,
      isHiddenInMissionControl: () => true
    }
    const application = {
      evaluate: vi.fn(async(
        evaluator: (electron: unknown, input: unknown) => Promise<unknown>,
        input: unknown
      ) => evaluator({
        app: { isActive: () => false },
        BrowserWindow: {
          getAllWindows: () => [{ webContents: otherContents }],
          fromWebContents: (contents: unknown) =>
            contents === exactContents ? exactWindow : undefined
        },
        webContents: {
          fromDevToolsTargetId: (targetId: string) =>
            targetId === 'renderer-target-7' ? exactContents : undefined
        }
      }, input))
    } as unknown as ElectronApplication

    await expect(captureInstalledElectronHiddenPage(
      application,
      'renderer-target-7'
    )).resolves.toEqual({ empty: false })
    expect(exactContents.capturePage).toHaveBeenCalledOnce()
  })

  it('refuses compositor capture when the exact window is not in every Space', async() => {
    const capturePage = vi.fn(async() => ({ isEmpty: () => false }))
    const contents = { isDestroyed: () => false, capturePage }
    const application = {
      evaluate: async(
        evaluator: (electron: unknown, input: unknown) => Promise<unknown>,
        input: unknown
      ) => evaluator({
        app: { isActive: () => false },
        BrowserWindow: {
          fromWebContents: () => ({
            isDestroyed: () => false,
            isVisible: () => true,
            getOpacity: () => 0,
            isFocused: () => false,
            isFocusable: () => false,
            isAlwaysOnTop: () => false,
            isVisibleOnAllWorkspaces: () => false,
            isHiddenInMissionControl: () => true
          })
        },
        webContents: { fromDevToolsTargetId: () => contents }
      }, input)
    } as unknown as ElectronApplication

    await expect(captureInstalledElectronHiddenPage(
      application,
      'renderer-target-7'
    )).rejects.toThrow(/transparent render-active inactive state/i)
    expect(capturePage).not.toHaveBeenCalled()
  })

  it('captures one hidden compositor surface then validates retained state', async() => {
    const order: string[] = []
    const hiddenCapture: PerformanceHiddenPageCapture = vi.fn(async() => {
      order.push('capture-hidden-page')
      return { empty: false }
    })

    await expect(captureExactCompositorPresentation(hiddenCapture, {
      readAcknowledged: async() => {
        order.push('read-acknowledged')
        return acknowledged
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
      'capture-hidden-page',
      'read-presented'
    ])
  })

  it('rejects a view checkpoint that changes across compositor capture', async() => {
    await expect(captureExactCompositorPresentation(capture(), {
      readAcknowledged: async() => acknowledged,
      readPresented: async() => ({
        observedAt: 118,
        checkpoint: { length: 13, hash: 'cafebabe' }
      })
    })).rejects.toMatchObject({ code: 'checkpoint-changed' })
  })

  it('fails one hidden compositor capture at the exact deadline without retrying', async() => {
    vi.useFakeTimers()
    const hiddenCapture = vi.fn(() => new Promise<never>(() => {}))
    try {
      const presentation = captureExactCompositorPresentation(hiddenCapture, {
        readAcknowledged: async() => acknowledged,
        readPresented: async() => {
          throw new Error('A timed-out capture must not be admitted')
        }
      }, 30_000)
      const rejected = expect(presentation).rejects.toMatchObject({
        code: 'deadline-exceeded'
      })
      await vi.advanceTimersByTimeAsync(29_995)
      await vi.advanceTimersByTimeAsync(1)
      await rejected
      expect(hiddenCapture).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds post-capture checkpoint validation inside the same exact deadline', async() => {
    vi.useFakeTimers()
    try {
      const presentation = captureExactCompositorPresentation(capture(), {
        readAcknowledged: async() => acknowledged,
        readPresented: () => new Promise<never>(() => {})
      }, 30_000)
      const rejected = expect(presentation).rejects.toMatchObject({
        code: 'deadline-exceeded'
      })
      await vi.advanceTimersByTimeAsync(29_996)
      await rejected
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a completed capture observed after the input deadline', async() => {
    await expect(captureExactCompositorPresentation(capture(), {
      readAcknowledged: async() => acknowledged,
      readPresented: async() => ({
        observedAt: 30_101,
        checkpoint: { length: 12, hash: 'deadbeef' }
      })
    }, 30_000)).rejects.toMatchObject({ code: 'deadline-exceeded' })
  })

  it('surfaces one failed hidden capture with its cause', async() => {
    const cause = new Error('capturePage unavailable')
    await expect(captureExactCompositorPresentation(
      vi.fn(async() => { throw cause }),
      {
        readAcknowledged: async() => acknowledged,
        readPresented: async() => {
          throw new Error('Failed capture must not be admitted')
        }
      }
    )).rejects.toMatchObject({ code: 'capture-failed', cause })
  })

  it('types an empty NativeImage as capture-failed', async() => {
    await expect(captureExactCompositorPresentation(capture({ empty: true }), {
      readAcknowledged: async() => acknowledged,
      readPresented: async() => ({
        observedAt: 118,
        checkpoint: acknowledged.expectedCheckpoint
      })
    })).rejects.toMatchObject({ code: 'capture-failed' })
  })

  it('carries Electron NativeImage emptiness into the typed transaction', async() => {
    const contents = {
      isDestroyed: () => false,
      capturePage: async() => ({ isEmpty: () => true })
    }
    const application = {
      evaluate: async(
        evaluator: (electron: unknown, input: unknown) => Promise<unknown>,
        input: unknown
      ) => evaluator({
        app: { isActive: () => false },
        BrowserWindow: {
          fromWebContents: () => ({
            isDestroyed: () => false,
            isVisible: () => true,
            getOpacity: () => 0,
            isFocused: () => false,
            isFocusable: () => false,
            isAlwaysOnTop: () => false
          })
        },
        webContents: { fromDevToolsTargetId: () => contents }
      }, input)
    } as unknown as ElectronApplication

    await expect(captureExactCompositorPresentation(
      () => captureInstalledElectronHiddenPage(application, 'renderer-target-7'),
      {
        readAcknowledged: async() => acknowledged,
        readPresented: async() => ({
          observedAt: 118,
          checkpoint: acknowledged.expectedCheckpoint
        })
      }
    )).rejects.toMatchObject({ code: 'capture-failed' })
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
    capture: captureTrace,
    checkpoint
  }) => {
    const hiddenCapture = capture()
    const evaluate = vi.fn()
      .mockResolvedValueOnce({
        tEvent: 100,
        tAcknowledged: 104,
        expectedCheckpoint: checkpoint,
        acknowledgedCheckpoint: checkpoint
      })
      .mockResolvedValueOnce({ observedAt: 118, checkpoint })
    const page = { evaluate } as unknown as Page

    await expect(captureTrace(page, hiddenCapture, 0, 30_000)).resolves.toEqual({
      sequence: 1,
      tEvent: 100,
      tEcho: 104,
      tPresent: 118
    })
    expect(evaluate).toHaveBeenCalledTimes(2)
    expect(hiddenCapture).toHaveBeenCalledOnce()
  })
})
