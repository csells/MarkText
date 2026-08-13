import { isDeepStrictEqual } from 'node:util'
import type { CDPSession, ElectronApplication, Page } from 'playwright'

export const PERFORMANCE_PRESENTATION_BOUNDARY =
  'electron-webcontents-capture-page-transparent-v2' as const

export const PERFORMANCE_PRESENTATION_CAPTURE_OPTIONS = Object.freeze({
  stayHidden: true,
  stayAwake: true
})

export type PerformancePresentationCheckpointErrorCode =
  | 'checkpoint-changed'
  | 'deadline-exceeded'
  | 'capture-failed'

export class PerformancePresentationCheckpointError extends Error {
  readonly code: PerformancePresentationCheckpointErrorCode
  override readonly cause?: unknown

  constructor(
    code: PerformancePresentationCheckpointErrorCode,
    message: string,
    cause?: unknown
  ) {
    super(message)
    this.name = 'PerformancePresentationCheckpointError'
    this.code = code
    this.cause = cause
  }
}

export interface PerformancePresentationCheckpointAdapter<Checkpoint> {
  readonly readAcknowledged: () => Promise<Readonly<{
    readonly tEvent: number
    readonly tAcknowledged: number
    readonly expectedCheckpoint: Checkpoint
    readonly acknowledgedCheckpoint: Checkpoint
  }>>
  readonly readPresented: () => Promise<Readonly<{
    readonly observedAt: number
    readonly checkpoint: Checkpoint
  }>>
}

export interface PerformanceHiddenPageCaptureResult {
  readonly empty: boolean
}

export type PerformanceHiddenPageCapture =
  () => Promise<Readonly<PerformanceHiddenPageCaptureResult>>

export type PerformanceHiddenPageTargetCapture = (
  targetId: string
) => Promise<Readonly<PerformanceHiddenPageCaptureResult>>

export interface PerformancePresentationCheckpointResult {
  readonly boundary: typeof PERFORMANCE_PRESENTATION_BOUNDARY
  readonly tEvent: number
  readonly tAcknowledged: number
  readonly tPresented: number
  readonly t_echo: number
  readonly t_present: number
}

const captureFailure = (message: string, cause?: unknown) =>
  new PerformancePresentationCheckpointError('capture-failed', message, cause)

/**
 * Resolves the exact renderer DevTools target outside the timed sample. The
 * target remains authoritative at capture time because the main-process
 * adapter resolves WebContents from this ID for every capture.
 */
export const resolveExactElectronPageTargetId = async(
  page: Page
): Promise<string> => {
  let session: CDPSession
  try {
    session = await page.context().newCDPSession(page)
  } catch (cause) {
    throw captureFailure(
      'Exact Electron renderer target session attachment failed',
      cause
    )
  }
  let targetId: string
  try {
    const response = await session.send('Target.getTargetInfo')
    const candidate = response.targetInfo.targetId
    if (typeof candidate !== 'string' || candidate.length === 0) {
      throw new Error('Renderer DevTools target ID is missing')
    }
    targetId = candidate
  } catch (primaryFailure) {
    try {
      await session.detach()
    } catch {}
    throw captureFailure(
      'Exact Electron renderer target lookup failed',
      primaryFailure
    )
  }
  try {
    await session.detach()
  } catch (detachError) {
    throw captureFailure(
      'Exact Electron renderer target session detach failed',
      detachError
    )
  }
  return targetId
}

export const bindExactElectronPageCapture = async(
  page: Page,
  captureTarget: PerformanceHiddenPageTargetCapture
): Promise<PerformanceHiddenPageCapture> => {
  const targetId = await resolveExactElectronPageTargetId(page)
  return () => captureTarget(targetId)
}

/** Runs inside the installed Electron main process via Playwright. */
export const captureInstalledElectronHiddenPage = async(
  application: ElectronApplication,
  targetId: string
): Promise<Readonly<PerformanceHiddenPageCaptureResult>> =>
  application.evaluate(
    async({ app, BrowserWindow, webContents }, input) => {
      const contents = webContents.fromDevToolsTargetId(input.targetId)
      if (contents === undefined || contents.isDestroyed()) {
        throw new Error('Measured renderer WebContents is unavailable')
      }
      const window = BrowserWindow.fromWebContents(contents)
      if (window === null || window.isDestroyed()) {
        throw new Error('Measured renderer BrowserWindow is unavailable')
      }
      if (
        !window.isVisible() || window.getOpacity() !== 0 ||
        window.isFocused() || window.isFocusable() ||
        window.isAlwaysOnTop() || app.isActive()
      ) {
        throw new Error(
          'Measured renderer is not in transparent render-active inactive state'
        )
      }
      const image = await contents.capturePage(undefined, input.options)
      return Object.freeze({ empty: image.isEmpty() })
    },
    {
      targetId,
      options: PERFORMANCE_PRESENTATION_CAPTURE_OPTIONS
    }
  )

export const captureExactCompositorPresentation = async<Checkpoint>(
  capturePage: PerformanceHiddenPageCapture,
  adapter: PerformancePresentationCheckpointAdapter<Checkpoint>,
  timeout = 30_000
): Promise<Readonly<PerformancePresentationCheckpointResult>> => {
  const acknowledged = await adapter.readAcknowledged()
  if (!isDeepStrictEqual(
    acknowledged.expectedCheckpoint,
    acknowledged.acknowledgedCheckpoint
  )) {
    throw new PerformancePresentationCheckpointError(
      'checkpoint-changed',
      'Acknowledged presentation checkpoint differs'
    )
  }
  if (
    !Number.isFinite(acknowledged.tEvent) || acknowledged.tEvent < 0 ||
    !Number.isFinite(acknowledged.tAcknowledged) ||
    acknowledged.tAcknowledged < acknowledged.tEvent
  ) {
    throw new Error('Compositor presentation timestamp order is invalid')
  }
  const remaining = timeout - (
    acknowledged.tAcknowledged - acknowledged.tEvent
  )
  if (remaining <= 0) {
    throw new PerformancePresentationCheckpointError(
      'deadline-exceeded',
      `Compositor presentation acknowledgement reached the ${String(timeout)}ms deadline`
    )
  }

  let deadline: ReturnType<typeof setTimeout> | undefined
  const presented = await (async() => {
    try {
      return await Promise.race([
        (async() => {
          const capture = await capturePage()
          if (capture.empty) {
            throw captureFailure('Compositor presentation NativeImage is empty')
          }
          return adapter.readPresented()
        })(),
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => reject(
            new PerformancePresentationCheckpointError(
              'deadline-exceeded',
              `Compositor presentation transaction exceeded ${String(timeout)}ms`
            )
          ), remaining)
        })
      ])
    } catch (cause) {
      if (cause instanceof PerformancePresentationCheckpointError) throw cause
      throw captureFailure('Compositor presentation capture failed', cause)
    } finally {
      if (deadline !== undefined) clearTimeout(deadline)
    }
  })()
  if (!isDeepStrictEqual(
    acknowledged.expectedCheckpoint,
    presented.checkpoint
  )) {
    throw new PerformancePresentationCheckpointError(
      'checkpoint-changed',
      'Presented checkpoint differs after compositor capture'
    )
  }
  const elapsed = presented.observedAt - acknowledged.tEvent
  if (
    !Number.isFinite(presented.observedAt) ||
    presented.observedAt < acknowledged.tAcknowledged
  ) throw new Error('Compositor presentation timestamp order is invalid')
  if (elapsed > timeout) {
    throw new PerformancePresentationCheckpointError(
      'deadline-exceeded',
      `Compositor presentation completed after ${String(elapsed)}ms`
    )
  }
  return Object.freeze({
    boundary: PERFORMANCE_PRESENTATION_BOUNDARY,
    tEvent: acknowledged.tEvent,
    tAcknowledged: acknowledged.tAcknowledged,
    tPresented: presented.observedAt,
    t_echo: acknowledged.tAcknowledged - acknowledged.tEvent,
    t_present: elapsed
  })
}
