import { describe, expect, it } from 'vitest'

import {
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
})
