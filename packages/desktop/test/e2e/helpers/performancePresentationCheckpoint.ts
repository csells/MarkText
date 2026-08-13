import { isDeepStrictEqual } from 'node:util'
import type { Page } from 'playwright'

export const PERFORMANCE_PRESENTATION_BOUNDARY =
  'cdp-page-capture-screenshot-v1' as const

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

export interface PerformancePresentationCheckpointResult {
  readonly boundary: typeof PERFORMANCE_PRESENTATION_BOUNDARY
  readonly tEvent: number
  readonly tAcknowledged: number
  readonly tPresented: number
  readonly t_echo: number
  readonly t_present: number
}

export const captureExactCompositorPresentation = async<Checkpoint>(
  page: Page,
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

  const session = await page.context().newCDPSession(page)
  let result: Readonly<PerformancePresentationCheckpointResult>
  try {
    let deadline: ReturnType<typeof setTimeout> | undefined
    const { capture, presented } = await (async() => {
      try {
        return await Promise.race([
          (async() => {
            const capture = await session.send('Page.captureScreenshot', {
              format: 'png',
              fromSurface: true,
              captureBeyondViewport: false
            })
            const presented = await adapter.readPresented()
            return { capture, presented }
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
        throw new PerformancePresentationCheckpointError(
          'capture-failed',
          'Compositor presentation capture failed',
          cause
        )
      } finally {
        if (deadline !== undefined) clearTimeout(deadline)
      }
    })()
    if (capture.data.length === 0) {
      throw new PerformancePresentationCheckpointError(
        'capture-failed',
        'Compositor presentation capture is empty'
      )
    }
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
    result = Object.freeze({
      boundary: PERFORMANCE_PRESENTATION_BOUNDARY,
      tEvent: acknowledged.tEvent,
      tAcknowledged: acknowledged.tAcknowledged,
      tPresented: presented.observedAt,
      t_echo: acknowledged.tAcknowledged - acknowledged.tEvent,
      t_present: elapsed
    })
  } catch (primaryFailure) {
    try {
      await session.detach()
    } catch {}
    throw primaryFailure
  }
  try {
    await session.detach()
  } catch (detachError) {
    throw new PerformancePresentationCheckpointError(
      'capture-failed',
      'Compositor presentation CDP session detach failed',
      detachError
    )
  }
  return result
}
