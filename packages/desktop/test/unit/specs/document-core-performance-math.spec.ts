import { describe, expect, it } from 'vitest'

import {
  aggregateMainStageMeasurements,
  isUsableBoundedViewport,
  measuredDoublingRatio
} from '../../e2e/documentCorePerformanceMath'

describe('document-core performance evidence math', () => {
  it('uses the measured lower duration without a one-millisecond floor', () => {
    expect(measuredDoublingRatio(0.5, 1.2)).toBeCloseTo(2.4)
    expect(measuredDoublingRatio(0, 0.1)).toBe(Number.POSITIVE_INFINITY)
  })

  it('rejects invalid duration evidence', () => {
    expect(() => measuredDoublingRatio(-1, 1)).toThrow(/duration/i)
    expect(() => measuredDoublingRatio(1, Number.NaN)).toThrow(/duration/i)
  })

  it('accepts only a laid-out editable target viewport with bounded complete content', () => {
    const usable = {
      targetActive: true,
      connected: true,
      mode: 'source-only',
      contentEditable: 'true',
      ariaReadOnly: 'false',
      domNodes: 2,
      carrierStart: 0,
      carrierEnd: 32_000_000,
      width: 800,
      height: 600
    } as const

    expect(isUsableBoundedViewport(usable, {
      sourceUnits: 32_000_000,
      maximumDomNodes: 32
    })).toBe(true)
    expect(isUsableBoundedViewport({
      ...usable,
      targetActive: false
    }, {
      sourceUnits: 32_000_000,
      maximumDomNodes: 32
    })).toBe(false)
    expect(isUsableBoundedViewport({
      ...usable,
      domNodes: 33
    }, {
      sourceUnits: 32_000_000,
      maximumDomNodes: 32
    })).toBe(false)
    expect(isUsableBoundedViewport({
      ...usable,
      carrierEnd: 31_999_999
    }, {
      sourceUnits: 32_000_000,
      maximumDomNodes: 32
    })).toBe(false)
    expect(isUsableBoundedViewport({
      ...usable,
      width: 0
    }, {
      sourceUnits: 32_000_000,
      maximumDomNodes: 32
    })).toBe(false)
  })

  it('retains every labeled main-stage path and identifies the worst slice', () => {
    const aggregate = aggregateMainStageMeasurements([
      { path: 'production-open', maximumMs: 1.25 },
      { path: 'open-cancellation', maximumMs: 2.5 },
      { path: 'dispatch-cancellation-open', maximumMs: 3.75 },
      { path: 'scale:P1S-ORDINARY:upper', maximumMs: 3.5 }
    ])

    expect(aggregate.maximumMs).toBe(3.75)
    expect(aggregate.maximumPath).toBe('dispatch-cancellation-open')
    expect(aggregate.measurements).toHaveLength(4)
    expect(aggregate.measurements.map(({ path }) => path)).toEqual([
      'production-open',
      'open-cancellation',
      'dispatch-cancellation-open',
      'scale:P1S-ORDINARY:upper'
    ])
  })

  it('rejects incomplete or ambiguous main-stage evidence', () => {
    expect(() => aggregateMainStageMeasurements([])).toThrow(/main-stage/i)
    expect(() => aggregateMainStageMeasurements([
      { path: 'production-open', maximumMs: Number.NaN }
    ])).toThrow(/main-stage/i)
    expect(() => aggregateMainStageMeasurements([
      { path: 'production-open', maximumMs: 1 },
      { path: 'production-open', maximumMs: 2 }
    ])).toThrow(/duplicate/i)
  })
})
