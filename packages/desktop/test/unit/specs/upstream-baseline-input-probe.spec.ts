import { describe, expect, it } from 'vitest'

import { reportUpstreamBaselineInputObservation } from '../../e2e/helpers/upstreamBaselineInputProbe'

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
})
