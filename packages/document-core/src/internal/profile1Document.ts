import type {
  CriticMarkupArm,
  CriticMarkupNode,
  DiagnosticIndex,
  ExecutionBudgetId,
  MarkupMark,
  MarkupProjection,
  MarkupProjectionRun,
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
  type MarkdownCheckpoint,
  type MarkdownReferenceDefinitionLookup
} from './profile1/markdownLaneState.js'
import {
  createProfile1ReferenceDefinitionIndex
} from './profile1/referenceDefinitionIndex.js'
import {
  createCanonicalMarkdownParseRecorder,
  type CanonicalMarkdownParseArtifact,
  type CanonicalMarkdownParseLaneHandle
} from './profile1/canonicalMarkdownArtifact.js'
import {
  assertLosslessTape,
  findMarker,
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
  parseMarkdownDocument,
  type Profile1MarkdownParse
} from './profile1/markdownParser.js'

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
  readonly armStartCheckpoint: MarkdownCheckpoint
  readonly artifactParentLane: CanonicalMarkdownParseLaneHandle
  readonly artifactArmLanes: CanonicalMarkdownParseLaneHandle[]
  currentArtifactLane: CanonicalMarkdownParseLaneHandle
  currentCheckpoint: MarkdownCheckpoint
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

type ProjectionTask = LaneTask | AppendTask

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
  retainedMarkdownLiterals?: readonly MarkdownLiteralRange[],
  referenceDefinitions: MarkdownReferenceDefinitionLookup = new Set(),
  markdownDepthLimit: number = Number.POSITIVE_INFINITY,
  delimiterPolicy?: Profile1DelimiterPolicy
): ParseOutcome {
  const markdownLane = createMarkdownLaneState(
    source,
    markdownDepthLimit,
    referenceDefinitions
  )
  const markdownLiterals =
    retainedMarkdownLiterals === undefined
      ? Object.freeze([])
      : retainedMarkdownLiterals
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

  const isInsideAuthenticatedRootLiteral = (range: SourceRange): boolean => {
    let low = 0
    let high = markdownLiterals.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      const literal = markdownLiterals[middle]
      if (literal !== undefined && literal.start <= range.start) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    const literal = markdownLiterals[low - 1]
    if (
      literal === undefined ||
      range.start < literal.start ||
      range.end > literal.end
    ) {
      return false
    }

    // Inline providers are authenticated by the current virtual lane, where
    // accepted CM markers are zero-width. A canonical raw-source prepass
    // cannot decide their ownership across an accepted carrier boundary.
    if (
      literal.kind === 'inline-code' ||
      literal.kind === 'inline-html' ||
      literal.kind === 'autolink' ||
      literal.kind === 'link-destination' ||
      literal.kind === 'math'
    ) {
      return false
    }

    for (const authenticated of stagedMarkdownLiterals) {
      if (
        authenticated.start < literal.start &&
        literal.start < authenticated.end
      ) {
        return false
      }
    }

    // A root literal whose opener was inside an already accepted root CM
    // carrier belongs to that carrier's independent arm lane. It cannot
    // reach back out and erase a later sibling carrier.
    low = 0
    high = roots.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      const root = roots[middle]
      if (root !== undefined && root.range.start <= literal.start) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    const owner = roots[low - 1]
    return !(
      owner !== undefined &&
      literal.start >= owner.range.start &&
      literal.start < owner.range.end
    )
  }

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
    const checkpointLiteralOwnsMarker =
      markdownLane.markerIsLiteralOwned(checkpoint) &&
      !compatibleActiveFrameCloser
    const insideLiteral =
      checkpointLiteralOwnsMarker ||
      isInsideAuthenticatedRootLiteral(run.range)
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
      const armStartCheckpoint = markdownLane.forkArm(
        continuationCheckpoint,
        run.range.end,
        definition.kind === 'comment'
      )
      const artifactParentLane = currentMarkdownArtifactLane()
      const artifactArmLane = markdownArtifact.forkLane(armStartCheckpoint)
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
        armStartCheckpoint,
        artifactParentLane,
        artifactArmLanes: [artifactArmLane],
        currentArtifactLane: artifactArmLane,
        currentCheckpoint: armStartCheckpoint
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
        markdownArtifact.sealLane(
          frame.currentArtifactLane,
          frame.currentCheckpoint
        )
        const nextArtifactArm = markdownArtifact.forkLane(
          frame.armStartCheckpoint
        )
        frame.artifactArmLanes.push(nextArtifactArm)
        frame.currentArtifactLane = nextArtifactArm
        frame.separator = run
        frame.currentCheckpoint = frame.armStartCheckpoint
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
    const rejoinedCheckpoint = markdownLane.rejoinCarrier(
      frame.continuationCheckpoint,
      frame.armStartCheckpoint,
      frame.currentCheckpoint,
      node.kind === 'comment',
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
      markdownLiterals,
      stagedMarkdownLiterals,
      roots
    )
  })
}

function parseCriticMarkup(
  source: string,
  cmDepthLimit: number = Number.POSITIVE_INFINITY,
  retainedMarkdownLiterals?: readonly MarkdownLiteralRange[],
  markdownDepthLimit: number = Number.POSITIVE_INFINITY,
  delimiterPolicy?: Profile1DelimiterPolicy,
  projectedMarkdownDepthLimit?: number
): ParseOutcome {
  const blockStage = parseCriticMarkupPass(
    source,
    cmDepthLimit,
    retainedMarkdownLiterals,
    undefined,
    markdownDepthLimit,
    delimiterPolicy
  )
  if (blockStage.kind !== 'complete') {
    return blockStage
  }
  const referenceDefinitions = createProfile1ReferenceDefinitionIndex(
    source,
    blockStage.roots,
    blockStage.markdownLiterals
  )
  const completed = referenceDefinitions.size === 0
    ? blockStage
    : parseCriticMarkupPass(
      source,
      cmDepthLimit,
      retainedMarkdownLiterals,
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
    runs: frozenRuns
  })
}

function selectedCanonicalArm(
  branch: CanonicalMarkdownCriticBranch,
  view: 'original' | 'revised'
): CanonicalMarkdownLane | undefined {
  const node = branch.node
  if (node.kind === 'addition') {
    return view === 'revised' ? branch.arms[0] : undefined
  }
  if (node.kind === 'deletion') {
    return view === 'original' ? branch.arms[0] : undefined
  }
  if (node.kind === 'substitution') {
    return view === 'original' ? branch.arms[0] : branch.arms[1]
  }
  if (node.kind === 'highlight') {
    return branch.arms[0]
  }
  if (node.kind === 'comment') {
    return undefined
  }
  throw new Error('CriticMarkup projection reached an unknown form')
}

interface PlannedProtection {
  readonly candidateOffset: number
  readonly sourcePosition: number
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

function applyProtections(
  candidateSource: string,
  candidateSegments: readonly MutableProjectionSegment[],
  protections: readonly PlannedProtection[]
): Readonly<{ source: string; segments: readonly MutableProjectionSegment[] }> {
  if (protections.length === 0) {
    return Object.freeze({ source: candidateSource, segments: candidateSegments })
  }
  const chunks: string[] = []
  const segments: MutableProjectionSegment[] = []
  let candidateCursor = 0
  let projectedLength = 0
  for (const protection of protections) {
    chunks.push(candidateSource.slice(candidateCursor, protection.candidateOffset))
    appendProjectionRange(
      segments,
      candidateSegments,
      candidateCursor,
      protection.candidateOffset,
      projectedLength
    )
    projectedLength += protection.candidateOffset - candidateCursor
    chunks.push('\\')
    segments.push({
      kind: 'generated',
      projectedStart: projectedLength,
      projectedEnd: projectedLength + 1,
      sourcePosition: protection.sourcePosition,
      affinity: 'next'
    })
    projectedLength += 1
    candidateCursor = protection.candidateOffset
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
): Readonly<{ source: string; segments: readonly MutableProjectionSegment[] }> {
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
    undefined,
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
  return applyProtections(candidateSource, candidateSegments, protections)
}

function project(
  graph: Profile1SyntaxGraphCore,
  view: 'original' | 'revised',
  lane: CanonicalMarkdownLane = graph.canonicalMarkdown.root,
  markdownDepthLimit: number = Number.POSITIVE_INFINITY
): Profile1ProjectedMarkdown {
  const source = graph.source
  const chunks: string[] = []
  const segments: MutableCanonicalProjectionSegment[] = []
  const tasks: ProjectionTask[] = [{ kind: 'lane', lane }]
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
      const arm = selectedCanonicalArm(item, view)
      if (arm !== undefined) {
        orderedTasks.push({ kind: 'lane', lane: arm })
      }
    }
    for (let index = orderedTasks.length - 1; index >= 0; index -= 1) {
      const orderedTask = orderedTasks[index]
      if (orderedTask !== undefined) {
        tasks.push(orderedTask)
      }
    }
  }

  const projectedSource = chunks.join('')
  const bofSafe = encodeMovedBofText(projectedSource, segments)
  const guarded = guardProjectionCandidate(
    bofSafe.source,
    bofSafe.segments,
    graph.markerDecisions
  )
  const mappedTape = Object.freeze(guarded.segments.map(freezeSegment))
  const verification = parseCriticMarkup(
    guarded.source,
    Number.POSITIVE_INFINITY,
    undefined,
    Number.POSITIVE_INFINITY,
    undefined,
    markdownDepthLimit
  )
  if (verification.kind !== 'complete') {
    throw new Error('Boundary-safe projection verification exceeded an internal resource budget')
  }
  if (verification.roots.length !== 0) {
    throw new Error('Boundary-safe projection verification produced synthetic CriticMarkup')
  }
  const markdownParse = verification.projectedMarkdown
  if (markdownParse === undefined) {
    throw new Error('Boundary-safe projection verification omitted its Markdown product')
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
  markdownDepthLimit: number
): readonly Profile1ProjectedMarkdown[] {
  const displays: Profile1ProjectedMarkdown[] = []
  for (const branch of graph.canonicalMarkdown.branches) {
    if (branch.node.kind === 'comment') {
      const armLane = branch.arms[0]
      if (armLane !== undefined) {
        displays.push(project(graph, 'revised', armLane, markdownDepthLimit))
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

export function parseProfile1Document(
  source: string,
  executionBudget: ExecutionBudgetId
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
  const parsed = parseCriticMarkup(
    source,
    usesDesktopLimits ? DESKTOP_CM_DEPTH_LIMIT : Number.POSITIVE_INFINITY,
    undefined,
    usesDesktopLimits
      ? DESKTOP_MARKDOWN_DEPTH_LIMIT
      : Number.POSITIVE_INFINITY
  )
  if (parsed.kind === 'resource-failure') {
    return Object.freeze({ kind: 'source-only', fatalDiagnostic: parsed.fatalDiagnostic })
  }
  const criticMarkup = Object.freeze({ roots: parsed.roots })
  const graphCore = createProfile1SyntaxGraphCore(
    source,
    criticMarkup,
    parsed.markdownLiterals,
    parsed.tape,
    parsed.markerDecisions,
    parsed.canonicalMarkdownParse
  )
  const markdownDepthLimit = usesDesktopLimits
    ? DESKTOP_MARKDOWN_DEPTH_LIMIT
    : Number.POSITIVE_INFINITY
  const original = project(graphCore, 'original', undefined, markdownDepthLimit)
  const revised = project(graphCore, 'revised', undefined, markdownDepthLimit)
  const commentDisplays = createCommentDisplayProjections(
    graphCore,
    markdownDepthLimit
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
  return finalizeProfile1SyntaxGraph(graphCore, {
    diagnostics: createDiagnosticIndex(parsed.diagnostics),
    markup: createMarkupProjection(source, criticMarkup.roots),
    original,
    revised,
    commentDisplays
  })
}
