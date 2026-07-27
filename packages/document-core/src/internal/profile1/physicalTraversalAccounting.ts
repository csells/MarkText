export interface Profile1PhysicalTraversalCountsV1 {
  readonly intrinsicSource: number
  readonly total: number
  readonly intrinsicSourceUnits: number
  readonly forkAstRegionEmissions: number
  readonly forkAstRegionUnits: number
  readonly forkAstRegionReuses: number
  readonly commentProjectionPreparations: number
  readonly commentProjectionPreparationUnits: number
}

let intrinsicSourceTraversals = 0
let markerBearingIntrinsicTraversals = 0
let intrinsicSourceUnits = 0
let forkAstRegionEmissions = 0
let forkAstRegionUnits = 0
let forkAstRegionReuses = 0
let commentProjectionPreparations = 0
let commentProjectionPreparationUnits = 0

export function recordIntrinsicSourceTraversalV1(
  markerBearing: boolean,
  sourceUnits: number
): void {
  intrinsicSourceTraversals += 1
  intrinsicSourceUnits += sourceUnits
  if (markerBearing) {
    markerBearingIntrinsicTraversals += 1
  }
}

export function recordForkAstRegionEmissionV1(units: number): void {
  forkAstRegionEmissions += 1
  forkAstRegionUnits += units
}

export function recordForkAstRegionReuseV1(): void {
  forkAstRegionReuses += 1
}

export function recordCommentProjectionPreparationV1(units: number): void {
  commentProjectionPreparations += 1
  commentProjectionPreparationUnits += units
}

export function readProfile1PhysicalTraversalCountsV1():
Profile1PhysicalTraversalCountsV1 {
  return Object.freeze({
    intrinsicSource: intrinsicSourceTraversals,
    total: intrinsicSourceTraversals,
    intrinsicSourceUnits,
    forkAstRegionEmissions,
    forkAstRegionUnits,
    forkAstRegionReuses,
    commentProjectionPreparations,
    commentProjectionPreparationUnits
  })
}

export function __profile1PhysicalTraversalCountsV1():
Profile1PhysicalTraversalCountsV1 {
  return readProfile1PhysicalTraversalCountsV1()
}

export function __markerBearingIntrinsicTraversalsV1(): number {
  return markerBearingIntrinsicTraversals
}

export function __resetProfile1PhysicalTraversalCountsV1(): void {
  intrinsicSourceTraversals = 0
  markerBearingIntrinsicTraversals = 0
  intrinsicSourceUnits = 0
  forkAstRegionEmissions = 0
  forkAstRegionUnits = 0
  forkAstRegionReuses = 0
  commentProjectionPreparations = 0
  commentProjectionPreparationUnits = 0
}

export function __resetMarkerBearingIntrinsicTraversalsV1(): void {
  markerBearingIntrinsicTraversals = 0
}
