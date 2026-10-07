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
  windowsBeforeDocumentEnd,
  windowsEndingAtBlockStart,
  windowsNotAfterOneEmptyLine,
  type Profile1DocumentProducts,
  type RetainedPassSourceEdit
} from '../profile1Document.js'
import type { CanonicalSourceView } from '../persistentCanonicalSource.js'
import type { Profile1PhysicalTraversalRecorderV1 } from './physicalTraversalAccounting.js'
import type { MappedProjectionSegment } from './syntaxGraph.js'
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
   * Present when the replaced blocks are items of one top-level list that
   * keeps items outside them: the list keeps its extent and reading, and
   * its `itemsBefore` items before the replaced ones.
   */
  readonly listItems?: Readonly<{
    readonly key: string
    readonly itemsBefore: number
    readonly previousItems: number
    readonly nextItems: number
  }>
  /**
   * Present when the replaced blocks are lines of one literal block that
   * keeps lines outside them: the block keeps its reading, and its
   * `linesBefore` lines, of `childrenBefore` children, before the replaced
   * ones. The window's block stands for the whole block there: the text
   * before `window.blocks` is the block's opener and the lines before, and
   * the text after it the lines after and the closer.
   */
  readonly literalLines?: LiteralLines
  /**
   * Present when the replaced lines are lines of a literal block that is
   * the whole text of a suggestion's arm (see `admitArmLiteralLines`): the
   * replaced span is the Markup text event holding the block, which keeps
   * its other lines; `lines` is the replaced lines' range in the window
   * and in the document's next source and projection; the suggestions
   * holding the block keep their starts and move their ends with the edit.
   */
  readonly armLines?: Readonly<{
    readonly lines: Readonly<{ readonly start: number; readonly end: number }>
    readonly source: number
    readonly syntax: number
    readonly enclosing: readonly Readonly<{ readonly start: number; readonly end: number }>[]
  }>
  /**
   * Present when the edit struck a long literal block and proposed it again
   * with lines near a key changed, as a first tracked key there does (see
   * `admitArmCreation`): the products, window and these spans read the
   * edit with the block's lines far from the key left out, which each of
   * `previous` and `next` puts back where its points say.
   */
  readonly armCreation?: ArmCreation
  /**
   * The document has stray markers, whose escapes in the Markup view are
   * generated text: they claim no source, so the replacement's coordinates
   * leave them out, as the document's own do.
   */
  readonly strayMarkers: boolean
}

/**
 * Whole lines left out of a literal block, each with its line break: put
 * back at `at`, the start of the kept line they stood before, which every
 * position from `at` on moves past.
 */
export interface LeftOutLines {
  readonly at: number
  readonly length: number
  readonly text: string
}

export interface ArmCreation {
  readonly previous: Readonly<{ span: RegionalInventorySpan, lines: readonly LeftOutLines[] }>
  readonly next: Readonly<{ span: RegionalInventorySpan, lines: readonly LeftOutLines[] }>
}

export interface LiteralLines {
  readonly key: string
  readonly linesBefore: number
  readonly childrenBefore: number
  readonly previousLines: number
  readonly previousChildren: number
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
  /**
   * Present when the window reads a long literal block struck and proposed
   * again with lines far from a key left out (see `admitArmCreation`): its
   * products then read the edit's blocks but not their source extents.
   */
  readonly armCreation?: true
  /**
   * The window begins at the first edited block, whose block before it
   * reads the same whatever that block becomes (see `contextBefore`).
   */
  readonly cleanStart?: true
  /**
   * The window ends with the last edited block, whose block after it reads
   * the same whatever that block becomes (see `contextAfter`).
   */
  readonly cleanEnd?: true
  /**
   * The window is one leaf read alone, bounded by safe points, so the whole
   * of it reads as the document does (see `evaluateSameShape`).
   */
  readonly wholeLeaf?: true
  /**
   * Present for a window of a literal block's lines: its text before
   * `lines.start` is the block's opener line, whose document source starts
   * at `opener`, and its text from `lines.end` the block's closer, starting
   * at `closer`; its text between is the document's from `sourceStart +
   * lines.start`.
   */
  readonly literal?: Readonly<{
    readonly lines: Readonly<{ readonly start: number; readonly end: number }>
    readonly opener: number
    readonly closer: number
  }>
  /**
   * Present for a window of lines of a literal block that is the whole
   * text of a suggestion's arm: the suggestion and the arm, in the
   * document's next source, which the window itself does not spell.
   */
  readonly arm?: Readonly<{
    readonly kind: CriticMarkupNode['kind']
    readonly name: CapsuleArm['name']
    readonly range: Readonly<{ readonly start: number; readonly end: number }>
    readonly annotation: Readonly<{ readonly start: number; readonly end: number }>
  }>
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
  /**
   * The leaf-relative Start and End attributes of its Markdown nodes, in
   * `markdownTopology` order, which an edit inside a node's text moves.
   */
  readonly markdownPositions: readonly number[]
  readonly mappedKinds: readonly string[]
  /** Present on a leaf holding whole items of one split top-level list. */
  readonly listRun?: ListRun
  /** Present on a leaf holding lines of one split literal block. */
  readonly literalRun?: LiteralRun
  /** The long literal blocks the leaf's suggestions hold in their text (see `ArmLiteral`). */
  readonly armLiterals?: readonly ArmLiteral[]
}

/**
 * A literal block that is the whole text of a suggestion's arm, which a
 * key in its lines reads in a window of those lines alone (see
 * `admitArmLiteralLines`): its text is canonical and holds no marker, and
 * one Markup text event holds it. Offsets are local to the leaf.
 */
interface ArmLiteral {
  readonly key: string
  readonly opener: string
  readonly closer: string
  /** The block's source range, and its projection start. */
  readonly start: number
  readonly end: number
  readonly syntaxStart: number
  /** The Markup text event holding the block: its ordinal in the leaf and its source range. */
  readonly event: number
  readonly eventStart: number
  readonly eventEnd: number
  /** The arm's annotation, as its preorder ordinal in the leaf's capsule, and the arm. */
  readonly node: number
  readonly arm: CapsuleArm['name']
  /**
   * The projection start of the block holding the lines, and its lines and
   * children before them: an indented code block reads the lines of every
   * arm beside it as its own.
   */
  readonly block: number
  readonly before: Readonly<{ lines: number, children: number }>
  /** The lines' Markdown children, which must stay many enough to split. */
  readonly children: number
  /** The block's closer line also holds the marker after the arm, as `$$~>` does. */
  readonly marked?: true
}

/**
 * Lines of a split literal block held by one leaf. Every line leaf of the
 * block carries the block's key, opener and closer, which change only with
 * a replacement of the whole block.
 */
interface LiteralRun {
  readonly key: string
  readonly opener: string
  readonly closer: string
  /** Whether the leaf holds the block's first line, and with it its start. */
  readonly first: boolean
  /** Whether the leaf holds the block's last line, and with it its end. */
  readonly last: boolean
  /** How many of the block's lines, and of its children, the leaf holds. */
  readonly lines: number
  readonly children: number
}

/**
 * Items of a split list held by one leaf. The list's own reading, which
 * every item leaf of it carries, changes only with a replacement of the
 * whole list, so no leaf of it keeps a stale key.
 */
interface ListRun {
  /** How the whole list reads (see `listKeyOf`). */
  readonly key: string
  /** Whether the leaf holds the list's first item. */
  readonly first: boolean
  /** Whether the leaf holds the list's last item. */
  readonly last: boolean
  /** How many items the leaf holds. */
  readonly items: number
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
  readonly definitions?: readonly Readonly<{ readonly start: number; readonly end: number; readonly footnote?: true }>[]
  /**
   * The normalized labels of those definitions, read from source once and
   * shared by every inventory derived from this one, as regional edits
   * leave the definitions as they are. Undefined labels are unknown, as
   * for a footnote definition.
   */
  readonly definitionLabels: { read: boolean, labels?: ReadonlySet<string> }
  readonly recorder: RegionalInventoryRecorder
  readonly plainRecorder?: PlainParagraphIndexRecorder
  /** Made of a document whose lists split into items (see `listSplitOf`). */
  readonly splitsLists?: boolean
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
    // The end of the text reads at the end of its projected text, also
    // after markers the projection omits there.
    if (found === undefined && boundary === boundaries.at(-1) && segmentIndex === segments.length) {
      found = 0
      for (const segment of segments) if (segment.kind === 'canonical') found = segment.projectedEnd
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

/** Blocks whose children are the literal lines of their text. */
const LITERAL_BLOCK_KINDS: ReadonlySet<string> = new Set(['code-block', 'math-block', 'html-block', 'diagram', 'front-matter'])

function markdownTopology(
  roots: readonly MarkdownNode[],
  rangeDelta: number,
  recorder?: RegionalInventoryRecorder,
  positions?: number[]
): readonly string[] {
  const result: string[] = []
  const pending = [...roots].reverse()
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) break
    recorder?.recordBuildUnit()
    // A node's own text, which a key typing into it changes, is not its shape.
    const attributes = Object.entries(node.attributes)
      .filter(([name]) => name !== 'semanticStart' && name !== 'semanticEnd' &&
        (positions === undefined || (name !== 'content' && name !== 'semanticText')))
      .map(([name, value]) => {
        const position = typeof value === 'number' && (name.endsWith('Start') || name.endsWith('End'))
        if (position && positions !== undefined) {
          positions.push(value - rangeDelta)
          return `${name}=#`
        }
        return `${name}=${String(position ? value - rangeDelta : value)}`
      }).join('\u0001')
    // A literal block's children are the lines of its text, which a key
    // typing into it may add or remove.
    const literal = positions !== undefined && LITERAL_BLOCK_KINDS.has(node.kind)
    result.push(`${node.kind}:${literal ? 'literal' : node.childCount}:${attributes}`)
    if (literal) continue
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
): readonly Readonly<{ value: string, start: number, end: number }>[] {
  return Object.freeze(products.editing().mappedTape.flatMap(segment => {
    if (
      segment.projectedEnd <= syntaxStart ||
      segment.projectedStart >= syntaxEnd
    ) {
      return []
    }
    return [{
      value: segment.kind === 'canonical' ? 'canonical' : `generated:${segment.affinity}`,
      start: segment.projectedStart,
      end: segment.projectedEnd
    }]
  }))
}

type LiteralContent = Readonly<{ start: number, end: number }>

const literalContentsByProducts = new WeakMap<Profile1DocumentProducts, Readonly<{
  source: readonly LiteralContent[]
  syntax: readonly LiteralContent[]
}>>()

/**
 * The text of each top-level literal block of a parse, in source and in the
 * projection: the lines a key typing into the block may add or remove.
 */
function literalContents(products: Profile1DocumentProducts): Readonly<{
  source: readonly LiteralContent[]
  syntax: readonly LiteralContent[]
}> {
  let contents = literalContentsByProducts.get(products)
  if (contents !== undefined) return contents
  const editing = products.editing()
  const root = editing.markdown.root
  const source: LiteralContent[] = []
  const syntax: LiteralContent[] = []
  for (let ordinal = 0; ordinal < root.childCount; ordinal += 1) {
    const block = root.childAt(ordinal)
    if (!LITERAL_BLOCK_KINDS.has(block.kind) || block.childCount === 0) continue
    const start = block.childAt(0).range.start
    const end = block.childAt(block.childCount - 1).range.end
    syntax.push({ start, end })
    const sourceStart = canonicalSourceAt(editing.mappedTape, start)
    const sourceEnd = canonicalSourceAt(editing.mappedTape, end)
    if (sourceStart !== undefined && sourceEnd !== undefined) source.push({ start: sourceStart, end: sourceEnd })
  }
  contents = Object.freeze({ source: Object.freeze(source), syntax: Object.freeze(syntax) })
  literalContentsByProducts.set(products, contents)
  return contents
}

/**
 * The values of runs in order, with the runs inside one literal block's text
 * read as one `literal` run: its lines split them however many there are.
 */
const orderedLiterals = new WeakMap<readonly LiteralContent[], boolean>()

/**
 * The first of `literals` holding `[start, end)`. Literal blocks follow one
 * another, so their starts and ends both ascend: the first whose end reaches
 * `end` is the only one that can hold it.
 */
export function literalHolding(literals: readonly LiteralContent[], start: number, end: number): LiteralContent | undefined {
  let ordered = orderedLiterals.get(literals)
  if (ordered === undefined) {
    let previous: LiteralContent | undefined
    ordered = literals.every(content => {
      const follows = previous === undefined || (previous.start <= content.start && previous.end <= content.end)
      previous = content
      return follows
    })
    orderedLiterals.set(literals, ordered)
  }
  if (!ordered) return literals.find(content => content.start <= start && end <= content.end)
  let low = 0
  let high = literals.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((literals[middle]?.end ?? end) < end) low = middle + 1
    else high = middle
  }
  for (let index = low; index < literals.length; index += 1) {
    const content = literals[index]
    if (content === undefined || content.start > start) break
    if (end <= content.end) return content
  }
  return undefined
}

function literalRuns(
  runs: readonly Readonly<{ value: string, start: number, end: number }>[],
  literals: readonly LiteralContent[]
): readonly string[] {
  const values: string[] = []
  let inside: LiteralContent | undefined
  for (const run of runs) {
    // Only text and line breaks fold: generated text and markers stay seen.
    const plain = run.value === 'canonical' || run.value === 'text' || run.value.startsWith('eol')
    const literal = plain ? literalHolding(literals, run.start, run.end) : undefined
    if (literal !== undefined) {
      if (literal !== inside) values.push('literal')
    } else values.push(run.value)
    inside = literal
  }
  return Object.freeze(values)
}

function createLeaf(
  products: Profile1DocumentProducts,
  sourceStart: number,
  sourceEnd: number,
  syntaxStart: number,
  syntaxEnd: number,
  eventCount: number,
  split: ListSplit = NO_LIST_SPLIT,
  listKey?: string
): MeasuredRegionLeaf {
  const retained = products.retainedIntrinsic
  const roots = (retained?.roots ?? []).filter(root =>
    sourceStart <= root.range.start && root.range.end <= sourceEnd
  )
  // A line begins in one leaf: an empty line's empty text sits at its start.
  const blocks = leafBlocksOf(products, split).filter(block => block.literal === undefined
    ? syntaxStart <= block.node.range.start && block.node.range.end <= syntaxEnd
    : syntaxStart <= block.node.range.start && block.node.range.start < syntaxEnd)
  const run = listRunOf(blocks)
  const literalRun = literalRunOf(blocks, split)
  return createLeafFromParts(
    products,
    sourceStart,
    sourceEnd,
    syntaxStart,
    syntaxEnd,
    eventCount,
    roots,
    blocks.map(block => block.node),
    Object.freeze((retained?.markerDecisions ?? []).filter(decision =>
      sourceStart <= decision.range.start && decision.range.end <= sourceEnd
    )),
    literalRuns((retained?.tape ?? []).flatMap(run =>
      sourceStart <= run.range.start && run.range.end <= sourceEnd
        ? [{ value: run.role, start: run.range.start, end: run.range.end }]
        : []
    ), literalContents(products).source),
    literalRuns(mappedKinds(products, syntaxStart, syntaxEnd), literalContents(products).syntax),
    diagnosticsWithin(products, sourceStart, sourceEnd),
    undefined,
    run === undefined ? undefined : listKey === undefined ? run : Object.freeze({ ...run, key: listKey }),
    literalRun
  )
}

/**
 * The fewest content lines an arm's literal block holds for a key there to
 * read its lines alone, and the Markdown children they make (a text and a
 * break a line, the last without a break).
 */
const ARM_LITERAL_LINES = 3
const ARM_LITERAL_CHILDREN = 2 * ARM_LITERAL_LINES - 1

/** Each Markup event's source range, or its annotation's start for a mark, per products. */
const eventStartsByProducts = new WeakMap<Profile1DocumentProducts, readonly Readonly<{ start: number, end: number, text: boolean }>[]>()

function eventSpans(products: Profile1DocumentProducts): readonly Readonly<{ start: number, end: number, text: boolean }>[] {
  let spans = eventStartsByProducts.get(products)
  if (spans === undefined) {
    const ranges = new Map<NodeId, SourceRange>()
    const pending = [...(products.retainedIntrinsic?.roots ?? [])]
    while (pending.length > 0) {
      const node = pending.pop()
      if (node === undefined) break
      ranges.set(node.nodeId, node.range)
      for (const arm of node.arms) pending.push(...arm.children)
    }
    const found: Array<Readonly<{ start: number, end: number, text: boolean }>> = []
    for (let ordinal = 0; ordinal < products.markup.eventCount; ordinal += 1) {
      const event = products.markup.eventAt(ordinal)
      if (event.kind === 'text') {
        found.push(Object.freeze({ start: event.sourceRange.start, end: event.sourceRange.end, text: true }))
      } else {
        const range = ranges.get(event.mark.nodeId)
        const at = range === undefined ? -1 : event.kind === 'enter' ? range.start : range.end
        found.push(Object.freeze({ start: at, end: at, text: false }))
      }
    }
    spans = Object.freeze(found)
    eventStartsByProducts.set(products, spans)
  }
  return spans
}

/** The ordinals of each products' Markup text events, in order. */
const textEventIndexesByProducts = new WeakMap<Profile1DocumentProducts, readonly number[]>()

function textEventIndexes(products: Profile1DocumentProducts): readonly number[] {
  let indexes = textEventIndexesByProducts.get(products)
  if (indexes === undefined) {
    indexes = Object.freeze(eventSpans(products).flatMap((span, index) => span.text ? [index] : []))
    textEventIndexesByProducts.set(products, indexes)
  }
  return indexes
}

/**
 * The long literal blocks that are the whole text of an arm of the leaf's
 * suggestions, other than a Comment's, whose text the projection reads as
 * the block's own (see `ArmLiteral`).
 */
function armLiteralsOf(
  products: Profile1DocumentProducts,
  sourceStart: number,
  syntaxStart: number,
  syntaxEnd: number,
  roots: readonly CriticMarkupNode[],
  leaf: MeasuredRegionLeaf
): ArmLiteral[] {
  const editing = products.editing()
  const tape = editing.mappedTape
  const markers = products.retainedIntrinsic?.markerDecisions ?? []
  const nodes: CriticMarkupNode[] = []
  const pending = [...roots].reverse()
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) continue
    nodes.push(node)
    for (let arm = node.arms.length - 1; arm >= 0; arm -= 1) {
      const children = node.arms[arm]?.children ?? []
      for (let child = children.length - 1; child >= 0; child -= 1) {
        const value = children[child]
        if (value !== undefined) pending.push(value)
      }
    }
  }
  const spans = eventSpans(products)
  const found: ArmLiteral[] = []
  const root = editing.markdown.root
  const texts = textEventIndexes(products)
  // The first text event ending after source offset `at`.
  const textEventAfter = (at: number): number => {
    let low = 0
    let high = texts.length
    while (low < high) {
      const middle = (low + high) >> 1
      if ((spans[texts[middle] ?? 0]?.end ?? Infinity) <= at) low = middle + 1
      else high = middle
    }
    return low
  }
  // Canonical source and projection offsets, each found in the canonical
  // segment holding it: a block opening an arm starts after the arm's
  // elided opener, which a generated segment holds.
  const projectedAt = (at: number): number | undefined => {
    for (const segment of tape) {
      if (segment.kind === 'canonical' && segment.sourceStart <= at &&
          at < segment.sourceStart + segment.projectedEnd - segment.projectedStart) {
        return segment.projectedStart + at - segment.sourceStart
      }
    }
    return undefined
  }
  const sourceAt = (projected: number): number | undefined => {
    for (const segment of tape) {
      if (segment.kind === 'canonical' && segment.projectedStart <= projected && projected < segment.projectedEnd) {
        return segment.sourceStart + projected - segment.projectedStart
      }
    }
    return undefined
  }
  const add = (
    block: MarkdownNode,
    reading: Readonly<{ key: string, opener: string, closer: string }>,
    start: number,
    end: number,
    projected: number,
    before: Readonly<{ lines: number, children: number }>,
    children: number
  ): void => {
    const owner = nodes.findIndex(node => node.kind !== 'comment' && node.arms.some(arm =>
      arm.range.start <= start && end <= arm.range.end && arm.children.length === 0))
    const node = nodes[owner]
    const arm = node?.arms.find(candidate => candidate.range.start <= start && end <= candidate.range.end)
    // A suggestion nested in another, as in a Deletion's text, takes a
    // tracked key as its holder's text does, which the document decides.
    if (node === undefined || arm === undefined || !roots.includes(node) ||
        nodes.some(other => other.range.start < end && start < other.range.end && other.range.start >= start) ||
        markers.some(marker => marker.range.start < end && start < marker.range.end) ||
        // A marker's spelling read as text there may pair once a line
        // break or blank line changes where the block's lines end.
        // The text is canonical, so its projection spells it.
        markerSpellings(editing.source.slice(projected, projected + end - start)) !== 0) return
    // The text event holding the lines, counted as the leaf counts its events.
    const index = texts[textEventAfter(start)]
    const event = index === undefined ? undefined : spans[index]
    // The event holds the lines alone, with at most their line break after them.
    if (index === undefined || event === undefined || event.start !== start || event.end < end || event.end > end + 1 ||
        arm.range.start !== event.start || arm.range.end !== event.end) return
    // A marker on the block's closer line, as `$$~>`, reads with that line.
    const marked = editing.source.charAt(projectedAt(event.end - 1) ?? -1) !== '\n'
    let local = 0
    for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
      const span = spans[earlier]
      if (span === undefined || (span.text ? span.end <= sourceStart : span.start < sourceStart)) break
      local += 1
    }
    if (local >= leaf.eventCount) return
    found.push(Object.freeze({
      key: reading.key,
      opener: reading.opener,
      closer: reading.closer,
      start: start - sourceStart,
      end: end - sourceStart,
      syntaxStart: projected - syntaxStart,
      event: local,
      eventStart: event.start - sourceStart,
      eventEnd: event.end - sourceStart,
      node: leafNodeOrdinal(leaf.annotations, node.range.start - sourceStart, node.range.end - sourceStart, node.kind),
      arm: arm.name,
      block: block.range.start - syntaxStart,
      before,
      children,
      ...(marked ? { marked: true as const } : {})
    }))
  }
  for (let ordinal = 0; ordinal < root.childCount; ordinal += 1) {
    const block = root.childAt(ordinal)
    if (!LITERAL_SPLIT_KINDS.has(block.kind) || block.childCount < ARM_LITERAL_CHILDREN ||
        block.range.start < syntaxStart || block.range.end > syntaxEnd) continue
    const reading = literalBlockReading(editing, block)
    if (reading === undefined) continue
    if (block.kind === 'code-block' && reading.opener === '') {
      // An indented code block reads every arm's lines as its own, so each
      // arm whose text is whole lines of it is one.
      const blockSource = sourceAt(block.range.start)
      if (blockSource === undefined) continue
      let child = 0
      let lines = 0
      for (let text = textEventAfter(blockSource); text < texts.length; text += 1) {
        const event = spans[texts[text] ?? -1]
        const projected = event === undefined ? undefined : projectedAt(event.start)
        if (event === undefined || projected === undefined || projected >= block.range.end) break
        // The arm's text, with the line break ending it, lies in the block
        // and reads canonically.
        const length = event.end - event.start
        if (length === 0 || projected < block.range.start || projected + length > block.range.end ||
            projectedAt(event.end - 1) !== projected + length - 1) continue
        const end = editing.source.charAt(projected + length - 1) === '\n' ? event.end - 1 : event.end
        const text_ = editing.source.slice(projected, projected + end - event.start)
        if (/\r/u.test(text_) || (projected !== block.range.start && editing.source.charAt(projected - 1) !== '\n') ||
            (end === event.end && projected + length !== block.range.end)) continue
        // The block's children and lines before the arm's first line.
        while (child < block.childCount && block.childAt(child).range.start < projected) {
          if (block.childAt(child).kind === 'soft-break') lines += 1
          child += 1
        }
        const armLines = text_.split('\n').length
        if (armLines < ARM_LITERAL_LINES) continue
        add(block, { ...reading, closer: '' }, event.start, end, projected, Object.freeze({ lines, children: child }), 2 * armLines - 1)
      }
      continue
    }
    // One canonical segment holds the whole block.
    const start = sourceAt(block.range.start)
    const end = start === undefined ? undefined : start + block.range.end - block.range.start
    if (start === undefined || end === undefined || sourceAt(block.range.end - 1) !== end - 1 ||
        projectedAt(start) !== block.range.start || projectedAt(end - 1) !== block.range.end - 1) continue
    add(block, reading, start, end, block.range.start, Object.freeze({ lines: 0, children: 0 }), block.childCount)
  }
  return found
}

/** The preorder ordinal of the capsule node spanning `[start, end)` of kind `kind`. */
function leafNodeOrdinal(capsule: AnnotationCapsule, start: number, end: number, kind: CriticMarkupNode['kind']): number {
  return capsule.nodes.findIndex(node => node.start === start && node.end === end && node.kind === kind)
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
  recorder?: RegionalInventoryRecorder,
  listRun?: ListRun,
  literalRun?: LiteralRun
): MeasuredRegionLeaf {
  const positions: number[] = []
  const topology = markdownTopology(markdownRoots, syntaxStart, recorder, positions)
  const leaf: MeasuredRegionLeaf = Object.freeze({
    kind: 'region',
    sourceLength: sourceEnd - sourceStart,
    syntaxLength: syntaxEnd - syntaxStart,
    eventCount,
    annotations: annotationCapsule(roots, sourceStart, products, recorder),
    markers: markerCapsules(markerDecisions, sourceStart, recorder),
    diagnostics: diagnosticCapsules(diagnostics, sourceStart),
    unterminatedForms: unterminatedFormsOf(diagnostics, products),
    tapeRoles,
    markdownTopology: listRun !== undefined
      ? Object.freeze([`list-run:${listRun.key}`, ...topology])
      : literalRun !== undefined
        ? Object.freeze([`literal-run:${literalRun.key}`, ...topology])
        : topology,
    markdownPositions: Object.freeze(positions),
    mappedKinds: projectionKinds,
    ...(listRun === undefined ? {} : { listRun }),
    ...(literalRun === undefined ? {} : { literalRun })
  })
  const armLiterals = roots.length === 0 ? [] : armLiteralsOf(products, sourceStart, syntaxStart, syntaxEnd, roots, leaf)
  return armLiterals.length === 0 ? leaf : Object.freeze({ ...leaf, armLiterals: Object.freeze(armLiterals) })
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

/**
 * The annotation roots outside leaves `from` to `to`: a window of those
 * leaves reads its markers as a document holding annotations does when
 * any remain outside it, and otherwise by its own.
 */
function rootsOutside(inventory: InventoryValue, from: number, to: number): number {
  let inside = 0
  for (const { leaf } of leafRange(inventory.root, from, to)) inside += rootCountIn(leaf)
  return rootCountIn(inventory.root) - inside
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
): readonly Readonly<{ start: number, end: number, footnote?: true }>[] | undefined {
  let found: Readonly<{ start: number, end: number, footnote?: true }>[] | undefined
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
    const ranges: Readonly<{ start: number, end: number, footnote?: true }>[] = []
    const pending: MarkdownNode[] = [view.markdown.root]
    while (pending.length > 0) {
      const node = pending.pop()
      if (node === undefined) break
      if (node.kind === 'definition' || node.kind === 'footnote-definition') {
        const start = sourceAt(node.range.start, 'start')
        const end = sourceAt(node.range.end, 'end')
        if (start === undefined || end === undefined || end < start) return undefined
        ranges.push(Object.freeze({ start, end, ...(node.kind === 'footnote-definition' ? { footnote: true as const } : {}) }))
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
      // A footnote's label names no link; a reference's may begin with `^`.
      const label = definition.footnote === true
        ? undefined
        : markdownReferenceDefinitionLabel(text, 0, text.length, false)
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
          ...definition, start: shift(definition.start), end: shift(definition.end)
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
    retained.sourceLength !== sourceLength
  ) {
    return undefined
  }
  const split = listSplitOf(products, sourceLength)
  // A list that splits into items is edited an item at a time only here.
  if (retained.rootCount < minimumRoots && split.lists.size === 0 && split.literals.size === 0) return undefined
  const boundaries = Object.freeze([
    0,
    ...leafPointsOf(products, sourceLength),
    sourceLength
  ].filter((value, ordinal, values) =>
    value >= 0 && value <= sourceLength &&
    (ordinal === 0 || value !== values[ordinal - 1])
  ))
  if (boundaries.length < 2) return undefined
  // The document's start is its projection's start even when an elided
  // CriticMarkup opener begins it.
  const laterSyntax = exactSyntaxBoundaries(products, boundaries.slice(1), recorder)
  if (laterSyntax === undefined) return undefined
  const syntaxBoundaries = Object.freeze([0, ...laterSyntax])
  const counts = eventCounts(products, boundaries, recorder)
  const leaves: RegionLeaf[] = []
  let rootCursor = 0
  let markdownCursor = 0
  let markerCursor = 0
  let tapeCursor = 0
  let mappedCursor = 0
  let diagnosticCursor = 0
  const leafBlocks = leafBlocksOf(products, split)
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
    const blocksHere: LeafBlock[] = []
    while (markdownCursor < leafBlocks.length) {
      const block = leafBlocks[markdownCursor]
      if (block === undefined) break
      const child = block.node
      if (child.range.start >= syntaxEnd && !(sourceEnd === sourceLength &&
        child.range.start === syntaxEnd && child.range.end === syntaxEnd)) break
      recorder.recordBuildUnit()
      if (!(syntaxStart <= child.range.start && child.range.end <= syntaxEnd)) {
        return undefined
      }
      markdownRoots.push(child)
      blocksHere.push(block)
      markdownCursor += 1
    }
    const listRun = listRunOf(blocksHere)
    const literalRun = literalRunOf(blocksHere, split)
    // A leaf holds either whole items of one split list or top-level blocks.
    if (listRun === undefined && blocksHere.some(block => block.list !== undefined)) return undefined
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
    const tapeRoles: Array<Readonly<{ value: string, start: number, end: number }>> = []
    while (tapeCursor < retained.tape.length) {
      const run = retained.tape[tapeCursor]
      if (run === undefined || run.range.start >= sourceEnd) break
      recorder.recordBuildUnit()
      if (!(sourceStart <= run.range.start && run.range.end <= sourceEnd)) {
        return undefined
      }
      tapeRoles.push({ value: run.role, start: run.range.start, end: run.range.end })
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
    const projectionRuns: Array<Readonly<{ value: string, start: number, end: number }>> = []
    while (mappedCursor < mappedTape.length) {
      const segment = mappedTape[mappedCursor]
      if (segment === undefined || segment.projectedStart >= syntaxEnd) break
      recorder.recordBuildUnit()
      if (segment.projectedEnd > syntaxStart) {
        const value = segment.kind === 'canonical' ? 'canonical' : `generated:${segment.affinity}`
        projectionKinds.push(value)
        projectionRuns.push({ value, start: segment.projectedStart, end: segment.projectedEnd })
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
    const ordinaryParagraph = listRun === undefined && literalRun === undefined && roots.length === 0 &&
      sourceStart < annotationExtent &&
      markdownRoots.length === 1 && markdownRoots[0]?.kind === 'paragraph' &&
      markerDecisions.length === 0 &&
      projectionKinds.every(kind => kind === 'canonical')
    const plainRegion = listRun === undefined && literalRun === undefined &&
      roots.length === 0 && markerDecisions.length === 0 && diagnostics.length === 0 &&
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
      (literalRun !== undefined || crossed[ordinal] !== true && crossed[ordinal + 1] !== true)
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
        literalRuns(tapeRoles, literalContents(products).source),
        literalRuns(projectionRuns, literalContents(products).syntax),
        diagnostics,
        recorder,
        listRun,
        literalRun
      ))
    }
  }
  finishPlainGap()
  if (
    rootCursor !== retained.roots.length ||
    markdownCursor !== leafBlocks.length ||
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
    ...(plainRecorder === undefined ? {} : { plainRecorder }),
    ...(split.lists.size === 0 ? {} : { splitsLists: true })
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

/**
 * A top-level list reads from the first line of any of its items as it does
 * from its own start: that line begins a sibling of the item before, which
 * the list's open container alone decides. So a list of two or more items
 * may split into leaves of whole items, and an edit inside one item reparses
 * only that item with an item of context on each side. A list splits only
 * where its own bounds are block boundaries of the parse and each item's
 * first line starts at a canonical source offset that no annotation, marker
 * or diagnostic spans.
 */
interface ListSplit {
  /** The source offsets where split lists' items after their first begin, and literal blocks' lines after their first. */
  readonly points: readonly number[]
  /** Each split list with its items' first-line starts in the projection. */
  readonly lists: ReadonlyMap<MarkdownNode, readonly number[]>
  /** Each literal block split into its lines (see `literalSplitOf`). */
  readonly literals: ReadonlyMap<MarkdownNode, LiteralSplit>
}

/**
 * A literal block whose lines are leaves of their own: a code, math or HTML
 * block, whose lines read literally, so a key in one line reparses that
 * line in a window standing for the whole block (see `admitLiteralLines`).
 */
interface LiteralSplit {
  /** How the block reads as a whole: its kind, attributes and delimiters. */
  readonly key: string
  /** The block's text before its first line: a fence's or math block's opener line. */
  readonly opener: string
  /**
   * The block's text after its last line, from that line's break: a fence's
   * closer line; for an HTML block, its last line, which ends it.
   */
  readonly closer: string
  /** The first child of each line, in order. */
  readonly lines: readonly MarkdownNode[]
  /** The ordinal among the block's children of each line's first child. */
  readonly lineChildren: readonly number[]
  readonly childCount: number
}

const NO_LIST_SPLIT: ListSplit = Object.freeze({ points: Object.freeze([]), lists: new Map(), literals: new Map() })

/** The source offset of projection offset `offset`, when canonical text holds it. */
function canonicalSourceAt(
  segments: readonly MappedProjectionSegment[],
  offset: number
): number | undefined {
  let low = 0
  let high = segments.length
  while (low < high) {
    const middle = low + ((high - low) >> 1)
    if ((segments[middle]?.projectedEnd ?? Infinity) < offset) low = middle + 1
    else high = middle
  }
  for (let index = low; index < segments.length; index += 1) {
    const segment = segments[index]
    if (segment === undefined || segment.projectedStart > offset) return undefined
    if (segment.kind === 'canonical' && segment.projectedEnd >= offset) {
      return segment.sourceStart + offset - segment.projectedStart
    }
  }
  return undefined
}

/** The start of the line holding projection offset `offset`, when only indentation precedes it there. */
function markerLineStart(text: string, offset: number): number | undefined {
  let start = offset
  while (start > 0) {
    const code = text.charCodeAt(start - 1)
    if (code === 10 || code === 13) break
    if (code !== 32 && code !== 9) return undefined
    start -= 1
  }
  return start
}

/**
 * `split` says whether the document splits its lists: one without stray
 * markers does. An unfinished opener's reading reaches past a list's
 * boundaries, which then read only from a parse's own safe points; a window
 * of such a document reads its lists as the document does, whatever
 * markers the window itself holds.
 */
/**
 * Whether one empty line separates the line starting at `line` from the
 * text before it, or `line` starts the text. A line of spaces there is text
 * the next block's first line shows, and a longer run of empty lines reads
 * as empty paragraphs whose places depend on the whole run.
 */
function afterEmptyLine(text: string, line: number): boolean {
  if (line === 0) return true
  const lineBefore = (end: number): Readonly<{ start: number, end: number }> | undefined => {
    // `end` is the start of a line; the line before it ends at its break.
    if (end === 0) return undefined
    let stop = end - 1
    if (text.charCodeAt(stop) === 10 && stop > 0 && text.charCodeAt(stop - 1) === 13) stop -= 1
    let start = stop
    while (start > 0 && text.charCodeAt(start - 1) !== 10 && text.charCodeAt(start - 1) !== 13) start -= 1
    return { start, end: stop }
  }
  const empty = lineBefore(line)
  if (empty === undefined || empty.start !== empty.end) return false
  const previous = lineBefore(empty.start)
  return previous !== undefined && /\S/u.test(text.slice(previous.start, previous.end))
}

function listSplitOf(
  products: Profile1DocumentProducts,
  sourceLength: number,
  split = products.diagnostics.count === 0,
  endOpen = windowsBeforeDocumentEnd.has(products)
): ListSplit {
  const retained = products.retainedIntrinsic
  if (retained === undefined || !split) return NO_LIST_SPLIT
  const editing = products.editing()
  const root = editing.markdown.root
  // A window's first line follows the empty lines before it in the document.
  const startClean = !windowsNotAfterOneEmptyLine.has(products)
  const oneEmptyLine = (line: number): boolean => line === 0 ? startClean : afterEmptyLine(editing.source, line)
  // A window ending where the document's next block starts parts its last
  // block from that block by its own trailing empty lines.
  const endsAtBlock = windowsEndingAtBlockStart.has(products)
  const segments = editing.mappedTape
  // The spans no boundary may cut, merged in order for lookup.
  const spans: Array<{ start: number, end: number }> = []
  for (const span of [
    ...retained.roots.map(node => node.range),
    ...retained.diagnostics.map(diagnostic => diagnostic.range),
    ...retained.markerDecisions.map(decision => decision.range)
  ].sort((left, right) => left.start - right.start)) {
    const last = spans[spans.length - 1]
    if (last !== undefined && span.start < last.end) last.end = Math.max(last.end, span.end)
    else spans.push({ start: span.start, end: span.end })
  }
  const spanned = (point: number): boolean => {
    let low = 0
    let high = spans.length
    while (low < high) {
      const middle = low + ((high - low) >> 1)
      if ((spans[middle]?.end ?? 0) <= point) low = middle + 1
      else high = middle
    }
    const span = spans[low]
    return span !== undefined && span.start < point && point < span.end
  }
  // A boundary is a line start at a canonical source offset no annotation,
  // marker or diagnostic spans.
  const boundaryAt = (offset: number): Readonly<{ line: number, source: number }> | undefined => {
    const line = markerLineStart(editing.source, offset)
    const source = line === undefined ? undefined : canonicalSourceAt(segments, line)
    return line === undefined || source === undefined || spanned(source) ? undefined : Object.freeze({ line, source })
  }
  const points: number[] = []
  const lists = new Map<MarkdownNode, readonly number[]>()
  for (let ordinal = 0; ordinal < root.childCount; ordinal += 1) {
    const list = root.childAt(ordinal)
    if (list.kind !== 'list' || list.childCount === 0) continue
    // After an empty line, the list's first line begins it in the document's
    // own container and the next block's first line closes it, so both are
    // block boundaries as well as the items' first lines; the lines before a
    // block are the text its first line follows.
    const listStart = boundaryAt(list.range.start)
    const next = ordinal + 1 < root.childCount ? root.childAt(ordinal + 1) : undefined
    const nextStart = next === undefined ? undefined : boundaryAt(next.range.start)
    if (listStart === undefined || !afterEmptyLine(editing.source, listStart.line) ||
        (next !== undefined && (nextStart === undefined || next.range.start === next.range.end ||
          !afterEmptyLine(editing.source, nextStart.line))) ||
        next === undefined && endsAtBlock && !afterEmptyLine(editing.source, editing.source.length)) continue
    const lineStarts: number[] = [listStart.line]
    const listPoints: number[] = [listStart.source]
    // An item whose first line an annotation spans shares a leaf with the
    // item before it.
    for (let item = 1; item < list.childCount; item += 1) {
      const boundary = boundaryAt(list.childAt(item).range.start)
      if (boundary === undefined || boundary.source <= (listPoints[listPoints.length - 1] ?? 0)) continue
      lineStarts.push(boundary.line)
      listPoints.push(boundary.source)
    }
    if (nextStart !== undefined) {
      if (nextStart.source <= (listPoints[listPoints.length - 1] ?? 0)) continue
      listPoints.push(nextStart.source)
    }
    lists.set(list, Object.freeze(lineStarts))
    points.push(...listPoints.filter(point => point > 0 && point < sourceLength))
  }
  const literals = new Map<MarkdownNode, LiteralSplit>()
  const candidates = literalSplitOf(editing, spanned)
  for (let ordinal = 0; ordinal < root.childCount && candidates.size > 0; ordinal += 1) {
    const block = root.childAt(ordinal)
    const literal = candidates.get(block)
    if (literal === undefined) continue
    // As a list's, the block's own start and the next block's start bound
    // its leaves after one empty line, so no leaf holds its lines and
    // another block.
    const blockStart = boundaryAt(block.range.start)
    const next = ordinal + 1 < root.childCount ? root.childAt(ordinal + 1) : undefined
    // A window's last block may yet be followed by more than one empty line.
    if (next === undefined && endOpen && !endsAtBlock) continue
    const nextStart = next === undefined ? undefined : boundaryAt(next.range.start)
    if (blockStart === undefined || !oneEmptyLine(blockStart.line) ||
        next === undefined && endsAtBlock && !oneEmptyLine(editing.source.length) ||
        (next !== undefined && (nextStart === undefined || next.range.start === next.range.end ||
          !oneEmptyLine(nextStart.line)))) continue
    literals.set(block, literal)
    if (blockStart.source > 0) points.push(blockStart.source)
    if (nextStart !== undefined && nextStart.source < sourceLength) points.push(nextStart.source)
    for (const line of literal.lines.slice(1)) {
      const start = markerLineStart(editing.source, line.range.start)
      const source = start === undefined ? undefined : canonicalSourceAt(segments, start)
      if (source !== undefined && source > 0 && source < sourceLength) points.push(source)
    }
  }
  return lists.size === 0 && literals.size === 0
    ? NO_LIST_SPLIT
    : Object.freeze({ points: Object.freeze([...new Set(points)].sort((left, right) => left - right)), lists, literals })
}

/** Blocks whose lines split into leaves: their text reads literally, line by line. */
const LITERAL_SPLIT_KINDS: ReadonlySet<string> = new Set(['code-block', 'math-block', 'html-block', 'diagram'])

/**
 * How literal block `block` reads as a whole, whatever its lines: its key,
 * and the text before its first line and after its last (see LiteralSplit).
 */
function literalBlockReading(
  editing: ReturnType<Profile1DocumentProducts['editing']>,
  block: MarkdownNode
): Readonly<{ key: string, opener: string, closer: string }> | undefined {
  if (!LITERAL_SPLIT_KINDS.has(block.kind) || block.childCount === 0) return undefined
  const firstLine = markerLineStart(editing.source, block.childAt(0).range.start)
  const blockLine = markerLineStart(editing.source, block.range.start)
  const lastChild = block.childAt(block.childCount - 1)
  let lastLine = lastChild.range.start
  for (let child = block.childCount - 1; child >= 0 && block.childAt(child).kind !== 'soft-break'; child -= 1) {
    lastLine = block.childAt(child).range.start
  }
  const lastLineStart = markerLineStart(editing.source, lastLine)
  if (firstLine === undefined || blockLine === undefined || lastLineStart === undefined || blockLine > firstLine) return undefined
  // The attributes naming where its parts are, and its text, are not how it reads.
  const attributes = Object.entries(block.attributes)
    .filter(([name, value]) => name !== 'content' && !(typeof value === 'number' && /(?:Start|End)$/u.test(name)))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  // An HTML block's first line is text too, and what starts the block.
  let secondLine = firstLine
  for (let child = 0; child < block.childCount; child += 1) {
    if (block.childAt(child).kind === 'soft-break') {
      secondLine = block.childAt(child).range.end
      break
    }
  }
  const opener = editing.source.slice(blockLine, block.kind === 'html-block' ? secondLine : firstLine)
  const closer = block.kind === 'html-block'
    ? editing.source.slice(lastLineStart, block.range.end)
    : editing.source.slice(lastChild.range.end, block.range.end)
  return Object.freeze({
    // An HTML block's last line is text, which only its termination reads.
    key: `${block.kind}${JSON.stringify(attributes)}${JSON.stringify(opener)}${JSON.stringify(block.kind === 'html-block' ? '' : closer.trim())}`,
    opener,
    closer
  })
}

/**
 * The top-level literal blocks of a parse with two or more lines, each line
 * start after the first a point no annotation, marker or diagnostic spans.
 */
function literalSplitOf(
  editing: ReturnType<Profile1DocumentProducts['editing']>,
  spanned: (point: number) => boolean
): ReadonlyMap<MarkdownNode, LiteralSplit> {
  const literals = new Map<MarkdownNode, LiteralSplit>()
  const root = editing.markdown.root
  for (let ordinal = 0; ordinal < root.childCount; ordinal += 1) {
    const block = root.childAt(ordinal)
    if (!LITERAL_SPLIT_KINDS.has(block.kind) || block.childCount < 3) continue
    const lines: MarkdownNode[] = []
    const lineChildren: number[] = []
    let lineStart = true
    for (let child = 0; child < block.childCount; child += 1) {
      const node = block.childAt(child)
      if (lineStart) {
        lines.push(node)
        lineChildren.push(child)
      }
      lineStart = node.kind === 'soft-break'
    }
    if (lines.length < 2 || lineStart) continue
    // A block holding a suggestion, whose markers the projection elides or
    // generates text for, reads with the suggestion's other blocks.
    const sourceStart = canonicalSourceAt(editing.mappedTape, block.range.start)
    const sourceEnd = canonicalSourceAt(editing.mappedTape, block.range.end)
    if (sourceStart === undefined || sourceEnd === undefined ||
        sourceEnd - sourceStart !== block.range.end - block.range.start) continue
    const starts = lines.map(line => markerLineStart(editing.source, line.range.start))
    const reading = literalBlockReading(editing, block)
    if (reading === undefined || starts.some(start => start === undefined) ||
        starts.slice(1).some(start => {
          const source = canonicalSourceAt(editing.mappedTape, start ?? 0)
          return source === undefined || spanned(source)
        })) continue
    const { key, opener, closer } = reading
    literals.set(block, Object.freeze({
      key,
      opener,
      closer,
      lines: Object.freeze(lines),
      lineChildren: Object.freeze(lineChildren),
      childCount: block.childCount
    }))
  }
  return literals
}

/**
 * Block boundaries of a parse: its safe points and the boundaries of its
 * split lists. `split` is the document's own choice (see `listSplitOf`).
 */
export function regionalLeafPoints(
  products: Profile1DocumentProducts,
  sourceLength: number,
  split = products.diagnostics.count === 0
): readonly number[] {
  return leafPointsOf(products, sourceLength, split)
}

function leafPointsOf(
  products: Profile1DocumentProducts,
  sourceLength: number,
  splitLists = products.diagnostics.count === 0
): readonly number[] {
  const safePoints = products.retainedIntrinsic?.safePoints ?? []
  const split = listSplitOf(products, sourceLength, splitLists)
  if (split.points.length === 0) return safePoints
  return Object.freeze([...new Set([...safePoints, ...split.points])].sort((left, right) => left - right))
}

/** A block a leaf holds: a top-level block, one item of a split list, or one line of a split literal block. */
interface LeafBlock {
  readonly node: MarkdownNode
  readonly list?: MarkdownNode
  /** The item's ordinal in its list. */
  readonly item?: number
  /** The split literal block the line `node` begins. */
  readonly literal?: MarkdownNode
  /** The line's ordinal in its block. */
  readonly line?: number
}

function leafBlocksOf(products: Profile1DocumentProducts, split: ListSplit): readonly LeafBlock[] {
  const root = products.editing().markdown.root
  const blocks: LeafBlock[] = []
  for (let ordinal = 0; ordinal < root.childCount; ordinal += 1) {
    const child = root.childAt(ordinal)
    const literal = split.literals.get(child)
    if (literal !== undefined) {
      for (const [line, node] of literal.lines.entries()) blocks.push(Object.freeze({ node, literal: child, line }))
      continue
    }
    if (!split.lists.has(child)) {
      blocks.push(Object.freeze({ node: child }))
      continue
    }
    for (let item = 0; item < child.childCount; item += 1) {
      blocks.push(Object.freeze({ node: child.childAt(item), list: child, item }))
    }
  }
  return blocks
}

/**
 * How a list reads as a whole: whether ordered and with which delimiter,
 * whether tight, whether a task list, and where its numbering starts.
 */
function listKeyOf(list: MarkdownNode): string {
  const attributes = list.attributes
  return [
    String(attributes['ordered'] === true),
    String(attributes['delimiter'] ?? ''),
    String(attributes['tight'] !== false),
    String(attributes['taskList'] === true),
    String(attributes['start'] ?? '')
  ].join('|')
}

interface ListKeyFields {
  readonly ordered: boolean
  readonly delimiter: string
  readonly tight: boolean
  readonly taskList: boolean
  readonly start: string
}

function listKeyFields(key: string): ListKeyFields {
  const [ordered, delimiter, tight, taskList, start] = key.split('|')
  return Object.freeze({
    ordered: ordered === 'true',
    delimiter: delimiter ?? '',
    tight: tight === 'true',
    taskList: taskList === 'true',
    start: start ?? ''
  })
}

/** The list run of a leaf holding items of one split list, or undefined for any other leaf. */
function listRunOf(blocks: readonly LeafBlock[]): ListRun | undefined {
  const list = blocks[0]?.list
  if (list === undefined || blocks.some(block => block.list !== list)) return undefined
  return Object.freeze({
    key: listKeyOf(list),
    first: blocks.some(block => block.item === 0),
    last: blocks.some(block => block.item === list.childCount - 1),
    items: blocks.length
  })
}

/** The literal run of a leaf holding lines of one split literal block, or undefined for any other leaf. */
function literalRunOf(blocks: readonly LeafBlock[], split: ListSplit): LiteralRun | undefined {
  const literal = blocks.find(block => block.literal !== undefined)?.literal
  const info = literal === undefined ? undefined : split.literals.get(literal)
  if (literal === undefined || info === undefined) return undefined
  const lines = blocks.flatMap(block => block.literal === literal && block.line !== undefined ? [block.line] : [])
  const firstLine = lines[0] ?? 0
  const lastLine = lines.at(-1) ?? 0
  return Object.freeze({
    key: info.key,
    opener: info.opener,
    closer: info.closer,
    first: firstLine === 0,
    last: lastLine === info.lines.length - 1,
    lines: lines.length,
    children: (info.lineChildren[lastLine + 1] ?? info.childCount) - (info.lineChildren[firstLine] ?? 0)
  })
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

/**
 * Whether the inventory parts its blocks at source offset `source`: a leaf
 * starts there, or a plain gap holds a block start there.
 */
function inventoryPointAt(inventory: InventoryValue, source: number): boolean {
  const located = locateBySource(inventory, source)
  if (located === undefined || located.sourceStart === source) return located !== undefined || source === inventory.root.sourceLength
  const plain = located.leaf.kind === 'gap' ? located.leaf.plain : undefined
  if (plain === undefined) return false
  const local = source - located.sourceStart
  let low = 0
  let high = plain.safePointCount
  while (low < high) {
    const middle = (low + high) >> 1
    if (plain.coordinateAt(middle) < local) low = middle + 1
    else high = middle
  }
  return low < plain.safePointCount && plain.coordinateAt(low) === local
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

/** The projection offset of canonical source offset `offset` of a parse, when canonical text holds it. */
function projectedOffsetOf(products: Profile1DocumentProducts, offset: number): number | undefined {
  for (const segment of products.editing().mappedTape) {
    if (segment.kind === 'canonical' && segment.sourceStart <= offset && offset <= segment.sourceStart + segment.projectedEnd - segment.projectedStart) {
      return segment.projectedStart + offset - segment.sourceStart
    }
  }
  return undefined
}

/**
 * Whether two leaves read alike. `moved` is an edit's leaf-relative start in
 * the projection and how far it moved the projection after it: a Start or
 * End attribute after that point moves with it, as the end of a code block's
 * text does when a key types into it.
 */
function sameRegionShape(
  previous: MeasuredRegionLeaf,
  next: MeasuredRegionLeaf,
  moved?: Readonly<{ at: number, delta: number }>
): boolean {
  return sameTopology(previous.annotations, next.annotations) &&
    sameArray(previous.tapeRoles, next.tapeRoles) &&
    sameArray(previous.markdownTopology, next.markdownTopology) &&
    previous.markdownPositions.length === next.markdownPositions.length &&
    previous.markdownPositions.every((position, ordinal) => {
      const candidate = next.markdownPositions[ordinal]
      return candidate === position && (moved === undefined || position <= moved.at) ||
        moved !== undefined && position >= moved.at && candidate === position + moved.delta
    }) &&
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

/** Forms whose closer, or a Substitution's divider, `text` spells. */
function spelledCloserForms(text: string): number {
  let forms = 0
  for (const match of text.matchAll(MARKER_SPELLING)) {
    const spelling = match[1] ?? ''
    const form = spelling === '~>' ? 'substitution' : CLOSER_FORM[spelling]
    if (form !== undefined) forms |= FORM_BIT[form]
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
  const value = inventoryValue(inventory)
  // A suggestion arm's literal lines read alone, as an edit there reads them.
  const arm = admitArmLiteralLines(value, source, source, edit, executionBudget, markdownOptions, physicalRecorder, true)
  if (arm?.kind === 'validated') return arm
  const result = evaluateBlockWindow(
    value, source, source, edit, executionBudget, markdownOptions, physicalRecorder, true
  )
  return result?.kind === 'validated' ? result : undefined
}

/**
 * The blocks holding `range` with an unchanged block of context on each
 * side, parsed as the window an edit there would parse, for reading a
 * revision without its document parse. Nothing is replaced, so any block
 * kind reads there; the window's safe points and marker readings must still
 * match the document's for its blocks to read as they do in the whole
 * document. `armLines` admits the lines of a suggestion arm's literal block
 * read alone, whose blocks read as the document's but which hold none of
 * its suggestions.
 */
export function previewRegionalRange(
  inventory: RegionalInventory,
  source: CanonicalSourceView,
  range: Readonly<{ readonly start: number; readonly end: number }>,
  executionBudget: ExecutionBudgetId,
  markdownOptions: MarkdownOptionsV1,
  physicalRecorder: Profile1PhysicalTraversalRecorderV1,
  armLines = false
): Readonly<{
  sourceStart: number
  nextProducts: Profile1DocumentProducts
  nextWindow: string
  cleanStart?: true
  cleanEnd?: true
  wholeLeaf?: true
  literal?: RegionalInventoryPreview['literal']
}> | undefined {
  const window = regionalRangeWindow(inventory, source, range, executionBudget, markdownOptions, physicalRecorder,
    true, armLines)
  return window?.validated === true
    ? Object.freeze({
      sourceStart: window.sourceStart,
      nextProducts: window.nextProducts,
      nextWindow: window.nextWindow,
      ...(window.cleanStart === true ? { cleanStart: true as const } : {}),
      ...(window.cleanEnd === true ? { cleanEnd: true as const } : {}),
      ...(window.wholeLeaf === true ? { wholeLeaf: true as const } : {}),
      ...(window.literal === undefined ? {} : { literal: window.literal })
    })
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
  physicalRecorder: Profile1PhysicalTraversalRecorderV1,
  literalLines = true,
  armLines = false
): Readonly<{
  sourceStart: number
  nextProducts: Profile1DocumentProducts
  nextWindow: string
  validated: boolean
  labelsOnly: boolean
  cleanStart?: true
  cleanEnd?: true
  wholeLeaf?: true
  literal?: RegionalInventoryPreview['literal']
}> | undefined {
  const value = inventoryValue(inventory)
  const length = source.length
  if (length !== value.root.sourceLength || length === 0 || range.end > length) return undefined
  const referenced = (first: number, last: number): boolean => {
    const window = source.slice(first, last)
    return !referencesStayLocal(value, source, first, last, window, window)
  }
  const startEdge0 = windowEdge(value, range.start, 'start')
  const endEdge0 = windowEdge(value, range.end, 'end')
  if (startEdge0 === undefined || endEdge0 === undefined || endEdge0.ordinal < startEdge0.ordinal ||
      startEdge0.source > range.start || endEdge0.source < range.end) {
    return undefined
  }
  // Lines of a literal block read in the window of those lines, or with
  // the whole block for a reader of the document's own text.
  const startEdge: WindowEdge = startEdge0
  const endEdge: WindowEdge = endEdge0
  let edited: WindowEdge = startEdge
  let editedEnd: WindowEdge = endEdge
  const literal = literalRunIn(startEdge.leaf) !== undefined || literalRunIn(endEdge.leaf) !== undefined
  if (literal && !literalLines) {
    const start = literalBlockEdge(value, startEdge, 'start')
    const end = literalBlockEdge(value, endEdge, 'end')
    if (start === undefined || end === undefined) return undefined
    edited = start
    editedEnd = end
  }
  if (literal && literalLines) {
    const lines = admitLiteralLines(value, source, source, Object.freeze({ start: range.start, end: range.start, insert: '' }),
      startEdge, endEdge, executionBudget, markdownOptions, physicalRecorder, true)
    if (lines?.kind === 'validated' && lines.literal !== undefined) {
      const labels = referenced(lines.sourceStart + lines.literal.lines.start, lines.sourceStart + lines.literal.lines.end)
      return Object.freeze({
        sourceStart: lines.sourceStart,
        nextProducts: lines.nextProducts,
        nextWindow: lines.nextWindow,
        validated: !labels,
        labelsOnly: labels,
        literal: lines.literal
      })
    }
  }
  // Lines of a suggestion arm's literal block read in the window of those
  // lines too, as an edit there does (see `admitArmLiteralLines`), for a
  // reader of their blocks alone: the window holds no suggestion, so its
  // Original and Revised text are not the document's.
  if (literalLines && armLines) {
    const arm = admitArmLiteralLines(value, source, source, Object.freeze({ start: range.start, end: range.start, insert: '' }),
      executionBudget, markdownOptions, physicalRecorder, true)
    if (arm?.kind === 'validated' && arm.literal !== undefined && range.end <= arm.sourceStart + arm.literal.lines.end) {
      const labels = referenced(arm.sourceStart + arm.literal.lines.start, arm.sourceStart + arm.literal.lines.end)
      return Object.freeze({
        sourceStart: arm.sourceStart,
        nextProducts: arm.nextProducts,
        nextWindow: arm.nextWindow,
        validated: !labels,
        labelsOnly: labels,
        literal: arm.literal
      })
    }
  }
  const lone = loneLeafRead(value, source, edited, editedEnd, range, executionBudget, markdownOptions, physicalRecorder)
  if (lone !== undefined) {
    return Object.freeze({
      ...lone,
      wholeLeaf: true as const,
      validated: !referenced(lone.sourceStart, lone.sourceStart + lone.nextWindow.length),
      labelsOnly: referenced(lone.sourceStart, lone.sourceStart + lone.nextWindow.length)
    })
  }
  for (let widening = 0; ; widening += 1) {
    const before = contextBefore(source, edited.source > 0 ? windowEdge(value, edited.source - 1, 'start') : edited, edited, true,
      indentedLineAt(source, edited.source))
    const after = contextAfter(source, editedEnd.source < length ? windowEdge(value, editedEnd.source, 'end') : editedEnd, editedEnd, true)
    // A reader of the document's own text reads a literal block around it whole.
    const first = before === undefined || literalLines || before === edited ? before : literalContextStart(value, before)
    const last = after === undefined || literalLines || after === editedEnd ? after : literalContextEnd(value, after)
    if (first === undefined || last === undefined) return undefined
    const window = source.slice(first.source, last.source)
    value.recorder.recordCandidateRegionParse(window.length)
    const result = parseProfile1Window(
      window,
      executionBudget,
      first.source === 0 ? markdownOptions : Object.freeze({ ...markdownOptions, frontMatter: false }),
      false,
      physicalRecorder,
      last.source === length,
      false,
      startsAfterOneEmptyLine(source, first.source),
      last === editedEnd && last.source < length
    )
    if (result.kind !== 'complete') return undefined
    if (last === editedEnd && last.source < length && !lastBlockEndsBefore(result)) return undefined
    const cleanStart = first.source === edited.source && edited.source > 0
    const cleanEnd = last.source === editedEnd.source && editedEnd.source < length
    const read = (validated: boolean) => {
      const labels = referenced(first.source, last.source)
      validated &&= !frontMatterReach(markdownOptions, first.source, range.start, window) &&
        !unpairedLiteralRuns(result, window)
      return Object.freeze({
        sourceStart: first.source,
        nextProducts: result,
        nextWindow: window,
        validated: validated && !labels,
        labelsOnly: validated && labels,
        ...(cleanStart ? { cleanStart: true as const } : {}),
        ...(cleanEnd ? { cleanEnd: true as const } : {})
      })
    }
    const leafPoints = leafPointsOf(result, window.length, !value.strayMarkers)
    const startStands = edited.source === first.source || leafPoints.includes(edited.source - first.source)
    const endStands = editedEnd.source === last.source || leafPoints.includes(editedEnd.source - first.source)
    if (!startStands || !endStands) {
      if (widening === 2) return read(false)
      const widenedStart = startStands ? edited : literalBlockEdge(value, first, 'start')
      const widenedEnd = endStands ? editedEnd : literalBlockEdge(value, last, 'end')
      if (widenedStart === undefined || widenedEnd === undefined) return read(false)
      edited = widenedStart
      editedEnd = widenedEnd
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
    }) && windowListsRead(value, first, last, result, window.length))
  }
}

/**
 * A range inside one region leaf holding a suggestion, read from that leaf
 * alone, as an edit there previews and applies it: the leaf's bounds are
 * safe points, so its parse reads as the document does, and a key reading
 * it before its edit reads the same parse. Undefined when the leaf alone
 * reads blocks the document would not (see `evaluateSameShape`).
 */
function loneLeafRead(
  inventory: InventoryValue,
  source: CanonicalSourceView,
  edited: WindowEdge,
  editedEnd: WindowEdge,
  range: Readonly<{ readonly start: number; readonly end: number }>,
  executionBudget: ExecutionBudgetId,
  markdownOptions: MarkdownOptionsV1,
  physicalRecorder: Profile1PhysicalTraversalRecorderV1
): Readonly<{ sourceStart: number, nextProducts: Profile1DocumentProducts, nextWindow: string }> | undefined {
  const leaf = edited.leaf
  if (edited.ordinal !== editedEnd.ordinal || leaf.kind !== 'region' || leaf.annotations.roots.length === 0 ||
      inventory.strayMarkers || leaf.listRun !== undefined || leaf.literalRun !== undefined || listBeside(inventory, edited.ordinal) ||
      range.start <= edited.source || range.end >= editedEnd.source) return undefined
  const window = source.slice(edited.source, editedEnd.source)
  if (frontMatterReach(markdownOptions, edited.source, range.start, window)) return undefined
  inventory.recorder.recordCandidateRegionParse(window.length)
  const result = parseProfile1Window(window, executionBudget, markdownOptions, false, physicalRecorder,
    editedEnd.source === source.length, true, startsAfterOneEmptyLine(source, edited.source))
  if (result.kind !== 'complete' || leafPointsOf(result, window.length, true).length !== 0 || !viewBlocksAgree(result) ||
      SPACES_LINE.test(result.editing().source) || unpairedLiteralRuns(result, window) ||
      (EMPTY_PARAGRAPH.test(window) && !emptyLinesInLiterals(result, window, 0, window.length))) return undefined
  const markers = markerCapsules(result.retainedIntrinsic?.markerDecisions ?? [], 0)
  if (markers.length !== leaf.markers.length || markers.some((marker, ordinal) => {
    const document = leaf.markers[ordinal]
    return document === undefined || marker.kind !== document.kind || marker.role !== document.role || marker.action !== document.action
  })) return undefined
  return Object.freeze({ sourceStart: edited.source, nextProducts: result, nextWindow: window })
}

/**
 * Whether each list whose items the window holds reads there as the whole
 * list does in place: as loose or tight, and as a task list or not. The
 * window's items alone decide that for the window.
 */
function windowListsRead(
  inventory: InventoryValue,
  first: WindowEdge,
  last: WindowEdge,
  products: Profile1DocumentProducts,
  windowLength: number
): boolean {
  const split = listSplitOf(products, windowLength, !inventory.strayMarkers)
  if (split.lists.size === 0) return true
  const editing = products.editing()
  const listAt = new Map<number, MarkdownNode>()
  for (const [list, lineStarts] of split.lists) {
    for (const line of lineStarts) {
      const source = canonicalSourceAt(editing.mappedTape, line)
      if (source !== undefined) listAt.set(source, list)
    }
  }
  for (const located of leafRange(inventory.root, first.ordinal, last.ordinal)) {
    if (located.leaf.kind !== 'region' || located.leaf.listRun === undefined) continue
    const list = listAt.get(located.sourceStart - first.source)
    if (list === undefined) return false
    const inPlace = listKeyFields(located.leaf.listRun.key)
    const read = listKeyFields(listKeyOf(list))
    if (read.tight !== inPlace.tight || read.taskList !== inPlace.taskList) return false
  }
  return true
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
  // A candidate the compile weighs, as a Substitution spelling a block twice,
  // can repeat any closer or divider the window spells, and in the document
  // one after an unfinished opener of its form changes how that opener
  // reads; the window, which holds no such opener, cannot weigh it.
  const before = unterminatedFormsBefore(value.root, first.ordinal)
  if (previousWindow.includes('|') || nextWindow.includes('|') || overlappingSpellings(nextWindow) ||
      (before & (addedCloserForms(previousWindow, nextWindow) | spelledCloserForms(previousWindow + nextWindow))) !== 0) return false
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

/**
 * Whether the inventory was made of a document whose lists split into
 * items, which only this inventory edits an item at a time.
 */
export function regionalInventorySplitsLists(inventory: RegionalInventory): boolean {
  return inventoryValue(inventory).splitsLists === true
}

/** The source range of the split list holding `position`, if it lies in one. */
export function regionalInventoryListRange(
  inventory: RegionalInventory,
  position: number
): Readonly<{ start: number, end: number }> | undefined {
  const value = inventoryValue(inventory)
  const located = locateBySource(value, Math.min(position, Math.max(0, value.root.sourceLength - 1)))
  if (located === undefined || located.leaf.kind !== 'region' || located.leaf.listRun === undefined) return undefined
  const extent = listExtent(value, located.ordinal, located.ordinal)
  return extent === undefined ? undefined : Object.freeze({ start: extent.start.source, end: extent.end.source })
}

/** The source range of the split literal block whose line holds `position`, if one does. */
export function regionalInventoryLiteralRange(
  inventory: RegionalInventory,
  position: number
): Readonly<{ start: number, end: number }> | undefined {
  const value = inventoryValue(inventory)
  const located = locateBySource(value, Math.min(position, Math.max(0, value.root.sourceLength - 1)))
  if (located === undefined || literalRunIn(located.leaf) === undefined) return undefined
  const edge = windowEdge(value, located.sourceStart, 'start')
  const start = edge === undefined ? undefined : literalBlockEdge(value, edge, 'start')
  const end = edge === undefined ? undefined : literalBlockEdge(value, edge, 'end')
  return start === undefined || end === undefined ? undefined : Object.freeze({ start: start.source, end: end.source })
}

/** The inventory's leaves in order, for package-private equivalence tests. */
export function regionalInventoryLeaves(inventory: RegionalInventory): readonly unknown[] {
  return leavesOf(inventoryValue(inventory).root)
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
  if (edits.length === 1 && edits[0] !== undefined && !subscriptions.some(subscription => subscription.name === 'comment')) {
    const arm = admitArmLiteralLines(inventoryValue(previousInventory), previousSource, nextSource, edits[0],
      executionBudget, markdownOptions, physicalRecorder, previewOnly) ??
      admitArmCreation(inventoryValue(previousInventory), previousSource, nextSource, edits[0],
        executionBudget, markdownOptions, physicalRecorder, previewOnly)
    if (arm !== undefined) return arm
  }
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
/**
 * Whether every run of lines EMPTY_PARAGRAPH finds in `window` lies inside
 * a literal block's text in `products`. `window` is the text before an edit
 * of `[editStart, editEnd)` that moved what follows it by `delta`, or the
 * parsed text itself with no edit; a run the edit touches is refused.
 */
function emptyLinesInLiterals(
  products: Profile1DocumentProducts,
  window: string,
  editStart: number,
  editEnd: number,
  delta = 0
): boolean {
  const editing = products.editing()
  const literals: Array<Readonly<{ start: number, end: number }>> = []
  const root = editing.markdown.root
  for (let ordinal = 0; ordinal < root.childCount; ordinal += 1) {
    const block = root.childAt(ordinal)
    if (!LITERAL_BLOCK_KINDS.has(block.kind) || block.childCount === 0) continue
    const start = canonicalSourceAt(editing.mappedTape, block.childAt(0).range.start)
    const end = canonicalSourceAt(editing.mappedTape, block.childAt(block.childCount - 1).range.end)
    if (start !== undefined && end !== undefined) literals.push({ start, end })
  }
  const pattern = new RegExp(EMPTY_PARAGRAPH.source, 'gu')
  for (let match = pattern.exec(window); match !== null; match = pattern.exec(window)) {
    const matchEnd = match.index + match[0].length
    if (match[0].length === 0) pattern.lastIndex += 1
    const noEdit = editStart === 0 && editEnd === window.length && delta === 0
    if (!noEdit && match.index < editEnd && editStart < matchEnd) return false
    const shift = noEdit || match.index < editStart ? 0 : delta
    if (!literals.some(literal => literal.start < match.index + shift && matchEnd + shift < literal.end)) return false
  }
  return true
}

const BUDGET_EXHAUSTED: RegionalInventoryFallback = Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })

/** A text's line break after its last text, with the blank lines after it. */
const BLANK_TAIL = /(?:\r\n|\r|\n)[ \t\r\n]*$/u

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
    edit.end >= start.sourceStart + start.leaf.sourceLength ||
    // An item read alone is a list of its own, which the block window
    // reads with its neighbours instead; so are the blocks around a list,
    // whose bounds are the list's only while one empty line keeps them apart.
    start.leaf.listRun !== undefined || listBeside(inventory, start.ordinal) ||
    // A literal block's line read alone is a paragraph; the block window
    // reads it with the block's delimiters instead.
    start.leaf.literalRun !== undefined
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
  // The blank lines ending a leaf part it from the next one; text typed
  // there can join the next block to the leaf's last one.
  const previousTail = BLANK_TAIL.exec(previousWindow)
  const nextTail = BLANK_TAIL.exec(nextWindow)
  if ((previousTail?.[0] ?? '') !== (nextTail?.[0] ?? '') || localEnd > (previousTail?.index ?? previousWindow.length)) {
    return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
  }
  // An empty paragraph reads a whitespace-only line differently when no
  // block follows it in the parsed text, as none does in a lone region.
  const emptyLines = EMPTY_PARAGRAPH.test(nextWindow) || EMPTY_PARAGRAPH.test(previousWindow)
  if (
    frontMatterReach(markdownOptions, start.sourceStart, edit.start, previousWindow, nextWindow) ||
    emptyLines && inventory.strayMarkers ||
    // Marker spellings pair across the document: one the edit spells or
    // unspells can pair with markers outside the leaf.
    !inventory.markerFree && markerSpellingSequence(previousWindow) !== markerSpellingSequence(nextWindow) ||
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
    rootCountIn(inventory.root) - rootCountIn(start.leaf) > 0,
    startsAfterOneEmptyLine(nextSource, start.sourceStart)
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
  // Empty lines in a literal block's text are that text, not paragraphs.
  if (emptyLines && (!emptyLinesInLiterals(result, nextWindow, 0, nextWindow.length) ||
      !emptyLinesInLiterals(result, previousWindow, localStart, localEnd, delta))) {
    return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
  }
  // A line of spaces that only a comment's hidden text shared is such a line too.
  // A literal block the edit gives a second line may split into lines as
  // its leaf's last block, which only the block after it shows.
  if (leafPointsOf(result, nextWindow.length, !inventory.strayMarkers).length !== 0 || !viewBlocksAgree(result) ||
      SPACES_LINE.test(result.editing().source) || unpairedLiteralRuns(result, nextWindow) ||
      listSplitOf(result, nextWindow.length, !inventory.strayMarkers, false).literals.size > 0) {
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

  // An edit the projection hides, as in a Comment's text, moves no node.
  const projectedStart = projectedOffsetOf(result, localStart)
  if (
    !sameRegionShape(start.leaf, candidate, projectedStart === undefined
      ? undefined
      : { at: projectedStart, delta: candidate.syntaxLength - start.leaf.syntaxLength }) ||
    !diagnosticsMoveWithEdit(start.leaf.diagnostics, candidate.diagnostics, localStart, localEnd, delta)
  ) {
    return Object.freeze({ kind: 'fallback', reason: 'fixed-region-ineligible' })
  }
  if (previewOnly) {
    return Object.freeze({
      kind: 'validated', sourceStart: start.sourceStart, nextProducts: result, nextWindow, wholeLeaf: true
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
    ...(inventory.plainRecorder === undefined ? {} : { plainRecorder: inventory.plainRecorder }),
    ...(inventory.splitsLists === true ? { splitsLists: true } : {})
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
      rootCountIn(inventory.root) > 0,
      startsAfterOneEmptyLine(nextSource, nextSourceStart)
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
    if (leafPointsOf(parsed, window.length, !inventory.strayMarkers).length !== 0) {
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

/** Context longer than this reads only as far as a window needs it. */
const CONTEXT_REACH = 1024

/** Whether `leaf` holds nothing any other leaf's reading reaches or depends on. */
function quietLeaf(leaf: RegionLeaf): boolean {
  return leaf.kind === 'gap' || (leaf.annotations.roots.length === 0 && leaf.markers.length === 0 &&
    leaf.diagnostics.length === 0 && leaf.listRun === undefined && leaf.literalRun === undefined)
}

/**
 * Whether a literal run is a fence with its closer: indented code goes on
 * into an indented line after blank lines, an HTML block into a line that
 * does not end it, and a math block's dollars pair with dollars after it.
 */
function closedFenceRun(run: LiteralRun): boolean {
  return (run.key.startsWith('code-block') || run.key.startsWith('diagram')) &&
    !run.key.includes('indented-code') && !run.key.endsWith('""')
}

/**
 * Whether a literal run ends at its closer whatever follows it, with a block
 * after it: a closed fence; a closed math block while the edit pairs no
 * dollars anew, so none after the block can pair with its own; an HTML
 * block, which a block after it has ended; or indented code while the block
 * after it is not indented, which it would go on into.
 */
function closedLiteralRun(run: LiteralRun, dollarsStay: boolean, indentedAfter: boolean): boolean {
  return closedFenceRun(run) ||
    dollarsStay && run.key.startsWith('math-block') && !run.key.endsWith('""') ||
    run.key.startsWith('html-block') ||
    !indentedAfter && run.key.startsWith('code-block') && run.key.includes('indented-code')
}

/**
 * Whether a window's last block ends before the empty line ending the
 * window: a block left open there, as a fence that lost its closer, would
 * go on into the block after the window in the document.
 */
function lastBlockEndsBefore(products: Profile1DocumentProducts): boolean {
  const editing = products.editing()
  const root = editing.markdown.root
  const last = root.childCount === 0 ? undefined : root.childAt(root.childCount - 1)
  if (last === undefined) return false
  // An HTML block of the kinds a blank line ends holds its last line ending,
  // so the blank line after that ends it. A comment, a processing
  // instruction, a declaration, CDATA or a raw-text element reads on past a
  // blank line to its own end, as an indented code block does. A fenced code
  // or math block that its own closer ends holds that closer's line ending
  // too; one left open runs on to the window's end.
  const text = editing.source.slice(last.range.start, last.range.end)
  const ending = last.kind === 'html-block' &&
    !/^ {0,3}<(?:(?:script|pre|style|textarea)(?:[ \t>]|$)|!--|\?|![A-Za-z]|!\[CDATA\[)/iu.test(text) ||
    ['code-block', 'math-block', 'diagram'].includes(last.kind) && closedByOwnFence(text)
    ? /(?:\r\n|\r|\n)$/u.exec(text)?.[0] ?? ''
    : ''
  const after = ending + editing.source.slice(last.range.end)
  return /(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)[ \t\r\n]*$/u.test(after) && /^[ \t\r\n]*$/u.test(after)
}

/** Whether `text`, a fenced code or math block, ends with a closer of its opener's kind and length. */
function closedByOwnFence(text: string): boolean {
  const lines = text.replace(/(?:\r\n|\r|\n)$/u, '').split(/\r\n|\r|\n/u)
  if (lines.length < 2) return false
  const opener = /^ {0,3}(`{3,}|~{3,}|\$\$)/u.exec(lines[0] ?? '')?.[1]
  const closer = /^ {0,3}(`{3,}|~{3,}|\$\$)[ \t]*$/u.exec(lines.at(-1) ?? '')?.[1]
  return opener !== undefined && closer !== undefined && closer[0] === opener[0] && closer.length >= opener.length
}

/** Whether the first line holding text at or after `offset` is indented as code. */
function indentedLineAt(text: CanonicalSourceView, offset: number): boolean {
  const line = firstTextLine(text, offset)
  return /^(?: {4}| {0,3}\t)/u.test(text.slice(line, Math.min(text.length, line + 4)))
}

/** Whether `text` is one fenced code block, closed by its last line that is not blank. */
function closedFence(text: string): boolean {
  const lines = text.split(/\r\n|\r|\n/u)
  const opener = /^ {0,3}(`{3,}|~{3,})/u.exec(lines[0] ?? '')
  if (opener === null) return false
  const fence = opener[1] ?? ''
  const closer = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`, 'u')
  let last = lines.length - 1
  while (last > 0 && /^[ \t]*$/u.test(lines[last] ?? '')) last -= 1
  if (last === 0 || !closer.test(lines[last] ?? '')) return false
  for (let line = 1; line < last; line += 1) if (closer.test(lines[line] ?? '')) return false
  return true
}

/**
 * The context before the edited leaves. A long fenced code block there is
 * left out: a fence closed before the edited blocks begin at a block
 * boundary reads as it did whatever they become, and they read from a clean
 * start without it.
 */
function contextBefore(
  source: CanonicalSourceView,
  first: WindowEdge | undefined,
  edited: WindowEdge,
  dollarsStay: boolean,
  indentedAfter: boolean
): WindowEdge | undefined {
  if (first === undefined || first === edited) return first
  // A literal block's last line ends it at the safe point the edited
  // blocks start at, and its line read alone would not end it; indented
  // code alone goes on into an indented line after blank lines.
  if (first.leaf.kind === 'region' && first.leaf.literalRun?.last === true &&
    closedLiteralRun(first.leaf.literalRun, dollarsStay, indentedAfter)) return edited
  if (edited.source - first.source <= CONTEXT_REACH || !quietLeaf(first.leaf)) return first
  return closedFence(source.slice(first.source, edited.source)) ? edited : first
}

/**
 * The context after the edited leaves. A long leaf there is read to the end
 * of its first line: that line decides where the edited blocks end, blocks
 * parse forward, and the context is compared cut alike before and after the
 * edit. A run or marker the edited blocks would pair past the cut is left
 * unpaired in the window, which refuses it.
 */
function contextAfter(
  source: CanonicalSourceView,
  last: WindowEdge | undefined,
  editedEnd: WindowEdge,
  dollarsStay: boolean
): WindowEdge | undefined {
  if (last === undefined || last === editedEnd) return last
  // A closed math block after the edited blocks starts at its own opener,
  // which its first line read alone would leave unpaired.
  const run = last.leaf.kind === 'region' ? last.leaf.literalRun : undefined
  if (run?.first === true && run.key.startsWith('math-block') && closedLiteralRun(run, dollarsStay, false)) return editedEnd
  if (last.source - editedEnd.source <= CONTEXT_REACH || !quietLeaf(last.leaf)) return last
  const text = source.slice(editedEnd.source, editedEnd.source + CONTEXT_REACH)
  const lineEnd = text.search(/\r\n|\r|\n/u)
  if (lineEnd < 0) return last
  return Object.freeze({ ...last, source: editedEnd.source + lineEnd + (text.startsWith('\r\n', lineEnd) ? 2 : 1) })
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
  // Text the projection generates bounds no block of the window when it only
  // parts the blocks of a suggestion, inside it, which no leaf boundary cuts,
  // as between a Substitution's blocks; other generated text, as protection,
  // reads with the document.
  if (!strayMarkers && editing.mappedTape.some(segment => segment.kind !== 'canonical' &&
    (/\S/u.test(editing.source.slice(segment.projectedStart, segment.projectedEnd)) ||
      !retained.roots.some(root => root.range.start < segment.sourcePosition && segment.sourcePosition < root.range.end)))) return undefined
  if (!strayMarkers && !markersPaired(retained.markerDecisions)) return undefined
  const boundaries = Object.freeze([0, ...leafPointsOf(products, window.length, !strayMarkers), window.length])
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
  // A backslash the edit inserts escapes only the character after it: one of
  // the insert's, which spells no run, or the one after the edit, which the
  // source test covers.
  return /[`$]/u.test(edit.insert) ||
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

/** The kind of a closed fenced code or display math block `text` spells whole, read alone. */
function closedLiteralBlock(text: string): 'fenced-code' | 'math' | undefined {
  if (closedFence(text)) return 'fenced-code'
  const lines = text.split(/\r\n|\r|\n/u)
  return lines.length > 1 && /^\$\$[^$]*$/u.test(lines[0] ?? '') && /^\$\$[ \t]*$/u.test(lines.at(-1) ?? '') &&
    !lines.slice(1, -1).some(line => line.includes('$'))
    ? 'math'
    : undefined
}

type SourceSpan = Readonly<{ start: number, end: number }>

/**
 * An edit that replaces closed fenced code or display math blocks whole:
 * one block by a closed block of the same kind, as a key in a
 * Substitution's proposed block does; one block by a Substitution of it by
 * such a block, as a tracked key in the block suggests; or, inside a
 * Substitution of one such block by another, its two blocks by two such
 * blocks, as a key across its divider does. `previous` and `next` are the
 * blocks before and after the edit, each in its own source, and the extents
 * the edit's text covers there.
 */
export interface LiteralBlockReplacement {
  readonly kind: 'fenced-code' | 'math'
  readonly previous: readonly SourceSpan[]
  readonly previousExtent: SourceSpan
  readonly next: readonly SourceSpan[]
  readonly nextExtent: SourceSpan
}

/** The two blocks, offsets in `text`, of a Substitution `text` spells whole of one closed literal block by another. */
function literalBlockSubstitution(text: string): Readonly<{ kind: LiteralBlockReplacement['kind'], blocks: readonly SourceSpan[] }> | undefined {
  if (!text.startsWith('{~~') || !text.endsWith('~~}')) return undefined
  const separators = [...text.matchAll(/~>/gu)]
  if (separators.length !== 1) return undefined
  const separator = separators[0]?.index ?? -1
  const struck = text.slice(3, separator).replace(/[ \t\r\n]+$/u, '')
  const proposed = text.slice(separator + 2, -3).replace(/[ \t\r\n]+$/u, '')
  const kind = closedLiteralBlock(struck)
  if (kind === undefined || closedLiteralBlock(proposed) !== kind) return undefined
  return Object.freeze({
    kind,
    blocks: Object.freeze([
      Object.freeze({ start: 3, end: 3 + struck.length }),
      Object.freeze({ start: separator + 2, end: separator + 2 + proposed.length })
    ])
  })
}

function literalReplacementIn(
  value: InventoryValue | undefined,
  previousSource: CanonicalSourceView,
  edit: RetainedPassSourceEdit
): LiteralBlockReplacement | undefined {
  return literalReplacementShape(value, previousSource, edit)
}

function literalReplacementShape(
  value: InventoryValue | undefined,
  previousSource: CanonicalSourceView,
  edit: RetainedPassSourceEdit
): LiteralBlockReplacement | undefined {
  // A backslash before the edit would protect what it begins with.
  if (previousSource.slice(Math.max(0, edit.start - 1), edit.start) === '\\') return undefined
  const shifted = (spans: readonly SourceSpan[], by: number): readonly SourceSpan[] =>
    Object.freeze(spans.map(span => Object.freeze({ start: span.start + by, end: span.end + by })))
  const removed = previousSource.slice(edit.start, edit.end)
  const block = removed.replace(/[ \t\r\n]+$/u, '')
  const kind = closedLiteralBlock(block)
  if (kind !== undefined) {
    const previous = Object.freeze([Object.freeze({ start: edit.start, end: edit.start + block.length })])
    const previousExtent = Object.freeze({ start: edit.start, end: edit.end })
    const nextExtent = Object.freeze({ start: edit.start, end: edit.start + edit.insert.length })
    const substitution = edit.insert.startsWith(`{~~${removed}`) ? literalBlockSubstitution(edit.insert) : undefined
    if (substitution?.kind === kind) {
      return Object.freeze({ kind, previous, previousExtent, next: shifted(substitution.blocks, edit.start), nextExtent })
    }
    const replacement = edit.insert.replace(/[ \t\r\n]+$/u, '')
    return closedLiteralBlock(replacement) === kind && edit.insert.slice(replacement.length) === removed.slice(block.length)
      ? Object.freeze({
        kind,
        previous,
        previousExtent,
        next: Object.freeze([Object.freeze({ start: edit.start, end: edit.start + replacement.length })]),
        nextExtent
      })
      : undefined
  }
  // An edit inside a Substitution of one literal block by another rewrites it whole.
  if (value === undefined) return undefined
  const located = locateBySource(value, Math.min(edit.start, Math.max(0, value.root.sourceLength - 1)))
  if (located === undefined || located.leaf.kind !== 'region') return undefined
  const { nodes, roots } = located.leaf.annotations
  for (const ordinal of roots) {
    const node = nodes[ordinal]
    if (node === undefined) continue
    const start = located.sourceStart + node.start
    const end = located.sourceStart + node.end
    if (start > edit.start || edit.end > end) continue
    const before = literalBlockSubstitution(previousSource.slice(start, end))
    const text = previousSource.slice(start, edit.start) + edit.insert + previousSource.slice(edit.end, end)
    const after = literalBlockSubstitution(text)
    if (before === undefined || after?.kind !== before.kind) return undefined
    return Object.freeze({
      kind: before.kind,
      previous: shifted(before.blocks, start),
      previousExtent: Object.freeze({ start, end }),
      next: shifted(after.blocks, start),
      nextExtent: Object.freeze({ start, end: start + text.length })
    })
  }
  return undefined
}

export function literalBlockReplacement(
  previousSource: CanonicalSourceView,
  edit: RetainedPassSourceEdit,
  inventory?: RegionalInventory
): LiteralBlockReplacement | undefined {
  return literalReplacementIn(inventory === undefined ? undefined : inventoryValue(inventory), previousSource, edit)
}

/**
 * Whether `products` read each of `blocks` (window offsets) as one literal
 * of `kind` from its first character, ending within the block's trailing
 * whitespace, and read no other literal across `extent`.
 */
function readsLiteralBlocks(
  products: Profile1DocumentProducts,
  text: string,
  kind: LiteralBlockReplacement['kind'],
  blocks: readonly Readonly<{ start: number, end: number }>[],
  extent: Readonly<{ start: number, end: number }>
): boolean {
  const literals = (products.retainedIntrinsic?.markdownLiterals ?? [])
    .filter(literal => literal.start < extent.end && literal.end > extent.start)
  if (literals.length !== blocks.length) return false
  return blocks.every((block, ordinal) => {
    const literal = literals[ordinal]
    const trailing = /^[ \t\r\n]*/u.exec(text.slice(block.end))?.[0].length ?? 0
    return literal !== undefined && literal.kind === kind && literal.start === block.start &&
      literal.end >= block.end && literal.end <= block.end + trailing
  })
}

/**
 * Whether `next` reads the literals `previous` reads, moved by an edit of
 * `[start, end)` that changed the text's length by `delta`: those before it
 * where they were, those after it moved, and those holding it ending moved.
 */
function literalsKept(
  previous: Profile1DocumentProducts,
  next: Profile1DocumentProducts,
  start: number,
  end: number,
  delta: number
): boolean {
  const before = previous.retainedIntrinsic?.markdownLiterals ?? []
  const after = next.retainedIntrinsic?.markdownLiterals ?? []
  if (before.length !== after.length) return false
  return before.every((literal, ordinal) => {
    const moved = after[ordinal]
    const expected = literal.end <= start
      ? literal
      : literal.start >= end
        ? { start: literal.start + delta, end: literal.end + delta }
        : literal.start <= start && literal.end >= end ? { start: literal.start, end: literal.end + delta } : undefined
    return moved !== undefined && expected !== undefined && moved.kind === literal.kind &&
      moved.start === expected.start && moved.end === expected.end
  })
}

/** Whether every backtick run of `text` lies in a fenced code block `products` read there. */
function backtickRunsFenced(products: Profile1DocumentProducts, text: string): boolean {
  const literals = (products.retainedIntrinsic?.markdownLiterals ?? []).filter(literal => literal.kind === 'fenced-code')
  for (const run of text.matchAll(/`+/gu)) {
    if (!literals.some(literal => literal.start <= run.index && run.index + run[0].length <= literal.end)) return false
  }
  return true
}

const MARKER_CLOSER: Readonly<Record<string, string>> = Object.freeze({
  '{++': '++}', '{--': '--}', '{~~': '~~}', '{==': '==}', '{>>': '<<}'
})

/**
 * Whether `edit` removes only whole suggestions, or markers it spells again,
 * and inserts only whole suggestions: openers and closers that pair with each
 * other in order, with a Substitution's divider inside it, and no spellings
 * that overlap.
 */
function balancedInsertion(previousSource: CanonicalSourceView, edit: RetainedPassSourceEdit): boolean {
  const removed = previousSource.slice(edit.start, edit.end)
  if (overlappingSpellings(removed) || overlappingSpellings(edit.insert)) return false
  // Nothing outside the insert spells a marker with it or protects one of
  // its spellings, and it protects none after it.
  const before = previousSource.slice(Math.max(0, edit.start - 2), edit.start)
  const after = previousSource.slice(edit.end, Math.min(previousSource.length, edit.end + 2))
  const joined = before + edit.insert + after
  if (before.endsWith('\\') || protectedSpelling(joined, joined.length - after.length) ||
      markerSpellings(joined) !== markerSpellings(before) + markerSpellings(edit.insert) + markerSpellings(after)) return false
  const spelled = (text: string): string[] => [...text.matchAll(MARKER_SPELLING)]
    .filter(match => !protectedSpelling(text, match.index)).map(match => match[1] ?? '')
  // Markers the edit removes it must spell again, together at its start or
  // its end, as typing at the start of a Substitution's struck text rewrites
  // its opener after the new suggestions.
  const removedSpellings = spelled(removed).join(' ')
  let spellings = spelled(edit.insert)
  // Whole suggestions the edit removes paired only with each other, as one
  // a selection typed over replaces.
  if (removedSpellings !== '' && !wholeSuggestions(spelled(removed))) {
    const count = removedSpellings.split(' ').length
    if (spellings.slice(-count).join(' ') === removedSpellings) spellings = spellings.slice(0, -count)
    else if (spellings.slice(0, count).join(' ') === removedSpellings) spellings = spellings.slice(count)
    else return false
  }
  // Splitting a suggestion closes it before the insert and opens it again
  // after it, as typing in a Deletion does: the window, which holds the
  // whole suggestion, must read both spellings as its markers (checked
  // once it is parsed).
  const first = spellings[0]
  const last = spellings.at(-1)
  const split = spellings.length > 1 && first !== undefined && last !== undefined && first !== '~~}' &&
    Object.values(MARKER_CLOSER).includes(first) && MARKER_CLOSER[last] === first
  return wholeSuggestions(split ? spellings.slice(1, -1) : spellings)
}

/** Whether marker `spellings` open and close in order, with each divider inside a Substitution. */
function wholeSuggestions(spellings: readonly string[]): boolean {
  const open: string[] = []
  for (const spelling of spellings) {
    const closer = MARKER_CLOSER[spelling]
    if (closer !== undefined) open.push(closer)
    else if (spelling === '~>') {
      if (open.at(-1) !== '~~}') return false
    } else if (open.pop() !== spelling) return false
  }
  return open.length === 0
}

/**
 * Whether `products` read every spelling of `text` no backslash protects as
 * a marker, but for those inside a literal, which read as its text, and
 * read no other marker.
 */
function spellingsDecided(products: Profile1DocumentProducts, text: string): boolean {
  const decided = new Set((products.retainedIntrinsic?.markerDecisions ?? []).map(decision => Number(decision.range.start)))
  const literals = products.retainedIntrinsic?.markdownLiterals ?? []
  const spellings = unprotectedSpellings(text)
  return [...decided].every(offset => spellings.includes(offset)) && spellings.every(offset => decided.has(offset) ||
    literals.some(literal => literal.start <= offset && offset < literal.end))
}

/** Whether an odd run of backslashes ends at `offset`, protecting a spelling there as text. */
function protectedSpelling(text: string, offset: number): boolean {
  let backslashes = 0
  while (offset - backslashes > 0 && text.charCodeAt(offset - backslashes - 1) === 92) backslashes += 1
  return backslashes % 2 === 1
}

/** Positions of the spellings of `text` no backslash protects. */
function unprotectedSpellings(text: string): number[] {
  return [...text.matchAll(MARKER_SPELLING)].map(match => match.index).filter(offset => !protectedSpelling(text, offset))
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
  // Lines of a literal block read literally, whatever they spell.
  const startEdge = windowEdge(inventory, edit.start, 'start')
  const endEdge = windowEdge(inventory, edit.end, 'end')
  const literal = startEdge !== undefined && endEdge !== undefined &&
    (literalRunIn(startEdge.leaf) !== undefined || literalRunIn(endEdge.leaf) !== undefined)
  if (literal) {
    const lines = admitLiteralLines(inventory, previousSource, nextSource, edit, startEdge, endEdge,
      executionBudget, markdownOptions, physicalRecorder, previewOnly)
    if (lines !== undefined) return lines
  }
  // A whole literal block replaced, or struck and proposed again, pairs its
  // delimiter runs with each other alone (checked once both windows are
  // parsed): the replaced block's runs paired so in place, so no run outside
  // the window could reach them, and each new block repeats such runs with
  // literal text between them.
  const replacement = inventory.strayMarkers ? undefined : literalReplacementIn(inventory, previousSource, edit)
  const pairingChanged = editChangesLiteralPairing(previousSource, edit)
  // An edit beside backtick or dollar runs that writes and removes none, nor
  // a backslash, keeps their pairing where both windows read the same
  // literals around it (checked once both are parsed): it moves no run.
  const runsBeside = pairingChanged && !inventory.markerFree && replacement === undefined &&
    !/[`$\\]/u.test(edit.insert) &&
    !/\\/u.test(previousSource.slice(Math.max(0, edit.start - 1), Math.min(previousSource.length, edit.end + 1))) &&
    !/[`$]/u.test(previousSource.slice(edit.start, edit.end))
  if (pairingChanged && !inventory.markerFree && replacement === undefined && !runsBeside) return undefined
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
    // Its markers pair with each other around the blocks, which read their
    // spellings literally.
    if (replacement !== undefined) return true
    const previousText = previousSource.slice(0, previousSource.length)
    if (/[`$]/u.test(edit.insert)) return false
    // A whole new suggestion pairs only with itself where every other marker
    // pairs or reads literally: backtick and dollar runs elsewhere keep their
    // pairing, spellings a backslash protects read as text wherever they are,
    // and the window must read every other spelling it holds as a marker
    // (checked once it is parsed).
    if (/[`$\\]/u.test(previousText) || edit.insert.includes('\\')) {
      return !inventory.strayMarkers && balancedInsertion(previousSource, edit)
    }
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
  // A literal block's line the line window could not read is read with its
  // whole block.
  const blockStart = literal ? literalBlockEdge(inventory, editedStartEdge, 'start') : editedStartEdge
  const blockEnd = literal ? literalBlockEdge(inventory, editedEndEdge, 'end') : editedEndEdge
  if (blockStart === undefined || blockEnd === undefined) return undefined
  let edited: WindowEdge = blockStart
  let editedEnd: WindowEdge = blockEnd
  let wholeList = false
  const delta = nextSource.length - length
  // A suggestion spanning a blank line joins the blocks around it into one
  // region; when a bound stops being a block start, the neighbouring block
  // joins the edited ones and the reparse widens by one more block.
  let readBefore = false
  let wholeLiteralBefore = false
  let wholeLiteralAfter = false
  for (let widening = 0; ; widening += 1) {
    const before = edited.source > 0 ? windowEdge(inventory, edited.source - 1, 'start') : edited
    const indentedAfter = indentedLineAt(previousSource, edited.source) || indentedLineAt(nextSource, edited.source)
    const clean = contextBefore(previousSource, before, edited, !pairingChanged, indentedAfter)
    // A clean start stays one only while the edited blocks start with text:
    // a blank line typed there joins the blocks before them.
    // The block before is then read whole: a literal block's line alone reads otherwise.
    const context = clean === edited && before !== edited && (readBefore ||
      /^[ \t]*(?:\r\n|\r|\n|$)/u.test(nextSource.slice(edited.source, Math.min(nextSource.length, edited.source + 256))))
      ? before === undefined ? undefined : literalBlockEdge(inventory, before, 'start')
      : clean
    const after = editedEnd.source < length ? windowEdge(inventory, editedEnd.source, 'end') : editedEnd
    // A literal block beside the edited blocks is read line by line only
    // while one empty line parts it from them (see `listSplitOf`); one the
    // edit changes that for is replaced whole.
    if (!wholeLiteralBefore && before !== undefined && before !== edited && literalRunIn(before.leaf)?.last === true &&
        !oneEmptyLineBefore(nextSource, firstTextLine(nextSource, edited.source))) {
      const start = literalBlockEdge(inventory, before, 'start')
      if (start === undefined) return undefined
      edited = start
      wholeLiteralBefore = true
      widening -= 1
      continue
    }
    if (!wholeLiteralAfter && after !== undefined && after !== editedEnd && literalRunIn(after.leaf)?.first === true &&
        !oneEmptyLineBefore(nextSource, editedEnd.source + delta)) {
      const end = literalBlockEdge(inventory, after, 'end')
      if (end === undefined) return undefined
      editedEnd = end
      wholeLiteralAfter = true
      widening -= 1
      continue
    }
    // Any block after the edited ones whose parting from them changes may
    // start or stop splitting into leaves, so it is replaced too.
    if (!wholeLiteralAfter && after !== undefined && after !== editedEnd && editedEnd.source < length &&
        oneEmptyLineBefore(previousSource, editedEnd.source) !== oneEmptyLineBefore(nextSource, editedEnd.source + delta)) {
      const end = after.leaf.kind === 'region' && after.leaf.listRun !== undefined
        ? listExtent(inventory, after.ordinal, after.ordinal)?.end
        : literalBlockEdge(inventory, after, 'end')
      if (end === undefined) return undefined
      editedEnd = end
      wholeLiteralAfter = true
      widening -= 1
      continue
    }
    // So may a split block before them when the block after it may start or
    // stop being an HTML block, which reads the blank line before it as an
    // empty paragraph.
    const htmlAt = (text: CanonicalSourceView, offset: number): boolean =>
      /^ {0,3}</u.test(text.slice(firstTextLine(text, offset), Math.min(text.length, firstTextLine(text, offset) + 8)))
    const splitBefore = before !== undefined && before.leaf.kind === 'region' &&
      (before.leaf.literalRun?.last === true || before.leaf.listRun?.last === true)
    if (!wholeLiteralBefore && before !== undefined && before !== edited &&
        (oneEmptyLineBefore(previousSource, firstTextLine(previousSource, edited.source)) !==
          oneEmptyLineBefore(nextSource, firstTextLine(nextSource, edited.source)) ||
          splitBefore && (htmlAt(previousSource, edited.source) || htmlAt(nextSource, edited.source)))) {
      const start = before.leaf.kind === 'region' && before.leaf.listRun !== undefined
        ? listExtent(inventory, before.ordinal, before.ordinal)?.start
        : literalBlockEdge(inventory, before, 'start')
      if (start === undefined) return undefined
      edited = start
      wholeLiteralBefore = true
      widening -= 1
      continue
    }
    // A literal block's later line read as context reads otherwise alone, so its whole block is.
    const first = context === undefined || context === edited ? context : literalContextStart(inventory, context)
    const cleanAfter = contextAfter(previousSource, after, editedEnd, !pairingChanged)
    // So does a literal block's first line read as context after them, but
    // for a long one, whose first line is read alone.
    const last = cleanAfter === undefined || cleanAfter === editedEnd
      ? cleanAfter
      : literalContextEnd(inventory, cleanAfter) ?? cleanAfter
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
      rootsOutside(inventory, first.ordinal, last.ordinal) > 0,
      startsAfterOneEmptyLine(nextSource, first.source),
      last === editedEnd && !atDocumentEnd
    )
    // The document parse reports a window's resource failure authoritatively.
    if (result.kind !== 'complete' || !viewBlocksAgree(result) || unpairedLiteralRuns(result, nextWindow)) return undefined
    if (last === editedEnd && !atDocumentEnd && !lastBlockEndsBefore(result)) return undefined
    // A suggestion spanning a blank line can take the safe point before its
    // block away, and an HTML block reads the blank line before it as an
    // empty paragraph, which only the block before shows.
    // A closed fence ends where it closes, whatever follows it.
    const afterClosedFence = before !== undefined && before.leaf.kind === 'region' &&
      before.leaf.literalRun?.last === true && closedLiteralRun(before.leaf.literalRun, !pairingChanged, indentedAfter)
    if (first === edited && before !== edited && !readBefore && ((!afterClosedFence &&
      (result.retainedIntrinsic?.roots ?? []).some(root =>
        /(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/u.test(nextWindow.slice(root.range.start, root.range.end)))) ||
      result.editing().markdown.root.childAt(0)?.kind === 'html-block')) {
      readBefore = true
      widening -= 1
      continue
    }
    const previousWindow = previousSource.slice(first.source, last.source)
    if (frontMatterReach(markdownOptions, first.source, edit.start, previousWindow, nextWindow)) return undefined
    if (inventory.strayMarkers && (markersProvable
      ? previousWindow.includes('|') || nextWindow.includes('|') || overlappingSpellings(nextWindow) ||
        (unterminatedFormsBefore(inventory.root, first.ordinal) & addedCloserForms(previousWindow, nextWindow)) !== 0
      : !strayMarkersUnchanged(previousWindow, nextWindow))) return undefined
    // Splitting or joining paragraphs moves the bound that stops a backtick
    // run pairing with a later one, except for runs that fence code blocks
    // in both windows (checked once the previous one is parsed).
    const runsNearSplit = !inventory.markerFree && replacement === undefined &&
      /[\r\n]/u.test(edit.insert + previousSource.slice(edit.start, edit.end)) &&
      (nextWindow.includes('`') || previousWindow.includes('`'))
    const leafPoints = leafPointsOf(result, nextWindow.length, !inventory.strayMarkers)
    const startStands = edited.source === first.source || leafPoints.includes(edited.source - first.source)
    const endStands = editedEnd.source === last.source || leafPoints.includes(editedEnd.source + delta - first.source)
    if (!startStands || !endStands) {
      // An item's edit that moves its list's bounds, as one making it a
      // paragraph between two lists, replaces the whole list.
      const extent = wholeList || (edited.leaf.kind !== 'region' || edited.leaf.listRun === undefined) &&
        (editedEnd.leaf.kind !== 'region' || editedEnd.leaf.listRun === undefined)
        ? undefined
        : listExtent(inventory, edited.ordinal, editedEnd.ordinal)
      if (extent !== undefined) {
        wholeList = true
        edited = extent.start
        editedEnd = extent.end
        widening = -1
        continue
      }
      if (widening === 2) return undefined
      // A literal block's line joins the edited blocks with its whole block.
      const widenedStart = startStands ? edited : literalBlockEdge(inventory, first, 'start')
      const widenedEnd = endStands ? editedEnd : literalBlockEdge(inventory, last, 'end')
      if (widenedStart === undefined || widenedEnd === undefined) return undefined
      edited = widenedStart
      editedEnd = widenedEnd
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
      rootsOutside(inventory, first.ordinal, last.ordinal) > 0,
      startsAfterOneEmptyLine(previousSource, first.source),
      last === editedEnd && last.source < length
    )
    if (previousResult.kind !== 'complete') return undefined
    if (runsNearSplit && (!backtickRunsFenced(result, nextWindow) || !backtickRunsFenced(previousResult, previousWindow))) return undefined
    if (runsBeside && (unpairedLiteralRuns(previousResult, previousWindow) ||
        !literalsKept(previousResult, result, edit.start - first.source, edit.end - first.source, delta))) return undefined
    if (replacement !== undefined) {
      const shift = (range: SourceSpan): SourceSpan => ({ start: range.start - first.source, end: range.end - first.source })
      if (!readsLiteralBlocks(result, nextWindow, replacement.kind, replacement.next.map(shift), shift(replacement.nextExtent)) ||
          !readsLiteralBlocks(previousResult, previousWindow, replacement.kind, replacement.previous.map(shift),
            shift(replacement.previousExtent))) return undefined
    }
    // The window reads its unchanged text as the document does only where
    // it finds no block boundary the document lacks: a dollar or backtick
    // run left open before the window keeps the document from parting
    // blocks the window parts.
    if (leafPointsOf(previousResult, previousWindow.length, !inventory.strayMarkers)
      .some(point => !inventoryPointAt(inventory, first.source + point))) return undefined
    if (!referencesStayLocal(inventory, previousSource, first.source, last.source, previousWindow, nextWindow)) return undefined
    const admitted = admitBlockWindow(
      inventory, edit, delta, edited, editedEnd, first, last,
      result, nextWindow, previewOnly, markersProvable, previousResult, previousWindow.length, pairingChanged
    )
    if (admitted !== WHOLE_LIST) return admitted
    // An edit that changes a list as a whole, as one splitting it in two,
    // replaces the whole list, once.
    if (wholeList) return undefined
    const extent = listExtent(inventory, edited.ordinal, editedEnd.ordinal)
    if (extent === undefined) return undefined
    wholeList = true
    edited = extent.start
    editedEnd = extent.end
    widening = Math.min(widening, 1)
  }
}

/** The start of the first line at or after line start `offset` of `source` that holds more than spaces. */
function firstTextLine(source: CanonicalSourceView, offset: number): number {
  const text = source.slice(offset, Math.min(source.length, offset + 4096))
  const match = /^(?:[ \t]*(?:\r\n|\r|\n))*/u.exec(text)
  return offset + (match?.[0].length ?? 0)
}

/**
 * Whether exactly one empty line comes before line start `offset` of
 * `source` (see `afterEmptyLine`), in the projection splits read, where a
 * line holding only a suggestion's markers is empty.
 */
function oneEmptyLineBefore(source: CanonicalSourceView, offset: number): boolean {
  const start = Math.max(0, offset - 4096)
  const text = source.slice(start, offset).replace(/\{\+\+|\{--|\{~~|\{==|\{>>|~>|\+\+\}|--\}|~~\}|==\}|<<\}/gu, '')
  return start === 0 && text.length === 0 ? true : afterEmptyLine(text, text.length)
}

/** Whether a window starting at `offset` of `source` starts it or follows exactly one empty line (see `listSplitOf`). */
function startsAfterOneEmptyLine(source: CanonicalSourceView, offset: number): boolean {
  return offset === 0 || oneEmptyLineBefore(source, offset)
}

/** The literal run of a leaf, if it holds lines of a split literal block. */
function literalRunIn(leaf: RegionLeaf | undefined): LiteralRun | undefined {
  return leaf?.kind === 'region' ? leaf.literalRun : undefined
}

/**
 * The ordinals of the first and last leaves of the literal block whose lines
 * leaves `from` to `to` hold, when they hold lines of one.
 */
function literalExtentOrdinals(
  leaves: readonly RegionLeaf[],
  from: number,
  to: number
): Readonly<{ first: number, last: number, key: string }> | undefined {
  const key = literalRunIn(leaves[from])?.key
  if (key === undefined) return undefined
  for (let ordinal = from + 1; ordinal <= to; ordinal += 1) {
    const run = literalRunIn(leaves[ordinal])
    if (run?.key !== key || run.first) return undefined
  }
  let first = from
  while (literalRunIn(leaves[first])?.first !== true) {
    first -= 1
    if (literalRunIn(leaves[first])?.key !== key) return undefined
  }
  let last = to
  while (literalRunIn(leaves[last])?.last !== true) {
    last += 1
    const run = literalRunIn(leaves[last])
    if (run?.key !== key || run.first) return undefined
  }
  return Object.freeze({ first, last, key })
}

/** The edges of the whole literal block a literal line leaf at `edge` belongs to, on `side`. */
/**
 * The start of a window reading `context`, the leaf before the edited
 * blocks, as context: a literal block's later line reads otherwise alone, so
 * the window starts at its block's start. A long block is not read for a
 * key beside it; the edit is read with the document instead.
 */
function literalContextStart(inventory: InventoryValue, context: WindowEdge): WindowEdge | undefined {
  if (literalRunIn(context.leaf) === undefined) return context
  const start = literalBlockEdge(inventory, context, 'start')
  return start === undefined || context.source - start.source > LITERAL_CONTEXT_UNITS ? undefined : start
}

/** The end of a window reading `context`, the leaf after the edited blocks, as context (see `literalContextStart`). */
function literalContextEnd(inventory: InventoryValue, context: WindowEdge): WindowEdge | undefined {
  if (literalRunIn(context.leaf) === undefined) return context
  const end = literalBlockEdge(inventory, context, 'end')
  return end === undefined || end.source - context.source > LITERAL_CONTEXT_UNITS ? undefined : end
}

/** The most text of a literal block a window reads as context around its edit. */
const LITERAL_CONTEXT_UNITS = 4096

function literalBlockEdge(
  inventory: InventoryValue,
  edge: WindowEdge,
  side: 'start' | 'end'
): WindowEdge | undefined {
  if (literalRunIn(edge.leaf) === undefined) return edge
  const leaves = leavesOf(inventory.root)
  const extent = literalExtentOrdinals(leaves, edge.ordinal, edge.ordinal)
  if (extent === undefined) return undefined
  let source = edge.source - edge.local
  if (side === 'start') {
    for (let ordinal = edge.ordinal - 1; ordinal >= extent.first; ordinal -= 1) source -= leaves[ordinal]?.sourceLength ?? 0
    const found = windowEdge(inventory, source, 'start')
    return found?.ordinal === extent.first ? found : undefined
  }
  for (let ordinal = edge.ordinal; ordinal <= extent.last; ordinal += 1) source += leaves[ordinal]?.sourceLength ?? 0
  const found = windowEdge(inventory, source - 1, 'end')
  return found?.ordinal === extent.last ? found : undefined
}

/**
 * An edit of inner lines of a literal block that is the whole text of a
 * suggestion's arm, as a key typed in a Substitution's proposed code block.
 * Its lines read literally there as they do alone, so a window of the
 * block's opener line, the edited lines with a line of context on each
 * side, and its closer line reads them, before and after the edit; the
 * block keeps its delimiters and its other lines. The suggestion's leaf is
 * then the same leaf with what follows the edit moved by it: no part of
 * the leaf but those lines is read again. Undefined leaves the edit to the
 * other windows.
 */
/** A line a Markdown block can start with, interrupting a paragraph. */
const BLOCK_START_LINE = /(?:^|\n) {0,3}(?:#{1,6}(?:[ \t]|\n|$)|>|[-+*](?:[ \t]|\n|$)|\d{1,9}[.)](?:[ \t]|\n|$)|`{3,}|~{3,}|<|(?:[-*_][ \t]*){3,}(?:\n|$)|=+[ \t]*(?:\n|$))/u

function admitArmLiteralLines(
  inventory: InventoryValue,
  previousSource: CanonicalSourceView,
  nextSource: CanonicalSourceView,
  edit: RetainedPassSourceEdit,
  executionBudget: ExecutionBudgetId,
  markdownOptions: MarkdownOptionsV1,
  physicalRecorder: Profile1PhysicalTraversalRecorderV1,
  previewOnly: boolean
): RegionalInventoryAdmission | RegionalInventoryPreview | undefined {
  if (inventory.strayMarkers || previousSource.length !== inventory.root.sourceLength) return undefined
  const located = locateBySource(inventory, edit.start)
  const leaf = located?.leaf
  if (located === undefined || leaf?.kind !== 'region' || leaf.armLiterals === undefined) return undefined
  const localStart = edit.start - located.sourceStart
  const localEnd = edit.end - located.sourceStart
  // An indented code block's last line ends its lines, where a key may type.
  const armIndex = leaf.armLiterals.findIndex(arm => arm.start < localStart &&
    (localEnd < arm.end || (arm.closer === '' && localEnd === arm.end)))
  const arm = leaf.armLiterals[armIndex]
  if (arm === undefined) return undefined
  const delta = nextSource.length - previousSource.length
  // The block's lines, in document source.
  const blockStart = located.sourceStart + arm.start
  const blockEnd = located.sourceStart + arm.end
  const text = previousSource.slice(blockStart, blockEnd)
  const starts = [0]
  for (const match of text.matchAll(/\r\n|\r|\n/gu)) {
    const next = match.index + match[0].length
    if (next < text.length) starts.push(next)
  }
  const lineOf = (offset: number): number => {
    let low = 0
    let high = starts.length
    while (low < high) {
      const middle = (low + high) >> 1
      if ((starts[middle] ?? 0) <= offset) low = middle + 1
      else high = middle
    }
    return low - 1
  }
  const last = starts.length - 1
  const firstEdited = lineOf(edit.start - blockStart)
  // A deletion ending at a line start joins that line to the edited one.
  const lastEdited = lineOf(edit.end - blockStart)
  // The lines holding the block's delimiters, which an indented code block
  // lacks, stand for the lines beyond the window.
  const first = arm.opener === '' ? 0 : 1
  const lastContent = arm.closer === '' ? last : last - 1
  if (/\r/u.test(text) || firstEdited < first || lastEdited > lastContent) return undefined
  const lineStart = (line: number): number => blockStart + (starts[line] ?? text.length)
  let before = firstEdited > first ? firstEdited - 1 : undefined
  let after = lastEdited < lastContent ? lastEdited + 1 : undefined
  // Indented code reads a blank line only between lines with text, so its
  // context reaches past blank lines to one.
  if (arm.opener === '') {
    const blank = (line: number): boolean => !/\S/u.test(text.slice(starts[line] ?? text.length, starts[line + 1] ?? text.length))
    while (before !== undefined && before > first && blank(before)) before -= 1
    while (after !== undefined && after < lastContent && blank(after)) after += 1
  }
  const contextStart = lineStart(before ?? firstEdited)
  const contextEnd = lineStart((after ?? lastEdited) + 1)
  const opener = previousSource.slice(blockStart, lineStart(first))
  const closer = previousSource.slice(lineStart(lastContent + 1), blockEnd)
  const previousLines = previousSource.slice(contextStart, contextEnd)
  const nextLines = nextSource.slice(contextStart, contextEnd + delta)
  if (markerSpellings(opener + previousLines + closer) !== 0 || markerSpellings(nextLines) !== 0 ||
      /[{}]/u.test(edit.insert) ||
      // A backtick or dollar run in the arm may pair with one outside it,
      // across the suggestion's markers, which no window of its lines reads.
      /[`$]/u.test(edit.insert + previousSource.slice(Math.max(0, edit.start - 1), edit.end + 1)) ||
      // A blank line in a math block parts the dollar runs read after it.
      (arm.key.startsWith('math-block') && [previousLines, nextLines].some(lines => /(?:^|\n)[ \t]*\n/u.test(lines))) ||
      // A marker on the closer line pairs as the block's lines are read
      // outside a math block too, where a line that starts a block parts
      // them; other blocks read so are left to the windows of the block.
      (arm.marked === true && (!arm.key.startsWith('math-block') || BLOCK_START_LINE.test(nextLines)))) return undefined
  const previousWindow = opener + previousLines + closer
  const nextWindow = opener + nextLines + closer
  const options = Object.freeze({ ...markdownOptions, frontMatter: false })
  const parse = (window: string): Profile1DocumentProducts | undefined => {
    inventory.recorder.recordCandidateRegionParse(window.length)
    const result = parseProfile1Window(window, executionBudget, options, false, physicalRecorder, true, false)
    return result.kind === 'complete' && result.diagnostics.count === 0 &&
      (result.retainedIntrinsic?.markerDecisions.length ?? 1) === 0 && !unpairedLiteralRuns(result, window)
      ? result
      : undefined
  }
  const previousResult = parse(previousWindow)
  const nextResult = parse(nextWindow)
  if (previousResult === undefined || nextResult === undefined) return undefined
  const blockOf = (products: Profile1DocumentProducts) => {
    const root = products.editing().markdown.root
    return root.childCount === 1 ? root.childAt(0) : undefined
  }
  const previousBlock = blockOf(previousResult)
  const nextBlock = blockOf(nextResult)
  if (previousBlock === undefined || nextBlock === undefined ||
      literalBlockReading(previousResult.editing(), previousBlock)?.key !== arm.key ||
      literalBlockReading(nextResult.editing(), nextBlock)?.key !== arm.key ||
      previousBlock.range.start !== 0 || nextBlock.range.start !== 0 ||
      previousBlock.range.end + delta !== nextBlock.range.end ||
      previousResult.editing().source !== previousWindow || nextResult.editing().source !== nextWindow ||
      // The block's text, which its tape reads as one literal run, keeps its
      // start and moves its end with the edit.
      previousBlock.childCount === 0 || nextBlock.childCount === 0 ||
      previousBlock.childAt(0).range.start !== nextBlock.childAt(0).range.start ||
      previousBlock.childAt(previousBlock.childCount - 1).range.end + delta !==
        nextBlock.childAt(nextBlock.childCount - 1).range.end) return undefined
  // The lines around the edited ones read as they did.
  const lineStarts = (products: Profile1DocumentProducts, block: MarkdownNode): number[] => {
    const window = products.editing().source
    const found: number[] = []
    let lineStarted = true
    for (let child = 0; child < block.childCount; child += 1) {
      const node = block.childAt(child)
      if (lineStarted) found.push(markerLineStart(window, node.range.start) ?? -1)
      lineStarted = node.kind === 'soft-break'
    }
    return found
  }
  const editedStart = opener.length + lineStart(firstEdited) - contextStart
  const previousStop = opener.length + lineStart(lastEdited + 1) - contextStart
  const nextStop = previousStop + delta
  const previousStarts = lineStarts(previousResult, previousBlock)
  const nextStarts = lineStarts(nextResult, nextBlock)
  if ((before !== undefined && !nextStarts.includes(opener.length)) || !nextStarts.includes(editedStart) ||
      (after !== undefined && !nextStarts.includes(nextStop)) ||
      !sameArray(previousStarts.filter(start => start < editedStart), nextStarts.filter(start => start < editedStart)) ||
      !sameArray(previousStarts.filter(start => start > previousStop).map(start => start + delta),
        nextStarts.filter(start => start > nextStop))) return undefined
  // A key in the indentation a line's text starts after leaves that start
  // in place, where the leaf's moved offsets would not.
  const editStart = opener.length + edit.start - contextStart
  for (let child = 0; child < previousBlock.childCount; child += 1) {
    const node = previousBlock.childAt(child)
    if (node.range.start < editedStart) continue
    if (node.range.start > editStart) return undefined
    break
  }
  const childrenIn = (block: MarkdownNode, from: number, to: number): number => {
    let count = 0
    for (let child = 0; child < block.childCount; child += 1) {
      const start = block.childAt(child).range.start
      if (start >= from && (start < to || (start === to && block.childAt(child).range.end === to && to === from))) count += 1
    }
    return count
  }
  const childrenBeforeWindow = childrenIn(previousBlock, 0, editedStart)
  const previousChildren = childrenIn(previousBlock, editedStart, previousStop)
  const linesBeforeWindow = previousStarts.filter(start => start < editedStart).length
  const omitted = (before ?? firstEdited) - first
  const linesBefore = arm.before.lines + linesBeforeWindow + omitted
  const childrenBefore = arm.before.children + childrenBeforeWindow + 2 * omitted
  // The suggestion's leaf, moved past the edit; the suggestions holding the
  // block keep their starts.
  const children = arm.children + nextBlock.childCount - previousBlock.childCount
  if (children < ARM_LITERAL_CHILDREN) return undefined
  const nextLeaf = movedLeaf(leaf, armIndex, localStart, localEnd, delta, children)
  if (nextLeaf === undefined) return undefined
  const enclosing = leaf.annotations.nodes
    .filter(node => node.start < localStart && localEnd < node.end)
    .map(node => range(located.sourceStart + node.start, located.sourceStart + node.end))
  const owner = leaf.annotations.nodes[arm.node]
  const ownerArm = owner?.arms.find(candidate => candidate.start <= arm.start && arm.end <= candidate.end)
  if (owner === undefined || ownerArm === undefined) return undefined
  const moved = (position: number): number => position >= localEnd ? position + delta : position
  const windowStart = contextStart - opener.length
  if (previewOnly) {
    return Object.freeze({
      kind: 'validated',
      sourceStart: windowStart,
      nextProducts: nextResult,
      nextWindow,
      literal: Object.freeze({
        lines: Object.freeze({ start: opener.length, end: nextWindow.length - closer.length }),
        opener: blockStart,
        closer: lineStart(last) + delta
      }),
      arm: Object.freeze({
        kind: owner.kind,
        name: ownerArm.name,
        range: range(located.sourceStart + ownerArm.start, located.sourceStart + moved(ownerArm.end)),
        annotation: range(located.sourceStart + owner.start, located.sourceStart + moved(owner.end))
      })
    })
  }
  inventory.recorder.recordRootAttempted()
  const nextRoot = replaceLeaf(inventory.root, located.ordinal, nextLeaf, inventory.recorder)
  const eventSource = located.sourceStart + arm.eventStart
  const eventSyntax = located.syntaxStart + arm.syntaxStart - (arm.start - arm.eventStart)
  const eventLength = arm.eventEnd - arm.eventStart
  const event = located.eventStart + arm.event
  return Object.freeze({
    kind: 'admitted',
    nextInventory: Object.freeze({
      [inventoryBrand]: true as const,
      root: nextRoot,
      accountingUpperBound: inventory.accountingUpperBound,
      logicalNodeLimit: inventory.logicalNodeLimit,
      markerFree: inventory.markerFree,
      strayMarkers: inventory.strayMarkers,
      ...shiftedReferenceFacts(inventory, edit, delta),
      recorder: inventory.recorder,
      ...(inventory.plainRecorder === undefined ? {} : { plainRecorder: inventory.plainRecorder }),
      ...(inventory.splitsLists === true ? { splitsLists: true } : {})
    }),
    previous: Object.freeze({
      source: range(eventSource, eventSource + eventLength),
      syntax: range(eventSyntax, eventSyntax + eventLength),
      events: range(event, event + 1)
    }),
    next: Object.freeze({
      source: range(eventSource, eventSource + eventLength + delta),
      syntax: range(eventSyntax, eventSyntax + eventLength + delta),
      events: range(event, event + 1)
    }),
    nextProducts: nextResult,
    nextWindow,
    commentImpacts: Object.freeze([]),
    literalLines: Object.freeze({
      key: arm.key,
      linesBefore,
      childrenBefore,
      previousLines: lastEdited - firstEdited + 1,
      previousChildren
    }),
    armLines: Object.freeze({
      lines: range(editedStart, nextStop),
      source: lineStart(firstEdited),
      syntax: eventSyntax + lineStart(firstEdited) - eventSource,
      enclosing: Object.freeze(enclosing)
    }),
    strayMarkers: inventory.strayMarkers
  })
}

/** The fewest units of a block's lines worth leaving out of a first key's read. */
const ARM_CREATION_LEFT_OUT = 2048
/** Lines kept around a first key's changed lines, to read them in their block. */
const ARM_CREATION_CONTEXT = 2

/** `source` with `[start, end)` ranges, sorted and apart, left out. */
function sourceWithout(source: CanonicalSourceView, ranges: readonly SourceSpan[]): CanonicalSourceView {
  const removed = ranges.reduce((total, gap) => total + gap.end - gap.start, 0)
  return Object.freeze({
    length: source.length - removed,
    slice: (start: number, end: number): string => {
      let text = ''
      let at = 0
      let cursor = 0
      for (const gap of [...ranges, { start: source.length, end: source.length }]) {
        // `[cursor, gap.start)` of the source is `[at, at + gap.start - cursor)` here.
        const from = Math.max(start, at)
        const to = Math.min(end, at + gap.start - cursor)
        if (from < to) text += source.slice(cursor + from - at, cursor + to - at)
        at += gap.start - cursor
        cursor = gap.end
        if (at >= end) break
      }
      return text
    }
  })
}

/** A position once `lines` are put back (see `LeftOutLines`). */
export const withLinesBack = (lines: readonly LeftOutLines[]) => (position: number): number => {
  let moved = position
  for (const left of lines) if (position >= left.at) moved += left.length
  return moved
}

/**
 * A first tracked key in a long literal block: the block struck and
 * proposed again, the key's lines changed. Its lines read literally, so the
 * edit reads as it does with the lines far from the key left out of both
 * blocks, kept alike in each: that shorter document's inventory holds the
 * block's leaves but those lines', and the edit is evaluated there. The
 * leaves that reads are the edit's own, with the lines put back; the
 * products and spans, which the Markup reply is read from, carry where they
 * go. Undefined leaves the edit to the other windows.
 */
function admitArmCreation(
  inventory: InventoryValue,
  previousSource: CanonicalSourceView,
  nextSource: CanonicalSourceView,
  edit: RetainedPassSourceEdit,
  executionBudget: ExecutionBudgetId,
  markdownOptions: MarkdownOptionsV1,
  physicalRecorder: Profile1PhysicalTraversalRecorderV1,
  previewOnly: boolean
): RegionalInventoryAdmission | RegionalInventoryPreview | undefined {
  if (inventory.strayMarkers || inventory.dependencyPrefixEnd > edit.start || !edit.insert.startsWith('{~~') ||
      !edit.insert.endsWith('~~}') || edit.insert.length < 2 * ARM_CREATION_LEFT_OUT ||
      previousSource.length !== inventory.root.sourceLength) return undefined
  const located = locateBySource(inventory, edit.start)
  const run = literalRunIn(located?.leaf)
  if (located === undefined || run === undefined || !run.first || located.sourceStart !== edit.start) return undefined
  // The struck block is the replaced text, and the proposed one follows the divider.
  const removed = previousSource.slice(edit.start, edit.end)
  const block = removed.replace(/[ \t\r\n]+$/u, '')
  if (/\r/u.test(removed) || !edit.insert.startsWith(`{~~${block}`)) return undefined
  const divider = /^[ \t\n]*~>/u.exec(edit.insert.slice(3 + block.length))
  if (divider === null) return undefined
  const proposedStart = 3 + block.length + divider[0].length
  const proposedRest = edit.insert.slice(proposedStart, -3)
  const proposed = proposedRest.replace(/[ \t\n]+$/u, '')
  if (/\r|~>|~~\}/u.test(proposed)) return undefined
  const struckLines = block.split('\n')
  const proposedLines = proposed.split('\n')
  // The delimiter lines stay; an indented code block has none.
  const first = run.opener === '' ? 0 : 1
  const struckLast = run.closer === '' ? struckLines.length - 1 : struckLines.length - 2
  const proposedLast = run.closer === '' ? proposedLines.length - 1 : proposedLines.length - 2
  let prefix = 0
  while (prefix < Math.min(struckLines.length, proposedLines.length) && struckLines[prefix] === proposedLines[prefix]) prefix += 1
  let suffix = 0
  while (suffix < Math.min(struckLines.length, proposedLines.length) - prefix &&
    struckLines[struckLines.length - 1 - suffix] === proposedLines[proposedLines.length - 1 - suffix]) suffix += 1
  // Lines `(first, before)` and `(after, last)` of each block are left out:
  // the first and last of its lines stay, so the block's text starts and
  // ends where it does.
  const before = prefix - ARM_CREATION_CONTEXT
  const struckAfter = struckLines.length - suffix + ARM_CREATION_CONTEXT - 1
  const proposedAfter = proposedLines.length - suffix + ARM_CREATION_CONTEXT - 1
  const lineStarts = (lines: readonly string[]): number[] => {
    const starts = [0]
    for (const line of lines) starts.push((starts.at(-1) ?? 0) + line.length + 1)
    return starts
  }
  const struckStarts = lineStarts(struckLines)
  const proposedStarts = lineStarts(proposedLines)
  const leftOut = (starts: readonly number[], after: number, last: number): SourceSpan[] => {
    const spans: SourceSpan[] = []
    if (before > first + 1) spans.push({ start: starts[first + 1] ?? 0, end: starts[before] ?? 0 })
    if (last > after + 1) spans.push({ start: starts[after + 1] ?? 0, end: starts[last] ?? 0 })
    return spans
  }
  const struckOut = leftOut(struckStarts, struckAfter, struckLast)
  const proposedOut = leftOut(proposedStarts, proposedAfter, proposedLast)
  const struckText = struckOut.map(span => block.slice(span.start, span.end))
  if (struckOut.length !== proposedOut.length ||
      proposedOut.some((span, index) => proposed.slice(span.start, span.end) !== struckText[index])) return undefined
  const leftOutUnits = struckText.reduce((total, text) => total + text.length, 0)
  if (leftOutUnits < ARM_CREATION_LEFT_OUT) return undefined
  // The lines left out read as text alone: no tab or line of spaces, and
  // for indented code each line indented as a code line or empty.
  const kind = run.key.slice(0, run.key.indexOf('['))
  if (struckText.some(text => /\t|(?:^|\n) +(?:\n|$)/u.test(text) ||
      (run.opener === '' && text.split('\n').some(line => line !== '' && !/^ {4}/u.test(line))) ||
      (kind === 'math-block' && text.split('\n').some(line => /^[ \t]/u.test(line))))) return undefined
  const previousOut = struckOut.map(span => ({ start: edit.start + span.start, end: edit.start + span.end }))
  const shortPrevious = sourceWithout(previousSource, previousOut)
  // The block's leaves without the lines: each line of a long literal block
  // is a leaf of its own, so those lines' leaves are left out.
  const leaves = leavesOf(inventory.root)
  const extent = literalExtentOrdinals(leaves, located.ordinal, located.ordinal)
  if (extent === undefined || extent.first !== located.ordinal) return undefined
  const kept: RegionLeaf[] = leaves.slice(0, extent.first)
  let leafStart = located.sourceStart
  let covered = 0
  for (let ordinal = extent.first; ordinal <= extent.last; ordinal += 1) {
    const leaf = leaves[ordinal]
    if (leaf === undefined) return undefined
    const leafEnd = leafStart + leaf.sourceLength
    const out = previousOut.find(span => span.start <= leafStart && leafStart < span.end)
    if (out === undefined) kept.push(leaf)
    else if (leafEnd > out.end) return undefined
    else covered += leaf.sourceLength
    leafStart = leafEnd
  }
  if (covered !== leftOutUnits) return undefined
  kept.push(...leaves.slice(extent.last + 1))
  const shortInventory: RegionalInventory = Object.freeze({
    ...inventory,
    root: buildTree(kept, 0, kept.length, inventory.recorder)
  })
  const insertOut = [
    ...struckOut.map(span => ({ start: 3 + span.start, end: 3 + span.end })),
    ...proposedOut.map(span => ({ start: proposedStart + span.start, end: proposedStart + span.end }))
  ]
  const insertText: CanonicalSourceView = Object.freeze({
    length: edit.insert.length,
    slice: (start: number, end: number) => edit.insert.slice(start, end)
  })
  const shortInsert = sourceWithout(insertText, insertOut)
  const shortEdit = Object.freeze({
    start: edit.start,
    end: edit.end - leftOutUnits,
    insert: shortInsert.slice(0, shortInsert.length)
  })
  const nextOut = insertOut.map(span => ({ start: edit.start + span.start, end: edit.start + span.end }))
  const shortNext = sourceWithout(nextSource, nextOut)
  const result: RegionalInventoryApplyResult | RegionalInventoryPreviewResult = previewOnly
    ? evaluateRegionalInventory(shortInventory, shortPrevious, shortNext, [shortEdit], [], executionBudget,
      markdownOptions, physicalRecorder, true)
    : evaluateRegionalInventory(shortInventory, shortPrevious, shortNext, [shortEdit], [], executionBudget,
      markdownOptions, physicalRecorder, false)
  if (result.kind !== 'validated' && result.kind !== 'admitted') return undefined
  // The edit reads as one Substitution of the two blocks.
  const windowStart = result.kind === 'validated' ? result.sourceStart : result.window?.source ?? result.next.source.start
  if (!(result.nextProducts.retainedIntrinsic?.roots ?? []).some(node => node.kind === 'substitution' &&
      node.range.start === shortEdit.start - windowStart && node.range.end === shortEdit.start + shortEdit.insert.length - windowStart &&
      node.arms.every(arm => arm.children.length === 0))) return undefined
  if (result.kind === 'validated') return Object.freeze({ ...result, armCreation: true as const })
  if (result.armLines !== undefined || result.literalLines !== undefined ||
      result.listItems !== undefined || result.armCreation !== undefined) return undefined
  // Where the lines go back: in the previous source, after the edit's start;
  // in the next, inside each of the two blocks.
  const back = (spans: readonly SourceSpan[], texts: readonly string[], base: number): LeftOutLines[] => {
    let removedBefore = 0
    return spans.map((span, index) => {
      const lines = Object.freeze({
        at: base + span.start - removedBefore,
        length: span.end - span.start,
        text: texts[index] ?? ''
      })
      removedBefore += span.end - span.start
      return lines
    })
  }
  const previousLines = back(struckOut, struckText, edit.start)
  const nextLines = back(insertOut, [...struckText, ...struckText], edit.start)
  const toNext = withLinesBack(nextLines)
  // The leaves the edit read, with the lines put back in their blocks.
  const value = inventoryValue(result.nextInventory)
  let root = value.root
  let held = locateBySource(value, result.next.source.start)
  while (held !== undefined && held.sourceStart < result.next.source.end) {
    const leafStart = held.sourceStart
    const leafEnd = leafStart + held.leaf.sourceLength
    const inside = nextLines.filter(lines => leafStart < lines.at && lines.at < leafEnd)
    if (inside.length > 0) {
      if (held.leaf.kind !== 'region') return undefined
      const expanded = leafWithLinesBack(held.leaf, inside.map(lines => ({ ...lines, at: lines.at - leafStart })))
      if (expanded === undefined) return undefined
      root = replaceLeaf(root, held.ordinal, expanded, value.recorder)
    }
    if (leafEnd >= value.root.sourceLength) break
    held = locateBySource(value, leafEnd)
  }
  const previousRoot = inventory.root
  const shortRoot = inventoryValue(shortInventory).root
  return Object.freeze({
    ...result,
    nextInventory: Object.freeze({ ...value, root }),
    previous: Object.freeze({
      source: range(result.previous.source.start, result.previous.source.end + leftOutUnits),
      syntax: range(result.previous.syntax.start,
        result.previous.syntax.end + previousRoot.syntaxLength - shortRoot.syntaxLength),
      events: range(result.previous.events.start,
        result.previous.events.end + previousRoot.eventCount - shortRoot.eventCount)
    }),
    next: Object.freeze({
      source: range(result.next.source.start, toNext(result.next.source.end)),
      syntax: range(result.next.syntax.start, result.next.syntax.end + 2 * leftOutUnits),
      events: result.next.events
    }),
    armCreation: Object.freeze({
      previous: Object.freeze({ span: result.previous, lines: Object.freeze(previousLines) }),
      next: Object.freeze({ span: result.next, lines: Object.freeze(nextLines) })
    })
  })
}

/**
 * `leaf` with literal lines put back at leaf offsets `lines`: its offsets
 * past them move, and the arm literals holding them gain their children.
 * The leaf reads every block of `products`' projection that it holds, whose
 * source and projection offsets differ by the elided markers before them.
 */
function leafWithLinesBack(
  leaf: MeasuredRegionLeaf,
  lines: readonly LeftOutLines[],
): MeasuredRegionLeaf | undefined {
  const source = withLinesBack(lines)
  // Each point's projection offset, in the leaf: the lines go back inside
  // arm literals, whose text the projection spells as the source does.
  const syntaxLines: LeftOutLines[] = []
  for (const left of lines) {
    const arm = (leaf.armLiterals ?? []).find(candidate => candidate.start <= left.at && left.at <= candidate.end)
    if (arm === undefined) return undefined
    syntaxLines.push(Object.freeze({ ...left, at: arm.syntaxStart + left.at - arm.start }))
  }
  const syntax = withLinesBack(syntaxLines)
  const total = lines.reduce((sum, left) => sum + left.length, 0)
  const breaks = (text: string): number => text.split('\n').length - 1
  return Object.freeze({
    ...leaf,
    sourceLength: leaf.sourceLength + total,
    syntaxLength: leaf.syntaxLength + total,
    annotations: Object.freeze({
      roots: leaf.annotations.roots,
      nodes: Object.freeze(leaf.annotations.nodes.map(node => Object.freeze({
        ...node,
        start: source(node.start),
        end: source(node.end),
        arms: Object.freeze(node.arms.map(arm => Object.freeze({ ...arm, start: source(arm.start), end: source(arm.end) })))
      })))
    }),
    markers: Object.freeze(leaf.markers.map(marker => Object.freeze({ ...marker, start: source(marker.start), end: source(marker.end) }))),
    diagnostics: Object.freeze(leaf.diagnostics.map(diagnostic =>
      Object.freeze({ ...diagnostic, start: source(diagnostic.start), end: source(diagnostic.end) }))),
    markdownPositions: Object.freeze(leaf.markdownPositions.map(syntax)),
    ...(leaf.armLiterals === undefined
      ? {}
      : {
        armLiterals: Object.freeze(leaf.armLiterals.map(arm => {
          const own = lines.filter(left => arm.start <= left.at && left.at <= arm.end)
          const earlier = lines.filter(left => left.at < arm.start)
          const ownLines = own.reduce((sum, left) => sum + breaks(left.text), 0)
          const earlierLines = arm.block === arm.syntaxStart ? 0 : earlier.reduce((sum, left) => sum + breaks(left.text), 0)
          return Object.freeze({
            ...arm,
            start: source(arm.start),
            end: source(arm.end),
            syntaxStart: syntax(arm.syntaxStart),
            block: syntax(arm.block),
            eventStart: source(arm.eventStart),
            eventEnd: source(arm.eventEnd),
            before: earlierLines === 0
              ? arm.before
              : Object.freeze({ lines: arm.before.lines + earlierLines, children: arm.before.children + 2 * earlierLines }),
            children: arm.children + 2 * ownLines
          })
        }))
      })
  })
}

/**
 * `leaf` with an edit of `[start, end)` inside arm literal `armIndex`'s
 * lines, which reads only those lines anew: every offset at or after the
 * edit's end moves by `delta`, every one at or before its start stays.
 */
function movedLeaf(
  leaf: MeasuredRegionLeaf,
  armIndex: number,
  start: number,
  end: number,
  delta: number,
  children: number
): MeasuredRegionLeaf | undefined {
  const arm = leaf.armLiterals?.[armIndex]
  if (arm === undefined) return undefined
  const syntaxShift = arm.syntaxStart - arm.start
  let inside = false
  const moved = (position: number): number => {
    if (position <= start) return position
    if (position >= end) return position + delta
    inside = true
    return position
  }
  const movedSyntax = (position: number): number => {
    if (position <= start + syntaxShift) return position
    if (position >= end + syntaxShift) return position + delta
    inside = true
    return position
  }
  const next: MeasuredRegionLeaf = Object.freeze({
    ...leaf,
    sourceLength: leaf.sourceLength + delta,
    syntaxLength: leaf.syntaxLength + delta,
    annotations: Object.freeze({
      roots: leaf.annotations.roots,
      nodes: Object.freeze(leaf.annotations.nodes.map(node => Object.freeze({
        ...node,
        start: moved(node.start),
        end: moved(node.end),
        arms: Object.freeze(node.arms.map(candidate => Object.freeze({
          ...candidate,
          start: moved(candidate.start),
          end: moved(candidate.end)
        })))
      })))
    }),
    markers: Object.freeze(leaf.markers.map(marker => Object.freeze({ ...marker, start: moved(marker.start), end: moved(marker.end) }))),
    diagnostics: Object.freeze(leaf.diagnostics.map(diagnostic =>
      Object.freeze({ ...diagnostic, start: moved(diagnostic.start), end: moved(diagnostic.end) }))),
    markdownPositions: Object.freeze(leaf.markdownPositions.map(movedSyntax)),
    armLiterals: Object.freeze((leaf.armLiterals ?? []).map((candidate, index) => Object.freeze({
      ...candidate,
      start: index === armIndex ? candidate.start : moved(candidate.start),
      end: index === armIndex ? candidate.end + delta : moved(candidate.end),
      syntaxStart: index === armIndex ? candidate.syntaxStart : movedSyntax(candidate.syntaxStart),
      eventStart: index === armIndex ? candidate.eventStart : moved(candidate.eventStart),
      eventEnd: index === armIndex ? candidate.eventEnd + delta : moved(candidate.eventEnd),
      block: index === armIndex ? candidate.block : movedSyntax(candidate.block),
      // Later arms' lines in the same indented code block follow the edited ones.
      before: candidate.block === arm.block && candidate.start > arm.start
        ? Object.freeze({
          lines: candidate.before.lines + (children - arm.children) / 2,
          children: candidate.before.children + children - arm.children
        })
        : candidate.before,
      children: index === armIndex ? children : candidate.children
    })))
  })
  return inside ? undefined : next
}

/**
 * An edit of lines of one split literal block, parsed in a window made of
 * the edited lines, a line of context on each side, and the block's opener
 * and closer standing for the lines beyond: its lines read literally, so
 * that window reads them as the whole block does. The window is parsed with
 * the edit and without it; the block must read as one block of the same
 * kind and delimiters in both, with the same lines around the edited ones,
 * and the edited lines' bounds must be its line starts. Undefined leaves
 * the edit to the block window, which then reads the whole block.
 */
function admitLiteralLines(
  inventory: InventoryValue,
  previousSource: CanonicalSourceView,
  nextSource: CanonicalSourceView,
  edit: RetainedPassSourceEdit,
  edited: WindowEdge,
  editedEnd: WindowEdge,
  executionBudget: ExecutionBudgetId,
  markdownOptions: MarkdownOptionsV1,
  physicalRecorder: Profile1PhysicalTraversalRecorderV1,
  previewOnly: boolean
): RegionalInventoryAdmission | RegionalInventoryPreview | undefined {
  const firstRun = literalRunIn(edited.leaf)
  const lastRun = literalRunIn(editedEnd.leaf)
  if (firstRun === undefined || lastRun === undefined || inventory.strayMarkers ||
      edited.local !== 0 || editedEnd.local !== editedEnd.leaf.sourceLength) return undefined
  const leaves = leavesOf(inventory.root)
  const extent = literalExtentOrdinals(leaves, edited.ordinal, editedEnd.ordinal)
  if (extent === undefined) return undefined
  const length = previousSource.length
  const delta = nextSource.length - length
  // The block stays apart from the next one by one empty line.
  if (lastRun.last && editedEnd.source < length && !oneEmptyLineBefore(nextSource, editedEnd.source + delta)) return undefined
  const before = firstRun.first ? undefined : windowEdge(inventory, edited.source - 1, 'start')
  const after = lastRun.last ? undefined : windowEdge(inventory, editedEnd.source, 'end')
  const beforeRun = literalRunIn(before?.leaf)
  const afterRun = literalRunIn(after?.leaf)
  if ((before !== undefined && (beforeRun?.key !== extent.key || before.ordinal !== edited.ordinal - 1)) ||
      (after !== undefined && (afterRun?.key !== extent.key || after.ordinal !== editedEnd.ordinal + 1))) return undefined
  // The opener and closer stand for the lines beyond the context lines.
  const prefix = before === undefined || beforeRun?.first === true ? '' : firstRun.opener
  const suffix = after === undefined || afterRun?.last === true ? '' : firstRun.closer.replace(/^(?:\r\n|\r|\n)/u, '')
  const contextStart = before?.source ?? edited.source
  const contextEnd = after?.source ?? editedEnd.source
  const previousLines = previousSource.slice(contextStart, contextEnd)
  const nextLines = nextSource.slice(contextStart, contextEnd + delta)
  // Marker spellings pair with any in the document; a line holds none of
  // them, and no spelling crosses a line break.
  if (/\r/u.test(previousLines + nextLines + prefix + suffix) ||
      markerSpellings(previousLines) !== 0 || markerSpellings(nextLines) !== 0) return undefined
  const previousWindow = prefix + previousLines + suffix
  const nextWindow = prefix + nextLines + suffix
  const windowStart = contextStart - prefix.length
  const options = windowStart === 0 ? markdownOptions : Object.freeze({ ...markdownOptions, frontMatter: false })
  const hasRoots = rootCountIn(inventory.root) > 0
  const parse = (window: string, atEnd: boolean): Profile1DocumentProducts | undefined => {
    inventory.recorder.recordCandidateRegionParse(window.length)
    const result = parseProfile1Window(window, executionBudget, options, false, physicalRecorder, atEnd, hasRoots)
    // The window's one block is the literal block, split as it is in place.
    if (result.kind === 'complete') windowsBeforeDocumentEnd.delete(result)
    return result.kind === 'complete' && result.diagnostics.count === 0 &&
      (result.retainedIntrinsic?.markerDecisions.length ?? 1) === 0
      ? result
      : undefined
  }
  const previousResult = parse(previousWindow, suffix === '' && contextEnd === length)
  const nextResult = parse(nextWindow, suffix === '' && contextEnd + delta === nextSource.length)
  if (previousResult === undefined || nextResult === undefined) return undefined
  const blockOf = (products: Profile1DocumentProducts) => {
    const root = products.editing().markdown.root
    return root.childCount === 1 ? root.childAt(0) : undefined
  }
  const previousBlock = blockOf(previousResult)
  const nextBlock = blockOf(nextResult)
  if (previousBlock === undefined || nextBlock === undefined ||
      literalBlockReading(previousResult.editing(), previousBlock)?.key !== extent.key ||
      literalBlockReading(nextResult.editing(), nextBlock)?.key !== extent.key ||
      previousBlock.range.start !== nextBlock.range.start ||
      previousBlock.range.end + delta !== nextBlock.range.end) return undefined
  // The lines around the edited ones read as they did; the window is all
  // canonical text, so its projection offsets are its source offsets.
  const lineStarts = (products: Profile1DocumentProducts, block: MarkdownNode): number[] => {
    const text = products.editing().source
    const starts: number[] = []
    let lineStart = true
    for (let child = 0; child < block.childCount; child += 1) {
      const node = block.childAt(child)
      if (lineStart) starts.push(markerLineStart(text, node.range.start) ?? -1)
      lineStart = node.kind === 'soft-break'
    }
    return starts
  }
  const editedStart = prefix.length + edited.source - contextStart
  const previousStop = prefix.length + editedEnd.source - contextStart
  const nextStop = previousStop + delta
  const previousStarts = lineStarts(previousResult, previousBlock)
  const nextStarts = lineStarts(nextResult, nextBlock)
  // The context lines are lines of the block in the window, as they are
  // in place: a blank line ending the window may read as no line at all.
  if ((before !== undefined && !nextStarts.includes(editedStart)) || (after !== undefined && !nextStarts.includes(nextStop))) return undefined
  if (!sameArray(previousStarts.filter(start => start < editedStart), nextStarts.filter(start => start < editedStart)) ||
      !sameArray(previousStarts.filter(start => start > previousStop).map(start => start + delta),
        nextStarts.filter(start => start > nextStop))) return undefined
  const facts = blockWindowFacts(nextResult, nextWindow, inventory.recorder, false, true)
  if (facts === undefined) return undefined
  const { boundaries, syntaxBoundaries } = facts
  const from = boundaries.indexOf(editedStart)
  const to = boundaries.indexOf(nextStop)
  if (from < 0 || to <= from || syntaxBoundaries[from] !== editedStart) return undefined
  const nextSplit = listSplitOf(nextResult, nextWindow.length)
  const replacement: MeasuredRegionLeaf[] = []
  for (let block = from; block < to; block += 1) {
    const leaf = createLeaf(nextResult, boundaries[block] ?? 0, boundaries[block + 1] ?? 0,
      syntaxBoundaries[block] ?? 0, syntaxBoundaries[block + 1] ?? 0, facts.eventCounts[block] ?? 0, nextSplit)
    // The block keeps being read line by line: a block no longer split
    // loses the leaf bounds around it that only its split gave.
    if (leaf.literalRun?.key !== extent.key) return undefined
    replacement.push(leaf)
  }
  // The window's block starts and ends where the block does only when the
  // edited lines hold its first or last line.
  const firstLeaf = replacement[0]
  const lastLeaf = replacement.at(-1)
  if (firstLeaf?.literalRun !== undefined && firstLeaf.literalRun.first !== (before === undefined)) return undefined
  if (lastLeaf?.literalRun !== undefined && lastLeaf.literalRun.last !== (after === undefined)) return undefined
  if (replacement.slice(1).some(leaf => leaf.literalRun?.first === true) ||
      replacement.slice(0, -1).some(leaf => leaf.literalRun?.last === true)) return undefined
  const candidateAccountingUnits = nextResult.accountingCounts.reduce((total, count) => total + count, 0)
  if (inventory.accountingUpperBound + candidateAccountingUnits > inventory.logicalNodeLimit) return undefined
  if (previewOnly) {
    // The opener and closer this window reads, where the document spells them.
    const locate = (ordinal: number, text: string, fromEnd: boolean): number | undefined => {
      let source = edited.source
      if (ordinal < edited.ordinal) for (let leaf = ordinal; leaf < edited.ordinal; leaf += 1) source -= leaves[leaf]?.sourceLength ?? 0
      else for (let leaf = edited.ordinal; leaf < ordinal; leaf += 1) source += leaves[leaf]?.sourceLength ?? 0
      const leafText = previousSource.slice(source, source + (leaves[ordinal]?.sourceLength ?? 0))
      const at = fromEnd ? leafText.lastIndexOf(text) : leafText.indexOf(text)
      return at < 0 ? undefined : source + at
    }
    const opener = prefix === '' ? windowStart : locate(extent.first, prefix, false)
    const closer = suffix === '' ? contextEnd : locate(extent.last, suffix, true)
    if (opener === undefined || closer === undefined) return undefined
    return Object.freeze({
      kind: 'validated',
      sourceStart: windowStart,
      nextProducts: nextResult,
      nextWindow,
      literal: Object.freeze({
        lines: Object.freeze({ start: prefix.length, end: nextWindow.length - suffix.length }),
        opener,
        closer
      })
    })
  }
  let linesBefore = 0
  let childrenBefore = 0
  for (let ordinal = extent.first; ordinal < edited.ordinal; ordinal += 1) {
    linesBefore += literalRunIn(leaves[ordinal])?.lines ?? 0
    childrenBefore += literalRunIn(leaves[ordinal])?.children ?? 0
  }
  let replacedLines = 0
  let replacedChildren = 0
  for (let ordinal = edited.ordinal; ordinal <= editedEnd.ordinal; ordinal += 1) {
    replacedLines += literalRunIn(leaves[ordinal])?.lines ?? 0
    replacedChildren += literalRunIn(leaves[ordinal])?.children ?? 0
  }
  inventory.recorder.recordRootAttempted()
  const nextLeaves = [...leaves]
  nextLeaves.splice(edited.ordinal, editedEnd.ordinal - edited.ordinal + 1, ...replacement)
  const nextRoot = replacement.length === 1 && edited.ordinal === editedEnd.ordinal && replacement[0] !== undefined
    ? replaceLeaf(inventory.root, edited.ordinal, replacement[0], inventory.recorder)
    : buildTree(nextLeaves, 0, nextLeaves.length, inventory.recorder)
  const counts = facts.eventCounts.slice(from, to)
  const eventTotal = counts.reduce((total, count) => total + count, 0)
  const syntaxStart = syntaxBoundaries[from] ?? 0
  const syntaxEnd = syntaxBoundaries[to] ?? 0
  const contextSyntax = before?.syntax ?? edited.syntax
  return Object.freeze({
    kind: 'admitted',
    nextInventory: Object.freeze({
      [inventoryBrand]: true as const,
      root: nextRoot,
      accountingUpperBound: inventory.accountingUpperBound + candidateAccountingUnits,
      logicalNodeLimit: inventory.logicalNodeLimit,
      markerFree: inventory.markerFree,
      strayMarkers: inventory.strayMarkers,
      ...shiftedReferenceFacts(inventory, edit, delta),
      recorder: inventory.recorder,
      ...(inventory.plainRecorder === undefined ? {} : { plainRecorder: inventory.plainRecorder }),
      ...(inventory.splitsLists === true ? { splitsLists: true } : {})
    }),
    previous: Object.freeze({
      source: range(edited.source, editedEnd.source),
      syntax: range(edited.syntax, editedEnd.syntax),
      events: range(edited.event, editedEnd.event)
    }),
    next: Object.freeze({
      source: range(edited.source, edited.source + nextStop - editedStart),
      syntax: range(edited.syntax, edited.syntax + syntaxEnd - syntaxStart),
      events: range(edited.event, edited.event + eventTotal)
    }),
    nextProducts: nextResult,
    nextWindow,
    window: Object.freeze({
      source: windowStart,
      syntax: contextSyntax - prefix.length,
      blocks: Object.freeze({
        source: range(editedStart, nextStop),
        syntax: range(syntaxStart, syntaxEnd)
      })
    }),
    commentImpacts: Object.freeze([]),
    literalLines: Object.freeze({
      key: extent.key,
      linesBefore,
      childrenBefore,
      previousLines: replacedLines,
      previousChildren: replacedChildren
    }),
    strayMarkers: inventory.strayMarkers
  })
}

/** Whether a leaf beside leaf `ordinal` holds a list's items. */
function listBeside(inventory: InventoryValue, ordinal: number): boolean {
  const beside = leafRange(inventory.root, Math.max(0, ordinal - 1), ordinal + 1)
  return beside.some(({ leaf }) => leaf.kind === 'region' && leaf.listRun !== undefined)
}

/** A block window's edited items change their list as a whole. */
const WHOLE_LIST = Symbol('whole list')

/** The edges of the list whose items leaves `from` to `to` hold, when they hold items of one. */
function listExtent(
  inventory: InventoryValue,
  from: number,
  to: number
): Readonly<{ start: WindowEdge, end: WindowEdge }> | undefined {
  const leaves = leavesOf(inventory.root)
  let firstOrdinal = from
  while (true) {
    const leaf = leaves[firstOrdinal]
    if (leaf?.kind !== 'region' || leaf.listRun === undefined) return undefined
    if (leaf.listRun.first) break
    firstOrdinal -= 1
  }
  let lastOrdinal = to
  while (true) {
    const leaf = leaves[lastOrdinal]
    if (leaf?.kind !== 'region' || leaf.listRun === undefined) return undefined
    if (leaf.listRun.last) break
    lastOrdinal += 1
  }
  let startSource = 0
  for (let ordinal = 0; ordinal < firstOrdinal; ordinal += 1) startSource += leaves[ordinal]?.sourceLength ?? 0
  let endSource = startSource
  for (let ordinal = firstOrdinal; ordinal <= lastOrdinal; ordinal += 1) endSource += leaves[ordinal]?.sourceLength ?? 0
  const start = windowEdge(inventory, startSource, 'start')
  const end = windowEdge(inventory, endSource - 1, 'end')
  return start === undefined || end === undefined || start.ordinal !== firstOrdinal || end.ordinal !== lastOrdinal
    ? undefined
    : Object.freeze({ start, end })
}

/**
 * Whether the leaf blocks before `[previousStart, previousEnd)` in the window
 * before an edit, and after it, are those before `[nextStart, nextEnd)` and
 * after it in the window after the edit, at the same offsets from the edited
 * blocks. An item also keeps whether it continues the list of the block
 * before it.
 */
function contextBlocksUnchanged(
  previous: Profile1DocumentProducts,
  previousSplit: ListSplit,
  next: Profile1DocumentProducts,
  nextSplit: ListSplit,
  previousStart: number,
  nextStart: number,
  previousEnd: number,
  nextEnd: number
): boolean {
  const blocks = (products: Profile1DocumentProducts, split: ListSplit, keep: (start: number) => boolean, shift: number): string[] => {
    const result: string[] = []
    let before: LeafBlock | undefined
    for (const block of leafBlocksOf(products, split)) {
      const { node } = block
      if (keep(node.range.start)) {
        const continues = block.list !== undefined && before?.list === block.list
        result.push(`${node.kind}:${node.range.start - shift}:${node.range.end - shift}:${String(continues)}`)
      }
      before = block
    }
    return result
  }
  return sameArray(
    blocks(previous, previousSplit, start => start < previousStart, 0),
    blocks(next, nextSplit, start => start < nextStart, 0)
  ) && sameArray(
    blocks(previous, previousSplit, start => start >= previousEnd && start > previousStart, previousEnd),
    blocks(next, nextSplit, start => start >= nextEnd && start > nextStart, nextEnd)
  )
}

/**
 * How the edited blocks of a window sit: as whole top-level blocks (any list
 * among them wholly edited), or as items of one list that keeps items
 * outside them, which a replacement then edits in place.
 */
type EditedShape =
  | Readonly<{ kind: 'blocks' }>
  | Readonly<{ kind: 'items', list: MarkdownNode, firstItem: number, items: number }>

function editedShapeOf(blocks: readonly LeafBlock[], start: number, end: number): EditedShape | undefined {
  const inRange = (block: LeafBlock): boolean => block.node.range.start >= start && block.node.range.start < end
  const edited = blocks.filter(inRange)
  const first = edited[0]
  if (first === undefined) return undefined
  const list = first.list
  const keepsOthers = (candidate: MarkdownNode): boolean =>
    blocks.some(block => block.list === candidate && !inRange(block))
  if (list !== undefined && first.item !== undefined && keepsOthers(list)) {
    return edited.every(block => block.list === list)
      ? Object.freeze({ kind: 'items', list, firstItem: first.item, items: edited.length })
      : undefined
  }
  return edited.every(block => block.list === undefined || !keepsOthers(block.list))
    ? Object.freeze({ kind: 'blocks' })
    : undefined
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
  previousWindowLength: number,
  pairingChanged: boolean
): RegionalInventoryApplyResult | RegionalInventoryPreviewResult | typeof WHOLE_LIST | undefined {
  // Labels read alike in the window and in place (checked by the caller).
  const facts = blockWindowFacts(result, nextWindow, inventory.recorder, inventory.strayMarkers, true)
  if (facts === undefined) return undefined
  if (markersProvable && !inventory.markerFree && !inventory.strayMarkers &&
      !spellingsDecided(result, nextWindow)) return undefined
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
  const previousSplit = listSplitOf(previousResult, previousWindowLength, !inventory.strayMarkers)
  const nextSplit = listSplitOf(result, nextWindow.length, !inventory.strayMarkers)
  // A list item's edit that changes an item beside it changes its list.
  const touchesList = [first, edited, editedEnd, last].some(edge => edge.leaf.kind === 'region' && edge.leaf.listRun !== undefined)
  if (!contextBlocksUnchanged(
    previousResult, previousSplit, result, nextSplit,
    edited.syntax - first.syntax, syntaxBoundaries[from] ?? 0,
    editedEnd.syntax - first.syntax, syntaxBoundaries[to] ?? 0
  )) return touchesList ? WHOLE_LIST : undefined
  // A literal block's lines are replaced with the whole block here: one the
  // replaced blocks share with a context block reads past them.
  const wholeLiterals = (blocks: readonly LeafBlock[], start: number, end: number): boolean => blocks.every(block =>
    block.literal === undefined || (block.node.range.start >= start && block.node.range.start < end) ===
      (block.literal.range.start >= start && block.literal.range.start < end))
  if (!wholeLiterals(leafBlocksOf(previousResult, previousSplit), edited.syntax - first.syntax, editedEnd.syntax - first.syntax) ||
      !wholeLiterals(leafBlocksOf(result, nextSplit), syntaxBoundaries[from] ?? 0, syntaxBoundaries[to] ?? 0)) return undefined
  const previousShape = editedShapeOf(leafBlocksOf(previousResult, previousSplit),
    edited.syntax - first.syntax, editedEnd.syntax - first.syntax)
  const nextShape = editedShapeOf(leafBlocksOf(result, nextSplit), syntaxBoundaries[from] ?? 0, syntaxBoundaries[to] ?? 0)
  const editedLeaves = leafRange(inventory.root, edited.ordinal, editedEnd.ordinal)
  const firstRun = editedLeaves[0]?.leaf.kind === 'region' ? editedLeaves[0].leaf.listRun : undefined
  const lastLeaf = editedLeaves[editedLeaves.length - 1]?.leaf
  const lastRun = lastLeaf?.kind === 'region' ? lastLeaf.listRun : undefined
  if (previousShape === undefined || nextShape === undefined || previousShape.kind !== nextShape.kind) {
    return previousShape?.kind === 'items' ? WHOLE_LIST : undefined
  }
  let listKey: string | undefined
  if (previousShape.kind === 'items' && nextShape.kind === 'items') {
    // Items change in place: the list keeps its extent and its reading.
    const key = firstRun?.key
    if (key === undefined || editedLeaves.some(({ leaf }) => leaf.kind !== 'region' || leaf.listRun?.key !== key)) return undefined
    const itemsAfter = (shape: typeof nextShape): number => shape.list.childCount - shape.firstItem - shape.items
    if (previousShape.firstItem !== nextShape.firstItem || itemsAfter(previousShape) !== itemsAfter(nextShape) ||
        (previousShape.firstItem === 0) !== firstRun?.first || (itemsAfter(previousShape) === 0) !== lastRun?.last) return WHOLE_LIST
    const fields = listKeyFields(key)
    const before = listKeyFields(listKeyOf(previousShape.list))
    const after = listKeyFields(listKeyOf(nextShape.list))
    // The window's items decide the list's looseness and task reading when
    // they gain one; losing one leaves them to items outside the window.
    if (after.ordered !== fields.ordered || after.delimiter !== fields.delimiter ||
        (fields.tight ? !after.tight : after.tight && !before.tight) ||
        (fields.taskList ? !after.taskList && before.taskList : after.taskList) ||
        (firstRun.first && after.start !== before.start)) return WHOLE_LIST
    // A key planned against the window reads the list as the window does.
    if (previewOnly && (after.tight !== fields.tight || after.taskList !== fields.taskList)) return undefined
    listKey = key
  } else if ((firstRun !== undefined && !firstRun.first) || (lastRun !== undefined && !lastRun.last)) {
    return undefined
  }
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
  let replacedBlocks = 0
  for (const { node: block } of leafBlocksOf(result, nextSplit)) {
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
      ...(first.source === edited.source && edited.source > 0 ? { cleanStart: true as const } : {}),
      ...(last.source === editedEnd.source && editedEnd.source < inventory.root.sourceLength ? { cleanEnd: true as const } : {}),
      structural: Object.freeze({
        touchesAnnotation,
        markerDelta: (result.retainedIntrinsic?.markerDecisions.length ?? 0) - previousMarkers
      })
    })
  }
  let listItems: RegionalInventoryAdmission['listItems']
  if (listKey !== undefined && previousShape.kind === 'items' && nextShape.kind === 'items') {
    let itemsBefore = 0
    if (firstRun?.first !== true) {
      const leaves = leavesOf(inventory.root)
      for (let ordinal = edited.ordinal - 1; ; ordinal -= 1) {
        const leaf = leaves[ordinal]
        if (leaf?.kind !== 'region' || leaf.listRun?.key !== listKey) return undefined
        itemsBefore += leaf.listRun.items
        if (leaf.listRun.first) break
      }
    }
    listItems = Object.freeze({
      key: listKey,
      itemsBefore,
      previousItems: previousShape.items,
      nextItems: nextShape.items
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
  const plainBlocks = retained !== undefined && nextShape.kind === 'blocks' &&
    leafBlocksOf(result, nextSplit).every(block => block.list === undefined ||
      block.node.range.start < (syntaxBoundaries[from] ?? 0) || block.node.range.start >= (syntaxBoundaries[to] ?? 0)) &&
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
        counts[block] ?? 0,
        nextSplit,
        listKey
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
      ...(plainRecorder === undefined ? {} : { plainRecorder }),
      ...(inventory.splitsLists === true || listKey !== undefined ? { splitsLists: true } : {})
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
    strayMarkers: inventory.strayMarkers,
    ...(listItems === undefined ? {} : { listItems })
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
