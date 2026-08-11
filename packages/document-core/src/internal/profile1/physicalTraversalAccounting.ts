export interface Profile1PhysicalTraversalCountsV1 {
  readonly intrinsicSource: number
  readonly total: number
  readonly intrinsicSourceUnits: number
  readonly markerBearingIntrinsicSource: number
  readonly plainMarkdownLaneUnits: number
  readonly forkAstRegionEmissions: number
  readonly forkAstRegionUnits: number
  readonly forkAstRegionReuses: number
  /** Regions carried by splice provenance — no slice, no key, no digest. */
  readonly forkAstRegionProvenanceReuses: number
  readonly commentProjectionPreparations: number
  readonly commentProjectionPreparationUnits: number
  readonly astCacheTemplateConstructions: number
  readonly lineMaterializationChunkWalks: number
  readonly longLineMaterializationRetained: number
  readonly longLineMaterializationEvicted: number
  readonly retainedFactInputStructuralUnits: number
  readonly retainedFactOutputStructuralUnits: number
}

/**
 * Engine-owned physical parse-work record. Every counter lives on the
 * recorder an engine creates for itself — there is no process-global counter
 * bank and no reset seam. Lazily materialized parse products (fork-AST
 * reads, Comment displays) capture the recorder of the parse that created
 * them, so late work still attributes to the owning engine.
 */
export interface Profile1PhysicalTraversalRecorderV1 {
  readonly recordIntrinsicSourceTraversal: (
    markerBearing: boolean,
    sourceUnits: number
  ) => void
  readonly recordPlainMarkdownLaneUnits: (sourceUnits: number) => void
  readonly recordForkAstRegionEmission: (units: number) => void
  readonly recordForkAstRegionProvenanceReuse: () => void
  readonly recordForkAstRegionReuse: () => void
  readonly recordCommentProjectionPreparation: (units: number) => void
  readonly recordAstCacheTemplateConstruction: () => void
  readonly recordLineMaterializationChunkWalk: () => void
  readonly recordLongLineMaterializationRetained: () => void
  readonly recordLongLineMaterializationEvicted: () => void
  /**
   * Records input/output structure cardinality at a retained-fact assembly
   * seam. These are size signals, not operation counts: repeated and failed
   * internal walks are deliberately not inferred from the cardinalities.
   */
  readonly recordRetainedFactStructure: (
    inputUnits: number,
    outputUnits: number
  ) => void
  readonly counts: () => Profile1PhysicalTraversalCountsV1
}

export function zeroPhysicalTraversalCountsV1():
Profile1PhysicalTraversalCountsV1 {
  return Object.freeze({
    intrinsicSource: 0,
    total: 0,
    intrinsicSourceUnits: 0,
    markerBearingIntrinsicSource: 0,
    plainMarkdownLaneUnits: 0,
    forkAstRegionEmissions: 0,
    forkAstRegionUnits: 0,
    forkAstRegionReuses: 0,
    forkAstRegionProvenanceReuses: 0,
    commentProjectionPreparations: 0,
    commentProjectionPreparationUnits: 0,
    astCacheTemplateConstructions: 0,
    lineMaterializationChunkWalks: 0,
    longLineMaterializationRetained: 0,
    longLineMaterializationEvicted: 0,
    retainedFactInputStructuralUnits: 0,
    retainedFactOutputStructuralUnits: 0
  })
}

export function createPhysicalTraversalRecorderV1():
Profile1PhysicalTraversalRecorderV1 {
  let intrinsicSourceTraversals = 0
  let markerBearingIntrinsicTraversals = 0
  let intrinsicSourceUnits = 0
  let plainMarkdownLaneUnits = 0
  let forkAstRegionEmissions = 0
  let forkAstRegionUnits = 0
  let forkAstRegionReuses = 0
  let forkAstRegionProvenanceReuses = 0
  let commentProjectionPreparations = 0
  let commentProjectionPreparationUnits = 0
  let astCacheTemplateConstructions = 0
  let lineMaterializationChunkWalks = 0
  let longLineMaterializationRetained = 0
  let longLineMaterializationEvicted = 0
  let retainedFactInputStructuralUnits = 0
  let retainedFactOutputStructuralUnits = 0
  return Object.freeze({
    recordIntrinsicSourceTraversal: (
      markerBearing: boolean,
      sourceUnits: number
    ): void => {
      intrinsicSourceTraversals += 1
      intrinsicSourceUnits += sourceUnits
      if (markerBearing) {
        markerBearingIntrinsicTraversals += 1
      }
    },
    recordPlainMarkdownLaneUnits: (sourceUnits: number): void => {
      plainMarkdownLaneUnits += sourceUnits
    },
    recordForkAstRegionEmission: (units: number): void => {
      forkAstRegionEmissions += 1
      forkAstRegionUnits += units
    },
    recordForkAstRegionProvenanceReuse: (): void => {
      forkAstRegionProvenanceReuses += 1
    },
    recordForkAstRegionReuse: (): void => {
      forkAstRegionReuses += 1
    },
    recordCommentProjectionPreparation: (units: number): void => {
      commentProjectionPreparations += 1
      commentProjectionPreparationUnits += units
    },
    recordAstCacheTemplateConstruction: (): void => {
      astCacheTemplateConstructions += 1
    },
    recordLineMaterializationChunkWalk: (): void => {
      lineMaterializationChunkWalks += 1
    },
    recordLongLineMaterializationRetained: (): void => {
      longLineMaterializationRetained += 1
    },
    recordLongLineMaterializationEvicted: (): void => {
      longLineMaterializationEvicted += 1
    },
    recordRetainedFactStructure: (
      inputUnits: number,
      outputUnits: number
    ): void => {
      retainedFactInputStructuralUnits += inputUnits
      retainedFactOutputStructuralUnits += outputUnits
    },
    counts: (): Profile1PhysicalTraversalCountsV1 => Object.freeze({
      intrinsicSource: intrinsicSourceTraversals,
      total: intrinsicSourceTraversals,
      intrinsicSourceUnits,
      markerBearingIntrinsicSource: markerBearingIntrinsicTraversals,
      plainMarkdownLaneUnits,
      forkAstRegionEmissions,
      forkAstRegionUnits,
      forkAstRegionReuses,
      forkAstRegionProvenanceReuses,
      commentProjectionPreparations,
      commentProjectionPreparationUnits,
      astCacheTemplateConstructions,
      lineMaterializationChunkWalks,
      longLineMaterializationRetained,
      longLineMaterializationEvicted,
      retainedFactInputStructuralUnits,
      retainedFactOutputStructuralUnits
    })
  })
}
