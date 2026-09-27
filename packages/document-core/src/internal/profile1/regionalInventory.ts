import type {
  CriticMarkupNode,
  ExecutionBudgetId,
  MarkdownNode,
  MarkdownOptionsV1,
  NodeId,
  ResourceDiagnostic,
  SourceRange
} from '../../revision.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from '../../resourcePolicy.js'
import {
  createProfile1DocumentReuseCache,
  parseProfile1Document,
  type Profile1DocumentProducts,
  type RetainedPassSourceEdit
} from '../profile1Document.js'
import type { CanonicalSourceView } from '../persistentCanonicalSource.js'
import type { Profile1PhysicalTraversalRecorderV1 } from './physicalTraversalAccounting.js'
import {
  createPlainParagraphRetainedIndex,
  type PlainParagraphIndexRecorder,
  type PlainParagraphRetainedIndex
} from './plainParagraphRetainedIndex.js'

export interface RegionalInventoryRecorder {
  readonly recordBuildUnit: () => void
  readonly recordLookupComparison: () => void
  readonly recordNodeVisited: () => void
  readonly recordNodeAllocated: () => void
  readonly recordNodeShared: () => void
  readonly recordChangedLeaf: () => void
  readonly recordRootAttempted: () => void
  readonly recordRootCommitted: () => void
  readonly recordCandidateRegionParse: (sourceUnits: number) => void
  readonly recordAnnotationMaterialized: () => void
}

export interface RegionalInventoryAnnotation {
  readonly kind: CriticMarkupNode['kind']
  readonly range: Readonly<{ readonly start: number; readonly end: number }>
  readonly arms: readonly Readonly<{
    readonly name: 'content' | 'old' | 'new' | 'comment'
    readonly range: Readonly<{ readonly start: number; readonly end: number }>
    readonly annotations: readonly RegionalInventoryAnnotation[]
  }>[]
}

export interface RegionalInventorySpan {
  readonly source: Readonly<{ readonly start: number; readonly end: number }>
  readonly syntax: Readonly<{ readonly start: number; readonly end: number }>
  readonly events: Readonly<{ readonly start: number; readonly end: number }>
}

export interface RegionalInventoryCommentImpact {
  readonly nodeOrdinal: number
  readonly nextProducts: Profile1DocumentProducts
  readonly nextWindow: string
  readonly nextSourceStart: number
  readonly previous: Readonly<{
    readonly annotation: Readonly<{ readonly start: number; readonly end: number }>
    readonly payload: Readonly<{ readonly start: number; readonly end: number }>
    readonly projection: Readonly<{ readonly start: number; readonly end: number }>
  }>
}

export interface RegionalInventoryAdmission {
  readonly kind: 'admitted'
  readonly nextInventory: RegionalInventory
  readonly previous: RegionalInventorySpan
  readonly next: RegionalInventorySpan
  readonly nextProducts: Profile1DocumentProducts
  readonly nextWindow: string
  /**
   * Present when the products were parsed with unchanged context around the
   * replaced blocks: the products' document offsets, and the replaced
   * blocks' local source and projection ranges within them.
   */
  readonly window?: Readonly<{
    readonly source: number
    readonly syntax: number
    readonly blocks: Readonly<{
      readonly source: Readonly<{ readonly start: number; readonly end: number }>
      readonly syntax: Readonly<{ readonly start: number; readonly end: number }>
    }>
  }>
  readonly commentImpacts: readonly RegionalInventoryCommentImpact[]
}

export interface RegionalInventoryFallback {
  readonly kind: 'fallback'
  readonly reason:
    | 'definition-or-reference-facts'
    | 'fixed-region-ineligible'
    | 'subscription-not-found'
}

export interface RegionalInventoryResourceFailure {
  readonly kind: 'resource-failure'
  readonly fatalDiagnostic: ResourceDiagnostic
}

export type RegionalInventoryApplyResult =
  | RegionalInventoryAdmission
  | RegionalInventoryFallback
  | RegionalInventoryResourceFailure

export interface RegionalInventoryPreview {
  readonly kind: 'validated'
  readonly sourceStart: number
  readonly nextProducts: Profile1DocumentProducts
  readonly nextWindow: string
  /**
   * Present when the edit changes block or annotation structure, which a
   * payload splice cannot assume: whether the edit touches an existing
   * annotation, and how many CriticMarkup markers the window gains.
   */
  readonly structural?: Readonly<{ touchesAnnotation: boolean, markerDelta: number }>
}

type RegionalInventoryArguments = [
  previousInventory: RegionalInventory,
  previousSource: CanonicalSourceView,
  nextSource: CanonicalSourceView,
  edits: readonly RetainedPassSourceEdit[],
  subscriptions: readonly RegionalInventorySubscription[],
  executionBudget: ExecutionBudgetId,
  markdownOptions: MarkdownOptionsV1,
  physicalRecorder: Profile1PhysicalTraversalRecorderV1
]

type RegionalInventoryPreviewResult = RegionalInventoryPreview | RegionalInventoryFallback | RegionalInventoryResourceFailure

export interface RegionalInventorySubscription {
  readonly name: 'markup' | 'comment'
  readonly annotationRange?: Readonly<{
    readonly start: number
    readonly end: number
  }>
}

interface CapsuleArm {
  readonly name: 'content' | 'old' | 'new' | 'comment'
  readonly start: number
  readonly end: number
  readonly children: readonly number[]
}

interface CapsuleNode {
  readonly kind: CriticMarkupNode['kind']
  readonly start: number
  readonly end: number
  readonly arms: readonly CapsuleArm[]
  readonly commentProjectionLength?: number
  readonly commentMarkdownTopology?: readonly string[]
}

interface AnnotationCapsule {
  readonly roots: readonly number[]
  readonly nodes: readonly CapsuleNode[]
}

interface MarkerCapsule {
  readonly kind: CriticMarkupNode['kind']
  readonly role: 'open' | 'separator' | 'close'
  readonly start: number
  readonly end: number
  readonly relation: number | null
  readonly action?: 'matched' | 'non-top' | 'unmatched'
}

interface MeasuredRegionLeaf {
  readonly kind: 'region'
  readonly sourceLength: number
  readonly syntaxLength: number
  readonly eventCount: number
  readonly annotations: AnnotationCapsule
  readonly markers: readonly MarkerCapsule[]
  readonly tapeRoles: readonly string[]
  readonly markdownTopology: readonly string[]
  readonly mappedKinds: readonly string[]
}

interface MeasuredGapLeaf {
  readonly kind: 'gap'
  readonly sourceLength: number
  readonly syntaxLength: number
  readonly eventCount: number
  /**
   * Local top-level block starts of a gap whose every block is plain,
   * CriticMarkup-free text with one public event and an unmapped projection.
   * It lets an edit reparse only its own blocks without allocating an
   * inventory node per block of a long plain run.
   */
  readonly plain?: PlainParagraphRetainedIndex
}

type RegionLeaf = MeasuredRegionLeaf | MeasuredGapLeaf

interface RegionBranch {
  readonly kind: 'branch'
  readonly left: RegionTree
  readonly right: RegionTree
  readonly leafCount: number
  readonly sourceLength: number
  readonly syntaxLength: number
  readonly eventCount: number
}

type RegionTree = RegionLeaf | RegionBranch

const inventoryBrand: unique symbol = Symbol('RegionalInventory')

export interface RegionalInventory {
  readonly [inventoryBrand]: true
}

interface InventoryValue extends RegionalInventory {
  readonly root: RegionTree
  readonly accountingUpperBound: number
  readonly logicalNodeLimit: number
  /**
   * The document spells no CriticMarkup marker candidate. Marker spelling is
   * tokenized against the whole document (an overlapping `{++}` reads as an
   * opener or a closer depending on markers far away), so an edit may add
   * markers regionally only to a document that has none.
   */
  readonly markerFree: boolean
  readonly dependencyPrefixEnd: number
  readonly recorder: RegionalInventoryRecorder
  readonly plainRecorder?: PlainParagraphIndexRecorder
}

interface LocatedLeaf {
  readonly leaf: RegionLeaf
  readonly ordinal: number
  readonly sourceStart: number
  readonly syntaxStart: number
  readonly eventStart: number
}

function range(start: number, end: number): Readonly<{
  readonly start: number
  readonly end: number
}> {
  return Object.freeze({ start, end })
}

function internalRange(start: number, end: number): SourceRange {
  return range(start, end) as SourceRange
}

function shiftResourceDiagnostic(
  diagnostic: ResourceDiagnostic,
  sourceDelta: number
): ResourceDiagnostic {
  return Object.freeze({
    kind: diagnostic.kind,
    code: diagnostic.code,
    range: internalRange(
      diagnostic.range.start + sourceDelta,
      diagnostic.range.end + sourceDelta
    ),
    metadata: diagnostic.metadata
  })
}

function nodeRanges(
  roots: readonly CriticMarkupNode[],
  recorder: RegionalInventoryRecorder
): ReadonlyMap<NodeId, SourceRange> {
  const result = new Map<NodeId, SourceRange>()
  const pending = [...roots]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) break
    recorder.recordBuildUnit()
    result.set(node.nodeId, node.range)
    for (const arm of node.arms) {
      for (const child of arm.children) pending.push(child)
    }
  }
  return result
}

function exactSyntaxBoundaries(
  products: Profile1DocumentProducts,
  boundaries: readonly number[],
  recorder: RegionalInventoryRecorder
): readonly number[] | undefined {
  const segments = products.editing().mappedTape
  const result: number[] = []
  let segmentIndex = 0
  for (const boundary of boundaries) {
    let found: number | undefined
    while (segmentIndex < segments.length) {
      recorder.recordBuildUnit()
      const segment = segments[segmentIndex]
      if (segment === undefined) break
      if (segment.kind !== 'canonical') {
        segmentIndex += 1
        continue
      }
      const sourceEnd = segment.sourceStart +
        segment.projectedEnd - segment.projectedStart
      if (boundary < segment.sourceStart) break
      if (boundary <= sourceEnd) {
        found = segment.projectedStart + boundary - segment.sourceStart
        break
      }
      segmentIndex += 1
    }
    if (found === undefined) return undefined
    result.push(found)
  }
  return Object.freeze(result)
}

function leafOrdinalAt(
  boundaries: readonly number[],
  sourceOffset: number
): number {
  let low = 0
  let high = boundaries.length - 1
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if ((boundaries[middle + 1] ?? Infinity) <= sourceOffset) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}

function eventCounts(
  products: Profile1DocumentProducts,
  boundaries: readonly number[],
  recorder: RegionalInventoryRecorder
): readonly number[] {
  const counts = Array.from(
    { length: boundaries.length - 1 },
    () => 0
  )
  const ranges = nodeRanges(products.retainedIntrinsic?.roots ?? [], recorder)
  for (let ordinal = 0; ordinal < products.markup.eventCount; ordinal += 1) {
    recorder.recordBuildUnit()
    const event = products.markup.eventAt(ordinal)
    if (event.kind !== 'text') {
      const nodeRange = ranges.get(event.mark.nodeId)
      if (nodeRange !== undefined) {
        const leafOrdinal = leafOrdinalAt(boundaries, nodeRange.start)
        counts[leafOrdinal] = (counts[leafOrdinal] ?? 0) + 1
      }
      continue
    }
    let leafOrdinal = leafOrdinalAt(boundaries, event.sourceRange.start)
    while (leafOrdinal < counts.length) {
      recorder.recordBuildUnit()
      const start = Math.max(
        event.sourceRange.start,
        boundaries[leafOrdinal] ?? 0
      )
      const end = Math.min(
        event.sourceRange.end,
        boundaries[leafOrdinal + 1] ?? event.sourceRange.end
      )
      if (start < end) counts[leafOrdinal] = (counts[leafOrdinal] ?? 0) + 1
      if (end >= event.sourceRange.end) break
      leafOrdinal += 1
    }
  }
  return Object.freeze(counts)
}

function annotationCapsule(
  roots: readonly CriticMarkupNode[],
  sourceStart: number,
  products: Profile1DocumentProducts,
  recorder?: RegionalInventoryRecorder
): AnnotationCapsule {
  const ordered: CriticMarkupNode[] = []
  const ordinalByNode = new Map<CriticMarkupNode, number>()
  const pending = [...roots].reverse()
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined || ordinalByNode.has(node)) continue
    recorder?.recordBuildUnit()
    ordinalByNode.set(node, ordered.length)
    ordered.push(node)
    for (let armIndex = node.arms.length - 1; armIndex >= 0; armIndex -= 1) {
      const arm = node.arms[armIndex]
      if (arm === undefined) continue
      for (let childIndex = arm.children.length - 1; childIndex >= 0; childIndex -= 1) {
        const child = arm.children[childIndex]
        if (child !== undefined) pending.push(child)
      }
    }
  }
  return Object.freeze({
    roots: Object.freeze(roots.map(root => ordinalByNode.get(root) ?? -1)),
    nodes: Object.freeze(ordered.map(node => Object.freeze({
      kind: node.kind,
      start: node.range.start - sourceStart,
      end: node.range.end - sourceStart,
      arms: Object.freeze(node.arms.map(arm => Object.freeze({
        name: arm.name,
        start: arm.range.start - sourceStart,
        end: arm.range.end - sourceStart,
        children: Object.freeze(arm.children.map(child =>
          ordinalByNode.get(child) ?? -1
        ))
      }))),
      ...(node.kind === 'comment'
        ? {
          commentProjectionLength: products.commentDisplay(node.nodeId).source.length,
          commentMarkdownTopology: markdownTopology(
            [products.commentDisplay(node.nodeId).markdown.root],
            0,
            recorder
          )
        }
        : {})
    })))
  })
}

function markdownTopology(
  roots: readonly MarkdownNode[],
  rangeDelta: number,
  recorder?: RegionalInventoryRecorder
): readonly string[] {
  const result: string[] = []
  const pending = [...roots].reverse()
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) break
    recorder?.recordBuildUnit()
    const attributes = Object.entries(node.attributes)
      .filter(([name]) => name !== 'semanticStart' && name !== 'semanticEnd')
      .map(([name, value]) => {
        const normalized = typeof value === 'number' &&
          (name.endsWith('Start') || name.endsWith('End'))
          ? value - rangeDelta
          : value
        return `${name}=${String(normalized)}`
      }).join('\u0001')
    result.push(`${node.kind}:${node.childCount}:${attributes}`)
    for (let ordinal = node.childCount - 1; ordinal >= 0; ordinal -= 1) {
      pending.push(node.childAt(ordinal))
    }
  }
  return Object.freeze(result)
}

function markerCapsules(
  decisions: NonNullable<
    Profile1DocumentProducts['retainedIntrinsic']
  >['markerDecisions'],
  sourceStart: number,
  recorder?: RegionalInventoryRecorder
): readonly MarkerCapsule[] {
  const ordinalByRunId = new Map<number, number>()
  decisions.forEach((decision, ordinal) => {
    recorder?.recordBuildUnit()
    ordinalByRunId.set(decision.runId, ordinal)
  })
  return Object.freeze(decisions.map(decision => {
    recorder?.recordBuildUnit()
    const relationRunId = decision.role === 'open'
      ? decision.parentOpenRunId
      : decision.openerRunId
    return Object.freeze({
      kind: decision.kind,
      role: decision.role,
      start: decision.range.start - sourceStart,
      end: decision.range.end - sourceStart,
      relation: relationRunId === null || relationRunId === undefined
        ? null
        : ordinalByRunId.get(relationRunId) ?? -1,
      ...(decision.role === 'close' ? { action: decision.action } : {})
    })
  }))
}

function mappedKinds(
  products: Profile1DocumentProducts,
  syntaxStart: number,
  syntaxEnd: number
): readonly string[] {
  return Object.freeze(products.editing().mappedTape.flatMap(segment => {
    if (
      segment.projectedEnd <= syntaxStart ||
      segment.projectedStart >= syntaxEnd
    ) {
      return []
    }
    return [segment.kind === 'canonical'
      ? 'canonical'
      : `generated:${segment.affinity}`]
  }))
}

function createLeaf(
  products: Profile1DocumentProducts,
  sourceStart: number,
  sourceEnd: number,
  syntaxStart: number,
  syntaxEnd: number,
  eventCount: number
): MeasuredRegionLeaf {
  const retained = products.retainedIntrinsic
  const roots = (retained?.roots ?? []).filter(root =>
    sourceStart <= root.range.start && root.range.end <= sourceEnd
  )
  const markdownRoots: MarkdownNode[] = []
  const editingRoot = products.editing().markdown.root
  for (let ordinal = 0; ordinal < editingRoot.childCount; ordinal += 1) {
    const child = editingRoot.childAt(ordinal)
    if (syntaxStart <= child.range.start && child.range.end <= syntaxEnd) {
      markdownRoots.push(child)
    }
  }
  return createLeafFromParts(
    products,
    sourceStart,
    sourceEnd,
    syntaxStart,
    syntaxEnd,
    eventCount,
    roots,
    markdownRoots,
    Object.freeze((retained?.markerDecisions ?? []).filter(decision =>
      sourceStart <= decision.range.start && decision.range.end <= sourceEnd
    )),
    Object.freeze((retained?.tape ?? []).flatMap(run =>
      sourceStart <= run.range.start && run.range.end <= sourceEnd
        ? [run.role]
        : []
    )),
    mappedKinds(products, syntaxStart, syntaxEnd)
  )
}

function createLeafFromParts(
  products: Profile1DocumentProducts,
  sourceStart: number,
  sourceEnd: number,
  syntaxStart: number,
  syntaxEnd: number,
  eventCount: number,
  roots: readonly CriticMarkupNode[],
  markdownRoots: readonly MarkdownNode[],
  markerDecisions: readonly NonNullable<
    Profile1DocumentProducts['retainedIntrinsic']
  >['markerDecisions'][number][],
  tapeRoles: readonly string[],
  projectionKinds: readonly string[],
  recorder?: RegionalInventoryRecorder
): MeasuredRegionLeaf {
  return Object.freeze({
    kind: 'region',
    sourceLength: sourceEnd - sourceStart,
    syntaxLength: syntaxEnd - syntaxStart,
    eventCount,
    annotations: annotationCapsule(roots, sourceStart, products, recorder),
    markers: markerCapsules(markerDecisions, sourceStart, recorder),
    tapeRoles,
    markdownTopology: markdownTopology(markdownRoots, syntaxStart, recorder),
    mappedKinds: projectionKinds
  })
}

function branch(
  left: RegionTree,
  right: RegionTree,
  recorder: RegionalInventoryRecorder
): RegionBranch {
  recorder.recordNodeAllocated()
  return Object.freeze({
    kind: 'branch',
    left,
    right,
    leafCount: leafCount(left) + leafCount(right),
    sourceLength: left.sourceLength + right.sourceLength,
    syntaxLength: left.syntaxLength + right.syntaxLength,
    eventCount: left.eventCount + right.eventCount
  })
}

function leafCount(node: RegionTree): number {
  return node.kind === 'branch' ? node.leafCount : 1
}

function buildTree(
  leaves: readonly RegionLeaf[],
  low: number,
  high: number,
  recorder: RegionalInventoryRecorder
): RegionTree {
  if (high - low === 1) {
    const leaf = leaves[low]
    if (leaf === undefined) throw new Error('Regional inventory leaf is sparse')
    recorder.recordNodeAllocated()
    return leaf
  }
  const middle = low + Math.floor((high - low) / 2)
  return branch(
    buildTree(leaves, low, middle, recorder),
    buildTree(leaves, middle, high, recorder),
    recorder
  )
}

function inventoryValue(inventory: RegionalInventory): InventoryValue {
  return inventory as InventoryValue
}

/**
 * Last source coordinate owned by document-wide reference resolution. Edits
 * strictly after this prefix cannot change or shift any retained definition,
 * reference, or footnote dependency fact.
 */
export function referenceDependencyPrefixEnd(
  products: Profile1DocumentProducts
): number {
  let end = 0
  const pending: MarkdownNode[] = [products.original.markdown.root]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) break
    if (
      node.kind === 'definition' ||
      node.kind === 'footnote-definition' ||
      node.kind === 'footnote-reference' ||
      typeof node.attributes['referenceLabel'] === 'string'
    ) {
      end = Math.max(end, node.range.end)
    }
    for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
      pending.push(node.childAt(ordinal))
    }
  }
  return end
}

/**
 * A leaf-only parse cannot resolve a label against definitions retained in a
 * different leaf. Fail closed when the bounded candidate contains the
 * delimiter pair required by reference links, images, footnotes, or
 * definitions; a document parse can then resolve the dependency exactly.
 */
function containsPotentialReferenceDependency(source: string): boolean {
  const open = source.indexOf('[')
  return open !== -1 && source.indexOf(']', open + 1) !== -1
}

export function createRegionalInventory(
  products: Profile1DocumentProducts,
  sourceLength: number,
  recorder: RegionalInventoryRecorder,
  logicalNodeLimit: number = DOCUMENT_RESOURCE_POLICY_V1.maximumLogicalNodes,
  dependencyPrefixEnd: number = 0,
  plainRecorder?: PlainParagraphIndexRecorder,
  minimumRoots: number = 2
): RegionalInventory | undefined {
  const retained = products.retainedIntrinsic
  if (
    !Number.isSafeInteger(logicalNodeLimit) || logicalNodeLimit < 0 ||
    !Number.isSafeInteger(dependencyPrefixEnd) ||
    dependencyPrefixEnd < 0 || dependencyPrefixEnd > sourceLength ||
    retained === undefined ||
    retained.sourceLength !== sourceLength ||
    retained.rootCount < minimumRoots ||
    retained.diagnostics.length !== 0
  ) {
    return undefined
  }
  const boundaries = Object.freeze([
    0,
    ...retained.safePoints,
    sourceLength
  ].filter((value, ordinal, values) =>
    value >= 0 && value <= sourceLength &&
    (ordinal === 0 || value !== values[ordinal - 1])
  ))
  if (boundaries.length < 2) return undefined
  const syntaxBoundaries = exactSyntaxBoundaries(products, boundaries, recorder)
  if (syntaxBoundaries === undefined) return undefined
  const counts = eventCounts(products, boundaries, recorder)
  const leaves: RegionLeaf[] = []
  let rootCursor = 0
  let markdownCursor = 0
  let markerCursor = 0
  let tapeCursor = 0
  let mappedCursor = 0
  const editingRoot = products.editing().markdown.root
  const mappedTape = products.editing().mappedTape
  const annotationExtent = retained.roots[retained.roots.length - 1]?.range.end ?? 0
  const crossed = literalCrossings(retained.markdownLiterals, boundaries)
  let plainGap: { leafIndex: number, points: number[], eligible: boolean } | undefined
  const finishPlainGap = (): void => {
    const pending = plainGap
    plainGap = undefined
    const leaf = pending === undefined ? undefined : leaves[pending.leafIndex]
    if (pending === undefined || !pending.eligible || plainRecorder === undefined || leaf?.kind !== 'gap') return
    leaves[pending.leafIndex] = plainGapLeaf(leaf.sourceLength, pending.points, plainRecorder)
  }
  for (let ordinal = 0; ordinal + 1 < boundaries.length; ordinal += 1) {
    recorder.recordBuildUnit()
    const sourceStart = boundaries[ordinal]
    const sourceEnd = boundaries[ordinal + 1]
    const syntaxStart = syntaxBoundaries[ordinal]
    const syntaxEnd = syntaxBoundaries[ordinal + 1]
    if (
      sourceStart === undefined || sourceEnd === undefined ||
      syntaxStart === undefined || syntaxEnd === undefined ||
      sourceStart >= sourceEnd || syntaxStart > syntaxEnd
    ) {
      return undefined
    }
    const roots: CriticMarkupNode[] = []
    while (rootCursor < retained.roots.length) {
      const root = retained.roots[rootCursor]
      if (root === undefined || root.range.start >= sourceEnd) break
      recorder.recordBuildUnit()
      if (!(sourceStart <= root.range.start && root.range.end <= sourceEnd)) {
        return undefined
      }
      roots.push(root)
      rootCursor += 1
    }
    const markdownRoots: MarkdownNode[] = []
    while (markdownCursor < editingRoot.childCount) {
      const child = editingRoot.childAt(markdownCursor)
      if (child.range.start >= syntaxEnd && !(sourceEnd === sourceLength &&
        child.range.start === syntaxEnd && child.range.end === syntaxEnd)) break
      recorder.recordBuildUnit()
      if (!(syntaxStart <= child.range.start && child.range.end <= syntaxEnd)) {
        return undefined
      }
      markdownRoots.push(child)
      markdownCursor += 1
    }
    const markerDecisions: Array<
      NonNullable<Profile1DocumentProducts['retainedIntrinsic']>[
        'markerDecisions'
      ][number]
    > = []
    while (markerCursor < retained.markerDecisions.length) {
      const decision = retained.markerDecisions[markerCursor]
      if (decision === undefined || decision.range.start >= sourceEnd) break
      recorder.recordBuildUnit()
      if (!(
        sourceStart <= decision.range.start && decision.range.end <= sourceEnd
      )) {
        return undefined
      }
      markerDecisions.push(decision)
      markerCursor += 1
    }
    const tapeRoles: string[] = []
    while (tapeCursor < retained.tape.length) {
      const run = retained.tape[tapeCursor]
      if (run === undefined || run.range.start >= sourceEnd) break
      recorder.recordBuildUnit()
      if (!(sourceStart <= run.range.start && run.range.end <= sourceEnd)) {
        return undefined
      }
      tapeRoles.push(run.role)
      tapeCursor += 1
    }
    const projectionKinds: string[] = []
    while (mappedCursor < mappedTape.length) {
      const segment = mappedTape[mappedCursor]
      if (segment === undefined || segment.projectedStart >= syntaxEnd) break
      recorder.recordBuildUnit()
      if (segment.projectedEnd > syntaxStart) {
        projectionKinds.push(segment.kind === 'canonical'
          ? 'canonical'
          : `generated:${segment.affinity}`)
      }
      if (segment.projectedEnd <= syntaxEnd) mappedCursor += 1
      else break
    }
    // Intrinsic safe points already bound this complete Markdown block. Keep
    // the same measured topology for an ordinary paragraph as for an annotated
    // one, so its interior can use the existing candidate-parse admission.
    // Whitespace, multi-block spans and other block kinds remain opaque gaps.
    // Keep the unannotated suffix compact: this inventory's persistent node
    // count must not grow with a potentially huge plain tail after the last CM
    // owner. Ordinary paragraphs within the annotation extent can be edited
    // locally without expanding that suffix into one retained node per block.
    const ordinaryParagraph = roots.length === 0 &&
      sourceStart < annotationExtent &&
      markdownRoots.length === 1 && markdownRoots[0]?.kind === 'paragraph' &&
      markerDecisions.length === 0 &&
      projectionKinds.every(kind => kind === 'canonical')
    if (roots.length === 0 && !ordinaryParagraph) {
      const plainRegion = markerDecisions.length === 0 &&
        projectionKinds.every(kind => kind === 'canonical') &&
        syntaxEnd - syntaxStart === sourceEnd - sourceStart &&
        counts[ordinal] === 1 &&
        crossed[ordinal] !== true && crossed[ordinal + 1] !== true
      const previous = leaves[leaves.length - 1]
      if (previous?.kind === 'gap' && plainGap !== undefined) {
        plainGap.points.push(previous.sourceLength)
        plainGap.eligible &&= plainRegion
        leaves[leaves.length - 1] = Object.freeze({
          kind: 'gap',
          sourceLength: previous.sourceLength + sourceEnd - sourceStart,
          syntaxLength: previous.syntaxLength + syntaxEnd - syntaxStart,
          eventCount: previous.eventCount + (counts[ordinal] ?? 0)
        })
      } else {
        finishPlainGap()
        plainGap = { leafIndex: leaves.length, points: [], eligible: plainRegion }
        leaves.push(Object.freeze({
          kind: 'gap',
          sourceLength: sourceEnd - sourceStart,
          syntaxLength: syntaxEnd - syntaxStart,
          eventCount: counts[ordinal] ?? 0
        }))
      }
    } else {
      finishPlainGap()
      leaves.push(createLeafFromParts(
        products,
        sourceStart,
        sourceEnd,
        syntaxStart,
        syntaxEnd,
        counts[ordinal] ?? 0,
        roots,
        markdownRoots,
        Object.freeze(markerDecisions),
        Object.freeze(tapeRoles),
        Object.freeze(projectionKinds),
        recorder
      ))
    }
  }
  finishPlainGap()
  if (
    rootCursor !== retained.roots.length ||
    markdownCursor !== editingRoot.childCount ||
    markerCursor !== retained.markerDecisions.length ||
    tapeCursor !== retained.tape.length ||
    mappedCursor !== mappedTape.length
  ) {
    return undefined
  }
  return Object.freeze({
    [inventoryBrand]: true as const,
    root: buildTree(leaves, 0, leaves.length, recorder),
    accountingUpperBound: products.accountingCounts.reduce(
      (total, count) => total + count,
      0
    ),
    logicalNodeLimit,
    markerFree: false,
    dependencyPrefixEnd,
    recorder,
    ...(plainRecorder === undefined ? {} : { plainRecorder })
  })
}

function markersPaired(
  decisions: NonNullable<Profile1DocumentProducts['retainedIntrinsic']>['markerDecisions']
): boolean {
  const closed = new Set<number>()
  for (const decision of decisions) {
    if (decision.role !== 'close') continue
    if (decision.action !== 'matched' || decision.openerRunId === null || decision.openerRunId === undefined) return false
    closed.add(decision.openerRunId)
  }
  return decisions.every(decision => decision.role !== 'open' || closed.has(decision.runId))
}

/**
 * Boundaries lying strictly inside a Markdown literal. A literal never
 * crosses a top-level block start in a complete parse; one that does marks
 * text whose meaning a window parse could not reproduce.
 */
function literalCrossings(
  literals: readonly Readonly<{ start: number, end: number }>[],
  boundaries: readonly number[]
): readonly boolean[] {
  const crossed = boundaries.map(() => false)
  for (const literal of literals) {
    let low = 0
    let high = boundaries.length
    while (low < high) {
      const middle = low + ((high - low) >> 1)
      if ((boundaries[middle] ?? Infinity) <= literal.start) low = middle + 1
      else high = middle
    }
    for (let index = low; index < boundaries.length && (boundaries[index] ?? Infinity) < literal.end; index += 1) {
      crossed[index] = true
    }
  }
  return crossed
}

function plainGapLeaf(
  sourceLength: number,
  points: readonly number[],
  recorder: PlainParagraphIndexRecorder
): MeasuredGapLeaf {
  return Object.freeze({
    kind: 'gap',
    sourceLength,
    syntaxLength: sourceLength,
    eventCount: points.length + 1,
    plain: createPlainParagraphRetainedIndex(points, sourceLength, 0, recorder)
  })
}

function locateBySource(
  inventory: InventoryValue,
  sourceOffset: number
): LocatedLeaf | undefined {
  if (
    !Number.isInteger(sourceOffset) ||
    sourceOffset < 0 ||
    sourceOffset >= inventory.root.sourceLength
  ) {
    return undefined
  }
  let node = inventory.root
  let sourceStart = 0
  let syntaxStart = 0
  let eventStart = 0
  let ordinal = 0
  while (node.kind === 'branch') {
    inventory.recorder.recordNodeVisited()
    inventory.recorder.recordLookupComparison()
    if (sourceOffset < sourceStart + node.left.sourceLength) {
      node = node.left
    } else {
      sourceStart += node.left.sourceLength
      syntaxStart += node.left.syntaxLength
      eventStart += node.left.eventCount
      ordinal += leafCount(node.left)
      node = node.right
    }
  }
  inventory.recorder.recordNodeVisited()
  return Object.freeze({
    leaf: node,
    ordinal,
    sourceStart,
    syntaxStart,
    eventStart
  })
}

function sameArray<Value>(left: readonly Value[], right: readonly Value[]): boolean {
  return left.length === right.length &&
    left.every((value, ordinal) => value === right[ordinal])
}

function sameTopology(
  previous: AnnotationCapsule,
  next: AnnotationCapsule
): boolean {
  if (
    previous.roots.length !== next.roots.length ||
    previous.nodes.length !== next.nodes.length
  ) {
    return false
  }
  for (let ordinal = 0; ordinal < previous.nodes.length; ordinal += 1) {
    const left = previous.nodes[ordinal]
    const right = next.nodes[ordinal]
    if (
      left === undefined || right === undefined ||
      left.kind !== right.kind || left.arms.length !== right.arms.length
    ) {
      return false
    }
    if (
      !sameArray(
        left.commentMarkdownTopology ?? Object.freeze([]),
        right.commentMarkdownTopology ?? Object.freeze([])
      )
    ) {
      return false
    }
    for (let armOrdinal = 0; armOrdinal < left.arms.length; armOrdinal += 1) {
      const leftArm = left.arms[armOrdinal]
      const rightArm = right.arms[armOrdinal]
      if (
        leftArm === undefined || rightArm === undefined ||
        leftArm.name !== rightArm.name ||
        leftArm.children.length !== rightArm.children.length ||
        leftArm.children.some((child, childOrdinal) =>
          child !== rightArm.children[childOrdinal]
        )
      ) {
        return false
      }
    }
  }
  return true
}

function sameRegionShape(
  previous: MeasuredRegionLeaf,
  next: MeasuredRegionLeaf
): boolean {
  return sameTopology(previous.annotations, next.annotations) &&
    sameArray(previous.tapeRoles, next.tapeRoles) &&
    sameArray(previous.markdownTopology, next.markdownTopology) &&
    sameArray(previous.mappedKinds, next.mappedKinds) &&
    previous.markers.length === next.markers.length &&
    previous.markers.every((marker, ordinal) => {
      const candidate = next.markers[ordinal]
      return candidate !== undefined &&
        marker.kind === candidate.kind && marker.role === candidate.role &&
        marker.relation === candidate.relation &&
        marker.action === candidate.action
    })
}

function editTouchesMarker(
  leaf: MeasuredRegionLeaf,
  localStart: number,
  localEnd: number
): boolean {
  return leaf.markers.some(marker => localStart === localEnd
    ? marker.start < localStart && localStart < marker.end
    : localStart < marker.end && marker.start < localEnd
  )
}

function replaceLeaf(
  node: RegionTree,
  ordinal: number,
  replacement: RegionLeaf,
  recorder: RegionalInventoryRecorder
): RegionTree {
  recorder.recordNodeVisited()
  if (node.kind !== 'branch') {
    if (ordinal !== 0) throw new RangeError('Regional leaf ordinal is invalid')
    recorder.recordChangedLeaf()
    recorder.recordNodeAllocated()
    return replacement
  }
  const leftCount = leafCount(node.left)
  if (ordinal < leftCount) {
    const left = replaceLeaf(node.left, ordinal, replacement, recorder)
    recorder.recordNodeShared()
    return branch(left, node.right, recorder)
  }
  const right = replaceLeaf(
    node.right,
    ordinal - leftCount,
    replacement,
    recorder
  )
  recorder.recordNodeShared()
  return branch(node.left, right, recorder)
}

function commentAtRange(
  inventory: InventoryValue,
  requested: Readonly<{ readonly start: number; readonly end: number }>
): Readonly<{
  readonly located: LocatedLeaf & Readonly<{ readonly leaf: MeasuredRegionLeaf }>
  readonly nodeOrdinal: number
  readonly node: CapsuleNode
}> | undefined {
  const located = locateBySource(inventory, requested.start)
  if (located === undefined || located.leaf.kind !== 'region') return undefined
  const regionLocated = Object.freeze({ ...located, leaf: located.leaf })
  for (
    let ordinal = 0;
    ordinal < regionLocated.leaf.annotations.nodes.length;
    ordinal += 1
  ) {
    const node = regionLocated.leaf.annotations.nodes[ordinal]
    if (
      node?.kind === 'comment' &&
      regionLocated.sourceStart + node.start === requested.start &&
      regionLocated.sourceStart + node.end === requested.end
    ) {
      return Object.freeze({ located: regionLocated, nodeOrdinal: ordinal, node })
    }
  }
  return undefined
}

export function applyRegionalInventory(...args: RegionalInventoryArguments): RegionalInventoryApplyResult {
  return evaluateRegionalInventory(...args, false)
}

/** Validate the same bounded candidate without constructing or publishing a new inventory root. */
export function previewRegionalInventory(...args: RegionalInventoryArguments): RegionalInventoryPreviewResult {
  return evaluateRegionalInventory(...args, true)
}

/**
 * The top-level paragraphs around `position` with one unchanged block of
 * context on each side, parsed as the block window of an edit there would
 * parse them, for planning a key against its neighbours without a document
 * parse. The window keeps its safe points, so its blocks read as they do in
 * the whole document.
 */
export function previewRegionalContext(
  inventory: RegionalInventory,
  source: CanonicalSourceView,
  position: number,
  executionBudget: ExecutionBudgetId,
  markdownOptions: MarkdownOptionsV1,
  physicalRecorder: Profile1PhysicalTraversalRecorderV1
): RegionalInventoryPreview | undefined {
  const edit = Object.freeze({ start: position, end: position, insert: '' })
  const result = evaluateBlockWindow(
    inventoryValue(inventory), source, source, edit, executionBudget, markdownOptions, physicalRecorder, true
  )
  return result?.kind === 'validated' ? result : undefined
}

function evaluateRegionalInventory(...args: [...RegionalInventoryArguments, true]): RegionalInventoryPreviewResult
function evaluateRegionalInventory(...args: [...RegionalInventoryArguments, false]): RegionalInventoryApplyResult
function evaluateRegionalInventory(
  previousInventory: RegionalInventory,
  previousSource: CanonicalSourceView,
  nextSource: CanonicalSourceView,
  edits: readonly RetainedPassSourceEdit[],
  subscriptions: readonly RegionalInventorySubscription[],
  executionBudget: ExecutionBudgetId,
  markdownOptions: MarkdownOptionsV1,
  physicalRecorder: Profile1PhysicalTraversalRecorderV1,
  previewOnly: boolean
): RegionalInventoryApplyResult | RegionalInventoryPreviewResult {
  const sameShape = evaluateSameShape(
    previousInventory, previousSource, nextSource, edits, subscriptions,
    executionBudget, markdownOptions, physicalRecorder, previewOnly
  )
  const edit = edits.length === 1 ? edits[0] : undefined
  if (
    sameShape.kind !== 'fallback' || sameShape.reason !== 'fixed-region-ineligible' ||
    sameShape === BUDGET_EXHAUSTED ||
    edit === undefined || subscriptions.some(subscription => subscription.name === 'comment')
  ) {
    return sameShape
  }
  return evaluateBlockWindow(
    inventoryValue(previousInventory), previousSource, nextSource, edit,
    executionBudget, markdownOptions, physicalRecorder, previewOnly
  ) ?? sameShape
}

const EMPTY_PARAGRAPH = /(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)|^[ \t]*(?:\r\n|\r|\n)|(?:^|\r\n|\r|\n)[ \t]+(?:\r\n|\r|\n|$)/u

/** A window any larger than the one refused would exceed the budget too. */
const BUDGET_EXHAUSTED: RegionalInventoryFallback = Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })

function evaluateSameShape(
  previousInventory: RegionalInventory,
  previousSource: CanonicalSourceView,
  nextSource: CanonicalSourceView,
  edits: readonly RetainedPassSourceEdit[],
  subscriptions: readonly RegionalInventorySubscription[],
  executionBudget: ExecutionBudgetId,
  markdownOptions: MarkdownOptionsV1,
  physicalRecorder: Profile1PhysicalTraversalRecorderV1,
  previewOnly: boolean
): RegionalInventoryApplyResult | RegionalInventoryPreviewResult {
  const inventory = inventoryValue(previousInventory)
  const edit = edits.length === 1 ? edits[0] : undefined
  if (
    edit === undefined ||
    previousSource.length !== inventory.root.sourceLength ||
    edit.start === edit.end && edit.start === previousSource.length
  ) {
    return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
  }
  if (
    inventory.dependencyPrefixEnd !== 0 &&
    edit.start <= inventory.dependencyPrefixEnd
  ) {
    return Object.freeze({
      kind: 'fallback',
      reason: 'definition-or-reference-facts'
    })
  }
  const start = locateBySource(inventory, edit.start)
  const lastOffset = edit.end === edit.start ? edit.start : edit.end - 1
  const end = locateBySource(inventory, lastOffset)
  if (
    start === undefined || end === undefined ||
    start.leaf.kind !== 'region' || end.leaf.kind !== 'region' ||
    start.ordinal !== end.ordinal ||
    edit.start <= start.sourceStart ||
    edit.end >= start.sourceStart + start.leaf.sourceLength
  ) {
    return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
  }
  const resolvedComments = subscriptions.flatMap(subscription => {
    if (subscription.name !== 'comment' || subscription.annotationRange === undefined) {
      return []
    }
    const resolved = commentAtRange(inventory, subscription.annotationRange)
    return resolved === undefined ? [undefined] : [resolved]
  })
  if (resolvedComments.some(comment => comment === undefined)) {
    return Object.freeze({ kind: 'fallback', reason: 'subscription-not-found' })
  }
  const localStart = edit.start - start.sourceStart
  const localEnd = edit.end - start.sourceStart
  if (editChangesBacktickPairing(previousSource, edit) || editTouchesMarker(start.leaf, localStart, localEnd)) {
    return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
  }
  const delta = nextSource.length - previousSource.length
  const nextWindow = nextSource.slice(
    start.sourceStart,
    start.sourceStart + start.leaf.sourceLength + delta
  )
  inventory.recorder.recordCandidateRegionParse(nextWindow.length)
  const result = parseProfile1Document(
    nextWindow,
    executionBudget,
    undefined,
    markdownOptions,
    false,
    undefined,
    createProfile1DocumentReuseCache(),
    physicalRecorder,
    undefined,
    start.sourceStart + start.leaf.sourceLength + delta === nextSource.length
  )
  if (result.kind !== 'complete') {
    return Object.freeze({
      kind: 'resource-failure',
      fatalDiagnostic: shiftResourceDiagnostic(
        result.fatalDiagnostic,
        start.sourceStart
      )
    })
  }
  if (
    result.diagnostics.count !== 0 ||
    (result.retainedIntrinsic?.diagnostics.length ?? 0) !== 0
  ) {
    return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
  }
  if ((result.retainedIntrinsic?.safePoints.length ?? 0) !== 0) {
    return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
  }
  if (
    referenceDependencyPrefixEnd(result) !== 0 ||
    containsPotentialReferenceDependency(nextWindow)
  ) {
    return Object.freeze({
      kind: 'fallback',
      reason: 'definition-or-reference-facts'
    })
  }
  const candidate = createLeaf(
    result,
    0,
    nextWindow.length,
    0,
    result.editing().source.length,
    result.markup.eventCount
  )
  const candidateAccountingUnits = result.accountingCounts.reduce(
    (total, count) => total + count,
    0
  )
  if (
    inventory.accountingUpperBound + candidateAccountingUnits >
      inventory.logicalNodeLimit
  ) {
    return BUDGET_EXHAUSTED
  }
  if (!sameRegionShape(start.leaf, candidate)) {
    return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
  }
  if (previewOnly) {
    return Object.freeze({
      kind: 'validated', sourceStart: start.sourceStart, nextProducts: result, nextWindow
    })
  }
  const replacement = candidate
  inventory.recorder.recordRootAttempted()
  const nextRoot = replaceLeaf(
    inventory.root,
    start.ordinal,
    replacement,
    inventory.recorder
  )
  const nextInventory: RegionalInventory = Object.freeze({
    [inventoryBrand]: true as const,
    root: nextRoot,
    accountingUpperBound:
      inventory.accountingUpperBound + candidateAccountingUnits,
    logicalNodeLimit: inventory.logicalNodeLimit,
    markerFree: inventory.markerFree,
    dependencyPrefixEnd: inventory.dependencyPrefixEnd,
    recorder: inventory.recorder,
    ...(inventory.plainRecorder === undefined ? {} : { plainRecorder: inventory.plainRecorder })
  })
  const nextCommentLeaves = new Map<number, Readonly<{
    products: Profile1DocumentProducts
    window: string
    sourceStart: number
  }>>()
  nextCommentLeaves.set(start.ordinal, Object.freeze({
    products: result,
    window: nextWindow,
    sourceStart: start.sourceStart
  }))
  for (const resolved of resolvedComments) {
    if (
      resolved === undefined ||
      nextCommentLeaves.has(resolved.located.ordinal)
    ) continue
    const nextSourceStart = resolved.located.sourceStart +
      (resolved.located.ordinal > start.ordinal ? delta : 0)
    const window = nextSource.slice(
      nextSourceStart,
      nextSourceStart + resolved.located.leaf.sourceLength
    )
    inventory.recorder.recordCandidateRegionParse(window.length)
    const parsed = parseProfile1Document(
      window,
      executionBudget,
      undefined,
      markdownOptions,
      false,
      undefined,
      createProfile1DocumentReuseCache(),
      physicalRecorder,
      undefined,
      nextSourceStart + resolved.located.leaf.sourceLength === nextSource.length
    )
    if (parsed.kind !== 'complete') {
      return Object.freeze({
        kind: 'resource-failure',
        fatalDiagnostic: shiftResourceDiagnostic(
          parsed.fatalDiagnostic,
          nextSourceStart
        )
      })
    }
    if (
      parsed.diagnostics.count !== 0 ||
      (parsed.retainedIntrinsic?.diagnostics.length ?? 0) !== 0 ||
      (parsed.retainedIntrinsic?.safePoints.length ?? 0) !== 0
    ) {
      return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
    }
    const unchanged = createLeaf(
      parsed,
      0,
      window.length,
      0,
      parsed.editing().source.length,
      parsed.markup.eventCount
    )
    if (!sameRegionShape(resolved.located.leaf, unchanged)) {
      return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
    }
    nextCommentLeaves.set(resolved.located.ordinal, Object.freeze({
      products: parsed,
      window,
      sourceStart: nextSourceStart
    }))
  }
  const commentImpacts: RegionalInventoryCommentImpact[] = []
  for (const resolved of resolvedComments) {
    if (resolved === undefined) continue
    const nextLeaf = nextCommentLeaves.get(resolved.located.ordinal)
    if (nextLeaf === undefined) {
      return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
    }
    const node = resolved.node
    const arm = node.arms[0]
    if (arm === undefined || node.commentProjectionLength === undefined) continue
    commentImpacts.push(Object.freeze({
      nodeOrdinal: resolved.nodeOrdinal,
      nextProducts: nextLeaf.products,
      nextWindow: nextLeaf.window,
      nextSourceStart: nextLeaf.sourceStart,
      previous: Object.freeze({
        annotation: range(
          resolved.located.sourceStart + node.start,
          resolved.located.sourceStart + node.end
        ),
        payload: range(
          resolved.located.sourceStart + arm.start,
          resolved.located.sourceStart + arm.end
        ),
        projection: range(0, node.commentProjectionLength)
      })
    }))
  }
  return Object.freeze({
    kind: 'admitted',
    nextInventory,
    previous: Object.freeze({
      source: range(
        start.sourceStart,
        start.sourceStart + start.leaf.sourceLength
      ),
      syntax: range(
        start.syntaxStart,
        start.syntaxStart + start.leaf.syntaxLength
      ),
      events: range(
        start.eventStart,
        start.eventStart + start.leaf.eventCount
      )
    }),
    next: Object.freeze({
      source: range(start.sourceStart, start.sourceStart + candidate.sourceLength),
      syntax: range(start.syntaxStart, start.syntaxStart + candidate.syntaxLength),
      events: range(start.eventStart, start.eventStart + candidate.eventCount)
    }),
    nextProducts: result,
    nextWindow,
    commentImpacts: Object.freeze(commentImpacts)
  })
}

interface WindowEdge {
  readonly ordinal: number
  readonly leaf: RegionLeaf
  readonly source: number
  readonly syntax: number
  readonly event: number
  /** Offset of the edge within its leaf. */
  readonly local: number
  /** For a plain gap, the safe-point rank at (start) or after (end) the edge. */
  readonly rank: number
}

function windowEdge(
  inventory: InventoryValue,
  position: number,
  side: 'start' | 'end'
): WindowEdge | undefined {
  const length = inventory.root.sourceLength
  if (side === 'end' && position === length) {
    const last = locateBySource(inventory, length - 1)
    if (last === undefined) return undefined
    return Object.freeze({
      ordinal: last.ordinal,
      leaf: last.leaf,
      source: length,
      syntax: inventory.root.syntaxLength,
      event: inventory.root.eventCount,
      local: last.leaf.sourceLength,
      rank: last.leaf.kind === 'gap' ? last.leaf.plain?.safePointCount ?? 0 : 0
    })
  }
  const located = locateBySource(inventory, Math.min(position, length - 1))
  if (located === undefined) return undefined
  const { leaf } = located
  if (leaf.kind === 'region') {
    return side === 'start'
      ? Object.freeze({ ordinal: located.ordinal, leaf, source: located.sourceStart, syntax: located.syntaxStart, event: located.eventStart, local: 0, rank: 0 })
      : Object.freeze({
        ordinal: located.ordinal,
        leaf,
        source: located.sourceStart + leaf.sourceLength,
        syntax: located.syntaxStart + leaf.syntaxLength,
        event: located.eventStart + leaf.eventCount,
        local: leaf.sourceLength,
        rank: 0
      })
  }
  if (leaf.plain === undefined) return undefined
  const local = position - located.sourceStart
  const bracket = leaf.plain.bracketForEdits([{ start: local, end: local, insert: '' }], leaf.sourceLength)
  if (bracket === undefined) return undefined
  // A plain gap has one public event and an unmapped projection per block.
  const edge = side === 'start' ? bracket.start : bracket.endPrevious
  const rank = side === 'start' ? bracket.startSafePointRank : bracket.endSafePointRank
  return Object.freeze({
    ordinal: located.ordinal,
    leaf,
    source: located.sourceStart + edge,
    syntax: located.syntaxStart + edge,
    event: located.eventStart + rank + 1,
    local: edge,
    rank
  })
}

interface BlockWindowFacts {
  readonly boundaries: readonly number[]
  readonly syntaxBoundaries: readonly number[]
  readonly eventCounts: readonly number[]
}

/**
 * A reparsed run of top-level blocks reads the same inside the whole
 * document as alone when the block starts that bound the edited blocks stay
 * safe points: the parse state there is clean, so neither side can absorb
 * or reinterpret the other. The run has no reference facts, which resolve
 * across the document.
 */
function blockWindowFacts(
  products: Profile1DocumentProducts,
  window: string,
  recorder: RegionalInventoryRecorder
): BlockWindowFacts | undefined {
  const retained = products.retainedIntrinsic
  if (
    retained === undefined ||
    products.diagnostics.count !== 0 ||
    retained.diagnostics.length !== 0 ||
    referenceDependencyPrefixEnd(products) !== 0 ||
    containsPotentialReferenceDependency(window)
  ) {
    return undefined
  }
  const editing = products.editing()
  if (editing.markdown.root.childCount === 0) return undefined
  if (editing.mappedTape.some(segment => segment.kind !== 'canonical')) return undefined
  if (!markersPaired(retained.markerDecisions)) return undefined
  const boundaries = Object.freeze([0, ...retained.safePoints, window.length])
  // The window's start is its projection's start even when an elided
  // CriticMarkup opener begins it.
  const laterSyntax = exactSyntaxBoundaries(products, boundaries.slice(1), recorder)
  if (laterSyntax === undefined) return undefined
  const syntaxBoundaries = Object.freeze([0, ...laterSyntax])
  return Object.freeze({ boundaries, syntaxBoundaries, eventCounts: eventCounts(products, boundaries, recorder) })
}

function leafRange(
  root: RegionTree,
  from: number,
  to: number
): Array<Readonly<{ leaf: RegionLeaf, sourceStart: number }>> {
  const result: Array<Readonly<{ leaf: RegionLeaf, sourceStart: number }>> = []
  const visit = (node: RegionTree, firstOrdinal: number, sourceStart: number): void => {
    const lastOrdinal = firstOrdinal + leafCount(node) - 1
    if (lastOrdinal < from || firstOrdinal > to) return
    if (node.kind !== 'branch') {
      result.push(Object.freeze({ leaf: node, sourceStart }))
      return
    }
    visit(node.left, firstOrdinal, sourceStart)
    visit(node.right, firstOrdinal + leafCount(node.left), sourceStart + node.left.sourceLength)
  }
  visit(root, 0, 0)
  return result
}

/**
 * The intrinsic pass pairs a backtick run with a later equal run beyond its
 * paragraph, so adding, removing, joining or splitting a run (or a
 * backslash escaping one) can change CriticMarkup recognition in blocks no
 * window contains.
 */
function editChangesBacktickPairing(source: CanonicalSourceView, edit: RetainedPassSourceEdit): boolean {
  return /[`\\]/u.test(edit.insert) ||
    /[`\\]/u.test(source.slice(Math.max(0, edit.start - 1), Math.min(source.length, edit.end + 1)))
}

function leavesOf(root: RegionTree): RegionLeaf[] {
  const leaves: RegionLeaf[] = []
  const pending: RegionTree[] = [root]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) break
    if (node.kind === 'branch') {
      pending.push(node.right, node.left)
    } else {
      leaves.push(node)
    }
  }
  return leaves
}

/** The plain gap between two of its own safe-point coordinates. */
function plainGapSlice(
  coordinates: readonly number[],
  from: number,
  to: number,
  recorder: PlainParagraphIndexRecorder
): MeasuredGapLeaf | undefined {
  if (to <= from) return undefined
  const points = coordinates.filter(point => point > from && point < to).map(point => point - from)
  return plainGapLeaf(to - from, points, recorder)
}

/**
 * Replace the top-level blocks around one edit, reparsing only them, when the
 * edit changes their structure: a split or joined paragraph, or a new
 * suggestion. The edited blocks run from the block holding the edit's start
 * to the block holding its end, including a block that begins exactly at its
 * end. One unchanged block on each side joins the reparse, so the parse
 * proves the edited blocks' bounds are still safe points.
 */
function evaluateBlockWindow(
  inventory: InventoryValue,
  previousSource: CanonicalSourceView,
  nextSource: CanonicalSourceView,
  edit: RetainedPassSourceEdit,
  executionBudget: ExecutionBudgetId,
  markdownOptions: MarkdownOptionsV1,
  physicalRecorder: Profile1PhysicalTraversalRecorderV1,
  previewOnly: boolean
): RegionalInventoryApplyResult | RegionalInventoryPreviewResult | undefined {
  const length = previousSource.length
  if (
    length !== inventory.root.sourceLength ||
    length === 0 ||
    (inventory.dependencyPrefixEnd !== 0 && edit.start <= inventory.dependencyPrefixEnd)
  ) {
    return undefined
  }
  if (editChangesBacktickPairing(previousSource, edit)) return undefined
  // Only a marker-free document admits new markers; skip the reparse early.
  if (!inventory.markerFree && /[{}]/u.test(edit.insert + previousSource.slice(edit.start, edit.end))) return undefined
  const editedStartEdge = windowEdge(inventory, edit.start, 'start')
  const editedEndEdge = windowEdge(inventory, edit.end, 'end')
  if (editedStartEdge === undefined || editedEndEdge === undefined || editedEndEdge.ordinal < editedStartEdge.ordinal ||
      editedStartEdge.source > edit.start || editedEndEdge.source < edit.end) {
    return undefined
  }
  let edited: WindowEdge = editedStartEdge
  let editedEnd: WindowEdge = editedEndEdge
  const delta = nextSource.length - length
  // A suggestion spanning a blank line joins the blocks around it into one
  // region; when a bound stops being a block start, the neighbouring block
  // joins the edited ones and the reparse widens by one more block.
  for (let widening = 0; ; widening += 1) {
    const first: WindowEdge | undefined = edited.source > 0 ? windowEdge(inventory, edited.source - 1, 'start') : edited
    const last: WindowEdge | undefined = editedEnd.source < length ? windowEdge(inventory, editedEnd.source, 'end') : editedEnd
    if (first === undefined || last === undefined) return undefined
    const nextWindow = nextSource.slice(first.source, last.source + delta)
    const atDocumentEnd = last.source + delta === nextSource.length
    inventory.recorder.recordCandidateRegionParse(nextWindow.length)
    const result = parseProfile1Document(
      nextWindow,
      executionBudget,
      undefined,
      first.source === 0 ? markdownOptions : Object.freeze({ ...markdownOptions, frontMatter: false }),
      false,
      undefined,
      createProfile1DocumentReuseCache(),
      physicalRecorder,
      undefined,
      atDocumentEnd
    )
    // The document parse reports a window's resource failure authoritatively.
    if (result.kind !== 'complete') return undefined
    // Consecutive blank lines read as empty paragraphs whose zero width sits
    // on a block boundary, where views and the inventory disagree on ownership.
    const previousWindow = previousSource.slice(first.source, last.source)
    if (EMPTY_PARAGRAPH.test(nextWindow) || EMPTY_PARAGRAPH.test(previousWindow)) return undefined
    // Splitting or joining paragraphs moves the bound that stops a backtick
    // run pairing with a later one.
    if (/[\r\n]/u.test(edit.insert + previousSource.slice(edit.start, edit.end)) &&
        (nextWindow.includes('`') || previousWindow.includes('`'))) return undefined
    const safePoints = result.retainedIntrinsic?.safePoints ?? []
    const startStands = edited.source === first.source || safePoints.includes(edited.source - first.source)
    const endStands = editedEnd.source === last.source || safePoints.includes(editedEnd.source + delta - first.source)
    if (!startStands || !endStands) {
      if (widening === 2) return undefined
      if (!startStands) edited = first
      if (!endStands) editedEnd = last
      continue
    }
    return admitBlockWindow(
      inventory, edit, delta, edited, editedEnd, first, last,
      result, nextWindow, atDocumentEnd, previewOnly
    )
  }
}

function admitBlockWindow(
  inventory: InventoryValue,
  edit: RetainedPassSourceEdit,
  delta: number,
  edited: WindowEdge,
  editedEnd: WindowEdge,
  first: WindowEdge,
  last: WindowEdge,
  result: Profile1DocumentProducts,
  nextWindow: string,
  atDocumentEnd: boolean,
  previewOnly: boolean
): RegionalInventoryApplyResult | RegionalInventoryPreviewResult | undefined {
  const facts = blockWindowFacts(result, nextWindow, inventory.recorder)
  if (facts === undefined) return undefined
  if (!inventory.markerFree) {
    // Elsewhere-spelled markers keep their reading only if the window spells
    // exactly the markers it spelled before.
    const previousMarkers: MarkerCapsule[] = []
    for (const located of leafRange(inventory.root, first.ordinal, last.ordinal)) {
      if (located.leaf.kind === 'region') previousMarkers.push(...located.leaf.markers)
      else if (located.leaf.plain === undefined) return undefined
    }
    const nextMarkers = markerCapsules(result.retainedIntrinsic?.markerDecisions ?? [], 0)
    if (nextMarkers.length !== previousMarkers.length || nextMarkers.some((marker, ordinal) => {
      const before = previousMarkers[ordinal]
      return before === undefined || marker.kind !== before.kind || marker.role !== before.role || marker.action !== before.action
    })) {
      return undefined
    }
  }
  const candidateAccountingUnits = result.accountingCounts.reduce((total, count) => total + count, 0)
  if (inventory.accountingUpperBound + candidateAccountingUnits > inventory.logicalNodeLimit) return undefined
  const { boundaries, syntaxBoundaries } = facts
  // Only the edited blocks are replaced: the unchanged block on each side
  // served as context, and its own parse can depend on text beyond the window.
  const editedStart = edited.source - first.source
  const editedStop = editedEnd.source + delta - first.source
  const from = boundaries.indexOf(editedStart)
  const to = boundaries.indexOf(editedStop)
  if (from < 0 || to <= from || first.syntax + (syntaxBoundaries[from] ?? 0) !== edited.syntax) return undefined
  // Views replace paragraphs in place; any other block kind takes the full path.
  const editedBlocks = result.editing().markdown.root
  let paragraphs = 0
  for (let ordinal = 0; ordinal < editedBlocks.childCount; ordinal += 1) {
    const block = editedBlocks.childAt(ordinal)
    if (block.range.start < (syntaxBoundaries[from] ?? 0) || block.range.start >= (syntaxBoundaries[to] ?? 0)) continue
    if (block.kind !== 'paragraph') return undefined
    paragraphs += 1
  }
  if (paragraphs === 0) return undefined
  if (previewOnly) {
    let touchesAnnotation = false
    let previousMarkers = 0
    for (const located of leafRange(inventory.root, first.ordinal, last.ordinal)) {
      if (located.leaf.kind !== 'region') continue
      previousMarkers += located.leaf.markers.length
      const { nodes, roots } = located.leaf.annotations
      touchesAnnotation ||= roots.some(ordinal => {
        const node = nodes[ordinal]
        return node !== undefined && located.sourceStart + node.start <= edit.end &&
          located.sourceStart + node.end >= edit.start
      })
    }
    return Object.freeze({
      kind: 'validated',
      sourceStart: first.source,
      nextProducts: result,
      nextWindow,
      structural: Object.freeze({
        touchesAnnotation,
        markerDelta: (result.retainedIntrinsic?.markerDecisions.length ?? 0) - previousMarkers
      })
    })
  }
  const blockBoundaries = boundaries.slice(from, to + 1)
  const blockSyntax = syntaxBoundaries.slice(from, to + 1)
  const counts = facts.eventCounts.slice(from, to)
  const retained = result.retainedIntrinsic
  const crossed = literalCrossings(retained?.markdownLiterals ?? [], blockBoundaries)
  const plainRecorder = inventory.plainRecorder
  // Plain blocks inside one plain gap stay in that gap, so a long plain run
  // never gains an inventory node per edited block.
  const plainBlocks = retained !== undefined &&
    !retained.roots.some(root => root.range.end > editedStart && root.range.start < editedStop) &&
    !retained.markerDecisions.some(decision => decision.range.end > editedStart && decision.range.start < editedStop) &&
    counts.every(count => count === 1) &&
    blockBoundaries.every((boundary, index) => blockSyntax[index] === boundary - editedStart + (blockSyntax[0] ?? 0) && crossed[index] !== true)
  let nextRoot: RegionTree
  if (
    plainBlocks && plainRecorder !== undefined && edited.ordinal === editedEnd.ordinal &&
    edited.leaf.kind === 'gap' && edited.leaf.plain !== undefined
  ) {
    const gap = edited.leaf
    const plain = edited.leaf.plain
    const nextLength = gap.sourceLength + delta
    const localPoints = blockBoundaries.slice(1, -1).map(point => point - editedStart)
    let index: PlainParagraphRetainedIndex
    const gapEdit = edit.start - (edited.source - edited.local)
    const expected: number[] = []
    let interiorShifts = false
    for (let rank = edited.rank + 1; rank < editedEnd.rank; rank += 1) {
      const point = plain.coordinateAt(rank)
      if (point > gapEdit && delta !== 0) interiorShifts = true
      expected.push((point <= gapEdit ? point : point + delta) - edited.local)
    }
    if (!interiorShifts && sameArray(localPoints, expected)) {
      // Only the edited block's length changed; a block start after the edit
      // inside the window would move with it, which the length delta alone
      // does not express.
      index = plain.withRegionLengthDelta(editedEnd.rank, delta, nextLength)
    } else {
      const coordinates = plain.coordinates()
      index = createPlainParagraphRetainedIndex([
        ...coordinates.slice(0, edited.rank + 1),
        ...localPoints.map(point => edited.local + point),
        ...coordinates.slice(editedEnd.rank).map(point => point + delta)
      ], nextLength, 0, plainRecorder)
    }
    nextRoot = replaceLeaf(inventory.root, edited.ordinal, Object.freeze({
      kind: 'gap',
      sourceLength: nextLength,
      syntaxLength: nextLength,
      eventCount: index.safePointCount + 1,
      plain: index
    }), inventory.recorder)
  } else {
    const replacement: RegionLeaf[] = []
    if (edited.leaf.kind === 'gap' && edited.local > 0) {
      if (edited.leaf.plain === undefined || plainRecorder === undefined) return undefined
      const prefix = plainGapSlice(edited.leaf.plain.coordinates(), 0, edited.local, plainRecorder)
      if (prefix !== undefined) replacement.push(prefix)
    }
    for (let block = 0; block + 1 < blockBoundaries.length; block += 1) {
      replacement.push(createLeaf(
        result,
        blockBoundaries[block] ?? 0,
        blockBoundaries[block + 1] ?? 0,
        blockSyntax[block] ?? 0,
        blockSyntax[block + 1] ?? 0,
        counts[block] ?? 0
      ))
    }
    if (editedEnd.leaf.kind === 'gap' && editedEnd.local < editedEnd.leaf.sourceLength) {
      if (editedEnd.leaf.plain === undefined || plainRecorder === undefined) return undefined
      const suffix = plainGapSlice(editedEnd.leaf.plain.coordinates(), editedEnd.local, editedEnd.leaf.sourceLength, plainRecorder)
      if (suffix !== undefined) replacement.push(suffix)
    }
    const leaves = leavesOf(inventory.root)
    leaves.splice(edited.ordinal, editedEnd.ordinal - edited.ordinal + 1, ...replacement)
    nextRoot = buildTree(leaves, 0, leaves.length, inventory.recorder)
  }
  inventory.recorder.recordRootAttempted()
  const eventTotal = counts.reduce((total, count) => total + count, 0)
  const syntaxStart = blockSyntax[0] ?? 0
  const syntaxEnd = blockSyntax[blockSyntax.length - 1] ?? 0
  return Object.freeze({
    kind: 'admitted',
    nextInventory: Object.freeze({
      [inventoryBrand]: true as const,
      root: nextRoot,
      accountingUpperBound: inventory.accountingUpperBound + candidateAccountingUnits,
      logicalNodeLimit: inventory.logicalNodeLimit,
      markerFree: inventory.markerFree && (result.retainedIntrinsic?.markerDecisions.length ?? 0) === 0,
      dependencyPrefixEnd: inventory.dependencyPrefixEnd,
      recorder: inventory.recorder,
      ...(plainRecorder === undefined ? {} : { plainRecorder })
    }),
    previous: Object.freeze({
      source: range(edited.source, editedEnd.source),
      syntax: range(edited.syntax, editedEnd.syntax),
      events: range(edited.event, editedEnd.event)
    }),
    next: Object.freeze({
      source: range(edited.source, edited.source + editedStop - editedStart),
      syntax: range(edited.syntax, edited.syntax + syntaxEnd - syntaxStart),
      events: range(edited.event, edited.event + eventTotal)
    }),
    nextProducts: result,
    nextWindow,
    window: Object.freeze({
      source: first.source,
      syntax: first.syntax,
      blocks: Object.freeze({
        source: range(editedStart, editedStop),
        syntax: range(syntaxStart, syntaxEnd)
      })
    }),
    commentImpacts: Object.freeze([])
  })
}

/**
 * The inventory of a document whose annotations occupy no blocks yet: one
 * plain gap reusing the document's plain paragraph index unchanged.
 */
export function createPlainRegionalInventory(
  index: PlainParagraphRetainedIndex,
  accountingUpperBound: number,
  recorder: RegionalInventoryRecorder,
  plainRecorder: PlainParagraphIndexRecorder,
  logicalNodeLimit: number = DOCUMENT_RESOURCE_POLICY_V1.maximumLogicalNodes
): RegionalInventory | undefined {
  if (index.sourceLength === 0) return undefined
  recorder.recordNodeAllocated()
  return Object.freeze({
    [inventoryBrand]: true as const,
    root: Object.freeze({
      kind: 'gap',
      sourceLength: index.sourceLength,
      syntaxLength: index.sourceLength,
      eventCount: index.safePointCount + 1,
      plain: index
    }),
    accountingUpperBound,
    logicalNodeLimit,
    markerFree: true,
    dependencyPrefixEnd: index.dependencyPrefixEnd,
    recorder,
    plainRecorder
  })
}

export function materializeRegionalInventoryAnnotations(
  inventory: RegionalInventory
): readonly RegionalInventoryAnnotation[] {
  const value = inventoryValue(inventory)
  const locatedLeaves: Array<Readonly<{
    leaf: MeasuredRegionLeaf
    sourceStart: number
  }>> = []
  const pendingTrees: Array<Readonly<{
    node: RegionTree
    sourceStart: number
  }>> = [{ node: value.root, sourceStart: 0 }]
  while (pendingTrees.length > 0) {
    const task = pendingTrees.pop()
    if (task === undefined) break
    if (task.node.kind !== 'branch') {
      if (task.node.kind === 'gap') continue
      locatedLeaves.push(Object.freeze({
        leaf: task.node,
        sourceStart: task.sourceStart
      }))
      continue
    }
    pendingTrees.push({
      node: task.node.right,
      sourceStart: task.sourceStart + task.node.left.sourceLength
    })
    pendingTrees.push({ node: task.node.left, sourceStart: task.sourceStart })
  }
  const roots: RegionalInventoryAnnotation[] = []
  for (const located of locatedLeaves) {
    const materialized = new Map<number, RegionalInventoryAnnotation>()
    for (
      let ordinal = located.leaf.annotations.nodes.length - 1;
      ordinal >= 0;
      ordinal -= 1
    ) {
      const node = located.leaf.annotations.nodes[ordinal]
      if (node === undefined) continue
      const annotation: RegionalInventoryAnnotation = Object.freeze({
        kind: node.kind,
        range: range(
          located.sourceStart + node.start,
          located.sourceStart + node.end
        ),
        arms: Object.freeze(node.arms.map(arm => Object.freeze({
          name: arm.name,
          range: range(
            located.sourceStart + arm.start,
            located.sourceStart + arm.end
          ),
          annotations: Object.freeze(arm.children.map(child => {
            const materializedChild = materialized.get(child)
            if (materializedChild === undefined) {
              throw new Error('Regional annotation child was not materialized')
            }
            return materializedChild
          }))
        })))
      })
      value.recorder.recordAnnotationMaterialized()
      materialized.set(ordinal, annotation)
    }
    for (const rootOrdinal of located.leaf.annotations.roots) {
      const root = materialized.get(rootOrdinal)
      if (root === undefined) {
        throw new Error('Regional annotation root was not materialized')
      }
      roots.push(root)
    }
  }
  return Object.freeze(roots)
}
