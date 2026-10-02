import type {
  DocumentAuthorForm,
  DocumentTableSelection,
  SourceRange,
  DocumentSelection,
  DocumentTextSelection,
  DocumentModelTextSelection,
  DocumentSourceInputAction,
  DocumentSourceSyntaxSpan,
  DocumentChange,
  DocumentInputAction,
  DocumentInputSelection,
  DocumentClipboardSelection,
  DocumentClipboardPasteAction,
  DocumentFormatAction,
  DocumentClipboardAction,
  DocumentInputResult,
  DocumentCoreErrorCode,
  DocumentDiagnostic,
  DocumentProjectionRequest,
  DocumentSourceEdit,
  CriticMarkupKind,
  DocumentResolutionDecision,
  MarkdownAst,
  MarkupCoordinateSegment,
  MarkdownOptions,
  MarkdownProjectionName
} from '@marktext/document-core'
import type { MarkupPassage } from '../documentConsumers/markupPassage'
import type { CoreConsumerSummary } from './coreConsumerSummary'
import type { MuyaMarkupView } from './muyaMarkupView'

export type CoreHistoryEntry = Readonly<{
  readonly undo: readonly DocumentSourceEdit[]
  readonly redo: readonly DocumentSourceEdit[]
  /** Canonical transaction selection; absent only for unmigrated authoring commands. */
  readonly beforeSelection?: DocumentSelection
  readonly afterSelection?: DocumentSelection
}>

export type CoreHistorySnapshot = Readonly<{
  readonly undo: readonly CoreHistoryEntry[]
  readonly redo: readonly CoreHistoryEntry[]
  /** Continues the last undo entry when replay crosses a mid-typing checkpoint. */
  readonly nativeHistoryGroup?: string
}>

export type CoreReviewDecision = DocumentResolutionDecision | 'remove'
export type CoreAuthorForm = DocumentAuthorForm

export type CoreConsumerSearchMatch = Readonly<{
  readonly path: readonly number[]
  readonly start: number
  readonly end: number
  readonly match: string
}>

export type CoreConsumerSearchReplacement = Readonly<{
  readonly match: CoreConsumerSearchMatch
  readonly insert: string
}>

export type CoreReviewItemLocator =
  | Readonly<{
    readonly kind: CriticMarkupKind
    readonly range: Readonly<{ readonly start: number; readonly end: number }>
  }>
  | Readonly<{
    readonly kind: 'commented-span'
    readonly range: Readonly<{ readonly start: number; readonly end: number }>
    readonly highlightRange: Readonly<{ readonly start: number; readonly end: number }>
    readonly commentRange: Readonly<{ readonly start: number; readonly end: number }>
  }>

export type CorePreparedOperation =
  | Readonly<{
    kind: 'clipboard'
    action:
        | Omit<Extract<DocumentClipboardPasteAction, { kind: 'paste' }>, 'selection'>
        | Omit<Extract<DocumentClipboardPasteAction, { kind: 'table' }>, 'selection'>
  }>
  | Readonly<{
    kind: 'format'
    action: Omit<Extract<DocumentFormatAction, { format: 'image-properties' }>, 'selection'>
  }>

export type CoreRetainedSelectionReply = Readonly<{
  type: 'retained-selection'
  session: number
  sequence: number
  revision: number
  accepted: true
  sourceLength: number
  id: string
  selection: DocumentClipboardSelection
  selectionRevision: number
  status: 'ready' | 'conflict'
}>

export type CoreReleasedSelectionReply = Readonly<{
  type: 'selection-released'
  session: number
  sequence: number
  revision: number
  accepted: true
  sourceLength: number
  id: string
}>

export type CoreRequest =
  | Readonly<{
    type: 'retain-selection'
    selection: DocumentClipboardSelection
    session: number
    sequence: number
    baseRevision: number
  }>
  | Readonly<{
    type: 'read-retained-selection'
    id: string
    session: number
    sequence: number
    baseRevision: number
  }>
  | Readonly<{
    type: 'release-selection'
    id: string
    session: number
    sequence: number
    baseRevision: number
  }>
  | Readonly<{
    type: 'apply-prepared'
    target: string
    operation: CorePreparedOperation
    nativeHistoryGroup?: string
    session: number
    sequence: number
    baseRevision: number
    projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly type: 'clipboard'
    readonly action: DocumentClipboardAction
    readonly nativeHistoryGroup?: string
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly type: 'format'
    readonly action: DocumentFormatAction
    readonly nativeHistoryGroup?: string
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly type: 'source-input'
    readonly action: DocumentSourceInputAction
    readonly nativeHistoryGroup?: string
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly type: 'input'
    readonly action: DocumentInputAction
    readonly tracked: boolean
    readonly nativeHistoryGroup?: string
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly type: 'configure'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly options: Readonly<Partial<MarkdownOptions>>
    readonly projections: readonly DocumentProjectionRequest[]
  }>
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
    readonly nativeHistoryGroup?: string
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
    readonly type: 'source-selection-at-barrier'
    readonly selection: DocumentSelection
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
  }>
  | Readonly<{
    readonly type: 'source-syntax-at-barrier'
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
    readonly type: 'display-projection-at-barrier'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly name: MarkdownProjectionName
  }>
  | Readonly<{
    readonly type: 'consumer-projection-at-barrier'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
  }>
  | Readonly<{
    readonly type: 'consumer-summary-at-barrier'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
  }>
  | Readonly<{
    readonly type: 'selection-projection-at-barrier'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly range: SourceRange | DocumentTableSelection | DocumentModelTextSelection
  }>
  | Readonly<{
    readonly type: 'author-forms-at-barrier'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly range: SourceRange
  }>
  | Readonly<{
    readonly type: 'replace-consumer-search'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly replacements: readonly CoreConsumerSearchReplacement[]
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly type: 'review-item-at-barrier'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly direction: 'next' | 'previous'
    readonly from: number
    readonly includeOverview?: boolean
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
    /** The selection when the command ran, which its undo restores. */
    readonly selection?: DocumentSelection
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly type: 'resolve-all'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly decision: DocumentResolutionDecision
    /** The selection when the command ran, which its undo restores. */
    readonly selection?: DocumentSelection
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
    readonly type: 'edit-comment'
    readonly session: number
    readonly sequence: number
    readonly baseRevision: number
    readonly annotation: CoreReviewItemLocator
    readonly text: string
    /** The selection when the command ran, which its undo restores. */
    readonly selection?: DocumentSelection
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
  /** A native input action may be accepted at the same revision when it only moves the selection. */
  readonly sourceInputResult?: Readonly<{ selection: DocumentSelection }>
  readonly historyResult?: Readonly<{ selection: DocumentSelection }>
  readonly inputResult?: DocumentInputResult
  readonly preparedSelection?: DocumentClipboardSelection
  readonly clipboardResult?: Readonly<{ selection: DocumentSelection }>
  readonly authorResult?: Readonly<{
    selection: Readonly<{ start: number; end: number }>
    /** The authored spelling adds MarkText-only backslash escapes (ADR 0015). */
    escaped?: boolean
  }>
  readonly formatResult?: Readonly<{ selection: DocumentInputSelection }>
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
    | 'consumer-search-match-invalid'
    | 'prepared-selection-unavailable'
    | 'prepared-selection-conflict'
    | 'prepared-selection-limit'
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
export type CoreSourceSelectionReply = Readonly<{
  readonly type: 'source-selection'
  readonly session: number
  readonly sequence: number
  readonly revision: number
  readonly accepted: true
  readonly sourceLength: number
  readonly selection: DocumentTextSelection
}>
export type CoreSourceSyntaxReply = Readonly<{
  readonly type: 'source-syntax'
  readonly session: number
  readonly sequence: number
  readonly revision: number
  readonly accepted: true
  readonly sourceLength: number
  readonly spans: readonly DocumentSourceSyntaxSpan[]
}>
export type CorePlainTextViewReply = Readonly<{
  readonly type: 'plain-text-view'
  readonly session: number
  readonly sequence: number
  readonly revision: number
  readonly accepted: true
  readonly sourceLength: number
  readonly source: string
  readonly view: MuyaMarkupView
}>
export type CoreConsumerProjection = Readonly<{
  readonly kind: 'markdown-consumer-projection'
  readonly name: 'revised'
  readonly markdown: string
  readonly ast: MarkdownAst
  readonly sourceSegments?: readonly MarkupCoordinateSegment[]
}>
export type CoreDisplayProjection = Readonly<{
  readonly name: MarkdownProjectionName
  readonly ast: MarkdownAst
}>
export type CoreDisplayProjectionReply = Readonly<{
  readonly type: 'display-projection'
  readonly session: number
  readonly sequence: number
  readonly revision: number
  readonly accepted: true
  readonly sourceLength: number
  readonly projection: CoreDisplayProjection
}>
export type CoreConsumerProjectionReply = Readonly<{
  readonly type: 'consumer-projection'
  readonly session: number
  readonly sequence: number
  readonly revision: number
  readonly accepted: true
  readonly sourceLength: number
  readonly projection: CoreConsumerProjection
}>
/** The Revised text and headings counts and the outline read, without the rest of the projection. */
export type CoreConsumerSummaryReply = Readonly<{
  readonly type: 'consumer-summary'
  readonly session: number
  readonly sequence: number
  readonly revision: number
  readonly accepted: true
  readonly sourceLength: number
  readonly summary: CoreConsumerSummary
}>
/** Review forms Core would author over a source range, without changing it. */
export type CoreAuthorFormsReply = Readonly<{
  readonly type: 'author-forms'
  readonly session: number
  readonly sequence: number
  readonly revision: number
  readonly accepted: true
  readonly sourceLength: number
  readonly forms: readonly CoreAuthorForm[]
}>
export type CoreSelectionProjectionReply = Readonly<{
  readonly type: 'selection-projection'
  readonly session: number
  readonly sequence: number
  readonly revision: number
  readonly accepted: true
  readonly sourceLength: number
  readonly projection: CoreConsumerProjection
}>
export type CoreReviewOverviewEntry = Readonly<{
  /** The passage a suggestion or highlight holds; the old text of a Substitution. */
  readonly excerpt?: MarkupPassage
  readonly replacementExcerpt?: MarkupPassage
  readonly item: CoreReviewItemLocator
  /** The Comment payload exactly as written, for its editor. */
  readonly commentText?: string
  /** The Comment payload in its Markup reading. */
  readonly commentProjection?: MarkupPassage
}>
export type CoreReviewItemReply = Readonly<{
  readonly type: 'review-item'
  readonly session: number
  readonly sequence: number
  readonly revision: number
  readonly accepted: true
  readonly sourceLength: number
  readonly item: CoreReviewItemLocator | null
  readonly overview?: readonly CoreReviewOverviewEntry[]
  readonly commentText?: string
  readonly commentProjection?: Readonly<{
    readonly ast: MarkdownAst
    readonly marks?: MarkupPassage['marks']
  }>
}>
export type CoreReply =
  | CoreRetainedSelectionReply
  | CoreReleasedSelectionReply
  | CoreOpenedReply
  | CoreAppliedReply
  | CoreRejectedReply
  | CoreResourceReply
  | CoreSourceReply
  | CoreSourceSyntaxReply
  | CoreSourceSelectionReply
  | CorePlainTextViewReply
  | CoreDisplayProjectionReply
  | CoreConsumerProjectionReply
  | CoreConsumerSummaryReply
  | CoreSelectionProjectionReply
  | CoreAuthorFormsReply
  | CoreReviewItemReply

/** The one live document model, synchronously consulted before native presentation. */
export interface CoreModelOwner {
  request(request: CoreRequest): CoreReply
  dispose(): void
}
