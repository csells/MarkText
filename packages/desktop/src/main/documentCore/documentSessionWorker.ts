import {
  WireEnvelopeCodecV1,
  acknowledgeClipboardWrite,
  authorizeCut,
  consumeTrustedHtml,
  createDocumentSession,
  createSourceSnapshot,
  DocumentExecutionCancelledError,
  groupRenderBlocks,
  installOneShotSha256Provider,
  markdownHeadingAnchors,
  materializePersistenceConsumer,
  PARSE_LOGICAL_NODE_CHECKPOINT_INTERVAL,
  PARSE_SOURCE_CHECKPOINT_INTERVAL,
  recoverDocumentSession,
  renderMarkupPlan,
  routeLiveConsumer,
  resolveMarkdownDocumentLinkTarget,
  type ClipboardConsumerRequest,
  type CanonicalSourceLease,
  type CriticMarkupProjection,
  type CutPreparation,
  type DispatchTicket,
  type DocumentSession,
  type DocumentSessionJournalMutation,
  type DocumentSessionJournalStorage,
  type DocumentFacts,
  type EditorSnapshot,
  type IntentId,
  type MarkdownDocument,
  type MarkdownNode,
  type ModelRange,
  type ModelSelection,
  type NodeId,
  type ParseConfiguration,
  type ParseExecutionControl,
  type ParseExecutionProgress,
  type Profile1PhysicalTraversalCountsV1,
  zeroPhysicalTraversalCountsV1,
  type ReviewIndex,
  type RevisionSourceEdit,
  type SourceModelSelection,
  type StaticConsumer,
  type StaticConsumerRequest,
  type WireEnvelopeV1,
  type WireMemberNameV1
} from '@marktext/document-core'
import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import {
  parentPort,
  threadId,
  type TransferListItem,
  workerData
} from 'node:worker_threads'
import type {
  DocumentCoreExecutionReport,
  DocumentCoreExecutionOperationKind,
  DocumentCoreHistoryState,
  DocumentCoreOpenCompletion,
  DocumentCorePersistenceLeaseResult,
  DocumentCorePublication,
  DocumentCoreReloadCompletion,
  DocumentCoreSessionSourceDelta
} from '../../shared/types/documentCore'
import {
  encodeDocumentCoreLiveDeltaV1,
  type DecodedDocumentCoreLiveDeltaV1
} from '../../shared/documentCoreLiveWire'
import {
  DOCUMENT_CORE_ACTIVE_EXECUTION_INDEX,
  DOCUMENT_CORE_CANCEL_OBSERVED_INDEX,
  DOCUMENT_CORE_CANCEL_REQUESTED_INDEX,
  DOCUMENT_CORE_EXECUTION_CHECKPOINT_INDEX,
  DOCUMENT_CORE_EXECUTION_CONTROL_WORDS,
  type DocumentCoreMainToWorkerMessage,
  type DocumentCoreWorkerCommand,
  type DocumentCoreWorkerCommandResponse,
  type DocumentCoreWorkerStorageRequest,
  type DocumentCoreWorkerStorageResponse,
  type DocumentCoreWorkerToMainMessage,
  type DocumentCoreWorkerData
} from './documentSessionWorkerProtocol'
import {
  decodeDocumentParseConfiguration
} from './documentParseConfiguration'

// Envelope member hashing is one-shot over megabyte payloads at the maximum
// document; the native digest keeps that off the owning thread's stall
// budget where the pure fallback costs ~100ms.
installOneShotSha256Provider((chunks) => {
  const hash = createHash('sha256')
  for (const chunk of chunks) hash.update(chunk)
  return hash.digest('hex')
})

// Owning-thread stall diagnosis: when MARKTEXT_STALL_TRACE names a file,
// publication-building spans append their durations there so a breached
// heartbeat budget can be attributed to a specific span instead of a guess.
const traceStallSpan = <T>(name: string, build: () => T): T => {
  const traceStall = process.env.MARKTEXT_STALL_TRACE
  if (!traceStall) return build()
  const startedAt = performance.now()
  const value = build()
  appendFileSync(
    traceStall,
    JSON.stringify({ span: name, ms: performance.now() - startedAt }) + '\n'
  )
  return value
}

if (parentPort === null) {
  throw new Error('Document session worker requires a parent message port')
}

const port = parentPort
const receivedWorkerData = workerData as Partial<DocumentCoreWorkerData>
if (
  !(receivedWorkerData.executionControl instanceof SharedArrayBuffer) ||
  receivedWorkerData.executionControl.byteLength !==
    DOCUMENT_CORE_EXECUTION_CONTROL_WORDS * Int32Array.BYTES_PER_ELEMENT
) {
  throw new TypeError('Document session worker has no execution control')
}
const executionControlWords =
  new Int32Array(receivedWorkerData.executionControl)
const encoder = new TextEncoder()
let nextStorageRequestId = 0
let publicationSequence = 0
let commandTail: Promise<void> = Promise.resolve()
let session: DocumentSession | undefined
let expectedOpenOrdinal = 0
const openChunks: string[] = []
const tickets = new Map<string, Readonly<{
  baseSnapshotId: string
  ticket: DispatchTicket
  consuming: boolean
}>>()
const dispatchPreparationReleases = new Map<string, () => void>()
const consumedTickets = new Set<string>()
let nextCutTicket = 0
const cutTickets = new Map<string, Readonly<{
  baseSnapshotId: string
  preparation: CutPreparation
  target: ModelSelection
  consumer: 'cut' | 'cut-table'
}>>()
const consumedCutTickets = new Set<string>()
const consumedCutTicketOrder: string[] = []
const MAX_CONSUMED_CUT_TOMBSTONES = 1_024
const persistenceLeases = new Map<string, Readonly<{
  source: CanonicalSourceLease
}>>()
const releasedPersistenceLeases = new Set<string>()
const releasedPersistenceLeaseOrder: string[] = []
const MAX_RELEASED_PERSISTENCE_LEASE_TOMBSTONES = 1_024
const pendingStorage = new Map<
  number,
  Readonly<{
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
  }>
>()
let executionProgress: ParseExecutionProgress = Object.freeze({
  sourceUnits: 0,
  logicalNodes: 0
})
let checkpointCount = 0
let sourceCheckpointCount = 0
let logicalNodeCheckpointCount = 0
let maximumSourceDelta = 0
let maximumLogicalNodeDelta = 0

interface ActiveExecutionOperation {
  readonly kind: DocumentCoreExecutionOperationKind
  readonly generation: number
  readonly startedAt: number
  readonly sourceUnitsAtStart: number
  readonly logicalNodesAtStart: number
  lastCheckpointAt: number
  checkpointCount: number
  sourceCheckpointCount: number
  logicalNodeCheckpointCount: number
  maximumSourceDelta: number
  maximumLogicalNodeDelta: number
  maximumCheckpointGapMs: number
  maximumHeartbeatGapMs: number
  readonly physicalWorkAtStart: Profile1PhysicalTraversalCountsV1
}

let activeExecutionOperation: ActiveExecutionOperation | undefined
let workerHeartbeatAt = performance.now()
const workerHeartbeat = setInterval(() => {
  const now = performance.now()
  const gap = now - workerHeartbeatAt
  workerHeartbeatAt = now
  if (activeExecutionOperation !== undefined) {
    activeExecutionOperation.maximumHeartbeatGapMs = Math.max(
      activeExecutionOperation.maximumHeartbeatGapMs,
      gap
    )
  }
}, 1)
workerHeartbeat.unref()

function beginExecutionOperation(
  kind: DocumentCoreExecutionOperationKind,
  generation: number
): void {
  if (activeExecutionOperation !== undefined) {
    throw new Error(
      `Execution operation ${activeExecutionOperation.kind} is still active`
    )
  }
  if (!Number.isInteger(generation) || generation <= 0) {
    throw new RangeError('Execution operation generation is invalid')
  }
  const now = performance.now()
  workerHeartbeatAt = now
  activeExecutionOperation = {
    kind,
    generation,
    startedAt: now,
    sourceUnitsAtStart: executionProgress.sourceUnits,
    logicalNodesAtStart: executionProgress.logicalNodes,
    lastCheckpointAt: now,
    checkpointCount: 0,
    sourceCheckpointCount: 0,
    logicalNodeCheckpointCount: 0,
    maximumSourceDelta: 0,
    maximumLogicalNodeDelta: 0,
    maximumCheckpointGapMs: 0,
    maximumHeartbeatGapMs: 0,
    // Operation deltas come from the session-owned engine record; an 'open'
    // begins before its session exists, so its baseline is the zero record a
    // fresh engine starts from.
    physicalWorkAtStart: session?.physicalWork() ?? zeroPhysicalTraversalCountsV1()
  }
  Atomics.store(
    executionControlWords,
    DOCUMENT_CORE_ACTIVE_EXECUTION_INDEX,
    generation
  )
}

const executionControl: ParseExecutionControl = Object.freeze({
  checkpoint: Object.freeze((progress: ParseExecutionProgress): void => {
    const checkpointAt = performance.now()
    const sourceDelta = progress.sourceUnits - executionProgress.sourceUnits
    const logicalNodeDelta =
      progress.logicalNodes - executionProgress.logicalNodes
    if (sourceDelta < 0 || logicalNodeDelta < 0) {
      throw new Error('Worker execution progress moved backwards')
    }
    if (
      sourceDelta > PARSE_SOURCE_CHECKPOINT_INTERVAL ||
      logicalNodeDelta > PARSE_LOGICAL_NODE_CHECKPOINT_INTERVAL
    ) {
      throw new Error('Worker execution skipped a cooperative checkpoint')
    }
    checkpointCount += 1
    if (sourceDelta > 0) sourceCheckpointCount += 1
    if (logicalNodeDelta > 0) logicalNodeCheckpointCount += 1
    maximumSourceDelta = Math.max(maximumSourceDelta, sourceDelta)
    maximumLogicalNodeDelta =
      Math.max(maximumLogicalNodeDelta, logicalNodeDelta)
    const operation = activeExecutionOperation
    if (operation !== undefined) {
      operation.checkpointCount += 1
      if (sourceDelta > 0) {
        operation.sourceCheckpointCount += 1
      }
      if (logicalNodeDelta > 0) {
        operation.logicalNodeCheckpointCount += 1
      }
      operation.maximumSourceDelta = Math.max(
        operation.maximumSourceDelta,
        sourceDelta
      )
      operation.maximumLogicalNodeDelta = Math.max(
        operation.maximumLogicalNodeDelta,
        logicalNodeDelta
      )
      operation.maximumCheckpointGapMs = Math.max(
        operation.maximumCheckpointGapMs,
        checkpointAt - operation.lastCheckpointAt
      )
      operation.lastCheckpointAt = checkpointAt
    }
    executionProgress = Object.freeze({
      sourceUnits: progress.sourceUnits,
      logicalNodes: progress.logicalNodes
    })
    if (operation !== undefined) {
      Atomics.store(
        executionControlWords,
        DOCUMENT_CORE_EXECUTION_CHECKPOINT_INDEX,
        operation.generation
      )
      Atomics.notify(
        executionControlWords,
        DOCUMENT_CORE_EXECUTION_CHECKPOINT_INDEX
      )
    }
    if (
      operation !== undefined &&
      Atomics.load(
        executionControlWords,
        DOCUMENT_CORE_CANCEL_REQUESTED_INDEX
      ) === operation.generation
    ) {
      const cancelledGeneration = operation.generation
      Atomics.store(
        executionControlWords,
        DOCUMENT_CORE_CANCEL_OBSERVED_INDEX,
        cancelledGeneration
      )
      Atomics.notify(
        executionControlWords,
        DOCUMENT_CORE_CANCEL_OBSERVED_INDEX
      )
      throw new DocumentExecutionCancelledError()
    }
  })
})

interface PortableSessionMember {
  readonly schema: 'document-core-session-delta-1'
  readonly snapshotId: string
  readonly revisionId: string
  readonly kind: 'complete' | 'source-only'
  readonly sourceDelta: DocumentCoreSessionSourceDelta
  readonly sourceHash: string
  readonly semanticHash: string
  readonly parseConfiguration: ParseConfiguration
  readonly selection: ModelSelection | null
  readonly sourceSelection: SourceModelSelection
  readonly historyState: DocumentCoreHistoryState
  readonly facts: DocumentFacts
  readonly fatalDiagnostic?: unknown
}

type PortableLiveMember = DecodedDocumentCoreLiveDeltaV1

type DocumentCoreWorkerPublication = Omit<
  DocumentCorePublication,
  'documentId'
>

interface PortableReviewMember {
  readonly schema: 'document-core-review-delta-1'
  readonly trackChanges: boolean
  readonly projection: CriticMarkupProjection
  readonly markupModelLength: number
  readonly reviewIndex: ReviewIndex
}

interface PortableStaticHtml {
  readonly kind: 'isolated-html'
  readonly sink: 'static' | 'styled' | 'pdf' | 'print'
  readonly view: 'markup' | 'original' | 'revised'
  readonly text: string
}

interface PortableClipboardHtml {
  readonly kind: 'isolated-html'
  readonly sink: 'clipboard'
  readonly view: 'markup' | 'original' | 'revised'
  readonly text: string
}

function errorRecord(error: unknown): Readonly<{
  name: string
  message: string
  stack?: string
}> {
  const normalized = error instanceof Error ? error : new Error(String(error))
  return Object.freeze({
    name: normalized.name,
    message: normalized.message,
    ...(normalized.stack === undefined ? {} : { stack: normalized.stack })
  })
}

function post(
  message: DocumentCoreWorkerToMainMessage,
  transferList?: readonly TransferListItem[]
): void {
  if (transferList === undefined) {
    port.postMessage(message)
    return
  }
  port.postMessage(message, [...transferList])
}

function storageRequest(
  operation: DocumentCoreWorkerStorageRequest['operation'],
  transferList?: readonly TransferListItem[]
): Promise<unknown> {
  nextStorageRequestId += 1
  const requestId = nextStorageRequestId
  return new Promise((resolve, reject) => {
    pendingStorage.set(requestId, Object.freeze({ resolve, reject }))
    post(Object.freeze({
      kind: 'storage-request',
      requestId,
      operation
    }), transferList)
  })
}

// Below this length a string clones faster than it encodes; above it, the
// clone stalls main's loop (~200ms per maximum-document artifact), so the
// content crosses the port as transfer-listed UTF-8 bytes instead.
const JOURNAL_CONTENT_TRANSFER_THRESHOLD_UNITS = 262_144

const storage: DocumentSessionJournalStorage = Object.freeze({
  async read(key: string) {
    return await storageRequest(Object.freeze({
      kind: 'read',
      key
    })) as Awaited<ReturnType<DocumentSessionJournalStorage['read']>>
  },
  async compareExchange(
    key: string,
    expectedRevision: number | null,
    mutation: DocumentSessionJournalMutation
  ) {
    const transfers: TransferListItem[] = []
    const contents = mutation.contents.map((content) => {
      if (content.data.length < JOURNAL_CONTENT_TRANSFER_THRESHOLD_UNITS) {
        return content
      }
      const bytes = encoder.encode(content.data)
      transfers.push(bytes.buffer as ArrayBuffer)
      return Object.freeze({
        id: content.id,
        dataBytes: bytes,
        dataUnits: content.data.length
      })
    })
    return await storageRequest(Object.freeze({
      kind: 'compare-exchange',
      key,
      expectedRevision,
      mutation: Object.freeze({
        data: mutation.data,
        contents: Object.freeze(contents),
        retainedContentIds: mutation.retainedContentIds
      })
    }), transfers) as Awaited<
      ReturnType<DocumentSessionJournalStorage['compareExchange']>
    >
  }
})

function activeSession(): DocumentSession {
  if (session === undefined) {
    throw new Error('Document session worker has not completed open')
  }
  return session
}

function historyStateOf(documentSession: DocumentSession):
DocumentCoreHistoryState {
  const state = documentSession.historyState()
  return Object.freeze({
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    dirty: state.dirty,
    headIdentity: state.headIdentity,
    savedIdentity: state.savedIdentity
  })
}

function copySelection(selection: ModelSelection | null): ModelSelection | null {
  if (selection === null) return null
  return Object.freeze({
    session: selection.session,
    revision: selection.revision,
    view: selection.view,
    anchor: Object.freeze({ ...selection.anchor }),
    focus: Object.freeze({ ...selection.focus })
  })
}

function outlineOf(
  document: MarkdownDocument,
  sourceOffsetAt: (modelOffset: number) => number
): PortableLiveMember['outline'] {
  const outline: Array<{
    nodeId: NodeId
    level: number
    content: string
    slug: string
    sourceOffset: number
  }> = markdownHeadingAnchors(document).map(heading => Object.freeze({
    nodeId: heading.nodeId,
    level: heading.level,
    content: heading.text,
    slug: heading.slug,
    sourceOffset: sourceOffsetAt(heading.node.range.start)
  }))
  return Object.freeze(outline)
}

function listItemsOf(root: MarkdownNode): readonly ModelRange[] {
  const items: ModelRange[] = []
  const visit = (node: MarkdownNode): void => {
    if (node.kind === 'list-item') {
      items.push(Object.freeze({
        start: node.range.start,
        end: node.range.end
      }))
    }
    for (let ordinal = 0; ordinal < node.childCount; ordinal += 1) {
      visit(node.childAt(ordinal))
    }
  }
  visit(root)
  return Object.freeze(items)
}

function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

function executionReport(
  envelope?: WireEnvelopeV1
): DocumentCoreExecutionReport {
  const operation = activeExecutionOperation
  if (operation === undefined) {
    throw new Error('Publication has no measured execution operation')
  }
  const completedAt = performance.now()
  const memory = process.memoryUsage()
  const physicalWork =
    session?.physicalWork() ?? zeroPhysicalTraversalCountsV1()
  const physicalDelta = (
    name: keyof Profile1PhysicalTraversalCountsV1
  ): number => {
    const delta =
      physicalWork[name] - operation.physicalWorkAtStart[name]
    if (!Number.isSafeInteger(delta) || delta < 0) {
      throw new Error(
        `Physical parser work ${name} moved backwards during an operation`
      )
    }
    return delta
  }
  const serializedMemberBytes: Partial<
    Record<WireMemberNameV1, number>
  > = {}
  let serializedPayloadBytes = 0
  if (envelope !== undefined) {
    for (const member of envelope.members) {
      serializedMemberBytes[member.name] = member.byteLength
      serializedPayloadBytes += member.byteLength
    }
  }
  return Object.freeze({
    schema: 'document-core-execution-report-1',
    executionThreadId: threadId,
    checkpointCount,
    sourceCheckpointCount,
    logicalNodeCheckpointCount,
    sourceCheckpointInterval: PARSE_SOURCE_CHECKPOINT_INTERVAL,
    logicalNodeCheckpointInterval:
      PARSE_LOGICAL_NODE_CHECKPOINT_INTERVAL,
    sourceUnits: executionProgress.sourceUnits,
    logicalNodes: executionProgress.logicalNodes,
    maximumSourceDelta,
    maximumLogicalNodeDelta,
    cancellationObserved:
      Atomics.load(
        executionControlWords,
        DOCUMENT_CORE_CANCEL_OBSERVED_INDEX
      ) !== 0,
    workerHeapUsedBytes: memory.heapUsed,
    workerHeapTotalBytes: memory.heapTotal,
    workerExternalBytes: memory.external,
    workerArrayBuffersBytes: memory.arrayBuffers,
    workerProcessRssBytes: memory.rss,
    serializedPayloadBytes,
    serializedMemberBytes: Object.freeze(serializedMemberBytes),
    operationKind: operation.kind,
    operationCheckpointCount: operation.checkpointCount,
    operationSourceCheckpointCount: operation.sourceCheckpointCount,
    operationLogicalNodeCheckpointCount:
      operation.logicalNodeCheckpointCount,
    operationSourceUnits:
      executionProgress.sourceUnits - operation.sourceUnitsAtStart,
    operationLogicalNodes:
      executionProgress.logicalNodes - operation.logicalNodesAtStart,
    operationMaximumSourceDelta: operation.maximumSourceDelta,
    operationMaximumLogicalNodeDelta: operation.maximumLogicalNodeDelta,
    operationElapsedMs: completedAt - operation.startedAt,
    operationMaximumCheckpointGapMs: operation.maximumCheckpointGapMs,
    operationOwningThreadStallMs: Math.max(
      operation.maximumHeartbeatGapMs,
      completedAt - workerHeartbeatAt
    ),
    operationIntrinsicSourceTraversals: physicalDelta('intrinsicSource'),
    operationIntrinsicSourceUnits: physicalDelta('intrinsicSourceUnits'),
    operationForkAstRegionEmissions:
      physicalDelta('forkAstRegionEmissions'),
    operationForkAstRegionUnits: physicalDelta('forkAstRegionUnits'),
    operationForkAstRegionReuses: physicalDelta('forkAstRegionReuses'),
    operationForkAstRegionProvenanceReuses:
      physicalDelta('forkAstRegionProvenanceReuses')
  })
}

function completeExecution(
  envelope?: WireEnvelopeV1
): DocumentCoreExecutionReport {
  const execution = executionReport(envelope)
  const completedGeneration = activeExecutionOperation?.generation
  if (completedGeneration !== undefined) {
    Atomics.compareExchange(
      executionControlWords,
      DOCUMENT_CORE_ACTIVE_EXECUTION_INDEX,
      completedGeneration,
      0
    )
  }
  activeExecutionOperation = undefined
  return execution
}

function publication(
  baseSnapshotId: string,
  envelope: WireEnvelopeV1
): DocumentCoreWorkerPublication {
  const execution = completeExecution(envelope)
  return Object.freeze({
    baseSnapshotId,
    envelope,
    execution,
    capabilities: activeSession().capabilities()
  })
}

function openCompletion(snapshotId: string): DocumentCoreOpenCompletion {
  return Object.freeze({
    schema: 'document-core-open-completion-1',
    snapshotId,
    execution: completeExecution()
  })
}

function reloadCompletion(
  kind: DocumentCoreReloadCompletion['kind'],
  snapshot: EditorSnapshot,
  historyState: DocumentCoreHistoryState
): DocumentCoreReloadCompletion {
  return Object.freeze({
    schema: 'document-core-reload-completion-1',
    kind,
    snapshotId: snapshot.id,
    revisionId: snapshot.revision.id,
    historyState,
    execution: completeExecution()
  })
}

function portableMembers(
  snapshot: EditorSnapshot,
  historyState: DocumentCoreHistoryState,
  baseRevision?: EditorSnapshot['revision'],
  sourceEdits?: readonly RevisionSourceEdit[],
  needLive = true
): Readonly<{
    session: PortableSessionMember
    live?: PortableLiveMember
    review?: PortableReviewMember
  }> {
  const descriptor = snapshot.revision
  const sessionMember: PortableSessionMember = Object.freeze({
    schema: 'document-core-session-delta-1',
    snapshotId: snapshot.id,
    revisionId: descriptor.id,
    kind: snapshot.kind,
    sourceDelta: traceStallSpan('sourceDeltaBetween', () => sourceDeltaBetween(
      baseRevision,
      descriptor.source,
      descriptor.sourceHash,
      sourceEdits
    )),
    sourceHash: descriptor.sourceHash,
    semanticHash: descriptor.semanticHash,
    parseConfiguration: descriptor.configuration,
    selection: copySelection(descriptor.selection),
    sourceSelection: snapshot.sourceSelection,
    historyState,
    facts: snapshot.facts,
    ...(
      snapshot.kind === 'source-only'
        ? { fatalDiagnostic: snapshot.revision.fatalDiagnostic }
        : {}
    )
  })
  if (snapshot.kind === 'source-only') {
    return Object.freeze({ session: sessionMember })
  }
  // The live editor sink reads its plan through the declared consumer-policy
  // route, so the policy module is load-bearing for live rendering.
  const livePlan = traceStallSpan(
    'routeLiveConsumer',
    () => routeLiveConsumer(snapshot.livePlan).plan
  )
  const review = Object.freeze({
    schema: 'document-core-review-delta-1' as const,
    trackChanges: snapshot.configuration.trackChanges,
    projection: snapshot.projection,
    markupModelLength: livePlan.modelLength,
    reviewIndex: snapshot.reviewIndex
  })
  if (!needLive) {
    // The emission memo proved this projection's plan unchanged since its
    // last full emission; skip materializing runs, model text, and block
    // groups the marker would discard.
    return Object.freeze({ session: sessionMember, review })
  }
  const runs = traceStallSpan(
    'renderMarkupPlan',
    () => renderMarkupPlan(snapshot.displayPlan)
  )
  return Object.freeze({
    session: sessionMember,
    review,
    live: Object.freeze({
      schema: 'document-core-live-plan-delta-1',
      modelText: traceStallSpan(
        'modelTextJoin',
        () => runs.map((run) => run.text).join('')
      ),
      markupCoordinateMap: livePlan.coordinateMap,
      blocks: traceStallSpan(
        'groupRenderBlocks',
        () => groupRenderBlocks(snapshot.displayDocument, runs)
      ),
      outline: outlineOf(
        snapshot.displayDocument,
        modelOffset => livePlan.sourcePositionAt(Object.freeze({
          offset: modelOffset,
          affinity: 'next' as const
        })).offset
      ),
      listItems: listItemsOf(snapshot.displayDocument.root)
    })
  })
}

function sourceDeltaBetween(
  base: EditorSnapshot['revision'] | undefined,
  next: string,
  nextSourceHash: EditorSnapshot['revision']['sourceHash'],
  edits: readonly RevisionSourceEdit[] | undefined
): DocumentCoreSessionSourceDelta {
  if (base === undefined) {
    return Object.freeze({ kind: 'full' as const, text: next })
  }
  const baseIdentity = Object.freeze({
    baseRevisionId: base.id,
    baseSourceHash: base.sourceHash,
    baseSemanticHash: base.semanticHash,
    baseSourceLength: base.source.length
  })
  if (edits === undefined || edits.length === 0) {
    if (
      next.length !== base.source.length ||
      nextSourceHash !== base.sourceHash
    ) {
      throw new Error('A retained source publication changed source identity')
    }
    return Object.freeze({
      kind: 'retain' as const,
      ...baseIdentity
    })
  }
  return Object.freeze({
    kind: 'edit' as const,
    ...baseIdentity,
    edits: Object.freeze([...edits])
  })
}

function terminalOutcome(
  result: Awaited<ReturnType<DocumentSession['dispatch']>['completion']>
): Readonly<Record<string, unknown>> {
  if (result.kind === 'committed') {
    return Object.freeze({
      schema: 'document-core-terminal-outcome-1',
      kind: result.kind,
      transitionId: result.transition.id,
      cause: result.transition.cause,
      history: result.transition.history
    })
  }
  return Object.freeze({
    schema: 'document-core-terminal-outcome-1',
    kind: result.kind,
    ...('reason' in result ? { reason: result.reason } : {})
  })
}

function publishDispatchResult(
  baseSnapshotId: string,
  result: Awaited<ReturnType<DocumentSession['dispatch']>['completion']>
): DocumentCoreWorkerPublication {
  const snapshot = activeSession().snapshot()
  if (snapshot.id === baseSnapshotId) {
    publicationSequence += 1
    return publication(
      baseSnapshotId,
      new WireEnvelopeCodecV1().encode({
        publicationId:
          `session-worker:${threadId}:${publicationSequence}`,
        baseSnapshotId,
        nextSnapshotId: baseSnapshotId,
        transitionId: null,
        members: {
          terminalOutcomeDelta: encodeJson(terminalOutcome(result))
        }
      })
    )
  }
  const transitionId = result.kind === 'committed'
    ? result.transition.id
    : `session-state:${threadId}:${publicationSequence + 1}`
  return publishSnapshot(
    baseSnapshotId,
    snapshot,
    transitionId,
    terminalOutcome(result),
    result.kind === 'committed' || result.kind === 'state-changed'
      ? result.transition.before.revision
      : result.snapshot.revision,
    result.kind === 'committed' ? result.transition.edits : EMPTY_SOURCE_EDITS,
    true
  )
}

const EMPTY_SOURCE_EDITS: readonly RevisionSourceEdit[] = Object.freeze([])

// One emission memo per projection: a dispatch- or select-class
// publication whose live plan is determined by the same source bytes,
// projection, and Markdown options as the last full emission for that
// projection ships the unchanged marker instead of re-encoding every
// block. Attach and open publications always ship the full plan — a
// freshly attached renderer holds nothing to reuse — which also seeds
// the decoders' held plans before any marker can reach them.
const lastLivePlanEmissionByProjection = new Map<string, string>()

function livePlanEmissionKey(
  snapshot: EditorSnapshot,
  projection: string
): string {
  return `${String(snapshot.revision.sourceHash)}\u0000${projection}` +
    `\u0000${JSON.stringify(
      snapshot.revision.configuration.markdownOptions
    )}`
}

function publishSnapshot(
  baseSnapshotId: string,
  snapshot: EditorSnapshot,
  transitionId: string,
  outcome?: Readonly<Record<string, unknown>>,
  baseRevision?: EditorSnapshot['revision'],
  sourceEdits?: readonly RevisionSourceEdit[],
  allowUnchangedLivePlan = false
): DocumentCoreWorkerPublication {
  publicationSequence += 1
  const unchangedLivePlan = allowUnchangedLivePlan &&
    snapshot.kind === 'complete' &&
    lastLivePlanEmissionByProjection.get(snapshot.projection) ===
      livePlanEmissionKey(snapshot, snapshot.projection)
  const portable = traceStallSpan('portableMembers', () => portableMembers(
    snapshot,
    historyStateOf(activeSession()),
    baseRevision,
    sourceEdits,
    !unchangedLivePlan
  ))
  const members = {
    ...(snapshot.kind !== 'complete'
      ? {}
      : {
        livePlanDelta: (() => {
          if (portable.review === undefined) {
            throw new TypeError(
              'Complete live publication has no Review coordinate contract'
            )
          }
          if (unchangedLivePlan) {
            return encodeJson({
              schema: 'document-core-live-plan-unchanged-1'
            })
          }
          if (portable.live === undefined) {
            throw new TypeError(
              'Complete live publication has no live plan'
            )
          }
          const bytes = encodeJson(
            encodeDocumentCoreLiveDeltaV1(
              snapshot.revision.source,
              portable.live,
              Object.freeze({
                projection: portable.review.projection,
                markupModelLength: portable.review.markupModelLength
              })
            )
          )
          lastLivePlanEmissionByProjection.set(
            portable.review.projection,
            livePlanEmissionKey(snapshot, portable.review.projection)
          )
          return bytes
        })()
      }),
    ...(portable.review === undefined
      ? {}
      : { reviewDelta: encodeJson(portable.review) }),
    sessionDelta: encodeJson(portable.session),
    ...(outcome === undefined
      ? {}
      : { terminalOutcomeDelta: encodeJson(outcome) })
  }
  const encoded = traceStallSpan('encodeEnvelope', () =>
    new WireEnvelopeCodecV1().encode({
      publicationId: `session-worker:${threadId}:${publicationSequence}`,
      baseSnapshotId,
      nextSnapshotId: snapshot.id,
      transitionId,
      members
    }))
  return publication(baseSnapshotId, encoded)
}

function assertBase(baseSnapshotId: string): void {
  const snapshotId = activeSession().snapshot().id
  if (snapshotId !== baseSnapshotId) {
    throw new Error(
      `Renderer supplied stale snapshot ${baseSnapshotId}; ` +
      `session head is ${snapshotId}`
    )
  }
}

function pendingTicket(ticketId: string): Readonly<{
  baseSnapshotId: string
  ticket: DispatchTicket
  consuming: boolean
}> {
  if (consumedTickets.has(ticketId)) {
    throw new Error(`Dispatch ticket ${ticketId} was already consumed`)
  }
  const pending = tickets.get(ticketId)
  if (pending === undefined) {
    throw new Error(`Unknown dispatch ticket ${ticketId}`)
  }
  return pending
}

function pendingCutTicket(ticketId: string): Readonly<{
  baseSnapshotId: string
  preparation: CutPreparation
  target: ModelSelection
  consumer: 'cut' | 'cut-table'
}> {
  if (consumedCutTickets.has(ticketId)) {
    throw new Error(`Cut ticket ${ticketId} was already consumed`)
  }
  const pending = cutTickets.get(ticketId)
  if (pending === undefined) {
    throw new Error(`Unknown cut ticket ${ticketId}`)
  }
  return pending
}

function rememberConsumedCutTicket(ticketId: string): void {
  consumedCutTickets.add(ticketId)
  consumedCutTicketOrder.push(ticketId)
  if (consumedCutTicketOrder.length <= MAX_CONSUMED_CUT_TOMBSTONES) return
  const expired = consumedCutTicketOrder.shift()
  if (expired !== undefined) consumedCutTickets.delete(expired)
}

function startDispatch(
  command: Extract<DocumentCoreWorkerCommand, { kind: 'start-dispatch' }>
): Readonly<{ ticketId: string; clientSequence: number }> {
  assertBase(command.baseSnapshotId)
  beginExecutionOperation('dispatch', command.executionGeneration)
  let releasePreparation: (() => void) | undefined
  const beforePrepare = new Promise<void>((resolve) => {
    releasePreparation = resolve
  })
  const ticket = activeSession().dispatch(command.intent, beforePrepare)
  tickets.set(ticket.id, Object.freeze({
    baseSnapshotId: command.baseSnapshotId,
    ticket,
    consuming: false
  }))
  if (releasePreparation === undefined) {
    throw new Error('Dispatch preparation barrier was not created')
  }
  dispatchPreparationReleases.set(ticket.id, releasePreparation)
  return Object.freeze({
    ticketId: ticket.id,
    clientSequence: ticket.clientSequence
  })
}

async function execute(command: DocumentCoreWorkerCommand): Promise<unknown> {
  if (command.kind === 'append-open-chunk') {
    if (session !== undefined) {
      throw new Error('Document session worker is already open')
    }
    if (command.ordinal !== expectedOpenOrdinal) {
      throw new Error(
        `Open chunk ${command.ordinal} does not follow ${expectedOpenOrdinal - 1}`
      )
    }
    expectedOpenOrdinal += 1
    openChunks.push(command.text)
    return Object.freeze({ kind: 'accepted', ordinal: command.ordinal })
  }

  if (command.kind === 'complete-open') {
    if (session !== undefined) {
      throw new Error('Document session worker is already open')
    }
    const source = openChunks.join('')
    openChunks.length = 0
    if (source.length !== command.sourceLength) {
      throw new Error(
        `Open source has ${source.length} UTF-16 units, expected ` +
        `${command.sourceLength}`
      )
    }
    beginExecutionOperation('open', command.executionGeneration)
    session = await createDocumentSession({
      source: createSourceSnapshot(source),
      parseConfiguration:
        decodeDocumentParseConfiguration(command.parseConfiguration),
      identityNamespace: command.documentId,
      configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
      initialView: 'markup',
      trackChanges: false,
      durability: {
        key: command.durabilityKey,
        storage
      },
      executionControl
    })
    return openCompletion(session.snapshot().id)
  }

  if (command.kind === 'recover-open') {
    if (session !== undefined || openChunks.length !== 0) {
      throw new Error('Document session worker cannot recover over staged state')
    }
    beginExecutionOperation('recovery', command.executionGeneration)
    session = await recoverDocumentSession({
      durability: {
        key: command.durabilityKey,
        storage
      },
      executionControl
    })
    const baseSnapshotId = `unmounted:${threadId}:${publicationSequence}`
    return publishSnapshot(
      baseSnapshotId,
      session.snapshot(),
      `session-recovery:${threadId}:${publicationSequence + 1}`
    )
  }

  if (command.kind === 'publish-current') {
    beginExecutionOperation('attach', command.executionGeneration)
    const snapshot = activeSession().snapshot()
    const baseSnapshotId = `unmounted:${threadId}:${publicationSequence}`
    return publishSnapshot(
      baseSnapshotId,
      snapshot,
      `session-attach:${threadId}:${publicationSequence + 1}`
    )
  }

  if (command.kind === 'reload-from-file') {
    beginExecutionOperation('reload', command.executionGeneration)
    const current = activeSession()
    const flush = await current.preparePersistence('save').completion
    if (flush.kind !== 'flushed') {
      throw new Error(`Document session cannot reload: ${flush.reason}`)
    }
    await flush.source.release('consumer-finished').completion
    let snapshot = current.snapshot()
    let historyState = historyStateOf(current)
    if (historyState.dirty && !command.force) {
      return reloadCompletion('conflict', snapshot, historyState)
    }
    let kind: DocumentCoreReloadCompletion['kind'] = 'unchanged'
    if (snapshot.revision.source !== command.source) {
      const ticket = current.dispatch(Object.freeze({
        kind: 'reload-source-from-file',
        source: command.source
      }), undefined, 'host')
      const outcome = await ticket.completion
      if (outcome.kind !== 'committed' && outcome.kind !== 'noop') {
        throw new Error(
          `Document file reload did not commit: ${outcome.kind}`
        )
      }
      snapshot = current.snapshot()
      kind = 'reloaded'
    }
    historyState = historyStateOf(current)
    if (historyState.dirty) {
      await current.markPersisted(historyState.headIdentity)
      historyState = historyStateOf(current)
    }
    return reloadCompletion(kind, snapshot, historyState)
  }

  if (command.kind === 'reconfigure-markdown-options') {
    assertBase(command.baseSnapshotId)
    beginExecutionOperation('reconfigure', command.executionGeneration)
    const baseRevision = activeSession().snapshot().revision
    const result = await activeSession()
      .reconfigureMarkdownOptions(command.patch).completion
    return publishSnapshot(
      command.baseSnapshotId,
      result.snapshot,
      `session-reconfigure:${threadId}:${publicationSequence + 1}`,
      Object.freeze({
        schema: 'document-core-terminal-outcome-1',
        kind: 'state-changed',
        cause: 'markdown-options'
      }),
      baseRevision,
      EMPTY_SOURCE_EDITS
    )
  }

  if (command.kind === 'start-dispatch') {
    throw new Error('Start dispatch must publish its ticket synchronously')
  }

  if (command.kind === 'complete-dispatch') {
    const pending = pendingTicket(command.ticketId)
    if (pending.consuming) {
      throw new Error(
        `Dispatch ticket ${command.ticketId} was already consumed`
      )
    }
    tickets.set(command.ticketId, Object.freeze({
      ...pending,
      consuming: true
    }))
    await pending.ticket.admission
    const result = await pending.ticket.completion
    tickets.delete(command.ticketId)
    consumedTickets.add(command.ticketId)
    return publishDispatchResult(pending.baseSnapshotId, result)
  }

  if (command.kind === 'cancel-dispatch') {
    const pending = pendingTicket(command.ticketId)
    return await activeSession().cancel(
      pending.ticket.id as IntentId
    ).completion
  }

  if (command.kind === 'select') {
    assertBase(command.baseSnapshotId)
    beginExecutionOperation('select', command.executionGeneration)
    const baseRevision = activeSession().snapshot().revision
    if (command.view === 'source') {
      activeSession().selectSource(command.selection)
    } else {
      activeSession().select(command.selection)
    }
    return publishSnapshot(
      command.baseSnapshotId,
      activeSession().snapshot(),
      `selection-state:${threadId}:${publicationSequence + 1}`,
      undefined,
      baseRevision,
      EMPTY_SOURCE_EDITS,
      true
    )
  }

  if (command.kind === 'read-history-state') {
    return historyStateOf(activeSession())
  }

  if (command.kind === 'prepare-persistence') {
    const result = await activeSession()
      .preparePersistence(command.reason).completion
    if (result.kind !== 'flushed') {
      throw new Error(`Document session cannot persist: ${result.reason}`)
    }
    let materialized: Awaited<
      ReturnType<typeof materializePersistenceConsumer>
    >
    try {
      materialized = await materializePersistenceConsumer(
        result.source,
        result.revision.kind === 'source-only' ? 'source' : 'markup'
      )
    } catch (error) {
      await result.source.release('consumer-finished').completion
      throw error
    }
    const leaseId = result.source.id as string
    if (persistenceLeases.has(leaseId)) {
      await result.source.release('consumer-finished').completion
      throw new Error(`Persistence lease ${leaseId} is already retained`)
    }
    persistenceLeases.set(leaseId, Object.freeze({
      source: result.source
    }))
    return Object.freeze({
      leaseId,
      revisionId: result.revision.id,
      sourceHash: result.source.sourceHash,
      source: materialized.text,
      facts: result.facts,
      historyState: historyStateOf(activeSession())
    } satisfies DocumentCorePersistenceLeaseResult)
  }

  if (command.kind === 'await-settled') {
    // The session's one settlement barrier, exposed over the wire so view
    // and renderer consumers await it instead of owning a second notion.
    await activeSession().settled()
    return Object.freeze({ kind: 'settled' as const })
  }

  if (command.kind === 'mark-persisted') {
    const lease = persistenceLeases.get(command.leaseId)
    if (lease === undefined) {
      throw new Error(
        `Persistence lease ${command.leaseId} is not retained`
      )
    }
    // Durability is proven against the held lease — the session resolves the
    // leased revision's identity itself, never from a worker-side capture.
    await activeSession().installed(lease.source)
    return historyStateOf(activeSession())
  }

  if (command.kind === 'release-persistence') {
    const lease = persistenceLeases.get(command.leaseId)
    if (lease === undefined) {
      if (releasedPersistenceLeases.has(command.leaseId)) {
        return Object.freeze({
          kind: 'already-terminal' as const,
          leaseId: command.leaseId
        })
      }
      throw new Error(`Persistence lease ${command.leaseId} is not retained`)
    }
    const released = await lease.source
      .release('consumer-finished').completion
    persistenceLeases.delete(command.leaseId)
    releasedPersistenceLeases.add(command.leaseId)
    releasedPersistenceLeaseOrder.push(command.leaseId)
    while (
      releasedPersistenceLeaseOrder.length >
      MAX_RELEASED_PERSISTENCE_LEASE_TOMBSTONES
    ) {
      const expired = releasedPersistenceLeaseOrder.shift()
      if (expired !== undefined) releasedPersistenceLeases.delete(expired)
    }
    return Object.freeze({
      kind: released.kind,
      leaseId: command.leaseId
    })
  }

  if (command.kind === 'restore-persisted') {
    const current = activeSession()
    // Always checkpoint, even when the in-memory identity already matches.
    // The preceding mark may have lost its acknowledgement after a durable
    // commit, so an in-memory equality check cannot prove the journal agrees.
    await current.markPersisted(command.savedIdentity)
    return historyStateOf(current)
  }

  if (command.kind === 'assert-revision') {
    const revisionId = activeSession().snapshot().revision.id
    if (revisionId !== command.revisionId) {
      throw new Error(
        `Static sink requested stale revision ${command.revisionId}; ` +
        `main owns ${revisionId}`
      )
    }
    return Object.freeze({
      kind: 'revision-authorized',
      revisionId
    })
  }

  if (command.kind === 'materialize-static') {
    const result = await activeSession()
      .materializeStatic(command.request as StaticConsumerRequest<StaticConsumer>)
      .completion
    if (result.kind === 'unavailable') return result
    const html = result.artifact.html
    const portableHtml: PortableStaticHtml = Object.freeze({
      kind: 'isolated-html',
      sink: html.sink,
      view: html.view,
      text: consumeTrustedHtml(html, html.sink)
    })
    return Object.freeze({
      ...result,
      artifact: Object.freeze({
        ...result.artifact,
        html: portableHtml
      })
    })
  }

  if (command.kind === 'materialize-clipboard') {
    const currentRevisionId = activeSession().snapshot().revision.id
    if (currentRevisionId !== command.revisionId) {
      throw new Error(
        `Clipboard requested stale revision ${command.revisionId}; ` +
        `worker owns ${currentRevisionId}`
      )
    }
    const result = await activeSession()
      .materializeClipboard(command.request as ClipboardConsumerRequest)
      .completion
    if (result.kind === 'unavailable') return result
    let cutTicketId: string | undefined
    if (result.artifact.kind === 'cut-preparation') {
      const snapshot = activeSession().snapshot()
      if (
        command.request.consumer !== 'cut' &&
        command.request.consumer !== 'cut-table'
      ) {
        throw new TypeError('Cut preparation has no cut consumer')
      }
      if (snapshot.revision.id !== result.revision.id) {
        throw new Error('Cut preparation revision changed before retention')
      }
      const selection = result.artifact.selection
      const retainedSelection = result.artifact.view === 'source'
        ? snapshot.sourceSelection
        : snapshot.kind === 'complete'
          ? snapshot.revision.selection
          : null
      const retainedStart = retainedSelection === null
        ? -1
        : Math.min(
          retainedSelection.anchor.offset,
          retainedSelection.focus.offset
        )
      const retainedEnd = retainedSelection === null
        ? -1
        : Math.max(
          retainedSelection.anchor.offset,
          retainedSelection.focus.offset
        )
      let target: ModelSelection
      if (
        retainedSelection !== null &&
        retainedStart === selection.start &&
        retainedEnd === selection.end
      ) {
        target = retainedSelection
      } else if (result.artifact.view === 'source') {
        target = Object.freeze({
          session: snapshot.sourceSelection.session,
          revision: snapshot.sourceSelection.revision,
          view: 'source' as const,
          anchor: Object.freeze({
            offset: selection.start,
            affinity: 'next' as const
          }),
          focus: Object.freeze({
            offset: selection.end,
            affinity: selection.end === selection.start
              ? 'next' as const
              : 'previous' as const
          })
        })
      } else {
        if (snapshot.kind !== 'complete') {
          throw new Error('Markup cut preparation requires a complete revision')
        }
        target = snapshot.livePlan.selectionAt(Object.freeze({
          anchor: Object.freeze({
            offset: selection.start,
            affinity: 'next' as const
          }),
          focus: Object.freeze({
            offset: selection.end,
            affinity: selection.end === selection.start
              ? 'next' as const
              : 'previous' as const
          })
        }))
      }
      if (
        result.artifact.view === 'source' &&
        command.request.consumer !== 'cut'
      ) {
        throw new TypeError('Source cut cannot use a table consumer')
      }
      nextCutTicket += 1
      cutTicketId = `cut:${threadId}:${nextCutTicket}`
      cutTickets.set(cutTicketId, Object.freeze({
        baseSnapshotId: snapshot.id,
        preparation: result.artifact,
        target: copySelection(target) as ModelSelection,
        consumer: command.request.consumer
      }))
    }
    const bundle = result.artifact.kind === 'cut-preparation'
      ? result.artifact.bundle
      : result.artifact.kind === 'clipboard-bundle'
        ? result.artifact
        : undefined
    if (bundle?.html === undefined) {
      if (
        result.artifact.kind === 'cut-preparation' &&
        cutTicketId !== undefined
      ) {
        return Object.freeze({
          ...result,
          artifact: Object.freeze({
            ...result.artifact,
            ticketId: cutTicketId
          })
        })
      }
      return result
    }
    const html = bundle.html
    const portableHtml: PortableClipboardHtml = Object.freeze({
      kind: 'isolated-html',
      sink: 'clipboard',
      view: html.view,
      text: consumeTrustedHtml(html, 'clipboard')
    })
    if (result.artifact.kind === 'cut-preparation') {
      if (cutTicketId === undefined) {
        throw new Error('Cut preparation was not retained')
      }
      return Object.freeze({
        ...result,
        artifact: Object.freeze({
          ...result.artifact,
          ticketId: cutTicketId,
          bundle: Object.freeze({
            ...bundle,
            html: portableHtml
          })
        })
      })
    }
    return Object.freeze({
      ...result,
      artifact: Object.freeze({
        ...result.artifact,
        html: portableHtml
      })
    })
  }

  if (command.kind === 'complete-cut') {
    const pending = pendingCutTicket(command.ticketId)
    cutTickets.delete(command.ticketId)
    rememberConsumedCutTicket(command.ticketId)
    if (!command.clipboardWritten) {
      return Object.freeze({ kind: 'cancelled' as const })
    }

    assertBase(pending.baseSnapshotId)
    const receipt = acknowledgeClipboardWrite(pending.preparation.bundle)
    const authorization = authorizeCut(pending.preparation, receipt)
    const snapshot = activeSession().snapshot()
    if (
      snapshot.revision.semanticHash !== authorization.semanticHash ||
      pending.target.revision !== snapshot.revision.id
    ) {
      throw new Error('Cut authorization no longer names the current revision')
    }
    beginExecutionOperation('dispatch', command.executionGeneration)
    const ticket = activeSession().dispatch(Object.freeze(
      pending.preparation.view === 'source'
        ? {
          kind: 'edit-source' as const,
          target: pending.target as Extract<
            ModelSelection,
            { readonly view: 'source' }
          >,
          text: '',
          selection: Object.freeze({
            anchor: Object.freeze({
              offset: authorization.selection.start,
              affinity: 'next' as const
            }),
            focus: Object.freeze({
              offset: authorization.selection.start,
              affinity: 'next' as const
            })
          })
        }
        : pending.consumer === 'cut-table'
          ? {
            kind: 'delete-table-cell-contents' as const,
            target: pending.target
          }
          : {
            kind: 'delete-text' as const,
            target: pending.target
          }
    ))
    await ticket.admission
    const result = await ticket.completion
    if (result.kind !== 'committed') {
      throw new Error(
        `Preflighted cut did not commit: ${result.kind}` +
        ('reason' in result ? ` (${result.reason})` : '')
      )
    }
    return publishDispatchResult(pending.baseSnapshotId, result)
  }

  if (command.kind === 'resolve-document-link') {
    const snapshot = activeSession().snapshot()
    if (snapshot.revision.id !== command.revisionId) {
      throw new Error(
        `Link requested stale revision ${command.revisionId}; ` +
        `main owns ${snapshot.revision.id}`
      )
    }
    if (snapshot.kind !== 'complete') {
      throw new RangeError(
        'SourceOnly revision has no semantic document links'
      )
    }
    const target = resolveMarkdownDocumentLinkTarget(
      snapshot.displayDocument,
      command.targetNodeId as NodeId
    )
    return Object.freeze({
      ...target,
      revisionId: snapshot.revision.id
    })
  }

  await activeSession().close().completion
  session = undefined
  return undefined
}

function publicationTransfers(result: unknown): readonly TransferListItem[] {
  if (
    result === null ||
    typeof result !== 'object' ||
    !('envelope' in result)
  ) {
    return []
  }
  const envelope = result.envelope as WireEnvelopeV1
  const transfers: TransferListItem[] = []
  for (const member of envelope.members) {
    for (const chunk of member.chunks) {
      if (!(chunk.bytes.buffer instanceof ArrayBuffer)) {
        throw new TypeError('Wire publication chunk is not transferable')
      }
      transfers.push(chunk.bytes.buffer)
    }
  }
  return transfers
}

async function handleCommand(
  message: Extract<DocumentCoreMainToWorkerMessage, { kind: 'command' }>
): Promise<void> {
  let response: DocumentCoreWorkerCommandResponse
  let transfers: readonly TransferListItem[] = []
  try {
    const result = await execute(message.command)
    response = Object.freeze({
      kind: 'command-response',
      requestId: message.requestId,
      result
    })
    transfers = publicationTransfers(result)
  } catch (error) {
    const failedGeneration = activeExecutionOperation?.generation
    if (failedGeneration !== undefined) {
      Atomics.compareExchange(
        executionControlWords,
        DOCUMENT_CORE_ACTIVE_EXECUTION_INDEX,
        failedGeneration,
        0
      )
    }
    activeExecutionOperation = undefined
    response = Object.freeze({
      kind: 'command-response',
      requestId: message.requestId,
      error: errorRecord(error)
    })
  }
  port.postMessage(response, transfers)
}

async function handleStartDispatchCommand(
  message: Extract<DocumentCoreMainToWorkerMessage, { kind: 'command' }> & {
    readonly command: Extract<
      DocumentCoreWorkerCommand,
      { kind: 'start-dispatch' }
    >
  }
): Promise<void> {
  let response: DocumentCoreWorkerCommandResponse
  let ticketId: string | undefined
  try {
    const result = startDispatch(message.command)
    ticketId = result.ticketId
    // Let the durable journal enqueue issue its storage request before the
    // admission receipt leaves this worker. The preparation barrier still
    // prevents parsing until after the receipt has been posted.
    await Promise.resolve()
    response = Object.freeze({
      kind: 'command-response',
      requestId: message.requestId,
      result
    })
  } catch (error) {
    const failedGeneration = activeExecutionOperation?.generation
    if (failedGeneration !== undefined) {
      Atomics.compareExchange(
        executionControlWords,
        DOCUMENT_CORE_ACTIVE_EXECUTION_INDEX,
        failedGeneration,
        0
      )
    }
    activeExecutionOperation = undefined
    response = Object.freeze({
      kind: 'command-response',
      requestId: message.requestId,
      error: errorRecord(error)
    })
  }
  port.postMessage(response)
  if (ticketId !== undefined) {
    setImmediate(() => {
      const release = dispatchPreparationReleases.get(ticketId)
      dispatchPreparationReleases.delete(ticketId)
      release?.()
    })
  }
}

function handleStorageResponse(
  message: DocumentCoreWorkerStorageResponse
): void {
  const pending = pendingStorage.get(message.requestId)
  if (pending === undefined) return
  pendingStorage.delete(message.requestId)
  if (message.error === undefined) {
    pending.resolve(message.result)
    return
  }
  const error = new Error(message.error.message)
  error.name = message.error.name
  if (message.error.stack !== undefined) error.stack = message.error.stack
  pending.reject(error)
}

port.on('message', (message: DocumentCoreMainToWorkerMessage) => {
  if (message.kind === 'storage-response') {
    handleStorageResponse(message)
    return
  }
  if (message.command.kind === 'start-dispatch') {
    handleStartDispatchCommand(
      message as Extract<
        DocumentCoreMainToWorkerMessage,
        { kind: 'command' }
      > & {
        command: Extract<
          DocumentCoreWorkerCommand,
          { kind: 'start-dispatch' }
        >
      }
    ).catch((error: unknown) => {
      setImmediate(() => {
        throw error
      })
    })
    return
  }
  if (message.command.kind === 'cancel-dispatch') {
    handleCommand(message).catch((error: unknown) => {
      setImmediate(() => {
        throw error
      })
    })
    return
  }
  commandTail = commandTail.then(
    () => handleCommand(message),
    () => handleCommand(message)
  )
})

post(Object.freeze({
  kind: 'ready',
  executionThreadId: threadId
}))
