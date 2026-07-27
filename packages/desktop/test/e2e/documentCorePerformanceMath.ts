export function measuredDoublingRatio(
  lowerElapsedMs: number,
  upperElapsedMs: number
): number {
  if (
    !Number.isFinite(lowerElapsedMs) ||
    !Number.isFinite(upperElapsedMs) ||
    lowerElapsedMs < 0 ||
    upperElapsedMs < 0
  ) {
    throw new RangeError('Performance durations must be finite and nonnegative')
  }
  return lowerElapsedMs === 0
    ? Number.POSITIVE_INFINITY
    : upperElapsedMs / lowerElapsedMs
}

export interface BoundedViewportObservation {
  readonly targetActive: boolean
  readonly connected: boolean
  readonly mode: string | null
  readonly contentEditable: string | null
  readonly ariaReadOnly: string | null
  readonly domNodes: number
  readonly carrierStart: number | null
  readonly carrierEnd: number | null
  readonly width: number
  readonly height: number
}

export function isUsableBoundedViewport(
  observation: BoundedViewportObservation,
  expected: Readonly<{
    readonly sourceUnits: number
    readonly maximumDomNodes: number
  }>
): boolean {
  return observation.targetActive &&
    observation.connected &&
    (
      observation.mode === 'semantic' ||
      observation.mode === 'source-only'
    ) &&
    observation.contentEditable === 'true' &&
    observation.ariaReadOnly === 'false' &&
    observation.domNodes > 0 &&
    observation.domNodes <= expected.maximumDomNodes &&
    observation.carrierStart === 0 &&
    observation.carrierEnd === expected.sourceUnits &&
    observation.width > 0 &&
    observation.height > 0
}

export interface MainStageMeasurement {
  readonly path: string
  readonly maximumMs: number
}

export interface MainStageAggregate {
  readonly maximumMs: number
  readonly maximumPath: string
  readonly measurements: readonly MainStageMeasurement[]
}

export function aggregateMainStageMeasurements(
  measurements: readonly MainStageMeasurement[]
): MainStageAggregate {
  if (measurements.length === 0) {
    throw new RangeError('Main-stage evidence must contain at least one path')
  }
  const paths = new Set<string>()
  const retained = measurements.map((measurement) => {
    if (
      measurement.path.length === 0 ||
      !Number.isFinite(measurement.maximumMs) ||
      measurement.maximumMs < 0
    ) {
      throw new RangeError('Main-stage evidence must be finite and nonnegative')
    }
    if (paths.has(measurement.path)) {
      throw new RangeError(
        `Duplicate main-stage evidence path ${measurement.path}`
      )
    }
    paths.add(measurement.path)
    return Object.freeze({ ...measurement })
  })
  const worst = retained.reduce((current, candidate) =>
    candidate.maximumMs > current.maximumMs ? candidate : current)
  return Object.freeze({
    maximumMs: worst.maximumMs,
    maximumPath: worst.path,
    measurements: Object.freeze(retained)
  })
}
