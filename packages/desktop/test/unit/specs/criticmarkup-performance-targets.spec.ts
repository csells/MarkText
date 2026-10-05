import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  PERFORMANCE_CALIBRATION_LOOP,
  performanceCalibrationReference,
  performanceRunValidity,
  performanceWorkloadValidity,
  summarizePerformanceCalibration,
  validateCriticMarkupPerformanceTargets
} from '../../../../../scripts/criticmarkupPerformanceTargets'

const manifestPath = resolve(
  import.meta.dirname,
  '../../../../../specs/baselines/criticmarkup-performance-targets.json'
)

describe('CriticMarkup performance target protocol', () => {
  it('pins the measurement host without pinning any OS version', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      environment: Record<string, string>
    }

    expect(manifest.environment).toEqual({
      hardware: 'MacBook Pro Mac17,6, Apple M5 Max, 128 GB',
      architecture: 'arm64',
      build: 'MarkText production Electron bundle'
    })

    const versionPinned = structuredClone(manifest)
    versionPinned.environment.os = 'macOS 26.5.1 (25F80)'
    expect(() => validateCriticMarkupPerformanceTargets(versionPinned))
      .toThrow(/must not pin os/i)

    const unpinnedArchitecture = structuredClone(manifest)
    delete unpinnedArchitecture.environment.architecture
    expect(() => validateCriticMarkupPerformanceTargets(unpinnedArchitecture))
      .toThrow(/Measurement architecture must be a non-empty string/)
  })

  it('keeps presentation explicitly calibration-required and the protocol unratified', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown

    expect(() => validateCriticMarkupPerformanceTargets(manifest)).not.toThrow()
    expect(manifest).toMatchObject({ status: 'proposed-unratified' })
    expect(manifest).toMatchObject({
      schema: 'marktext-criticmarkup-performance-targets-v12',
      sampling: {
        sampleLifecycle: 'fresh-application-profile-per-observation-v1',
        observationSchedule: 'warmup-then-measured-rotating-round-robin-v1',
        displaySleepPolicy:
          'runner-owned-caffeinate-display-sleep-prevention-v1',
        scenarios: expect.stringMatching(
          /fresh application.*fresh profile.*every observation.*rotat.*round-robin.*caffeinate.*display sleep.*setVisibleOnAllWorkspaces\(true.*visibleOnFullScreen.*true.*skipTransformProcessType.*true.*isVisibleOnAllWorkspaces\(\).*true.*isHiddenInMissionControl\(\).*true.*pre-timing readiness.*two consecutive.*Electron.*CGWindow.*5 seconds.*missing optional.*onScreen.*settle.*external.*on-screen.*proof.*explicit.*onScreen.*false.*strict.*post-measurement.*one-shot strict.*null.*onScreen.*strict.*cleanup.*setVisibleOnAllWorkspaces\(false.*visibleOnFullScreen.*false.*skipTransformProcessType.*true.*launch.*readiness.*excluded.*unfocused.*not always-on-top.*no retries.*drift diagnostic.*no.*threshold.*cleanup.*outside.*timed metric/i
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
    staleSchema.schema = 'marktext-criticmarkup-performance-targets-v11'
    expect(() => validateCriticMarkupPerformanceTargets(staleSchema))
      .toThrow(/schema is unsupported/i)

    const pooledLifecycle = structuredClone(manifest) as {
      sampling: { sampleLifecycle: string }
    }
    pooledLifecycle.sampling.sampleLifecycle = 'one-application-per-run'
    expect(() => validateCriticMarkupPerformanceTargets(pooledLifecycle))
      .toThrow(/sample lifecycle.*fresh application profile per observation/i)

    const unscheduled = structuredClone(manifest) as {
      sampling: { observationSchedule: string }
    }
    unscheduled.sampling.observationSchedule = 'document-at-a-time'
    expect(() => validateCriticMarkupPerformanceTargets(unscheduled))
      .toThrow(/observation schedule.*warmup.*measured.*rotating round robin/i)

    const unmanagedDisplaySleep = structuredClone(manifest) as {
      sampling: { displaySleepPolicy: string }
    }
    unmanagedDisplaySleep.sampling.displaySleepPolicy = 'unmanaged-display-sleep-v0'
    expect(() => validateCriticMarkupPerformanceTargets(unmanagedDisplaySleep))
      .toThrow(/display sleep.*caffeinate/i)

    const singleNativeMatch = structuredClone(manifest) as {
      sampling: { scenarios: string }
    }
    singleNativeMatch.sampling.scenarios =
      singleNativeMatch.sampling.scenarios.replace('two consecutive', 'one')
    expect(() => validateCriticMarkupPerformanceTargets(singleNativeMatch))
      .toThrow(/bounded native readiness convergence/i)

    const permissiveMissingMetadata = structuredClone(manifest) as {
      sampling: { scenarios: string }
    }
    permissiveMissingMetadata.sampling.scenarios =
      permissiveMissingMetadata.sampling.scenarios.replace(
        /explicit onScreen false[^.]*\./u,
        'Missing presentation metadata may always settle.'
      )
    expect(() => validateCriticMarkupPerformanceTargets(
      permissiveMissingMetadata
    )).toThrow(/bounded native readiness convergence/i)

    const unsafeAllSpacesPolicy = structuredClone(manifest) as {
      sampling: { scenarios: string }
    }
    unsafeAllSpacesPolicy.sampling.scenarios =
      unsafeAllSpacesPolicy.sampling.scenarios.replace(
        'skipTransformProcessType: true',
        'skipTransformProcessType: false'
      )
    expect(() => validateCriticMarkupPerformanceTargets(
      unsafeAllSpacesPolicy
    )).toThrow(/bounded native readiness convergence/i)
    expect((manifest as { metrics: { t_event: object } }).metrics.t_event)
      .not.toHaveProperty('targetP95Ms')
    expect(manifest).toMatchObject({
      schema: 'marktext-criticmarkup-performance-targets-v12',
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

  // Owner decision 2026-10-04 (plan 0012): a run whose fixed calibration
  // loop shows a slowed CPU is invalid, neither pass nor fail, and run again.
  describe('calibration validity', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      calibration: Record<string, unknown>
    }

    it('pins the fast-state loop reference for the pinned hardware', () => {
      expect(manifest.calibration).toMatchObject({
        loop: PERFORMANCE_CALIBRATION_LOOP,
        referenceP50Ms: 1.2,
        maximumExcess: 0.15,
        maximumAttempts: 3
      })
      expect(performanceCalibrationReference(manifest.calibration).basis).toMatch(/1\.20.*1\.5-1\.8.*upstream/su)
    })

    it('rejects a manifest without a sound calibration record', () => {
      const without = structuredClone(manifest) as { calibration?: unknown }
      delete without.calibration
      expect(() => validateCriticMarkupPerformanceTargets(without)).toThrow(/calibration must be an object/i)
      for (const [field, value, error] of [
        ['loop', 'some-other-loop', /loop must be/],
        ['referenceP50Ms', 0, /referenceP50Ms must be a finite positive number/],
        ['maximumExcess', 1.5, /maximumExcess must be a fraction/],
        ['maximumAttempts', 0, /maximumAttempts must be a positive integer/],
        ['rule', 'Slow runs count as failures.', /calibration rule must make a slowed run invalid/]
      ] as const) {
        const broken = structuredClone(manifest)
        broken.calibration[field] = value
        expect(() => validateCriticMarkupPerformanceTargets(broken), field).toThrow(error)
      }
    })

    it('summarizes a run\'s loop times as nearest-rank p50 and p90', () => {
      expect(summarizePerformanceCalibration([1.3, 1.2, 1.1, 1.2, 1.2, 1.2, 1.3, 1.2, 1.2, 1.4]))
        .toEqual({ count: 10, p50: 1.2, p90: 1.3 })
      expect(summarizePerformanceCalibration([])).toEqual({ count: 0, p50: null, p90: null })
    })

    it('judges a run by its loop p50 against the reference and allowed excess', () => {
      const reference = { referenceP50Ms: 1.2, maximumExcess: 0.15 }
      // Fast-state runs measured 1.20; slowed ones 1.5-1.8.
      expect(performanceRunValidity({ count: 40, p50: 1.2, p90: 1.3 }, reference)).toBe('valid')
      expect(performanceRunValidity({ count: 40, p50: 1.38, p90: 1.5 }, reference)).toBe('valid')
      expect(performanceRunValidity({ count: 40, p50: 1.4, p90: 1.5 }, reference)).toBe('invalid')
      expect(performanceRunValidity({ count: 40, p50: 1.8, p90: 1.9 }, reference)).toBe('invalid')
      // No loop times prove nothing about the CPU.
      expect(performanceRunValidity({ count: 0, p50: null, p90: null }, reference)).toBe('invalid')
    })

    it('judges a workload on any valid attempt and leaves it inconclusive without one', () => {
      expect(performanceWorkloadValidity(['valid'])).toBe('valid')
      expect(performanceWorkloadValidity(['invalid', 'invalid', 'valid'])).toBe('valid')
      expect(performanceWorkloadValidity(['invalid', 'invalid', 'invalid'])).toBe('inconclusive')
      expect(performanceWorkloadValidity([])).toBe('inconclusive')
    })
  })
})
