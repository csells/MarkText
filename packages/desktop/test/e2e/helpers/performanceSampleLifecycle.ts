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
  readonly counts: Readonly<PerformanceSampleLifecycleCounts>
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
  >
): Promise<PerformanceObservationResults<Measurement>> => {
  const measurements: Measurement[] = []
  const profiles = new Set<string>()
  let applicationLaunchCount = 0
  let applicationCloseCount = 0
  let profileCleanupCount = 0

  for (let index = 0; index < declarations.length; index += 1) {
    const declaration = declarations[index]
    if (declaration === undefined) {
      throw new Error('Performance observation declaration is missing')
    }
    const isolation = await lifecycle.createIsolation(declaration, index)
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
    measurements.push(measurement)
  }

  return Object.freeze({
    measurements: Object.freeze(measurements),
    counts: Object.freeze({
      applicationLaunchCount,
      uniqueProfileCount: profiles.size,
      applicationCloseCount,
      profileCleanupCount
    })
  })
}
