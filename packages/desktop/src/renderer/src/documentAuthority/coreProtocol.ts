import type {
  DocumentChange,
  DocumentCoreErrorCode,
  DocumentDiagnostic,
  DocumentProjectionRequest,
  DocumentSourceEdit,
  CriticMarkupKind,
  DocumentResolutionDecision,
  MarkdownOptions
} from '@marktext/document-core'

import type { MuyaPlainTextViewResult } from './muyaPlainTextView'

export type CoreHistoryEntry = Readonly<{
  readonly undo: readonly DocumentSourceEdit[]
  readonly redo: readonly DocumentSourceEdit[]
}>

export type CoreHistorySnapshot = Readonly<{
  readonly undo: readonly CoreHistoryEntry[]
  readonly redo: readonly CoreHistoryEntry[]
}>

export type CoreReviewDecision = DocumentResolutionDecision | 'remove'
export type CoreAuthorForm = 'comment' | 'substitution'

export type CoreReviewItemLocator = Readonly<{
  readonly kind: CriticMarkupKind
  readonly range: Readonly<{ readonly start: number; readonly end: number }>
}> | Readonly<{
  readonly kind: 'commented-span'
  readonly range: Readonly<{ readonly start: number; readonly end: number }>
  readonly highlightRange: Readonly<{ readonly start: number; readonly end: number }>
  readonly commentRange: Readonly<{ readonly start: number; readonly end: number }>
}>

export type CoreRequest =
  | Readonly<{
    readonly type: 'open'
    readonly session: number
    readonly sequence: number
    readonly source: string
    readonly options?: Readonly<Partial<MarkdownOptions>>
    readonly recoveryHistory?: CoreHistorySnapshot
  }>
  | Readonly<{
    readonly type: 'apply'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly edits: readonly DocumentSourceEdit[]
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly type: 'source-at-barrier'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
  }>
  | Readonly<{
    readonly type: 'plain-text-view-at-barrier'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
  }>
  | Readonly<{
    readonly type: 'review-item-at-barrier'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly direction: 'next' | 'previous'
    readonly from: number
  }>
  | Readonly<{
    readonly type: 'undo' | 'redo'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly type: 'resolve'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly annotation: CoreReviewItemLocator
    readonly decision: CoreReviewDecision
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly type: 'author'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly form: CoreAuthorForm
    readonly range: Readonly<{ readonly start: number; readonly end: number }>
    readonly text: string
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly type: 'track'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly range: Readonly<{ readonly start: number; readonly end: number }>
    readonly text: string
    readonly projections: readonly DocumentProjectionRequest[]
  }>

export type CoreOpenedReply = Readonly<{
  readonly type: 'opened'
  readonly session: number
  readonly sequence: number
  readonly revision: number
  readonly accepted: true
  readonly sourceLength: number
  readonly diagnosticCount: number
  readonly diagnostics: readonly DocumentDiagnostic[]
}>
export type CoreAppliedReply = Readonly<{
  readonly type: 'applied'
  readonly session: number
  readonly sequence: number
  readonly revision: number
  readonly accepted: true
  readonly sourceLength: number
  readonly diagnosticCount: number
  readonly diagnostics: readonly DocumentDiagnostic[]
  readonly change: DocumentChange
}>
export type CoreRejectedReply = Readonly<{
  readonly type: 'rejected'
  readonly session: number
  readonly sequence: number
  readonly revision: number
  readonly accepted: false
  readonly reason:
    | 'stale-base'
    | 'invalid-edit'
    | 'no-change'
    | 'history-empty'
    | 'history-resource'
    | 'recovery-history-invalid'
    | 'annotation-not-found'
    | 'resolution-invalid'
    | 'author-invalid'
  readonly sourceLength: number
}>
export type CoreResourceReply = Readonly<{
  readonly type: 'resource'
  readonly session: number
  readonly sequence: number
  readonly revision: number
  readonly accepted: false
  readonly sourceLength: number
  readonly resource: Readonly<{
    readonly code: DocumentCoreErrorCode
    readonly range: Readonly<{ readonly start: number; readonly end: number }>
    readonly metadata: Readonly<Record<string, string>>
  }>
}>
export type CoreSourceReply = Readonly<{
  readonly type: 'source'
  readonly session: number
  readonly sequence: number
  readonly revision: number
  readonly accepted: true
  readonly sourceLength: number
  readonly source: string
  readonly recoveryHistory: CoreHistorySnapshot
}>
export type CorePlainTextViewReply = Readonly<{
  readonly type: 'plain-text-view'
  readonly session: number
  readonly sequence: number
  readonly revision: number
  readonly accepted: true
  readonly sourceLength: number
  readonly source: string
  readonly view: MuyaPlainTextViewResult
}>
export type CoreReviewItemReply = Readonly<{
  readonly type: 'review-item'
  readonly session: number
  readonly sequence: number
  readonly revision: number
  readonly accepted: true
  readonly sourceLength: number
  readonly item: CoreReviewItemLocator | null
}>
export type CoreReply =
  | CoreOpenedReply
  | CoreAppliedReply
  | CoreRejectedReply
  | CoreResourceReply
  | CoreSourceReply
  | CorePlainTextViewReply
  | CoreReviewItemReply

export interface CoreActorPort {
  request(request: CoreRequest): Promise<CoreReply>
  dispose(): void
}

export interface CoreWorkerRequestEnvelope {
  readonly type: 'core-request'
  readonly request: CoreRequest
}

export type CoreWorkerResponseEnvelope =
  | Readonly<{
    readonly type: 'core-result'
    readonly reply: CoreReply
  }>
  | Readonly<{
    readonly type: 'core-failure'
    readonly session: number
    readonly sequence: number
    readonly message: string
  }>
