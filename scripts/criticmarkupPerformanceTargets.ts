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

/** The calibration fields a raw performance run copies from its target manifest. */
export type PerformanceRunCalibrationReference = Pick<
  PerformanceCalibrationReference,
  'loop' | 'referenceP50Ms' | 'maximumExcess' | 'maximumAttempts'
>

/** One observation attempt judged invalid and run again. */
export interface PerformanceInvalidObservation {
  readonly ordinal: number
  readonly documentId: string
  readonly phase: 'warmup' | 'measured'
  readonly attempt: number
  readonly calibration: Readonly<{ p50: number | null, p90: number | null }>
}

/**
 * How a fresh-application observation times the loop: it has a single key,
 * so it runs the loop eight times, 40 ms apart, after the same warmup as the
 * keyup timing, right after its measurement.
 */
export const PERFORMANCE_CALIBRATION_PROBE = 'integer-spin-300000-probe-8x40ms-v1' as const

/** A raw run's calibration: its reference, its probe and the attempts it ran again. */
export interface PerformanceRunCalibration {
  readonly reference: PerformanceRunCalibrationReference
  readonly probe: typeof PERFORMANCE_CALIBRATION_PROBE
  readonly invalidObservations: readonly PerformanceInvalidObservation[]
}

/** A document's kept observations' loop p50 and p90, in schedule order per phase. */
export interface PerformanceDocumentCalibration {
  readonly warmup: Readonly<{ p50: readonly number[], p90: readonly number[] }>
  readonly measured: Readonly<{ p50: readonly number[], p90: readonly number[] }>
}

/** The calibration fields of a target manifest that a raw run must repeat. */
export function performanceRunCalibrationReference(
  reference: PerformanceRunCalibrationReference
): PerformanceRunCalibrationReference {
  return Object.freeze({
    loop: reference.loop,
    referenceP50Ms: reference.referenceP50Ms,
    maximumExcess: reference.maximumExcess,
    maximumAttempts: reference.maximumAttempts
  })
}

/** Gathers kept observations' loop p50 and p90 per phase, in the order given. */
export function performanceDocumentCalibration(
  observations: readonly Readonly<{
    phase: 'warmup' | 'measured'
    calibration: Readonly<{ p50: number | null, p90: number | null }>
  }>[]
): PerformanceDocumentCalibration {
  const phases = {
    warmup: { p50: [] as (number | null)[], p90: [] as (number | null)[] },
    measured: { p50: [] as (number | null)[], p90: [] as (number | null)[] }
  }
  for (const observation of observations) {
    phases[observation.phase].p50.push(observation.calibration.p50)
    phases[observation.phase].p90.push(observation.calibration.p90)
  }
  // A null here fails validatePerformanceRunCalibration, which every builder runs.
  return Object.freeze({
    warmup: Object.freeze({
      p50: Object.freeze(phases.warmup.p50) as readonly number[],
      p90: Object.freeze(phases.warmup.p90) as readonly number[]
    }),
    measured: Object.freeze({
      p50: Object.freeze(phases.measured.p50) as readonly number[],
      p90: Object.freeze(phases.measured.p90) as readonly number[]
    })
  })
}

/**
 * Validates a raw run's calibration against its target manifest: every kept
 * observation is valid, every attempt it ran again was invalid, and no
 * observation took more attempts than allowed. Returns how many attempts
 * were run again, which the run's application launches, profiles, closes and
 * cleanups count on top of its observations.
 */
export function validatePerformanceRunCalibration(
  input: Readonly<{
    calibration: unknown
    documents: readonly Readonly<{ id: string, calibration: unknown }>[]
    observationOrder: readonly Readonly<{ ordinal: number, documentId: string, phase: string }>[]
    warmupSamples: number
    measuredSamples: number
  }>,
  reference: PerformanceRunCalibrationReference,
  label: string
): number {
  const calibration = recordOf(input.calibration, `${label} calibration`)
  if (
    JSON.stringify(Object.keys(calibration).sort()) !==
      JSON.stringify(['invalidObservations', 'probe', 'reference'])
  ) {
    throw new Error(`${label} calibration must hold exactly reference, probe and invalidObservations`)
  }
  if (calibration.probe !== PERFORMANCE_CALIBRATION_PROBE) {
    throw new Error(`${label} calibration probe must be ${PERFORMANCE_CALIBRATION_PROBE}`)
  }
  const runReference = recordOf(calibration.reference, `${label} calibration reference`)
  const expected = performanceRunCalibrationReference(reference)
  for (const key of Object.keys(expected) as (keyof PerformanceRunCalibrationReference)[]) {
    if (runReference[key] !== expected[key]) {
      throw new Error(`${label} calibration reference ${key} differs from the target manifest`)
    }
  }
  if (Object.keys(runReference).length !== Object.keys(expected).length) {
    throw new Error(`${label} calibration reference must hold exactly the target manifest's fields`)
  }
  const limit = reference.referenceP50Ms * (1 + reference.maximumExcess)
  if (!Array.isArray(calibration.invalidObservations)) {
    throw new Error(`${label} calibration invalidObservations must be an array`)
  }
  const byOrdinal = new Map(input.observationOrder.map(entry => [entry.ordinal, entry]))
  const attemptsByOrdinal = new Map<number, number[]>()
  for (const [index, candidate] of calibration.invalidObservations.entries()) {
    const entryLabel = `${label} invalid observation ${String(index + 1)}`
    const invalid = recordOf(candidate, entryLabel)
    const scheduled = byOrdinal.get(invalid.ordinal as number)
    if (
      scheduled === undefined || invalid.documentId !== scheduled.documentId ||
      invalid.phase !== scheduled.phase
    ) {
      throw new Error(`${entryLabel} does not name a scheduled observation`)
    }
    positiveInteger(invalid.attempt, `${entryLabel} attempt`)
    const loop = recordOf(invalid.calibration, `${entryLabel} calibration`)
    const p50 = loop.p50
    if (p50 !== null && (typeof p50 !== 'number' || !Number.isFinite(p50) || p50 <= limit)) {
      throw new Error(`${entryLabel} was not invalid: its loop p50 is within the limit`)
    }
    if (loop.p90 !== null && (typeof loop.p90 !== 'number' || !Number.isFinite(loop.p90))) {
      throw new Error(`${entryLabel} loop p90 must be a number or null`)
    }
    const attempts = attemptsByOrdinal.get(scheduled.ordinal) ?? []
    attempts.push(invalid.attempt as number)
    attemptsByOrdinal.set(scheduled.ordinal, attempts)
  }
  for (const [ordinal, attempts] of attemptsByOrdinal) {
    // A kept observation is its last attempt, so the invalid ones before it
    // are attempts 1..n, fewer than the maximum.
    const sorted = [...attempts].sort((left, right) => left - right)
    if (
      sorted.length >= reference.maximumAttempts ||
      sorted.some((attempt, index) => attempt !== index + 1)
    ) {
      throw new Error(`${label} observation ${String(ordinal)} has invalid attempts out of order or beyond the maximum`)
    }
  }
  for (const document of input.documents) {
    const record = recordOf(document.calibration, `${label} ${document.id} calibration`)
    for (const [phase, count] of [['warmup', input.warmupSamples], ['measured', input.measuredSamples]] as const) {
      const loops = recordOf(record[phase], `${label} ${document.id} ${phase} calibration`)
      const p50 = loops.p50
      const p90 = loops.p90
      if (!Array.isArray(p50) || !Array.isArray(p90) || p50.length !== count || p90.length !== count) {
        throw new Error(`${label} ${document.id} ${phase} calibration must hold ${String(count)} p50 and p90 values`)
      }
      for (const [index, value] of p50.entries()) {
        const high = p90[index]
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > limit) {
          throw new Error(`${label} ${document.id} ${phase} observation ${String(index + 1)} is not valid by its calibration`)
        }
        if (typeof high !== 'number' || !Number.isFinite(high) || high < value) {
          throw new Error(`${label} ${document.id} ${phase} observation ${String(index + 1)} calibration p90 is invalid`)
        }
      }
    }
  }
  return calibration.invalidObservations.length
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
