export const PERFORMANCE_SAMPLE_LIFECYCLE =
  'fresh-application-profile-per-observation-v1' as const

export interface PerformanceSampleLifecycleCounts {
  readonly applicationLaunchCount: number
  readonly uniqueProfileCount: number
  readonly applicationCloseCount: number
  readonly profileCleanupCount: number
}

export interface PerformanceObservationIsolation {
  readonly profile: string
}

export interface PerformanceObservationLifecycle<
  Declaration,
  Isolation extends PerformanceObservationIsolation,
  Application,
  Measurement
> {
  readonly createIsolation: (
    declaration: Declaration,
    index: number
  ) => Promise<Isolation>
  readonly launchAndPrepare: (
    declaration: Declaration,
    isolation: Isolation
  ) => Promise<Application>
  readonly measure: (
    application: Application,
    declaration: Declaration,
    isolation: Isolation
  ) => Promise<Measurement>
  readonly close: (
    application: Application,
    declaration: Declaration,
    isolation: Isolation
  ) => Promise<void>
  readonly cleanup: (
    declaration: Declaration,
    isolation: Isolation
  ) => Promise<void>
}

export interface PerformanceObservationResults<Measurement> {
  readonly measurements: readonly Measurement[]
  /** Attempts judged invalid and run again, in the order they ran. */
  readonly invalidAttempts: readonly Readonly<{
    readonly index: number
    readonly attempt: number
    readonly measurement: Measurement
  }>[]
  readonly counts: Readonly<PerformanceSampleLifecycleCounts>
}

/**
 * How a run judges each observation: an invalid one (measured on a slowed
 * CPU) is neither kept nor scored, and the observation runs again in a fresh
 * application and profile, up to `maximumAttempts` attempts.
 */
export interface PerformanceObservationValidity<Measurement> {
  readonly maximumAttempts: number
  readonly judge: (measurement: Measurement) => 'valid' | 'invalid'
}

/** Every attempt of an observation was invalid: the run proves nothing and does not pass. */
export class PerformanceObservationInconclusiveError extends Error {
  constructor(readonly index: number, readonly attempts: number) {
    super(`Performance observation ${String(index + 1)} is inconclusive: all ${String(attempts)} attempts ran on a slowed CPU`)
    this.name = 'PerformanceObservationInconclusiveError'
  }
}

const throwObservationFailures = (failures: readonly unknown[]): void => {
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      'Performance observation and lifecycle cleanup both failed'
    )
  }
}

export const runIsolatedPerformanceObservations = async<
  Declaration,
  Isolation extends PerformanceObservationIsolation,
  Application,
  Measurement
>(
  declarations: readonly Declaration[],
  lifecycle: PerformanceObservationLifecycle<
    Declaration,
    Isolation,
    Application,
    Measurement
  >,
  validity?: PerformanceObservationValidity<Measurement>
): Promise<PerformanceObservationResults<Measurement>> => {
  const measurements: Measurement[] = []
  const invalidAttempts: Array<{ index: number, attempt: number, measurement: Measurement }> = []
  const profiles = new Set<string>()
  let applicationLaunchCount = 0
  let applicationCloseCount = 0
  let profileCleanupCount = 0
  // Every attempt takes its own isolation, numbered after the observations.
  let isolationIndex = declarations.length
  const maximumAttempts = validity?.maximumAttempts ?? 1
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1) {
    throw new Error('Performance observation maximumAttempts must be a positive integer')
  }

  for (let index = 0; index < declarations.length; index += 1) {
    const declaration = declarations[index]
    if (declaration === undefined) {
      throw new Error('Performance observation declaration is missing')
    }
    for (let attempt = 1; ; attempt += 1) {
      const isolation = await lifecycle.createIsolation(
        declaration,
        attempt === 1 ? index : isolationIndex++
      )
      const failures: unknown[] = []
      let application!: Application
      let applicationLaunched = false
      let measurement!: Measurement
      let measurementCompleted = false

      if (isolation.profile.trim().length === 0) {
        failures.push(new Error('Performance observation profile is required'))
      } else if (profiles.has(isolation.profile)) {
        failures.push(new Error(
          `Performance observation profile is not unique: ${isolation.profile}`
        ))
      } else {
        profiles.add(isolation.profile)
        try {
          application = await lifecycle.launchAndPrepare(declaration, isolation)
          applicationLaunched = true
          applicationLaunchCount += 1
          measurement = await lifecycle.measure(
            application,
            declaration,
            isolation
          )
          measurementCompleted = true
        } catch (error) {
          failures.push(error)
        }
      }

      if (applicationLaunched) {
        try {
          await lifecycle.close(application, declaration, isolation)
          applicationCloseCount += 1
        } catch (error) {
          failures.push(error)
        }
      }
      try {
        await lifecycle.cleanup(declaration, isolation)
        profileCleanupCount += 1
      } catch (error) {
        failures.push(error)
      }
      throwObservationFailures(failures)
      if (!measurementCompleted) {
        throw new Error('Performance observation completed without a measurement')
      }
      if (validity === undefined || validity.judge(measurement) === 'valid') {
        measurements.push(measurement)
        break
      }
      invalidAttempts.push(Object.freeze({ index, attempt, measurement }))
      if (attempt >= maximumAttempts) {
        throw new PerformanceObservationInconclusiveError(index, attempt)
      }
    }
  }

  return Object.freeze({
    measurements: Object.freeze(measurements),
    invalidAttempts: Object.freeze(invalidAttempts),
    counts: Object.freeze({
      applicationLaunchCount,
      uniqueProfileCount: profiles.size,
      applicationCloseCount,
      profileCleanupCount
    })
  })
}
