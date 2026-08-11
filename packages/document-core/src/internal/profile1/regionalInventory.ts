import type {
  CriticMarkupNode,
  ExecutionBudgetId,
  MarkdownNode,
  MarkdownOptionsV1,
  NodeId,
  ResourceDiagnostic,
  SourceRange
} from '../../revision.js'
import {
  createProfile1DocumentReuseCache,
  parseProfile1Document,
  PROFILE1_DESKTOP_LOGICAL_NODE_LIMIT,
  type Profile1DocumentProducts,
  type RetainedPassSourceEdit
} from '../profile1Document.js'
import type { CanonicalSourceView } from '../persistentCanonicalSource.js'
import type { Profile1PhysicalTraversalRecorderV1 } from './physicalTraversalAccounting.js'

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
  readonly commentImpacts: readonly RegionalInventoryCommentImpact[]
}

export interface RegionalInventoryFallback {
  readonly kind: 'fallback'
  readonly reason: 'fixed-region-ineligible' | 'subscription-not-found'
}

export interface RegionalInventoryResourceFailure {
  readonly kind: 'resource-failure'
  readonly fatalDiagnostic: ResourceDiagnostic
}

export type RegionalInventoryApplyResult =
  | RegionalInventoryAdmission
  | RegionalInventoryFallback
  | RegionalInventoryResourceFailure

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
  readonly recorder: RegionalInventoryRecorder
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
    const attributes = Object.entries(node.attributes).map(([name, value]) => {
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

export function createRegionalInventory(
  products: Profile1DocumentProducts,
  sourceLength: number,
  recorder: RegionalInventoryRecorder,
  logicalNodeLimit: number = PROFILE1_DESKTOP_LOGICAL_NODE_LIMIT
): RegionalInventory | undefined {
  const retained = products.retainedIntrinsic
  if (
    !Number.isSafeInteger(logicalNodeLimit) || logicalNodeLimit < 0 ||
    retained === undefined ||
    retained.sourceLength !== sourceLength ||
    retained.rootCount <= 1 ||
    retained.diagnostics.length !== 0 ||
    retained.referenceDefinitionCount !== 0
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
      if (child.range.start >= syntaxEnd) break
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
    if (roots.length === 0) {
      const previous = leaves[leaves.length - 1]
      if (previous?.kind === 'gap') {
        leaves[leaves.length - 1] = Object.freeze({
          kind: 'gap',
          sourceLength: previous.sourceLength + sourceEnd - sourceStart,
          syntaxLength: previous.syntaxLength + syntaxEnd - syntaxStart,
          eventCount: previous.eventCount + (counts[ordinal] ?? 0)
        })
      } else {
        leaves.push(Object.freeze({
          kind: 'gap',
          sourceLength: sourceEnd - sourceStart,
          syntaxLength: syntaxEnd - syntaxStart,
          eventCount: counts[ordinal] ?? 0
        }))
      }
    } else {
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
    recorder
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
  replacement: MeasuredRegionLeaf,
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
  readonly located: LocatedLeaf
  readonly nodeOrdinal: number
  readonly node: CapsuleNode
}> | undefined {
  const located = locateBySource(inventory, requested.start)
  if (located === undefined || located.leaf.kind !== 'region') return undefined
  for (let ordinal = 0; ordinal < located.leaf.annotations.nodes.length; ordinal += 1) {
    const node = located.leaf.annotations.nodes[ordinal]
    if (
      node?.kind === 'comment' &&
      located.sourceStart + node.start === requested.start &&
      located.sourceStart + node.end === requested.end
    ) {
      return Object.freeze({ located, nodeOrdinal: ordinal, node })
    }
  }
  return undefined
}

export function applyRegionalInventory(
  previousInventory: RegionalInventory,
  previousSource: CanonicalSourceView,
  nextSource: CanonicalSourceView,
  edits: readonly RetainedPassSourceEdit[],
  subscriptions: readonly RegionalInventorySubscription[],
  executionBudget: ExecutionBudgetId,
  markdownOptions: MarkdownOptionsV1,
  physicalRecorder: Profile1PhysicalTraversalRecorderV1
): RegionalInventoryApplyResult {
  const inventory = inventoryValue(previousInventory)
  const edit = edits.length === 1 ? edits[0] : undefined
  if (
    edit === undefined ||
    previousSource.length !== inventory.root.sourceLength ||
    edit.start === edit.end && edit.start === previousSource.length
  ) {
    return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
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
  if (editTouchesMarker(start.leaf, localStart, localEnd)) {
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
    physicalRecorder
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
    return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
  }
  if (
    !sameTopology(start.leaf.annotations, candidate.annotations) ||
    !sameArray(start.leaf.tapeRoles, candidate.tapeRoles) ||
    !sameArray(start.leaf.markdownTopology, candidate.markdownTopology) ||
    !sameArray(start.leaf.mappedKinds, candidate.mappedKinds) ||
    start.leaf.markers.length !== candidate.markers.length ||
    start.leaf.markers.some((marker, ordinal) => {
      const next = candidate.markers[ordinal]
      return next === undefined ||
        marker.kind !== next.kind || marker.role !== next.role ||
        marker.relation !== next.relation || marker.action !== next.action
    })
  ) {
    return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
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
    recorder: inventory.recorder
  })
  const commentImpacts: RegionalInventoryCommentImpact[] = []
  for (const resolved of resolvedComments) {
    if (resolved === undefined || resolved.located.ordinal !== start.ordinal) continue
    const node = resolved.node
    const arm = node.arms[0]
    if (arm === undefined || node.commentProjectionLength === undefined) continue
    commentImpacts.push(Object.freeze({
      nodeOrdinal: resolved.nodeOrdinal,
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
