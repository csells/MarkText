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

/**
 * The calibration record a target manifest pins for its hardware. The loop's
 * time is information beside a run's results, never a verdict on the run:
 * every run is scored against the unchanged thresholds (owner decision
 * 2026-10-06).
 */
export interface PerformanceCalibrationReference {
  readonly loop: typeof PERFORMANCE_CALIBRATION_LOOP
  readonly referenceP50Ms: number
  readonly basis: string
  readonly rule: string
}

/** A run's calibration loop times, as p50 and p90 of every measured key's loop. */
export interface PerformanceCalibrationSummary {
  readonly count: number
  readonly p50: number | null
  readonly p90: number | null
}

/** The nearest-rank quantile of ascending samples at `fraction` in (0, 1]; null when there are none. */
export const nearestRank = (sorted: readonly number[], fraction: number): number | null =>
  sorted.length === 0 ? null : sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null

/** p50 and p90 of a run's calibration loop times. */
export function summarizePerformanceCalibration(
  loopMs: readonly number[]
): PerformanceCalibrationSummary {
  const sorted = loopMs.filter(value => Number.isFinite(value)).sort((left, right) => left - right)
  return Object.freeze({ count: sorted.length, p50: nearestRank(sorted, 0.5), p90: nearestRank(sorted, 0.9) })
}

/** Validates a manifest's calibration record and returns it. */
export function performanceCalibrationReference(value: unknown): PerformanceCalibrationReference {
  const calibration = recordOf(value, 'Performance calibration')
  if (
    JSON.stringify(Object.keys(calibration).sort()) !==
      JSON.stringify(['basis', 'loop', 'referenceP50Ms', 'rule'])
  ) {
    throw new Error('Performance calibration must hold exactly loop, referenceP50Ms, basis and rule')
  }
  if (calibration.loop !== PERFORMANCE_CALIBRATION_LOOP) {
    throw new Error(`Performance calibration loop must be ${PERFORMANCE_CALIBRATION_LOOP}`)
  }
  const reference = calibration.referenceP50Ms
  if (typeof reference !== 'number' || !Number.isFinite(reference) || reference <= 0) {
    throw new Error('Performance calibration referenceP50Ms must be a finite positive number')
  }
  nonEmptyString(calibration.basis, 'Performance calibration basis')
  nonEmptyString(calibration.rule, 'Performance calibration rule')
  if (
    !/information/iu.test(calibration.rule as string) ||
    !/never.*(?:invalid|rerun|run again|inconclusive)/isu.test(calibration.rule as string) ||
    !/every run.*scored.*unchanged thresholds/isu.test(calibration.rule as string)
  ) {
    throw new Error(
      'Performance calibration rule must record the loop as information, never invalidate, rerun or ' +
        'leave a run inconclusive for a slow CPU, and score every run against the unchanged thresholds'
    )
  }
  return calibration as unknown as PerformanceCalibrationReference
}

/** The calibration fields a raw performance run copies from its target manifest. */
export type PerformanceRunCalibrationReference = Pick<
  PerformanceCalibrationReference,
  'loop' | 'referenceP50Ms'
>

/**
 * How a fresh-application observation times the loop: it has a single key,
 * so it runs the loop eight times, 40 ms apart, after the same warmup as the
 * keyup timing, right after its measurement.
 */
export const PERFORMANCE_CALIBRATION_PROBE = 'integer-spin-300000-probe-8x40ms-v1' as const

/** A raw run's calibration: the manifest's reference and the probe it ran. */
export interface PerformanceRunCalibration {
  readonly reference: PerformanceRunCalibrationReference
  readonly probe: typeof PERFORMANCE_CALIBRATION_PROBE
}

/** A document's observations' loop p50 and p90, in schedule order per phase. */
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
    referenceP50Ms: reference.referenceP50Ms
  })
}

/** Gathers observations' loop p50 and p90 per phase, in the order given. */
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
 * Validates a raw run's calibration record against its target manifest: the
 * manifest's reference, the probe, and each observation's loop p50 and p90.
 * The numbers are information; no value makes an observation invalid.
 */
export function validatePerformanceRunCalibration(
  input: Readonly<{
    calibration: unknown
    documents: readonly Readonly<{ id: string, calibration: unknown }>[]
    warmupSamples: number
    measuredSamples: number
  }>,
  reference: PerformanceRunCalibrationReference,
  label: string
): void {
  const calibration = recordOf(input.calibration, `${label} calibration`)
  if (JSON.stringify(Object.keys(calibration).sort()) !== JSON.stringify(['probe', 'reference'])) {
    throw new Error(`${label} calibration must hold exactly reference and probe`)
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
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
          throw new Error(`${label} ${document.id} ${phase} observation ${String(index + 1)} calibration p50 is invalid`)
        }
        if (typeof high !== 'number' || !Number.isFinite(high) || high < value) {
          throw new Error(`${label} ${document.id} ${phase} observation ${String(index + 1)} calibration p90 is invalid`)
        }
      }
    }
  }
}

/** Validates the human-owned Phase 0 measurement protocol and target record. */
export function validateCriticMarkupPerformanceTargets(value: unknown): void {
  const manifest = recordOf(value, 'Performance target manifest')
  if (manifest.schema !== 'marktext-criticmarkup-performance-targets-v13') {
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
