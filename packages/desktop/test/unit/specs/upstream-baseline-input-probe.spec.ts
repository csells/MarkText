import type { Page } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

import {
  reportUpstreamBaselineInputObservation,
  waitForUpstreamBaselineInputProbe
} from '../../e2e/helpers/upstreamBaselineInputProbe'

describe('upstream baseline external input observation', () => {
  it('reports elapsed browser-visible echo and stable frame', () => {
    expect(reportUpstreamBaselineInputObservation({
      tEvent: 100,
      tAcknowledged: 104.25,
      tStableFrame: 116.75,
      expectedTextHash: 'deadbeef',
      acknowledgedTextHash: 'deadbeef',
      stableFrameTextHash: 'deadbeef'
    })).toEqual({
      t_echo: 4.25,
      t_frame: 16.75
    })
  })

  it('fails closed for missing, reordered, or mismatched DOM observations', () => {
    expect(() => reportUpstreamBaselineInputObservation({
      tEvent: 100,
      tAcknowledged: 99,
      tStableFrame: 120,
      expectedTextHash: 'deadbeef',
      acknowledgedTextHash: 'deadbeef',
      stableFrameTextHash: 'deadbeef'
    })).toThrow(/acknowledgement.*dispatch/i)
    expect(() => reportUpstreamBaselineInputObservation({
      tEvent: 100,
      tAcknowledged: 105,
      expectedTextHash: 'deadbeef',
      acknowledgedTextHash: 'deadbeef'
    })).toThrow(/stable rendered frame/i)
    expect(() => reportUpstreamBaselineInputObservation({
      tEvent: 100,
      tAcknowledged: 105,
      tStableFrame: 120,
      expectedTextHash: 'deadbeef',
      acknowledgedTextHash: 'deadbeef',
      stableFrameTextHash: 'cafebabe'
    })).toThrow(/stable frame.*checkpoint/i)
  })

  it('identifies a later lifecycle whose exact input checkpoint was not observed', async() => {
    type Checkpoint = Readonly<{
      readonly installed: boolean
      readonly sampleCount: number
      readonly tEvent?: number
      readonly tAcknowledged?: number
      readonly tStableFrame?: number
    }>
    let checkpoint: Checkpoint = {
      installed: true,
      sampleCount: 1,
      tEvent: 100,
      tAcknowledged: 104,
      tStableFrame: 116
    }
    const page = {
      evaluate: vi.fn(async() => checkpoint),
      waitForFunction: vi.fn(async() => {
        if (
          checkpoint.sampleCount === 0 ||
          checkpoint.tAcknowledged === undefined ||
          checkpoint.tStableFrame === undefined
        ) {
          throw new Error('page.waitForFunction: Timeout 30000ms exceeded.')
        }
      })
    } as unknown as Page

    await waitForUpstreamBaselineInputProbe(page)
    await waitForUpstreamBaselineInputProbe(page)

    checkpoint = { installed: true, sampleCount: 0 }
    const failure = waitForUpstreamBaselineInputProbe(page)
    await expect(failure).rejects.toMatchObject({
      name: 'UpstreamBaselineInputProbeCheckpointError',
      code: 'input-not-observed',
      state: 'awaiting-input'
    })
  })

  it('retains the exact acknowledged checkpoint when the stable frame is lost', async() => {
    let checkpoint = {
      installed: true,
      sampleCount: 1,
      tEvent: 200,
      tAcknowledged: 203,
      tStableFrame: 217 as number | undefined
    }
    const page = {
      evaluate: vi.fn(async() => checkpoint),
      waitForFunction: vi.fn(async() => {
        if (checkpoint.tStableFrame === undefined) {
          throw new Error('page.waitForFunction: Timeout 30000ms exceeded.')
        }
      })
    } as unknown as Page

    await waitForUpstreamBaselineInputProbe(page)

    checkpoint = { ...checkpoint, tStableFrame: undefined }
    const failure = waitForUpstreamBaselineInputProbe(page)
    await expect(failure).rejects.toMatchObject({
      name: 'UpstreamBaselineInputProbeCheckpointError',
      code: 'deadline-exceeded',
      state: 'awaiting-stable-frame',
      checkpoint: {
        installed: true,
        sampleCount: 1,
        tEvent: 200,
        tAcknowledged: 203,
        tStableFrame: undefined
      }
    })
  })

  it('rejects a checkpoint that becomes ready only after the wait deadline', async() => {
    const timeoutCause = new Error(
      'page.waitForFunction: Timeout 30000ms exceeded.'
    )
    const checkpoints = [
      {
        installed: true,
        sampleCount: 1,
        tEvent: 400,
        tAcknowledged: 405,
        tStableFrame: undefined
      },
      {
        installed: true,
        sampleCount: 1,
        tEvent: 400,
        tAcknowledged: 405,
        tStableFrame: 30_408
      }
    ]
    const page = {
      evaluate: vi.fn(async() => checkpoints.shift()),
      waitForFunction: vi.fn(async() => {
        throw timeoutCause
      })
    } as unknown as Page

    const failure = waitForUpstreamBaselineInputProbe(page)
    await expect(failure).rejects.toMatchObject({
      name: 'UpstreamBaselineInputProbeCheckpointError',
      code: 'deadline-exceeded',
      state: 'ready',
      checkpoint: {
        installed: true,
        sampleCount: 1,
        tEvent: 400,
        tAcknowledged: 405,
        tStableFrame: 30_408
      },
      cause: timeoutCause
    })
    await expect(failure).rejects.toThrow(
      /tEvent=400, tAcknowledged=405, tStableFrame=30408/u
    )
  })

  it('does not admit an already-ready checkpoint past the exact deadline', async() => {
    const page = {
      evaluate: vi.fn(async() => ({
        installed: true,
        sampleCount: 1,
        tEvent: 500,
        tAcknowledged: 505,
        tStableFrame: 30_501
      }))
    } as unknown as Page

    await expect(waitForUpstreamBaselineInputProbe(page)).rejects.toMatchObject({
      name: 'UpstreamBaselineInputProbeCheckpointError',
      code: 'deadline-exceeded',
      state: 'ready',
      checkpoint: {
        tEvent: 500,
        tAcknowledged: 505,
        tStableFrame: 30_501
      }
    })
  })
})
