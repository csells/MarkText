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

/** Validates the human-owned Phase 0 measurement protocol and target record. */
export function validateCriticMarkupPerformanceTargets(value: unknown): void {
  const manifest = recordOf(value, 'Performance target manifest')
  if (manifest.schema !== 'marktext-criticmarkup-performance-targets-v7') {
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
  nonEmptyString(environment.hardware, 'Measurement hardware')
  nonEmptyString(environment.os, 'Measurement OS')
  nonEmptyString(environment.build, 'Measurement build')

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
    !/fresh application.*fresh profile.*every observation.*rotat.*round-robin.*pre-timing readiness.*two consecutive.*Electron.*CGWindow.*5 seconds.*only transient origin mismatch.*post-measurement.*one-shot strict.*launch.*readiness.*excluded.*no retries.*drift diagnostic.*no.*threshold.*cleanup.*outside.*timed metric/iu
      .test(sampling.scenarios)
  ) {
    throw new Error(
      'Sampling scenarios must define fresh isolation, rotating order, bounded native readiness convergence, one-shot post-measurement validation, no retries, threshold-free drift diagnostics, and metric exclusions'
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
