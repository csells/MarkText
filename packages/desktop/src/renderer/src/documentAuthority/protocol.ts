import type {
  DocumentDiagnostic,
  DocumentCoreErrorCode,
  DocumentSourceEdit,
  CriticMarkupKind,
  MarkdownOptions,
  SourceRange
} from '@marktext/document-core'

export type ShadowStatus =
  | 'accepted'
  | 'diagnostic'
  | 'resource'
  | 'rejected'

export type ShadowRejectionReason =
  | 'already-open'
  | 'not-open'
  | 'stale-base'
  | 'stale-session'
  | 'stale-generation'
  | 'out-of-order'
  | 'invalid-edit'
  | 'snapshot-too-large'
  | 'queue-full'
  | 'session-disabled'
  | 'closed'
  | 'transport-error'

export interface ShadowMetrics {
  readonly parseMs: number
  readonly queueMs: number
  readonly queueDepth: number
}

export interface ShadowResourceFailure {
  readonly code: DocumentCoreErrorCode
  readonly range: SourceRange
  readonly metadata: Readonly<Record<string, string>>
}

export interface ShadowRecognitionSummary {
  readonly sourceLength: number
  readonly annotationCounts: Readonly<Record<CriticMarkupKind, number>>
}

/**
 * A diagnostic result only. It deliberately has no canonical source,
 * projection, AST, annotation inventory, save payload, or UI model.
 */
export interface ShadowReply {
  readonly type: 'result'
  readonly session: number
  readonly generation: number
  readonly sequence: number
  readonly revision: number
  readonly accepted: boolean
  readonly status: ShadowStatus
  /** Total parser diagnostics before Shadow sampling. */
  readonly diagnosticCount: number
  /** A bounded leading sample for debugging; never the full unbounded set. */
  readonly diagnostics: readonly DocumentDiagnostic[]
  /** Present only after a candidate was successfully parsed. */
  readonly recognition?: ShadowRecognitionSummary
  readonly resource?: ShadowResourceFailure
  readonly rejectionReason?: ShadowRejectionReason
  readonly metrics: ShadowMetrics
}

export type ShadowRequest =
  | Readonly<{
    readonly type: 'open'
    readonly session: number
    readonly generation: number
    readonly sequence: number
    readonly source: string
    readonly options?: Readonly<Partial<MarkdownOptions>>
  }>
  | Readonly<{
    readonly type: 'observe'
    readonly session: number
    readonly generation: number
    readonly sequence: number
    readonly baseRevision: number
    readonly edits: readonly DocumentSourceEdit[]
  }>
  | Readonly<{
    readonly type: 'close'
    readonly session: number
    readonly generation: number
    readonly sequence: number
  }>

export interface ShadowQueueContext {
  readonly queuedAt: number
  readonly queueDepth: number
}

export interface ShadowActorPort {
  request(
    request: ShadowRequest,
    queue?: ShadowQueueContext
  ): Promise<ShadowReply>
  dispose(): void
}

export interface ShadowWorkerRequestEnvelope {
  readonly type: 'shadow-request'
  readonly request: ShadowRequest
  readonly queue: ShadowQueueContext
}

export type ShadowWorkerResponseEnvelope =
  | Readonly<{
    readonly type: 'shadow-result'
    readonly reply: ShadowReply
  }>
  | Readonly<{
    readonly type: 'shadow-failure'
    readonly session: number
    readonly generation: number
    readonly sequence: number
    readonly message: string
  }>
