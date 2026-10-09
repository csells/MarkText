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
  /** Whole-document annotation fact tables built for readers of a revision's parse. */
  readonly annotationFactTables: number
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

const DOCUMENT_PLANNERS = new WeakSet<object>()

/**
 * Package-private negative control for regional planning tests: the core
 * plans every key from its document parse, as it does when no window can
 * prove the key's result.
 */
export function planFromDocumentParse(core: object): void {
  DOCUMENT_PLANNERS.add(core)
}

export function plansFromDocumentParse(core: object): boolean {
  return DOCUMENT_PLANNERS.has(core)
}

const GENERAL_PLANNERS = new WeakSet<object>()

/**
 * Package-private negative control for the regional planners themselves: the
 * core plans every key from its document parse with the general compile
 * alone, so a planner that answers a key another way is caught.
 */
export function planFromGeneralCompile(core: object): void {
  DOCUMENT_PLANNERS.add(core)
  GENERAL_PLANNERS.add(core)
}

export function plansFromGeneralCompile(core: object): boolean {
  return GENERAL_PLANNERS.has(core)
}

const UNBUDGETED_SEARCHES = new WeakSet<object>()

/**
 * Package-private switch for planner agreement tests: the core's spelling
 * searches run without the document-level search budget, as the references
 * do, so a planner is compared with them on its own.
 */
export function searchWithoutBudget(core: object): void {
  UNBUDGETED_SEARCHES.add(core)
}

export function searchesWithoutBudget(core: object): boolean {
  return UNBUDGETED_SEARCHES.has(core)
}

let readerViewChecks = false

/**
 * Package-private check for window previews: each candidate read from its
 * reader views is parsed whole as well, and the two must agree exactly.
 */
export function checkReaderViews(enabled: boolean): void {
  readerViewChecks = enabled
}

export function checksReaderViews(): boolean {
  return readerViewChecks
}

let readingWindowChecks = false

/**
 * Package-private check for a key's reading change read off a window of the
 * edited document: the document is parsed whole as well, and the two
 * changes must agree exactly.
 */
export function checkReadingWindows(enabled: boolean): void {
  readingWindowChecks = enabled
}

export function checksReadingWindows(): boolean {
  return readingWindowChecks
}

export function inspectDocumentCore(core: object): DocumentCoreInspection {
  const reader = READERS.get(core)
  if (reader === undefined) {
    throw new Error('Document core inspection is unavailable')
  }
  return Object.freeze({ ...reader() })
}

const LEAF_READERS = new WeakMap<object, (revision: object) => readonly unknown[] | undefined>()

/** Package-private: a revision's regional inventory leaves, for equivalence tests. */
export function registerRegionalLeaves(core: object, reader: (revision: object) => readonly unknown[] | undefined): void {
  LEAF_READERS.set(core, reader)
}

export function inspectRegionalLeaves(core: object, revision: object): readonly unknown[] | undefined {
  return LEAF_READERS.get(core)?.(revision)
}
