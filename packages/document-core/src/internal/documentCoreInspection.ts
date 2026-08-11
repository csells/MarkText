export interface DocumentCoreInspection {
  readonly intrinsicSourceUnits: number
  readonly documentParses: number
  readonly documentParseSourceUnits: number
  readonly regionalIntrinsicSourceUnits: number
  readonly regionalFastApplies: number
  readonly documentProjectionPreparationUnits: number
  readonly documentMarkupEventUnits: number
  readonly documentAstMaterializedNodes: number
  readonly documentCoordinateSegments: number
  readonly documentAnnotationMaterializedNodes: number
  /** Strong revision-owned parser product graphs currently retained. */
  readonly fullProductStoresStrongCurrent: number
  /** Peak simultaneous strong revision-owned parser product graphs. */
  readonly fullProductStoresStrongPeak: number
  /** Strong revision-owned parser product release operations. */
  readonly fullProductStoreReleases: number
  readonly documentRetainedFactOutputStructuralUnits: number
  readonly canonicalFactIndexUnits: number
  readonly regionalProjectionPreparationUnits: number
  readonly regionalMarkupEventUnits: number
  readonly regionalAstMaterializedNodes: number
  readonly regionalCoordinateSegments: number
  readonly regionalCommentProjectionPreparationUnits: number
  readonly regionalCommentAstMaterializedNodes: number
  readonly regionalCommentCoordinateSegments: number
  readonly regionalInventoryBuildUnits: number
  readonly regionalInventoryLookupComparisons: number
  readonly regionalInventoryNodesVisited: number
  readonly regionalInventoryNodesAllocated: number
  readonly regionalInventoryNodesShared: number
  readonly regionalInventoryChangedLeaves: number
  readonly regionalInventoryRootsAttempted: number
  readonly regionalInventoryRootsCommitted: number
  readonly regionalInventoryLocalAnnotationMaterializedNodes: number
  readonly regionalInventoryCandidateRegionParses: number
  readonly regionalInventoryCandidateRegionParseSourceUnits: number
  readonly regionalInventoryAnnotationMaterializedNodes: number
  readonly retainedFactInputStructuralUnits: number
  readonly retainedFactOutputStructuralUnits: number
  readonly retainedInitialBuildUnits: number
  readonly retainedIndexLookupComparisons: number
  readonly retainedOverlayNodeVisits: number
  readonly retainedOverlayNodesAllocated: number
  readonly retainedOverlayNodesReused: number
  readonly retainedChangedLeafUnits: number
  readonly retainedCommittedUpdates: number
  readonly retainedLocalIndexUnitsCopied: number
  readonly retainedOverlayMaximumDepth: number
  readonly sourceRopeNodeVisits: number
  readonly sourceRopeNodesAllocated: number
  readonly sourceRopePiecesAllocated: number
  readonly sourceRopeCoalesces: number
  readonly sourceRopeRebalances: number
  readonly sourceRopeMaximumDepth: number
  readonly sourceRopeMaximumHeight: number
  readonly sourceRopeCurrentHeight: number
  readonly sourceRopeCurrentPieces: number
  readonly sourceRopeMaximumPieces: number
  readonly sourceSliceCalls: number
  readonly sourceSlicePieces: number
  readonly sourceSliceUnits: number
  readonly sourceMaterializations: number
  readonly sourceMaterializationPieces: number
  readonly sourceMaterializationOutputUnits: number
  readonly sourceGetterHits: number
  readonly sourceGetterMisses: number
  readonly sourceCompactions: number
  readonly sourceCompactionInputPieces: number
  /** Reduction in the conservative retained-buffer upper bound. */
  readonly sourceCompactionRetainedUpperBoundReductionUnits: number
  readonly sourceGetterMaterializations: number
  readonly sourceGetterMaterializationOutputUnits: number
  readonly sourceFallbackMaterializations: number
  readonly sourceFallbackMaterializationOutputUnits: number
  readonly sourceRebaseMaterializations: number
  readonly sourceRebaseMaterializationOutputUnits: number
  readonly sourceProjectionMaterializations: number
  readonly sourceProjectionMaterializationOutputUnits: number
  readonly sourceReopenMaterializations: number
  readonly sourceReopenMaterializationOutputUnits: number
  readonly sourceReopenComparisonUnits: number
  readonly sourceRopeRootsAttempted: number
  readonly sourceRopeRootsCommitted: number
  readonly sourceRebases: number
  /** Conservative retained-buffer upper bound for the committed head. */
  readonly sourceCurrentRetainedBufferUnitsUpperBound: number
}

const READERS = new WeakMap<
  object,
  () => DocumentCoreInspection
>()

/** Package-private negative control for incremental parser tests. */
export function registerDocumentCoreInspection(
  core: object,
  reader: () => DocumentCoreInspection
): void {
  READERS.set(core, reader)
}

export function inspectDocumentCore(core: object): DocumentCoreInspection {
  const reader = READERS.get(core)
  if (reader === undefined) {
    throw new Error('Document core inspection is unavailable')
  }
  return Object.freeze({ ...reader() })
}
