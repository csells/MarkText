import type {
  ClipboardConsumerRequest,
  DocumentCoreMarkdownOptionPatch,
  DocumentSessionJournalMutation,
  EditorIntent,
  InitialModelSelection,
  NodeId,
  ParseConfiguration,
  PersistenceReason,
  StaticConsumer,
  StaticConsumerRequest
} from '@marktext/document-core'

export const DOCUMENT_CORE_SOURCE_CHUNK_UNITS = 262_144
export const DOCUMENT_CORE_EXECUTION_CONTROL_WORDS = 4
export const DOCUMENT_CORE_ACTIVE_EXECUTION_INDEX = 0
export const DOCUMENT_CORE_CANCEL_REQUESTED_INDEX = 1
export const DOCUMENT_CORE_CANCEL_OBSERVED_INDEX = 2
export const DOCUMENT_CORE_EXECUTION_CHECKPOINT_INDEX = 3

export interface DocumentCoreWorkerData {
  readonly executionControl: SharedArrayBuffer
}

export interface DocumentCoreWorkerStorageRequest {
  readonly kind: 'storage-request'
  readonly requestId: number
  readonly operation:
    | Readonly<{ readonly kind: 'read'; readonly key: string }>
    | Readonly<{
      readonly kind: 'compare-exchange'
      readonly key: string
      readonly expectedRevision: number | null
      readonly mutation: DocumentSessionJournalMutation
    }>
}

export interface DocumentCoreWorkerStorageResponse {
  readonly kind: 'storage-response'
  readonly requestId: number
  readonly result?: unknown
  readonly error?: Readonly<{
    readonly name: string
    readonly message: string
    readonly stack?: string
  }>
}

export type DocumentCoreWorkerCommand =
  | Readonly<{
    readonly kind: 'append-open-chunk'
    readonly ordinal: number
    readonly text: string
  }>
  | Readonly<{
    readonly kind: 'complete-open'
    readonly documentId: string
    readonly durabilityKey: string
    readonly sourceLength: number
    readonly parseConfiguration: ParseConfiguration
    readonly executionGeneration: number
  }>
  | Readonly<{
    readonly kind: 'recover-open'
    readonly durabilityKey: string
    readonly executionGeneration: number
  }>
  | Readonly<{
    readonly kind: 'publish-current'
    readonly executionGeneration: number
  }>
  | Readonly<{
    readonly kind: 'reload-from-file'
    readonly source: string
    readonly force: boolean
    readonly executionGeneration: number
  }>
  | Readonly<{
    readonly kind: 'start-dispatch'
    readonly baseSnapshotId: string
    readonly intent: EditorIntent
    readonly executionGeneration: number
  }>
  | Readonly<{
    readonly kind: 'reconfigure-markdown-options'
    readonly baseSnapshotId: string
    readonly patch: DocumentCoreMarkdownOptionPatch
    readonly executionGeneration: number
  }>
  | Readonly<{
    readonly kind: 'complete-dispatch'
    readonly ticketId: string
  }>
  | Readonly<{
    readonly kind: 'cancel-dispatch'
    readonly ticketId: string
  }>
  | Readonly<{
    readonly kind: 'select'
    readonly baseSnapshotId: string
    readonly view: 'markup' | 'source'
    readonly selection: InitialModelSelection
    readonly executionGeneration: number
  }>
  | Readonly<{
    readonly kind: 'read-history-state'
  }>
  | Readonly<{
    readonly kind: 'await-settled'
  }>
  | Readonly<{
    readonly kind: 'prepare-persistence'
    readonly reason: PersistenceReason
  }>
  | Readonly<{
    readonly kind: 'mark-persisted'
    readonly leaseId: string
  }>
  | Readonly<{
    readonly kind: 'release-persistence'
    readonly leaseId: string
  }>
  | Readonly<{
    readonly kind: 'restore-persisted'
    readonly savedIdentity: string
  }>
  | Readonly<{
    readonly kind: 'assert-revision'
    readonly revisionId: string
  }>
  | Readonly<{
    readonly kind: 'materialize-static'
    readonly request: StaticConsumerRequest<StaticConsumer>
  }>
  | Readonly<{
    readonly kind: 'materialize-clipboard'
    readonly revisionId: string
    readonly request: ClipboardConsumerRequest
  }>
  | Readonly<{
    readonly kind: 'complete-cut'
    readonly ticketId: string
    readonly clipboardWritten: boolean
    readonly executionGeneration: number
  }>
  | Readonly<{
    readonly kind: 'resolve-document-link'
    readonly revisionId: string
    readonly targetNodeId: NodeId
  }>
  | Readonly<{ readonly kind: 'close' }>

export interface DocumentCoreWorkerCommandRequest {
  readonly kind: 'command'
  readonly requestId: number
  readonly command: DocumentCoreWorkerCommand
}

export interface DocumentCoreWorkerCommandResponse {
  readonly kind: 'command-response'
  readonly requestId: number
  readonly result?: unknown
  readonly error?: Readonly<{
    readonly name: string
    readonly message: string
    readonly stack?: string
  }>
}

export interface DocumentCoreWorkerReady {
  readonly kind: 'ready'
  readonly executionThreadId: number
}

export type DocumentCoreMainToWorkerMessage =
  | DocumentCoreWorkerCommandRequest
  | DocumentCoreWorkerStorageResponse

export type DocumentCoreWorkerToMainMessage =
  | DocumentCoreWorkerReady
  | DocumentCoreWorkerCommandResponse
  | DocumentCoreWorkerStorageRequest
