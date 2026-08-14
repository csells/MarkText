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
  it('keeps presentation explicitly calibration-required and the protocol unratified', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown

    expect(() => validateCriticMarkupPerformanceTargets(manifest)).not.toThrow()
    expect(manifest).toMatchObject({ status: 'proposed-unratified' })
    expect(manifest).toMatchObject({
      schema: 'marktext-criticmarkup-performance-targets-v5',
      sampling: {
        sampleLifecycle: 'fresh-application-profile-per-observation-v1',
        scenarios: expect.stringMatching(
          /fresh application.*fresh profile.*every observation.*launch.*bootstrap.*cleanup.*outside.*timed metric/i
        )
      }
    })
    expect(manifest).toMatchObject({
      metrics: {
        t_event: {
          definition: expect.any(String)
        }
      }
    })

    const staleSchema = structuredClone(manifest) as { schema: string }
    staleSchema.schema = 'marktext-criticmarkup-performance-targets-v4'
    expect(() => validateCriticMarkupPerformanceTargets(staleSchema))
      .toThrow(/schema is unsupported/i)

    const pooledLifecycle = structuredClone(manifest) as {
      sampling: { sampleLifecycle: string }
    }
    pooledLifecycle.sampling.sampleLifecycle = 'one-application-per-run'
    expect(() => validateCriticMarkupPerformanceTargets(pooledLifecycle))
      .toThrow(/sample lifecycle.*fresh application profile per observation/i)
    expect((manifest as { metrics: { t_event: object } }).metrics.t_event)
      .not.toHaveProperty('targetP95Ms')
    expect(manifest).toMatchObject({
      schema: 'marktext-criticmarkup-performance-targets-v5',
      metrics: {
        t_present: {
          definition: expect.stringMatching(
            /WebContents\.capturePage.*stayHidden.*stayAwake.*transparent.*render-active.*upper bound/i
          ),
          targetP95Ms: null,
          targetStatus: 'baseline-calibration-required'
        }
      }
    })

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

    const inventedPresentationTarget = structuredClone(manifest) as {
      metrics: { t_present: { targetP95Ms: unknown } }
    }
    inventedPresentationTarget.metrics.t_present.targetP95Ms = 16.7
    expect(() => validateCriticMarkupPerformanceTargets(inventedPresentationTarget))
      .toThrow(/t_present.*calibration/i)

    const calibrated = structuredClone(manifest) as {
      metrics: {
        t_present: { targetP95Ms: unknown, targetStatus: string }
      }
    }
    calibrated.metrics.t_present.targetP95Ms = 50
    calibrated.metrics.t_present.targetStatus = 'frozen'
    expect(() => validateCriticMarkupPerformanceTargets(calibrated))
      .not.toThrow()

    const prematurelyRatified = structuredClone(manifest) as {
      status: string
      ratificationBasis: string
    }
    prematurelyRatified.status = 'ratified'
    prematurelyRatified.ratificationBasis = 'Synthetic basis'
    expect(() => validateCriticMarkupPerformanceTargets(prematurelyRatified))
      .toThrow(/t_present.*frozen positive target/i)
  })
})
