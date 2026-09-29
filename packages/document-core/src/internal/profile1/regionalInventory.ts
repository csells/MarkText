import type {
  CriticMarkupNode,
  ExecutionBudgetId,
  MarkdownNode,
  MarkdownOptionsV1,
  NodeId,
  ResourceDiagnostic,
  SourceRange,
  SyntaxDiagnostic
} from '../../revision.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from '../../resourcePolicy.js'
import {
  parseProfile1Window,
  type Profile1DocumentProducts,
  type RetainedPassSourceEdit
} from '../profile1Document.js'
import type { CanonicalSourceView } from '../persistentCanonicalSource.js'
import type { Profile1PhysicalTraversalRecorderV1 } from './physicalTraversalAccounting.js'
import { markdownReferenceDefinitionLabel, normalizeMarkdownReferenceLabel } from './markdownLaneState.js'
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
  /**
   * The document has stray markers, whose escapes in the Markup view are
   * generated text: they claim no source, so the replacement's coordinates
   * leave them out, as the document's own do.
   */
  readonly strayMarkers: boolean
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

interface DiagnosticCapsule {
  readonly code: SyntaxDiagnostic['code']
  readonly start: number
  readonly end: number
  readonly metadata: SyntaxDiagnostic['metadata']
}

interface MeasuredRegionLeaf {
  readonly kind: 'region'
  readonly sourceLength: number
  readonly syntaxLength: number
  readonly eventCount: number
  readonly annotations: AnnotationCapsule
  readonly markers: readonly MarkerCapsule[]
  /** The leaf's syntax diagnostics, in document order, at leaf offsets. */
  readonly diagnostics: readonly DiagnosticCapsule[]
  /** Forms with an unfinished opener in the leaf, as `FORM_BIT` flags. */
  readonly unterminatedForms: number
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
  readonly unterminatedForms: number
  readonly rootCount: number
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
  /**
   * The document has syntax diagnostics: stray or unfinished markers, whose
   * reading depends on marker spellings anywhere after them (an unfinished
   * opener stays text only while no later closer of its form can close it).
   * An edit then keeps every marker spelling of its window, or proves each
   * closer form it adds has no unfinished opener before it.
   */
  readonly strayMarkers: boolean
  readonly dependencyPrefixEnd: number
  /**
   * Source ranges of the reference and footnote definitions, all before
   * dependencyPrefixEnd, where no regional edit reaches, so they stay put
   * across regional revisions. Undefined when a definition could not be
   * placed in source, as one inside a suggestion.
   */
  readonly definitions?: readonly Readonly<{ readonly start: number; readonly end: number }>[]
  /**
   * The normalized labels of those definitions, read from source once and
   * shared by every inventory derived from this one, as regional edits
   * leave the definitions as they are. Undefined labels are unknown, as
   * for a footnote definition.
   */
  readonly definitionLabels: { read: boolean, labels?: ReadonlySet<string> }
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
    mappedKinds(products, syntaxStart, syntaxEnd),
    diagnosticsWithin(products, sourceStart, sourceEnd)
  )
}

function diagnosticsWithin(
  products: Profile1DocumentProducts,
  sourceStart: number,
  sourceEnd: number
): readonly SyntaxDiagnostic[] {
  const within: SyntaxDiagnostic[] = []
  for (let ordinal = 0; ordinal < products.diagnostics.count; ordinal += 1) {
    const diagnostic = products.diagnostics.at(ordinal)
    if (sourceStart <= diagnostic.range.start && diagnostic.range.end <= sourceEnd) within.push(diagnostic)
  }
  return within
}

const FORM_BIT: Readonly<Record<CriticMarkupNode['kind'], number>> = Object.freeze({
  addition: 1,
  deletion: 2,
  substitution: 4,
  highlight: 8,
  comment: 16
})

const OPENER_FORM: Readonly<Record<string, CriticMarkupNode['kind']>> = Object.freeze({
  '{++': 'addition',
  '{--': 'deletion',
  '{~~': 'substitution',
  '{==': 'highlight',
  '{>>': 'comment'
})

const CLOSER_FORM: Readonly<Record<string, CriticMarkupNode['kind']>> = Object.freeze({
  '++}': 'addition',
  '--}': 'deletion',
  '~~}': 'substitution',
  '==}': 'highlight',
  '<<}': 'comment'
})

function diagnosticCapsules(
  diagnostics: readonly SyntaxDiagnostic[],
  sourceStart: number
): readonly DiagnosticCapsule[] {
  return Object.freeze(diagnostics.map(diagnostic => Object.freeze({
    code: diagnostic.code,
    start: diagnostic.range.start - sourceStart,
    end: diagnostic.range.end - sourceStart,
    metadata: diagnostic.metadata
  })))
}

const ALL_FORMS = 31

type CanonicalSegment = Readonly<{ sourceStart: number, sourceEnd: number, projectedStart: number }>
const canonicalSegmentsByProducts = new WeakMap<Profile1DocumentProducts, readonly CanonicalSegment[]>()

/** The source text of `[start, end)`, read through the Markup view's canonical text. */
function canonicalText(
  products: Profile1DocumentProducts,
  start: number,
  end: number
): string | undefined {
  const editing = products.editing()
  let segments = canonicalSegmentsByProducts.get(products)
  if (segments === undefined) {
    segments = Object.freeze(editing.mappedTape.flatMap(segment => segment.kind === 'canonical'
      ? [Object.freeze({
        sourceStart: segment.sourceStart,
        sourceEnd: segment.sourceStart + segment.projectedEnd - segment.projectedStart,
        projectedStart: segment.projectedStart
      })]
      : []))
    canonicalSegmentsByProducts.set(products, segments)
  }
  let low = 0
  let high = segments.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if ((segments[middle]?.sourceEnd ?? Infinity) < end) low = middle + 1
    else high = middle
  }
  const segment = segments[low]
  if (segment === undefined || segment.sourceStart > start) return undefined
  const projected = segment.projectedStart + start - segment.sourceStart
  return editing.source.slice(projected, projected + end - start)
}

/** Forms of the unfinished openers these diagnostics report, as `FORM_BIT` flags. */
function unterminatedFormsOf(
  diagnostics: readonly SyntaxDiagnostic[],
  products: Profile1DocumentProducts
): number {
  let forms = 0
  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== 'CM_UNTERMINATED_OPENER') continue
    const form = OPENER_FORM[canonicalText(products, diagnostic.range.start, diagnostic.range.end) ?? '']
    // An unfinished opener whose spelling cannot be read back fails closed.
    forms |= form === undefined ? ALL_FORMS : FORM_BIT[form]
  }
  return forms
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
  diagnostics: readonly SyntaxDiagnostic[],
  recorder?: RegionalInventoryRecorder
): MeasuredRegionLeaf {
  return Object.freeze({
    kind: 'region',
    sourceLength: sourceEnd - sourceStart,
    syntaxLength: syntaxEnd - syntaxStart,
    eventCount,
    annotations: annotationCapsule(roots, sourceStart, products, recorder),
    markers: markerCapsules(markerDecisions, sourceStart, recorder),
    diagnostics: diagnosticCapsules(diagnostics, sourceStart),
    unterminatedForms: unterminatedFormsOf(diagnostics, products),
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
    eventCount: left.eventCount + right.eventCount,
    unterminatedForms: unterminatedFormsIn(left) | unterminatedFormsIn(right),
    rootCount: rootCountIn(left) + rootCountIn(right)
  })
}

function unterminatedFormsIn(node: RegionTree): number {
  return node.kind === 'gap' ? 0 : node.unterminatedForms
}

/** Top-level annotations under `node`. */
function rootCountIn(node: RegionTree): number {
  return node.kind === 'gap' ? 0 : node.kind === 'region' ? node.annotations.roots.length : node.rootCount
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
  // Views elide annotation text, so a node's view range is mapped back to
  // source; Original and Revised each resolve their own view-global labels.
  for (const view of products.revised === products.original ? [products.original] : [products.original, products.revised]) {
    const segments = view.mappedTape
    const sourceEnd = (projectedEnd: number): number => {
      let low = 0
      let high = segments.length
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2)
        if ((segments[middle]?.projectedStart ?? Infinity) < projectedEnd) low = middle + 1
        else high = middle
      }
      for (let ordinal = low - 1; ordinal >= 0; ordinal -= 1) {
        const segment = segments[ordinal]
        if (segment?.kind === 'canonical') {
          return segment.sourceStart + Math.min(projectedEnd, segment.projectedEnd) - segment.projectedStart
        }
        if (segment !== undefined) return segment.sourcePosition
      }
      return 0
    }
    const pending: MarkdownNode[] = [view.markdown.root]
    while (pending.length > 0) {
      const node = pending.pop()
      if (node === undefined) break
      if (
        node.kind === 'definition' ||
        node.kind === 'footnote-definition' ||
        node.kind === 'footnote-reference' ||
        typeof node.attributes['referenceLabel'] === 'string'
      ) {
        end = Math.max(end, sourceEnd(node.range.end))
      }
      for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
        pending.push(node.childAt(ordinal))
      }
    }
  }
  return end
}

/**
 * Source ranges of the document's reference and footnote definitions, in
 * source order, or undefined unless each reads identically in every view
 * and maps to canonical source.
 */
function referenceDefinitionRanges(
  products: Profile1DocumentProducts
): readonly Readonly<{ start: number, end: number }>[] | undefined {
  let found: Readonly<{ start: number, end: number }>[] | undefined
  for (const view of products.revised === products.original ? [products.original] : [products.original, products.revised]) {
    const segments = view.mappedTape
    // The canonical segment holding `projected`, entered from `side`.
    const sourceAt = (projected: number, side: 'start' | 'end'): number | undefined => {
      let low = 0
      let high = segments.length
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2)
        const segment = segments[middle]
        if (segment !== undefined && (side === 'start' ? segment.projectedEnd <= projected : segment.projectedEnd < projected)) low = middle + 1
        else high = middle
      }
      const segment = segments[low]
      if (segment?.kind !== 'canonical' || segment.projectedStart > projected ||
          (side === 'start' && segment.projectedStart === segment.projectedEnd)) return undefined
      return segment.sourceStart + projected - segment.projectedStart
    }
    const ranges: Readonly<{ start: number, end: number }>[] = []
    const pending: MarkdownNode[] = [view.markdown.root]
    while (pending.length > 0) {
      const node = pending.pop()
      if (node === undefined) break
      if (node.kind === 'definition' || node.kind === 'footnote-definition') {
        const start = sourceAt(node.range.start, 'start')
        const end = sourceAt(node.range.end, 'end')
        if (start === undefined || end === undefined || end < start) return undefined
        ranges.push(Object.freeze({ start, end }))
        continue
      }
      for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) pending.push(node.childAt(ordinal))
    }
    ranges.sort((left, right) => left.start - right.start)
    if (found !== undefined && (found.length !== ranges.length ||
        found.some((range, ordinal) => range.start !== ranges[ordinal]?.start || range.end !== ranges[ordinal]?.end))) return undefined
    found = ranges
  }
  return Object.freeze(found ?? [])
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

/** The document's definition labels, or undefined when some are unknown. */
function definitionLabelsOf(inventory: InventoryValue, source: CanonicalSourceView): ReadonlySet<string> | undefined {
  if (inventory.dependencyPrefixEnd === 0) return EMPTY_LABELS
  const cache = inventory.definitionLabels
  if (!cache.read) {
    cache.read = true
    const labels = new Set<string>()
    let known = inventory.definitions !== undefined
    for (const definition of inventory.definitions ?? []) {
      const text = source.slice(definition.start, definition.end)
      const label = markdownReferenceDefinitionLabel(text, 0, text.length)
      if (label === undefined) known = false
      else labels.add(label)
    }
    if (known) cache.labels = labels
  }
  return cache.labels
}

const EMPTY_LABELS: ReadonlySet<string> = new Set()

/**
 * Whether `text` spells no bracketed label that names one of `labels`, so
 * none of its links resolves against the document's definitions, however
 * a window reads it.
 */
function labelsMiss(text: string, labels: ReadonlySet<string>): boolean {
  if (labels.size === 0) return true
  for (const match of text.matchAll(/\[((?:[^[\]\\]|\\[\s\S])*)\]/gu)) {
    const inner = match[1] ?? ''
    if (labels.has(normalizeMarkdownReferenceLabel(inner, 0, inner.length))) return false
  }
  return true
}

/**
 * Whether a window of the document from `start` to `end`, reading
 * `previousWindow` before an edit and `nextWindow` after it, reads alike
 * with and without the document's definitions: it holds none of them, and
 * none of its labels names one.
 */
function referencesStayLocal(
  inventory: InventoryValue,
  source: CanonicalSourceView,
  start: number,
  end: number,
  previousWindow: string,
  nextWindow: string
): boolean {
  if (inventory.dependencyPrefixEnd === 0) return true
  const labels = definitionLabelsOf(inventory, source)
  return labels !== undefined &&
    !(inventory.definitions ?? []).some(definition => definition.start < end && definition.end > start) &&
    labelsMiss(previousWindow, labels) && labelsMiss(nextWindow, labels)
}

/** Reference facts after an edit that leaves every definition as it was. */
function shiftedReferenceFacts(
  inventory: InventoryValue,
  edit: RetainedPassSourceEdit,
  delta: number
): Pick<InventoryValue, 'dependencyPrefixEnd' | 'definitions' | 'definitionLabels'> {
  const shift = (position: number): number => position >= edit.end ? position + delta : position
  return Object.freeze({
    dependencyPrefixEnd: inventory.dependencyPrefixEnd === 0 ? 0 : shift(inventory.dependencyPrefixEnd),
    ...(inventory.definitions === undefined
      ? {}
      : {
        definitions: Object.freeze(inventory.definitions.map(definition => Object.freeze({
          start: shift(definition.start), end: shift(definition.end)
        })))
      }),
    definitionLabels: inventory.definitionLabels
  })
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
    retained.rootCount < minimumRoots
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
  let diagnosticCursor = 0
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
    const diagnostics: SyntaxDiagnostic[] = []
    while (diagnosticCursor < products.diagnostics.count) {
      const diagnostic = products.diagnostics.at(diagnosticCursor)
      if (diagnostic.range.start >= sourceEnd) break
      recorder.recordBuildUnit()
      if (!(sourceStart <= diagnostic.range.start && diagnostic.range.end <= sourceEnd)) {
        return undefined
      }
      diagnostics.push(diagnostic)
      diagnosticCursor += 1
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
    const plainRegion = roots.length === 0 && markerDecisions.length === 0 && diagnostics.length === 0 &&
      projectionKinds.every(kind => kind === 'canonical') &&
      syntaxEnd - syntaxStart === sourceEnd - sourceStart &&
      counts[ordinal] === 1 &&
      crossed[ordinal] !== true && crossed[ordinal + 1] !== true
    // Any other block holding no marker, such as a table or a code block
    // whose projection is not its source, stays measured on its own, so
    // the blocks beside it remain editable; one a literal crosses stays
    // opaque, as a window parse could not reproduce it.
    const measuredBlock = roots.length === 0 && !ordinaryParagraph && !plainRegion &&
      markerDecisions.length === 0 && diagnostics.length === 0 && markdownRoots.length > 0 &&
      crossed[ordinal] !== true && crossed[ordinal + 1] !== true
    // Stray markers and their diagnostics stay measured, so an edit beside
    // them can prove it leaves them as they were.
    if (roots.length === 0 && !ordinaryParagraph && !measuredBlock && markerDecisions.length === 0 && diagnostics.length === 0) {
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
        diagnostics,
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
    mappedCursor !== mappedTape.length ||
    diagnosticCursor !== products.diagnostics.count
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
    markerFree: !retained.hasCriticMarkupCandidate,
    strayMarkers: products.diagnostics.count !== 0,
    dependencyPrefixEnd,
    ...(() => {
      const definitions = dependencyPrefixEnd === 0 ? Object.freeze([]) : referenceDefinitionRanges(products)
      return definitions === undefined ? {} : { definitions }
    })(),
    definitionLabels: { read: false },
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
    sameDiagnostics(previous.diagnostics, next.diagnostics) &&
    previous.markers.length === next.markers.length &&
    previous.markers.every((marker, ordinal) => {
      const candidate = next.markers[ordinal]
      return candidate !== undefined &&
        marker.kind === candidate.kind && marker.role === candidate.role &&
        marker.relation === candidate.relation &&
        marker.action === candidate.action
    })
}

/** The same diagnostics in the same order; offsets may move with the edit. */
function sameDiagnostics(
  previous: readonly Pick<DiagnosticCapsule, 'code' | 'metadata'>[],
  next: readonly Pick<DiagnosticCapsule, 'code' | 'metadata'>[]
): boolean {
  return previous.length === next.length && previous.every((diagnostic, ordinal) => {
    const candidate = next[ordinal]
    if (candidate === undefined || candidate.code !== diagnostic.code) return false
    const keys = Object.keys(diagnostic.metadata)
    return keys.length === Object.keys(candidate.metadata).length &&
      keys.every(key => candidate.metadata[key] === diagnostic.metadata[key])
  })
}

/**
 * Whether the diagnostics after an edit are those before it, each moved
 * with the text around it. Offsets are in one coordinate space, with the
 * edit at `[editStart, editEnd)` growing the text by `delta`; a diagnostic
 * the edit touches has no place to move to.
 */
function diagnosticsMoveWithEdit(
  previous: readonly DiagnosticCapsule[],
  next: readonly DiagnosticCapsule[],
  editStart: number,
  editEnd: number,
  delta: number
): boolean {
  if (!sameDiagnostics(previous, next)) return false
  return previous.every((diagnostic, ordinal) => {
    const candidate = next[ordinal]
    if (candidate === undefined) return false
    if (diagnostic.end <= editStart) return candidate.start === diagnostic.start && candidate.end === diagnostic.end
    if (diagnostic.start >= editEnd) return candidate.start === diagnostic.start + delta && candidate.end === diagnostic.end + delta
    return false
  })
}

/**
 * Whether an edit that keeps its window's marker spellings is also local in
 * a document with stray markers. Every spelling keeps its reading because
 * none is added, removed or re-spelled, and no table cell changes, since
 * whether an unfinished opener can close depends on the cells of every
 * later closer of its form (profile rule R3b).
 */
function strayMarkersUnchanged(previousWindow: string, nextWindow: string): boolean {
  return !previousWindow.includes('|') && !nextWindow.includes('|') &&
    markerSpellingSequence(previousWindow) === markerSpellingSequence(nextWindow)
}

const MARKER_SPELLING = /(?=(\{\+\+|\{--|\{~~|\{==|\{>>|~>|\+\+\}|--\}|~~\}|==\}|<<\}))/gu

/** The marker spellings of `text` in order, overlapping spellings each read. */
function markerSpellingSequence(text: string): string {
  return [...text.matchAll(MARKER_SPELLING)].map(match => match[1]).join(' ')
}

/**
 * Whether two marker spellings of `text` overlap, as in `{++}`: which of
 * them the document reads depends on markers far away.
 */
function overlappingSpellings(text: string): boolean {
  let previousEnd = -1
  for (const match of text.matchAll(MARKER_SPELLING)) {
    if (match.index < previousEnd) return true
    previousEnd = match.index + (match[1]?.length ?? 0)
  }
  return false
}

/** Forms whose closer `nextWindow` spells more often than `previousWindow` does. */
function addedCloserForms(previousWindow: string, nextWindow: string): number {
  const counts = (text: string): Map<string, number> => {
    const result = new Map<string, number>()
    for (const match of text.matchAll(MARKER_SPELLING)) {
      const spelling = match[1] ?? ''
      if (CLOSER_FORM[spelling] !== undefined) result.set(spelling, (result.get(spelling) ?? 0) + 1)
    }
    return result
  }
  const before = counts(previousWindow)
  let forms = 0
  for (const [spelling, count] of counts(nextWindow)) {
    const form = CLOSER_FORM[spelling]
    if (form !== undefined && count > (before.get(spelling) ?? 0)) forms |= FORM_BIT[form]
  }
  return forms
}

/** Forms with an unfinished opener in the leaves before `ordinal`. */
function unterminatedFormsBefore(node: RegionTree, ordinal: number): number {
  if (ordinal <= 0) return 0
  if (node.kind !== 'branch') return unterminatedFormsIn(node)
  const leftCount = leafCount(node.left)
  return ordinal <= leftCount
    ? unterminatedFormsBefore(node.left, ordinal)
    : unterminatedFormsIn(node.left) | unterminatedFormsBefore(node.right, ordinal - leftCount)
}

/** Forms with an unfinished opener in the leaves from `ordinal` on. */
function unterminatedFormsFrom(node: RegionTree, ordinal: number): number {
  if (ordinal >= leafCount(node)) return 0
  if (ordinal <= 0) return unterminatedFormsIn(node)
  if (node.kind !== 'branch') return 0
  const leftCount = leafCount(node.left)
  return ordinal >= leftCount
    ? unterminatedFormsFrom(node.right, ordinal - leftCount)
    : unterminatedFormsFrom(node.left, ordinal) | unterminatedFormsIn(node.right)
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

/**
 * The blocks holding `range` with an unchanged block of context on each
 * side, parsed as the window an edit there would parse, for reading a
 * revision without its document parse. Nothing is replaced, so any block
 * kind reads there; the window's safe points and marker readings must still
 * match the document's for its blocks to read as they do in the whole
 * document.
 */
export function previewRegionalRange(
  inventory: RegionalInventory,
  source: CanonicalSourceView,
  range: Readonly<{ readonly start: number; readonly end: number }>,
  executionBudget: ExecutionBudgetId,
  markdownOptions: MarkdownOptionsV1,
  physicalRecorder: Profile1PhysicalTraversalRecorderV1
): Readonly<{ sourceStart: number, nextProducts: Profile1DocumentProducts, nextWindow: string }> | undefined {
  const window = regionalRangeWindow(inventory, source, range, executionBudget, markdownOptions, physicalRecorder)
  return window?.validated === true
    ? Object.freeze({ sourceStart: window.sourceStart, nextProducts: window.nextProducts, nextWindow: window.nextWindow })
    : undefined
}

/**
 * The window previewRegionalRange() parses for `range`, also when it cannot
 * prove that its blocks read as in the whole document (`validated` false):
 * its safe points do not stand, its marker readings differ from the
 * document's, or reference definitions reach it. A caller then proves what it
 * reads there against the document some other way. `labelsOnly` marks a
 * window whose one doubt is a label naming one of the document's
 * definitions, which the window reads as plain text.
 */
export function regionalRangeWindow(
  inventory: RegionalInventory,
  source: CanonicalSourceView,
  range: Readonly<{ readonly start: number; readonly end: number }>,
  executionBudget: ExecutionBudgetId,
  markdownOptions: MarkdownOptionsV1,
  physicalRecorder: Profile1PhysicalTraversalRecorderV1
): Readonly<{ sourceStart: number, nextProducts: Profile1DocumentProducts, nextWindow: string, validated: boolean, labelsOnly: boolean }> | undefined {
  const value = inventoryValue(inventory)
  const length = source.length
  if (length !== value.root.sourceLength || length === 0 || range.end > length) return undefined
  const referenced = (first: number, last: number): boolean => {
    const window = source.slice(first, last)
    return !referencesStayLocal(value, source, first, last, window, window)
  }
  let edited = windowEdge(value, range.start, 'start')
  let editedEnd = windowEdge(value, range.end, 'end')
  if (edited === undefined || editedEnd === undefined || editedEnd.ordinal < edited.ordinal ||
      edited.source > range.start || editedEnd.source < range.end) {
    return undefined
  }
  for (let widening = 0; ; widening += 1) {
    const first: WindowEdge | undefined = edited.source > 0 ? windowEdge(value, edited.source - 1, 'start') : edited
    const last: WindowEdge | undefined = editedEnd.source < length ? windowEdge(value, editedEnd.source, 'end') : editedEnd
    if (first === undefined || last === undefined) return undefined
    const window = source.slice(first.source, last.source)
    value.recorder.recordCandidateRegionParse(window.length)
    const result = parseProfile1Window(
      window,
      executionBudget,
      first.source === 0 ? markdownOptions : Object.freeze({ ...markdownOptions, frontMatter: false }),
      false,
      physicalRecorder,
      last.source === length
    )
    if (result.kind !== 'complete') return undefined
    const read = (validated: boolean) => {
      const labels = referenced(first.source, last.source)
      validated &&= !frontMatterReach(markdownOptions, first.source, range.start, window) &&
        !unpairedLiteralRuns(result, window)
      return Object.freeze({
        sourceStart: first.source,
        nextProducts: result,
        nextWindow: window,
        validated: validated && !labels,
        labelsOnly: validated && labels
      })
    }
    const safePoints = result.retainedIntrinsic?.safePoints ?? []
    const startStands = edited.source === first.source || safePoints.includes(edited.source - first.source)
    const endStands = editedEnd.source === last.source || safePoints.includes(editedEnd.source - first.source)
    if (!startStands || !endStands) {
      if (widening === 2) return read(false)
      if (!startStands) edited = first
      if (!endStands) editedEnd = last
      continue
    }
    const documentMarkers: MarkerCapsule[] = []
    for (const located of leafRange(value.root, first.ordinal, last.ordinal)) {
      if (located.leaf.kind === 'region') documentMarkers.push(...located.leaf.markers)
      else if (located.leaf.plain === undefined) return read(false)
    }
    const windowMarkers = markerCapsules(result.retainedIntrinsic?.markerDecisions ?? [], 0)
    return read(windowMarkers.length === documentMarkers.length && windowMarkers.every((marker, ordinal) => {
      const document = documentMarkers[ordinal]
      return document !== undefined && marker.kind === document.kind && marker.role === document.role &&
        marker.action === document.action
    }))
  }
}

/**
 * Whether replacing the blocks from `start` to `end` with `nextWindow`, which
 * holds `nextRoots` root annotations and an unfinished opener when
 * `nextUnfinished`, keeps every marker reading outside those blocks, as a
 * block window requires in a document with stray markers: no table cell
 * changes, no spellings overlap, no closer form it adds has an unfinished
 * opener before it, and while any opener stays unfinished the document keeps
 * having annotations or not having any. With `escapingSeen`, a caller that
 * parses the whole result and whose blocks held an unfinished opener of
 * their own (so saw its escaping change too) accepts that last change.
 * Always true without stray markers.
 */
export function strayMarkersStayLocal(
  inventory: RegionalInventory,
  source: CanonicalSourceView,
  start: number,
  end: number,
  nextWindow: string,
  nextRoots: number,
  nextUnfinished: boolean,
  escapingSeen = false
): boolean {
  const value = inventoryValue(inventory)
  if (!value.strayMarkers) return true
  if (source.length !== value.root.sourceLength) return false
  const first = windowEdge(value, start, 'start')
  const last = end > start ? windowEdge(value, end - 1, 'end') : undefined
  if (first === undefined || last === undefined || first.source !== start || last.source !== end) return false
  const previousWindow = source.slice(start, end)
  if (previousWindow.includes('|') || nextWindow.includes('|') || overlappingSpellings(nextWindow) ||
      (unterminatedFormsBefore(value.root, first.ordinal) & addedCloserForms(previousWindow, nextWindow)) !== 0) return false
  let replacedRoots = 0
  for (const located of leafRange(value.root, first.ordinal, last.ordinal)) replacedRoots += rootCountIn(located.leaf)
  const documentRoots = rootCountIn(value.root)
  const unfinished = nextUnfinished ||
    (unterminatedFormsBefore(value.root, first.ordinal) | unterminatedFormsFrom(value.root, last.ordinal + 1)) !== 0
  return escapingSeen || !unfinished || (documentRoots - replacedRoots + nextRoots > 0) === (documentRoots > 0)
}

/**
 * The source ranges of the root annotations overlapping `start`..`end`, read
 * from the inventory's leaves without materializing an annotation.
 */
export function regionalInventoryRootRanges(
  inventory: RegionalInventory,
  start: number,
  end: number
): readonly Readonly<{ start: number, end: number }>[] {
  const value = inventoryValue(inventory)
  const from = locateBySource(value, Math.min(start, Math.max(0, value.root.sourceLength - 1)))
  const to = locateBySource(value, Math.min(Math.max(start, end - 1), Math.max(0, value.root.sourceLength - 1)))
  if (from === undefined || to === undefined) return []
  const ranges: Readonly<{ start: number, end: number }>[] = []
  for (const located of leafRange(value.root, from.ordinal, to.ordinal)) {
    if (located.leaf.kind !== 'region') continue
    const { nodes, roots } = located.leaf.annotations
    for (const ordinal of roots) {
      const node = nodes[ordinal]
      if (node === undefined) continue
      const range = { start: located.sourceStart + node.start, end: located.sourceStart + node.end }
      if (range.start < end && range.end > start) ranges.push(Object.freeze(range))
    }
  }
  return Object.freeze(ranges)
}

/** How many root annotations the document holds. */
export function regionalInventoryRootCount(inventory: RegionalInventory): number {
  return rootCountIn(inventoryValue(inventory).root)
}

/**
 * The source ranges of the document's reference and footnote definitions,
 * none when it resolves no label, or undefined when they are not known.
 */
export function regionalInventoryDefinitions(
  inventory: RegionalInventory
): readonly Readonly<{ readonly start: number; readonly end: number }>[] | undefined {
  const value = inventoryValue(inventory)
  return value.dependencyPrefixEnd === 0 ? Object.freeze([]) : value.definitions
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

const SPACES_LINE = /(?:^|\r\n|\r|\n)[ \t]+(?:\r\n|\r|\n|$)/u
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
    definitionLabelsOf(inventory, previousSource) === undefined
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
  const pairingChanged = editChangesLiteralPairing(previousSource, edit)
  if ((pairingChanged && !inventory.markerFree) || editTouchesMarker(start.leaf, localStart, localEnd)) {
    return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
  }
  const delta = nextSource.length - previousSource.length
  const nextWindow = nextSource.slice(
    start.sourceStart,
    start.sourceStart + start.leaf.sourceLength + delta
  )
  const previousWindow = previousSource.slice(start.sourceStart, start.sourceStart + start.leaf.sourceLength)
  // An empty paragraph reads a whitespace-only line differently when no
  // block follows it in the parsed text, as none does in a lone region.
  if (
    frontMatterReach(markdownOptions, start.sourceStart, edit.start, previousWindow, nextWindow) ||
    EMPTY_PARAGRAPH.test(nextWindow) ||
    EMPTY_PARAGRAPH.test(previousWindow) ||
    inventory.strayMarkers && !strayMarkersUnchanged(previousWindow, nextWindow)
  ) {
    return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
  }
  inventory.recorder.recordCandidateRegionParse(nextWindow.length)
  const result = parseProfile1Window(
    nextWindow,
    executionBudget,
    markdownOptions,
    false,
    physicalRecorder,
    start.sourceStart + start.leaf.sourceLength + delta === nextSource.length,
    rootCountIn(inventory.root) > 0
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
  // A line of spaces that only a comment's hidden text shared is such a line too.
  if ((result.retainedIntrinsic?.safePoints.length ?? 0) !== 0 || !viewBlocksAgree(result) ||
      SPACES_LINE.test(result.editing().source) || unpairedLiteralRuns(result, nextWindow)) {
    return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
  }
  if (
    referenceDependencyPrefixEnd(result) !== 0 ||
    !referencesStayLocal(inventory, previousSource, start.sourceStart, start.sourceStart + start.leaf.sourceLength,
      previousWindow, nextWindow)
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
  if (
    !sameRegionShape(start.leaf, candidate) ||
    !diagnosticsMoveWithEdit(start.leaf.diagnostics, candidate.diagnostics, localStart, localEnd, delta)
  ) {
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
    markerFree: inventory.markerFree && !pairingChanged && !(result.retainedIntrinsic?.hasCriticMarkupCandidate ?? true),
    strayMarkers: inventory.strayMarkers,
    ...shiftedReferenceFacts(inventory, edit, delta),
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
    const parsed = parseProfile1Window(
      window,
      executionBudget,
      markdownOptions,
      false,
      physicalRecorder,
      nextSourceStart + resolved.located.leaf.sourceLength === nextSource.length,
      rootCountIn(inventory.root) > 0
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
    if ((parsed.retainedIntrinsic?.safePoints.length ?? 0) !== 0) {
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
    commentImpacts: Object.freeze(commentImpacts),
    strayMarkers: inventory.strayMarkers
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
  recorder: RegionalInventoryRecorder,
  strayMarkers: boolean,
  labelsUnresolvable: boolean
): BlockWindowFacts | undefined {
  const retained = products.retainedIntrinsic
  if (
    retained === undefined ||
    // Diagnostics are compared with the replaced leaves' own by the caller.
    !strayMarkers && products.diagnostics.count !== 0 ||
    referenceDependencyPrefixEnd(products) !== 0 ||
    (!labelsUnresolvable && containsPotentialReferenceDependency(window))
  ) {
    return undefined
  }
  const editing = products.editing()
  if (editing.markdown.root.childCount === 0) return undefined
  if (!strayMarkers && editing.mappedTape.some(segment => segment.kind !== 'canonical')) return undefined
  if (!strayMarkers && !markersPaired(retained.markerDecisions)) return undefined
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
 * The intrinsic pass pairs a backtick or dollar run with a later equal run
 * beyond its paragraph, so adding, removing, joining or splitting a run (or a
 * backslash escaping one) can change CriticMarkup recognition in blocks no
 * window contains. A document spelling no marker has nothing to recognize,
 * so such an edit stays regional there but no longer proves later markers.
 */
function editChangesLiteralPairing(source: CanonicalSourceView, edit: RetainedPassSourceEdit): boolean {
  return /[`$\\]/u.test(edit.insert) ||
    /[`$\\]/u.test(source.slice(Math.max(0, edit.start - 1), Math.min(source.length, edit.end + 1)))
}

/**
 * Whether the Markup view's blocks, read from the escaped text that elides
 * unfinished openers, are the blocks of the editing parse the inventory
 * measures. Where escaping changes them, their reading depends on markers
 * anywhere in the document, which a window cannot see.
 */
/**
 * Whether the window spells a backtick or dollar run its parse pairs with no
 * other. The intrinsic pass pairs such a run with a later equal one beyond
 * its paragraph, even past block boundaries (a `$$` line opening display
 * math until the next one), so in the document a run outside the window may
 * pair with it and read the text between, and the block boundaries there,
 * differently than the window does.
 */
function unpairedLiteralRuns(products: Profile1DocumentProducts, window: string): boolean {
  const literals = products.retainedIntrinsic?.markdownLiterals ?? []
  for (const run of window.matchAll(/`+|\$+/gu)) {
    const start = run.index
    const end = start + run[0].length
    if (!literals.some(literal => literal.start <= start && end <= literal.end)) return true
  }
  return false
}

function viewBlocksAgree(products: Profile1DocumentProducts): boolean {
  const editing = products.editing()
  const semantic = editing.semanticMarkdown
  if (semantic === undefined) return true
  const toProjected = editing.semanticToProjected ?? ((offset: number): number => offset)
  const measured = editing.markdown.root
  const viewed = semantic.root
  if (measured.childCount !== viewed.childCount) return false
  for (let ordinal = 0; ordinal < measured.childCount; ordinal += 1) {
    const block = measured.childAt(ordinal)
    const view = viewed.childAt(ordinal)
    if (block.kind !== view.kind || block.range.start !== toProjected(view.range.start, 'previous') ||
        block.range.end !== toProjected(view.range.end, 'previous')) return false
  }
  return true
}

/**
 * Whether an edit at `editStart` in a window starting the document may change
 * its front matter, which runs from the first line to its closing line
 * wherever that is, so no window can bound it: the window opens front
 * matter that it does not close before the edit.
 */
function frontMatterReach(markdownOptions: MarkdownOptionsV1, start: number, editStart: number, ...windows: string[]): boolean {
  if (start !== 0 || !markdownOptions.frontMatter) return false
  return windows.some(window => {
    const opener = /^(---|\+\+\+)[ \t]*(?:\r\n|\r|\n|$)/u.exec(window)
    if (opener === null) return false
    const fence = opener[1] === '---' ? /^(?:---|\.\.\.)[ \t]*$/u : /^\+\+\+[ \t]*$/u
    let offset = opener[0].length
    for (const line of window.slice(offset).split(/(?<=\r\n|\r(?!\n)|\n)/u)) {
      offset += line.length
      if (fence.test(line.replace(/(?:\r\n|\r|\n)$/u, ''))) return editStart <= offset
    }
    return true
  })
}

/** Positions where a CriticMarkup marker is spelled, overlapping spellings each counted. */
function markerSpellings(text: string): number {
  return [...text.matchAll(/(?=\{\+\+|\{--|\{~~|\{==|\{>>|~>|\+\+\}|--\}|~~\}|==\}|<<\})/gu)].length
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
    (inventory.dependencyPrefixEnd !== 0 && definitionLabelsOf(inventory, previousSource) === undefined)
  ) {
    return undefined
  }
  const pairingChanged = editChangesLiteralPairing(previousSource, edit)
  if (pairingChanged && !inventory.markerFree) return undefined
  // Markers pair as one nested stack across the document, and backtick and
  // dollar runs pair beyond their paragraphs. A window proves changed markers
  // only where nothing outside it can reach them: in a document spelling no
  // markers, or in one without those runs where every marker spelling is a
  // recognized marker (an inventory's markers all pair), so no spelling
  // elsewhere can start pairing with the window's.
  // With stray markers, a changed marker is proved by the window's diagnostics
  // staying as they were and by no unfinished opener before the window
  // having a closer form the edit adds (checked once the window is parsed).
  const touchesMarkers = /[{}]/u.test(edit.insert + previousSource.slice(edit.start, edit.end))
  const markersProvable = inventory.markerFree || touchesMarkers && (() => {
    const previousText = previousSource.slice(0, previousSource.length)
    if (/[`$\\]/u.test(previousText) || /[`$\\]/u.test(edit.insert)) return false
    if (inventory.strayMarkers) return true
    let recognized = 0
    for (const leaf of leavesOf(inventory.root)) if (leaf.kind === 'region') recognized += leaf.markers.length
    return markerSpellings(previousText) === recognized
  })()
  if (touchesMarkers && !markersProvable) return undefined
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
    const result = parseProfile1Window(
      nextWindow,
      executionBudget,
      first.source === 0 ? markdownOptions : Object.freeze({ ...markdownOptions, frontMatter: false }),
      false,
      physicalRecorder,
      atDocumentEnd,
      rootCountIn(inventory.root) > 0
    )
    // The document parse reports a window's resource failure authoritatively.
    if (result.kind !== 'complete' || !viewBlocksAgree(result) || unpairedLiteralRuns(result, nextWindow)) return undefined
    const previousWindow = previousSource.slice(first.source, last.source)
    if (frontMatterReach(markdownOptions, first.source, edit.start, previousWindow, nextWindow)) return undefined
    if (inventory.strayMarkers && (markersProvable
      ? previousWindow.includes('|') || nextWindow.includes('|') || overlappingSpellings(nextWindow) ||
        (unterminatedFormsBefore(inventory.root, first.ordinal) & addedCloserForms(previousWindow, nextWindow)) !== 0
      : !strayMarkersUnchanged(previousWindow, nextWindow))) return undefined
    // Splitting or joining paragraphs moves the bound that stops a backtick
    // run pairing with a later one.
    if (!inventory.markerFree && /[\r\n]/u.test(edit.insert + previousSource.slice(edit.start, edit.end)) &&
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
    // The unchanged blocks around the edited ones must read as they did: an
    // edited block's kind can change how blank lines before or after it are
    // read, as editable empty paragraphs before an HTML block.
    inventory.recorder.recordCandidateRegionParse(previousWindow.length)
    const previousResult = parseProfile1Window(
      previousWindow,
      executionBudget,
      first.source === 0 ? markdownOptions : Object.freeze({ ...markdownOptions, frontMatter: false }),
      false,
      physicalRecorder,
      last.source === length,
      rootCountIn(inventory.root) > 0
    )
    if (previousResult.kind !== 'complete') return undefined
    if (!referencesStayLocal(inventory, previousSource, first.source, last.source, previousWindow, nextWindow)) return undefined
    return admitBlockWindow(
      inventory, edit, delta, edited, editedEnd, first, last,
      result, nextWindow, previewOnly, markersProvable, previousResult, pairingChanged
    )
  }
}

/**
 * Whether the top-level blocks before `[previousStart, previousEnd)` in the
 * window before an edit, and after it, are those before `[nextStart,
 * nextEnd)` and after it in the window after the edit, at the same offsets
 * from the edited blocks.
 */
function contextBlocksUnchanged(
  previous: Profile1DocumentProducts,
  next: Profile1DocumentProducts,
  previousStart: number,
  nextStart: number,
  previousEnd: number,
  nextEnd: number
): boolean {
  const blocks = (products: Profile1DocumentProducts, keep: (start: number) => boolean, shift: number): string[] => {
    const root = products.editing().markdown.root
    const result: string[] = []
    for (let ordinal = 0; ordinal < root.childCount; ordinal += 1) {
      const block = root.childAt(ordinal)
      if (keep(block.range.start)) result.push(`${block.kind}:${block.range.start - shift}:${block.range.end - shift}`)
    }
    return result
  }
  return sameArray(
    blocks(previous, start => start < previousStart, 0),
    blocks(next, start => start < nextStart, 0)
  ) && sameArray(
    blocks(previous, start => start >= previousEnd && start > previousStart, previousEnd),
    blocks(next, start => start >= nextEnd && start > nextStart, nextEnd)
  )
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
  previewOnly: boolean,
  markersProvable: boolean,
  previousResult: Profile1DocumentProducts,
  pairingChanged: boolean
): RegionalInventoryApplyResult | RegionalInventoryPreviewResult | undefined {
  // Labels read alike in the window and in place (checked by the caller).
  const facts = blockWindowFacts(result, nextWindow, inventory.recorder, inventory.strayMarkers, true)
  if (facts === undefined) return undefined
  if (markersProvable && !inventory.markerFree && !inventory.strayMarkers &&
      markerSpellings(nextWindow) !== (result.retainedIntrinsic?.markerDecisions.length ?? 0)) return undefined
  if (inventory.strayMarkers) {
    const previousDiagnostics: DiagnosticCapsule[] = []
    for (const located of leafRange(inventory.root, first.ordinal, last.ordinal)) {
      if (located.leaf.kind !== 'region') continue
      previousDiagnostics.push(...located.leaf.diagnostics.map(diagnostic => ({
        ...diagnostic,
        start: located.sourceStart + diagnostic.start,
        end: located.sourceStart + diagnostic.end
      })))
    }
    const nextDiagnostics: DiagnosticCapsule[] = []
    for (let ordinal = 0; ordinal < result.diagnostics.count; ordinal += 1) {
      nextDiagnostics.push(...diagnosticCapsules([result.diagnostics.at(ordinal)], -first.source))
    }
    if (!diagnosticsMoveWithEdit(previousDiagnostics, nextDiagnostics, edit.start, edit.end, delta)) return undefined
  }
  if (!markersProvable) {
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
  if (!contextBlocksUnchanged(
    previousResult, result,
    edited.syntax - first.syntax, syntaxBoundaries[from] ?? 0,
    editedEnd.syntax - first.syntax, syntaxBoundaries[to] ?? 0
  )) return undefined
  if (inventory.strayMarkers) {
    // An unfinished opener is escaped in the views of a document with
    // annotations and not in one without, so while any remains an edit may
    // not add the first annotation or remove the last.
    let replacedRoots = 0
    for (const located of leafRange(inventory.root, edited.ordinal, editedEnd.ordinal)) {
      replacedRoots += rootCountIn(located.leaf)
    }
    const editedRoots = (result.retainedIntrinsic?.roots ?? []).filter(root =>
      root.range.start >= editedStart && root.range.end <= editedStop).length
    const documentRoots = rootCountIn(inventory.root)
    const unfinished = (unterminatedFormsBefore(inventory.root, edited.ordinal) |
      unterminatedFormsFrom(inventory.root, editedEnd.ordinal + 1)) !== 0 ||
      (result.retainedIntrinsic?.diagnostics ?? []).some(diagnostic => diagnostic.code === 'CM_UNTERMINATED_OPENER')
    if (unfinished && (documentRoots - replacedRoots + editedRoots > 0) !== (documentRoots > 0)) return undefined
  }
  // Views replace the edited blocks in place, whatever their kind; with
  // stray markers, only paragraphs, whose unfinished openers the window reads
  // as the document does.
  const editedBlocks = result.editing().markdown.root
  let replacedBlocks = 0
  for (let ordinal = 0; ordinal < editedBlocks.childCount; ordinal += 1) {
    const block = editedBlocks.childAt(ordinal)
    if (block.range.start < (syntaxBoundaries[from] ?? 0) || block.range.start >= (syntaxBoundaries[to] ?? 0)) continue
    if (inventory.strayMarkers && block.kind !== 'paragraph') return undefined
    replacedBlocks += 1
  }
  if (replacedBlocks === 0) return undefined
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
    !retained.diagnostics.some(diagnostic => diagnostic.range.end > editedStart && diagnostic.range.start < editedStop) &&
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
      markerFree: inventory.markerFree && !pairingChanged && !(result.retainedIntrinsic?.hasCriticMarkupCandidate ?? true) &&
        (result.retainedIntrinsic?.markerDecisions.length ?? 0) === 0,
      strayMarkers: inventory.strayMarkers,
      ...shiftedReferenceFacts(inventory, edit, delta),
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
    commentImpacts: Object.freeze([]),
    strayMarkers: inventory.strayMarkers
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
    strayMarkers: false,
    dependencyPrefixEnd: index.dependencyPrefixEnd,
    definitionLabels: { read: false },
    recorder,
    plainRecorder
  })
}

/** The document's syntax diagnostics, in document order, at document offsets. */
export function materializeRegionalInventoryDiagnostics(
  inventory: RegionalInventory
): readonly SyntaxDiagnostic[] {
  const diagnostics: SyntaxDiagnostic[] = []
  const pending: Array<Readonly<{ node: RegionTree, sourceStart: number }>> = [{ node: inventoryValue(inventory).root, sourceStart: 0 }]
  while (pending.length > 0) {
    const task = pending.pop()
    if (task === undefined) break
    const { node, sourceStart } = task
    if (node.kind === 'branch') {
      pending.push({ node: node.right, sourceStart: sourceStart + node.left.sourceLength }, { node: node.left, sourceStart })
    } else if (node.kind === 'region') {
      for (const diagnostic of node.diagnostics) {
        diagnostics.push(Object.freeze({
          code: diagnostic.code,
          range: internalRange(sourceStart + diagnostic.start, sourceStart + diagnostic.end),
          metadata: diagnostic.metadata
        }))
      }
    }
  }
  return Object.freeze(diagnostics)
}

/** Every annotation of the inventory, in document order. */
export function materializeRegionalInventoryAnnotations(
  inventory: RegionalInventory
): readonly RegionalInventoryAnnotation[] {
  const value = inventoryValue(inventory)
  return materializeLeafAnnotations(value, regionLeavesIn(value.root, 0, Number.POSITIVE_INFINITY))
}

/**
 * The root annotations of the region leaves around `position`: the leaves
 * touching it and the next region leaf after them, so an annotation there
 * comes with the sibling that directly follows it.
 */
export function materializeRegionalInventoryAnnotationsAround(
  inventory: RegionalInventory,
  position: number
): readonly RegionalInventoryAnnotation[] {
  const value = inventoryValue(inventory)
  const leaves = regionLeavesIn(value.root, position - 1, position + 1)
  const last = leaves.at(-1)
  const following = regionLeavesIn(
    value.root,
    last === undefined ? position + 1 : last.sourceStart + last.leaf.sourceLength,
    Number.POSITIVE_INFINITY,
    3,
    // A leaf of stray markers holds no annotation to follow one.
    leaf => leaf.annotations.roots.length > 0
  ).find(located => !leaves.some(item => item.sourceStart === located.sourceStart))
  return materializeLeafAnnotations(value, following === undefined ? leaves : [...leaves, following])
}

/**
 * The root annotations of the region leaves touching `[from, to]`: each
 * annotation that overlaps or touches that range comes with its root.
 */
export function materializeRegionalInventoryAnnotationsIn(
  inventory: RegionalInventory,
  from: number,
  to: number
): readonly RegionalInventoryAnnotation[] {
  const value = inventoryValue(inventory)
  return materializeLeafAnnotations(value, regionLeavesIn(value.root, from, to))
}

/** Region leaves whose source touches `[from, to]`, in document order, at most `limit` of them. */
function regionLeavesIn(
  root: RegionTree,
  from: number,
  to: number,
  limit = Number.POSITIVE_INFINITY,
  include: (leaf: MeasuredRegionLeaf) => boolean = () => true
): Array<Readonly<{ leaf: MeasuredRegionLeaf, sourceStart: number }>> {
  const located: Array<Readonly<{ leaf: MeasuredRegionLeaf, sourceStart: number }>> = []
  const pending: Array<Readonly<{ node: RegionTree, sourceStart: number }>> = [{ node: root, sourceStart: 0 }]
  while (pending.length > 0 && located.length < limit) {
    const task = pending.pop()
    if (task === undefined) break
    if (task.sourceStart > to || task.sourceStart + task.node.sourceLength < from) continue
    if (task.node.kind !== 'branch') {
      if (task.node.kind === 'region' && include(task.node)) located.push(Object.freeze({ leaf: task.node, sourceStart: task.sourceStart }))
      continue
    }
    pending.push({ node: task.node.right, sourceStart: task.sourceStart + task.node.left.sourceLength })
    pending.push({ node: task.node.left, sourceStart: task.sourceStart })
  }
  return located
}

function materializeLeafAnnotations(
  value: InventoryValue,
  locatedLeaves: ReadonlyArray<Readonly<{ leaf: MeasuredRegionLeaf, sourceStart: number }>>
): readonly RegionalInventoryAnnotation[] {
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
