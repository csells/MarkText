import {
  closedRecord as decodeClosedRecord
} from '@shared/types/closedRecord'
import {
  sourceHashV1,
  type ClipboardBundle,
  type ClipboardConsumerRequest,
  type ClipboardConsumerResult,
  type CriticMarkupProjection,
  type CutPreparation,
  type DocumentSessionJournalStorage,
  type DocumentFacts,
  type IntentId,
  type MarkupModelSelection,
  type ModelPosition,
  type ModelSelection,
  type NodeId,
  type ParseConfiguration,
  type PersistenceReason,
  type ResourceDiagnostic,
  type ReviewIndex,
  type RevisionSemanticHashV1,
  type SessionCancelResult,
  type SessionStaticMaterializationResult,
  type SourceHashV1,
  type SourceModelSelection,
  type StaticMaterializationRevision,
  type StaticConsumer,
  type StaticConsumerRequest,
  type TrustedHtml,
  type WirePublicationResultV1
} from '@marktext/document-core'
import {
  freezeDocumentCoreHistoryState,
  freezeDocumentCoreParseConfiguration,
  freezeDocumentCoreReviewIndex
} from '../../shared/types/documentCore'
import { decodeDocumentCoreLiveDeltaV1 } from '../../shared/documentCoreLiveWire'
import {
  retainDocumentCoreSourceVerification,
  verifyDocumentCoreSourceDelta,
  type VerifiedDocumentCoreSourceDelta
} from '../../shared/documentCoreSourceDelta'
import type {
  DocumentCoreDispatchTicketReceipt,
  DocumentCoreAppendOpenChunkReceipt,
  DocumentCoreCancelOpenResult,
  DocumentCoreHistoryState,
  DocumentCoreMainDispatchRequest,
  DocumentCoreMainSelectRequest,
  DocumentCoreOpenCompletion,
  DocumentCoreOpenTicketReceipt,
  DocumentCorePersistenceLeaseResult,
  DocumentCorePortableSnapshot,
  DocumentCorePublication,
  DocumentCoreReloadCompletion,
  DocumentCoreReconfigureMarkdownOptionsRequest,
  DocumentCoreStartOpenRequest
} from '../../shared/types/documentCore'
import {
  DOCUMENT_CORE_SOURCE_CHUNK_UNITS
} from './documentSessionWorkerProtocol'
import {
  IsolatedDocumentSession,
  type DocumentSessionWorkerLaunchDescriptor
} from './isolatedDocumentSession'

export type {
  DocumentCoreMainDispatchRequest,
  DocumentCoreMainSelectRequest,
  DocumentCorePersistenceLeaseResult,
  DocumentCorePortableSnapshot,
  DocumentCorePublication,
  DocumentCoreStartOpenRequest,
  PortableCompleteSnapshot,
  PortableSourceOnlySnapshot
} from '../../shared/types/documentCore'

export interface DocumentCoreMainSessionHostDependencies {
  readonly workerLaunch: DocumentSessionWorkerLaunchDescriptor | undefined
}

const productionDependencies: DocumentCoreMainSessionHostDependencies =
  Object.freeze({ workerLaunch: undefined })

const decoder = new TextDecoder('utf-8', { fatal: true })
const hostedHtml = new WeakMap<object, string>()

export interface DocumentCoreMainSessionHost {
  /** Exact live-resource counts for lifecycle assertions and diagnostics. */
  readonly resourceCounts: () => Readonly<{
    sessionCount: number
    workerCount: number
  }>
  /** Main-only durable identity check; never exposed through renderer IPC. */
  readonly hasDurableSession: (durabilityKey: string) => Promise<boolean>
  readonly startOpen: (
    ownerId: string,
    request: DocumentCoreStartOpenRequest
  ) => Promise<DocumentCoreOpenTicketReceipt>
  readonly appendOpenChunk: (
    ownerId: string,
    documentId: string,
    ticketId: string,
    ordinal: number,
    text: string
  ) => Promise<DocumentCoreAppendOpenChunkReceipt>
  readonly completeOpen: (
    ownerId: string,
    documentId: string,
    ticketId: string
  ) => Promise<DocumentCoreOpenCompletion | DocumentCorePublication>
  readonly cancelOpen: (
    ownerId: string,
    documentId: string,
    ticketId: string
  ) => Promise<DocumentCoreCancelOpenResult>
  readonly dispatch: (
    ownerId: string,
    request: DocumentCoreMainDispatchRequest
  ) => Promise<DocumentCorePublication>
  readonly reconfigureMarkdownOptions: (
    ownerId: string,
    request: DocumentCoreReconfigureMarkdownOptionsRequest
  ) => Promise<DocumentCorePublication>
  readonly startDispatch: (
    ownerId: string,
    request: DocumentCoreMainDispatchRequest
  ) => Promise<DocumentCoreDispatchTicketReceipt>
  readonly completeDispatch: (
    ownerId: string,
    documentId: string,
    ticketId: string
  ) => Promise<DocumentCorePublication>
  readonly cancelDispatch: (
    ownerId: string,
    documentId: string,
    ticketId: string
  ) => Promise<SessionCancelResult>
  readonly select: (
    ownerId: string,
    request: DocumentCoreMainSelectRequest
  ) => Promise<DocumentCorePublication>
  readonly reloadFromFile: (
    ownerId: string,
    documentId: string,
    source: string,
    force: boolean
  ) => Promise<DocumentCoreReloadCompletion>
  readonly preparePersistence: (
    ownerId: string,
    documentId: string,
    reason: PersistenceReason
  ) => Promise<DocumentCorePersistenceLeaseResult>
  /** Main-only live history query used for save/close scope decisions. */
  readonly readHistoryState: (
    ownerId: string,
    documentId: string
  ) => Promise<DocumentCoreHistoryState>
  /** Await the session's one settlement barrier for this document. */
  readonly awaitSettled: (
    ownerId: string,
    documentId: string
  ) => Promise<void>
  readonly markPersisted: (
    ownerId: string,
    documentId: string,
    leaseId: string
  ) => Promise<DocumentCoreHistoryState>
  readonly releasePersistence: (
    ownerId: string,
    documentId: string,
    leaseId: string
  ) => Promise<void>
  /**
   * Idempotently restore the saved identity captured by a persistence lease.
   *
   * FileHost uses this only to compensate an ambiguous markPersisted failure;
   * renderer IPC never exposes history identities or this operation.
   */
  readonly restorePersisted: (
    ownerId: string,
    documentId: string,
    savedIdentity: string
  ) => Promise<DocumentCoreHistoryState>
  /**
   * Authenticate a renderer-held immutable revision before any native effect.
   */
  readonly assertRevision: (
    ownerId: string,
    documentId: string,
    revisionId: string
  ) => Promise<void>
  readonly materializeStatic: <Consumer extends StaticConsumer>(
    ownerId: string,
    documentId: string,
    request: StaticConsumerRequest<Consumer>
  ) => Promise<DocumentCoreMainStaticMaterializationResult<Consumer>>
  readonly materializeClipboard: (
    ownerId: string,
    documentId: string,
    revisionId: string,
    request: ClipboardConsumerRequest
  ) => Promise<DocumentCoreMainClipboardMaterializationResult>
  /**
   * Finish or revoke the exact worker-retained cut after the native clipboard
   * effect has a terminal result. A successful completion publishes the one
   * document transaction; a failed write cannot mutate the document.
   */
  readonly completeCut: (
    ownerId: string,
    documentId: string,
    ticketId: string,
    clipboardWritten: boolean
  ) => Promise<DocumentCoreCutCompletion>
  readonly resolveDocumentLink: (
    ownerId: string,
    documentId: string,
    revisionId: string,
    targetNodeId: NodeId
  ) => Promise<DocumentCoreResolvedLinkTarget>
  readonly close: (ownerId: string, documentId: string) => Promise<void>
  /**
   * Terminal main-process teardown. Unlike renderer close, this does not claim
   * a renderer identity and is not exposed through IPC.
   */
  readonly terminate: (documentId: string) => Promise<void>
  readonly detach: (ownerId: string) => void
}

export type DocumentCoreMainStaticMaterializationResult<
  Consumer extends StaticConsumer
> = SessionStaticMaterializationResult<Consumer>

export type DocumentCoreMainClipboardArtifact =
  | Exclude<ClipboardConsumerResult, CutPreparation>
  | Readonly<CutPreparation & {
    readonly ticketId: string
    readonly bundle: ClipboardBundle
  }>

export type DocumentCoreMainClipboardMaterializationResult =
  | Readonly<{
    readonly kind: 'materialized'
    readonly revision: StaticMaterializationRevision
    readonly artifact: DocumentCoreMainClipboardArtifact
  }>
  | Readonly<{
    readonly kind: 'unavailable'
    readonly reason: 'source-only-revision'
  }>

export type DocumentCoreCutCompletion =
  | DocumentCorePublication
  | Readonly<{ readonly kind: 'cancelled' }>

export interface DocumentCoreResolvedLinkTarget {
  readonly kind: 'document-link-target'
  readonly revisionId: string
  readonly targetNodeId: NodeId
  readonly destination: string
}

interface HostedOpenTicket {
  readonly id: string
  readonly sourceLength: number
  readonly requiresSource: boolean
  readonly recoverFromJournal: boolean
  readonly parseConfiguration: ParseConfiguration
  nextOrdinal: number
  receivedUnits: number
  completing: boolean
  executionGeneration: number | null
}

interface HostedSession {
  readonly documentId: string
  readonly durabilityKey: string
  worker: IsolatedDocumentSession
  readonly consumedOpenTickets: Set<string>
  ownerId: string | null
  openTicket: HostedOpenTicket | null
  snapshotId: string | null
  workerFailure: Error | null
  readonly dispatchExecutionGenerations: Map<string, number>
  readonly pendingCutTickets: Set<string>
  readonly persistenceLeases: Map<string, IsolatedDocumentSession>
}

interface PortableSessionMember {
  readonly schema: 'document-core-session-delta-1'
  readonly snapshotId: string
  readonly revisionId: string
  readonly kind: DocumentCorePortableSnapshot['kind']
  readonly source: string
  readonly sourceHash: SourceHashV1
  readonly semanticHash: RevisionSemanticHashV1
  readonly parseConfiguration: ParseConfiguration
  readonly selection: ModelSelection
  readonly sourceSelection: SourceModelSelection
  readonly historyState: DocumentCoreHistoryState
  readonly facts: DocumentFacts
  readonly fatalDiagnostic?: ResourceDiagnostic
  readonly sourceVerification: VerifiedDocumentCoreSourceDelta
}

interface PortableReviewMember {
  readonly schema: 'document-core-review-delta-1'
  readonly trackChanges: boolean
  readonly projection: CriticMarkupProjection
  readonly markupModelLength: number
  readonly reviewIndex: ReviewIndex
}

interface PortableIsolatedHtml {
  readonly kind: 'isolated-html'
  readonly sink: 'static' | 'styled' | 'pdf' | 'print' | 'clipboard'
  readonly view: 'markup' | 'original' | 'revised'
  readonly text: string
}

/**
 * Worker-private publication. Only main may bind it to a renderer-visible
 * document identity.
 */
interface DocumentCoreWorkerPublication {
  readonly baseSnapshotId: string
  readonly envelope: DocumentCorePublication['envelope']
  readonly execution: DocumentCorePublication['execution']
}

function closedRecord(
  value: unknown,
  label: string,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  return decodeClosedRecord(value, label, { required: fields })
}
function decodeJsonRecord(
  bytes: Uint8Array,
  label: string
): Readonly<Record<string, unknown>> {
  const value = JSON.parse(decoder.decode(bytes)) as unknown
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be a JSON record`)
  }
  return value as Readonly<Record<string, unknown>>
}

function boundedString(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1_024
  ) {
    throw new TypeError(`${label} must be a nonempty bounded string`)
  }
  return value
}

function portablePosition(
  value: unknown,
  maximum: number,
  label: string
): ModelPosition {
  const position = closedRecord(value, label, ['offset', 'affinity'])
  if (
    !Number.isSafeInteger(position.offset) ||
    Number(position.offset) < 0 ||
    Number(position.offset) > maximum ||
    (
      position.affinity !== 'previous' &&
      position.affinity !== 'next'
    )
  ) {
    throw new TypeError(`${label} is outside its coordinate space`)
  }
  return Object.freeze({
    offset: Number(position.offset),
    affinity: position.affinity
  })
}

function portableSelection(
  value: unknown,
  view: 'markup',
  maximum: number,
  label: string
): MarkupModelSelection
function portableSelection(
  value: unknown,
  view: 'source',
  maximum: number,
  label: string
): SourceModelSelection
function portableSelection(
  value: unknown,
  view: 'markup' | 'source',
  maximum: number,
  label: string
): ModelSelection {
  const selection = closedRecord(value, label, [
    'session',
    'revision',
    'anchor',
    'focus',
    'view'
  ])
  if (selection.view !== view) {
    throw new TypeError(`${label} names the wrong view`)
  }
  return Object.freeze({
    session: boundedString(selection.session, `${label}.session`),
    revision: boundedString(selection.revision, `${label}.revision`),
    anchor: portablePosition(selection.anchor, maximum, `${label}.anchor`),
    focus: portablePosition(selection.focus, maximum, `${label}.focus`),
    view
  }) as ModelSelection
}

function portableFacts(value: unknown): DocumentFacts {
  const facts = closedRecord(value, 'Session document facts', [
    'kind',
    'recommendedTitle',
    'statistics'
  ])
  const statistics = closedRecord(
    facts.statistics,
    'Session document statistics',
    ['word', 'paragraph', 'character', 'all']
  )
  if (
    facts.kind !== 'document-facts' ||
    (
      facts.recommendedTitle !== null &&
      typeof facts.recommendedTitle !== 'string'
    ) ||
    Object.values(statistics).some(value =>
      !Number.isSafeInteger(value) || Number(value) < 0)
  ) {
    throw new TypeError('Session document facts are invalid')
  }
  return Object.freeze({
    kind: 'document-facts',
    recommendedTitle: facts.recommendedTitle as string | null,
    statistics: Object.freeze({
      word: Number(statistics.word),
      paragraph: Number(statistics.paragraph),
      character: Number(statistics.character),
      all: Number(statistics.all)
    })
  })
}

function portableDiagnostic(
  value: unknown,
  sourceLength: number
): ResourceDiagnostic {
  const diagnostic = closedRecord(value, 'Session fatal diagnostic', [
    'kind',
    'code',
    'range',
    'metadata'
  ])
  const codes = new Set([
    'CM_RESOURCE_SOURCE_UNITS_EXCEEDED',
    'CM_RESOURCE_LOGICAL_NODES_EXCEEDED',
    'CM_RESOURCE_MARKDOWN_DEPTH_EXCEEDED',
    'CM_RESOURCE_CM_DEPTH_EXCEEDED'
  ])
  const range = closedRecord(
    diagnostic.range,
    'Session fatal diagnostic range',
    ['start', 'end']
  )
  if (
    diagnostic.kind !== 'resource' ||
    !codes.has(String(diagnostic.code)) ||
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    Number(range.start) < 0 ||
    Number(range.end) < Number(range.start) ||
    Number(range.end) > sourceLength ||
    diagnostic.metadata === null ||
    typeof diagnostic.metadata !== 'object' ||
    Array.isArray(diagnostic.metadata) ||
    Object.values(diagnostic.metadata).some(value => typeof value !== 'string')
  ) {
    throw new TypeError('Session fatal diagnostic is invalid')
  }
  return Object.freeze({
    kind: 'resource',
    code: diagnostic.code,
    range: Object.freeze({
      start: Number(range.start),
      end: Number(range.end)
    }),
    metadata: Object.freeze({
      ...(diagnostic.metadata as Record<string, string>)
    })
  }) as ResourceDiagnostic
}

function decodePortableSessionMember(
  bytes: Uint8Array,
  base?: DocumentCorePortableSnapshot
): PortableSessionMember {
  const raw = decodeJsonRecord(bytes, 'Session delta')
  if (raw.kind !== 'complete' && raw.kind !== 'source-only') {
    throw new TypeError('Session delta has an invalid kind')
  }
  const kind = raw.kind
  const commonFields = [
    'schema',
    'snapshotId',
    'revisionId',
    'kind',
    'sourceDelta',
    'sourceHash',
    'semanticHash',
    'parseConfiguration',
    'selection',
    'sourceSelection',
    'historyState',
    'facts'
  ] as const
  const session = closedRecord(
    raw,
    'Session delta',
    kind === 'source-only'
      ? [...commonFields, 'fatalDiagnostic']
      : commonFields
  )
  if (
    session.schema !== 'document-core-session-delta-1'
  ) {
    throw new TypeError('Session delta has an invalid shape')
  }
  const parseConfiguration = freezeDocumentCoreParseConfiguration(
    session.parseConfiguration
  )
  const sourceVerification = verifyDocumentCoreSourceDelta(
    session.sourceDelta,
    base,
    session.sourceHash,
    session.semanticHash,
    parseConfiguration
  )
  const { source, sourceHash, semanticHash } = sourceVerification
  const revisionId = boundedString(
    session.revisionId,
    'Session delta.revisionId'
  )
  const sourceSelection = portableSelection(
    session.sourceSelection,
    'source',
    source.length,
    'Session delta.sourceSelection'
  )
  const selection = kind === 'source-only'
    ? portableSelection(
      session.selection,
      'source',
      source.length,
      'Session delta.selection'
    )
    : portableSelection(
      session.selection,
      'markup',
      Number.MAX_SAFE_INTEGER,
      'Session delta.selection'
    )
  if (
    selection.revision !== revisionId ||
    sourceSelection.revision !== revisionId ||
    selection.session !== sourceSelection.session
  ) {
    throw new TypeError('Session delta selections do not name its revision')
  }
  const historyState = freezeDocumentCoreHistoryState(closedRecord(
    session.historyState,
    'Session delta.historyState',
    ['canUndo', 'canRedo', 'dirty', 'headIdentity', 'savedIdentity']
  ))
  return Object.freeze({
    schema: 'document-core-session-delta-1',
    snapshotId: boundedString(
      session.snapshotId,
      'Session delta.snapshotId'
    ),
    revisionId,
    kind,
    source,
    sourceHash,
    semanticHash,
    parseConfiguration,
    selection,
    sourceSelection,
    historyState,
    facts: portableFacts(session.facts),
    sourceVerification,
    ...(kind === 'source-only'
      ? {
        fatalDiagnostic: portableDiagnostic(
          session.fatalDiagnostic,
          source.length
        )
      }
      : {})
  })
}

function closedReviewIndex(value: unknown): unknown {
  const index = closedRecord(value, 'Review index', [
    'authoring',
    'items',
    'commentedSpans'
  ])
  closedRecord(index.authoring, 'Review index authoring', [
    'canCreateAddition',
    'canCreateDeletion',
    'canCreateSubstitution',
    'canCreateHighlight',
    'canCreateComment'
  ])
  if (!Array.isArray(index.items) || !Array.isArray(index.commentedSpans)) {
    throw new TypeError('Review index collections are invalid')
  }
  index.items.forEach((item, index) => {
    const record = closedRecord(item, `Review item ${index}`, [
      'nodeId',
      'kind',
      'sourceRange',
      'modelRange',
      'focusOffset',
      'depth',
      'parent',
      'withinCommentPayload',
      'payloadRange',
      'commentRevisedText',
      'oldContent',
      'newContent'
    ])
    closedRecord(record.sourceRange, `Review item ${index} source range`, [
      'start',
      'end'
    ])
    if (record.modelRange !== null) {
      closedRecord(record.modelRange, `Review item ${index} model range`, [
        'start',
        'end'
      ])
    }
  })
  index.commentedSpans.forEach((span, index) => {
    const record = closedRecord(span, `Commented span ${index}`, [
      'highlight',
      'comment',
      'sourceRange',
      'modelRange'
    ])
    closedRecord(record.sourceRange, `Commented span ${index} source range`, [
      'start',
      'end'
    ])
    closedRecord(record.modelRange, `Commented span ${index} model range`, [
      'start',
      'end'
    ])
  })
  return value
}

function decodePortableReviewMember(
  bytes: Uint8Array,
  sourceLength: number
): PortableReviewMember {
  const review = closedRecord(
    decodeJsonRecord(bytes, 'Review delta'),
    'Review delta',
    [
      'schema',
      'trackChanges',
      'projection',
      'markupModelLength',
      'reviewIndex'
    ]
  )
  if (
    review.schema !== 'document-core-review-delta-1' ||
    typeof review.trackChanges !== 'boolean' ||
    !Number.isSafeInteger(review.markupModelLength) ||
    Number(review.markupModelLength) < 0 ||
    Number(review.markupModelLength) > sourceLength ||
    (
      review.projection !== 'marked' &&
      review.projection !== 'original' &&
      review.projection !== 'revised'
    )
  ) {
    throw new TypeError('Review delta has an invalid shape')
  }
  return Object.freeze({
    schema: 'document-core-review-delta-1',
    trackChanges: review.trackChanges,
    projection: review.projection,
    markupModelLength: Number(review.markupModelLength),
    reviewIndex: freezeDocumentCoreReviewIndex(
      closedReviewIndex(review.reviewIndex),
      sourceLength,
      Number(review.markupModelLength)
    )
  })
}

function assertIdentifier(name: string, value: string): void {
  if (value.length === 0 || value.length > 1_024) {
    throw new TypeError(`${name} must be a nonempty bounded string`)
  }
}

function assertSourceLength(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('sourceLength must be a nonnegative safe integer')
  }
}

function assertOwner(hosted: HostedSession, ownerId: string): void {
  if (hosted.ownerId !== ownerId) {
    throw new Error(
      `${hosted.documentId} is owned by ` +
      `${hosted.ownerId ?? 'no renderer'}, not ${ownerId}`
    )
  }
}

function assertBase(hosted: HostedSession, baseSnapshotId: string): void {
  if (hosted.snapshotId !== baseSnapshotId) {
    throw new Error(
      `Renderer supplied stale snapshot ${baseSnapshotId}; ` +
      `main head is ${hosted.snapshotId ?? 'not-open'}`
    )
  }
}

function openTicketFor(
  hosted: HostedSession,
  ticketId: string
): HostedOpenTicket {
  if (hosted.consumedOpenTickets.has(ticketId)) {
    throw new Error(`Open ticket ${ticketId} was already consumed`)
  }
  const ticket = hosted.openTicket
  if (ticket === null || ticket.id !== ticketId) {
    throw new Error(`Unknown open ticket ${ticketId}`)
  }
  return ticket
}

function publicationSnapshotId(
  publication: DocumentCoreWorkerPublication | DocumentCorePublication
): string {
  if (
    publication.envelope.baseSnapshotId !== publication.baseSnapshotId ||
    publication.envelope.nextSnapshotId.length === 0
  ) {
    throw new TypeError('Worker returned an invalid publication identity')
  }
  return publication.envelope.nextSnapshotId
}

function bindDocumentPublication(
  documentId: string,
  publication: DocumentCoreWorkerPublication
): DocumentCorePublication {
  return Object.freeze({
    documentId,
    baseSnapshotId: publication.baseSnapshotId,
    envelope: publication.envelope,
    execution: publication.execution
  })
}

function completionSnapshotId(
  completion: DocumentCoreOpenCompletion
): string {
  if (
    completion.schema !== 'document-core-open-completion-1' ||
    completion.snapshotId.length === 0 ||
    completion.execution.operationKind !== 'open' ||
    completion.execution.serializedPayloadBytes !== 0
  ) {
    throw new TypeError('Worker returned an invalid open completion')
  }
  return completion.snapshotId
}

function closedWorkerRecord(
  value: unknown,
  fields: readonly string[],
  label: string
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Worker returned invalid ${label}`)
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== fields.length ||
    keys.some(key => typeof key !== 'string' || !fields.includes(key))
  ) {
    throw new TypeError(`Worker returned non-closed ${label}`)
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new TypeError(`Worker returned invalid ${label} field`)
    }
  }
  return value as Readonly<Record<string, unknown>>
}

function adoptPersistenceLease(
  value: unknown
): DocumentCorePersistenceLeaseResult {
  const record = closedWorkerRecord(value, [
    'leaseId',
    'revisionId',
    'sourceHash',
    'source',
    'facts',
    'historyState'
  ], 'persistence lease')
  if (
    typeof record.leaseId !== 'string' ||
    typeof record.revisionId !== 'string' ||
    typeof record.sourceHash !== 'string' ||
    typeof record.source !== 'string'
  ) {
    throw new TypeError('Worker returned invalid persistence lease identity')
  }
  assertIdentifier('persistence lease id', record.leaseId)
  assertIdentifier('persistence revision id', record.revisionId)
  if (sourceHashV1(record.source) !== record.sourceHash) {
    throw new TypeError('Worker persistence lease source hash is invalid')
  }
  const facts = closedWorkerRecord(record.facts, [
    'kind',
    'recommendedTitle',
    'statistics'
  ], 'document facts')
  const statistics = closedWorkerRecord(facts.statistics, [
    'word',
    'paragraph',
    'character',
    'all'
  ], 'document statistics')
  if (
    facts.kind !== 'document-facts' ||
    (
      facts.recommendedTitle !== null &&
      typeof facts.recommendedTitle !== 'string'
    ) ||
    !Number.isSafeInteger(statistics.word) ||
    Number(statistics.word) < 0 ||
    !Number.isSafeInteger(statistics.paragraph) ||
    Number(statistics.paragraph) < 0 ||
    !Number.isSafeInteger(statistics.character) ||
    Number(statistics.character) < 0 ||
    !Number.isSafeInteger(statistics.all) ||
    Number(statistics.all) < 0
  ) {
    throw new TypeError('Worker returned invalid document facts')
  }
  const stableFacts: DocumentFacts = Object.freeze({
    kind: 'document-facts',
    recommendedTitle: facts.recommendedTitle as string | null,
    statistics: Object.freeze({
      word: Number(statistics.word),
      paragraph: Number(statistics.paragraph),
      character: Number(statistics.character),
      all: Number(statistics.all)
    })
  })
  return Object.freeze({
    leaseId: record.leaseId,
    revisionId: record.revisionId,
    sourceHash: record.sourceHash,
    source: record.source,
    facts: stableFacts,
    historyState: freezeDocumentCoreHistoryState(record.historyState)
  }) as DocumentCorePersistenceLeaseResult
}

function adoptIsolatedHtml(value: unknown): TrustedHtml<
'static' | 'styled' | 'pdf' | 'print' | 'clipboard'
> {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('kind' in value) ||
    value.kind !== 'isolated-html' ||
    !('sink' in value) ||
    (
      value.sink !== 'static' &&
      value.sink !== 'styled' &&
      value.sink !== 'pdf' &&
      value.sink !== 'print' &&
      value.sink !== 'clipboard'
    ) ||
    !('view' in value) ||
    (
      value.view !== 'markup' &&
      value.view !== 'original' &&
      value.view !== 'revised'
    ) ||
    !('text' in value) ||
    typeof value.text !== 'string'
  ) {
    throw new TypeError('Worker returned invalid isolated HTML')
  }
  const transfer = value as PortableIsolatedHtml
  const capability = Object.freeze({
    kind: 'trusted-html' as const,
    sink: transfer.sink,
    view: transfer.view
  }) as TrustedHtml<
    'static' | 'styled' | 'pdf' | 'print' | 'clipboard'
  >
  hostedHtml.set(capability, transfer.text)
  return capability
}

/**
 * Consume HTML authenticated by the owning isolated session worker.
 *
 * The worker transfers inert text only to this proxy. The proxy immediately
 * re-homes it in a main-process WeakMap capability so renderer IPC still
 * cannot forge or reuse a sink value.
 */
export function consumeDocumentCoreHostHtml<
  Sink extends 'static' | 'styled' | 'pdf' | 'print' | 'clipboard'
>(
  capability: TrustedHtml<Sink>,
  sink: Sink
): string {
  const text = hostedHtml.get(capability)
  if (text === undefined) {
    throw new TypeError('Document-core host HTML capability is not authentic')
  }
  if (capability.sink !== sink) {
    throw new TypeError(
      'Document-core host HTML sink mismatch: ' +
      `${capability.sink} cannot enter ${sink}`
    )
  }
  return text
}

function adoptMaterialization<Result>(result: Result): Result {
  if (
    result === null ||
    typeof result !== 'object' ||
    !('kind' in result) ||
    result.kind !== 'materialized' ||
    !('artifact' in result) ||
    result.artifact === null ||
    typeof result.artifact !== 'object'
  ) {
    return result
  }
  if (
    'kind' in result.artifact &&
    result.artifact.kind === 'cut-preparation' &&
    'bundle' in result.artifact &&
    result.artifact.bundle !== null &&
    typeof result.artifact.bundle === 'object' &&
    'html' in result.artifact.bundle
  ) {
    return Object.freeze({
      ...result,
      artifact: Object.freeze({
        ...result.artifact,
        bundle: Object.freeze({
          ...result.artifact.bundle,
          html: adoptIsolatedHtml(result.artifact.bundle.html)
        })
      })
    }) as Result
  }
  if (!('html' in result.artifact)) return result
  return Object.freeze({
    ...result,
    artifact: Object.freeze({
      ...result.artifact,
      html: adoptIsolatedHtml(result.artifact.html)
    })
  }) as Result
}

/**
 * Decode a publication only after `WireEnvelopeCodecV1.publish` has verified
 * ordering and every checksum.
 */
export function decodeDocumentCorePublication(
  publication: WirePublicationResultV1,
  base?: DocumentCorePortableSnapshot
): DocumentCorePortableSnapshot {
  if (publication.kind !== 'published') {
    throw new Error(
      `Document-core publication needs a full snapshot: ${publication.reason}`
    )
  }
  const sessionBytes = publication.members.sessionDelta
  if (sessionBytes === undefined) {
    throw new TypeError('Document-core publication has no session delta')
  }
  const session = decodePortableSessionMember(sessionBytes, base)
  const historyState = session.historyState
  const parseConfiguration = session.parseConfiguration
  if (session.snapshotId !== publication.mountedSnapshotId) {
    throw new TypeError('Session delta does not name the mounted snapshot')
  }
  if (session.kind === 'source-only') {
    if (session.fatalDiagnostic === undefined) {
      throw new TypeError('SourceOnly publication has no fatal diagnostic')
    }
    if (session.selection.view !== 'source') {
      throw new TypeError('SourceOnly publication has no Source selection')
    }
    const snapshot: DocumentCorePortableSnapshot = Object.freeze({
      schema: 'document-core-portable-snapshot-1',
      snapshotId: session.snapshotId,
      revisionId: session.revisionId,
      kind: 'source-only',
      source: session.source,
      sourceHash: session.sourceHash,
      semanticHash: session.semanticHash,
      parseConfiguration,
      historyState,
      facts: session.facts,
      sourceSelection: session.sourceSelection,
      selection: session.selection,
      modelText: session.source,
      blocks: Object.freeze([]) as readonly [],
      fatalDiagnostic: session.fatalDiagnostic
    })
    retainDocumentCoreSourceVerification(snapshot, session.sourceVerification)
    return snapshot
  }
  if (session.selection.view !== 'markup') {
    throw new TypeError('Complete publication has no Markup selection')
  }
  const reviewBytes = publication.members.reviewDelta
  if (reviewBytes === undefined) {
    throw new TypeError('Complete publication has no Review delta')
  }
  const review = decodePortableReviewMember(
    reviewBytes,
    session.source.length
  )
  const liveBytes = publication.members.livePlanDelta
  if (liveBytes === undefined) {
    throw new TypeError('Complete publication has no live-plan delta')
  }
  const live = decodeDocumentCoreLiveDeltaV1(
    session.source,
    decodeJsonRecord(liveBytes, 'Live delta'),
    Object.freeze({
      projection: review.projection,
      markupModelLength: review.markupModelLength
    })
  )
  for (const [label, position] of [
    ['anchor', session.selection.anchor],
    ['focus', session.selection.focus]
  ] as const) {
    if (
      position.offset < 0 ||
      position.offset > review.markupModelLength
    ) {
      throw new TypeError(`Markup selection ${label} is outside its model`)
    }
  }
  const reviewIndex = review.reviewIndex
  const snapshot: DocumentCorePortableSnapshot = Object.freeze({
    schema: 'document-core-portable-snapshot-1',
    snapshotId: session.snapshotId,
    revisionId: session.revisionId,
    kind: 'complete',
    projection: review.projection,
    markupModelLength: review.markupModelLength,
    source: session.source,
    sourceHash: session.sourceHash,
    semanticHash: session.semanticHash,
    parseConfiguration,
    historyState,
    facts: session.facts,
    sourceSelection: session.sourceSelection,
    selection: session.selection,
    trackChanges: review.trackChanges,
    reviewIndex,
    modelText: live.modelText,
    markupCoordinateMap: live.markupCoordinateMap,
    blocks: Object.freeze(live.blocks),
    outline: Object.freeze(live.outline),
    listItems: Object.freeze(live.listItems)
  })
  retainDocumentCoreSourceVerification(snapshot, session.sourceVerification)
  return snapshot
}

export function createDocumentCoreMainSessionHost(
  storage: DocumentSessionJournalStorage,
  observeExecution?: (execution: IsolatedDocumentSession) => void,
  dependencies: DocumentCoreMainSessionHostDependencies = productionDependencies
): DocumentCoreMainSessionHost {
  const sessions = new Map<string, HostedSession>()
  let nextOpenTicket = 0

  const workerFor = (documentId: string): IsolatedDocumentSession => {
    const worker = new IsolatedDocumentSession(
      storage,
      (error) => {
        const hosted = sessions.get(documentId)
        if (hosted?.worker === worker) hosted.workerFailure = error
      },
      dependencies.workerLaunch
    )
    observeExecution?.(worker)
    return worker
  }

  const hostedFor = (documentId: string): HostedSession => {
    const hosted = sessions.get(documentId)
    if (hosted === undefined) {
      throw new Error(`No main-owned document session ${documentId}`)
    }
    return hosted
  }

  const startOpen = async(
    ownerId: string,
    request: DocumentCoreStartOpenRequest
  ): Promise<DocumentCoreOpenTicketReceipt> => {
    assertIdentifier('ownerId', ownerId)
    assertIdentifier('documentId', request.documentId)
    assertIdentifier('durabilityKey', request.durabilityKey)
    assertSourceLength(request.sourceLength)

    let hosted = sessions.get(request.documentId)
    let recoverFromJournal = false
    if (hosted === undefined) {
      recoverFromJournal =
        (await storage.read(request.durabilityKey)) !== null
      hosted = {
        documentId: request.documentId,
        durabilityKey: request.durabilityKey,
        worker: workerFor(request.documentId),
        consumedOpenTickets: new Set(),
        ownerId,
        openTicket: null,
        snapshotId: null,
        workerFailure: null,
        dispatchExecutionGenerations: new Map(),
        pendingCutTickets: new Set(),
        persistenceLeases: new Map()
      }
      sessions.set(request.documentId, hosted)
    } else {
      if (hosted.durabilityKey !== request.durabilityKey) {
        throw new Error(
          `${request.documentId} is already bound to a different durable journal`
        )
      }
      if (hosted.ownerId !== null && hosted.ownerId !== ownerId) {
        assertOwner(hosted, ownerId)
      }
      if (hosted.openTicket !== null && !hosted.worker.isAlive) {
        hosted.consumedOpenTickets.add(hosted.openTicket.id)
        hosted.openTicket = null
      }
      if (hosted.openTicket !== null) {
        throw new Error(`${request.documentId} already has an open ticket`)
      }
      if (!hosted.worker.isAlive) {
        await hosted.worker.waitForStorageIdle()
        recoverFromJournal =
          (await storage.read(hosted.durabilityKey)) !== null
        hosted.worker = workerFor(request.documentId)
        hosted.workerFailure = null
      }
      hosted.ownerId = ownerId
    }

    nextOpenTicket += 1
    const ticketId =
      `open:${request.documentId}:${nextOpenTicket}`
    const requiresSource =
      hosted.snapshotId === null && !recoverFromJournal
    hosted.openTicket = {
      id: ticketId,
      sourceLength: request.sourceLength,
      requiresSource,
      recoverFromJournal,
      parseConfiguration: request.parseConfiguration,
      nextOrdinal: 0,
      receivedUnits: 0,
      completing: false,
      executionGeneration: null
    }
    return Object.freeze({
      schema: 'document-core-open-ticket-1',
      documentId: request.documentId,
      ticketId,
      chunkUnits: DOCUMENT_CORE_SOURCE_CHUNK_UNITS,
      executionThreadId: hosted.worker.executionThreadId,
      requiresSource
    })
  }

  const appendOpenChunk = async(
    ownerId: string,
    documentId: string,
    ticketId: string,
    ordinal: number,
    text: string
  ): Promise<DocumentCoreAppendOpenChunkReceipt> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    const ticket = openTicketFor(hosted, ticketId)
    if (!ticket.requiresSource) {
      throw new Error(`Open ticket ${ticketId} does not accept source`)
    }
    if (ticket.completing) {
      throw new Error(`Open ticket ${ticketId} is already completing`)
    }
    if (ordinal !== ticket.nextOrdinal) {
      throw new Error(
        `Open chunk ${ordinal} does not follow ${ticket.nextOrdinal - 1}`
      )
    }
    if (
      text.length > DOCUMENT_CORE_SOURCE_CHUNK_UNITS ||
      ticket.receivedUnits + text.length > ticket.sourceLength
    ) {
      throw new RangeError('Open chunk exceeds its declared source envelope')
    }
    const stagedAt = performance.now()
    const completion = hosted.worker.command(Object.freeze({
      kind: 'append-open-chunk',
      ordinal,
      text
    }))
    const mainStageMs = performance.now() - stagedAt
    await completion
    ticket.nextOrdinal += 1
    ticket.receivedUnits += text.length
    return Object.freeze({
      schema: 'document-core-open-chunk-receipt-1',
      ordinal,
      mainStageMs
    })
  }

  const completeOpen = async(
    ownerId: string,
    documentId: string,
    ticketId: string
  ): Promise<DocumentCoreOpenCompletion | DocumentCorePublication> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    const ticket = openTicketFor(hosted, ticketId)
    if (ticket.completing) {
      throw new Error(`Open ticket ${ticketId} is already completing`)
    }
    if (
      ticket.requiresSource &&
      ticket.receivedUnits !== ticket.sourceLength
    ) {
      throw new Error(
        `Open source has ${ticket.receivedUnits} UTF-16 units, expected ` +
        `${ticket.sourceLength}`
      )
    }
    ticket.completing = true
    const executionGeneration = hosted.worker.nextExecutionGeneration()
    ticket.executionGeneration = executionGeneration
    const command = ticket.recoverFromJournal
      ? Object.freeze({
        kind: 'recover-open' as const,
        durabilityKey: hosted.durabilityKey,
        executionGeneration
      })
      : ticket.requiresSource
        ? Object.freeze({
          kind: 'complete-open',
          documentId,
          durabilityKey: hosted.durabilityKey,
          sourceLength: ticket.sourceLength,
          parseConfiguration: ticket.parseConfiguration,
          executionGeneration
        })
        : Object.freeze({
          kind: 'publish-current' as const,
          executionGeneration
        })
    const result = await hosted.worker.command<
      DocumentCoreOpenCompletion | DocumentCoreWorkerPublication
    >(command)
    hosted.snapshotId = ticket.requiresSource
      ? completionSnapshotId(result as DocumentCoreOpenCompletion)
      : publicationSnapshotId(result as DocumentCoreWorkerPublication)
    hosted.workerFailure = null
    hosted.openTicket = null
    hosted.consumedOpenTickets.add(ticketId)
    return ticket.requiresSource
      ? result as DocumentCoreOpenCompletion
      : bindDocumentPublication(
        documentId,
        result as DocumentCoreWorkerPublication
      )
  }

  const cancelOpen = async(
    ownerId: string,
    documentId: string,
    ticketId: string
  ): Promise<DocumentCoreCancelOpenResult> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    if (hosted.consumedOpenTickets.has(ticketId)) {
      return Object.freeze({ kind: 'already-terminal', ticketId })
    }
    const ticket = openTicketFor(hosted, ticketId)
    hosted.openTicket = null
    hosted.consumedOpenTickets.add(ticketId)
    const checkpointObserved =
      ticket.completing && ticket.executionGeneration !== null
        ? await hosted.worker.requestExecutionCancellation(
          ticket.executionGeneration,
          50
        )
        : false
    if (ticket.requiresSource || ticket.recoverFromJournal) {
      sessions.delete(documentId)
      await hosted.worker.terminate()
    }
    return Object.freeze({
      kind: 'cancelled',
      ticketId,
      checkpointObserved
    })
  }

  const startDispatch = async(
    ownerId: string,
    request: DocumentCoreMainDispatchRequest
  ): Promise<DocumentCoreDispatchTicketReceipt> => {
    const hosted = hostedFor(request.documentId)
    assertOwner(hosted, ownerId)
    assertBase(hosted, request.baseSnapshotId)
    const executionGeneration = hosted.worker.nextExecutionGeneration()
    const result = await hosted.worker.command<{
      ticketId: string
      clientSequence: number
    }>(Object.freeze({
      kind: 'start-dispatch',
      baseSnapshotId: request.baseSnapshotId,
      intent: request.intent,
      executionGeneration
    }))
    hosted.dispatchExecutionGenerations.set(
      result.ticketId,
      executionGeneration
    )
    return Object.freeze({
      schema: 'document-core-dispatch-ticket-1',
      documentId: request.documentId,
      baseSnapshotId: request.baseSnapshotId,
      ticketId: result.ticketId,
      clientSequence: result.clientSequence
    })
  }

  const reconfigureMarkdownOptions = async(
    ownerId: string,
    request: DocumentCoreReconfigureMarkdownOptionsRequest
  ): Promise<DocumentCorePublication> => {
    const hosted = hostedFor(request.documentId)
    assertOwner(hosted, ownerId)
    assertBase(hosted, request.baseSnapshotId)
    const executionGeneration = hosted.worker.nextExecutionGeneration()
    const publication =
      await hosted.worker.command<DocumentCoreWorkerPublication>(
        Object.freeze({
          kind: 'reconfigure-markdown-options',
          baseSnapshotId: request.baseSnapshotId,
          patch: Object.freeze({ ...request.patch }),
          executionGeneration
        })
      )
    hosted.snapshotId = publicationSnapshotId(publication)
    return bindDocumentPublication(request.documentId, publication)
  }

  const completeDispatch = async(
    ownerId: string,
    documentId: string,
    ticketId: string
  ): Promise<DocumentCorePublication> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    const publication =
      await hosted.worker.command<DocumentCoreWorkerPublication>(
        Object.freeze({ kind: 'complete-dispatch', ticketId })
      )
    hosted.dispatchExecutionGenerations.delete(ticketId)
    hosted.snapshotId = publicationSnapshotId(publication)
    return bindDocumentPublication(documentId, publication)
  }

  const cancelDispatch = async(
    ownerId: string,
    documentId: string,
    ticketId: string
  ): Promise<SessionCancelResult> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    const executionGeneration =
      hosted.dispatchExecutionGenerations.get(ticketId)
    if (executionGeneration === undefined) {
      return await hosted.worker.command<SessionCancelResult>(
        Object.freeze({ kind: 'cancel-dispatch', ticketId })
      )
    }
    const checkpointObservation =
      hosted.worker.requestExecutionCancellation(executionGeneration, 50)
    const cancellation = hosted.worker.command<SessionCancelResult>(
      Object.freeze({ kind: 'cancel-dispatch', ticketId })
    )
    const checkpointObserved = await checkpointObservation
    if (checkpointObserved) {
      cancellation.then(
        () => hosted.dispatchExecutionGenerations.delete(ticketId),
        () => hosted.dispatchExecutionGenerations.delete(ticketId)
      )
      return Object.freeze({
        kind: 'cancelled',
        ticket: ticketId as IntentId
      })
    }
    const result = await cancellation
    hosted.dispatchExecutionGenerations.delete(ticketId)
    return result
  }

  const dispatch = async(
    ownerId: string,
    request: DocumentCoreMainDispatchRequest
  ): Promise<DocumentCorePublication> => {
    const receipt = await startDispatch(ownerId, request)
    return await completeDispatch(
      ownerId,
      request.documentId,
      receipt.ticketId
    )
  }

  const select = async(
    ownerId: string,
    request: DocumentCoreMainSelectRequest
  ): Promise<DocumentCorePublication> => {
    const hosted = hostedFor(request.documentId)
    assertOwner(hosted, ownerId)
    assertBase(hosted, request.baseSnapshotId)
    const executionGeneration = hosted.worker.nextExecutionGeneration()
    const publication =
      await hosted.worker.command<DocumentCoreWorkerPublication>(
        Object.freeze({
          kind: 'select',
          baseSnapshotId: request.baseSnapshotId,
          view: request.view,
          selection: request.selection,
          executionGeneration
        })
      )
    hosted.snapshotId = publicationSnapshotId(publication)
    return bindDocumentPublication(request.documentId, publication)
  }

  const reloadFromFile = async(
    ownerId: string,
    documentId: string,
    source: string,
    force: boolean
  ): Promise<DocumentCoreReloadCompletion> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    if (typeof source !== 'string' || typeof force !== 'boolean') {
      throw new TypeError('Invalid main-owned file reload request')
    }
    const executionGeneration = hosted.worker.nextExecutionGeneration()
    const result = await hosted.worker.command<DocumentCoreReloadCompletion>(
      Object.freeze({
        kind: 'reload-from-file',
        source,
        force,
        executionGeneration
      })
    )
    if (
      result.schema !== 'document-core-reload-completion-1' ||
      (
        result.kind !== 'reloaded' &&
        result.kind !== 'unchanged' &&
        result.kind !== 'conflict'
      ) ||
      result.snapshotId.length === 0 ||
      result.revisionId.length === 0
    ) {
      throw new TypeError('Worker returned an invalid file reload result')
    }
    hosted.snapshotId = result.snapshotId
    return Object.freeze({
      ...result,
      historyState: freezeDocumentCoreHistoryState(result.historyState)
    })
  }

  const preparePersistence = async(
    ownerId: string,
    documentId: string,
    reason: PersistenceReason
  ): Promise<DocumentCorePersistenceLeaseResult> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    const worker = hosted.worker
    const lease = adoptPersistenceLease(
      await worker.command<unknown>(
        Object.freeze({ kind: 'prepare-persistence', reason })
      )
    )
    if (hosted.persistenceLeases.has(lease.leaseId)) {
      await worker.command(Object.freeze({
        kind: 'release-persistence',
        leaseId: lease.leaseId
      }))
      throw new Error(
        `Worker reused persistence lease ${lease.leaseId}`
      )
    }
    hosted.persistenceLeases.set(lease.leaseId, worker)
    return lease
  }

  const readHistoryState = async(
    ownerId: string,
    documentId: string
  ): Promise<DocumentCoreHistoryState> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    return freezeDocumentCoreHistoryState(
      await hosted.worker.command(
        Object.freeze({ kind: 'read-history-state' })
      )
    )
  }

  const awaitSettled = async(
    ownerId: string,
    documentId: string
  ): Promise<void> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    await hosted.worker.command(Object.freeze({ kind: 'await-settled' }))
  }

  const markPersisted = async(
    ownerId: string,
    documentId: string,
    leaseId: string
  ): Promise<DocumentCoreHistoryState> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    assertIdentifier('persistence lease id', leaseId)
    const worker = hosted.persistenceLeases.get(leaseId)
    if (worker === undefined) {
      throw new Error(`Unknown persistence lease ${leaseId}`)
    }
    return freezeDocumentCoreHistoryState(
      await worker.command(
        Object.freeze({ kind: 'mark-persisted', leaseId })
      )
    )
  }

  const releasePersistence = async(
    ownerId: string,
    documentId: string,
    leaseId: string
  ): Promise<void> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    assertIdentifier('persistence lease id', leaseId)
    const worker = hosted.persistenceLeases.get(leaseId)
    if (worker === undefined) {
      throw new Error(`Unknown persistence lease ${leaseId}`)
    }
    if (worker.isAlive) {
      const result = await worker.command<unknown>(Object.freeze({
        kind: 'release-persistence',
        leaseId
      }))
      if (
        result === null ||
        typeof result !== 'object' ||
        Reflect.ownKeys(result).length !== 2 ||
        !('kind' in result) ||
        (
          result.kind !== 'released' &&
          result.kind !== 'already-terminal'
        ) ||
        !('leaseId' in result) ||
        result.leaseId !== leaseId
      ) {
        throw new TypeError(
          'Worker returned an invalid persistence release receipt'
        )
      }
    }
    hosted.persistenceLeases.delete(leaseId)
  }

  const restorePersisted = async(
    ownerId: string,
    documentId: string,
    savedIdentity: string
  ): Promise<DocumentCoreHistoryState> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    const recoverWorker = async(): Promise<void> => {
      const failedWorker = hosted.worker
      if (failedWorker.isAlive) return
      await failedWorker.waitForStorageIdle()
      const recoveredWorker = workerFor(documentId)
      hosted.worker = recoveredWorker
      hosted.workerFailure = null
      try {
        const executionGeneration =
          recoveredWorker.nextExecutionGeneration()
        const publication =
          await recoveredWorker.command<DocumentCoreWorkerPublication>(
            Object.freeze({
              kind: 'recover-open',
              durabilityKey: hosted.durabilityKey,
              executionGeneration
            })
          )
        hosted.snapshotId = publicationSnapshotId(publication)
      } catch (error) {
        await recoveredWorker.terminate().catch(() => {})
        throw error
      }
    }
    const restore = async(): Promise<DocumentCoreHistoryState> =>
      freezeDocumentCoreHistoryState(
        await hosted.worker.command(
          Object.freeze({ kind: 'restore-persisted', savedIdentity })
        )
      )
    await recoverWorker()
    try {
      return await restore()
    } catch (error) {
      // A mark acknowledgement can be lost because its worker exits after
      // committing. Recover that durable journal and force-checkpoint the
      // prior identity before reporting the save failure.
      await new Promise<void>(resolve => setImmediate(resolve))
      if (hosted.worker.isAlive) throw error
      await recoverWorker()
      return await restore()
    }
  }

  const materializeStatic = async<Consumer extends StaticConsumer>(
    ownerId: string,
    documentId: string,
    request: StaticConsumerRequest<Consumer>
  ): Promise<DocumentCoreMainStaticMaterializationResult<Consumer>> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    const result = await hosted.worker.command<
      DocumentCoreMainStaticMaterializationResult<Consumer>
    >(Object.freeze({
      kind: 'materialize-static',
      request: request as StaticConsumerRequest<StaticConsumer>
    }))
    return adoptMaterialization(result)
  }

  const assertRevision = async(
    ownerId: string,
    documentId: string,
    revisionId: string
  ): Promise<void> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    assertIdentifier('revisionId', revisionId)
    const result = await hosted.worker.command<unknown>(Object.freeze({
      kind: 'assert-revision',
      revisionId
    }))
    if (
      result === null ||
      typeof result !== 'object' ||
      Reflect.ownKeys(result).length !== 2 ||
      !('kind' in result) ||
      result.kind !== 'revision-authorized' ||
      !('revisionId' in result) ||
      result.revisionId !== revisionId
    ) {
      throw new TypeError('Worker returned an invalid revision authorization')
    }
  }

  const materializeClipboard = async(
    ownerId: string,
    documentId: string,
    revisionId: string,
    request: ClipboardConsumerRequest
  ): Promise<DocumentCoreMainClipboardMaterializationResult> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    assertIdentifier('revisionId', revisionId)
    const result =
      await hosted.worker.command<DocumentCoreMainClipboardMaterializationResult>(
        Object.freeze({
          kind: 'materialize-clipboard',
          revisionId,
          request
        })
      )
    let adopted: DocumentCoreMainClipboardMaterializationResult
    try {
      adopted = adoptMaterialization(result)
    } catch (error) {
      if (
        result.kind === 'materialized' &&
        result.artifact.kind === 'cut-preparation'
      ) {
        await hosted.worker.command<
          DocumentCoreWorkerPublication | Readonly<{ readonly kind: 'cancelled' }>
        >(Object.freeze({
          kind: 'complete-cut',
          ticketId: result.artifact.ticketId,
          clipboardWritten: false,
          executionGeneration: hosted.worker.nextExecutionGeneration()
        }))
      }
      throw error
    }
    if (
      adopted.kind === 'materialized' &&
      adopted.artifact.kind === 'cut-preparation'
    ) {
      hosted.pendingCutTickets.add(adopted.artifact.ticketId)
    }
    return adopted
  }

  const completeCut = async(
    ownerId: string,
    documentId: string,
    ticketId: string,
    clipboardWritten: boolean
  ): Promise<DocumentCoreCutCompletion> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    assertIdentifier('ticketId', ticketId)
    if (!hosted.pendingCutTickets.has(ticketId)) {
      throw new Error(`Unknown or already consumed cut ticket ${ticketId}`)
    }
    const executionGeneration = hosted.worker.nextExecutionGeneration()
    try {
      const result = await hosted.worker.command<
        DocumentCoreWorkerPublication | Readonly<{ readonly kind: 'cancelled' }>
      >(
        Object.freeze({
          kind: 'complete-cut',
          ticketId,
          clipboardWritten,
          executionGeneration
        })
      )
      if ('envelope' in result) {
        hosted.snapshotId = publicationSnapshotId(result)
        return bindDocumentPublication(documentId, result)
      }
      return result
    } finally {
      hosted.pendingCutTickets.delete(ticketId)
    }
  }

  const resolveDocumentLink = async(
    ownerId: string,
    documentId: string,
    revisionId: string,
    targetNodeId: NodeId
  ): Promise<DocumentCoreResolvedLinkTarget> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    assertIdentifier('revisionId', revisionId)
    assertIdentifier('targetNodeId', targetNodeId)
    const result = await hosted.worker.command<unknown>(Object.freeze({
      kind: 'resolve-document-link',
      revisionId,
      targetNodeId
    }))
    if (
      result === null ||
      typeof result !== 'object' ||
      Reflect.ownKeys(result).length !== 4 ||
      !('kind' in result) ||
      result.kind !== 'document-link-target' ||
      !('revisionId' in result) ||
      result.revisionId !== revisionId ||
      !('targetNodeId' in result) ||
      result.targetNodeId !== targetNodeId ||
      !('destination' in result) ||
      typeof result.destination !== 'string'
    ) {
      throw new TypeError(
        'Worker returned an invalid document link target'
      )
    }
    return Object.freeze({
      kind: 'document-link-target',
      revisionId,
      targetNodeId,
      destination: result.destination
    })
  }

  const close = async(
    ownerId: string,
    documentId: string
  ): Promise<void> => {
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    await hosted.worker.close()
    hosted.persistenceLeases.clear()
    sessions.delete(documentId)
  }

  const terminate = async(documentId: string): Promise<void> => {
    assertIdentifier('documentId', documentId)
    const hosted = sessions.get(documentId)
    if (hosted === undefined) {
      return
    }
    sessions.delete(documentId)
    await hosted.worker.close()
    hosted.persistenceLeases.clear()
  }

  const detach = (ownerId: string): void => {
    for (const hosted of sessions.values()) {
      if (hosted.ownerId !== ownerId) continue
      hosted.ownerId = null
      for (const ticketId of hosted.pendingCutTickets) {
        const executionGeneration = hosted.worker.nextExecutionGeneration()
        hosted.worker.command<
          DocumentCoreWorkerPublication | Readonly<{ readonly kind: 'cancelled' }>
        >(
          Object.freeze({
            kind: 'complete-cut',
            ticketId,
            clipboardWritten: false,
            executionGeneration
          })
        ).catch(() => {
          // A concurrently completing cut may consume the same ticket first.
          // Either terminal path releases the worker-retained bundle.
        })
      }
      hosted.pendingCutTickets.clear()
    }
  }

  const resourceCounts = (): Readonly<{
    sessionCount: number
    workerCount: number
  }> => Object.freeze({
    sessionCount: sessions.size,
    workerCount: [...sessions.values()]
      .filter(hosted => hosted.worker.isAlive)
      .length
  })

  const hasDurableSession = async(
    durabilityKey: string
  ): Promise<boolean> => {
    assertIdentifier('durabilityKey', durabilityKey)
    return (await storage.read(durabilityKey)) !== null
  }

  return Object.freeze({
    resourceCounts,
    hasDurableSession,
    startOpen,
    appendOpenChunk,
    completeOpen,
    cancelOpen,
    dispatch,
    reconfigureMarkdownOptions,
    startDispatch,
    completeDispatch,
    cancelDispatch,
    select,
    reloadFromFile,
    readHistoryState,
    preparePersistence,
    awaitSettled,
    markPersisted,
    releasePersistence,
    restorePersisted,
    assertRevision,
    materializeStatic,
    materializeClipboard,
    completeCut,
    resolveDocumentLink,
    close,
    terminate,
    detach
  })
}
