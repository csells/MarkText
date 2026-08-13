import type { Page } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

import {
  reportUpstreamBaselineInputObservation,
  waitForUpstreamBaselineInputProbe
} from '../../e2e/helpers/upstreamBaselineInputProbe'

describe('upstream baseline external input observation', () => {
  it('reports exact DOM echo and the compositor capture upper bound', () => {
    expect(reportUpstreamBaselineInputObservation({
      tEvent: 100,
      tAcknowledged: 104.25,
      tCaptureComplete: 118,
      expectedTextHash: 'deadbeef',
      acknowledgedTextHash: 'deadbeef',
      retainedTextHash: 'deadbeef'
    })).toEqual({
      t_echo: 4.25,
      t_present: 18
    })
  })

  it('fails closed for missing, reordered, or mismatched DOM observations', () => {
    expect(() => reportUpstreamBaselineInputObservation({
      tEvent: 100,
      tAcknowledged: 99,
      tCaptureComplete: 120,
      expectedTextHash: 'deadbeef',
      acknowledgedTextHash: 'deadbeef',
      retainedTextHash: 'deadbeef'
    })).toThrow(/acknowledgement.*dispatch/i)
    expect(() => reportUpstreamBaselineInputObservation({
      tEvent: 100,
      tAcknowledged: 105,
      expectedTextHash: 'deadbeef',
      acknowledgedTextHash: 'deadbeef'
    })).toThrow(/compositor capture completion/i)
    expect(() => reportUpstreamBaselineInputObservation({
      tEvent: 100,
      tAcknowledged: 105,
      tCaptureComplete: 120,
      expectedTextHash: 'deadbeef',
      acknowledgedTextHash: 'deadbeef',
      retainedTextHash: 'cafebabe'
    })).toThrow(/post-capture.*checkpoint/i)
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

  it('releases an exact DOM acknowledgement without waiting for renderer rAF', async() => {
    const checkpoint = {
      installed: true,
      sampleCount: 1,
      tEvent: 200,
      tAcknowledged: 203
    }
    const page = {
      evaluate: vi.fn(async() => checkpoint),
      waitForFunction: vi.fn(async() => {
        throw new Error('Acknowledged input must not wait for renderer rAF')
      })
    } as unknown as Page

    await waitForUpstreamBaselineInputProbe(page)
    expect(page.waitForFunction).not.toHaveBeenCalled()
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
        tAcknowledged: undefined
      },
      {
        installed: true,
        sampleCount: 1,
        tEvent: 400,
        tAcknowledged: 30_408
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
        tAcknowledged: 30_408
      },
      cause: timeoutCause
    })
    await expect(failure).rejects.toThrow(
      /tEvent=400, tAcknowledged=30408/u
    )
  })
})
