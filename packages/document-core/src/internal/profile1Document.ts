import type {
  CriticMarkupArm,
  CriticMarkupNode,
  DiagnosticIndex,
  ExecutionBudgetId,
  MarkupMark,
  MarkupProjection,
  MarkupProjectionRun,
  MarkdownDocument,
  MarkdownNode,
  ProjectedCodeUnitOrigin,
  ProjectionProvenance,
  ResourceDiagnostic,
  SourceOffset,
  SourceRange,
  SubstitutionNode,
  SyntaxDiagnostic,
  UnaryCriticNode
} from '../revision.js'
import {
  composeMarkdownLiteralRanges,
  type MarkdownContainerDepthFailure,
  type MarkdownLiteralRange
} from './profile1/markdownLiterals.js'
import {
  createMarkdownLaneState,
  type MarkdownArmMode,
  type MarkdownCheckpoint,
  type MarkdownPendingLineBlockFact,
  type MarkdownReferenceDefinitionLookup
} from './profile1/markdownLaneState.js'
import {
  createProfile1ReferenceDefinitionIndex
} from './profile1/referenceDefinitionIndex.js'
import {
  createCanonicalMarkdownParseRecorder,
  type CanonicalMarkdownArmBoundaryEvent,
  type CanonicalMarkdownParseArtifact,
  type CanonicalMarkdownParseLaneHandle
} from './profile1/canonicalMarkdownArtifact.js'
import {
  assertLosslessTape,
  findMarker,
  isMarkdownTextTapeRole,
  markerCandidateFromRole,
  scanSourceTape,
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
  MappedProjectionSegment,
  CanonicalMarkdownCriticBranch,
  CanonicalMarkdownLane
} from './profile1/syntaxGraph.js'
import {
  planMarkdownArmBoundaryProjectionEdits,
  type PlainMarkdownLaneReuseCache,
  parseMarkdownDocument,
  type MarkdownArmBoundaryProjectionEdit,
  type MappedMarkdownCanonicalIdentityRun,
  type MappedMarkdownMatchingScope,
  type Profile1MarkdownParse
} from './profile1/markdownParser.js'
import type {
  ProfileParseTraceRecorderV1,
  ProfileParseTraceViewV1
} from './profileParseTraceV1.js'

type ImplementedUnaryNode =
  | UnaryCriticNode<'addition', 'content'>
  | UnaryCriticNode<'deletion', 'content'>
  | UnaryCriticNode<'highlight', 'content'>
  | UnaryCriticNode<'comment', 'comment'>

type ImplementedNode = ImplementedUnaryNode | SubstitutionNode
type ImplementedKind = ImplementedNode['kind']

interface MarkdownNodeComparison {
  readonly expected: MarkdownNode
  readonly clean: MarkdownNode
}

/**
 * Compares a graph-retained projected Markdown product with the independently
 * parsed clean candidate. The clean product is verification evidence only and
 * is never returned to a consumer.
 */
export function verifyCleanProjectedMarkdownV1(
  expected: MarkdownDocument,
  clean: MarkdownDocument
): void {
  if (expected.source !== clean.source) {
    throw new Error('Clean projection Markdown mismatch: source')
  }
  const pending: MarkdownNodeComparison[] = [{
    expected: expected.root,
    clean: clean.root
  }]
  while (pending.length > 0) {
    const comparison = pending.pop()
    if (comparison === undefined) {
      continue
    }
    const expectedNode = comparison.expected
    const cleanNode = comparison.clean
    if (
      expectedNode.kind !== cleanNode.kind ||
      expectedNode.range.start !== cleanNode.range.start ||
      expectedNode.range.end !== cleanNode.range.end ||
      expectedNode.childCount !== cleanNode.childCount
    ) {
      throw new Error('Clean projection Markdown mismatch: node topology')
    }
    const expectedAttributeKeys = Object.keys(expectedNode.attributes).sort()
    const cleanAttributeKeys = Object.keys(cleanNode.attributes).sort()
    if (expectedAttributeKeys.length !== cleanAttributeKeys.length) {
      throw new Error('Clean projection Markdown mismatch: node attributes')
    }
    for (let index = 0; index < expectedAttributeKeys.length; index += 1) {
      const expectedKey = expectedAttributeKeys[index]
      const cleanKey = cleanAttributeKeys[index]
      if (
        expectedKey === undefined ||
        cleanKey !== expectedKey ||
        expectedNode.attributes[expectedKey] !== cleanNode.attributes[cleanKey]
      ) {
        throw new Error('Clean projection Markdown mismatch: node attributes')
      }
    }
    for (let ordinal = expectedNode.childCount - 1; ordinal >= 0; ordinal -= 1) {
      pending.push({
        expected: expectedNode.childAt(ordinal),
        clean: cleanNode.childAt(ordinal)
      })
    }
  }
}

interface ParseFrame {
  readonly definition: FormDefinition
  readonly open: TapeRun
  readonly children: readonly [CriticMarkupNode[], CriticMarkupNode[]]
  readonly continuationCheckpoint: MarkdownCheckpoint
  readonly armMode: MarkdownArmMode
  readonly artifactParentLane: CanonicalMarkdownParseLaneHandle
  readonly artifactArmLanes: CanonicalMarkdownParseLaneHandle[]
  currentArtifactLane: CanonicalMarkdownParseLaneHandle
  currentCheckpoint: MarkdownCheckpoint
  enclosingLabelPreservedByAllArms: boolean
  separator?: TapeRun
}

type Profile1DelimiterEvent =
  | Readonly<{
    readonly kind: Profile1CriticKind
    readonly role: 'open'
    readonly range: SourceRange
    readonly parentOpenRange: SourceRange | null
  }>
  | Readonly<{
    readonly kind: 'substitution'
    readonly role: 'separator'
    readonly range: SourceRange
    readonly openerRange: SourceRange
  }>
  | Readonly<{
    readonly kind: Profile1CriticKind
    readonly role: 'close'
    readonly range: SourceRange
    readonly action: 'matched' | 'non-top' | 'unmatched'
    readonly openerRange?: SourceRange
    readonly topOpenRange?: SourceRange
  }>

type Profile1DelimiterPolicy = (event: Profile1DelimiterEvent) => boolean

interface ParseResult {
  readonly kind: 'complete'
  readonly tape: readonly TapeRun[]
  readonly roots: readonly CriticMarkupNode[]
  readonly diagnostics: readonly SyntaxDiagnostic[]
  readonly markerDecisions: readonly CanonicalMarkerDecision[]
  readonly canonicalMarkdownParse: CanonicalMarkdownParseArtifact
  readonly markdownLiterals: readonly MarkdownLiteralRange[]
  readonly rejectedDelimiters: readonly Profile1DelimiterEvent[]
  readonly projectedMarkdown?: Profile1MarkdownParse
}

interface ParseResourceFailure {
  readonly kind: 'resource-failure'
  readonly fatalDiagnostic: ResourceDiagnostic
}

type ParseOutcome = ParseResult | ParseResourceFailure

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
  readonly lane: CanonicalMarkdownLane
}

interface AppendTask {
  readonly kind: 'append'
  readonly start: number
  readonly end: number
}

interface ArmBoundaryTask {
  readonly kind: 'arm-boundary'
  readonly laneId: number
  readonly event: CanonicalMarkdownArmBoundaryEvent
  readonly lane: CanonicalMarkdownLane
  readonly parentLane: CanonicalMarkdownLane
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

export type Profile1DocumentProducts = Profile1SyntaxGraph

export interface Profile1SourceOnlyProducts {
  readonly kind: 'source-only'
  readonly fatalDiagnostic: ResourceDiagnostic
}

export type Profile1DocumentResult = Profile1DocumentProducts | Profile1SourceOnlyProducts

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

const DESKTOP_SOURCE_UNIT_LIMIT = 32_000_000
const DESKTOP_MARKDOWN_DEPTH_LIMIT = 128
const DESKTOP_CM_DEPTH_LIMIT = 16_384

function sourceOffset(value: number): SourceOffset {
  return value as SourceOffset
}

function sourceRange(start: number, end: number): SourceRange {
  return Object.freeze({ start: sourceOffset(start), end: sourceOffset(end) })
}

function createUnaryNode(frame: ParseFrame, close: TapeRun): ImplementedUnaryNode {
  const children = Object.freeze([...frame.children[0]])
  const range = sourceRange(frame.open.range.start, close.range.end)
  const markers = Object.freeze({ open: frame.open.range, close: close.range })
  if (frame.definition.kind === 'comment') {
    const commentArm: CriticMarkupArm<'comment'> = Object.freeze({
      name: 'comment',
      range: sourceRange(frame.open.range.end, close.range.start),
      children
    })
    return Object.freeze({
      kind: 'comment',
      range,
      markers,
      arms: Object.freeze([commentArm]) as readonly [CriticMarkupArm<'comment'>]
    })
  }
  const arm: CriticMarkupArm<'content'> = Object.freeze({
    name: 'content',
    range: sourceRange(frame.open.range.end, close.range.start),
    children
  })
  const common = {
    range,
    markers,
    arms: Object.freeze([arm]) as readonly [CriticMarkupArm<'content'>]
  }
  if (frame.definition.kind === 'addition') {
    return Object.freeze({ kind: 'addition', ...common })
  }
  if (frame.definition.kind === 'deletion') {
    return Object.freeze({ kind: 'deletion', ...common })
  }
  if (frame.definition.kind === 'highlight') {
    return Object.freeze({ kind: 'highlight', ...common })
  }
  throw new Error('Substitution cannot be created as a unary CriticMarkup node')
}

function createSubstitutionNode(frame: ParseFrame, close: TapeRun): SubstitutionNode | undefined {
  const separator = frame.separator
  if (separator === undefined) {
    return undefined
  }
  const oldArm: CriticMarkupArm<'old'> = Object.freeze({
    name: 'old',
    range: sourceRange(frame.open.range.end, separator.range.start),
    children: Object.freeze([...frame.children[0]])
  })
  const newArm: CriticMarkupArm<'new'> = Object.freeze({
    name: 'new',
    range: sourceRange(separator.range.end, close.range.start),
    children: Object.freeze([...frame.children[1]])
  })
  return Object.freeze({
    kind: 'substitution',
    range: sourceRange(frame.open.range.start, close.range.end),
    markers: Object.freeze({
      open: frame.open.range,
      separator: separator.range,
      close: close.range
    }),
    arms: Object.freeze([oldArm, newArm]) as readonly [
      CriticMarkupArm<'old'>,
      CriticMarkupArm<'new'>
    ]
  })
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
  decisions: readonly CanonicalMarkerDecision[]
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
  const tape = scanSourceTape(source, retainedCandidates)
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

function parseCriticMarkupPass(
  source: string,
  cmDepthLimit: number = Number.POSITIVE_INFINITY,
  referenceDefinitions: MarkdownReferenceDefinitionLookup = new Set(),
  markdownDepthLimit: number = Number.POSITIVE_INFINITY,
  delimiterPolicy?: Profile1DelimiterPolicy
): ParseOutcome {
  const markdownLane = createMarkdownLaneState(
    source,
    markdownDepthLimit,
    referenceDefinitions
  )
  const roots: CriticMarkupNode[] = []
  const frames: ParseFrame[] = []
  const framesByKind = new Map<ImplementedKind, ParseFrame[]>()
  const diagnostics: SyntaxDiagnostic[] = []
  const markerDecisions: CanonicalMarkerDecision[] = []
  const rejectedDelimiters: Profile1DelimiterEvent[] = []
  const stagedMarkdownLiterals: MarkdownLiteralRange[] = []
  let firstMarkdownDepthFailure: MarkdownContainerDepthFailure | undefined
  let rootMarkdownCheckpoint = markdownLane.emptyCheckpoint
  const markdownArtifact = createCanonicalMarkdownParseRecorder(
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
  const currentMarkdownArtifactLane = (): CanonicalMarkdownParseLaneHandle =>
    frames.at(-1)?.currentArtifactLane ?? markdownArtifact.root
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
    markdownArtifact.recordTransition(
      currentMarkdownArtifactLane(),
      'advance',
      entryCheckpoint,
      advanced.checkpoint,
      run.range.start,
      run.range.end,
      advanced.completedLiterals
    )
    stagedMarkdownLiterals.push(...advanced.completedLiterals)
    replaceCurrentMarkdownCheckpoint(advanced.checkpoint)
  }
  const closerStartsByKind = new Map<ImplementedKind, number[]>()
  const substitutionSeparatorStarts: number[] = []
  for (let offset = 0; offset < source.length; offset += 1) {
    const marker = findMarker(source, offset)
    if (
      marker?.role === 'separator' &&
      marker.definition.kind === 'substitution'
    ) {
      substitutionSeparatorStarts.push(offset)
      continue
    }
    if (marker?.role !== 'close') {
      continue
    }
    const kind = marker.definition.kind as ImplementedKind
    const starts = closerStartsByKind.get(kind)
    if (starts === undefined) {
      closerStartsByKind.set(kind, [offset])
    } else {
      starts.push(offset)
    }
  }
  const nextCloserStart = (kind: ImplementedKind, start: number): number => {
    const starts = closerStartsByKind.get(kind) ?? []
    let low = 0
    let high = starts.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if ((starts[middle] ?? Number.POSITIVE_INFINITY) < start) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    return starts[low] ?? source.length
  }
  const nextSubstitutionSeparatorStart = (start: number): number => {
    let low = 0
    let high = substitutionSeparatorStarts.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (
        (substitutionSeparatorStarts[middle] ?? Number.POSITIVE_INFINITY) < start
      ) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    return substitutionSeparatorStarts[low] ?? source.length
  }
  const nextLaneBoundary = (frame: ParseFrame, start: number): number =>
    frame.definition.kind === 'substitution' && frame.separator === undefined
      ? Math.min(
        nextSubstitutionSeparatorStart(start),
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

  let sourceCursor = 0
  const rejectDelimiter = (event: Profile1DelimiterEvent): boolean => {
    if (delimiterPolicy === undefined || delimiterPolicy(event)) {
      return false
    }
    rejectedDelimiters.push(event)
    appendMarkdownRange(sourceCursor, sourceCursor + 1)
    sourceCursor += 1
    return true
  }
  while (sourceCursor < source.length) {
    const foundMarker = findMarker(source, sourceCursor)
    if (foundMarker === undefined) {
      let textEnd = sourceCursor
      const firstCodeUnit = source.charCodeAt(textEnd)
      if (firstCodeUnit === 10 || firstCodeUnit === 13) {
        textEnd +=
          firstCodeUnit === 13 && source.charCodeAt(textEnd + 1) === 10
            ? 2
            : 1
      } else {
        textEnd += 1
        while (
          textEnd < source.length &&
          source.charCodeAt(textEnd) !== 10 &&
          source.charCodeAt(textEnd) !== 13 &&
          findMarker(source, textEnd) === undefined
        ) {
          textEnd += 1
        }
      }
      appendMarkdownRange(sourceCursor, textEnd)
      sourceCursor = textEnd
      continue
    }

    const definition = foundMarker.definition
    const kind = definition.kind as ImplementedKind
    const markerRole = foundMarker.role
    const run = createTemporaryRun(
      definition.kind,
      markerRole,
      sourceCursor,
      sourceCursor + foundMarker.length
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
    markdownArtifact.recordTransition(
      currentMarkdownArtifactLane(),
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
      markdownArtifact.recordTransition(
        currentMarkdownArtifactLane(),
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
      (markerRole === 'open' || markerRole === 'separator') &&
      markdownLane.markerIsProtected(checkpoint)
    ) {
      appendMarkdownRange(sourceCursor, sourceCursor + 1)
      sourceCursor += 1
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
      appendMarkdownRange(sourceCursor, sourceCursor + 1)
      sourceCursor += 1
      continue
    }

    if (markerRole === 'open') {
      const parent = frames[frames.length - 1]
      if (rejectDelimiter(Object.freeze({
        kind: definition.kind,
        role: 'open',
        range: run.range,
        parentOpenRange: parent?.open.range ?? null
      }))) {
        continue
      }
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
      const artifactParentLane = currentMarkdownArtifactLane()
      const artifactArmLane = markdownArtifact.forkLane(armStartCheckpoint)
      if (definition.kind === 'substitution') {
        markdownArtifact.recordArmBoundary(
          artifactArmLane,
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
        artifactParentLane,
        artifactArmLanes: [artifactArmLane],
        currentArtifactLane: artifactArmLane,
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
      sourceCursor = run.range.end
      continue
    }

    const frame = frames[frames.length - 1]
    if (markerRole === 'separator') {
      if (
        frame !== undefined &&
        frame.definition.kind === 'substitution' &&
        frame.separator === undefined
      ) {
        if (rejectDelimiter(Object.freeze({
          kind: 'substitution',
          role: 'separator',
          range: run.range,
          openerRange: frame.open.range
        }))) {
          continue
        }
        const finishedArm = markdownLane.finishLane(
          frame.currentCheckpoint,
          run.range.start
        )
        markdownArtifact.recordTransition(
          frame.currentArtifactLane,
          'finish-lane',
          frame.currentCheckpoint,
          finishedArm.checkpoint,
          run.range.start,
          run.range.start,
          finishedArm.completedLiterals
        )
        stagedMarkdownLiterals.push(...finishedArm.completedLiterals)
        noteMarkdownDepthFailure(finishedArm.checkpoint)
        frame.currentCheckpoint = finishedArm.checkpoint
        frame.enclosingLabelPreservedByAllArms &&=
          !finishedArm.checkpoint.enclosingLabelInterrupted
        markdownArtifact.recordArmBoundary(
          frame.currentArtifactLane,
          Object.freeze({
            kind: 'substitution-arm-boundary',
            role: 'exit',
            sourcePosition: sourceOffset(run.range.start)
          })
        )
        markdownArtifact.sealLane(
          frame.currentArtifactLane,
          frame.currentCheckpoint
        )
        const nextArmCheckpoint = markdownLane.enterArm(
          frame.continuationCheckpoint,
          run.range.end,
          frame.armMode
        )
        const nextArtifactArm = markdownArtifact.forkLane(nextArmCheckpoint)
        markdownArtifact.recordArmBoundary(
          nextArtifactArm,
          Object.freeze({
            kind: 'substitution-arm-boundary',
            role: 'enter',
            sourcePosition: sourceOffset(run.range.end)
          })
        )
        frame.artifactArmLanes.push(nextArtifactArm)
        frame.currentArtifactLane = nextArtifactArm
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
      sourceCursor = run.range.end
      continue
    }

    const compatibleFrame =
      frame === undefined || frame.definition.kind === kind
        ? undefined
        : framesByKind.get(kind)?.at(-1)
    const closeEvent: Profile1DelimiterEvent =
      frame === undefined
        ? Object.freeze({
          kind,
          role: 'close',
          range: run.range,
          action: 'unmatched'
        })
        : frame.definition.kind === kind
          ? Object.freeze({
            kind,
            role: 'close',
            range: run.range,
            action: 'matched',
            openerRange: frame.open.range
          })
          : compatibleFrame === undefined
            ? Object.freeze({
              kind,
              role: 'close',
              range: run.range,
              action: 'unmatched'
            })
            : Object.freeze({
              kind,
              role: 'close',
              range: run.range,
              action: 'non-top',
              openerRange: compatibleFrame.open.range,
              topOpenRange: frame.open.range
            })
    if (rejectDelimiter(closeEvent)) {
      continue
    }

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
      sourceCursor = run.range.end
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
      sourceCursor = run.range.end
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
    markdownArtifact.recordTransition(
      frame.currentArtifactLane,
      'finish-lane',
      frame.currentCheckpoint,
      finishedLane.checkpoint,
      run.range.start,
      run.range.start,
      finishedLane.completedLiterals
    )
    frame.currentCheckpoint = finishedLane.checkpoint
    frame.enclosingLabelPreservedByAllArms &&=
      !finishedLane.checkpoint.enclosingLabelInterrupted
    if (frame.definition.kind === 'substitution') {
      markdownArtifact.recordArmBoundary(
        frame.currentArtifactLane,
        Object.freeze({
          kind: 'substitution-arm-boundary',
          role: 'exit',
          sourcePosition: sourceOffset(run.range.start)
        })
      )
    }
    markdownArtifact.sealLane(
      frame.currentArtifactLane,
      frame.currentCheckpoint
    )
    noteMarkdownDepthFailure(finishedLane.checkpoint)
    stagedMarkdownLiterals.push(...finishedLane.completedLiterals)
    const node =
      frame.definition.kind === 'substitution'
        ? createSubstitutionNode(frame, run)
        : createUnaryNode(frame, run)
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
      markdownArtifact.promoteBranches(
        frame.artifactArmLanes,
        frame.artifactParentLane
      )
      markdownArtifact.recordTransition(
        frame.artifactParentLane,
        'malformed-recovery',
        frame.continuationCheckpoint,
        advanced.checkpoint,
        frame.open.range.start,
        run.range.end,
        Object.freeze([
          ...finishedLane.completedLiterals,
          ...advanced.completedLiterals
        ])
      )
      stagedMarkdownLiterals.push(...advanced.completedLiterals)
      replaceCurrentMarkdownCheckpoint(advanced.checkpoint)
      sourceCursor = run.range.end
      continue
    }
    markdownArtifact.acceptBranch(
      frame.artifactParentLane,
      node,
      frame.artifactArmLanes
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
    markdownArtifact.recordTransition(
      frame.artifactParentLane,
      'rejoin-carrier',
      frame.continuationCheckpoint,
      rejoinedCheckpoint,
      run.range.end,
      run.range.end,
      Object.freeze([])
    )
    replaceCurrentMarkdownCheckpoint(rejoinedCheckpoint)
    sourceCursor = run.range.end
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
    markdownArtifact.promoteBranches(
      frame.artifactArmLanes,
      frame.artifactParentLane
    )
    markdownArtifact.recordTransition(
      frame.artifactParentLane,
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
  markdownArtifact.recordTransition(
    markdownArtifact.root,
    'finish-lane',
    rootMarkdownCheckpoint,
    finishedRootLane.checkpoint,
    source.length,
    source.length,
    finishedRootLane.completedLiterals
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
  const canonical = finalizeCanonicalTape(source, markerDecisions)
  const canonicalMarkdownParse = markdownArtifact.finish(
    canonical.tape,
    rootMarkdownCheckpoint
  )
  return Object.freeze({
    kind: 'complete',
    tape: canonical.tape,
    roots: Object.freeze(roots),
    diagnostics: finalizeDiagnostics(diagnostics),
    markerDecisions: canonical.markerDecisions,
    canonicalMarkdownParse,
    rejectedDelimiters: Object.freeze(rejectedDelimiters),
    markdownLiterals: finalizeAuthenticatedMarkdownLiterals(
      Object.freeze([]),
      stagedMarkdownLiterals,
      roots
    )
  })
}

/**
 * Test-only counter of full CriticMarkup recognitions. Phase 0.5 drives the
 * "one CriticMarkup authority per open" property by shrinking this from ~5
 * (canonical + per-projection guard + per-projection verifier) to 1. It counts
 * `parseCriticMarkup`, not `parseCriticMarkupPass`, so the reference-resolution
 * second pass inside one recognition is deliberately not double-counted.
 */
let criticMarkupRecognitionCount = 0

export function __criticMarkupRecognitionCountV1(): number {
  return criticMarkupRecognitionCount
}

export function __resetCriticMarkupRecognitionCountV1(): void {
  criticMarkupRecognitionCount = 0
}

function parseCriticMarkup(
  source: string,
  cmDepthLimit: number = Number.POSITIVE_INFINITY,
  markdownDepthLimit: number = Number.POSITIVE_INFINITY,
  delimiterPolicy?: Profile1DelimiterPolicy,
  projectedMarkdownDepthLimit?: number,
  traceRecorder?: ProfileParseTraceRecorderV1
): ParseOutcome {
  criticMarkupRecognitionCount += 1
  const blockStage = parseCriticMarkupPass(
    source,
    cmDepthLimit,
    undefined,
    markdownDepthLimit,
    delimiterPolicy
  )
  if (blockStage.kind !== 'complete') {
    return blockStage
  }
  // Phase 0 invariant 6 fact: reference-definition scope is discovered from a
  // finished forest after the parse, then the entire pass is discarded and
  // re-run with that index. Both the join and the reparse are recorded so the
  // architecture gate can assert their absence once definitions become
  // parser-created edges.
  const referenceDefinitions = createProfile1ReferenceDefinitionIndex(
    source,
    blockStage.roots,
    blockStage.markdownLiterals
  )
  if (referenceDefinitions.size !== 0) {
    traceRecorder?.recordPostHocJoin('reference-definitions')
    traceRecorder?.recordCanonicalReparse('reference-definitions')
  }
  const completed = referenceDefinitions.size === 0
    ? blockStage
    : parseCriticMarkupPass(
      source,
      cmDepthLimit,
      referenceDefinitions,
      markdownDepthLimit,
      delimiterPolicy
    )
  if (
    completed.kind !== 'complete' ||
    projectedMarkdownDepthLimit === undefined ||
    completed.roots.length !== 0
  ) {
    return completed
  }
  return Object.freeze({
    ...completed,
    projectedMarkdown: parseMarkdownDocument(
      { source },
      projectedMarkdownDepthLimit
    )
  })
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

function createProvenance(
  projectedLength: number,
  mutableSegments: readonly MutableProjectionSegment[]
): ProjectionProvenance {
  const segments = Object.freeze(mutableSegments.map(freezeSegment))
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
  return Object.freeze({ originAt })
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
        markPath: appendMark(markPath, { kind: 'substitution', arm: 'old' })
      }),
      Object.freeze({
        kind: 'markup-range',
        start: node.arms[1].range.start,
        end: node.arms[1].range.end,
        nodes: node.arms[1].children,
        markPath: appendMark(markPath, { kind: 'substitution', arm: 'new' })
      })
    ])
  }
  const mark: MarkupMark = Object.freeze({ kind: node.kind })
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
  branch: CanonicalMarkdownCriticBranch,
  view: ProjectionView
): readonly CanonicalMarkdownLane[] {
  const node = branch.node
  const show = (lane: CanonicalMarkdownLane | undefined): readonly CanonicalMarkdownLane[] =>
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

const EMPTY_CANONICAL_LANES: readonly CanonicalMarkdownLane[] = Object.freeze([])

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
): Readonly<{ source: string; segments: readonly MutableProjectionSegment[] }> {
  if (insertions.length === 0) {
    return Object.freeze({ source: candidateSource, segments: candidateSegments })
  }
  const orderedInsertions = [...insertions].sort((left, right) =>
    left.candidateOffset - right.candidateOffset
  )
  const chunks: string[] = []
  const segments: MutableProjectionSegment[] = []
  let candidateCursor = 0
  let projectedLength = 0
  for (const insertion of orderedInsertions) {
    if (
      insertion.candidateOffset < candidateCursor ||
      insertion.candidateOffset > candidateSource.length ||
      insertion.text.length === 0
    ) {
      throw new Error('Projection codec insertion is invalid')
    }
    chunks.push(candidateSource.slice(candidateCursor, insertion.candidateOffset))
    appendProjectionRange(
      segments,
      candidateSegments,
      candidateCursor,
      insertion.candidateOffset,
      projectedLength
    )
    projectedLength += insertion.candidateOffset - candidateCursor
    chunks.push(insertion.text)
    segments.push({
      kind: 'generated',
      projectedStart: projectedLength,
      projectedEnd: projectedLength + insertion.text.length,
      sourcePosition: insertion.sourcePosition,
      affinity: insertion.affinity
    })
    projectedLength += insertion.text.length
    candidateCursor = insertion.candidateOffset
  }
  chunks.push(candidateSource.slice(candidateCursor))
  appendProjectionRange(
    segments,
    candidateSegments,
    candidateCursor,
    candidateSource.length,
    projectedLength
  )
  return Object.freeze({ source: chunks.join(''), segments: Object.freeze(segments) })
}

function applyGeneratedCodecEdits(
  candidateSource: string,
  candidateSegments: readonly MutableProjectionSegment[],
  replacements: readonly PlannedGeneratedReplacement[]
): Readonly<{ source: string; segments: readonly MutableProjectionSegment[] }> {
  if (replacements.length === 0) {
    return Object.freeze({ source: candidateSource, segments: candidateSegments })
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
  return Object.freeze({ source: chunks.join(''), segments: Object.freeze(segments) })
}

function applyProtections(
  candidateSource: string,
  candidateSegments: readonly MutableProjectionSegment[],
  protections: readonly PlannedProtection[]
): Readonly<{ source: string; segments: readonly MutableProjectionSegment[] }> {
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
  return nodes.some((node) =>
    kinds.has(node.kind) ||
    node.arms.some((arm) => forestContainsKind(arm.children, kinds))
  )
}

/** The forms Original and Revised resolve differently; the rest render alike. */
const VIEW_DIVERGENT_KINDS: ReadonlySet<CriticMarkupNode['kind']> =
  new Set(['addition', 'deletion', 'substitution'])

const EDITING_DIFFERS_FROM_REVISED: ReadonlySet<CriticMarkupNode['kind']> =
  new Set(['deletion', 'substitution'])
const EDITING_DIFFERS_FROM_ORIGINAL: ReadonlySet<CriticMarkupNode['kind']> =
  new Set(['addition', 'substitution'])

/**
 * An already-built projection whose text is byte-identical to the editing view,
 * or `undefined` when the editing view is genuinely its own text.
 *
 * The editing view shows Addition, Deletion and Highlight content and hides
 * Comment bodies. Revised differs from it only by dropping Deletions, and
 * Original only by dropping Additions; a Substitution differs from both because
 * the editing view shows old *and* new. So with no Deletions or Substitutions
 * the editing view is Revised, and with no Additions or Substitutions it is
 * Original — and parsing those same bytes again would be pure waste.
 */
function reusableEditingProjection(
  roots: readonly CriticMarkupNode[],
  original: Profile1ProjectedMarkdown,
  revised: Profile1ProjectedMarkdown
): Profile1ProjectedMarkdown | undefined {
  if (!forestContainsKind(roots, EDITING_DIFFERS_FROM_REVISED)) {
    return revised
  }
  if (!forestContainsKind(roots, EDITING_DIFFERS_FROM_ORIGINAL)) {
    return original
  }
  return undefined
}

function applyMarkdownArmBoundaryProjectionEdits(
  candidateSource: string,
  candidateSegments: readonly MutableProjectionSegment[],
  edits: readonly MarkdownArmBoundaryProjectionEdit[]
): Readonly<{ source: string; segments: readonly MutableProjectionSegment[] }> {
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
): Readonly<{ source: string; segments: readonly MutableProjectionSegment[] }> {
  if (candidateSource.charCodeAt(0) !== 0xfeff) {
    return Object.freeze({ source: candidateSource, segments: candidateSegments })
  }
  const origin = projectionOriginAt(candidateSegments, 0)
  if (origin.kind === 'canonical' && origin.sourceOffset === 0) {
    return Object.freeze({ source: candidateSource, segments: candidateSegments })
  }
  const sourcePosition = origin.kind === 'canonical' ? origin.sourceOffset : origin.sourcePosition
  const entity = '&#xFEFF;'
  const segments: MutableProjectionSegment[] = [
    {
      kind: 'generated',
      projectedStart: 0,
      projectedEnd: entity.length,
      sourcePosition,
      affinity: 'next'
    }
  ]
  appendProjectionRange(segments, candidateSegments, 1, candidateSource.length, entity.length)
  return Object.freeze({
    source: `${entity}${candidateSource.slice(1)}`,
    segments: Object.freeze(segments)
  })
}

function guardProjectionCandidate(
  candidateSource: string,
  candidateSegments: readonly MutableProjectionSegment[],
  markerDecisions: readonly CanonicalMarkerDecision[]
): Readonly<{
    source: string
    segments: readonly MutableProjectionSegment[]
    acceptedMarkerCount: number
  }> {
  const decisionByIdentity = new Map<string, CanonicalMarkerDecision>()
  for (const decision of markerDecisions) {
    decisionByIdentity.set(`${decision.runId}:${decision.kind}:${decision.role}`, decision)
  }

  const canonicalRunId = (range: SourceRange): number | undefined =>
    canonicalMarkerIdentity(
      candidateSegments,
      range.start,
      range.end - range.start
    )?.sourceRunId
  const delimiterPolicy: Profile1DelimiterPolicy = (event): boolean => {
    const markerIdentity = canonicalMarkerIdentity(
      candidateSegments,
      event.range.start,
      event.range.end - event.range.start
    )
    const decision =
      markerIdentity === undefined
        ? undefined
        : decisionByIdentity.get(
          `${markerIdentity.sourceRunId}:${event.kind}:${event.role}`
        )
    if (decision === undefined || decision.role !== event.role) {
      return false
    }
    if (event.role === 'open' && decision.role === 'open') {
      return decision.parentOpenRunId === (
        event.parentOpenRange === null
          ? null
          : canonicalRunId(event.parentOpenRange)
      )
    }
    if (event.role === 'separator' && decision.role === 'separator') {
      return decision.openerRunId === canonicalRunId(event.openerRange)
    }
    if (event.role !== 'close' || decision.role !== 'close') {
      return false
    }
    return (
      decision.action === event.action &&
      decision.openerRunId === (
        event.openerRange === undefined
          ? undefined
          : canonicalRunId(event.openerRange)
      ) &&
      decision.topOpenRunId === (
        event.topOpenRange === undefined
          ? undefined
          : canonicalRunId(event.topOpenRange)
      )
    )
  }

  const candidateParse = parseCriticMarkup(
    candidateSource,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    delimiterPolicy
  )
  if (candidateParse.kind !== 'complete') {
    throw new Error('Projection guard candidate parse exceeded an internal resource budget')
  }
  const protections: PlannedProtection[] = []
  const protectedOffsets = new Set<number>()
  for (const rejected of candidateParse.rejectedDelimiters) {
    const candidateOffset =
      rejected.role === 'close' ? rejected.range.end - 1 : rejected.range.start
    if (protectedOffsets.has(candidateOffset)) {
      continue
    }
    protectedOffsets.add(candidateOffset)
    const responsibleOrigin = projectionOriginAt(candidateSegments, candidateOffset)
    protections.push(Object.freeze({
      candidateOffset,
      sourcePosition:
        responsibleOrigin.kind === 'canonical'
          ? responsibleOrigin.sourceOffset
          : responsibleOrigin.sourcePosition
    }))
  }
  const protected_ = applyProtections(candidateSource, candidateSegments, protections)
  // The accepted count is the projection's own "no synthetic CriticMarkup"
  // evidence: markers are elided from a view, so a well-formed candidate accepts
  // none. Escaping only adds backslashes to rejected markers and cannot create
  // an accepted one, so this pre-escape count equals a re-parse of the escaped
  // candidate — which is why the clean verifier no longer needs its own parse.
  return Object.freeze({
    source: protected_.source,
    segments: protected_.segments,
    acceptedMarkerCount: candidateParse.roots.length
  })
}

function remapMatchingScopesByCanonicalIdentity(
  graph: Profile1SyntaxGraphCore,
  matchingScopes: readonly MappedMarkdownMatchingScope[],
  segments: readonly MutableProjectionSegment[],
  probe?: (start: number, end: number) => void
): readonly MappedMarkdownMatchingScope[] {
  const laneById = new Map(
    graph.canonicalMarkdown.lanes.map((lane) => [lane.id, lane] as const)
  )
  // Sorted views over the segment tape, built once per remap: a scope may
  // touch only the segments it actually overlaps. Sweeping the whole tape per
  // scope was the projection's second measured quadratic (4,096 visits for 64
  // scopes). Canonical segments are keyed by their source interval, generated
  // segments by their anchor position; both walks below are bounded by the
  // scope's own overlap span.
  const canonicalSegments = segments
    .filter((segment) => segment.kind === 'canonical')
    .sort((left, right) => left.sourceStart - right.sourceStart)
  const generatedSegments = segments
    .filter((segment) => segment.kind !== 'canonical')
    .sort((left, right) => left.sourcePosition - right.sourcePosition)
  const firstCanonicalTouching = (sourceStart: number): number => {
    let low = 0
    let high = canonicalSegments.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      const candidate = canonicalSegments[middle]
      const candidateSourceEnd = candidate === undefined
        ? Number.POSITIVE_INFINITY
        : candidate.sourceStart +
          candidate.projectedEnd - candidate.projectedStart
      if (candidateSourceEnd <= sourceStart) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    return low
  }
  const firstGeneratedAtOrAfter = (sourcePosition: number): number => {
    let low = 0
    let high = generatedSegments.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (
        (generatedSegments[middle]?.sourcePosition ??
          Number.POSITIVE_INFINITY) < sourcePosition
      ) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    return low
  }
  return Object.freeze(matchingScopes.map((scope) => {
    const lane = laneById.get(scope.id - 1)
    if (lane === undefined) {
      throw new Error('Projected Substitution scope lost its canonical lane')
    }
    let projectedStart = Number.POSITIVE_INFINITY
    let projectedEnd = Number.NEGATIVE_INFINITY
    for (
      let index = firstCanonicalTouching(lane.range.start);
      index < canonicalSegments.length;
      index += 1
    ) {
      const segment = canonicalSegments[index]
      if (segment === undefined || segment.sourceStart >= lane.range.end) {
        break
      }
      probe?.(segment.projectedStart, segment.projectedEnd)
      const sourceEnd =
        segment.sourceStart + segment.projectedEnd - segment.projectedStart
      const overlapStart = Math.max(lane.range.start, segment.sourceStart)
      const overlapEnd = Math.min(lane.range.end, sourceEnd)
      if (overlapStart < overlapEnd) {
        projectedStart = Math.min(
          projectedStart,
          segment.projectedStart + overlapStart - segment.sourceStart
        )
        projectedEnd = Math.max(
          projectedEnd,
          segment.projectedStart + overlapEnd - segment.sourceStart
        )
      }
    }
    for (
      let index = firstGeneratedAtOrAfter(lane.range.start);
      index < generatedSegments.length;
      index += 1
    ) {
      const segment = generatedSegments[index]
      if (segment === undefined || segment.sourcePosition > lane.range.end) {
        break
      }
      probe?.(segment.projectedStart, segment.projectedEnd)
      const belongsToLane =
        (lane.range.start < segment.sourcePosition &&
          segment.sourcePosition < lane.range.end) ||
        (segment.sourcePosition === lane.range.start &&
          segment.affinity === 'next') ||
        (segment.sourcePosition === lane.range.end &&
          segment.affinity === 'previous')
      if (belongsToLane) {
        projectedStart = Math.min(projectedStart, segment.projectedStart)
        projectedEnd = Math.max(projectedEnd, segment.projectedEnd)
      }
    }
    if (
      !Number.isFinite(projectedStart) ||
      !Number.isFinite(projectedEnd) ||
      projectedStart >= projectedEnd
    ) {
      throw new Error('Projected Substitution scope lost its retained content')
    }
    return Object.freeze({
      id: scope.id,
      start: projectedStart,
      end: projectedEnd,
      depth: scope.depth
    })
  }))
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
  lane: CanonicalMarkdownLane,
  candidateOffset: number,
  sourcePosition: number,
  source: string
): Extract<
  MarkdownArmBoundaryProjectionEdit,
  { readonly kind: 'terminate-fenced-block-fragment' }
> | undefined {
  for (
    let transitionIndex = lane.parseArtifact.transitions.length - 1;
    transitionIndex >= 0;
    transitionIndex -= 1
  ) {
    const transition = lane.parseArtifact.transitions[transitionIndex]
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
  CanonicalMarkdownLane,
  readonly number[]
>()

function armTerminationFenceOpens(
  parentLane: CanonicalMarkdownLane
): readonly number[] {
  const cached = ARM_TERMINATION_FENCE_INDEX.get(parentLane)
  if (cached !== undefined) {
    return cached
  }
  const opens: number[] = []
  for (const transition of parentLane.parseArtifact.transitions) {
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
  parentLane: CanonicalMarkdownLane,
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
  parentLane: CanonicalMarkdownLane,
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
  for (const transition of parentLane.parseArtifact.transitions) {
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
  lane: CanonicalMarkdownLane
): MarkdownPendingLineBlockFact | undefined {
  const entry = lane.parseArtifact.entryCheckpoint
  if (
    entry.linePath !== undefined ||
    entry.paragraphOpen ||
    entry.activeContainers.length !== 0
  ) {
    return undefined
  }
  let terminal: MarkdownPendingLineBlockFact | undefined
  for (
    let index = lane.parseArtifact.transitions.length - 1;
    index >= 0;
    index -= 1
  ) {
    const transition = lane.parseArtifact.transitions[index]
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
  lane: CanonicalMarkdownLane,
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
  parentLane: CanonicalMarkdownLane,
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
  for (const transition of parentLane.parseArtifact.transitions) {
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
  parentLane: CanonicalMarkdownLane,
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
  lane: CanonicalMarkdownLane,
  parentLane: CanonicalMarkdownLane,
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

function project(
  graph: Profile1SyntaxGraphCore,
  view: ProjectionView,
  lane: CanonicalMarkdownLane = graph.canonicalMarkdown.root,
  markdownDepthLimit: number = Number.POSITIVE_INFINITY,
  traceRecorder?: ProfileParseTraceRecorderV1,
  traceView: ProfileParseTraceViewV1 = view,
  reuseCache?: PlainMarkdownLaneReuseCache
): Profile1ProjectedMarkdown {
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
          task.lane.parseArtifact.exitCheckpoint.linePath !== undefined &&
          task.lane.parseArtifact.exitCheckpoint.frontMatter === undefined &&
          task.lane.parseArtifact.exitCheckpoint.indentedCode === undefined &&
          task.lane.parseArtifact.exitCheckpoint.htmlBlock === undefined &&
          task.lane.parseArtifact.exitCheckpoint.definition === undefined
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
        const boundaries = arm.parseArtifact.armBoundaries
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
  const canonicalIdentityRuns = Object.freeze(segments.map(
    (segment): MappedMarkdownCanonicalIdentityRun => Object.freeze({
      candidateStart: segment.projectedStart,
      candidateEnd: segment.projectedEnd,
      sourceRunId: segment.sourceRunId,
      sourceStart: segment.sourceStart
    })
  ))
  // Boundary edits arise only from Substitution-arm scopes and arm terminations
  // (with no scopes the boundary policy is undefined). With neither, planning
  // provably yields no edits, so skip the full document parse it would run — a
  // CriticMarkup-free view is then parsed exactly once (its authoritative CST),
  // never a second time to discover boundary edits it has none of.
  const armBoundaryProjectionEdits =
    matchingScopes.length === 0 && armTerminationEdits.length === 0
      ? EMPTY_ARM_BOUNDARY_PROJECTION_EDITS
      : planMarkdownArmBoundaryProjectionEdits({
        source: projectedSource,
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
  const bofSafe = encodeMovedBofText(armSafe.source, armSafe.segments)
  // The boundary guard exists to catch CriticMarkup that the projection itself
  // synthesized where elision made two non-adjacent canonical runs adjacent. A
  // document with no CriticMarkup elides nothing: every view is the canonical
  // source, there is no join, and no marker can be manufactured. Recognizing
  // CriticMarkup again to discover that is pure waste, so the guard is skipped
  // and its accepted-marker count is zero by construction.
  const guarded = graph.criticMarkup.roots.length === 0
    ? Object.freeze({
      source: bofSafe.source,
      segments: bofSafe.segments,
      acceptedMarkerCount: 0
    })
    : guardProjectionCandidate(
      bofSafe.source,
      bofSafe.segments,
      graph.markerDecisions
    )
  const mappedTape = Object.freeze(guarded.segments.map(freezeSegment))
  // Phase 0 invariant 6 fact: parser-owned arm scopes are re-anchored onto the
  // flattened candidate by canonical identity after the fact. A projection with
  // no arm scopes performs no such join.
  if (matchingScopes.length !== 0) {
    traceRecorder?.recordPostHocJoin('matching-scopes')
  }
  const retainedMatchingScopes = remapMatchingScopesByCanonicalIdentity(
    graph,
    matchingScopes,
    guarded.segments,
    traceRecorder === undefined
      ? undefined
      : (start, end) => {
        traceRecorder.recordScopeRemapVisit(traceView, start, end)
      }
  )
  // Phase 0 forbidden-architecture fact (plan line 89): a published Markdown CST
  // produced by running the grammar over a flattened projected string cannot
  // share parser-created identity with a canonical CriticMarkup node.
  //
  // When the guarded candidate is byte-identical to canonical source, nothing
  // was flattened: offsets map 1:1 onto canonical source, so this is a canonical
  // parse and the identity objection does not arise. That equality is the
  // condition, not the absence of CriticMarkup — a projection that elides or
  // generates even one code unit is still a flattened reparse.
  traceRecorder?.recordAuthoritativeMarkdownParse(
    guarded.source === graph.source ? 'canonical-source' : 'flattened-projection',
    traceView
  )
  const markdownParse = parseMarkdownDocument({
    source: guarded.source,
    matchingScopes: retainedMatchingScopes
  }, markdownDepthLimit, reuseCache)
  // Phase 0.5 step 1: the clean verifier no longer recognizes CriticMarkup. It
  // needs only (a) proof the projection synthesized no CriticMarkup — supplied
  // by the guard's accepted-marker count — and (b) a matching-scope-free
  // Markdown CST to compare the scope-constrained parse against, which is a
  // plain `parseMarkdownDocument` (CriticMarkup-blind by construction).
  if (guarded.acceptedMarkerCount !== 0) {
    throw new Error('Boundary-safe projection verification produced synthetic CriticMarkup')
  }
  // The clean verification proves that constraining the parse to the
  // parser-owned Substitution-arm scopes did not change the Markdown structure.
  // With no scopes to constrain it, the "clean" parse takes byte-identical
  // inputs to the scoped one, so the comparison is a tautology and the second
  // parse is pure waste. Views that do carry arm scopes still verify.
  //
  // The editing view is exempt, and must be. Its premise is materialization:
  // Original and Revised can be committed as canonical bytes (Accept All /
  // Reject All) and reparsed with no scopes, so scoped must equal unscoped
  // there. The editing view is never materialized — the marker-bearing
  // canonical source is what is saved — and it is the one view that shows BOTH
  // Substitution arms, adjacent. Arm scoping is therefore load-bearing rather
  // than incidental (ADR-0010: matching state created in an arm finishes in
  // that arm), so `{~~*x*~>*y*~~}` must keep one emphasis per arm instead of
  // pairing `*` across the junction. Requiring the unscoped reading to agree
  // would demand exactly the cross-arm pairing ADR-0010 forbids.
  const cleanMarkdownParse =
    retainedMatchingScopes.length === 0 || view === 'editing'
      ? markdownParse
      : parseMarkdownDocument({ source: guarded.source }, markdownDepthLimit)
  if (cleanMarkdownParse !== markdownParse) {
    verifyCleanProjectedMarkdownV1(
      markdownParse.document,
      cleanMarkdownParse.document
    )
  }
  const expectedDepthFailure = markdownParse.containerDepthFailure
  const cleanDepthFailure = cleanMarkdownParse.containerDepthFailure
  if (
    expectedDepthFailure?.start !== cleanDepthFailure?.start ||
    expectedDepthFailure?.end !== cleanDepthFailure?.end ||
    expectedDepthFailure?.observed !== cleanDepthFailure?.observed
  ) {
    throw new Error('Clean projection Markdown mismatch: container depth')
  }
  return Object.freeze({
    source: guarded.source,
    mappedTape,
    provenance: createProvenance(guarded.source.length, mappedTape),
    markdown: markdownParse.document,
    markdownDepthFailure: markdownParse.containerDepthFailure
  })
}

function createCommentDisplayProjections(
  graph: Profile1SyntaxGraphCore,
  markdownDepthLimit: number,
  traceRecorder?: ProfileParseTraceRecorderV1
): readonly Profile1ProjectedMarkdown[] {
  const displays: Profile1ProjectedMarkdown[] = []
  for (const branch of graph.canonicalMarkdown.branches) {
    if (branch.node.kind === 'comment') {
      const armLane = branch.arms[0]
      if (armLane !== undefined) {
        displays.push(project(
          graph,
          'revised',
          armLane,
          markdownDepthLimit,
          traceRecorder,
          'comment-display'
        ))
      }
    }
  }
  return Object.freeze(displays)
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
 * Every CriticMarkup node and every CriticMarkup diagnostic requires at least
 * one of these ten marker tokens in the source. A document containing none of
 * them is pure Profile 1 Markdown: it has no CM forest, no marker decisions and
 * no CM diagnostics, so no CriticMarkup state machine is needed to parse it.
 *
 * The test is deliberately a necessary condition only. A false positive costs
 * nothing but the legacy path; a false negative is impossible, because a marker
 * token cannot be recognized without appearing literally in the source.
 */
const CRITIC_MARKER_TOKEN = /\{(?:\+\+|--|~~|==|>>)|(?:\+\+|--|~~|==|<<)\}/

/**
 * Phase 0 intrinsic-kernel beachhead.
 *
 * Hands canonical source straight to the Profile 1 Markdown lane. The Markdown
 * parser owns source progression here and its parse is the authoritative CST:
 * no marker scan drives the loop, no parse frame or marker decision exists, and
 * nothing is flattened and reparsed. This is the ownership direction Phase 0
 * requires, proven first on the documents that need no CriticMarkup grammar at
 * all; extending it to documents that do contain CM is the remaining work.
 */
function parseMarkdownOnlyPass(
  source: string,
  markdownDepthLimit: number,
  traceRecorder?: ProfileParseTraceRecorderV1
): ParseOutcome {
  traceRecorder?.recordSourceProgression('markdown-kernel')
  const markdownLane = createMarkdownLaneState(
    source,
    markdownDepthLimit,
    undefined
  )
  const canonical = finalizeCanonicalTape(source, Object.freeze([]))
  let checkpoint = markdownLane.emptyCheckpoint
  const markdownArtifact = createCanonicalMarkdownParseRecorder(
    source.length,
    checkpoint
  )
  const stagedMarkdownLiterals: MarkdownLiteralRange[] = []
  let firstMarkdownDepthFailure: MarkdownContainerDepthFailure | undefined
  const noteMarkdownDepthFailure = (
    candidate: MarkdownCheckpoint
  ): void => {
    const failure = markdownLane.containerDepthFailure(candidate)
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

  for (const run of canonical.tape) {
    if (!isMarkdownTextTapeRole(run.role)) {
      continue
    }
    const entryCheckpoint = checkpoint
    const advanced = markdownLane.advance(
      entryCheckpoint,
      run.range.start,
      run.range.end,
      0,
      source.length,
      source.length
    )
    markdownArtifact.recordTransition(
      markdownArtifact.root,
      'advance',
      entryCheckpoint,
      advanced.checkpoint,
      run.range.start,
      run.range.end,
      advanced.completedLiterals
    )
    checkpoint = advanced.checkpoint
    noteMarkdownDepthFailure(checkpoint)
    stagedMarkdownLiterals.push(...advanced.completedLiterals)
  }

  const finishedRootLane = markdownLane.finishLane(checkpoint, source.length)
  markdownArtifact.recordTransition(
    markdownArtifact.root,
    'finish-lane',
    checkpoint,
    finishedRootLane.checkpoint,
    source.length,
    source.length,
    finishedRootLane.completedLiterals
  )
  checkpoint = finishedRootLane.checkpoint
  noteMarkdownDepthFailure(checkpoint)
  stagedMarkdownLiterals.push(...finishedRootLane.completedLiterals)

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

  return Object.freeze({
    kind: 'complete',
    tape: canonical.tape,
    roots: Object.freeze([]),
    diagnostics: Object.freeze([]),
    markerDecisions: canonical.markerDecisions,
    canonicalMarkdownParse: markdownArtifact.finish(canonical.tape, checkpoint),
    rejectedDelimiters: Object.freeze([]),
    markdownLiterals: finalizeAuthenticatedMarkdownLiterals(
      Object.freeze([]),
      stagedMarkdownLiterals,
      Object.freeze([])
    )
  })
}

export function parseProfile1Document(
  source: string,
  executionBudget: ExecutionBudgetId,
  traceRecorder?: ProfileParseTraceRecorderV1
): Profile1DocumentResult {
  const usesDesktopLimits = executionBudget.limitsProfile === 'desktop-v1'
  if (usesDesktopLimits && source.length > DESKTOP_SOURCE_UNIT_LIMIT) {
    return Object.freeze({
      kind: 'source-only',
      fatalDiagnostic: createResourceDiagnostic(
        'CM_RESOURCE_SOURCE_UNITS_EXCEEDED',
        sourceRange(DESKTOP_SOURCE_UNIT_LIMIT, DESKTOP_SOURCE_UNIT_LIMIT),
        DESKTOP_SOURCE_UNIT_LIMIT,
        source.length
      )
    })
  }
  traceRecorder?.recordCanonicalSourceAdmission(source.length)
  const markdownDepthLimit = usesDesktopLimits
    ? DESKTOP_MARKDOWN_DEPTH_LIMIT
    : Number.POSITIVE_INFINITY
  // A source with no CriticMarkup marker token needs no CriticMarkup grammar,
  // so it takes the intrinsic-kernel path where the Markdown parser owns
  // progression. Everything else still runs the legacy CM-first driver, in
  // which a CriticMarkup state machine consumes canonical source and consults a
  // Markdown lane — the target-incompatible ownership Phase 0 must remove.
  const usesCriticMarkupDriver = CRITIC_MARKER_TOKEN.test(source)
  if (usesCriticMarkupDriver) {
    traceRecorder?.recordSourceProgression('criticmarkup-driver')
  }
  const parsed = usesCriticMarkupDriver
    ? parseCriticMarkup(
      source,
      usesDesktopLimits ? DESKTOP_CM_DEPTH_LIMIT : Number.POSITIVE_INFINITY,
      markdownDepthLimit,
      undefined,
      undefined,
      traceRecorder
    )
    : parseMarkdownOnlyPass(source, markdownDepthLimit, traceRecorder)
  if (parsed.kind === 'resource-failure') {
    return Object.freeze({ kind: 'source-only', fatalDiagnostic: parsed.fatalDiagnostic })
  }
  const criticMarkupRoots = parsed.roots
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
  // Phase 0 invariant 6 fact: canonical ownership is reconstructed by an
  // interval join over marker/EOL/literal spans after parsing, rather than
  // created with syntax. The kernel path still inherits this join; retiring it
  // requires parser-created ownership, which is later Phase 0 work.
  if (usesCriticMarkupDriver) {
    traceRecorder?.recordPostHocJoin('source-ownership')
  }
  const graphCore = createProfile1SyntaxGraphCore(
    source,
    criticMarkup,
    parsed.markdownLiterals,
    parsed.tape,
    parsed.markerDecisions,
    parsed.canonicalMarkdownParse
  )
  // One cache spanning the view projections: Original is analysed in full, and
  // Revised reuses every region the two views share, re-analysing only where a
  // marker actually resolves differently (ADR-0013 slice 2).
  const laneReuse: PlainMarkdownLaneReuseCache = {}
  const original = project(
    graphCore,
    'original',
    undefined,
    markdownDepthLimit,
    traceRecorder,
    undefined,
    laneReuse
  )
  // ADR 0013: parse once and read every view off it. Original and Revised differ
  // only where a form resolves differently between them — Additions, Deletions
  // and Substitutions. A document carrying none of those (no CriticMarkup at
  // all, or only Highlights and Comments, which both views render identically)
  // is byte-identical across the two views, so Revised reads Original's parse
  // instead of re-parsing unchanged text.
  const revised = forestContainsKind(criticMarkup.roots, VIEW_DIVERGENT_KINDS)
    ? project(
      graphCore,
      'revised',
      undefined,
      markdownDepthLimit,
      traceRecorder,
      undefined,
      laneReuse
    )
    : original
  const commentDisplays = createCommentDisplayProjections(
    graphCore,
    markdownDepthLimit,
    traceRecorder
  )
  const projectedDepthDiagnostic = usesDesktopLimits
    ? projectedMarkdownDepthDiagnostic(
      Object.freeze([original, revised, ...commentDisplays]),
      DESKTOP_MARKDOWN_DEPTH_LIMIT
    )
    : undefined
  if (projectedDepthDiagnostic !== undefined) {
    return Object.freeze({ kind: 'source-only', fatalDiagnostic: projectedDepthDiagnostic })
  }
  // Lazy: the editing view is computed only when the editor's block layer reads
  // it, so it never adds a parse to open(). It also reuses an existing
  // projection whenever one already covers identical text, rather than parsing
  // the same bytes twice (invariant 21).
  let editingCache: Profile1ProjectedMarkdown | undefined
  const editing = (): Profile1ProjectedMarkdown => {
    editingCache ??= reusableEditingProjection(criticMarkup.roots, original, revised) ??
      project(graphCore, 'editing', undefined, markdownDepthLimit)
    return editingCache
  }
  return finalizeProfile1SyntaxGraph(graphCore, {
    diagnostics: createDiagnosticIndex(parsed.diagnostics),
    markup: createMarkupProjection(source, criticMarkup.roots),
    original,
    revised,
    commentDisplays,
    editing
  })
}
