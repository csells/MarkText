import type {
  CriticMarkupArm,
  CriticMarkupNode,
  DiagnosticIndex,
  ExecutionBudgetId,
  MarkupMark,
  MarkupProjection,
  MarkupProjectionRun,
  MarkdownOptionsV1,
  NodeId,
  ProjectedCodeUnitOrigin,
  ProjectionProvenance,
  ResourceDiagnostic,
  SourceOffset,
  SourceRange,
  SubstitutionNode,
  SyntaxDiagnostic,
  UnaryCriticNode
} from '../revision.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from '../resourcePolicy.js'
import {
  composeMarkdownLiteralRanges,
  type MarkdownContainerDepthFailure,
  type MarkdownLiteralRange
} from './profile1/markdownLiterals.js'
import {
  createMarkdownLaneState,
  type MarkdownArmMode,
  type MarkdownCheckpoint,
  type MarkdownLaneState,
  type MarkdownPendingLineBlockFact
} from './profile1/markdownLaneState.js'
import {
  __markerBearingIntrinsicTraversalsV1,
  __resetMarkerBearingIntrinsicTraversalsV1,
  recordCommentProjectionPreparationV1,
  recordIntrinsicSourceTraversalV1
} from './profile1/physicalTraversalAccounting.js'
import {
  createIntrinsicProfile1InspectionForkRecorder,
  createIntrinsicProfile1ForkRecorder,
  type IntrinsicProfile1ArmBoundaryEvent,
  type IntrinsicProfile1ForkBranch,
  type IntrinsicProfile1ForkGraph,
  type IntrinsicProfile1ForkLane,
  type IntrinsicProfile1ForkLaneHandle
} from './profile1/intrinsicProfile1ForkGraph.js'
import {
  assertLosslessTape,
  findMarker,
  markerCandidateFromRole,
  scanSourceTape,
  tapeCertifiesSimpleTextSource,
  type CanonicalMarkerDecision,
  type FormDefinition,
  type MarkerRole,
  type Profile1CriticKind,
  type RetainedMarkerCandidate,
  type TapeRun
} from './profile1/sourceTape.js'
import {
  createProfile1SyntaxGraphCore,
  finalizeProfile1SyntaxGraph
} from './profile1/syntaxGraph.js'
import type {
  Profile1SyntaxGraph,
  Profile1SyntaxGraphCore,
  Profile1ProjectedMarkdown,
  MappedProjectionSegment
} from './profile1/syntaxGraph.js'
import {
  createIntrinsicProfile1SourceProgression,
  createProfile1MarkdownReuseCache,
  createProfile1MarkdownForkParser,
  profile1MarkdownReuseRetentionV1,
  type MappedMarkdownLane,
  type Profile1MarkdownForkAstRequest,
  type Profile1MarkdownParse,
  type Profile1MarkdownForkParser,
  type Profile1MarkdownReuseCache,
  type Profile1MarkdownReuseRetentionV1,
  type MarkdownArmBoundaryProjectionEdit,
  type MappedMarkdownCanonicalIdentityRun,
  type MappedMarkdownMatchingScope
} from './profile1/markdownParser.js'
import {
  createProfile1SyntaxInspectionRegistry,
  createProfile1SyntaxIdentityRegistry,
  defineNodeId,
  type Profile1SyntaxIdentityRegistry,
  type SyntaxSourceIdentity
} from './profile1/syntaxIdentity.js'
import type {
  ProfileParseTraceRecorderV1,
  ProfileParseTraceViewV1
} from './profileParseTraceV1.js'
import type {
  Profile1CanonicalReferenceDefinitionLookup
} from './profile1/referenceDefinitionIndex.js'
import {
  createProfile1SyntaxAccountingRecorderV1,
  type Profile1SyntaxAccountingRecorderV1,
  type Profile1SyntaxAccountingTraceV1
} from './profile1/syntaxAccounting.js'
import {
  createParseExecutionTracker,
  PARSE_SOURCE_CHECKPOINT_INTERVAL,
  type ParseExecutionControl,
  type ParseExecutionTracker
} from '../parseExecutionControl.js'

type ImplementedUnaryNode =
  | UnaryCriticNode<'addition', 'content'>
  | UnaryCriticNode<'deletion', 'content'>
  | UnaryCriticNode<'highlight', 'content'>
  | UnaryCriticNode<'comment', 'comment'>

type ImplementedNode = ImplementedUnaryNode | SubstitutionNode
type ImplementedKind = ImplementedNode['kind']

interface ParseFrame {
  readonly definition: FormDefinition
  readonly open: TapeRun
  readonly children: readonly [CriticMarkupNode[], CriticMarkupNode[]]
  readonly continuationCheckpoint: MarkdownCheckpoint
  readonly armMode: MarkdownArmMode
  readonly forkParentLane: IntrinsicProfile1ForkLaneHandle
  readonly forkArmLanes: IntrinsicProfile1ForkLaneHandle[]
  currentForkLane: IntrinsicProfile1ForkLaneHandle
  currentCheckpoint: MarkdownCheckpoint
  enclosingLabelPreservedByAllArms: boolean
  separator?: TapeRun
}

interface ParseResult {
  readonly kind: 'complete'
  readonly tape: readonly TapeRun[]
  readonly roots: readonly CriticMarkupNode[]
  readonly diagnostics: readonly SyntaxDiagnostic[]
  readonly markerDecisions: readonly CanonicalMarkerDecision[]
  readonly forkGraph: IntrinsicProfile1ForkGraph
  readonly markdownLane: MarkdownLaneState
  readonly referenceDefinitions: Profile1CanonicalReferenceDefinitionLookup
  readonly markdownLiterals: readonly MarkdownLiteralRange[]
}

interface ParseResourceFailure {
  readonly kind: 'resource-failure'
  readonly fatalDiagnostic: ResourceDiagnostic
}

type ParseOutcome = ParseResult | ParseResourceFailure

interface IntrinsicProfile1InspectionResult {
  readonly kind: 'inspection-complete'
  readonly markerDecisions: readonly CanonicalMarkerDecision[]
}

type IntrinsicProfile1PassOutcome =
  | ParseOutcome
  | IntrinsicProfile1InspectionResult

interface MutableCanonicalProjectionSegment {
  readonly kind: 'canonical'
  projectedStart: number
  projectedEnd: number
  sourceRunId: number
  sourceStart: number
}

interface MutableGeneratedProjectionSegment {
  readonly kind: 'generated'
  projectedStart: number
  projectedEnd: number
  sourcePosition: number
  affinity: 'previous' | 'next'
}

type MutableProjectionSegment =
  | MutableCanonicalProjectionSegment
  | MutableGeneratedProjectionSegment

interface LaneTask {
  readonly kind: 'lane'
  readonly lane: IntrinsicProfile1ForkLane
}

interface AppendTask {
  readonly kind: 'append'
  readonly start: number
  readonly end: number
}

interface ArmBoundaryTask {
  readonly kind: 'arm-boundary'
  readonly laneId: number
  readonly event: IntrinsicProfile1ArmBoundaryEvent
  readonly lane: IntrinsicProfile1ForkLane
  readonly parentLane: IntrinsicProfile1ForkLane
  readonly branchEnd: number
}

type ProjectionTask = LaneTask | AppendTask | ArmBoundaryTask

interface MarkupRangeTask {
  readonly kind: 'markup-range'
  readonly start: number
  readonly end: number
  readonly nodes: readonly CriticMarkupNode[]
  readonly markPath: MarkPath | undefined
}

interface MarkupAppendTask {
  readonly kind: 'markup-append'
  readonly start: number
  readonly end: number
  readonly markPath: MarkPath | undefined
}

type MarkupTask = MarkupRangeTask | MarkupAppendTask

interface MarkPath {
  readonly parent: MarkPath | undefined
  readonly mark: MarkupMark
  readonly depth: number
}

export type Profile1DocumentProducts = Profile1SyntaxGraph & Readonly<{
  readonly simpleTextIdentity: boolean
  readonly accountingTrace?: Profile1SyntaxAccountingTraceV1
}>

export interface Profile1SourceOnlyProducts {
  readonly kind: 'source-only'
  readonly fatalDiagnostic: ResourceDiagnostic
}

export type Profile1DocumentResult = Profile1DocumentProducts | Profile1SourceOnlyProducts

export interface Profile1ChangedJoinInspection {
  readonly kind: 'inspected'
  readonly protectionPositions: readonly number[]
}

export type Profile1ChangedJoinInspectionResult =
  | Profile1ChangedJoinInspection
  | Profile1SourceOnlyProducts

export interface Profile1DocumentReuseCache {
  readonly markdown: Profile1MarkdownReuseCache
}

export function createProfile1DocumentReuseCache():
Profile1DocumentReuseCache {
  return Object.freeze({
    markdown: createProfile1MarkdownReuseCache()
  })
}

export type Profile1DocumentReuseRetentionV1 = Profile1MarkdownReuseRetentionV1

export function profile1DocumentReuseRetentionV1(
  cache: Profile1DocumentReuseCache
): Profile1DocumentReuseRetentionV1 {
  return profile1MarkdownReuseRetentionV1(cache.markdown)
}

const DIAGNOSTIC_ORDER: Readonly<Record<SyntaxDiagnostic['code'], number>> = Object.freeze({
  CM_UNMATCHED_CLOSER: 0,
  CM_NON_TOP_CLOSER: 1,
  CM_UNTERMINATED_OPENER: 2,
  CM_SUBSTITUTION_SEPARATOR_MISSING: 3
})

const FORM_LABEL: Readonly<Record<ImplementedKind, string>> = Object.freeze({
  addition: 'Addition',
  deletion: 'Deletion',
  substitution: 'Substitution',
  highlight: 'Highlight',
  comment: 'Comment'
})

const DESKTOP_BUDGET_EVENT_LIMIT = 2_000_000
const DESKTOP_MARKDOWN_DEPTH_LIMIT = 128
const DESKTOP_CM_DEPTH_LIMIT = 16_384
const DEFAULT_MARKDOWN_OPTIONS: MarkdownOptionsV1 = Object.freeze({
  schema: 'markdown-options-1',
  gfm: true,
  frontMatter: true,
  math: true,
  gitLabMath: false,
  footnotes: false,
  subscriptAndSuperscript: true
})

function sourceOffset(value: number): SourceOffset {
  return value as SourceOffset
}

function sourceRange(start: number, end: number): SourceRange {
  return Object.freeze({ start: sourceOffset(start), end: sourceOffset(end) })
}

function emitCriticMarkerEdges(
  registry: Profile1SyntaxIdentityRegistry,
  nodeId: NodeId,
  nodeKind: ImplementedKind,
  markers: readonly Readonly<{
    readonly role: 'open' | 'separator' | 'close'
    readonly range: SourceRange
  }>[]
): void {
  for (const marker of markers) {
    const semanticKey =
      `critic-marker:${nodeId}:${marker.role}:${marker.range.start}:${marker.range.end}`
    const markerId = registry.emitNode(
      'source-leaf',
      Object.freeze({ key: semanticKey, range: marker.range }),
      semanticKey
    )
    registry.emitEdge('marker', nodeId, markerId, marker.role)
    registry.emitOwnership(
      marker.range,
      Object.freeze(defineNodeId({
        kind: 'critic-marker' as const,
        form: nodeKind,
        role: marker.role,
        nodeRange: sourceRange(
          markers[0]?.range.start ?? marker.range.start,
          markers.at(-1)?.range.end ?? marker.range.end
        )
      }, nodeId))
    )
  }
}

function createUnaryNode(
  frame: ParseFrame,
  close: TapeRun,
  registry: Profile1SyntaxIdentityRegistry
): ImplementedUnaryNode {
  const children = Object.freeze([...frame.children[0]])
  const range = sourceRange(frame.open.range.start, close.range.end)
  const semanticKey =
    `critic:${frame.definition.kind}:${range.start}:${range.end}`
  const nodeId = registry.emitNode(
    frame.definition.kind,
    Object.freeze({ key: semanticKey, range }),
    semanticKey
  )
  const markers = Object.freeze({ open: frame.open.range, close: close.range })
  const createArm = <Name extends 'content' | 'comment'>(
    name: Name
  ): CriticMarkupArm<Name> => {
    const armRange = sourceRange(frame.open.range.end, close.range.start)
    const armKey = `critic-arm:${nodeId}:${name}`
    const armId = registry.emitNode(
      'critic-arm',
      Object.freeze({ key: armKey, range: armRange }),
      armKey
    )
    registry.emitEdge('critic-arm', nodeId, armId, name)
    for (const child of children) {
      registry.emitEdge('contains', armId, child.nodeId)
    }
    return Object.freeze(defineNodeId({
      name,
      range: armRange,
      children
    }, armId))
  }
  if (frame.definition.kind === 'comment') {
    const commentArm = createArm('comment')
    const node = Object.freeze(defineNodeId({
      kind: 'comment' as const,
      range,
      markers,
      arms: Object.freeze([commentArm]) as readonly [CriticMarkupArm<'comment'>]
    }, nodeId))
    emitCriticMarkerEdges(registry, nodeId, 'comment', Object.freeze([
      Object.freeze({ role: 'open', range: frame.open.range }),
      Object.freeze({ role: 'close', range: close.range })
    ]))
    return node
  }
  const arm = createArm('content')
  const common = {
    range,
    markers,
    arms: Object.freeze([arm]) as readonly [CriticMarkupArm<'content'>]
  }
  let node: ImplementedUnaryNode
  if (frame.definition.kind === 'addition') {
    node = Object.freeze(defineNodeId({
      kind: 'addition' as const,
      ...common
    }, nodeId))
  } else if (frame.definition.kind === 'deletion') {
    node = Object.freeze(defineNodeId({
      kind: 'deletion' as const,
      ...common
    }, nodeId))
  } else if (frame.definition.kind === 'highlight') {
    node = Object.freeze(defineNodeId({
      kind: 'highlight' as const,
      ...common
    }, nodeId))
  } else {
    throw new Error('Substitution cannot be created as a unary CriticMarkup node')
  }
  emitCriticMarkerEdges(registry, nodeId, node.kind, Object.freeze([
    Object.freeze({ role: 'open', range: frame.open.range }),
    Object.freeze({ role: 'close', range: close.range })
  ]))
  return node
}

function createSubstitutionNode(
  frame: ParseFrame,
  close: TapeRun,
  registry: Profile1SyntaxIdentityRegistry
): SubstitutionNode | undefined {
  const separator = frame.separator
  if (separator === undefined) {
    return undefined
  }
  const range = sourceRange(frame.open.range.start, close.range.end)
  const semanticKey = `critic:substitution:${range.start}:${range.end}`
  const nodeId = registry.emitNode(
    'substitution',
    Object.freeze({ key: semanticKey, range }),
    semanticKey
  )
  const createArm = <Name extends 'old' | 'new'>(
    name: Name,
    armRange: SourceRange,
    children: readonly CriticMarkupNode[]
  ): CriticMarkupArm<Name> => {
    const armKey = `critic-arm:${nodeId}:${name}`
    const armId = registry.emitNode(
      'critic-arm',
      Object.freeze({ key: armKey, range: armRange }),
      armKey
    )
    registry.emitEdge('critic-arm', nodeId, armId, name)
    for (const child of children) {
      registry.emitEdge('contains', armId, child.nodeId)
    }
    return Object.freeze(defineNodeId({
      name,
      range: armRange,
      children
    }, armId))
  }
  const oldArm = createArm(
    'old',
    sourceRange(frame.open.range.end, separator.range.start),
    Object.freeze([...frame.children[0]])
  )
  const newArm = createArm(
    'new',
    sourceRange(separator.range.end, close.range.start),
    Object.freeze([...frame.children[1]])
  )
  const node = Object.freeze(defineNodeId({
    kind: 'substitution' as const,
    range,
    markers: Object.freeze({
      open: frame.open.range,
      separator: separator.range,
      close: close.range
    }),
    arms: Object.freeze([oldArm, newArm]) as readonly [
      CriticMarkupArm<'old'>,
      CriticMarkupArm<'new'>
    ]
  }, nodeId))
  emitCriticMarkerEdges(registry, nodeId, 'substitution', Object.freeze([
    Object.freeze({ role: 'open', range: frame.open.range }),
    Object.freeze({ role: 'separator', range: separator.range }),
    Object.freeze({ role: 'close', range: close.range })
  ]))
  return node
}

function createDiagnostic(
  code: SyntaxDiagnostic['code'],
  range: SourceRange,
  metadata: Readonly<Record<string, string>> = Object.freeze({})
): SyntaxDiagnostic {
  return Object.freeze({ code, range, metadata: Object.freeze({ ...metadata }) })
}

function createResourceDiagnostic(
  code: ResourceDiagnostic['code'],
  range: SourceRange,
  limit: number,
  observed: number
): ResourceDiagnostic {
  return Object.freeze({
    kind: 'resource',
    code,
    range,
    metadata: Object.freeze({ limit: String(limit), observed: String(observed) })
  })
}

function compareNodes(left: CriticMarkupNode, right: CriticMarkupNode): number {
  return left.range.start - right.range.start || left.range.end - right.range.end
}

function emitTapeAccounting(
  accounting: Profile1SyntaxAccountingRecorderV1,
  tape: readonly TapeRun[]
): void {
  for (let ordinal = 0; ordinal < tape.length; ordinal += 1) {
    const run = tape[ordinal]
    if (run !== undefined) {
      accounting.emit(
        'TapeRun',
        run.range,
        `${run.role}/${String(run.range.start)}/${String(run.range.end)}/${String(ordinal)}`
      )
    }
  }
}

function emitProjectionAccounting(
  accounting: Profile1SyntaxAccountingRecorderV1,
  key: string,
  projection: PreparedProfile1Projection
): void {
  for (
    let ordinal = 0;
    ordinal < projection.mappedTape.length;
    ordinal += 1
  ) {
    const segment = projection.mappedTape[ordinal]
    if (segment === undefined) {
      continue
    }
    const range = segment.kind === 'canonical'
      ? sourceRange(
        segment.sourceStart,
        segment.sourceStart +
          segment.projectedEnd -
          segment.projectedStart
      )
      : sourceRange(segment.sourcePosition, segment.sourcePosition)
    accounting.emit(
      'ProjectionSegment',
      range,
      `${key}/${segment.kind}/${String(ordinal)}/` +
        (
          segment.kind === 'canonical'
            ? `${String(segment.sourceRunId)}/${String(segment.sourceStart)}`
            : `${String(segment.sourcePosition)}/${segment.affinity}`
        )
    )
  }
}

function plainParagraphLineRanges(
  source: string,
  execution?: ParseExecutionTracker
): readonly SourceRange[] | undefined {
  if (source.length === 0) {
    return undefined
  }
  const ranges: SourceRange[] = []
  let start = 0
  let reportedEnd = 0
  while (start < source.length) {
    let end = start
    while (
      end < source.length &&
      source.charCodeAt(end) !== 10 &&
      source.charCodeAt(end) !== 13
    ) {
      end += 1
      if (
        execution !== undefined &&
        end - reportedEnd >= PARSE_SOURCE_CHECKPOINT_INTERVAL
      ) {
        execution.examineParserWork(end - reportedEnd)
        reportedEnd = end
      }
    }
    execution?.examineParserWork(end - reportedEnd)
    reportedEnd = end
    const content = source.slice(start, end)
    if (content.length === 0 || !/^[\p{L}\p{N} ]+$/u.test(content)) {
      return undefined
    }
    ranges.push(sourceRange(start, end))
    if (end === source.length) {
      break
    }
    if (
      source.charCodeAt(end) === 13 &&
      source.charCodeAt(end + 1) === 10
    ) {
      end += 2
    } else {
      end += 1
    }
    start = end
  }
  return Object.freeze(ranges)
}

/**
 * A plain nonblank line sequence has a closed exact event algebra before AST
 * allocation: the canonical graph root, one shared projected fork alternative,
 * and one projection segment per canonical tape run. This preflight prevents a
 * high-node paragraph from allocating its way to a limit that is already
 * mathematically determined.
 */
function plainParagraphBudgetEventFailure(
  source: string,
  parsed: ParseResult,
  execution?: ParseExecutionTracker
): ResourceDiagnostic | undefined {
  if (parsed.roots.length !== 0) {
    return undefined
  }
  // Every accepted plain line contributes at least one canonical tape run.
  // Even the conservative 4× tape bound plus the two graph roots is below
  // the event ceiling here, so no exact line inventory can possibly fail.
  // Avoid another whole-source pass on the maximum one-line document.
  if (4 * parsed.tape.length + 2 <= DESKTOP_BUDGET_EVENT_LIMIT) {
    return undefined
  }
  const lines = plainParagraphLineRanges(source, execution)
  if (lines === undefined) {
    return undefined
  }
  const markdownNodesPerView = 2 * lines.length + 1
  const total =
    parsed.tape.length +
    1 +
    markdownNodesPerView +
    parsed.tape.length
  if (total <= DESKTOP_BUDGET_EVENT_LIMIT) {
    return undefined
  }

  const eventAfterTape = DESKTOP_BUDGET_EVENT_LIMIT - parsed.tape.length
  const markdownEventCount = 1 + markdownNodesPerView
  const failureRange =
    eventAfterTape < markdownEventCount
      ? sourceRange(0, source.length)
      : parsed.tape[eventAfterTape - markdownEventCount]?.range ??
        sourceRange(source.length, source.length)
  return createResourceDiagnostic(
    'CM_RESOURCE_LOGICAL_NODES_EXCEEDED',
    sourceRange(failureRange.start, failureRange.start),
    DESKTOP_BUDGET_EVENT_LIMIT,
    DESKTOP_BUDGET_EVENT_LIMIT + 1
  )
}

function appendNode(
  node: CriticMarkupNode,
  frames: readonly ParseFrame[],
  roots: CriticMarkupNode[]
): void {
  const parent = frames[frames.length - 1]
  if (parent === undefined) {
    roots.push(node)
    return
  }
  parent.children[parent.separator === undefined ? 0 : 1].push(node)
}

function promoteChildren(
  frame: ParseFrame,
  frames: readonly ParseFrame[],
  roots: CriticMarkupNode[]
): void {
  const children = [...frame.children[0], ...frame.children[1]].sort(compareNodes)
  for (const child of children) {
    appendNode(child, frames, roots)
  }
}

function finalizeDiagnostics(items: readonly SyntaxDiagnostic[]): readonly SyntaxDiagnostic[] {
  const ordered = [...items].sort(
    (left, right) =>
      left.range.start - right.range.start ||
      left.range.end - right.range.end ||
      DIAGNOSTIC_ORDER[left.code] - DIAGNOSTIC_ORDER[right.code]
  )
  const unique: SyntaxDiagnostic[] = []
  let previousKey: string | undefined
  for (const item of ordered) {
    const metadataKey = Object.entries(item.metadata)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('&')
    const key = `${item.code}:${item.range.start}:${item.range.end}:${metadataKey}`
    if (key !== previousKey) {
      unique.push(item)
      previousKey = key
    }
  }
  return Object.freeze(unique)
}

function finalizeAuthenticatedMarkdownLiterals(
  rootLiterals: readonly MarkdownLiteralRange[],
  armLiterals: readonly MarkdownLiteralRange[],
  roots: readonly CriticMarkupNode[]
): readonly MarkdownLiteralRange[] {
  const outsideRoots = rootLiterals.filter((literal) => {
    for (const root of roots) {
      if (root.range.start >= literal.end) {
        break
      }
      if (root.range.end > literal.start) {
        return false
      }
    }
    return true
  })
  return composeMarkdownLiteralRanges([...outsideRoots, ...armLiterals])
}

function finalizeCanonicalTape(
  source: string,
  decisions: readonly CanonicalMarkerDecision[],
  execution?: ParseExecutionTracker
): Readonly<{
    tape: readonly TapeRun[]
    markerDecisions: readonly CanonicalMarkerDecision[]
  }> {
  const retainedCandidates: RetainedMarkerCandidate[] = decisions.map((decision) =>
    Object.freeze({
      kind: decision.kind,
      role: decision.role,
      range: decision.range
    })
  )
  const tape = scanSourceTape(source, retainedCandidates, execution)
  assertLosslessTape(source, tape)

  const finalRunIdByIdentity = new Map<string, number>()
  for (const run of tape) {
    const marker = markerCandidateFromRole(run.role)
    if (marker !== undefined) {
      finalRunIdByIdentity.set(
        `${run.range.start}:${run.range.end}:${marker.kind}:${marker.role}`,
        run.id
      )
    }
  }
  const finalRunIdByTemporaryId = new Map<number, number>()
  for (const decision of decisions) {
    const finalRunId = finalRunIdByIdentity.get(
      `${decision.range.start}:${decision.range.end}:${decision.kind}:${decision.role}`
    )
    if (finalRunId === undefined) {
      throw new Error('Retained CriticMarkup marker lost its canonical tape identity')
    }
    finalRunIdByTemporaryId.set(decision.runId, finalRunId)
  }
  const remapRunId = (temporaryRunId: number): number => {
    const finalRunId = finalRunIdByTemporaryId.get(temporaryRunId)
    if (finalRunId === undefined) {
      throw new Error('CriticMarkup marker relationship lost its canonical tape identity')
    }
    return finalRunId
  }
  const markerDecisions = decisions.map((decision): CanonicalMarkerDecision => {
    if (decision.role === 'open') {
      return Object.freeze({
        ...decision,
        runId: remapRunId(decision.runId),
        parentOpenRunId:
          decision.parentOpenRunId === null
            ? null
            : remapRunId(decision.parentOpenRunId)
      })
    }
    if (decision.role === 'separator') {
      return Object.freeze({
        ...decision,
        runId: remapRunId(decision.runId),
        openerRunId: remapRunId(decision.openerRunId)
      })
    }
    return Object.freeze({
      ...decision,
      runId: remapRunId(decision.runId),
      ...(decision.openerRunId === undefined
        ? {}
        : { openerRunId: remapRunId(decision.openerRunId) }),
      ...(decision.topOpenRunId === undefined
        ? {}
        : { topOpenRunId: remapRunId(decision.topOpenRunId) })
    })
  })

  return Object.freeze({
    tape,
    markerDecisions: Object.freeze(markerDecisions)
  })
}

function parseIntrinsicProfile1Pass(
  source: string,
  syntaxIdentity: Profile1SyntaxIdentityRegistry,
  cmDepthLimit: number = Number.POSITIVE_INFINITY,
  markdownDepthLimit: number = Number.POSITIVE_INFINITY,
  markdownOptions: MarkdownOptionsV1 = DEFAULT_MARKDOWN_OPTIONS,
  execution?: ParseExecutionTracker,
  outputMode: 'document' | 'changed-join-inspection' = 'document'
): IntrinsicProfile1PassOutcome {
  const sourceProgression = createIntrinsicProfile1SourceProgression(
    source,
    execution
  )
  recordIntrinsicSourceTraversalV1(
    sourceProgression.hasCriticMarkupCandidate,
    source.length
  )
  const markdownLane = createMarkdownLaneState(
    source,
    markdownDepthLimit,
    sourceProgression.referenceDefinitions,
    undefined,
    markdownOptions.frontMatter,
    markdownOptions.gfm,
    markdownOptions.math,
    markdownOptions.gitLabMath,
    markdownOptions.footnotes,
    execution,
    sourceProgression.hasCriticMarkupCandidate
  )
  const roots: CriticMarkupNode[] = []
  const frames: ParseFrame[] = []
  const framesByKind = new Map<ImplementedKind, ParseFrame[]>()
  const diagnostics: SyntaxDiagnostic[] = []
  const markerDecisions: CanonicalMarkerDecision[] = []
  const stagedMarkdownLiterals: MarkdownLiteralRange[] = []
  let firstMarkdownDepthFailure: MarkdownContainerDepthFailure | undefined
  let rootMarkdownCheckpoint = markdownLane.emptyCheckpoint
  const forkRecorder =
    outputMode === 'changed-join-inspection'
      ? createIntrinsicProfile1InspectionForkRecorder(
        source.length,
        rootMarkdownCheckpoint
      )
      : createIntrinsicProfile1ForkRecorder(
        source.length,
        rootMarkdownCheckpoint
      )
  const noteMarkdownDepthFailure = (checkpoint: MarkdownCheckpoint): void => {
    const failure = markdownLane.containerDepthFailure(checkpoint)
    if (
      failure !== undefined &&
      (
        firstMarkdownDepthFailure === undefined ||
        failure.start < firstMarkdownDepthFailure.start ||
        (
          failure.start === firstMarkdownDepthFailure.start &&
          failure.end < firstMarkdownDepthFailure.end
        )
      )
    ) {
      firstMarkdownDepthFailure = failure
    }
  }
  const currentMarkdownCheckpoint = (): MarkdownCheckpoint =>
    frames.at(-1)?.currentCheckpoint ?? rootMarkdownCheckpoint
  const currentForkLane = (): IntrinsicProfile1ForkLaneHandle =>
    frames.at(-1)?.currentForkLane ?? forkRecorder.root
  const replaceCurrentMarkdownCheckpoint = (checkpoint: MarkdownCheckpoint): void => {
    noteMarkdownDepthFailure(checkpoint)
    const frame = frames.at(-1)
    if (frame === undefined) {
      rootMarkdownCheckpoint = checkpoint
    } else {
      frame.currentCheckpoint = checkpoint
    }
  }
  const appendRunAsMarkdownText = (run: TapeRun): void => {
    const frame = frames.at(-1)
    const laneStart = frame?.separator?.range.end ?? frame?.open.range.end ?? 0
    const laneEnd =
      frame === undefined
        ? source.length
        : nextCloserStart(frame.definition.kind, run.range.start)
    const boundaryEnd =
      frame === undefined
        ? source.length
        : nextLaneBoundary(frame, run.range.start)
    const entryCheckpoint = currentMarkdownCheckpoint()
    const advanced = markdownLane.advance(
      entryCheckpoint,
      run.range.start,
      run.range.end,
      laneStart,
      laneEnd,
      boundaryEnd
    )
    forkRecorder.recordTransition(
      currentForkLane(),
      'advance',
      entryCheckpoint,
      advanced.checkpoint,
      run.range.start,
      run.range.end,
      advanced.completedLiterals,
      advanced.completedLines
    )
    stagedMarkdownLiterals.push(...advanced.completedLiterals)
    replaceCurrentMarkdownCheckpoint(advanced.checkpoint)
  }
  const nextCloserStart = (
    kind: ImplementedKind,
    start: number
  ): number => sourceProgression.nextCloserStart(kind, start)
  const nextLaneBoundary = (frame: ParseFrame, start: number): number =>
    frame.definition.kind === 'substitution' && frame.separator === undefined
      ? Math.min(
        sourceProgression.nextSubstitutionSeparatorStart(start),
        nextCloserStart(frame.definition.kind, start)
      )
      : nextCloserStart(frame.definition.kind, start)

  let nextTemporaryMarkerId = 0
  const createTemporaryRun = (
    kind: Profile1CriticKind,
    role: MarkerRole,
    start: number,
    end: number
  ): TapeRun => Object.freeze({
    id: nextTemporaryMarkerId++,
    role: `candidate-${kind}-${role}`,
    range: sourceRange(start, end)
  })
  const appendMarkdownRange = (start: number, end: number): void => {
    appendRunAsMarkdownText(Object.freeze({
      id: -1,
      role: 'text',
      range: sourceRange(start, end)
    }))
  }
  const rejectStandingDelimiterCandidate = (candidateStart: number): void => {
    sourceProgression.referenceDefinitions.rejectDelimiterCandidate?.(
      candidateStart
    )
  }

  while (true) {
    const sourceStep = sourceProgression.next()
    if (sourceStep === undefined) {
      break
    }
    if (sourceStep.kind === 'markdown-text') {
      appendMarkdownRange(sourceStep.start, sourceStep.end)
      sourceProgression.consume(sourceStep.end)
      continue
    }

    const definition = sourceStep.definition
    const kind = definition.kind as ImplementedKind
    const markerRole = sourceStep.role
    const run = createTemporaryRun(
      definition.kind,
      markerRole,
      sourceStep.start,
      sourceStep.end
    )

    const currentFrame = frames[frames.length - 1]
    const compatibleActiveFrameCloser =
      markerRole === 'close' && currentFrame?.definition.kind === kind
    let checkpoint = currentMarkdownCheckpoint()
    const preparedForMarker = markdownLane.prepareForMarker(
      checkpoint,
      run.range.start,
      currentFrame === undefined
        ? source.length
        : nextCloserStart(currentFrame.definition.kind, run.range.start)
    )
    forkRecorder.recordTransition(
      currentForkLane(),
      'prepare-for-marker',
      checkpoint,
      preparedForMarker.checkpoint,
      run.range.start,
      run.range.start,
      preparedForMarker.completedLiterals
    )
    if (preparedForMarker.checkpoint !== checkpoint) {
      stagedMarkdownLiterals.push(...preparedForMarker.completedLiterals)
      replaceCurrentMarkdownCheckpoint(preparedForMarker.checkpoint)
      checkpoint = preparedForMarker.checkpoint
    }
    if (
      markerRole === 'separator' &&
      currentFrame?.definition.kind === 'substitution' &&
      currentFrame.separator === undefined
    ) {
      const released = markdownLane.releaseAtBoundary(
        checkpoint,
        run.range.start
      )
      forkRecorder.recordTransition(
        currentForkLane(),
        'release-at-boundary',
        checkpoint,
        released.checkpoint,
        run.range.start,
        run.range.start,
        released.completedLiterals
      )
      if (released.checkpoint !== checkpoint) {
        stagedMarkdownLiterals.push(...released.completedLiterals)
        replaceCurrentMarkdownCheckpoint(released.checkpoint)
        checkpoint = released.checkpoint
      }
    }
    if (
      markdownLane.markerIsProtected(checkpoint)
    ) {
      rejectStandingDelimiterCandidate(run.range.start)
      appendMarkdownRange(sourceStep.start, sourceStep.start + 1)
      sourceProgression.consume(sourceStep.start + 1)
      continue
    }
    // The Markdown lane is the single owner of literal precedence. (A second
    // "authenticated root literal" oracle used to be consulted here; it was fed
    // by a `retainedMarkdownLiterals` parameter that every call site passed as
    // undefined, so it was dead and is gone.)
    const insideLiteral =
      markdownLane.markerIsLiteralOwned(checkpoint) &&
      !compatibleActiveFrameCloser
    if (insideLiteral) {
      if (markerRole === 'open' || markerRole === 'separator') {
        rejectStandingDelimiterCandidate(run.range.start)
      }
      appendMarkdownRange(sourceStep.start, sourceStep.start + 1)
      sourceProgression.consume(sourceStep.start + 1)
      continue
    }

    if (markerRole === 'open') {
      const parent = frames[frames.length - 1]
      const continuationCheckpoint = currentMarkdownCheckpoint()
      const armMode: MarkdownArmMode =
        definition.kind === 'comment'
          ? 'isolated'
          : definition.kind === 'substitution'
            ? 'self-contained'
            : 'continuous'
      const armStartCheckpoint = markdownLane.enterArm(
        continuationCheckpoint,
        run.range.end,
        armMode
      )
      const forkParentLane = currentForkLane()
      const forkArmLane = forkRecorder.forkLane(armStartCheckpoint)
      if (definition.kind === 'substitution') {
        forkRecorder.recordArmBoundary(
          forkArmLane,
          Object.freeze({
            kind: 'substitution-arm-boundary',
            role: 'enter',
            sourcePosition: sourceOffset(run.range.end)
          })
        )
      }
      markerDecisions.push(
        Object.freeze({
          kind: definition.kind,
          role: 'open',
          runId: run.id,
          range: run.range,
          parentOpenRunId: parent?.open.id ?? null
        })
      )
      const nextFrame: ParseFrame = {
        definition,
        open: run,
        children: [[], []],
        continuationCheckpoint,
        armMode,
        forkParentLane,
        forkArmLanes: [forkArmLane],
        currentForkLane: forkArmLane,
        currentCheckpoint: armStartCheckpoint,
        enclosingLabelPreservedByAllArms: true
      }
      frames.push(nextFrame)
      const sameKindFrames = framesByKind.get(definition.kind)
      if (sameKindFrames === undefined) {
        framesByKind.set(definition.kind, [nextFrame])
      } else {
        sameKindFrames.push(nextFrame)
      }
      sourceProgression.consume(run.range.end)
      continue
    }

    const frame = frames[frames.length - 1]
    if (markerRole === 'separator') {
      if (
        frame !== undefined &&
        frame.definition.kind === 'substitution' &&
        frame.separator === undefined
      ) {
        const finishedArm = markdownLane.finishLane(
          frame.currentCheckpoint,
          run.range.start
        )
        forkRecorder.recordTransition(
          frame.currentForkLane,
          'finish-lane',
          frame.currentCheckpoint,
          finishedArm.checkpoint,
          run.range.start,
          run.range.start,
          finishedArm.completedLiterals,
          finishedArm.completedLines
        )
        stagedMarkdownLiterals.push(...finishedArm.completedLiterals)
        noteMarkdownDepthFailure(finishedArm.checkpoint)
        frame.currentCheckpoint = finishedArm.checkpoint
        frame.enclosingLabelPreservedByAllArms &&=
          !finishedArm.checkpoint.enclosingLabelInterrupted
        forkRecorder.recordArmBoundary(
          frame.currentForkLane,
          Object.freeze({
            kind: 'substitution-arm-boundary',
            role: 'exit',
            sourcePosition: sourceOffset(run.range.start)
          })
        )
        forkRecorder.sealLane(
          frame.currentForkLane,
          frame.currentCheckpoint
        )
        const nextArmCheckpoint = markdownLane.enterArm(
          frame.continuationCheckpoint,
          run.range.end,
          frame.armMode
        )
        const nextForkArm = forkRecorder.forkLane(nextArmCheckpoint)
        forkRecorder.recordArmBoundary(
          nextForkArm,
          Object.freeze({
            kind: 'substitution-arm-boundary',
            role: 'enter',
            sourcePosition: sourceOffset(run.range.end)
          })
        )
        frame.forkArmLanes.push(nextForkArm)
        frame.currentForkLane = nextForkArm
        frame.separator = run
        frame.currentCheckpoint = nextArmCheckpoint
        markerDecisions.push(
          Object.freeze({
            kind: 'substitution',
            role: 'separator',
            runId: run.id,
            range: run.range,
            openerRunId: frame.open.id
          })
        )
      } else {
        appendRunAsMarkdownText(run)
      }
      sourceProgression.consume(run.range.end)
      continue
    }

    const compatibleFrame =
      frame === undefined || frame.definition.kind === kind
        ? undefined
        : framesByKind.get(kind)?.at(-1)

    if (frame === undefined) {
      markerDecisions.push(
        Object.freeze({
          kind,
          role: 'close',
          runId: run.id,
          range: run.range,
          action: 'unmatched'
        })
      )
      diagnostics.push(createDiagnostic('CM_UNMATCHED_CLOSER', run.range))
      appendRunAsMarkdownText(run)
      sourceProgression.consume(run.range.end)
      continue
    }
    if (frame.definition.kind !== kind) {
      markerDecisions.push(
        compatibleFrame === undefined
          ? Object.freeze({
            kind,
            role: 'close',
            runId: run.id,
            range: run.range,
            action: 'unmatched'
          })
          : Object.freeze({
            kind,
            role: 'close',
            runId: run.id,
            range: run.range,
            action: 'non-top',
            openerRunId: compatibleFrame.open.id,
            topOpenRunId: frame.open.id
          })
      )
      diagnostics.push(
        compatibleFrame !== undefined
          ? createDiagnostic('CM_NON_TOP_CLOSER', run.range, {
            found: FORM_LABEL[kind],
            top: FORM_LABEL[frame.definition.kind]
          })
          : createDiagnostic('CM_UNMATCHED_CLOSER', run.range)
      )
      appendRunAsMarkdownText(run)
      sourceProgression.consume(run.range.end)
      continue
    }
    markerDecisions.push(
      Object.freeze({
        kind,
        role: 'close',
        runId: run.id,
        range: run.range,
        action: 'matched',
        openerRunId: frame.open.id
      })
    )
    frames.pop()
    const sameKindFrames = framesByKind.get(kind)
    if (sameKindFrames?.pop() !== frame) {
      throw new Error('CriticMarkup frame index diverged from the parse stack')
    }
    const finishedLane = markdownLane.finishLane(
      frame.currentCheckpoint,
      run.range.start
    )
    forkRecorder.recordTransition(
      frame.currentForkLane,
      'finish-lane',
      frame.currentCheckpoint,
      finishedLane.checkpoint,
      run.range.start,
      run.range.start,
      finishedLane.completedLiterals,
      finishedLane.completedLines
    )
    frame.currentCheckpoint = finishedLane.checkpoint
    frame.enclosingLabelPreservedByAllArms &&=
      !finishedLane.checkpoint.enclosingLabelInterrupted
    if (frame.definition.kind === 'substitution') {
      forkRecorder.recordArmBoundary(
        frame.currentForkLane,
        Object.freeze({
          kind: 'substitution-arm-boundary',
          role: 'exit',
          sourcePosition: sourceOffset(run.range.start)
        })
      )
    }
    forkRecorder.sealLane(
      frame.currentForkLane,
      frame.currentCheckpoint
    )
    noteMarkdownDepthFailure(finishedLane.checkpoint)
    stagedMarkdownLiterals.push(...finishedLane.completedLiterals)
    const node =
      frame.definition.kind === 'substitution'
        ? createSubstitutionNode(frame, run, syntaxIdentity)
        : createUnaryNode(frame, run, syntaxIdentity)
    if (node === undefined) {
      diagnostics.push(
        createDiagnostic(
          'CM_SUBSTITUTION_SEPARATOR_MISSING',
          sourceRange(frame.open.range.start, run.range.end)
        )
      )
      promoteChildren(frame, frames, roots)
      const advanced = markdownLane.advance(
        frame.currentCheckpoint,
        run.range.start,
        run.range.end,
        frame.separator?.range.end ?? frame.open.range.end,
        source.length,
        source.length
      )
      forkRecorder.promoteBranches(
        frame.forkArmLanes,
        frame.forkParentLane
      )
      forkRecorder.recordTransition(
        frame.forkParentLane,
        'malformed-recovery',
        frame.continuationCheckpoint,
        advanced.checkpoint,
        frame.open.range.start,
        run.range.end,
        Object.freeze([
          ...finishedLane.completedLiterals,
          ...advanced.completedLiterals
        ]),
        Object.freeze([
          ...(finishedLane.completedLines ?? []),
          ...(advanced.completedLines ?? [])
        ])
      )
      stagedMarkdownLiterals.push(...advanced.completedLiterals)
      replaceCurrentMarkdownCheckpoint(advanced.checkpoint)
      sourceProgression.consume(run.range.end)
      continue
    }
    forkRecorder.acceptBranch(
      frame.forkParentLane,
      node,
      frame.forkArmLanes
    )
    appendNode(node, frames, roots)
    const rejoinedCheckpoint = markdownLane.finishArm(
      frame.continuationCheckpoint,
      frame.currentCheckpoint,
      frame.armMode,
      node.kind === 'substitution' && node.arms.some(
        (arm) => arm.range.start < arm.range.end
      ),
      frame.enclosingLabelPreservedByAllArms,
      frames.length === 0
    )
    forkRecorder.recordTransition(
      frame.forkParentLane,
      'rejoin-carrier',
      frame.continuationCheckpoint,
      rejoinedCheckpoint,
      run.range.end,
      run.range.end,
      Object.freeze([])
    )
    replaceCurrentMarkdownCheckpoint(rejoinedCheckpoint)
    sourceProgression.consume(run.range.end)
  }

  for (const frame of frames) {
    diagnostics.push(
      createDiagnostic(
        'CM_UNTERMINATED_OPENER',
        frame.open.range,
        frame.definition.kind === 'substitution'
          ? { separatorSeen: frame.separator === undefined ? 'false' : 'true' }
          : undefined
      )
    )
  }
  for (const frame of frames) {
    promoteChildren(frame, Object.freeze([]), roots)
  }
  for (let frameIndex = frames.length - 1; frameIndex >= 0; frameIndex -= 1) {
    const frame = frames[frameIndex]
    if (frame === undefined) {
      continue
    }
    forkRecorder.promoteBranches(
      frame.forkArmLanes,
      frame.forkParentLane
    )
    forkRecorder.recordTransition(
      frame.forkParentLane,
      'unterminated-recovery',
      frame.continuationCheckpoint,
      frame.continuationCheckpoint,
      frame.open.range.start,
      source.length,
      Object.freeze([])
    )
  }

  const finishedRootLane = markdownLane.finishLane(
    rootMarkdownCheckpoint,
    source.length
  )
  forkRecorder.recordTransition(
    forkRecorder.root,
    'finish-lane',
    rootMarkdownCheckpoint,
    finishedRootLane.checkpoint,
    source.length,
    source.length,
    finishedRootLane.completedLiterals,
    finishedRootLane.completedLines
  )
  rootMarkdownCheckpoint = finishedRootLane.checkpoint
  noteMarkdownDepthFailure(finishedRootLane.checkpoint)
  stagedMarkdownLiterals.push(...finishedRootLane.completedLiterals)

  roots.sort(compareNodes)
  if (firstMarkdownDepthFailure !== undefined) {
    return Object.freeze({
      kind: 'resource-failure',
      fatalDiagnostic: createResourceDiagnostic(
        'CM_RESOURCE_MARKDOWN_DEPTH_EXCEEDED',
        sourceRange(
          firstMarkdownDepthFailure.start,
          firstMarkdownDepthFailure.end
        ),
        markdownDepthLimit,
        firstMarkdownDepthFailure.observed
      )
    })
  }
  const acceptedDepthFailure = findAcceptedDepthFailure(roots, cmDepthLimit)
  if (acceptedDepthFailure !== undefined) {
    return Object.freeze({
      kind: 'resource-failure',
      fatalDiagnostic: acceptedDepthFailure
    })
  }
  if (outputMode === 'changed-join-inspection') {
    return Object.freeze({
      kind: 'inspection-complete',
      markerDecisions: Object.freeze(markerDecisions)
    })
  }
  const canonical = finalizeCanonicalTape(source, markerDecisions, execution)
  const forkGraph = forkRecorder.finish(
    canonical.tape,
    rootMarkdownCheckpoint
  )
  const markdownLiterals = finalizeAuthenticatedMarkdownLiterals(
    Object.freeze([]),
    stagedMarkdownLiterals,
    roots
  )
  sourceProgression.referenceDefinitions.finalizeAcceptedDefinitions(
    markdownLiterals
  )
  return Object.freeze({
    kind: 'complete',
    tape: canonical.tape,
    roots: Object.freeze(roots),
    diagnostics: finalizeDiagnostics(diagnostics),
    markerDecisions: canonical.markerDecisions,
    forkGraph,
    markdownLane,
    referenceDefinitions: sourceProgression.referenceDefinitions,
    markdownLiterals
  })
}

/**
 * Test-only counter of full CriticMarkup recognitions. Phase 0.5 drives the
 * "one CriticMarkup authority per open" property by shrinking this from ~5
 * (canonical + per-projection guard + per-projection verifier) to 1. It counts
 * `parseIntrinsicProfile1`, not each internal block/inline phase, so one
 * canonical grammar admission remains one recognition.
 */
export function __criticMarkupRecognitionCountV1(): number {
  return __markerBearingIntrinsicTraversalsV1()
}

export function __resetCriticMarkupRecognitionCountV1(): void {
  __resetMarkerBearingIntrinsicTraversalsV1()
}

function parseIntrinsicProfile1(
  source: string,
  syntaxIdentity: Profile1SyntaxIdentityRegistry,
  cmDepthLimit: number = Number.POSITIVE_INFINITY,
  markdownDepthLimit: number = Number.POSITIVE_INFINITY,
  markdownOptions: MarkdownOptionsV1 = DEFAULT_MARKDOWN_OPTIONS,
  execution?: ParseExecutionTracker
): ParseOutcome {
  const discovery = parseIntrinsicProfile1Pass(
    source,
    syntaxIdentity,
    cmDepthLimit,
    markdownDepthLimit,
    markdownOptions,
    execution
  )
  if (discovery.kind === 'inspection-complete') {
    throw new Error('Document parse returned inspection-only products')
  }
  if (discovery.kind !== 'complete') {
    return discovery
  }
  return discovery
}

function inspectIntrinsicProfile1ChangedJoins(
  source: string,
  syntaxIdentity: Profile1SyntaxIdentityRegistry,
  cmDepthLimit: number,
  markdownDepthLimit: number,
  markdownOptions: MarkdownOptionsV1,
  execution: ParseExecutionTracker
): IntrinsicProfile1InspectionResult | ParseResourceFailure {
  const inspected = parseIntrinsicProfile1Pass(
    source,
    syntaxIdentity,
    cmDepthLimit,
    markdownDepthLimit,
    markdownOptions,
    execution,
    'changed-join-inspection'
  )
  if (inspected.kind === 'complete') {
    throw new Error('Changed-join inspection materialized document products')
  }
  return inspected
}

interface NodeAtDepth {
  readonly node: CriticMarkupNode
  readonly depth: number
}

function findAcceptedDepthFailure(
  roots: readonly CriticMarkupNode[],
  cmDepthLimit: number
): ResourceDiagnostic | undefined {
  if (!Number.isFinite(cmDepthLimit)) {
    return undefined
  }

  const pending: NodeAtDepth[] = []
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    const node = roots[index]
    if (node !== undefined) {
      pending.push({ node, depth: 1 })
    }
  }

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) {
      break
    }
    if (current.depth > cmDepthLimit) {
      return createResourceDiagnostic(
        'CM_RESOURCE_CM_DEPTH_EXCEEDED',
        current.node.markers.open,
        cmDepthLimit,
        current.depth
      )
    }
    for (let armIndex = current.node.arms.length - 1; armIndex >= 0; armIndex -= 1) {
      const arm = current.node.arms[armIndex]
      if (arm === undefined) {
        continue
      }
      for (let childIndex = arm.children.length - 1; childIndex >= 0; childIndex -= 1) {
        const child = arm.children[childIndex]
        if (child !== undefined) {
          pending.push({ node: child, depth: current.depth + 1 })
        }
      }
    }
  }

  return undefined
}

function freezeSegment(segment: MutableProjectionSegment): MappedProjectionSegment {
  return Object.freeze({ ...segment })
}

function canonicalIdentityRunsFor(
  segments: readonly MutableProjectionSegment[]
): readonly MappedMarkdownCanonicalIdentityRun[] {
  return Object.freeze(segments.flatMap(
    (segment): readonly MappedMarkdownCanonicalIdentityRun[] =>
      segment.kind === 'generated'
        ? Object.freeze([])
        : Object.freeze([Object.freeze({
          candidateStart: segment.projectedStart,
          candidateEnd: segment.projectedEnd,
          sourceRunId: segment.sourceRunId,
          sourceStart: segment.sourceStart
        })])
  ))
}

function createProvenance(
  projectedLength: number,
  mutableSegments: readonly MutableProjectionSegment[]
): ProjectionProvenance {
  const segments = Object.freeze(mutableSegments.map(freezeSegment))
  const canonicalSegments = Object.freeze(
    segments.flatMap((segment) =>
      segment.kind === 'generated'
        ? Object.freeze([])
        : Object.freeze([Object.freeze({
          sourceStart: segment.sourceStart,
          sourceEnd:
            segment.sourceStart +
            segment.projectedEnd -
            segment.projectedStart
        })])
    )
  )
  const originAt = Object.freeze((projectedOffset: number): ProjectedCodeUnitOrigin => {
    if (
      !Number.isInteger(projectedOffset) ||
      projectedOffset < 0 ||
      projectedOffset >= projectedLength
    ) {
      throw new RangeError('Projected offset is outside the projection')
    }

    let low = 0
    let high = segments.length - 1
    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2)
      const segment = segments[middle]
      if (segment === undefined) {
        break
      }
      if (projectedOffset < segment.projectedStart) {
        high = middle - 1
      } else if (projectedOffset >= segment.projectedEnd) {
        low = middle + 1
      } else {
        return segment.kind === 'canonical'
          ? Object.freeze({
            kind: 'canonical' as const,
            sourceOffset: sourceOffset(
              segment.sourceStart + projectedOffset - segment.projectedStart
            )
          })
          : Object.freeze({
            kind: 'generated' as const,
            sourcePosition: sourceOffset(segment.sourcePosition),
            affinity: segment.affinity
          })
      }
    }
    throw new Error('Projection provenance has an uncovered code unit')
  })
  const canonicalSourceRangeIntersects = Object.freeze((
    sourceStart: number,
    sourceEnd: number
  ): boolean => {
    if (
      !Number.isInteger(sourceStart) ||
      !Number.isInteger(sourceEnd) ||
      sourceStart < 0 ||
      sourceEnd < sourceStart
    ) {
      throw new RangeError('Canonical source range is invalid')
    }
    if (sourceStart === sourceEnd) {
      return false
    }

    let low = 0
    let high = canonicalSegments.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if ((canonicalSegments[middle]?.sourceEnd ?? Infinity) <= sourceStart) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    return (canonicalSegments[low]?.sourceStart ?? Infinity) < sourceEnd
  })
  return Object.freeze({ originAt, canonicalSourceRangeIntersects })
}

function projectedSyntaxSourceIdentity(
  segments: readonly MutableProjectionSegment[],
  projectedStart: number,
  projectedEnd: number,
  sourceLength: number,
  emptySourcePosition: number = 0
): SyntaxSourceIdentity {
  if (
    !Number.isInteger(projectedStart) ||
    !Number.isInteger(projectedEnd) ||
    projectedStart < 0 ||
    projectedEnd < projectedStart
  ) {
    throw new Error('Projected syntax identity has an invalid view range')
  }
  const pieces: string[] = []
  let sourceStart = sourceLength
  let sourceEnd = 0
  const includeSourceRange = (start: number, end: number): void => {
    sourceStart = Math.min(sourceStart, start)
    sourceEnd = Math.max(sourceEnd, end)
  }

  if (projectedStart === projectedEnd) {
    let previousLow = 0
    let previousHigh = segments.length
    while (previousLow < previousHigh) {
      const middle =
        previousLow + Math.floor((previousHigh - previousLow) / 2)
      if (
        (segments[middle]?.projectedEnd ?? Number.POSITIVE_INFINITY) <=
        projectedStart
      ) {
        previousLow = middle + 1
      } else {
        previousHigh = middle
      }
    }
    const previous = segments[previousLow - 1]
    let nextLow = 0
    let nextHigh = segments.length
    while (nextLow < nextHigh) {
      const middle = nextLow + Math.floor((nextHigh - nextLow) / 2)
      if (
        (segments[middle]?.projectedStart ?? Number.POSITIVE_INFINITY) <
        projectedStart
      ) {
        nextLow = middle + 1
      } else {
        nextHigh = middle
      }
    }
    const next = segments[nextLow]
    const anchor = next ?? previous
    if (anchor === undefined) {
      return Object.freeze({
        key: `point:${String(emptySourcePosition)}`,
        range: sourceRange(emptySourcePosition, emptySourcePosition)
      })
    }
    const position = anchor.kind === 'canonical'
      ? anchor.sourceStart + Math.min(
        Math.max(projectedStart - anchor.projectedStart, 0),
        anchor.projectedEnd - anchor.projectedStart
      )
      : anchor.sourcePosition
    return Object.freeze({
      key: `point:${String(position)}`,
      range: sourceRange(position, position)
    })
  }

  let segmentLow = 0
  let segmentHigh = segments.length
  while (segmentLow < segmentHigh) {
    const middle =
      segmentLow + Math.floor((segmentHigh - segmentLow) / 2)
    if (
      (segments[middle]?.projectedEnd ?? Number.POSITIVE_INFINITY) <=
      projectedStart
    ) {
      segmentLow = middle + 1
    } else {
      segmentHigh = middle
    }
  }
  for (
    let index = segmentLow;
    index < segments.length;
    index += 1
  ) {
    const segment = segments[index]
    if (
      segment === undefined ||
      segment.projectedStart >= projectedEnd
    ) {
      break
    }
    const overlapStart = Math.max(projectedStart, segment.projectedStart)
    const overlapEnd = Math.min(projectedEnd, segment.projectedEnd)
    if (overlapStart >= overlapEnd) {
      continue
    }
    if (segment.kind === 'canonical') {
      const canonicalStart =
        segment.sourceStart + overlapStart - segment.projectedStart
      const canonicalEnd = canonicalStart + overlapEnd - overlapStart
      includeSourceRange(canonicalStart, canonicalEnd)
      pieces.push(
        `c:${String(segment.sourceRunId)}:${String(canonicalStart)}:${String(canonicalEnd)}`
      )
    } else {
      includeSourceRange(segment.sourcePosition, segment.sourcePosition)
      pieces.push(
        `g:${String(segment.sourcePosition)}:${segment.affinity}:${String(overlapEnd - overlapStart)}`
      )
    }
  }
  if (pieces.length === 0) {
    throw new Error('Projected syntax identity is outside its mapped tape')
  }
  if (sourceStart === sourceLength && sourceEnd === 0) {
    sourceStart = 0
  }
  return Object.freeze({
    key: pieces.join('|'),
    range: sourceRange(sourceStart, Math.max(sourceStart, sourceEnd))
  })
}

function appendMark(markPath: MarkPath | undefined, mark: MarkupMark): MarkPath {
  return Object.freeze({
    parent: markPath,
    mark: Object.freeze(mark),
    depth: (markPath?.depth ?? 0) + 1
  })
}

function markupNodeTasks(
  node: CriticMarkupNode,
  markPath: MarkPath | undefined
): readonly MarkupRangeTask[] {
  if (node.kind === 'comment') {
    return Object.freeze([])
  }
  if (node.kind === 'substitution') {
    return Object.freeze([
      Object.freeze({
        kind: 'markup-range',
        start: node.arms[0].range.start,
        end: node.arms[0].range.end,
        nodes: node.arms[0].children,
        markPath: appendMark(
          markPath,
          defineNodeId({ kind: 'substitution', arm: 'old' }, node.nodeId)
        )
      }),
      Object.freeze({
        kind: 'markup-range',
        start: node.arms[1].range.start,
        end: node.arms[1].range.end,
        nodes: node.arms[1].children,
        markPath: appendMark(
          markPath,
          defineNodeId({ kind: 'substitution', arm: 'new' }, node.nodeId)
        )
      })
    ])
  }
  const mark: MarkupMark = Object.freeze(
    defineNodeId({ kind: node.kind }, node.nodeId)
  )
  const arm = node.arms[0]
  return Object.freeze([
    Object.freeze({
      kind: 'markup-range',
      start: arm.range.start,
      end: arm.range.end,
      nodes: arm.children,
      markPath: appendMark(markPath, mark)
    })
  ])
}

function createMarkupProjection(
  source: string,
  roots: readonly CriticMarkupNode[]
): MarkupProjection {
  interface MutableMarkupRun {
    readonly markPath: MarkPath | undefined
    readonly marks: readonly MarkupMark[]
    text: string
    sourceStart: number
    sourceEnd: number
  }

  const runs: MutableMarkupRun[] = []
  const tasks: MarkupTask[] = [
    {
      kind: 'markup-range',
      start: 0,
      end: source.length,
      nodes: roots,
      markPath: undefined
    }
  ]
  const emptyMarks: readonly MarkupMark[] = Object.freeze([])
  const materializedPaths = new WeakMap<MarkPath, readonly MarkupMark[]>()
  const materializeMarkPath = (markPath: MarkPath | undefined): readonly MarkupMark[] => {
    if (markPath === undefined) {
      return emptyMarks
    }
    const cached = materializedPaths.get(markPath)
    if (cached !== undefined) {
      return cached
    }
    const marks = new Array<MarkupMark>(markPath.depth)
    let cursor: MarkPath | undefined = markPath
    for (let index = marks.length - 1; index >= 0; index -= 1) {
      if (cursor === undefined) {
        throw new Error('Markup mark path ended before its declared depth')
      }
      marks[index] = cursor.mark
      cursor = cursor.parent
    }
    const frozen = Object.freeze(marks)
    materializedPaths.set(markPath, frozen)
    return frozen
  }
  const appendSource = (
    start: number,
    end: number,
    markPath: MarkPath | undefined
  ): void => {
    if (start === end) {
      return
    }
    const text = source.slice(start, end)
    const previousRun = runs[runs.length - 1]
    if (
      previousRun !== undefined &&
      previousRun.sourceEnd === start &&
      previousRun.markPath === markPath
    ) {
      previousRun.text += text
      previousRun.sourceEnd = end
    } else {
      runs.push({
        markPath,
        marks: materializeMarkPath(markPath),
        text,
        sourceStart: start,
        sourceEnd: end
      })
    }
  }

  while (tasks.length > 0) {
    const task = tasks.pop()
    if (task === undefined) {
      break
    }
    if (task.kind === 'markup-append') {
      appendSource(task.start, task.end, task.markPath)
      continue
    }
    const orderedTasks: MarkupTask[] = []
    let cursor = task.start
    for (const node of task.nodes) {
      if (cursor < node.range.start) {
        orderedTasks.push({
          kind: 'markup-append',
          start: cursor,
          end: node.range.start,
          markPath: task.markPath
        })
      }
      orderedTasks.push(...markupNodeTasks(node, task.markPath))
      cursor = node.range.end
    }
    if (cursor < task.end) {
      orderedTasks.push({
        kind: 'markup-append',
        start: cursor,
        end: task.end,
        markPath: task.markPath
      })
    }
    for (let index = orderedTasks.length - 1; index >= 0; index -= 1) {
      const orderedTask = orderedTasks[index]
      if (orderedTask !== undefined) {
        tasks.push(orderedTask)
      }
    }
  }

  const frozenRuns: readonly MarkupProjectionRun[] = Object.freeze(
    runs.map((run) =>
      Object.freeze({
        text: run.text,
        sourceRange: sourceRange(run.sourceStart, run.sourceEnd),
        marks: run.marks
      })
    )
  )
  return Object.freeze({
    runs: frozenRuns,
    runCount: frozenRuns.length,
    runAt: Object.freeze((ordinal: number): MarkupProjectionRun => {
      const run = Number.isInteger(ordinal) ? frozenRuns[ordinal] : undefined
      if (run === undefined) {
        throw new RangeError(
          `Markup projection run ordinal ${String(ordinal)} is outside [0, ${String(frozenRuns.length)})`
        )
      }
      return run
    })
  })
}

type ProjectionView = 'original' | 'revised' | 'editing'

// The lanes a branch contributes to a view, in projected order. Original rejects
// (keeps deletion/substitution-old), Revised accepts (keeps addition/substitution-
// new), and the editing view shows every content arm as the user edits it —
// including both Substitution arms, old then new. Comments contribute no text to
// any view (their bodies live in the sidebar).
function selectedCanonicalArms(
  branch: IntrinsicProfile1ForkBranch,
  view: ProjectionView
): readonly IntrinsicProfile1ForkLane[] {
  const node = branch.node
  const show = (lane: IntrinsicProfile1ForkLane | undefined): readonly IntrinsicProfile1ForkLane[] =>
    lane === undefined ? EMPTY_CANONICAL_LANES : [lane]
  if (node.kind === 'addition') {
    return view === 'original' ? EMPTY_CANONICAL_LANES : show(branch.arms[0])
  }
  if (node.kind === 'deletion') {
    return view === 'revised' ? EMPTY_CANONICAL_LANES : show(branch.arms[0])
  }
  if (node.kind === 'substitution') {
    if (view === 'editing') {
      return branch.arms[0] !== undefined && branch.arms[1] !== undefined
        ? [branch.arms[0], branch.arms[1]]
        : EMPTY_CANONICAL_LANES
    }
    return show(view === 'original' ? branch.arms[0] : branch.arms[1])
  }
  if (node.kind === 'highlight') {
    return show(branch.arms[0])
  }
  if (node.kind === 'comment') {
    return EMPTY_CANONICAL_LANES
  }
  throw new Error('CriticMarkup projection reached an unknown form')
}

const EMPTY_CANONICAL_LANES: readonly IntrinsicProfile1ForkLane[] = Object.freeze([])

interface PlannedProtection {
  readonly candidateOffset: number
  readonly sourcePosition: number
}

interface PlannedGeneratedInsertion {
  readonly candidateOffset: number
  readonly text: string
  readonly sourcePosition: number
  readonly affinity: 'previous' | 'next'
}

interface PlannedGeneratedReplacement {
  readonly candidateStart: number
  readonly candidateEnd: number
  readonly text: string
  readonly sourcePosition: number
  readonly affinity: 'previous' | 'next'
}

interface ProjectionCodecResult {
  readonly source: string
  readonly segments: readonly MutableProjectionSegment[]
  readonly mapOffset: (
    candidateOffset: number,
    affinity: 'previous' | 'next'
  ) => number
}

function unchangedProjectionCodecResult(
  source: string,
  segments: readonly MutableProjectionSegment[]
): ProjectionCodecResult {
  return Object.freeze({
    source,
    segments,
    mapOffset: Object.freeze((offset: number): number => offset)
  })
}

function mapMatchingScopesThrough(
  scopes: readonly MappedMarkdownMatchingScope[],
  codec: ProjectionCodecResult
): readonly MappedMarkdownMatchingScope[] {
  return Object.freeze(scopes.map((scope) => Object.freeze({
    ...scope,
    start: codec.mapOffset(scope.start, 'previous'),
    end: codec.mapOffset(scope.end, 'previous')
  })))
}

function projectionOriginAt(
  segments: readonly MutableProjectionSegment[],
  projectedOffset: number
): Readonly<
  | { kind: 'canonical'; sourceOffset: number }
  | { kind: 'generated'; sourcePosition: number; affinity: 'previous' | 'next' }
  > {
  let low = 0
  let high = segments.length - 1
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2)
    const segment = segments[middle]
    if (segment === undefined) {
      break
    }
    if (projectedOffset < segment.projectedStart) {
      high = middle - 1
    } else if (projectedOffset >= segment.projectedEnd) {
      low = middle + 1
    } else {
      return segment.kind === 'canonical'
        ? Object.freeze({
          kind: 'canonical',
          sourceOffset: segment.sourceStart + projectedOffset - segment.projectedStart
        })
        : Object.freeze({
          kind: 'generated',
          sourcePosition: segment.sourcePosition,
          affinity: segment.affinity
        })
    }
  }
  throw new Error('Projection candidate has an uncovered code unit')
}

function canonicalMarkerIdentity(
  segments: readonly MutableProjectionSegment[],
  candidateOffset: number,
  markerLength: number
): Readonly<{ sourceStart: number; sourceRunId: number }> | undefined {
  const identityAt = (
    projectedOffset: number
  ): Readonly<{ sourceOffset: number; sourceRunId: number }> | undefined => {
    let low = 0
    let high = segments.length - 1
    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2)
      const segment = segments[middle]
      if (segment === undefined) {
        return undefined
      }
      if (projectedOffset < segment.projectedStart) {
        high = middle - 1
      } else if (projectedOffset >= segment.projectedEnd) {
        low = middle + 1
      } else if (segment.kind === 'canonical') {
        return Object.freeze({
          sourceOffset:
            segment.sourceStart + projectedOffset - segment.projectedStart,
          sourceRunId: segment.sourceRunId
        })
      } else {
        return undefined
      }
    }
    return undefined
  }
  let sourceStart: number | undefined
  let sourceRunId: number | undefined
  for (let index = 0; index < markerLength; index += 1) {
    const projectedOffset = candidateOffset + index
    const identity = identityAt(projectedOffset)
    if (identity === undefined) {
      return undefined
    }
    const sourceOffset = identity.sourceOffset
    sourceStart ??= sourceOffset
    sourceRunId ??= identity.sourceRunId
    if (
      identity.sourceRunId !== sourceRunId ||
      sourceOffset !== sourceStart + index
    ) {
      return undefined
    }
  }
  return sourceStart === undefined || sourceRunId === undefined
    ? undefined
    : Object.freeze({ sourceStart, sourceRunId })
}

function appendProjectionRange(
  target: MutableProjectionSegment[],
  sourceSegments: readonly MutableProjectionSegment[],
  candidateStart: number,
  candidateEnd: number,
  projectedStart: number
): void {
  for (const segment of sourceSegments) {
    const overlapStart = Math.max(candidateStart, segment.projectedStart)
    const overlapEnd = Math.min(candidateEnd, segment.projectedEnd)
    if (overlapStart >= overlapEnd) {
      continue
    }
    const next: MutableProjectionSegment =
      segment.kind === 'canonical'
        ? {
          kind: 'canonical',
          projectedStart: projectedStart + overlapStart - candidateStart,
          projectedEnd: projectedStart + overlapEnd - candidateStart,
          sourceRunId: segment.sourceRunId,
          sourceStart: segment.sourceStart + overlapStart - segment.projectedStart
        }
        : {
          kind: 'generated',
          projectedStart: projectedStart + overlapStart - candidateStart,
          projectedEnd: projectedStart + overlapEnd - candidateStart,
          sourcePosition: segment.sourcePosition,
          affinity: segment.affinity
        }
    const previous = target[target.length - 1]
    if (
      next.kind === 'canonical' &&
      previous?.kind === 'canonical' &&
      previous.sourceRunId === next.sourceRunId &&
      previous.projectedEnd === next.projectedStart &&
      previous.sourceStart + previous.projectedEnd - previous.projectedStart === next.sourceStart
    ) {
      previous.projectedEnd = next.projectedEnd
    } else if (
      next.kind === 'generated' &&
      previous?.kind === 'generated' &&
      previous.projectedEnd === next.projectedStart &&
      previous.sourcePosition === next.sourcePosition &&
      previous.affinity === next.affinity
    ) {
      previous.projectedEnd = next.projectedEnd
    } else {
      target.push(next)
    }
  }
}

function applyGeneratedInsertions(
  candidateSource: string,
  candidateSegments: readonly MutableProjectionSegment[],
  insertions: readonly PlannedGeneratedInsertion[]
): ProjectionCodecResult {
  return applyGeneratedCodecEdits(
    candidateSource,
    candidateSegments,
    insertions.map((insertion): PlannedGeneratedReplacement =>
      Object.freeze({
        candidateStart: insertion.candidateOffset,
        candidateEnd: insertion.candidateOffset,
        text: insertion.text,
        sourcePosition: insertion.sourcePosition,
        affinity: insertion.affinity
      }))
  )
}

function applyGeneratedCodecEdits(
  candidateSource: string,
  candidateSegments: readonly MutableProjectionSegment[],
  replacements: readonly PlannedGeneratedReplacement[]
): ProjectionCodecResult {
  if (replacements.length === 0) {
    return unchangedProjectionCodecResult(candidateSource, candidateSegments)
  }
  const orderedReplacements = [...replacements].sort((left, right) =>
    left.candidateStart - right.candidateStart ||
    left.candidateEnd - right.candidateEnd
  )
  const chunks: string[] = []
  const segments: MutableProjectionSegment[] = []
  let candidateCursor = 0
  let projectedLength = 0
  for (const replacement of orderedReplacements) {
    if (
      replacement.candidateStart < candidateCursor ||
      replacement.candidateEnd < replacement.candidateStart ||
      replacement.candidateEnd > candidateSource.length
    ) {
      throw new Error('Projection codec replacement is invalid')
    }
    chunks.push(candidateSource.slice(candidateCursor, replacement.candidateStart))
    appendProjectionRange(
      segments,
      candidateSegments,
      candidateCursor,
      replacement.candidateStart,
      projectedLength
    )
    projectedLength += replacement.candidateStart - candidateCursor
    if (replacement.text.length > 0) {
      chunks.push(replacement.text)
      segments.push({
        kind: 'generated',
        projectedStart: projectedLength,
        projectedEnd: projectedLength + replacement.text.length,
        sourcePosition: replacement.sourcePosition,
        affinity: replacement.affinity
      })
      projectedLength += replacement.text.length
    }
    candidateCursor = replacement.candidateEnd
  }
  chunks.push(candidateSource.slice(candidateCursor))
  appendProjectionRange(
    segments,
    candidateSegments,
    candidateCursor,
    candidateSource.length,
    projectedLength
  )
  const mapOffset = Object.freeze((
    candidateOffset: number,
    affinity: 'previous' | 'next'
  ): number => {
    if (
      !Number.isInteger(candidateOffset) ||
      candidateOffset < 0 ||
      candidateOffset > candidateSource.length
    ) {
      throw new RangeError('Projection codec offset is outside its candidate')
    }
    let delta = 0
    for (const replacement of orderedReplacements) {
      const removedLength =
        replacement.candidateEnd - replacement.candidateStart
      const insertedLength = replacement.text.length
      if (candidateOffset < replacement.candidateStart) {
        break
      }
      if (
        candidateOffset === replacement.candidateStart &&
        removedLength === 0
      ) {
        return candidateOffset + delta +
          (affinity === 'next' ? insertedLength : 0)
      }
      if (candidateOffset < replacement.candidateEnd) {
        return replacement.candidateStart + delta +
          (affinity === 'next' ? insertedLength : 0)
      }
      delta += insertedLength - removedLength
      if (candidateOffset === replacement.candidateEnd) {
        return candidateOffset + delta
      }
    }
    return candidateOffset + delta
  })
  return Object.freeze({
    source: chunks.join(''),
    segments: Object.freeze(segments),
    mapOffset
  })
}

function applyProtections(
  candidateSource: string,
  candidateSegments: readonly MutableProjectionSegment[],
  protections: readonly PlannedProtection[]
): ProjectionCodecResult {
  return applyGeneratedInsertions(
    candidateSource,
    candidateSegments,
    protections.map((protection): PlannedGeneratedInsertion => Object.freeze({
      candidateOffset: protection.candidateOffset,
      text: '\\',
      sourcePosition: protection.sourcePosition,
      affinity: 'next'
    }))
  )
}

const EMPTY_ARM_BOUNDARY_PROJECTION_EDITS: readonly MarkdownArmBoundaryProjectionEdit[] =
  Object.freeze([])

/** Whether any node in the forest, at any depth, has one of these kinds. */
function forestContainsKind(
  nodes: readonly CriticMarkupNode[],
  kinds: ReadonlySet<CriticMarkupNode['kind']>
): boolean {
  const pending = [...nodes]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) {
      continue
    }
    if (kinds.has(node.kind)) {
      return true
    }
    for (const arm of node.arms) {
      pending.push(...arm.children)
    }
  }
  return false
}

/** The forms Original and Revised resolve differently; the rest render alike. */
const VIEW_DIVERGENT_KINDS: ReadonlySet<CriticMarkupNode['kind']> =
  new Set(['addition', 'deletion', 'substitution'])

const EDITING_DIFFERS_FROM_REVISED: ReadonlySet<CriticMarkupNode['kind']> =
  new Set(['deletion', 'substitution'])
const EDITING_DIFFERS_FROM_ORIGINAL: ReadonlySet<CriticMarkupNode['kind']> =
  new Set(['addition', 'substitution'])

function applyMarkdownArmBoundaryProjectionEdits(
  candidateSource: string,
  candidateSegments: readonly MutableProjectionSegment[],
  edits: readonly MarkdownArmBoundaryProjectionEdit[]
): ProjectionCodecResult {
  const insertions: PlannedGeneratedInsertion[] = []
  const replacements: PlannedGeneratedReplacement[] = []
  for (const edit of edits) {
    if (edit.kind === 'separate-following-block') {
      if (
        !Number.isInteger(edit.sourcePosition) ||
        edit.sourcePosition < 0
      ) {
        throw new Error('Block-separation projection codec lost its boundary')
      }
      insertions.push(Object.freeze({
        candidateOffset: edit.candidateOffset,
        text: edit.lineEnding,
        sourcePosition: edit.sourcePosition,
        affinity: 'next'
      }))
      const elision = edit.indentationElision
      if (elision !== undefined) {
        const length = elision.candidateEnd - elision.candidateStart
        const identity = canonicalMarkerIdentity(
          candidateSegments,
          elision.candidateStart,
          length
        )
        const trivia = candidateSource.slice(
          elision.candidateStart,
          elision.candidateEnd
        )
        if (
          length <= 0 ||
          elision.sourceEnd - elision.sourceStart !== length ||
          identity?.sourceStart !== elision.sourceStart ||
          !Array.from(trivia).every((codeUnit) =>
            codeUnit === ' ' || codeUnit === '\t'
          )
        ) {
          throw new Error(
            'Block-separation projection codec lost its indentation trivia'
          )
        }
        replacements.push(Object.freeze({
          candidateStart: elision.candidateStart,
          candidateEnd: elision.candidateEnd,
          text: '',
          sourcePosition: elision.sourceStart,
          affinity: 'next'
        }))
      }
      continue
    }

    if (edit.kind === 'terminate-fenced-block-fragment') {
      if (
        !Number.isInteger(edit.sourcePosition) ||
        edit.sourcePosition < 0 ||
        !Number.isInteger(edit.delimiterLength) ||
        edit.delimiterLength < 3 ||
        (edit.marker !== '`' && edit.marker !== '~')
      ) {
        throw new Error('Fenced-block projection codec lost its terminal fence')
      }
      const nextCodeUnit = candidateSource.charCodeAt(edit.candidateOffset)
      const followedByLineEnding = nextCodeUnit === 10 || nextCodeUnit === 13
      insertions.push(Object.freeze({
        candidateOffset: edit.candidateOffset,
        text: `${edit.needsLeadingLineEnding ? edit.lineEnding : ''}${
          edit.marker.repeat(edit.delimiterLength)
        }${followedByLineEnding ? '' : edit.lineEnding}`,
        sourcePosition: edit.sourcePosition,
        affinity: 'next'
      }))
      continue
    }

    if (edit.kind === 'protect-delimiter') {
      const origin = projectionOriginAt(candidateSegments, edit.candidateOffset)
      insertions.push(Object.freeze({
        candidateOffset: edit.candidateOffset,
        text: '\\',
        sourcePosition:
          origin.kind === 'canonical'
            ? origin.sourceOffset
            : origin.sourcePosition,
        affinity: 'next'
      }))
      continue
    }

    if (edit.kind === 'encode-emphasis-flanking-scalar') {
      const scalarIdentity = canonicalMarkerIdentity(
        candidateSegments,
        edit.candidateStart,
        edit.candidateEnd - edit.candidateStart
      )
      const scalar = candidateSource.slice(
        edit.candidateStart,
        edit.candidateEnd
      )
      if (
        scalarIdentity === undefined ||
        Array.from(scalar).length !== 1 ||
        scalar.codePointAt(0) !== edit.codePoint ||
        !Number.isInteger(edit.codePoint) ||
        edit.codePoint <= 0 ||
        edit.codePoint > 0x10ffff ||
        (edit.codePoint >= 0xd800 && edit.codePoint <= 0xdfff)
      ) {
        throw new Error('Emphasis projection codec lost a flanking scalar')
      }
      replacements.push(Object.freeze({
        candidateStart: edit.candidateStart,
        candidateEnd: edit.candidateEnd,
        text: `&#x${edit.codePoint.toString(16)};`,
        sourcePosition: scalarIdentity.sourceStart,
        affinity: 'next'
      }))
      continue
    }

    if (edit.kind === 'respell-enclosing-emphasis-delimiters') {
      const openerIdentity = canonicalMarkerIdentity(
        candidateSegments,
        edit.openerStart,
        edit.openerEnd - edit.openerStart
      )
      const closerIdentity = canonicalMarkerIdentity(
        candidateSegments,
        edit.closerStart,
        edit.closerEnd - edit.closerStart
      )
      const opener = candidateSource.slice(edit.openerStart, edit.openerEnd)
      const closer = candidateSource.slice(edit.closerStart, edit.closerEnd)
      if (
        openerIdentity === undefined ||
        closerIdentity === undefined ||
        opener.length !== 1 ||
        closer !== opener ||
        (opener !== '*' && opener !== '_') ||
        edit.replacementMarker === opener
      ) {
        throw new Error('Emphasis projection codec lost a canonical delimiter')
      }
      replacements.push(
        Object.freeze({
          candidateStart: edit.openerStart,
          candidateEnd: edit.openerEnd,
          text: edit.replacementMarker,
          sourcePosition: openerIdentity.sourceStart,
          affinity: 'next'
        }),
        Object.freeze({
          candidateStart: edit.closerStart,
          candidateEnd: edit.closerEnd,
          text: edit.replacementMarker,
          sourcePosition: closerIdentity.sourceStart,
          affinity: 'next'
        })
      )
      continue
    }

    const openerIdentity = canonicalMarkerIdentity(
      candidateSegments,
      edit.openerStart,
      edit.openerEnd - edit.openerStart
    )
    const closerIdentity = canonicalMarkerIdentity(
      candidateSegments,
      edit.closerStart,
      edit.closerEnd - edit.closerStart
    )
    const existingDelimiterLength = edit.openerEnd - edit.openerStart
    const extensionLength = edit.delimiterLength - existingDelimiterLength
    if (
      openerIdentity === undefined ||
      closerIdentity === undefined ||
      existingDelimiterLength <= 0 ||
      edit.closerEnd - edit.closerStart !== existingDelimiterLength ||
      extensionLength <= 0
    ) {
      throw new Error('Inline-code projection codec lost a canonical delimiter')
    }
    const generatedBackticks = '`'.repeat(extensionLength)
    insertions.push(
      Object.freeze({
        candidateOffset: edit.openerStart,
        text: generatedBackticks,
        sourcePosition: openerIdentity.sourceStart,
        affinity: 'next'
      }),
      Object.freeze({
        candidateOffset: edit.closerStart,
        text: generatedBackticks,
        sourcePosition: closerIdentity.sourceStart,
        affinity: 'next'
      })
    )
  }
  return applyGeneratedCodecEdits(
    candidateSource,
    candidateSegments,
    [
      ...replacements,
      ...insertions.map((insertion): PlannedGeneratedReplacement =>
        Object.freeze({
          candidateStart: insertion.candidateOffset,
          candidateEnd: insertion.candidateOffset,
          text: insertion.text,
          sourcePosition: insertion.sourcePosition,
          affinity: insertion.affinity
        })
      )
    ]
  )
}

function encodeMovedBofText(
  candidateSource: string,
  candidateSegments: readonly MutableProjectionSegment[]
): ProjectionCodecResult {
  if (candidateSource.charCodeAt(0) !== 0xfeff) {
    return unchangedProjectionCodecResult(candidateSource, candidateSegments)
  }
  const origin = projectionOriginAt(candidateSegments, 0)
  if (origin.kind === 'canonical' && origin.sourceOffset === 0) {
    return unchangedProjectionCodecResult(candidateSource, candidateSegments)
  }
  const sourcePosition = origin.kind === 'canonical' ? origin.sourceOffset : origin.sourcePosition
  const entity = '&#xFEFF;'
  return applyGeneratedCodecEdits(
    candidateSource,
    candidateSegments,
    Object.freeze([Object.freeze({
      candidateStart: 0,
      candidateEnd: 1,
      text: entity,
      sourcePosition,
      affinity: 'next' as const
    })])
  )
}

function guardProjectionCandidate(
  candidateSource: string,
  candidateSegments: readonly MutableProjectionSegment[],
  markerDecisions: readonly CanonicalMarkerDecision[],
  projectedMarkdownLiterals: readonly MarkdownLiteralRange[]
): Readonly<{
    source: string
    segments: readonly MutableProjectionSegment[]
    acceptedMarkerCount: number
    mapOffset: (
      candidateOffset: number,
      affinity: 'previous' | 'next'
    ) => number
  }> {
  const decisionByIdentity = new Map<string, CanonicalMarkerDecision>()
  for (const decision of markerDecisions) {
    decisionByIdentity.set(`${decision.runId}:${decision.kind}:${decision.role}`, decision)
  }

  /*
   * The intrinsic fork parser supplies Markdown literal ownership for this
   * branch. The canonical parse already emitted the complete delimiter
   * decision stream, so a projection may retain only decisions with the same
   * source identity and stack topology.
   */
  let literalIndex = 0
  const markerIsMarkdownOwned = (
    markerStart: number,
    compatibleCloser: boolean
  ): boolean => {
    while (
      (projectedMarkdownLiterals[literalIndex]?.end ?? Number.POSITIVE_INFINITY) <=
      markerStart
    ) {
      literalIndex += 1
    }
    const literal = projectedMarkdownLiterals[literalIndex]
    return !compatibleCloser &&
      literal !== undefined &&
      literal.start <= markerStart &&
      markerStart < literal.end
  }
  const markerIsBackslashProtected = (markerStart: number): boolean => {
    let precedingBackslashes = 0
    for (
      let offset = markerStart - 1;
      offset >= 0 && candidateSource.charCodeAt(offset) === 92;
      offset -= 1
    ) {
      precedingBackslashes += 1
    }
    return precedingBackslashes % 2 === 1
  }

  type RetainedOpen = Readonly<{
    readonly kind: Profile1CriticKind
    readonly runId: number
    readonly separatorSeen: boolean
  }>
  const retainedStack: RetainedOpen[] = []
  const canonicalDecisionAt = (
    markerStart: number,
    markerLength: number,
    kind: Profile1CriticKind,
    role: MarkerRole
  ): CanonicalMarkerDecision | undefined => {
    const markerIdentity = canonicalMarkerIdentity(
      candidateSegments,
      markerStart,
      markerLength
    )
    return markerIdentity === undefined
      ? undefined
      : decisionByIdentity.get(
        `${markerIdentity.sourceRunId}:${kind}:${role}`
      )
  }
  const topologyMatches = (
    decision: CanonicalMarkerDecision | undefined,
    kind: Profile1CriticKind,
    role: MarkerRole
  ): boolean => {
    if (decision === undefined || decision.kind !== kind || decision.role !== role) {
      return false
    }
    const top = retainedStack.at(-1)
    if (role === 'open' && decision.role === 'open') {
      return decision.parentOpenRunId === (top?.runId ?? null)
    }
    if (role === 'separator' && decision.role === 'separator') {
      return (
        top?.kind === 'substitution' &&
        !top.separatorSeen &&
        decision.openerRunId === top.runId
      )
    }
    if (role !== 'close' || decision.role !== 'close') {
      return false
    }
    let compatible: RetainedOpen | undefined
    for (let index = retainedStack.length - 1; index >= 0; index -= 1) {
      const open = retainedStack[index]
      if (open?.kind === kind) {
        compatible = open
        break
      }
    }
    const action =
      top === undefined
        ? 'unmatched'
        : top.kind === kind
          ? 'matched'
          : compatible === undefined
            ? 'unmatched'
            : 'non-top'
    return decision.action === action &&
      decision.openerRunId === compatible?.runId &&
      decision.topOpenRunId === (
        action === 'non-top' ? top?.runId : undefined
      )
  }

  const protections: PlannedProtection[] = []
  const protectedOffsets = new Set<number>()
  let retainedRootCount = 0
  let candidateOffset = 0
  while (candidateOffset < candidateSource.length) {
    const marker = findMarker(candidateSource, candidateOffset)
    if (marker === undefined) {
      candidateOffset += 1
      continue
    }
    const kind = marker.definition.kind
    const top = retainedStack.at(-1)
    const compatibleCloser =
      marker.role === 'close' && top?.kind === kind
    if (
      markerIsBackslashProtected(candidateOffset) ||
      markerIsMarkdownOwned(candidateOffset, compatibleCloser)
    ) {
      candidateOffset += 1
      continue
    }
    const decision = canonicalDecisionAt(
      candidateOffset,
      marker.length,
      kind,
      marker.role
    )
    if (!topologyMatches(decision, kind, marker.role)) {
      const protectionOffset =
        marker.role === 'close'
          ? candidateOffset + marker.length - 1
          : candidateOffset
      if (!protectedOffsets.has(protectionOffset)) {
        protectedOffsets.add(protectionOffset)
        const responsibleOrigin = projectionOriginAt(
          candidateSegments,
          protectionOffset
        )
        protections.push(Object.freeze({
          candidateOffset: protectionOffset,
          sourcePosition:
            responsibleOrigin.kind === 'canonical'
              ? responsibleOrigin.sourceOffset
              : responsibleOrigin.sourcePosition
        }))
      }
      // The canonical recognizer consumes one code unit for a rejected
      // delimiter so overlapping spellings remain observable.
      candidateOffset += 1
      continue
    }
    if (decision === undefined) {
      throw new Error('Projection delimiter topology lost its canonical decision')
    }
    if (decision.role === 'open') {
      retainedStack.push(Object.freeze({
        kind,
        runId: decision.runId,
        separatorSeen: false
      }))
    } else if (decision.role === 'separator') {
      const retained = retainedStack.pop()
      if (retained === undefined) {
        throw new Error('Projection separator lost its retained opener')
      }
      retainedStack.push(Object.freeze({
        ...retained,
        separatorSeen: true
      }))
    } else if (decision.action === 'matched') {
      if (
        retainedStack.length === 1 &&
        (
          top?.kind !== 'substitution' ||
          top.separatorSeen
        )
      ) {
        retainedRootCount += 1
      }
      retainedStack.pop()
    }
    candidateOffset += marker.length
  }
  const protected_ = applyProtections(candidateSource, candidateSegments, protections)
  return Object.freeze({
    source: protected_.source,
    segments: protected_.segments,
    acceptedMarkerCount: retainedRootCount,
    mapOffset: protected_.mapOffset
  })
}

type ProjectionLineEnding = '\n' | '\r' | '\r\n'

function lastProjectionLineEnding(
  source: string,
  start: number,
  end: number
): ProjectionLineEnding {
  for (let offset = end - 1; offset >= start; offset -= 1) {
    const codeUnit = source.charCodeAt(offset)
    if (codeUnit === 10) {
      return offset > start && source.charCodeAt(offset - 1) === 13
        ? '\r\n'
        : '\n'
    }
    if (codeUnit === 13) {
      return '\r'
    }
  }
  return '\n'
}

function terminalArmFenceEdit(
  lane: IntrinsicProfile1ForkLane,
  candidateOffset: number,
  sourcePosition: number,
  source: string
): Extract<
  MarkdownArmBoundaryProjectionEdit,
  { readonly kind: 'terminate-fenced-block-fragment' }
> | undefined {
  for (
    let transitionIndex = lane.transitions.length - 1;
    transitionIndex >= 0;
    transitionIndex -= 1
  ) {
    const transition = lane.transitions[transitionIndex]
    if (transition?.operation !== 'finish-lane') {
      continue
    }
    const fence = transition.entryCheckpoint.fence
    if (
      fence === undefined ||
      !transition.emittedFacts.literals.some((literal) =>
        literal.kind === fence.provider &&
        literal.start === fence.openStart &&
        literal.end === lane.range.end
      )
    ) {
      return undefined
    }
    if (
      (fence.markerCodeUnit !== 96 && fence.markerCodeUnit !== 126) ||
      fence.openerLength < 3
    ) {
      throw new Error('Parser-owned terminal fence evidence is invalid')
    }
    return Object.freeze({
      kind: 'terminate-fenced-block-fragment',
      candidateOffset,
      sourcePosition,
      marker: fence.markerCodeUnit === 96 ? '`' : '~',
      delimiterLength: fence.openerLength,
      lineEnding: lastProjectionLineEnding(
        source,
        fence.openStart,
        lane.range.end
      ),
      needsLeadingLineEnding: transition.entryCheckpoint.linePath !== undefined
    })
  }
  return undefined
}

function soleLineEndingBeforeFence(
  source: string,
  branchEnd: number,
  fenceStart: number
): ProjectionLineEnding | undefined {
  const gap = source.slice(branchEnd, fenceStart)
  const match = /^(\r\n|\r|\n)[\t ]{0,3}$/.exec(gap)
  const lineEnding = match?.[1]
  return lineEnding === '\n' || lineEnding === '\r' || lineEnding === '\r\n'
    ? lineEnding
    : undefined
}

// Sorted openStarts of every fence the lane's parse actually emitted, built
// once per lane and shared by every view's projection (lanes are immutable).
// Arm-exit termination planning was quadratic without this: each exit
// rescanned the parent lane's full transition list (measured 8,256 probes for
// 64 arms before the index).
const ARM_TERMINATION_FENCE_INDEX = new WeakMap<
  IntrinsicProfile1ForkLane,
  readonly number[]
>()

function armTerminationFenceOpens(
  parentLane: IntrinsicProfile1ForkLane
): readonly number[] {
  const cached = ARM_TERMINATION_FENCE_INDEX.get(parentLane)
  if (cached !== undefined) {
    return cached
  }
  const opens: number[] = []
  for (const transition of parentLane.transitions) {
    const fence = transition.entryCheckpoint.fence
    if (
      fence !== undefined &&
      transition.emittedFacts.literals.some((literal) =>
        literal.kind === fence.provider &&
        literal.start === fence.openStart
      )
    ) {
      opens.push(fence.openStart)
    }
  }
  opens.sort((left, right) => left - right)
  const frozen = Object.freeze(opens)
  ARM_TERMINATION_FENCE_INDEX.set(parentLane, frozen)
  return frozen
}

// The gap grammar (exactly one line ending plus at most three columns of
// indentation) caps a matching fence at five code units past the branch end,
// and a farther fence can never match because the nearer fence's own marker
// bytes sit inside its gap — so only the successor fence needs probing.
const ARM_TERMINATION_FENCE_GAP_LIMIT = 5

function followingFencedBlockLineEnding(
  parentLane: IntrinsicProfile1ForkLane,
  branchEnd: number,
  source: string,
  probe?: (start: number, end: number) => void
): ProjectionLineEnding | undefined {
  const opens = armTerminationFenceOpens(parentLane)
  let low = 0
  let high = opens.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if ((opens[middle] ?? Number.POSITIVE_INFINITY) <= branchEnd) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  const fenceStart = opens[low]
  if (fenceStart === undefined) {
    return undefined
  }
  probe?.(branchEnd, fenceStart)
  if (fenceStart - branchEnd > ARM_TERMINATION_FENCE_GAP_LIMIT) {
    return undefined
  }
  return soleLineEndingBeforeFence(source, branchEnd, fenceStart)
}

function canonicalLineEndingAt(
  parentLane: IntrinsicProfile1ForkLane,
  branchEnd: number,
  source: string
): ProjectionLineEnding | undefined {
  const lineEnding: ProjectionLineEnding | undefined =
    source.startsWith('\r\n', branchEnd)
      ? '\r\n'
      : source.charCodeAt(branchEnd) === 13
        ? '\r'
        : source.charCodeAt(branchEnd) === 10
          ? '\n'
          : undefined
  if (lineEnding === undefined) {
    return undefined
  }
  const lineEndingEnd = branchEnd + lineEnding.length
  let consumedCursor = branchEnd
  for (const transition of parentLane.transitions) {
    for (const slice of transition.consumed) {
      if (slice.range.end <= consumedCursor) {
        continue
      }
      if (slice.range.start > consumedCursor) {
        return undefined
      }
      consumedCursor = Math.min(lineEndingEnd, slice.range.end)
      if (consumedCursor === lineEndingEnd) {
        return lineEnding
      }
    }
  }
  return undefined
}

function armCreatedTerminalParagraph(
  lane: IntrinsicProfile1ForkLane
): MarkdownPendingLineBlockFact | undefined {
  const entry = lane.entryCheckpoint
  if (
    entry.linePath !== undefined ||
    entry.paragraphOpen ||
    entry.activeContainers.length !== 0
  ) {
    return undefined
  }
  let terminal: MarkdownPendingLineBlockFact | undefined
  for (
    let index = lane.transitions.length - 1;
    index >= 0;
    index -= 1
  ) {
    const transition = lane.transitions[index]
    if (transition?.operation === 'finish-lane') {
      terminal = transition.emittedFacts.block.pendingLine
      break
    }
  }
  return terminal?.paragraphOpen === true &&
    terminal.containerPath.every((kind) =>
      kind === 'blockquote' || kind === 'list-item'
    )
    ? terminal
    : undefined
}

function laneRetainsUnchangedSourceRange(
  lane: IntrinsicProfile1ForkLane,
  start: number,
  end: number
): boolean {
  if (start < lane.range.start || end <= start || end > lane.range.end) {
    return false
  }
  let cursor = start
  for (const item of lane.items) {
    const range = item.kind === 'source' ? item.range : item.node.range
    if (range.end <= cursor) {
      continue
    }
    if (range.start > cursor || item.kind !== 'source') {
      return false
    }
    cursor = Math.min(end, range.end)
    if (cursor === end) {
      return true
    }
  }
  return false
}

function followingCanonicalLineMergingParagraph(
  parentLane: IntrinsicProfile1ForkLane,
  branchEnd: number,
  lineEnding: ProjectionLineEnding
): MarkdownPendingLineBlockFact | undefined {
  const suffixStart = branchEnd + lineEnding.length
  if (!laneRetainsUnchangedSourceRange(
    parentLane,
    branchEnd,
    suffixStart
  )) {
    return undefined
  }
  for (const transition of parentLane.transitions) {
    const pendingLine = transition.emittedFacts.block.pendingLine
    if (
      transition.exitCheckpoint.lineStart >= suffixStart &&
      pendingLine?.continuesExistingParagraph === true &&
      transition.consumed.some((slice) => slice.range.end > suffixStart)
    ) {
      return pendingLine
    }
  }
  return undefined
}

interface TerminalArmParagraphSeparation {
  readonly lineEnding: ProjectionLineEnding
  readonly indentationElision?: Readonly<{
    readonly sourceStart: number
    readonly sourceEnd: number
  }>
}

function terminalListIndentationElision(
  terminal: MarkdownPendingLineBlockFact,
  following: MarkdownPendingLineBlockFact,
  parentLane: IntrinsicProfile1ForkLane,
  branchEnd: number,
  lineEnding: ProjectionLineEnding
): Readonly<{ readonly sourceStart: number; readonly sourceEnd: number }> |
  undefined {
  const terminalList = terminal.containers[0]
  if (
    terminal.containers.length !== 1 ||
    terminalList?.kind !== 'list-item' ||
    following.containerPath.length !== 1 ||
    following.containerPath[0] !== 'list-item'
  ) {
    return undefined
  }
  const continuation = following.listContinuationIndentations.find(
    (indentation) =>
      indentation.containerDepth === 1 &&
      indentation.contentIndent === terminalList.contentIndent
  )
  if (continuation === undefined) {
    return undefined
  }
  const suffixStart = branchEnd + lineEnding.length
  if (
    continuation.trivia.start < suffixStart ||
    continuation.exitTrivia.start < continuation.trivia.start ||
    continuation.exitTrivia.end > continuation.trivia.end ||
    !laneRetainsUnchangedSourceRange(
      parentLane,
      branchEnd,
      continuation.trivia.end
    )
  ) {
    return undefined
  }
  return Object.freeze({
    sourceStart: continuation.exitTrivia.start,
    sourceEnd: continuation.exitTrivia.end
  })
}

function terminalArmParagraphSeparation(
  lane: IntrinsicProfile1ForkLane,
  parentLane: IntrinsicProfile1ForkLane,
  branchEnd: number,
  source: string
): TerminalArmParagraphSeparation | undefined {
  const terminal = armCreatedTerminalParagraph(lane)
  if (terminal === undefined) {
    return undefined
  }
  const lineEnding = canonicalLineEndingAt(parentLane, branchEnd, source)
  if (lineEnding === undefined) {
    return undefined
  }
  const following = followingCanonicalLineMergingParagraph(
    parentLane,
    branchEnd,
    lineEnding
  )
  if (following === undefined) {
    return undefined
  }
  const indentationElision = terminalListIndentationElision(
    terminal,
    following,
    parentLane,
    branchEnd,
    lineEnding
  )
  return indentationElision === undefined
    ? Object.freeze({ lineEnding })
    : Object.freeze({ lineEnding, indentationElision })
}

interface PreparedProfile1Projection {
  readonly source: string
  readonly mappedTape: readonly MappedProjectionSegment[]
  readonly provenance: ProjectionProvenance
  readonly forkLane: IntrinsicProfile1ForkLane
  readonly markdownLane: MappedMarkdownLane
  readonly traceView: ProfileParseTraceViewV1
}

function prepareProjection(
  graph: Profile1SyntaxGraphCore,
  view: ProjectionView,
  lane: IntrinsicProfile1ForkLane = graph.forkGraph.root,
  markdownDepthLimit: number = Number.POSITIVE_INFINITY,
  traceRecorder?: ProfileParseTraceRecorderV1,
  traceView: ProfileParseTraceViewV1 = view,
  markdownOptions: MarkdownOptionsV1 = DEFAULT_MARKDOWN_OPTIONS,
  forkParser?: Profile1MarkdownForkParser
): PreparedProfile1Projection {
  if (forkParser === undefined) {
    throw new Error('Projected Markdown requires the revision intrinsic fork parser')
  }
  if (traceView === 'comment-display') {
    recordCommentProjectionPreparationV1(lane.range.end - lane.range.start)
  }
  const source = graph.source
  const chunks: string[] = []
  const segments: MutableCanonicalProjectionSegment[] = []
  const tasks: ProjectionTask[] = [{ kind: 'lane', lane }]
  const openMatchingScopes = new Map<
    number,
    Readonly<{ readonly start: number; readonly depth: number }>
  >()
  const matchingScopes: MappedMarkdownMatchingScope[] = []
  const armTerminationEdits: MarkdownArmBoundaryProjectionEdit[] = []
  let projectedLength = 0

  const appendSource = (start: number, end: number): void => {
    if (start === end) {
      return
    }
    chunks.push(source.slice(start, end))
    let low = 0
    let high = graph.canonicalTape.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if ((graph.canonicalTape[middle]?.range.end ?? Number.POSITIVE_INFINITY) <= start) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    let sourceCursor = start
    for (let tapeIndex = low; sourceCursor < end; tapeIndex += 1) {
      const run = graph.canonicalTape[tapeIndex]
      if (run === undefined || sourceCursor < run.range.start) {
        throw new Error('Canonical projection lost its source tape identity')
      }
      const sliceEnd = Math.min(end, run.range.end)
      const length = sliceEnd - sourceCursor
      const previous = segments[segments.length - 1]
      if (
        previous !== undefined &&
        previous.sourceRunId === run.id &&
        previous.projectedEnd === projectedLength &&
        previous.sourceStart + previous.projectedEnd - previous.projectedStart === sourceCursor
      ) {
        previous.projectedEnd += length
      } else {
        segments.push({
          kind: 'canonical',
          projectedStart: projectedLength,
          projectedEnd: projectedLength + length,
          sourceRunId: run.id,
          sourceStart: sourceCursor
        })
      }
      projectedLength += length
      sourceCursor = sliceEnd
    }
  }

  while (tasks.length > 0) {
    const task = tasks.pop()
    if (task === undefined) {
      break
    }
    if (task.kind === 'append') {
      appendSource(task.start, task.end)
      continue
    }
    if (task.kind === 'arm-boundary') {
      if (task.event.role === 'enter') {
        if (openMatchingScopes.has(task.laneId)) {
          throw new Error('Projected Substitution arm entered twice')
        }
        openMatchingScopes.set(task.laneId, Object.freeze({
          start: projectedLength,
          depth: openMatchingScopes.size
        }))
      } else {
        const open = openMatchingScopes.get(task.laneId)
        if (open === undefined) {
          throw new Error('Projected Substitution arm exited before entry')
        }
        openMatchingScopes.delete(task.laneId)
        const terminalFence = terminalArmFenceEdit(
          task.lane,
          projectedLength,
          task.event.sourcePosition,
          source
        )
        if (terminalFence !== undefined) {
          armTerminationEdits.push(terminalFence)
        } else if (
          task.lane.exitCheckpoint.linePath !== undefined &&
          task.lane.exitCheckpoint.frontMatter === undefined &&
          task.lane.exitCheckpoint.indentedCode === undefined &&
          task.lane.exitCheckpoint.htmlBlock === undefined &&
          task.lane.exitCheckpoint.definition === undefined
        ) {
          const paragraphSeparation = terminalArmParagraphSeparation(
            task.lane,
            task.parentLane,
            task.branchEnd,
            source
          )
          const lineEnding = paragraphSeparation?.lineEnding ??
            followingFencedBlockLineEnding(
              task.parentLane,
              task.branchEnd,
              source,
              traceRecorder === undefined
                ? undefined
                : (start, end) => {
                  traceRecorder.recordArmTerminationFenceProbe(
                    traceView,
                    start,
                    end
                  )
                }
            )
          if (lineEnding !== undefined) {
            const sourceElision = paragraphSeparation?.indentationElision
            armTerminationEdits.push(sourceElision === undefined
              ? Object.freeze({
                kind: 'separate-following-block',
                candidateOffset: projectedLength,
                sourcePosition: task.event.sourcePosition,
                lineEnding
              })
              : Object.freeze({
                kind: 'separate-following-block',
                candidateOffset: projectedLength,
                sourcePosition: task.event.sourcePosition,
                lineEnding,
                indentationElision: Object.freeze({
                  candidateStart:
                    projectedLength + sourceElision.sourceStart - task.branchEnd,
                  candidateEnd:
                    projectedLength + sourceElision.sourceEnd - task.branchEnd,
                  sourceStart: sourceElision.sourceStart,
                  sourceEnd: sourceElision.sourceEnd
                })
              }))
          }
        }
        if (open.start < projectedLength) {
          matchingScopes.push(Object.freeze({
            id: task.laneId + 1,
            start: open.start,
            end: projectedLength,
            depth: open.depth
          }))
        }
      }
      continue
    }

    const orderedTasks: ProjectionTask[] = []
    for (const item of task.lane.items) {
      if (item.kind === 'source') {
        orderedTasks.push({
          kind: 'append',
          start: item.range.start,
          end: item.range.end
        })
        continue
      }
      for (const arm of selectedCanonicalArms(item, view)) {
        const boundaries = arm.armBoundaries
        // A Substitution arm carries parser-owned enter/exit boundary events; a
        // unary-form arm has none. Key on that, so the editing view's two
        // Substitution arms each emit their boundary pair without special-casing
        // the view.
        if (boundaries.length === 2) {
          const enter = boundaries[0]
          const exit = boundaries[1]
          if (
            enter?.role !== 'enter' ||
            exit?.role !== 'exit' ||
            enter.sourcePosition !== arm.range.start ||
            exit.sourcePosition !== arm.range.end
          ) {
            throw new Error(
              'Selected Substitution arm lost parser-owned boundary events'
            )
          }
          orderedTasks.push(
            {
              kind: 'arm-boundary',
              laneId: arm.id,
              event: enter,
              lane: arm,
              parentLane: task.lane,
              branchEnd: item.node.range.end
            },
            { kind: 'lane', lane: arm },
            {
              kind: 'arm-boundary',
              laneId: arm.id,
              event: exit,
              lane: arm,
              parentLane: task.lane,
              branchEnd: item.node.range.end
            }
          )
        } else if (boundaries.length === 0) {
          orderedTasks.push({ kind: 'lane', lane: arm })
        } else {
          throw new Error('Canonical arm has an unexpected boundary count')
        }
      }
    }
    for (let index = orderedTasks.length - 1; index >= 0; index -= 1) {
      const orderedTask = orderedTasks[index]
      if (orderedTask !== undefined) {
        tasks.push(orderedTask)
      }
    }
  }

  if (openMatchingScopes.size !== 0) {
    throw new Error('Projected Substitution arm boundary was not closed')
  }

  const projectedSource = chunks.join('')
  const canonicalIdentityRuns = canonicalIdentityRunsFor(segments)
  // Boundary edits arise only from Substitution-arm scopes and arm terminations
  // (with no scopes the boundary policy is undefined). With neither, planning
  // provably yields no edits, so the intrinsic fork parser skips that branch
  // analysis.
  const armBoundaryProjectionEdits =
    matchingScopes.length === 0 && armTerminationEdits.length === 0
      ? EMPTY_ARM_BOUNDARY_PROJECTION_EDITS
      : forkParser.planArmBoundaryEdits(lane, {
        source: projectedSource,
        forkView: view,
        frontMatterEnabled: markdownOptions.frontMatter,
        gfmEnabled: markdownOptions.gfm,
        mathEnabled: markdownOptions.math,
        gitLabMathEnabled: markdownOptions.gitLabMath,
        footnotesEnabled: markdownOptions.footnotes,
        subscriptAndSuperscriptEnabled:
          markdownOptions.subscriptAndSuperscript,
        matchingScopes: Object.freeze(matchingScopes),
        canonicalIdentityRuns,
        armTerminationEdits: Object.freeze(armTerminationEdits)
      }, markdownDepthLimit, traceRecorder === undefined
        ? undefined
        : Object.freeze({ view: traceView, recorder: traceRecorder }))
  const armSafe = applyMarkdownArmBoundaryProjectionEdits(
    projectedSource,
    segments,
    armBoundaryProjectionEdits
  )
  let retainedMatchingScopes = mapMatchingScopesThrough(
    matchingScopes,
    armSafe
  )
  const bofSafe = encodeMovedBofText(armSafe.source, armSafe.segments)
  retainedMatchingScopes = mapMatchingScopesThrough(
    retainedMatchingScopes,
    bofSafe
  )
  // The boundary guard exists to catch CriticMarkup that the projection itself
  // synthesized where elision made two non-adjacent canonical runs adjacent. A
  // document with no CriticMarkup elides nothing: every view is the canonical
  // source, there is no join, and no marker can be manufactured. Recognizing
  // CriticMarkup again to discover that is pure waste, so the guard is skipped
  // and its accepted-marker count is zero by construction.
  const needsProjectionGuard =
    graph.criticMarkup.rootCount !== 0 &&
    CRITIC_MARKER_TOKEN.test(bofSafe.source)
  const projectedMarkdownLiterals =
    needsProjectionGuard
      ? forkParser.admitLiteralFacts(
        lane,
        Object.freeze({
          source: bofSafe.source,
          forkView: view,
          frontMatterEnabled: markdownOptions.frontMatter,
          gfmEnabled: markdownOptions.gfm,
          mathEnabled: markdownOptions.math,
          gitLabMathEnabled: markdownOptions.gitLabMath,
          footnotesEnabled: markdownOptions.footnotes,
          subscriptAndSuperscriptEnabled:
            markdownOptions.subscriptAndSuperscript,
          matchingScopes: retainedMatchingScopes,
          canonicalIdentityRuns: canonicalIdentityRunsFor(bofSafe.segments)
        }),
        markdownDepthLimit,
        traceRecorder === undefined
          ? undefined
          : Object.freeze({ view: traceView, recorder: traceRecorder })
      )
      : Object.freeze([])
  const guarded =
    !needsProjectionGuard
      ? Object.freeze({
        ...unchangedProjectionCodecResult(bofSafe.source, bofSafe.segments),
        acceptedMarkerCount: 0
      })
      : guardProjectionCandidate(
        bofSafe.source,
        bofSafe.segments,
        graph.markerDecisions,
        projectedMarkdownLiterals
      )
  retainedMatchingScopes = mapMatchingScopesThrough(
    retainedMatchingScopes,
    guarded
  )
  const mappedTape = Object.freeze(guarded.segments.map(freezeSegment))
  const guardedIdentityRuns = canonicalIdentityRunsFor(guarded.segments)
  if (guarded.acceptedMarkerCount !== 0) {
    throw new Error('Boundary-safe projection verification produced synthetic CriticMarkup')
  }
  return Object.freeze({
    source: guarded.source,
    mappedTape,
    provenance: createProvenance(guarded.source.length, mappedTape),
    forkLane: lane,
    markdownLane: Object.freeze({
      source: guarded.source,
      forkView: view,
      frontMatterEnabled: markdownOptions.frontMatter,
      gfmEnabled: markdownOptions.gfm,
      mathEnabled: markdownOptions.math,
      gitLabMathEnabled: markdownOptions.gitLabMath,
      footnotesEnabled: markdownOptions.footnotes,
      subscriptAndSuperscriptEnabled:
        markdownOptions.subscriptAndSuperscript,
      matchingScopes: retainedMatchingScopes,
      canonicalIdentityRuns: guardedIdentityRuns,
      syntaxIdentity: Object.freeze({
        registry: graph.syntaxIdentity,
        sourceAt: Object.freeze((
          start: number,
          end: number
        ): SyntaxSourceIdentity =>
          projectedSyntaxSourceIdentity(
            guarded.segments,
            start,
            end,
            graph.source.length,
            lane.range.start
          ))
      })
    }),
    traceView
  })
}

function materializePreparedProjection(
  _graph: Profile1SyntaxGraphCore,
  prepared: PreparedProfile1Projection,
  markdownParse: Profile1MarkdownParse
): Profile1ProjectedMarkdown {
  return Object.freeze({
    source: prepared.source,
    mappedTape: prepared.mappedTape,
    provenance: prepared.provenance,
    markdown: markdownParse.document,
    markdownDepthFailure: markdownParse.containerDepthFailure
  })
}

interface CommentDisplayProjections {
  readonly all: () => readonly Profile1ProjectedMarkdown[]
  readonly byNodeId: (
    comment: NodeId
  ) => Profile1ProjectedMarkdown | undefined
}

interface PreparedCommentDisplayProjection {
  readonly nodeId: NodeId
  readonly key: string
  readonly projection: PreparedProfile1Projection
}

function prepareCommentDisplayProjections(
  graph: Profile1SyntaxGraphCore,
  markdownDepthLimit: number,
  traceRecorder: ProfileParseTraceRecorderV1 | undefined,
  markdownOptions: MarkdownOptionsV1,
  forkParser: Profile1MarkdownForkParser
): readonly PreparedCommentDisplayProjection[] {
  return Object.freeze(graph.forkGraph.branches.flatMap((branch) => {
    if (branch.node.kind !== 'comment') {
      return Object.freeze([])
    }
    const armLane = branch.arms[0]
    if (armLane === undefined) {
      return Object.freeze([])
    }
    const projection = prepareProjection(
      graph,
      'revised',
      armLane,
      markdownDepthLimit,
      traceRecorder,
      'comment-display',
      markdownOptions,
      forkParser
    )
    return Object.freeze([Object.freeze({
      nodeId: branch.node.nodeId,
      key: `comment:${branch.node.nodeId}`,
      projection
    })])
  }))
}

function createCommentDisplayProjections(
  displays: readonly Readonly<{
    readonly nodeId: NodeId
    readonly projection: Profile1ProjectedMarkdown
  }>[]
): CommentDisplayProjections {
  const stableDisplays = Object.freeze([...displays])
  const displayByNodeId = new Map(
    stableDisplays.map((display) =>
      [display.nodeId, display.projection] as const)
  )
  const all = Object.freeze(stableDisplays.map((display) => display.projection))
  return Object.freeze({
    all: Object.freeze((): readonly Profile1ProjectedMarkdown[] => all),
    byNodeId: Object.freeze((
      comment: NodeId
    ): Profile1ProjectedMarkdown | undefined => displayByNodeId.get(comment))
  })
}

function projectedMarkdownDepthDiagnostic(
  projections: readonly Profile1ProjectedMarkdown[],
  limit: number
): ResourceDiagnostic | undefined {
  let earliest:
    | Readonly<{ range: SourceRange; observed: number }>
    | undefined
  for (const projection of projections) {
    const failure = projection.markdownDepthFailure
    if (failure === undefined) {
      continue
    }
    const origin = projection.provenance.originAt(failure.start)
    const start =
      origin.kind === 'canonical' ? origin.sourceOffset : origin.sourcePosition
    const candidate = Object.freeze({
      range: sourceRange(start, start + 1),
      observed: failure.observed
    })
    if (
      earliest === undefined ||
      candidate.range.start < earliest.range.start ||
      (candidate.range.start === earliest.range.start &&
        candidate.range.end < earliest.range.end)
    ) {
      earliest = candidate
    }
  }
  return earliest === undefined
    ? undefined
    : createResourceDiagnostic(
      'CM_RESOURCE_MARKDOWN_DEPTH_EXCEEDED',
      earliest.range,
      limit,
      earliest.observed
    )
}

function createDiagnosticIndex(items: readonly SyntaxDiagnostic[]): DiagnosticIndex {
  const frozenItems = Object.freeze([...items])
  const at = Object.freeze((ordinal: number): SyntaxDiagnostic => {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= frozenItems.length) {
      throw new RangeError('Diagnostic ordinal is outside the revision')
    }
    const item = frozenItems[ordinal]
    if (item === undefined) {
      throw new Error('Diagnostic index invariant failed')
    }
    return item
  })
  return Object.freeze({ count: frozenItems.length, at })
}

/**
 * Recognition accounting is zero only when the intrinsic lexer emitted no
 * CriticMarkup delimiter candidate. The unified grammar still owns and parses
 * every document; this necessary-condition check only classifies its work.
 */
const CRITIC_MARKER_TOKEN = /\{(?:\+\+|--|~~|==|>>)|(?:\+\+|--|~~|==|<<)\}/

function validateChangedJoins(
  sourceLength: number,
  joins: readonly number[]
): void {
  let previous = -1
  for (const join of joins) {
    if (
      !Number.isSafeInteger(join) ||
      join < previous ||
      join > sourceLength
    ) {
      throw new RangeError('Changed source joins must be ordered positions')
    }
    previous = join
  }
}

function hasMarkerCandidateCrossingChangedJoin(
  source: string,
  joins: readonly number[],
  execution: ParseExecutionTracker
): boolean {
  for (const join of joins) {
    // Profile 1 markers are at most three UTF-16 units. Only a spelling that
    // starts in the preceding two units can strictly contain this join.
    for (let start = Math.max(0, join - 2); start < join; start += 1) {
      const marker = findMarker(source, start)
      if (marker !== undefined && join < start + marker.length) {
        return true
      }
    }
    execution.examineParserWork(1)
  }
  return false
}

/**
 * Canonical grammar inspection for protective edits at changed joins.
 *
 * The intrinsic parser authenticates accepted CriticMarkup markers, but this
 * mode deliberately stops before projection AST, ownership, Markup, and view
 * materialization. A transformation can therefore protect its sparse draft
 * and perform one final authoritative document parse instead of retaining an
 * entire unprotected candidate revision beside the input revision.
 */
export function inspectProfile1ChangedCriticMarkerJoins(
  source: string,
  executionBudget: ExecutionBudgetId,
  markdownOptions: MarkdownOptionsV1,
  joins: readonly number[],
  executionControl?: ParseExecutionControl
): Profile1ChangedJoinInspectionResult {
  validateChangedJoins(source.length, joins)
  const usesDesktopLimits = executionBudget.limitsProfile === 'desktop-v1'
  const execution = createParseExecutionTracker(executionControl)
  const finish = <Result extends Profile1ChangedJoinInspectionResult>(
    result: Result
  ): Result => {
    execution.finish()
    return result
  }
  if (
    usesDesktopLimits &&
    source.length > DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
  ) {
    return finish(Object.freeze({
      kind: 'source-only',
      fatalDiagnostic: createResourceDiagnostic(
        'CM_RESOURCE_SOURCE_UNITS_EXCEEDED',
        sourceRange(
          DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits,
          DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
        ),
        DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits,
        source.length
      )
    }))
  }
  if (!hasMarkerCandidateCrossingChangedJoin(source, joins, execution)) {
    return finish(Object.freeze({
      kind: 'inspected',
      protectionPositions: Object.freeze([])
    }))
  }

  const syntaxIdentity = createProfile1SyntaxInspectionRegistry(source.length)
  const parsed = inspectIntrinsicProfile1ChangedJoins(
    source,
    syntaxIdentity,
    usesDesktopLimits ? DESKTOP_CM_DEPTH_LIMIT : Number.POSITIVE_INFINITY,
    usesDesktopLimits
      ? DESKTOP_MARKDOWN_DEPTH_LIMIT
      : Number.POSITIVE_INFINITY,
    markdownOptions,
    execution
  )
  if (parsed.kind === 'resource-failure') {
    return finish(Object.freeze({
      kind: 'source-only',
      fatalDiagnostic: parsed.fatalDiagnostic
    }))
  }

  const acceptedMarkerRunIds = new Set<number>()
  for (const decision of parsed.markerDecisions) {
    if (decision.role !== 'close' || decision.action !== 'matched') {
      continue
    }
    acceptedMarkerRunIds.add(decision.runId)
    if (decision.openerRunId !== undefined) {
      acceptedMarkerRunIds.add(decision.openerRunId)
    }
  }
  for (const decision of parsed.markerDecisions) {
    if (
      decision.role === 'separator' &&
      acceptedMarkerRunIds.has(decision.openerRunId)
    ) {
      acceptedMarkerRunIds.add(decision.runId)
    }
  }

  const positions: number[] = []
  let joinIndex = 0
  for (const decision of parsed.markerDecisions) {
    if (!acceptedMarkerRunIds.has(decision.runId)) {
      continue
    }
    const start = Number(decision.range.start)
    const end = Number(decision.range.end)
    while (
      joinIndex < joins.length &&
      (joins[joinIndex] ?? Number.POSITIVE_INFINITY) <= start
    ) {
      joinIndex += 1
    }
    const join = joins[joinIndex]
    if (join === undefined || join >= end) {
      continue
    }
    const position = decision.role === 'close' ? end - 1 : start
    if (positions.at(-1) !== position) positions.push(position)
  }
  return finish(Object.freeze({
    kind: 'inspected',
    protectionPositions: Object.freeze(positions)
  }))
}

export function parseProfile1Document(
  source: string,
  executionBudget: ExecutionBudgetId,
  traceRecorder?: ProfileParseTraceRecorderV1,
  markdownOptions: MarkdownOptionsV1 = DEFAULT_MARKDOWN_OPTIONS,
  captureAccountingTrace: boolean = false,
  executionControl?: ParseExecutionControl,
  reuseCache?: Profile1DocumentReuseCache
): Profile1DocumentResult {
  const usesDesktopLimits = executionBudget.limitsProfile === 'desktop-v1'
  const execution = createParseExecutionTracker(executionControl)
  const accounting = createProfile1SyntaxAccountingRecorderV1(
    usesDesktopLimits,
    captureAccountingTrace,
    execution
  )
  const syntaxIdentity = createProfile1SyntaxIdentityRegistry(
    source.length,
    accounting
  )
  const finishResult = <Result extends Profile1DocumentResult>(
    result: Result
  ): Result => {
    execution.finish()
    return result
  }
  if (
    usesDesktopLimits &&
    source.length > DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
  ) {
    return finishResult(Object.freeze({
      kind: 'source-only',
      fatalDiagnostic: createResourceDiagnostic(
        'CM_RESOURCE_SOURCE_UNITS_EXCEEDED',
        sourceRange(
          DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits,
          DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits
        ),
        DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits,
        source.length
      )
    }))
  }
  traceRecorder?.recordCanonicalSourceAdmission(source.length)
  const markdownDepthLimit = usesDesktopLimits
    ? DESKTOP_MARKDOWN_DEPTH_LIMIT
    : Number.POSITIVE_INFINITY
  traceRecorder?.recordSourceProgression('markdown-kernel')
  const parsed = parseIntrinsicProfile1(
    source,
    syntaxIdentity,
    usesDesktopLimits ? DESKTOP_CM_DEPTH_LIMIT : Number.POSITIVE_INFINITY,
    markdownDepthLimit,
    markdownOptions,
    execution
  )
  if (parsed.kind === 'resource-failure') {
    return finishResult(Object.freeze({
      kind: 'source-only',
      fatalDiagnostic: parsed.fatalDiagnostic
    }))
  }
  emitTapeAccounting(accounting, parsed.tape)
  if (usesDesktopLimits) {
    const plainParagraphFailure = plainParagraphBudgetEventFailure(
      source,
      parsed,
      execution
    )
    if (plainParagraphFailure !== undefined) {
      return finishResult(Object.freeze({
        kind: 'source-only',
        fatalDiagnostic: plainParagraphFailure
      }))
    }
  }
  const criticMarkupRoots = parsed.roots
  for (const root of criticMarkupRoots) {
    syntaxIdentity.emitEdge('contains', syntaxIdentity.root, root.nodeId, 'critic')
  }
  for (const run of parsed.tape) {
    if (!run.role.startsWith('eol-')) {
      continue
    }
    syntaxIdentity.emitOwnership(
      run.range,
      Object.freeze({
        kind: 'trivia',
        role: 'line-ending',
        spelling: run.role.slice('eol-'.length) as 'lf' | 'cr' | 'crlf'
      })
    )
  }
  for (const literal of parsed.markdownLiterals) {
    if (literal.start >= literal.end) {
      continue
    }
    const ownerRange = sourceRange(literal.start, literal.end)
    syntaxIdentity.emitOwnership(
      ownerRange,
      Object.freeze({
        kind: 'markdown-literal',
        provider: literal.kind,
        ownerRange
      })
    )
  }
  const criticMarkup = Object.freeze({
    roots: criticMarkupRoots,
    rootCount: criticMarkupRoots.length,
    rootAt: Object.freeze((ordinal: number): CriticMarkupNode => {
      const root = Number.isInteger(ordinal)
        ? criticMarkupRoots[ordinal]
        : undefined
      if (root === undefined) {
        throw new RangeError(
          `CriticMarkup root ordinal ${String(ordinal)} is outside [0, ${String(criticMarkupRoots.length)})`
        )
      }
      return root
    })
  })
  const graphCore = createProfile1SyntaxGraphCore(
    source,
    syntaxIdentity,
    criticMarkup,
    parsed.markdownLiterals,
    parsed.tape,
    parsed.markerDecisions,
    parsed.forkGraph
  )
  const forkParser = createProfile1MarkdownForkParser(
    graphCore.forkGraph,
    parsed.referenceDefinitions,
    execution,
    reuseCache?.markdown
  )
  traceRecorder?.recordAuthoritativeMarkdownParse('canonical-source')
  const originalPrepared = prepareProjection(
    graphCore,
    'original',
    undefined,
    markdownDepthLimit,
    traceRecorder,
    undefined,
    markdownOptions,
    forkParser
  )
  const hasDistinctRevised = forestContainsKind(
    criticMarkup.roots,
    VIEW_DIVERGENT_KINDS
  )
  const revisedPrepared = hasDistinctRevised
    ? prepareProjection(
      graphCore,
      'revised',
      undefined,
      markdownDepthLimit,
      traceRecorder,
      undefined,
      markdownOptions,
      forkParser
    )
    : originalPrepared
  const editingUsesRevised = !forestContainsKind(
    criticMarkup.roots,
    EDITING_DIFFERS_FROM_REVISED
  )
  const editingUsesOriginal = !editingUsesRevised && !forestContainsKind(
    criticMarkup.roots,
    EDITING_DIFFERS_FROM_ORIGINAL
  )
  const editingPrepared =
    editingUsesRevised
      ? revisedPrepared
      : editingUsesOriginal
        ? originalPrepared
        : prepareProjection(
          graphCore,
          'editing',
          undefined,
          markdownDepthLimit,
          undefined,
          undefined,
          markdownOptions,
          forkParser
        )
  const preparedCommentDisplays = prepareCommentDisplayProjections(
    graphCore,
    markdownDepthLimit,
    traceRecorder,
    markdownOptions,
    forkParser
  )
  const rootOriginalKey = 'root:original'
  const rootRevisedKey = hasDistinctRevised
    ? 'root:revised'
    : rootOriginalKey
  const rootEditingKey =
    editingPrepared === revisedPrepared
      ? rootRevisedKey
      : editingPrepared === originalPrepared
        ? rootOriginalKey
        : 'root:editing'
  const requestByKey = new Map<string, Profile1MarkdownForkAstRequest>()
  const preparedByKey = new Map<string, PreparedProfile1Projection>()
  const addRequest = (
    key: string,
    prepared: PreparedProfile1Projection
  ): void => {
    if (requestByKey.has(key)) {
      return
    }
    preparedByKey.set(key, prepared)
    requestByKey.set(key, Object.freeze({
      key,
      role: prepared.traceView,
      forkLane: prepared.forkLane,
      lane: prepared.markdownLane
    }))
  }
  addRequest(rootOriginalKey, originalPrepared)
  addRequest(rootRevisedKey, revisedPrepared)
  addRequest(rootEditingKey, editingPrepared)
  for (const comment of preparedCommentDisplays) {
    addRequest(comment.key, comment.projection)
  }
  for (const [key, request] of requestByKey) {
    const prepared = preparedByKey.get(key)
    if (prepared === undefined || prepared.markdownLane !== request.lane) {
      throw new Error('Fork AST accounting lost its prepared projection')
    }
    emitProjectionAccounting(accounting, key, prepared)
  }
  const forkAst = forkParser.emitAst(Object.freeze([...requestByKey.values()]))
  const original = materializePreparedProjection(
    graphCore,
    originalPrepared,
    forkAst.read(rootOriginalKey)
  )
  const revised = rootRevisedKey === rootOriginalKey
    ? original
    : materializePreparedProjection(
      graphCore,
      revisedPrepared,
      forkAst.read(rootRevisedKey)
    )
  const commentDisplayReaders = createCommentDisplayProjections(
    Object.freeze(preparedCommentDisplays.map((comment) => Object.freeze({
      nodeId: comment.nodeId,
      projection: materializePreparedProjection(
        graphCore,
        comment.projection,
        forkAst.read(comment.key)
      )
    })))
  )
  if (usesDesktopLimits) {
    const overflow = accounting.firstEventBeyond(DESKTOP_BUDGET_EVENT_LIMIT)
    const budgetFailure = overflow === undefined
      ? undefined
      : createResourceDiagnostic(
        'CM_RESOURCE_LOGICAL_NODES_EXCEEDED',
        sourceRange(overflow.range.start, overflow.range.start),
        DESKTOP_BUDGET_EVENT_LIMIT,
        overflow.observed
      )
    if (budgetFailure !== undefined) {
      return finishResult(Object.freeze({
        kind: 'source-only',
        fatalDiagnostic: budgetFailure
      }))
    }
  }
  const commentDisplays = (): readonly Profile1ProjectedMarkdown[] => {
    return commentDisplayReaders.all()
  }
  const commentDisplay = (comment: NodeId): Profile1ProjectedMarkdown => {
    const display = commentDisplayReaders.byNodeId(comment)
    if (display === undefined) {
      throw new RangeError('Comment identity is outside this revision')
    }
    return display
  }
  let editingCache =
    rootEditingKey === rootRevisedKey
      ? revised
      : rootEditingKey === rootOriginalKey
        ? original
        : undefined
  const editing = (): Profile1ProjectedMarkdown => {
    editingCache ??= materializePreparedProjection(
      graphCore,
      editingPrepared,
      forkAst.read(rootEditingKey)
    )
    return editingCache
  }
  const projectedDepthDiagnostic = usesDesktopLimits
    ? projectedMarkdownDepthDiagnostic(
      Object.freeze([
        original,
        revised
      ]),
      DESKTOP_MARKDOWN_DEPTH_LIMIT
    )
    : undefined
  if (projectedDepthDiagnostic !== undefined) {
    return finishResult(Object.freeze({
      kind: 'source-only',
      fatalDiagnostic: projectedDepthDiagnostic
    }))
  }
  const finalized = finalizeProfile1SyntaxGraph(graphCore, {
    diagnostics: createDiagnosticIndex(parsed.diagnostics),
    markup: createMarkupProjection(source, criticMarkup.roots),
    original,
    revised,
    commentDisplays,
    commentDisplay: Object.freeze(commentDisplay),
    editing
  })
  const products = Object.freeze({
    ...finalized,
    simpleTextIdentity:
      tapeCertifiesSimpleTextSource(parsed.tape)
  })
  return finishResult(captureAccountingTrace
    ? Object.freeze({ ...products, accountingTrace: accounting.trace() })
    : products)
}
