import type {
  DocumentCoreImageSourceRequest,
  DocumentCoreImageSourceResolution,
  DocumentCoreViewDispatchResult,
  DocumentCoreViewSnapshot,
  IDocumentCoreViewSession
} from '@marktext/document-view'
import {
  modelPositionAtMarkupCoordinateMap,
  WIRE_MEMBER_ORDER_V1,
  WireEnvelopeCodecV1,
  type ClipboardConsumerRequest,
  type CriticMarkupProjection,
  type DocumentCoreMarkdownOptionPatch,
  type DocumentFacts,
  type EditorIntent,
  type InitialModelSelection,
  type MarkupModelSelection,
  type ModelSelection,
  type ModelPosition,
  type ParseConfiguration,
  type RejectionCode,
  type ResourceDiagnostic,
  type ResourceDiagnosticCode,
  type RevisionId,
  type ReviewIndex,
  type RevisionSemanticHashV1,
  type SessionId,
  type SourceOffset,
  type SourceHashV1,
  type SourceModelSelection,
  type WireMemberNameV1,
  type WirePublicationResultV1
} from '@marktext/document-core'
import {
  freezeDocumentCoreHistoryState,
  freezeDocumentCoreParseConfiguration,
  freezeDocumentCoreReviewIndex,
  type DocumentCoreHistoryState
} from '@shared/types/documentCore'
import {
  closedRecord as decodeClosedRecord
} from '@shared/types/closedRecord'
import {
  decodeDocumentCoreLiveDeltaV1
} from '@shared/documentCoreLiveWire'
import {
  retainDocumentCoreSourceVerification,
  verifyDocumentCoreSourceDelta,
  type VerifiedDocumentCoreSourceDelta
} from '@shared/documentCoreSourceDelta'
import type {
  DocumentCoreCancelDispatchRequest,
  DocumentCoreCompleteDispatchRequest,
  DocumentCoreDispatchTicketReceipt,
  DocumentCoreExecutionOperationKind,
  DocumentCoreExecutionReport,
  DocumentCoreMainDispatchRequest,
  DocumentCoreMainSelectRequest,
  DocumentCorePortableSnapshot,
  PortableCompleteSnapshot,
  PortableSourceOnlySnapshot,
  DocumentCoreReconfigureMarkdownOptionsRequest
} from '@shared/types/documentCore'
import {
  IMAGE_ASSET_MEDIA_TYPES,
  MAX_IMAGE_ASSET_BYTES,
  type ImageAssetActivationReceipt,
  type ImageAssetMaterializationReceipt,
  type ImageAssetSource,
  type ImageAssetStorage
} from '@shared/types/imageAsset'
import {
  pasteDocumentClipboard
} from '@/services/documentClipboardPaste'

type DocumentCoreInvokeChannel =
  | 'mt::document-core::attach'
  | 'mt::document-core::dispatch-start'
  | 'mt::document-core::dispatch-complete'
  | 'mt::document-core::dispatch-cancel'
  | 'mt::document-core::reconfigure-markdown-options'
  | 'mt::document-core::select'
  | 'mt::document-core::await-settled'
  | 'mt::document-core::write-clipboard'
  | 'mt::document::paste-clipboard'
  | 'mt::image-assets::activate-document'
  | 'mt::image-assets::resolve-display'
  | 'mt::image-assets::insert'

export interface DocumentCoreRemoteSessionOptions {
  readonly documentId: () => string
  readonly onHistoryState: (
    documentId: string,
    state: DocumentCoreHistoryState
  ) => void
  readonly onExecutionReport?: (
    documentId: string,
    report: DocumentCoreExecutionReport
  ) => void
  readonly invoke: (
    channel: DocumentCoreInvokeChannel,
    request: unknown
  ) => Promise<unknown>
}

export interface DocumentCoreRemoteSession extends IDocumentCoreViewSession {
  /**
   * Materialize and write one parser-owned clipboard payload. Cut receipts
   * carry the publication committed by main; this method verifies and mounts
   * it before the view is allowed to render the transaction as complete.
   */
  readonly writeClipboardMaterialization: (
    request: ClipboardConsumerRequest & Readonly<{ revisionId: string }>
  ) => Promise<Readonly<{
    readonly kind: 'written' | 'cut-committed'
  }>>
  /** Paste OS clipboard material without returning it to renderer memory. */
  readonly pasteClipboard: (
    target: ModelSelection
  ) => Promise<DocumentCoreViewDispatchResult>
  /**
   * Register source bytes/capability in renderer memory until the view builds
   * the exact parser-owned insertion target. The returned src is never sent as
   * document content; dispatch substitutes one closed main transaction.
   */
  readonly registerImageAsset: (
    documentId: string,
    source: ImageAssetSource,
    storage: ImageAssetStorage
  ) => Readonly<{
    src: string
    cancel: () => void
  }>
  readonly resolveImageSource: (
    request: DocumentCoreImageSourceRequest
  ) => Promise<DocumentCoreImageSourceResolution>
  /**
   * Declare a requested tab immediately, before queued editor work settles.
   * Main uses this generation to cancel an in-flight insertion for the old tab.
   */
  readonly activateDocument: (documentId: string) => Promise<void>
  /**
   * Mount a different main-owned document by opaque identity.
   */
  readonly attachDocument: (documentId: string) => Promise<void>
  /**
   * Release one renderer attachment without terminating the main-owned file.
   *
   * Only the main lifecycle coordinator may close a FileHost/session. This
   * local release cancels renderer work and drops cached attachment state.
   */
  readonly closeDocument: (documentId: string) => Promise<void>
}

interface SessionDeltaBase {
  readonly schema: 'document-core-session-delta-1'
  readonly snapshotId: string
  readonly revisionId: string
  readonly source: string
  readonly sourceHash: SourceHashV1
  readonly semanticHash: RevisionSemanticHashV1
  readonly parseConfiguration: ParseConfiguration
  readonly sourceSelection: SourceModelSelection
  readonly historyState: DocumentCoreHistoryState
  readonly facts: DocumentFacts
  readonly sourceVerification: VerifiedDocumentCoreSourceDelta
}

const sourceEditsByPortableSnapshot = new WeakMap<
  DocumentCorePortableSnapshot,
  VerifiedDocumentCoreSourceDelta['sourceEdits']
>()

type SessionDelta =
  | Readonly<SessionDeltaBase & {
    readonly kind: 'complete'
    readonly selection: MarkupModelSelection
  }>
  | Readonly<SessionDeltaBase & {
    readonly kind: 'source-only'
    readonly selection: SourceModelSelection
    readonly fatalDiagnostic: ResourceDiagnostic
  }>

interface ReviewDelta {
  readonly schema: 'document-core-review-delta-1'
  readonly trackChanges: boolean
  readonly projection: CriticMarkupProjection
  readonly markupModelLength: number
  readonly reviewIndex: ReviewIndex
}

const decoder = new TextDecoder('utf-8', { fatal: true })

/**
 * Every record on this wire surface declares all of its fields as required, so
 * the shape is stated once here rather than at each of its call sites. The
 * decoding itself belongs to the one shared decoder.
 */
function closedRecord(
  value: unknown,
  label: string,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  return decodeClosedRecord(value, label, { required: fields })
}

function dataField(
  value: unknown,
  field: string,
  label: string
): unknown {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be a record`)
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  const descriptor = Object.getOwnPropertyDescriptor(value, field)
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    descriptor === undefined ||
    !descriptor.enumerable ||
    !('value' in descriptor)
  ) {
    throw new TypeError(`${label}.${field} must be an enumerable data field`)
  }
  return descriptor.value
}

function decodeJsonRecord(
  bytes: Uint8Array,
  label: string
): Readonly<Record<string, unknown>> {
  const value = JSON.parse(decoder.decode(bytes)) as unknown
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
  ) {
    throw new TypeError(`${label} must be a JSON record`)
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some(key => typeof key !== 'string')) {
    throw new TypeError(`${label} must be a JSON record`)
  }
  return Object.freeze(Object.fromEntries(keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new TypeError(`${label}.${String(key)} must be a data field`)
    }
    return [key, descriptor.value]
  })))
}

function nonemptyString(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1_024
  ) {
    throw new TypeError(`${label} must be a nonempty bounded string`)
  }
  return value
}

function decodeSessionId(value: unknown, label: string): SessionId {
  return nonemptyString(value, label) as SessionId
}

function decodeRevisionId(value: unknown, label: string): RevisionId {
  return nonemptyString(value, label) as RevisionId
}

function decodeModelPosition(
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

function decodeModelSelection(
  value: unknown,
  expectedView: 'markup',
  maximum: number,
  label: string
): MarkupModelSelection
function decodeModelSelection(
  value: unknown,
  expectedView: 'source',
  maximum: number,
  label: string
): SourceModelSelection
function decodeModelSelection(
  value: unknown,
  expectedView: 'markup' | 'source',
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
  if (selection.view !== expectedView) {
    throw new TypeError(`${label} names the wrong view`)
  }
  const session = decodeSessionId(selection.session, `${label}.session`)
  const revision = decodeRevisionId(selection.revision, `${label}.revision`)
  const anchor = decodeModelPosition(
    selection.anchor,
    maximum,
    `${label}.anchor`
  )
  const focus = decodeModelPosition(
    selection.focus,
    maximum,
    `${label}.focus`
  )
  if (expectedView === 'markup') {
    return Object.freeze({
      session,
      revision,
      anchor,
      focus,
      view: 'markup'
    })
  }
  return Object.freeze({
    session,
    revision,
    anchor,
    focus,
    view: 'source'
  })
}

function decodeResourceDiagnosticCode(
  value: unknown
): ResourceDiagnosticCode {
  switch (value) {
    case 'CM_RESOURCE_SOURCE_UNITS_EXCEEDED':
    case 'CM_RESOURCE_LOGICAL_NODES_EXCEEDED':
    case 'CM_RESOURCE_MARKDOWN_DEPTH_EXCEEDED':
    case 'CM_RESOURCE_CM_DEPTH_EXCEEDED':
      return value
    default:
      throw new TypeError('Session fatal diagnostic has an invalid code')
  }
}

function decodeStringRecord(
  value: unknown,
  label: string
): Readonly<Record<string, string>> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be a string record`)
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a string record`)
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some(key => typeof key !== 'string')) {
    throw new TypeError(`${label} must be a string record`)
  }
  const entries: Array<readonly [string, string]> = []
  for (const key of keys) {
    if (typeof key !== 'string') {
      throw new TypeError(`${label} must be a string record`)
    }
    const item = dataField(value, key, label)
    if (typeof item !== 'string') {
      throw new TypeError(`${label} must be a string record`)
    }
    entries.push([key, item])
  }
  return Object.freeze(Object.fromEntries(entries))
}

function decodeResourceDiagnostic(
  value: unknown,
  sourceLength: number
): ResourceDiagnostic {
  const diagnostic = closedRecord(value, 'Session fatal diagnostic', [
    'kind',
    'code',
    'range',
    'metadata'
  ])
  if (diagnostic.kind !== 'resource') {
    throw new TypeError('Session fatal diagnostic has an invalid kind')
  }
  const code = decodeResourceDiagnosticCode(diagnostic.code)
  const range = closedRecord(
    diagnostic.range,
    'Session fatal diagnostic range',
    ['start', 'end']
  )
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    Number(range.start) < 0 ||
    Number(range.end) < Number(range.start) ||
    Number(range.end) > sourceLength
  ) {
    throw new TypeError('Session fatal diagnostic range is invalid')
  }
  return Object.freeze({
    kind: 'resource',
    code,
    range: Object.freeze({
      start: Number(range.start) as SourceOffset,
      end: Number(range.end) as SourceOffset
    }),
    metadata: decodeStringRecord(
      diagnostic.metadata,
      'Session fatal diagnostic metadata'
    )
  })
}

function decodeDocumentFacts(value: unknown): DocumentFacts {
  const record = closedRecord(value, 'Document facts', [
    'kind',
    'recommendedTitle',
    'statistics'
  ])
  if (
    record.kind !== 'document-facts' ||
    (
      record.recommendedTitle !== null &&
      typeof record.recommendedTitle !== 'string'
    )
  ) {
    throw new TypeError('Main returned invalid document facts')
  }
  const counts = closedRecord(
    record.statistics,
    'Document statistics',
    ['word', 'paragraph', 'character', 'all']
  )
  const keys = ['word', 'paragraph', 'character', 'all'] as const
  if (
    keys.some(key => (
      !Number.isSafeInteger(counts[key]) ||
      Number(counts[key]) < 0
    ))
  ) {
    throw new TypeError('Main returned invalid document statistics')
  }
  return Object.freeze({
    kind: 'document-facts',
    recommendedTitle: record.recommendedTitle,
    statistics: Object.freeze({
      word: Number(counts.word),
      paragraph: Number(counts.paragraph),
      character: Number(counts.character),
      all: Number(counts.all)
    })
  })
}

/*
 * Every object above this line is rebuilt from validated values. Do not return
 * an IPC/JSON object by assertion: the renderer's read model must never retain
 * a caller-controlled prototype or unvalidated member.
 */

function decodeSessionDelta(
  bytes: Uint8Array,
  base?: DocumentCorePortableSnapshot
): SessionDelta {
  const raw = decodeJsonRecord(bytes, 'Session delta')
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
  if (raw.kind !== 'complete' && raw.kind !== 'source-only') {
    throw new TypeError('Session delta has an invalid kind')
  }
  const kind = raw.kind
  const session = closedRecord(
    raw,
    'Session delta',
    kind === 'source-only'
      ? [...commonFields, 'fatalDiagnostic']
      : commonFields
  )
  if (
    session.schema !== 'document-core-session-delta-1' ||
    typeof session.sourceHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(session.sourceHash) ||
    typeof session.semanticHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(session.semanticHash)
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
  const revisionId = nonemptyString(
    session.revisionId,
    'Session delta.revisionId'
  )
  const sourceSelection = decodeModelSelection(
    session.sourceSelection,
    'source',
    source.length,
    'Session delta.sourceSelection'
  )
  const rawHistory = closedRecord(
    session.historyState,
    'Session delta.historyState',
    ['canUndo', 'canRedo', 'dirty', 'headIdentity', 'savedIdentity']
  )
  const common: SessionDeltaBase = Object.freeze({
    schema: 'document-core-session-delta-1',
    snapshotId: nonemptyString(
      session.snapshotId,
      'Session delta.snapshotId'
    ),
    revisionId,
    source,
    sourceHash,
    semanticHash,
    parseConfiguration,
    sourceSelection,
    historyState: freezeDocumentCoreHistoryState(rawHistory),
    facts: decodeDocumentFacts(session.facts),
    sourceVerification
  })
  if (kind === 'source-only') {
    const selection = decodeModelSelection(
      session.selection,
      'source',
      source.length,
      'Session delta.selection'
    )
    if (
      selection.revision !== revisionId ||
      sourceSelection.revision !== revisionId ||
      selection.session !== sourceSelection.session
    ) {
      throw new TypeError('Session delta selections do not name its revision')
    }
    return Object.freeze({
      ...common,
      kind: 'source-only',
      selection,
      fatalDiagnostic: decodeResourceDiagnostic(
        session.fatalDiagnostic,
        source.length
      )
    })
  }
  const selection = decodeModelSelection(
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
  return Object.freeze({
    ...common,
    kind: 'complete',
    selection
  })
}

function assertClosedReviewIndex(value: unknown): unknown {
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

function decodeReviewDelta(
  bytes: Uint8Array,
  sourceLength: number
): ReviewDelta {
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
      assertClosedReviewIndex(review.reviewIndex),
      sourceLength,
      Number(review.markupModelLength)
    )
  })
}

function assertPosition(
  position: ModelPosition,
  maximum: number,
  coordinate: string
): void {
  if (
    !Number.isInteger(position.offset) ||
    position.offset < 0 ||
    position.offset > maximum
  ) {
    throw new RangeError(`${coordinate} position is outside the document`)
  }
  if (
    position.affinity !== 'previous' &&
    position.affinity !== 'next'
  ) {
    throw new TypeError(`${coordinate} position has an invalid affinity`)
  }
}

function modelPositionAt(
  snapshot: DocumentCorePortableSnapshot,
  position: ModelPosition
): ModelPosition {
  assertPosition(position, snapshot.source.length, 'Source')
  if (snapshot.kind === 'source-only') {
    return Object.freeze({ ...position })
  }
  return modelPositionAtMarkupCoordinateMap(
    snapshot.markupCoordinateMap,
    position
  )
}

function decodeSnapshot(
  publication: Extract<WirePublicationResultV1, { kind: 'published' }>,
  base?: DocumentCorePortableSnapshot
): DocumentCorePortableSnapshot | undefined {
  const sessionBytes = publication.members.sessionDelta
  if (sessionBytes === undefined) return undefined
  const session = decodeSessionDelta(sessionBytes, base)
  if (session.snapshotId !== publication.mountedSnapshotId) {
    throw new TypeError('Session delta does not name the mounted snapshot')
  }
  const historyState = session.historyState
  const parseConfiguration = session.parseConfiguration
  const facts = session.facts
  if (session.kind === 'source-only') {
    const noBlocks: readonly [] = Object.freeze([])
    const snapshot: PortableSourceOnlySnapshot = Object.freeze({
      schema: 'document-core-portable-snapshot-1',
      snapshotId: session.snapshotId,
      revisionId: session.revisionId,
      kind: 'source-only',
      source: session.source,
      sourceHash: session.sourceHash,
      semanticHash: session.semanticHash,
      parseConfiguration,
      historyState,
      facts,
      sourceSelection: session.sourceSelection,
      selection: session.selection,
      modelText: session.source,
      blocks: noBlocks,
      fatalDiagnostic: session.fatalDiagnostic
    })
    retainDocumentCoreSourceVerification(snapshot, session.sourceVerification)
    sourceEditsByPortableSnapshot.set(
      snapshot,
      session.sourceVerification.sourceEdits
    )
    return snapshot
  }
  const reviewBytes = publication.members.reviewDelta
  if (reviewBytes === undefined) {
    throw new TypeError('Complete publication has no Review delta')
  }
  const review = decodeReviewDelta(
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
  if (
    !Array.isArray(live.blocks) ||
    !Array.isArray(live.outline) ||
    !Array.isArray(live.listItems)
  ) {
    throw new TypeError('Complete live-plan delta has an invalid shape')
  }
  assertPosition(
    session.selection.anchor,
    review.markupModelLength,
    'Markup selection anchor'
  )
  assertPosition(
    session.selection.focus,
    review.markupModelLength,
    'Markup selection focus'
  )
  const reviewIndex = review.reviewIndex
  const snapshot: PortableCompleteSnapshot = Object.freeze({
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
    facts,
    sourceSelection: session.sourceSelection,
    selection: session.selection,
    trackChanges: review.trackChanges,
    reviewIndex,
    modelText: live.modelText,
    markupCoordinateMap: live.markupCoordinateMap,
    blocks: live.blocks,
    outline: live.outline,
    listItems: live.listItems
  })
  retainDocumentCoreSourceVerification(snapshot, session.sourceVerification)
  sourceEditsByPortableSnapshot.set(
    snapshot,
    session.sourceVerification.sourceEdits
  )
  return snapshot
}

function toViewSnapshot(
  snapshot: DocumentCorePortableSnapshot
): DocumentCoreViewSnapshot {
  if (snapshot.kind === 'source-only') {
    return Object.freeze({
      kind: 'source-only' as const,
      revisionId: snapshot.revisionId,
      parseConfiguration: snapshot.parseConfiguration,
      source: snapshot.source,
      facts: snapshot.facts,
      sourceSelection: snapshot.sourceSelection,
      selection: snapshot.selection
    })
  }
  return Object.freeze({
    kind: 'complete' as const,
    revisionId: snapshot.revisionId,
    parseConfiguration: snapshot.parseConfiguration,
    source: snapshot.source,
    facts: snapshot.facts,
    sourceSelection: snapshot.sourceSelection,
    projection: snapshot.projection,
    modelText: snapshot.modelText,
    markupModelLength: snapshot.markupModelLength,
    selection: snapshot.selection,
    trackChanges: snapshot.trackChanges,
    reviewIndex: snapshot.reviewIndex,
    blocks: snapshot.blocks,
    outline: snapshot.outline,
    listItems: snapshot.listItems
  })
}

const rejectionCodeMembers: Readonly<Record<RejectionCode, true>> =
  Object.freeze({
    'stale-selection': true,
    'selection-not-collapsed': true,
    'selection-collapsed': true,
    'nothing-to-undo': true,
    'nothing-to-redo': true,
    'no-source-change': true,
    'invalid-command-argument': true,
    'read-only-change-arm': true,
    'read-only-projection': true,
    'source-only-revision': true,
    'precommit-failed': true,
    'target-not-found': true,
    'wrong-target-kind': true,
    'invalid-source-range': true,
    'empty-comment': true,
    'invalid-comment-payload': true,
    'selection-crosses-syntax-boundary': true,
    'selection-includes-hidden-comment': true,
    'selection-partially-intersects-critic-markup': true,
    'selection-inside-markdown-literal': true,
    'selection-partially-intersects-markdown-literal': true,
    'markdown-literal-source-only': true,
    'selection-has-no-revised-contribution': true,
    'selection-has-no-original-contribution': true,
    'hidden-comment-loss': true,
    'comment-payload-target': true,
    'candidate-source-only': true,
    'semantic-postcondition-failed': true
  })

function isRejectionCode(value: unknown): value is RejectionCode {
  return typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(rejectionCodeMembers, value)
}

interface DecodedTerminalOutcome {
  readonly result:
    | Readonly<{ readonly kind: 'committed' }>
    | Readonly<{ readonly kind: 'state-changed' }>
    | Exclude<
      DocumentCoreViewDispatchResult,
      Readonly<{ readonly kind: 'committed' | 'state-changed' }>
    >
  readonly transitionId: string | null
}

function decodeTerminalOutcome(
  bytes: Uint8Array
): DecodedTerminalOutcome {
  const raw = decodeJsonRecord(bytes, 'Terminal outcome')
  if (raw.schema !== 'document-core-terminal-outcome-1') {
    throw new TypeError('Terminal outcome has an invalid schema')
  }
  if (raw.kind === 'committed') {
    const outcome = closedRecord(raw, 'Committed terminal outcome', [
      'schema',
      'kind',
      'transitionId',
      'cause',
      'history'
    ])
    if (
      (
        outcome.cause !== 'source-edit' &&
        outcome.cause !== 'undo' &&
        outcome.cause !== 'redo'
      ) ||
      (
        outcome.history !== 'record' &&
        outcome.history !== 'none'
      )
    ) {
      throw new TypeError('Committed terminal outcome has invalid metadata')
    }
    return Object.freeze({
      result: Object.freeze({ kind: 'committed' as const }),
      transitionId: nonemptyString(
        outcome.transitionId,
        'Committed transitionId'
      )
    })
  }
  if (raw.kind === 'state-changed') {
    const fields = Object.prototype.hasOwnProperty.call(raw, 'cause')
      ? ['schema', 'kind', 'cause']
      : ['schema', 'kind']
    const outcome = closedRecord(raw, 'State-changed terminal outcome', fields)
    if (
      fields.length === 3 &&
      outcome.cause !== 'markdown-options'
    ) {
      throw new TypeError('State-changed terminal outcome has invalid metadata')
    }
    return Object.freeze({
      result: Object.freeze({ kind: 'state-changed' as const }),
      transitionId: null
    })
  }
  if (raw.kind === 'cancelled') {
    const outcome = closedRecord(raw, 'Cancelled terminal outcome', [
      'schema',
      'kind',
      'reason'
    ])
    if (outcome.reason !== 'cancelled') {
      throw new TypeError(
        'Cancelled terminal outcome has no cancellation reason'
      )
    }
    return Object.freeze({
      result: Object.freeze({ kind: 'cancelled', reason: 'cancelled' }),
      transitionId: null
    })
  }
  if (raw.kind === 'noop') {
    const outcome = closedRecord(raw, 'No-op terminal outcome', [
      'schema',
      'kind',
      'reason'
    ])
    if (outcome.reason !== 'empty-insertion') {
      throw new TypeError('No-op terminal outcome has an invalid reason')
    }
    return Object.freeze({
      result: Object.freeze({ kind: 'noop', reason: 'empty-insertion' }),
      transitionId: null
    })
  }
  if (raw.kind === 'rejected') {
    const outcome = closedRecord(raw, 'Rejected terminal outcome', [
      'schema',
      'kind',
      'reason'
    ])
    if (!isRejectionCode(outcome.reason)) {
      throw new TypeError('Rejected terminal outcome has an invalid reason')
    }
    return Object.freeze({
      result: Object.freeze({
        kind: 'rejected',
        reason: outcome.reason
      }),
      transitionId: null
    })
  }
  throw new TypeError('Terminal outcome has an unknown kind')
}

function decodeOutcome(
  publication: Extract<WirePublicationResultV1, { kind: 'published' }>
): DecodedTerminalOutcome | undefined {
  const bytes = publication.members.terminalOutcomeDelta
  if (bytes === undefined) return undefined
  return decodeTerminalOutcome(bytes)
}

const executionNumericFields = Object.freeze([
  'executionThreadId',
  'checkpointCount',
  'sourceCheckpointCount',
  'logicalNodeCheckpointCount',
  'sourceCheckpointInterval',
  'logicalNodeCheckpointInterval',
  'sourceUnits',
  'logicalNodes',
  'maximumSourceDelta',
  'maximumLogicalNodeDelta',
  'workerHeapUsedBytes',
  'workerHeapTotalBytes',
  'workerExternalBytes',
  'workerArrayBuffersBytes',
  'workerProcessRssBytes',
  'serializedPayloadBytes',
  'operationCheckpointCount',
  'operationSourceCheckpointCount',
  'operationLogicalNodeCheckpointCount',
  'operationSourceUnits',
  'operationLogicalNodes',
  'operationMaximumSourceDelta',
  'operationMaximumLogicalNodeDelta',
  'operationElapsedMs',
  'operationMaximumCheckpointGapMs',
  'operationOwningThreadStallMs',
  'operationIntrinsicSourceTraversals',
  'operationIntrinsicSourceUnits',
  'operationForkAstRegionEmissions',
  'operationForkAstRegionUnits',
  'operationForkAstRegionReuses'
] as const)

const executionDurationFields: ReadonlySet<string> = new Set([
  'operationElapsedMs',
  'operationMaximumCheckpointGapMs',
  'operationOwningThreadStallMs'
])

function decodeExecutionOperationKind(
  value: unknown
): DocumentCoreExecutionOperationKind {
  switch (value) {
    case 'open':
    case 'recovery':
    case 'attach':
    case 'reload':
    case 'dispatch':
    case 'reconfigure':
    case 'select':
      return value
    default:
      throw new TypeError('Main returned an invalid execution operation kind')
  }
}

function isWireMemberName(value: string): value is WireMemberNameV1 {
  return WIRE_MEMBER_ORDER_V1.some(memberName => memberName === value)
}

function decodeExecutionReport(
  value: unknown
): DocumentCoreExecutionReport {
  const report = closedRecord(value, 'Document-core execution report', [
    'schema',
    ...executionNumericFields,
    'cancellationObserved',
    'serializedMemberBytes',
    'operationKind'
  ])
  if (
    report.schema !== 'document-core-execution-report-1' ||
    typeof report.cancellationObserved !== 'boolean' ||
    executionNumericFields.some(field =>
      typeof report[field] !== 'number' ||
      !Number.isFinite(report[field]) ||
      Number(report[field]) < 0 ||
      (
        !executionDurationFields.has(field) &&
        !Number.isSafeInteger(report[field])
      )) ||
    Number(report.executionThreadId) < 1
  ) {
    throw new TypeError('Main returned an invalid execution report')
  }
  const operationKind = decodeExecutionOperationKind(report.operationKind)
  if (
    report.serializedMemberBytes === null ||
    typeof report.serializedMemberBytes !== 'object' ||
    Array.isArray(report.serializedMemberBytes) ||
    (
      Object.getPrototypeOf(report.serializedMemberBytes) !==
        Object.prototype &&
      Object.getPrototypeOf(report.serializedMemberBytes) !== null
    )
  ) {
    throw new TypeError('Main returned invalid serialized member metrics')
  }
  const serializedMemberBytes:
  Partial<Record<WireMemberNameV1, number>> = {}
  for (const key of Reflect.ownKeys(report.serializedMemberBytes)) {
    if (typeof key !== 'string' || !isWireMemberName(key)) {
      throw new TypeError('Main returned invalid serialized member metrics')
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      report.serializedMemberBytes,
      key
    )
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new TypeError('Main returned invalid serialized member metrics')
    }
    const bytes = descriptor.value
    if (!Number.isSafeInteger(bytes) || Number(bytes) < 0) {
      throw new TypeError('Main returned invalid serialized member metrics')
    }
    serializedMemberBytes[key] = Number(bytes)
  }
  return Object.freeze({
    schema: 'document-core-execution-report-1',
    executionThreadId: Number(report.executionThreadId),
    checkpointCount: Number(report.checkpointCount),
    sourceCheckpointCount: Number(report.sourceCheckpointCount),
    logicalNodeCheckpointCount: Number(report.logicalNodeCheckpointCount),
    sourceCheckpointInterval: Number(report.sourceCheckpointInterval),
    logicalNodeCheckpointInterval: Number(report.logicalNodeCheckpointInterval),
    sourceUnits: Number(report.sourceUnits),
    logicalNodes: Number(report.logicalNodes),
    maximumSourceDelta: Number(report.maximumSourceDelta),
    maximumLogicalNodeDelta: Number(report.maximumLogicalNodeDelta),
    cancellationObserved: report.cancellationObserved,
    workerHeapUsedBytes: Number(report.workerHeapUsedBytes),
    workerHeapTotalBytes: Number(report.workerHeapTotalBytes),
    workerExternalBytes: Number(report.workerExternalBytes),
    workerArrayBuffersBytes: Number(report.workerArrayBuffersBytes),
    workerProcessRssBytes: Number(report.workerProcessRssBytes),
    serializedPayloadBytes: Number(report.serializedPayloadBytes),
    serializedMemberBytes: Object.freeze(serializedMemberBytes),
    operationKind,
    operationCheckpointCount: Number(report.operationCheckpointCount),
    operationSourceCheckpointCount:
      Number(report.operationSourceCheckpointCount),
    operationLogicalNodeCheckpointCount:
      Number(report.operationLogicalNodeCheckpointCount),
    operationSourceUnits: Number(report.operationSourceUnits),
    operationLogicalNodes: Number(report.operationLogicalNodes),
    operationMaximumSourceDelta: Number(report.operationMaximumSourceDelta),
    operationMaximumLogicalNodeDelta:
      Number(report.operationMaximumLogicalNodeDelta),
    operationElapsedMs: Number(report.operationElapsedMs),
    operationMaximumCheckpointGapMs:
      Number(report.operationMaximumCheckpointGapMs),
    operationOwningThreadStallMs:
      Number(report.operationOwningThreadStallMs),
    operationIntrinsicSourceTraversals:
      Number(report.operationIntrinsicSourceTraversals),
    operationIntrinsicSourceUnits:
      Number(report.operationIntrinsicSourceUnits),
    operationForkAstRegionEmissions:
      Number(report.operationForkAstRegionEmissions),
    operationForkAstRegionUnits:
      Number(report.operationForkAstRegionUnits),
    operationForkAstRegionReuses:
      Number(report.operationForkAstRegionReuses)
  })
}

function assertExecutionReportMatchesPublication(
  report: DocumentCoreExecutionReport,
  members: Extract<
    WirePublicationResultV1,
    { readonly kind: 'published' }
  >['members'],
  expectedOperations: readonly DocumentCoreExecutionOperationKind[]
): void {
  if (!expectedOperations.includes(report.operationKind)) {
    throw new TypeError(
      `Document-core execution operation ${report.operationKind} does not ` +
      'match the publication request'
    )
  }
  const boundedOperationTotals = [
    ['operationCheckpointCount', 'checkpointCount'],
    ['operationSourceCheckpointCount', 'sourceCheckpointCount'],
    ['operationLogicalNodeCheckpointCount', 'logicalNodeCheckpointCount'],
    ['operationSourceUnits', 'sourceUnits'],
    ['operationLogicalNodes', 'logicalNodes'],
    ['operationMaximumSourceDelta', 'maximumSourceDelta'],
    ['operationMaximumLogicalNodeDelta', 'maximumLogicalNodeDelta']
  ] as const
  if (boundedOperationTotals.some(([operationField, lifetimeField]) =>
    report[operationField] > report[lifetimeField])) {
    throw new TypeError(
      'Document-core execution operation exceeds its lifetime totals'
    )
  }
  let serializedPayloadBytes = 0
  for (const memberName of WIRE_MEMBER_ORDER_V1) {
    const member = members[memberName]
    const reportedBytes = report.serializedMemberBytes[memberName]
    if (
      member === undefined
        ? reportedBytes !== undefined
        : reportedBytes !== member.byteLength
    ) {
      throw new TypeError(
        `Document-core serialized member metric does not match ${memberName}`
      )
    }
    if (member !== undefined) serializedPayloadBytes += member.byteLength
  }
  if (report.serializedPayloadBytes !== serializedPayloadBytes) {
    throw new TypeError(
      'Document-core serialized payload metric does not match its members'
    )
  }
}

interface DecodedDocumentCorePublication {
  readonly documentId: string
  readonly baseSnapshotId: string
  readonly envelope: unknown
  readonly execution: DocumentCoreExecutionReport
}

function assertPublication(
  value: unknown,
  expectedDocumentId: string
): DecodedDocumentCorePublication {
  let publication
  try {
    publication = closedRecord(value, 'Document-core publication', [
      'documentId',
      'baseSnapshotId',
      'envelope',
      'execution'
    ])
  } catch {
    throw new TypeError('Main returned an invalid document-core publication')
  }
  if (
    publication.documentId !== expectedDocumentId ||
    publication.envelope === null ||
    typeof publication.envelope !== 'object' ||
    Array.isArray(publication.envelope)
  ) {
    throw new TypeError('Main returned an invalid document-core publication')
  }
  return Object.freeze({
    documentId: expectedDocumentId,
    baseSnapshotId: nonemptyString(
      publication.baseSnapshotId,
      'Document-core publication base snapshot identity'
    ),
    envelope: publication.envelope,
    execution: decodeExecutionReport(publication.execution)
  })
}

type DecodedClipboardWriteReceipt =
  | Readonly<{ readonly kind: 'written' }>
  | Readonly<{
    readonly kind: 'cut-committed'
    readonly publication: DecodedDocumentCorePublication
  }>
  | Readonly<{
    readonly kind: 'unavailable'
    readonly reason: 'source-only-revision'
  }>
  | Readonly<{
    readonly kind: 'disabled'
    readonly reason: 'read-only-view'
  }>

function assertClipboardWriteReceipt(
  value: unknown,
  consumer: ClipboardConsumerRequest['consumer'],
  documentId: string
): DecodedClipboardWriteReceipt {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Main returned an invalid clipboard receipt')
  }
  const kind = dataField(value, 'kind', 'Invalid clipboard receipt')
  if (kind === 'written') {
    const record = closedRecord(value, 'Clipboard write receipt', [
      'kind',
      'consumer'
    ])
    if (
      record.consumer !== consumer ||
      consumer === 'cut' ||
      consumer === 'cut-table'
    ) {
      throw new TypeError('Main returned an invalid clipboard write receipt')
    }
    return Object.freeze({ kind: 'written' })
  }
  if (kind === 'cut-committed') {
    const record = closedRecord(value, 'Clipboard cut receipt', [
      'kind',
      'consumer',
      'publication'
    ])
    if (
      (consumer !== 'cut' && consumer !== 'cut-table') ||
      record.consumer !== consumer
    ) {
      throw new TypeError('Main returned an invalid cut receipt')
    }
    return Object.freeze({
      kind: 'cut-committed',
      publication: assertPublication(record.publication, documentId)
    })
  }
  if (kind === 'unavailable') {
    const record = closedRecord(value, 'Clipboard unavailable receipt', [
      'kind',
      'reason'
    ])
    if (record.reason !== 'source-only-revision') {
      throw new TypeError('Main returned an invalid unavailable receipt')
    }
    return Object.freeze({
      kind: 'unavailable',
      reason: 'source-only-revision'
    })
  }
  if (kind === 'disabled') {
    const record = closedRecord(value, 'Clipboard disabled receipt', [
      'kind',
      'consumer',
      'reason'
    ])
    if (
      (consumer !== 'cut' && consumer !== 'cut-table') ||
      record.consumer !== consumer ||
      record.reason !== 'read-only-view'
    ) {
      throw new TypeError('Main returned an invalid disabled receipt')
    }
    return Object.freeze({
      kind: 'disabled',
      reason: 'read-only-view'
    })
  }
  throw new TypeError('Main returned an unknown clipboard receipt')
}

function assertDispatchTicket(
  value: unknown,
  expectedDocumentId: string,
  expectedBaseSnapshotId: string
): DocumentCoreDispatchTicketReceipt {
  const ticket = closedRecord(value, 'Document-core dispatch ticket', [
    'schema',
    'documentId',
    'baseSnapshotId',
    'ticketId',
    'clientSequence'
  ])
  if (
    ticket.schema !== 'document-core-dispatch-ticket-1' ||
    ticket.documentId !== expectedDocumentId ||
    ticket.baseSnapshotId !== expectedBaseSnapshotId ||
    !Number.isSafeInteger(ticket.clientSequence) ||
    Number(ticket.clientSequence) < 1
  ) {
    throw new TypeError('Main returned an invalid document-core dispatch ticket')
  }
  return Object.freeze({
    schema: 'document-core-dispatch-ticket-1',
    documentId: expectedDocumentId,
    baseSnapshotId: expectedBaseSnapshotId,
    ticketId: nonemptyString(
      ticket.ticketId,
      'Document-core dispatch ticket identity'
    ),
    clientSequence: Number(ticket.clientSequence)
  })
}

function assertImageAssetActivation(
  value: unknown,
  documentId: string
): ImageAssetActivationReceipt {
  const receipt = closedRecord(value, 'Image activation receipt', [
    'schema',
    'documentId',
    'generation'
  ])
  if (
    receipt.schema !== 'image-asset-activation-receipt-1' ||
    receipt.documentId !== documentId ||
    !Number.isSafeInteger(receipt.generation) ||
    Number(receipt.generation) < 1
  ) {
    throw new TypeError('Main returned an invalid image activation receipt')
  }
  return Object.freeze({
    schema: 'image-asset-activation-receipt-1',
    documentId,
    generation: Number(receipt.generation)
  })
}

type DecodedImageAssetInsertReceipt =
  | Readonly<{
    readonly schema: 'image-asset-insert-receipt-1'
    readonly kind: 'published'
    readonly documentId: string
    readonly asset: ImageAssetMaterializationReceipt | null
    readonly publication: DecodedDocumentCorePublication
  }>
  | Readonly<{
    readonly schema: 'image-asset-insert-receipt-1'
    readonly kind: 'cancelled'
    readonly documentId: string
    readonly reason: 'document-deactivated'
  }>

function isImageAssetMediaType(
  value: unknown
): value is ImageAssetMaterializationReceipt['mediaType'] {
  return typeof value === 'string' &&
    IMAGE_ASSET_MEDIA_TYPES.some(mediaType => mediaType === value)
}

function decodeImageAssetMaterializationReceipt(
  value: unknown,
  documentId: string
): ImageAssetMaterializationReceipt | null {
  if (value === null) return null
  const asset = closedRecord(value, 'Image materialization receipt', [
    'schema',
    'kind',
    'documentId',
    'reference',
    'mediaType',
    'byteLength'
  ])
  if (
    asset.schema !== 'image-asset-receipt-1' ||
    (
      asset.kind !== 'referenced' &&
      asset.kind !== 'stored' &&
      asset.kind !== 'reused'
    ) ||
    asset.documentId !== documentId ||
    typeof asset.reference !== 'string' ||
    asset.reference.length === 0 ||
    asset.reference.length > 4_096 ||
    asset.reference.includes('\0') ||
    !isImageAssetMediaType(asset.mediaType) ||
    !Number.isSafeInteger(asset.byteLength) ||
    Number(asset.byteLength) < 1 ||
    Number(asset.byteLength) > MAX_IMAGE_ASSET_BYTES
  ) {
    throw new TypeError('Main returned an invalid image asset receipt')
  }
  return Object.freeze({
    schema: 'image-asset-receipt-1',
    kind: asset.kind,
    documentId,
    reference: asset.reference,
    mediaType: asset.mediaType,
    byteLength: Number(asset.byteLength)
  })
}

function assertImageAssetInsertReceipt(
  value: unknown,
  documentId: string
): DecodedImageAssetInsertReceipt {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new TypeError('Main returned an invalid image insertion receipt')
  }
  const kind = dataField(value, 'kind', 'Image insertion receipt')
  if (kind === 'cancelled') {
    const receipt = closedRecord(value, 'Image cancellation receipt', [
      'schema',
      'kind',
      'documentId',
      'reason'
    ])
    if (
      receipt.schema !== 'image-asset-insert-receipt-1' ||
      receipt.documentId !== documentId ||
      receipt.reason !== 'document-deactivated'
    ) {
      throw new TypeError('Main returned an invalid image cancellation')
    }
    return Object.freeze({
      schema: 'image-asset-insert-receipt-1',
      kind: 'cancelled',
      documentId,
      reason: 'document-deactivated'
    })
  }
  if (kind !== 'published') {
    throw new TypeError('Main returned an invalid image publication')
  }
  const receipt = closedRecord(value, 'Image publication receipt', [
    'schema',
    'kind',
    'documentId',
    'asset',
    'publication'
  ])
  if (
    receipt.schema !== 'image-asset-insert-receipt-1' ||
    receipt.documentId !== documentId
  ) {
    throw new TypeError('Main returned an invalid image publication')
  }
  return Object.freeze({
    schema: 'image-asset-insert-receipt-1',
    kind: 'published',
    documentId,
    asset: decodeImageAssetMaterializationReceipt(receipt.asset, documentId),
    publication: assertPublication(receipt.publication, documentId)
  })
}

function decodeImageDisplayResolution(
  value: unknown,
  request: DocumentCoreImageSourceRequest,
  documentId: string
): DocumentCoreImageSourceResolution {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Main returned an invalid image display receipt')
  }
  const kind = dataField(value, 'kind', 'Image display receipt')
  const variantField = kind === 'resolved'
    ? 'src'
    : kind === 'unavailable'
      ? 'reason'
      : null
  if (variantField === null) {
    throw new TypeError('Main returned an invalid image display receipt')
  }
  const record = closedRecord(value, 'Image display receipt', [
    'schema',
    'kind',
    'documentId',
    'revisionId',
    'reference',
    variantField
  ])
  if (
    record.schema !== 'image-display-receipt-1' ||
    record.documentId !== documentId ||
    record.revisionId !== request.revisionId ||
    record.reference !== request.reference
  ) {
    throw new TypeError('Main returned a mismatched image display receipt')
  }
  if (
    record.kind === 'resolved' &&
    typeof record.src === 'string' &&
    /^marktext-image:\/\/asset\/[a-zA-Z0-9_-]{1,256}$/.test(record.src)
  ) {
    return Object.freeze({
      kind: 'resolved' as const,
      src: record.src
    })
  }
  const unavailableReasons = new Set([
    'untitled-document',
    'unsafe-reference',
    'missing-image',
    'unsupported-image'
  ])
  if (
    record.kind === 'unavailable' &&
    typeof record.reason === 'string' &&
    unavailableReasons.has(record.reason)
  ) {
    return Object.freeze({ kind: 'unavailable' as const })
  }
  throw new TypeError('Main returned an invalid image display receipt')
}

/**
 * Renderer-side cache over the main-owned session.
 *
 * The cache changes only after the common wire codec validates order, member
 * completeness, and checksums. It is a mounted read model, never a writer:
 * every mutation and persistence lease crosses `invoke` to main.
 */
export async function createDocumentCoreRemoteSession(
  options: DocumentCoreRemoteSessionOptions
): Promise<DocumentCoreRemoteSession> {
  const codec = new WireEnvelopeCodecV1()
  let portable: DocumentCorePortableSnapshot | undefined
  let mountedSnapshotId = ''
  let pending: Promise<void> = Promise.resolve()
  let closed = false
  let closePromise: Promise<void> | null = null
  let activeDocumentId = ''
  const openedDocuments = new Set<string>()
  const activeTickets = new Map<string, string>()
  const closingDocuments = new Map<string, Promise<void>>()
  const imageAssets = new Map<string, Readonly<{
    documentId: string
    source: ImageAssetSource
    storage: ImageAssetStorage
  }>>()
  let nextImageAssetId = 1

  const enqueue = <Result>(
    operation: () => Promise<Result>
  ): Promise<Result> => {
    const result = pending.then(operation)
    pending = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  const assertActiveDocumentAvailable = (): void => {
    if (closed) throw new Error('The remote document session is closed')
    if (
      !openedDocuments.has(activeDocumentId) ||
      closingDocuments.has(activeDocumentId)
    ) {
      throw new Error(
        `The main-owned document ${activeDocumentId} is closing`
      )
    }
  }

  const apply = (
    response: unknown,
    expectedBase?: string,
    documentId: string = activeDocumentId,
    expectedOperations:
    readonly DocumentCoreExecutionOperationKind[] = ['dispatch'],
    requiredOutcome?: DocumentCoreViewDispatchResult['kind']
  ): DocumentCoreViewDispatchResult | undefined => {
    const publication = assertPublication(response, documentId)
    const base = expectedBase ?? publication.baseSnapshotId
    if (publication.baseSnapshotId !== base) {
      throw new Error(
        `Main publication base ${publication.baseSnapshotId} does not match ${base}`
      )
    }
    const verified = codec.publish(publication.envelope, base)
    if (verified.kind !== 'published') {
      throw new Error(
        `Document-core publication rejected: ${verified.reason}`
      )
    }
    assertExecutionReportMatchesPublication(
      publication.execution,
      verified.members,
      expectedOperations
    )
    const decodedOutcome = decodeOutcome(verified)
    const terminalOutcome = decodedOutcome?.result
    if (
      requiredOutcome !== undefined &&
      terminalOutcome?.kind !== requiredOutcome
    ) {
      throw new Error(
        `Document-core publication requires ${requiredOutcome}, received ` +
        `${terminalOutcome?.kind ?? 'missing-outcome'}`
      )
    }
    const next = decodeSnapshot(
      verified,
      expectedBase === undefined ? undefined : portable
    )
    if (verified.transitionId !== null && next === undefined) {
      throw new Error(
        'Document-core state transition has no complete snapshot'
      )
    }
    if (
      terminalOutcome?.kind === 'committed' &&
      decodedOutcome?.transitionId !== verified.transitionId
    ) {
      throw new Error(
        'Committed terminal transition does not match its wire envelope'
      )
    }

    // One internal commit: no observer can see portable state from one head
    // while the mounted identity still names another.
    if (next !== undefined) {
      portable = next
    }
    mountedSnapshotId = verified.mountedSnapshotId
    options.onExecutionReport?.(documentId, publication.execution)
    if (next !== undefined) {
      options.onHistoryState(documentId, next.historyState)
    }
    if (terminalOutcome?.kind === 'committed') {
      if (next === undefined) {
        throw new Error('Committed publication has no authoritative snapshot')
      }
      const sourceEdits = sourceEditsByPortableSnapshot.get(next)
      if (sourceEdits === undefined || sourceEdits.length === 0) {
        throw new Error('Committed publication has no exact source edits')
      }
      return Object.freeze({
        kind: 'committed' as const,
        sourceEdits
      })
    }
    if (terminalOutcome?.kind === 'state-changed') {
      if (next === undefined) {
        throw new Error('State publication has no authoritative snapshot')
      }
      const sourceEdits = sourceEditsByPortableSnapshot.get(next)
      if (sourceEdits === undefined || sourceEdits.length !== 0) {
        throw new Error('State publication unexpectedly changes source')
      }
      return Object.freeze({
        kind: 'state-changed' as const,
        sourceEdits: Object.freeze([])
      })
    }
    return terminalOutcome
  }

  const attach = async(documentId: string): Promise<void> => {
    const response = await options.invoke(
      'mt::document-core::attach',
      Object.freeze({ documentId })
    )
    apply(response, undefined, documentId, ['attach', 'recovery'])
    if (portable === undefined) {
      throw new Error('Main attach did not publish a document snapshot')
    }
    activeDocumentId = documentId
    openedDocuments.add(documentId)
  }

  const applyMounted = async(
    response: unknown,
    expectedBase: string,
    documentId: string,
    expectedOperations:
    readonly DocumentCoreExecutionOperationKind[] = ['dispatch'],
    requiredOutcome?: DocumentCoreViewDispatchResult['kind']
  ): Promise<DocumentCoreViewDispatchResult | undefined> => {
    try {
      return apply(
        response,
        expectedBase,
        documentId,
        expectedOperations,
        requiredOutcome
      )
    } catch (publicationError) {
      // Main may have committed even when a hostile or damaged publication
      // cannot be mounted. Reattach the verified full head before exposing the
      // failure so the next renderer request never starts from a stale base.
      const recovery = await options.invoke(
        'mt::document-core::attach',
        Object.freeze({ documentId })
      )
      apply(recovery, undefined, documentId, ['attach', 'recovery'])
      throw publicationError
    }
  }

  const requireTerminalOutcome = (
    outcome: DocumentCoreViewDispatchResult | undefined
  ): DocumentCoreViewDispatchResult => {
    if (outcome === undefined) {
      throw new Error('Document-core transition has no terminal outcome')
    }
    return outcome
  }

  await attach(options.documentId())

  const activateDocument = async(documentId: string): Promise<void> => {
    const response = await options.invoke(
      'mt::image-assets::activate-document',
      Object.freeze({
        schema: 'image-asset-activation-1',
        documentId
      })
    )
    assertImageAssetActivation(response, documentId)
  }

  await activateDocument(activeDocumentId)

  const portableSnapshot = (): DocumentCorePortableSnapshot => {
    if (portable === undefined) {
      throw new Error('The remote document session has no mounted snapshot')
    }
    return portable
  }
  const snapshot = (): DocumentCoreViewSnapshot =>
    toViewSnapshot(portableSnapshot())

  const resolveImageSource = async(
    request: DocumentCoreImageSourceRequest
  ): Promise<DocumentCoreImageSourceResolution> => {
    assertActiveDocumentAvailable()
    const documentId = activeDocumentId
    const current = portableSnapshot()
    if (request.revisionId !== current.revisionId) {
      throw new Error(
        `Image display requested stale revision ${request.revisionId}`
      )
    }
    const response = await options.invoke(
      'mt::image-assets::resolve-display',
      Object.freeze({
        schema: 'image-display-1',
        documentId,
        revisionId: request.revisionId,
        reference: request.reference
      })
    )
    const resolution = decodeImageDisplayResolution(
      response,
      request,
      documentId
    )
    if (
      closed ||
      activeDocumentId !== documentId ||
      portableSnapshot().revisionId !== request.revisionId
    ) {
      return Object.freeze({ kind: 'unavailable' as const })
    }
    return resolution
  }

  const pasteClipboard = (
    target: ModelSelection
  ): Promise<DocumentCoreViewDispatchResult> => enqueue(async() => {
    assertActiveDocumentAvailable()
    const documentId = activeDocumentId
    const baseSnapshotId = mountedSnapshotId
    const current = portableSnapshot()
    if (target.revision !== current.revisionId) {
      throw new Error(
        `Clipboard paste requested stale revision ${target.revision}`
      )
    }
    const response = await pasteDocumentClipboard(
      Object.freeze({
        schema: 'document-clipboard-paste-1',
        documentId,
        baseSnapshotId,
        target
      }),
      (channel, request) => options.invoke(channel, request)
    )
    return requireTerminalOutcome(await applyMounted(
      response,
      baseSnapshotId,
      documentId,
      ['dispatch']
    ))
  })

  const dispatch = (
    intent: EditorIntent
  ): Promise<DocumentCoreViewDispatchResult> =>
    enqueue(async() => {
      assertActiveDocumentAvailable()
      const documentId = activeDocumentId
      const baseSnapshotId = mountedSnapshotId
      if (intent.kind === 'insert-image') {
        const staged = imageAssets.get(intent.src)
        if (staged !== undefined) {
          imageAssets.delete(intent.src)
          if (staged.documentId !== documentId) {
            return Object.freeze({
              kind: 'cancelled' as const,
              reason: 'cancelled' as const
            })
          }
          const current = portableSnapshot()
          const response = assertImageAssetInsertReceipt(
            await options.invoke(
              'mt::image-assets::insert',
              Object.freeze({
                schema: 'image-asset-insert-1',
                documentId,
                baseSnapshotId,
                revisionId: current.revisionId,
                target: intent.target,
                source: staged.source,
                storage: staged.storage,
                alt: intent.alt,
                ...(intent.title === undefined
                  ? {}
                  : { title: intent.title })
              })
            ),
            documentId
          )
          if (response.kind === 'cancelled') {
            return Object.freeze({
              kind: 'cancelled' as const,
              reason: 'cancelled' as const
            })
          }
          return requireTerminalOutcome(await applyMounted(
            response.publication,
            baseSnapshotId,
            documentId,
            ['dispatch']
          ))
        }
      }
      const request: DocumentCoreMainDispatchRequest = {
        documentId,
        baseSnapshotId,
        intent
      }
      const ticket = assertDispatchTicket(await options.invoke(
        'mt::document-core::dispatch-start',
        request
      ), documentId, baseSnapshotId)
      activeTickets.set(ticket.ticketId, documentId)
      try {
        if (closed || closingDocuments.has(documentId)) {
          const cancelRequest: DocumentCoreCancelDispatchRequest = {
            documentId,
            ticketId: ticket.ticketId
          }
          await options.invoke(
            'mt::document-core::dispatch-cancel',
            cancelRequest
          )
        }
        const completeRequest: DocumentCoreCompleteDispatchRequest = {
          documentId,
          ticketId: ticket.ticketId
        }
        const response = await options.invoke(
          'mt::document-core::dispatch-complete',
          completeRequest
        )
        const outcome = requireTerminalOutcome(await applyMounted(
          response,
          baseSnapshotId,
          documentId,
          ['dispatch']
        ))
        return outcome
      } finally {
        activeTickets.delete(ticket.ticketId)
      }
    })

  const selectInView = (
    view: 'markup' | 'source',
    selection: InitialModelSelection
  ): Promise<void> => {
    assertActiveDocumentAvailable()
    return enqueue(async() => {
      assertActiveDocumentAvailable()
      const documentId = activeDocumentId
      const baseSnapshotId = mountedSnapshotId
      const request: DocumentCoreMainSelectRequest = {
        documentId,
        baseSnapshotId,
        view,
        selection
      }
      const response = await options.invoke(
        'mt::document-core::select',
        request
      )
      await applyMounted(
        response,
        baseSnapshotId,
        documentId,
        ['select']
      )
    })
  }
  const select = (selection: InitialModelSelection): Promise<void> =>
    selectInView('markup', selection)
  const selectSource = (selection: InitialModelSelection): Promise<void> =>
    selectInView('source', selection)

  const reconfigureMarkdownOptions = (
    patch: DocumentCoreMarkdownOptionPatch
  ): Promise<DocumentCoreViewDispatchResult> => {
    assertActiveDocumentAvailable()
    return enqueue(async() => {
      assertActiveDocumentAvailable()
      const documentId = activeDocumentId
      const baseSnapshotId = mountedSnapshotId
      const request: DocumentCoreReconfigureMarkdownOptionsRequest = {
        documentId,
        baseSnapshotId,
        patch: Object.freeze({ ...patch })
      }
      const response = await options.invoke(
        'mt::document-core::reconfigure-markdown-options',
        request
      )
      return requireTerminalOutcome(await applyMounted(
        response,
        baseSnapshotId,
        documentId,
        ['reconfigure'],
        'state-changed'
      ))
    })
  }

  const writeClipboardMaterialization = (
    request: ClipboardConsumerRequest & Readonly<{ revisionId: string }>
  ): Promise<Readonly<{
    readonly kind: 'written' | 'cut-committed'
  }>> => enqueue(async() => {
    assertActiveDocumentAvailable()
    const documentId = activeDocumentId
    const baseSnapshotId = mountedSnapshotId
    if (request.revisionId !== portableSnapshot().revisionId) {
      throw new Error(
        `Clipboard requested stale revision ${request.revisionId}`
      )
    }
    const receipt = assertClipboardWriteReceipt(
      await options.invoke(
        'mt::document-core::write-clipboard',
        Object.freeze({ documentId, ...request })
      ),
      request.consumer,
      documentId
    )
    if (receipt.kind === 'written') {
      return Object.freeze({ kind: 'written' as const })
    }
    if (receipt.kind === 'cut-committed') {
      const outcome = await applyMounted(
        receipt.publication,
        baseSnapshotId,
        documentId,
        ['dispatch'],
        'committed'
      )
      if (outcome?.kind !== 'committed') {
        throw new Error(
          'Main labeled a non-committed cut as complete: ' +
          `${outcome?.kind ?? 'missing-outcome'}`
        )
      }
      return Object.freeze({ kind: 'cut-committed' as const })
    }
    throw new Error(
      `Document-core clipboard is unavailable: ${receipt.reason}`
    )
  })

  const attachDocument = async(documentId: string): Promise<void> => {
    const activation = activateDocument(documentId)
    await pending
    await activation
    if (closed) throw new Error('The remote document session is closed')
    // A same-id attach is the reload signal: the store re-emits file-changed
    // for the ACTIVE document precisely when main replaced its session content
    // from disk, and refusing it left the renderer showing the pre-reload
    // bytes forever. Keep the last verified read model available until main
    // publishes; synchronous shell reads can occur while the async attach is
    // in flight, and an empty cache would make that valid transition
    // observable as a broken editor.
    await attach(documentId)
  }

  const beginCloseDocument = (documentId: string): Promise<void> => {
    const existingClose = closingDocuments.get(documentId)
    if (existingClose !== undefined) return existingClose
    if (!openedDocuments.has(documentId)) return Promise.resolve()

    const operation = (async() => {
      try {
        const tickets = [...activeTickets]
          .filter(([, ticketDocumentId]) => ticketDocumentId === documentId)
        await Promise.allSettled(tickets.map(async([ticketId]) => {
          const request: DocumentCoreCancelDispatchRequest = {
            documentId,
            ticketId
          }
          await options.invoke('mt::document-core::dispatch-cancel', request)
        }))
        await pending
        openedDocuments.delete(documentId)
      } finally {
        closingDocuments.delete(documentId)
      }
    })()
    closingDocuments.set(documentId, operation)
    return operation
  }

  const closeDocument = (documentId: string): Promise<void> => {
    if (closed) {
      return closePromise ?? Promise.reject(
        new Error('The remote document session is closed')
      )
    }
    return beginCloseDocument(documentId)
  }

  const close = (): Promise<void> => {
    if (closePromise !== null) return closePromise
    closed = true
    closePromise = (async() => {
      const tickets = [...activeTickets]
      await Promise.allSettled(tickets.map(async([ticketId, documentId]) => {
        const request: DocumentCoreCancelDispatchRequest = {
          documentId,
          ticketId
        }
        await options.invoke('mt::document-core::dispatch-cancel', request)
      }))
      await pending
      await Promise.all(
        [...openedDocuments].map(beginCloseDocument)
      )
      imageAssets.clear()
    })()
    return closePromise
  }

  const settled = async(): Promise<void> => {
    // The session's one settlement barrier, awaited over the wire — the
    // renderer never owns a second notion of settled.
    await options.invoke('mt::document-core::await-settled', Object.freeze({
      documentId: options.documentId()
    }))
  }

  return Object.freeze({
    snapshot,
    dispatch,
    settled,
    reconfigureMarkdownOptions,
    writeClipboardMaterialization,
    pasteClipboard,
    resolveImageSource,
    modelPositionAt: (position: ModelPosition) =>
      modelPositionAt(portableSnapshot(), position),
    select,
    selectSource,
    registerImageAsset: (
      documentId: string,
      source: ImageAssetSource,
      storage: ImageAssetStorage
    ) => {
      if (
        documentId.length === 0 ||
        !openedDocuments.has(documentId)
      ) {
        throw new Error(`Image document ${documentId} is not attached`)
      }
      const src = `main-owned-image-asset:${nextImageAssetId}`
      nextImageAssetId += 1
      imageAssets.set(src, Object.freeze({
        documentId,
        source,
        storage
      }))
      return Object.freeze({
        src,
        cancel: () => {
          imageAssets.delete(src)
        }
      })
    },
    activateDocument,
    attachDocument,
    closeDocument,
    close
  })
}
