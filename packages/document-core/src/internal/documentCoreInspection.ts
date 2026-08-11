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
  readonly canonicalFactIndexUnits: number
  readonly regionalProjectionPreparationUnits: number
  readonly regionalMarkupEventUnits: number
  readonly regionalAstMaterializedNodes: number
  readonly regionalCoordinateSegments: number
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
  readonly sourceReconstructionOutputUnits: number
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
