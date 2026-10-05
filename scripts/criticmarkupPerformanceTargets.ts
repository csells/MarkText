const REQUIRED_METRICS = [
  't_event',
  't_echo',
  't_dispatch',
  't_ack',
  't_reconcile',
  't_present',
  'open',
  'first_viewport'
] as const

export const PERFORMANCE_SAMPLE_LIFECYCLE =
  'fresh-application-profile-per-observation-v1' as const
export const PERFORMANCE_OBSERVATION_SCHEDULE =
  'warmup-then-measured-rotating-round-robin-v1' as const
export const PERFORMANCE_DISPLAY_SLEEP_POLICY =
  'runner-owned-caffeinate-display-sleep-prevention-v1' as const

/**
 * The host properties a measurement run must match. The owner ruled that no OS
 * version is pinned: producers may record it as evidence, but it never gates a run.
 */
export const PERFORMANCE_PINNED_ENVIRONMENT_KEYS = Object.freeze([
  'hardware',
  'architecture',
  'build'
] as const)

type RequiredMetric = typeof REQUIRED_METRICS[number]

const recordOf = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

const nonEmptyString = (value: unknown, label: string): void => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
}

const positiveInteger = (value: unknown, label: string): void => {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
}

/**
 * The fixed loop every performance run times beside its input, as
 * `warmSessionDiagnostics` installs it: 300,000 iterations of
 * `(value * 31 + index) | 0`, once after each measured key. It never touches
 * the editor, so its time shows only how fast the renderer's CPU runs.
 */
export const PERFORMANCE_CALIBRATION_LOOP = 'integer-spin-300000-at-keyup-v1' as const

/** The calibration record a target manifest pins for its hardware. */
export interface PerformanceCalibrationReference {
  readonly loop: typeof PERFORMANCE_CALIBRATION_LOOP
  readonly referenceP50Ms: number
  readonly maximumExcess: number
  readonly maximumAttempts: number
  readonly basis: string
  readonly rule: string
}

/** A run's calibration loop times, as p50 and p90 of every measured key's loop. */
export interface PerformanceCalibrationSummary {
  readonly count: number
  readonly p50: number | null
  readonly p90: number | null
}

export type PerformanceRunValidity = 'valid' | 'invalid'

/** A workload's verdict over its attempts: judged on a valid run, or inconclusive. */
export type PerformanceWorkloadValidity = 'valid' | 'inconclusive'

const nearestRank = (sorted: readonly number[], fraction: number): number | null =>
  sorted.length === 0 ? null : sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null

/** p50 and p90 of a run's calibration loop times. */
export function summarizePerformanceCalibration(
  loopMs: readonly number[]
): PerformanceCalibrationSummary {
  const sorted = loopMs.filter(value => Number.isFinite(value)).sort((left, right) => left - right)
  return Object.freeze({ count: sorted.length, p50: nearestRank(sorted, 0.5), p90: nearestRank(sorted, 0.9) })
}

/**
 * Whether a run measured the editor or the CPU's state. A run whose loop p50
 * exceeds the reference by more than the allowed excess ran on a slowed CPU
 * (thermal, power or wake state), and one with no loop times proves nothing:
 * either is invalid, judged neither pass nor fail, and run again.
 */
export function performanceRunValidity(
  summary: PerformanceCalibrationSummary,
  reference: Pick<PerformanceCalibrationReference, 'referenceP50Ms' | 'maximumExcess'>
): PerformanceRunValidity {
  return summary.p50 !== null && summary.p50 <= reference.referenceP50Ms * (1 + reference.maximumExcess)
    ? 'valid'
    : 'invalid'
}

/** A workload is judged on its first valid attempt; with none it is inconclusive. */
export function performanceWorkloadValidity(
  attempts: readonly PerformanceRunValidity[]
): PerformanceWorkloadValidity {
  return attempts.includes('valid') ? 'valid' : 'inconclusive'
}

/** Validates a manifest's calibration record and returns it. */
export function performanceCalibrationReference(value: unknown): PerformanceCalibrationReference {
  const calibration = recordOf(value, 'Performance calibration')
  if (calibration.loop !== PERFORMANCE_CALIBRATION_LOOP) {
    throw new Error(`Performance calibration loop must be ${PERFORMANCE_CALIBRATION_LOOP}`)
  }
  const reference = calibration.referenceP50Ms
  if (typeof reference !== 'number' || !Number.isFinite(reference) || reference <= 0) {
    throw new Error('Performance calibration referenceP50Ms must be a finite positive number')
  }
  const excess = calibration.maximumExcess
  if (typeof excess !== 'number' || !Number.isFinite(excess) || excess <= 0 || excess >= 1) {
    throw new Error('Performance calibration maximumExcess must be a fraction between 0 and 1')
  }
  positiveInteger(calibration.maximumAttempts, 'Performance calibration maximumAttempts')
  nonEmptyString(calibration.basis, 'Performance calibration basis')
  nonEmptyString(calibration.rule, 'Performance calibration rule')
  if (!/invalid.*neither.*pass.*fail.*run again.*inconclusive.*does not pass/isu.test(calibration.rule as string)) {
    throw new Error(
      'Performance calibration rule must make a slowed run invalid, neither pass nor fail, rerun it, and leave a workload with no valid run inconclusive and not passing'
    )
  }
  return calibration as unknown as PerformanceCalibrationReference
}

/** Validates the human-owned Phase 0 measurement protocol and target record. */
export function validateCriticMarkupPerformanceTargets(value: unknown): void {
  const manifest = recordOf(value, 'Performance target manifest')
  if (manifest.schema !== 'marktext-criticmarkup-performance-targets-v12') {
    throw new Error('Performance target manifest schema is unsupported')
  }
  if (manifest.status !== 'proposed-unratified' && manifest.status !== 'ratified') {
    throw new Error('Performance target manifest status is unsupported')
  }

  const documents = recordOf(manifest.representativeDocuments, 'Representative documents')
  if (documents.schema !== 'marktext-criticmarkup-representative-documents-v1') {
    throw new Error('Representative document manifest schema is unsupported')
  }
  nonEmptyString(documents.path, 'Representative document manifest path')

  const environment = recordOf(manifest.environment, 'Measurement environment')
  for (const key of PERFORMANCE_PINNED_ENVIRONMENT_KEYS) {
    nonEmptyString(environment[key], `Measurement ${key}`)
  }
  const unpinnable = Object.keys(environment).filter(key => (
    !(PERFORMANCE_PINNED_ENVIRONMENT_KEYS as readonly string[]).includes(key)
  ))
  if (unpinnable.length > 0) {
    throw new Error(
      `Measurement environment must not pin ${unpinnable[0]}; only hardware, architecture, and build are pinned`
    )
  }

  performanceCalibrationReference(manifest.calibration)

  const sampling = recordOf(manifest.sampling, 'Sampling protocol')
  positiveInteger(sampling.warmupSamples, 'Warmup sample count')
  positiveInteger(sampling.measuredSamples, 'Measured sample count')
  if (sampling.sampleLifecycle !== PERFORMANCE_SAMPLE_LIFECYCLE) {
    throw new Error(
      'Sampling sample lifecycle must use a fresh application profile per observation'
    )
  }
  if (sampling.observationSchedule !== PERFORMANCE_OBSERVATION_SCHEDULE) {
    throw new Error(
      'Sampling observation schedule must use warmup then measured rotating round robin'
    )
  }
  if (sampling.displaySleepPolicy !== PERFORMANCE_DISPLAY_SLEEP_POLICY) {
    throw new Error(
      'Sampling display sleep policy must use runner-owned caffeinate prevention'
    )
  }
  if (
    !Array.isArray(sampling.percentiles) ||
    sampling.percentiles.length === 0 ||
    !sampling.percentiles.every(percentile =>
      typeof percentile === 'number' && Number.isFinite(percentile) &&
      percentile > 0 && percentile <= 100
    ) ||
    !sampling.percentiles.includes(95)
  ) {
    throw new Error('Sampling percentiles must be numeric and include p95')
  }
  nonEmptyString(sampling.scenarios, 'Sampling scenario rule')
  if (
    typeof sampling.scenarios !== 'string' ||
    !/fresh application.*fresh profile.*every observation.*rotat.*round-robin.*caffeinate.*display sleep.*setVisibleOnAllWorkspaces\(true.*visibleOnFullScreen.*true.*skipTransformProcessType.*true.*isVisibleOnAllWorkspaces\(\).*true.*isHiddenInMissionControl\(\).*true.*pre-timing readiness.*two consecutive.*Electron.*CGWindow.*5 seconds.*missing optional.*onScreen.*settle.*external.*on-screen.*proof.*explicit.*onScreen.*false.*strict.*post-measurement.*one-shot strict.*null.*onScreen.*strict.*cleanup.*setVisibleOnAllWorkspaces\(false.*visibleOnFullScreen.*false.*skipTransformProcessType.*true.*launch.*readiness.*excluded.*unfocused.*not always-on-top.*no retries.*drift diagnostic.*no.*threshold.*cleanup.*outside.*timed metric/iu
      .test(sampling.scenarios)
  ) {
    throw new Error(
      'Sampling scenarios must define fresh isolation, rotating order, display-sleep prevention, bounded native readiness convergence, one-shot post-measurement validation, no retries, threshold-free drift diagnostics, and metric exclusions'
    )
  }

  const metrics = recordOf(manifest.metrics, 'Performance metrics')
  for (const name of REQUIRED_METRICS) {
    const metric = recordOf(metrics[name], `${name} metric`)
    nonEmptyString(metric.definition, `${name} definition`)
    const target = metric.targetP95Ms
    if (name === 't_event') {
      if (target !== undefined) {
        throw new Error('t_event is the trace origin and must not define targetP95Ms')
      }
      continue
    }
    if (name === 't_present') {
      if (metric.targetStatus === 'baseline-calibration-required') {
        if (target !== null) {
          throw new Error(
            't_present baseline calibration requires a null targetP95Ms'
          )
        }
      } else if (metric.targetStatus === 'frozen') {
        if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) {
          throw new Error(
            't_present frozen targetP95Ms must be a finite positive number'
          )
        }
      } else {
        throw new Error(
          't_present targetStatus must be baseline-calibration-required or frozen'
        )
      }
      continue
    }
    if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) {
      throw new Error(
        `${name} targetP95Ms must be a finite positive number`
      )
    }
  }
  const extras = Object.keys(metrics).filter(
    name => !REQUIRED_METRICS.includes(name as RequiredMetric)
  )
  if (extras.length > 0) throw new Error(`Unknown performance metric ${extras[0]}`)

  if (manifest.status === 'ratified') {
    const presentation = recordOf(metrics.t_present, 't_present metric')
    if (
      presentation.targetStatus !== 'frozen' ||
      typeof presentation.targetP95Ms !== 'number' ||
      !Number.isFinite(presentation.targetP95Ms) ||
      presentation.targetP95Ms <= 0
    ) {
      throw new Error('Ratification requires a t_present frozen positive target')
    }
    nonEmptyString(manifest.ratificationBasis, 'Ratification basis')
  }
}
