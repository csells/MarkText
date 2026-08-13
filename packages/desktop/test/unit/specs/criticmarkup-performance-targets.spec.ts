import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  validateCriticMarkupPerformanceTargets
} from '../../../../../scripts/criticmarkupPerformanceTargets'

const manifestPath = resolve(
  import.meta.dirname,
  '../../../../../specs/baselines/criticmarkup-performance-targets.json'
)

describe('CriticMarkup performance target protocol', () => {
  it('keeps every required target numeric and explicitly unratified', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown

    expect(() => validateCriticMarkupPerformanceTargets(manifest)).not.toThrow()
    expect(manifest).toMatchObject({ status: 'proposed-unratified' })
    expect(manifest).toMatchObject({
      metrics: {
        t_event: {
          definition: expect.any(String)
        }
      }
    })
    expect((manifest as { metrics: { t_event: object } }).metrics.t_event)
      .not.toHaveProperty('targetP95Ms')

    const missing = structuredClone(manifest) as {
      metrics: { t_ack: { targetP95Ms?: unknown } }
    }
    delete missing.metrics.t_ack.targetP95Ms
    expect(() => validateCriticMarkupPerformanceTargets(missing)).toThrow(
      /t_ack targetP95Ms must be a finite positive number/
    )

    const nonNumeric = structuredClone(manifest) as {
      metrics: { first_viewport: { targetP95Ms: unknown } }
    }
    nonNumeric.metrics.first_viewport.targetP95Ms = 'fast'
    expect(() => validateCriticMarkupPerformanceTargets(nonNumeric)).toThrow(
      /first_viewport targetP95Ms must be a finite positive number/
    )
  })
})
