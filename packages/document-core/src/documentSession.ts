import type {
  MarkdownDocument,
  MarkupMark,
  MarkdownOptionsV1,
  NodeId,
  ParseConfiguration,
  ResourceDiagnostic,
  SourceRange
} from './revision.js'
import type { DocumentFacts } from './materialize/documentFacts.js'
import type {
  RevisionSemanticHashV1,
  SourceHashV1
} from './hashCodec.js'
import type { MarkupCoordinateMapV1 } from './markupCoordinateMap.js'
import type {
  CriticMarkupAuthoringCapabilities,
  CriticMarkupAuthoringInput,
  TransformationIntent,
  TransformationRejectionReason
} from './transformationKernel.js'
import type { SourceSnapshot } from './sourceSnapshot.js'
import type { ParseExecutionControl } from './parseExecutionControl.js'
import type {
  Profile1PhysicalTraversalCountsV1
} from './internal/profile1/physicalTraversalAccounting.js'
import type { DocumentSearchQuery } from './search.js'
import type {
  ClipboardConsumerRequest,
  ClipboardConsumerResult,
  StaticConsumer,
  StaticConsumerRequest,
  StaticConsumerResult
} from './materialize/consumerPolicy.js'
import {
  createSessionCoordinator,
  recoverSessionCoordinator
} from './internal/session/sessionCoordinator.js'

declare const opaqueIdBrand: unique symbol

type OpaqueId<Name extends string> = string & {
  readonly [opaqueIdBrand]: Name
}

export type RevisionId = OpaqueId<'RevisionId'>
export type SessionId = OpaqueId<'SessionId'>
export type EditorSnapshotId = OpaqueId<'EditorSnapshotId'>
export type IntentId = OpaqueId<'IntentId'>
export type SessionOperationId = OpaqueId<'SessionOperationId'>
export type SessionTransitionId = OpaqueId<'SessionTransitionId'>
export type SourceLeaseId = OpaqueId<'SourceLeaseId'>
export type DraftId = OpaqueId<'DraftId'>
export type LiveRenderPlanId = OpaqueId<'LiveRenderPlanId'>
export type SessionEffectId = OpaqueId<'SessionEffectId'>

export interface ModelPosition {
  /** UTF-16 code-unit offset in the named revision and view. */
  readonly offset: number
  readonly affinity: 'previous' | 'next'
}

interface ModelSelectionBase {
  readonly session: SessionId
  readonly revision: RevisionId
  readonly anchor: ModelPosition
  readonly focus: ModelPosition
}

export interface MarkupModelSelection extends ModelSelectionBase {
  readonly view: 'markup'
}

export interface SourceModelSelection extends ModelSelectionBase {
  readonly view: 'source'
}

export type ModelSelection = MarkupModelSelection | SourceModelSelection

export interface InitialModelSelection {
  readonly anchor: ModelPosition
  readonly focus: ModelPosition
}

export interface SessionConfiguration {
  readonly authoringTextPolicy: 'nearest-owner-eol-v1'
  readonly trackChanges: boolean
}

export interface SessionOpenConfiguration {
  readonly authoringTextPolicy: 'nearest-owner-eol-v1'
}

export interface DocumentSessionJournalContent {
  readonly id: string
  readonly data: string
}

export interface DocumentSessionJournalValue {
  readonly revision: number
  readonly data: string
  readonly contents: readonly DocumentSessionJournalContent[]
}

export interface DocumentSessionJournalMutation {
  readonly data: string
  /** New immutable artifacts. Existing ids must name identical data. */
  readonly contents: readonly DocumentSessionJournalContent[]
  /** Complete artifact reachability set for the next manifest revision. */
  readonly retainedContentIds: readonly string[]
}

export interface DocumentSessionJournalCommit {
  readonly revision: number
}

/**
 * Atomic persistence seam for the session journal.
 *
 * A production host can back this with a main-process file/database. The
 * bundled memory implementation is intentionally only a coordinator-restart
 * test double: retaining the storage object retains its values.
 */
export interface DocumentSessionJournalStorage {
  readonly read: (key: string) => Promise<DocumentSessionJournalValue | null>
  readonly compareExchange: (
    key: string,
    expectedRevision: number | null,
    mutation: DocumentSessionJournalMutation
  ) => Promise<DocumentSessionJournalCommit | null>
}

export interface DocumentSessionDurability {
  readonly key: string
  readonly storage: DocumentSessionJournalStorage
}

export interface DocumentSessionOpenOptions {
  readonly source: SourceSnapshot
  readonly parseConfiguration: ParseConfiguration
  /**
   * Stable, globally unique namespace for every capability minted by this
   * document session. Production hosts bind this to their main-owned document
   * identity; direct callers may omit it and receive a Web Crypto UUID.
   */
  readonly identityNamespace?: string
  // Every field below has exactly one legal value today and defaults to it;
  // hosts state only what genuinely varies. New values are session-version
  // decisions, not host extension points.
  readonly configuration?: SessionOpenConfiguration
  readonly initialView?: 'markup'
  readonly trackChanges?: boolean
  readonly initialSelection?: InitialModelSelection
  readonly durability?: DocumentSessionDurability
  readonly executionControl?: ParseExecutionControl
}

export interface DocumentSessionRecoveryOptions {
  readonly durability: DocumentSessionDurability
  readonly executionControl?: ParseExecutionControl
}

interface RevisionDescriptorBase {
  readonly session: SessionId
  readonly id: RevisionId
  readonly configuration: ParseConfiguration
  readonly sourceLength: number
  /**
   * The revision's exact canonical source.
   *
   * Read it for questions the editor asks synchronously — is this tab dirty,
   * what should history record — because the answer is already in the revision
   * this descriptor names. Persistence keeps the lease: saving needs a settled,
   * consistent read, which is what `flush` and `preparePersistence` provide.
   */
  readonly source: string
  readonly sourceHash: SourceHashV1
  readonly semanticHash: RevisionSemanticHashV1
}

export interface CompleteRevisionDescriptor extends RevisionDescriptorBase {
  readonly kind: 'complete'
  readonly diagnostics: { readonly count: number }
  readonly selection: MarkupModelSelection | null
}

export interface SourceOnlyRevisionDescriptor extends RevisionDescriptorBase {
  readonly kind: 'source-only'
  readonly fatalDiagnostic: ResourceDiagnostic
  readonly selection: SourceModelSelection | null
}

export type RevisionDescriptor =
  | CompleteRevisionDescriptor
  | SourceOnlyRevisionDescriptor

interface EditorSnapshotBase {
  readonly id: EditorSnapshotId
  readonly configuration: SessionConfiguration
  readonly pending: PendingSessionState
  /** Parser-owned semantic metadata for this exact retained revision. */
  readonly facts: DocumentFacts
  /**
   * The authoritative canonical-source selection for this publication.
   *
   * Complete revisions retain this alongside their Markup selection so a raw
   * source surface never has to infer marker positions from the rendered
   * projection. SourceOnly revisions publish the same selection here and on
   * their revision descriptor.
   */
  readonly sourceSelection: SourceModelSelection
}

export interface CompleteEditorSnapshot extends EditorSnapshotBase {
  readonly kind: 'complete'
  readonly revision: CompleteRevisionDescriptor
  readonly view: 'markup'
  readonly projection: CriticMarkupProjection
  /** Stable editable Markup plan retained for exact focus handback. */
  readonly livePlan: MarkupLiveRenderPlan
  /** The currently mounted Markup or read-only clean plan. */
  readonly displayPlan: DocumentLiveRenderPlan
  /**
   * Serializable Review data derived from this exact retained revision.
   *
   * Hosts may transport it directly; a renderer never reparses canonical
   * source to rediscover CriticMarkup nodes, nesting, or Comment pairing.
   */
  readonly reviewIndex: ReviewIndex
  /**
   * The block AST of the revision's editing view — what a WYSIWYG view mounts.
   * Served here so a view never re-parses to learn its own structure: doing that
   * would re-parse the whole document per keystroke and make the view a second
   * authority on what the document says (ADR-0009, ADR-0013). Its `source` is
   * the same text `livePlan` renders, so block ranges and run offsets share one
   * coordinate space.
   */
  readonly editingDocument: MarkdownDocument
  /** Markdown block tree in the active display projection. */
  readonly displayDocument: MarkdownDocument
}

export interface SourceOnlyEditorSnapshot extends EditorSnapshotBase {
  readonly kind: 'source-only'
  readonly revision: SourceOnlyRevisionDescriptor
  readonly view: 'source'
}

export type EditorSnapshot = CompleteEditorSnapshot | SourceOnlyEditorSnapshot

export interface DocumentHistoryState {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly dirty: boolean
  readonly headIdentity: string
  readonly savedIdentity: string
}

export type CriticMarkupProjection = 'marked' | 'original' | 'revised'

export interface ModelRange {
  readonly start: number
  readonly end: number
}

export interface ReviewIndexItem {
  readonly nodeId: NodeId
  readonly kind:
    | 'addition'
    | 'deletion'
    | 'substitution'
    | 'highlight'
    | 'comment'
  readonly sourceRange: SourceRange
  readonly modelRange: ModelRange | null
  /**
   * Deterministic Markup handoff for explicit Review focus.
   *
   * Visible items use their model-range start. Invisible items (notably point
   * Comments) use the nearest parser-owned visible boundary, preferring the
   * preceding boundary on a tie.
   */
  readonly focusOffset: number
  readonly depth: number
  readonly parent: NodeId | null
  /**
   * True when an ancestor arm is a Comment payload. Such an item is quoted
   * reviewer prose, not an actionable annotation: every resolution, removal,
   * and edit gesture targeting it rejects with `comment-payload-target`, and
   * a Review surface must not arm those gestures on its card.
   */
  readonly withinCommentPayload: boolean
  /**
   * Exact canonical extent of the payload between the annotation's markers —
   * parser-owned, so no consumer reconstructs it by delimiter arithmetic.
   * Slicing canonical source with it yields the text a payload editor must
   * round-trip byte-identically; for a substitution that text includes the
   * `~>` divider. A range rather than a copy: eagerly materializing every
   * payload is O(depth × size) on nested annotations.
   */
  readonly payloadRange: SourceRange
  readonly commentRevisedText: string | null
  readonly oldContent: string | null
  readonly newContent: string | null
}

export interface ReviewCommentedSpan {
  readonly highlight: NodeId
  readonly comment: NodeId
  readonly sourceRange: SourceRange
  readonly modelRange: ModelRange
}

export interface ReviewIndex {
  readonly authoring: CriticMarkupAuthoringCapabilities
  readonly items: readonly ReviewIndexItem[]
  readonly commentedSpans: readonly ReviewCommentedSpan[]
}

export interface LiveRenderRun {
  readonly key: string
  readonly marks: readonly MarkupMark[]
  readonly text: string
  readonly modelRange: ModelRange
  readonly sourceRange: SourceRange
}

export interface MarkupLiveRenderPlan {
  readonly id: LiveRenderPlanId
  readonly revision: RevisionId
  readonly view: 'markup'
  readonly editable: true
  readonly modelLength: number
  readonly runs: readonly LiveRenderRun[]
  /** Closed parser-created topology for model/source coordinate queries. */
  readonly coordinateMap: MarkupCoordinateMapV1
  /** Map an editable Markup position to its canonical-source owner. */
  readonly sourcePositionAt: (position: ModelPosition) => ModelPosition
  /**
   * Map a canonical-source position to visible Markup, or null when the
   * position is inside hidden syntax rather than a rendered source run.
   */
  readonly modelPositionAt: (position: ModelPosition) => ModelPosition | null
  readonly selectionAt: (selection: InitialModelSelection) => MarkupModelSelection
}

export interface ReadOnlyLiveRenderPlan {
  readonly id: LiveRenderPlanId
  readonly revision: RevisionId
  readonly view: 'original' | 'revised'
  readonly editable: false
  readonly modelLength: number
  readonly runs: readonly LiveRenderRun[]
}

export type DocumentLiveRenderPlan =
  | MarkupLiveRenderPlan
  | ReadOnlyLiveRenderPlan

export interface InsertTextIntent {
  readonly kind: 'insert-text'
  readonly target: ModelSelection
  readonly text: string
}

export interface UndoIntent {
  readonly kind: 'undo'
}

export interface RedoIntent {
  readonly kind: 'redo'
}

/**
 * Remove the text a selection covers.
 *
 * The other half of editing: without it there is no backspace, no Delete key
 * and no typing over a selection. The target must be a range — a collapsed one
 * removes nothing, and is rejected rather than quietly committing a revision
 * that changes the document not at all.
 */
export interface DeleteTextIntent {
  readonly kind: 'delete-text'
  readonly target: ModelSelection
}

/**
 * Replace the text a selection covers.
 *
 * Typing over a selection is one gesture, so it is one revision and one undo.
 * This is a single edit rather than a delete composed with an insert: the
 * revision kernel already describes an edit as a range plus replacement text.
 * A collapsed target simply inserts.
 */
export interface ReplaceTextIntent {
  readonly kind: 'replace-text'
  readonly target: ModelSelection
  readonly text: string
}

/**
 * Replace every current visible-text match as one authenticated gesture.
 *
 * Callers provide the query, not match offsets. The session recomputes ranges
 * from the revision named by `target`, preventing stale or forged renderer
 * ranges from becoming source edits. Every resulting source edit is committed
 * in one revision and one history entry.
 */
export interface ReplaceCurrentMatchesIntent {
  readonly kind: 'replace-current-matches'
  readonly target: ModelSelection
  readonly query: DocumentSearchQuery
  readonly replacement: string
}

/**
 * Apply a source-backed inline format to one complete semantic target.
 *
 * Formatting is not text replacement: under Track Changes the original
 * content remains in place while the newly introduced delimiters are tracked
 * as additions. Both delimiters still form one atomic history entry.
 */
export type InlineFormat =
  | 'strong'
  | 'emphasis'
  | 'underline'
  | 'superscript'
  | 'subscript'
  | 'highlight'
  | 'inline-code'
  | 'inline-math'
  | 'strikethrough'
  | 'link'
  | 'image'
  | 'clear'

export interface FormatTextIntent {
  readonly kind: 'format-text'
  readonly target: ModelSelection
  readonly format: InlineFormat
}

/**
 * Replace one complete structural target with canonical replacement source.
 *
 * The caller names the already-serialized structural result; the session owns
 * how that source is recorded under Track Changes and validates the candidate
 * before publication.
 */
export interface ReplaceStructureIntent {
  readonly kind: 'replace-structure'
  readonly target: ModelSelection
  readonly replacement: string
}

export type BlockConversion =
  | Readonly<{ readonly kind: 'heading'; readonly level: 1 | 2 | 3 | 4 | 5 | 6 }>
  | Readonly<{ readonly kind: 'blockquote' }>
  | Readonly<{ readonly kind: 'paragraph' }>
  | Readonly<{
    readonly kind: 'heading-shift'
    readonly direction: 'promote' | 'demote'
  }>
  | Readonly<{ readonly kind: 'unordered-list' }>
  | Readonly<{ readonly kind: 'ordered-list' }>
  | Readonly<{ readonly kind: 'task-list' }>
  | Readonly<{ readonly kind: 'loose-list-item' }>
  | Readonly<{ readonly kind: 'code-block' }>
  | Readonly<{ readonly kind: 'math-block' }>
  | Readonly<{ readonly kind: 'html-block' }>
  | Readonly<{ readonly kind: 'thematic-break' }>
  | Readonly<{ readonly kind: 'front-matter' }>

export type DiagramFenceLanguage =
  | 'vega-lite'
  | 'mermaid'
  | 'plantuml'
  | 'flowchart'
  | 'sequence'

export type QuickInsertConversion = Exclude<
  BlockConversion,
  | Readonly<{ readonly kind: 'heading-shift' }>
  | Readonly<{ readonly kind: 'loose-list-item' }>
>

export type QuickInsertBlock =
  | Readonly<{
    readonly kind: 'conversion'
    readonly conversion: QuickInsertConversion
  }>
  | Readonly<{
    readonly kind: 'diagram'
    readonly language: DiagramFenceLanguage
  }>
  | Readonly<{
    readonly kind: 'table'
    readonly rows: number
    readonly columns: number
  }>

/**
 * Convert every complete top-level block named by one authenticated Markup
 * selection.
 *
 * The intent names document semantics only. The session resolves parser-owned
 * block boundaries and writes the canonical Markdown spelling atomically.
 */
export interface ConvertBlockIntent {
  readonly kind: 'convert-block'
  readonly target: ModelSelection
  readonly conversion: BlockConversion
}

/**
 * Replace one parser-owned paragraph containing a slash query with the chosen
 * block. The session verifies and removes the query; the view never writes
 * Markdown syntax or composes multiple mutation intents for one selection.
 */
export interface QuickInsertBlockIntent {
  readonly kind: 'quick-insert-block'
  readonly target: ModelSelection
  readonly block: QuickInsertBlock
}

/**
 * Duplicate every complete top-level block named by one authenticated Markup
 * selection.
 *
 * The session resolves the parser-owned block source and chooses the document's
 * existing line-ending spelling. The caller never serializes a block or edits
 * source offsets itself.
 */
export interface DuplicateBlockIntent {
  readonly kind: 'duplicate-block'
  readonly target: ModelSelection
}

/** Delete the parser-owned block at the authenticated selection. */
export interface DeleteBlockIntent {
  readonly kind: 'delete-block'
  readonly target: ModelSelection
}

/** Insert one blank Markdown paragraph adjacent to the selected block. */
export interface InsertParagraphIntent {
  readonly kind: 'insert-paragraph'
  readonly target: ModelSelection
  readonly location: 'before' | 'after'
}

/** Insert one semantic paragraph boundary using the source owner's EOL. */
export interface InsertParagraphBreakIntent {
  readonly kind: 'insert-paragraph-break'
  readonly target: ModelSelection
}

/** Insert one semantic line boundary using the source owner's EOL. */
export interface InsertLineBreakIntent {
  readonly kind: 'insert-line-break'
  readonly target: ModelSelection
}

/** Change indentation of the parser-owned list item at the selection. */
export interface SetListIndentationIntent {
  readonly kind: 'set-list-indentation'
  readonly target: ModelSelection
  readonly direction: 'increase' | 'decrease'
}

/**
 * Set the parser-owned checked state of one GFM task-list item.
 *
 * `cascade` is an explicit user preference captured with the gesture. The
 * session resolves the authenticated target, descendant tasks, ancestor state,
 * and exact marker edits from the current parser tree.
 */
export interface SetTaskCheckedIntent {
  readonly kind: 'set-task-checked'
  readonly target: ModelSelection
  readonly checked: boolean
  readonly cascade: boolean
}

/** Set or clear the info string of the selected parser-owned fenced block. */
export interface SetCodeLanguageIntent {
  readonly kind: 'set-code-language'
  readonly target: ModelSelection
  readonly language: string
}

/** Wrap the selected semantic text in one destination-bearing Markdown link. */
export interface InsertLinkIntent {
  readonly kind: 'insert-link'
  readonly target: ModelSelection
  readonly href: string
  readonly title?: string
}

/** Insert one Markdown image serialized from semantic fields. */
export interface InsertImageIntent {
  readonly kind: 'insert-image'
  readonly target: ModelSelection
  readonly src: string
  readonly alt: string
  readonly title?: string
}

/** Insert one footnote reference and its definition atomically. */
export interface InsertFootnoteIntent {
  readonly kind: 'insert-footnote'
  readonly target: ModelSelection
  readonly label: string
  readonly content: string
}

/** Create one canonical GFM table at the authenticated block position. */
export interface CreateTableIntent {
  readonly kind: 'create-table'
  readonly target: ModelSelection
  /** Total rendered rows, including the header row. */
  readonly rows: number
  readonly columns: number
}

/** Insert one blank row adjacent to the authenticated row in a GFM table. */
export interface InsertTableRowIntent {
  readonly kind: 'insert-table-row'
  readonly target: ModelSelection
  readonly location: 'before' | 'after'
}

/** Remove the authenticated row from its parser-owned GFM table. */
export interface RemoveTableRowIntent {
  readonly kind: 'remove-table-row'
  readonly target: ModelSelection
}

/** Insert one blank column adjacent to the authenticated table cell. */
export interface InsertTableColumnIntent {
  readonly kind: 'insert-table-column'
  readonly target: ModelSelection
  readonly location: 'left' | 'right'
}

/** Remove the authenticated column from every row in its GFM table. */
export interface RemoveTableColumnIntent {
  readonly kind: 'remove-table-column'
  readonly target: ModelSelection
}

export type TableColumnAlignment = 'none' | 'left' | 'center' | 'right'

/** Set the parser-owned GFM alignment for the authenticated table column. */
export interface AlignTableColumnIntent {
  readonly kind: 'align-table-column'
  readonly target: ModelSelection
  readonly alignment: TableColumnAlignment
}

/** Move the authenticated row one structural position in its GFM table. */
export interface MoveTableRowIntent {
  readonly kind: 'move-table-row'
  readonly target: ModelSelection
  readonly direction: 'up' | 'down'
}

/** Move the authenticated column one structural position in its GFM table. */
export interface MoveTableColumnIntent {
  readonly kind: 'move-table-column'
  readonly target: ModelSelection
  readonly direction: 'left' | 'right'
}

/**
 * Clear every cell in the parser-owned rectangle whose opposite corners are
 * named by the authenticated Markup selection.
 */
export interface DeleteTableCellContentsIntent {
  readonly kind: 'delete-table-cell-contents'
  readonly target: ModelSelection
}

/**
 * The wire-safe paste payload flavors. How each flavor lands — raw syntax
 * import, semantic text edit, or source edit — is the consumer policy's
 * question (`classifyPasteConsumer`), not the dispatcher's: a caller
 * declares what its clipboard held, never how the engine should treat it.
 * The policy's `safe-html` flavor is absent here because its TrustedHtml
 * brand cannot cross an intent codec.
 */
export type PasteTextPayload =
  | Readonly<{ readonly kind: 'private-source'; readonly text: string }>
  | Readonly<{ readonly kind: 'markdown'; readonly text: string }>
  | Readonly<{ readonly kind: 'external-text'; readonly text: string }>

export interface PasteTextIntent {
  readonly kind: 'paste-text'
  readonly target: ModelSelection
  readonly payload: PasteTextPayload
}

/**
 * Commit one completed IME composition as one gesture and one undo entry.
 */
export interface CommitCompositionIntent {
  readonly kind: 'commit-composition'
  readonly target: ModelSelection
  readonly text: string
}

/**
 * Author one CriticMarkup form around the authenticated Markup selection.
 *
 * The session maps model positions to canonical source and owns delimiter
 * serialization. Renderers name semantics only; they never infer source
 * offsets or synthesize CriticMarkup bytes.
 */
export interface AuthorCriticMarkupIntent {
  readonly kind: 'author-critic-markup'
  readonly target: MarkupModelSelection
  readonly input: CriticMarkupAuthoringInput
}

/**
 * Replace canonical source from one main-owned external-file snapshot.
 *
 * This intent is host-only. Renderer dispatch codecs must reject it: a
 * renderer edits source through authenticated ranges and can never supply a
 * whole-document replacement.
 */
export interface ReloadSourceFromFileIntent {
  readonly kind: 'reload-source-from-file'
  readonly source: string
}

/**
 * Apply one raw source-editor gesture to an authenticated canonical range.
 *
 * The target names the exact base revision and UTF-16 range being replaced.
 * `selection` is the canonical-source selection after that same gesture. The
 * session owns both the resulting bytes and cursor publication; a source
 * surface may optimistically display input, but it cannot publish either.
 */
export interface EditSourceIntent {
  readonly kind: 'edit-source'
  readonly target: SourceModelSelection
  readonly text: string
  readonly selection: InitialModelSelection
}

/**
 * Change the session's runtime Track Changes policy.
 *
 * This is durable session state. It commits no document revision and creates
 * no history entry, but it is still serialized through the same ingress and
 * transition protocol as every other editor intent.
 */
export interface SetTrackChangesIntent {
  readonly kind: 'set-track-changes'
  readonly enabled: boolean
}

export interface SetProjectionIntent {
  readonly kind: 'set-projection'
  readonly projection: CriticMarkupProjection
}

export type EditorIntent =
  | InsertTextIntent
  | DeleteTextIntent
  | ReplaceTextIntent
  | ReplaceCurrentMatchesIntent
  | FormatTextIntent
  | ReplaceStructureIntent
  | ConvertBlockIntent
  | QuickInsertBlockIntent
  | DuplicateBlockIntent
  | DeleteBlockIntent
  | InsertParagraphIntent
  | InsertParagraphBreakIntent
  | InsertLineBreakIntent
  | SetListIndentationIntent
  | SetTaskCheckedIntent
  | SetCodeLanguageIntent
  | InsertLinkIntent
  | InsertImageIntent
  | InsertFootnoteIntent
  | CreateTableIntent
  | InsertTableRowIntent
  | RemoveTableRowIntent
  | InsertTableColumnIntent
  | RemoveTableColumnIntent
  | AlignTableColumnIntent
  | MoveTableRowIntent
  | MoveTableColumnIntent
  | DeleteTableCellContentsIntent
  | PasteTextIntent
  | CommitCompositionIntent
  | AuthorCriticMarkupIntent
  | ReloadSourceFromFileIntent
  | EditSourceIntent
  | SetTrackChangesIntent
  | SetProjectionIntent
  | TransformationIntent
  | UndoIntent
  | RedoIntent

export type AdmissionResult = {
  readonly kind: 'admitted'
  readonly sequence: number
  readonly submittedAgainst: RevisionId
}

export interface RevisionTransitionDescriptor {
  readonly base: RevisionId
  readonly next: RevisionId
}

export interface RevisionSourceEdit {
  readonly start: number
  readonly end: number
  readonly insert: string
}

export interface RevisionChangedTransition {
  readonly kind: 'revision-changed'
  readonly id: SessionTransitionId
  readonly cause: 'source-edit' | 'undo' | 'redo'
  readonly history: 'record' | 'none'
  readonly edits: readonly RevisionSourceEdit[]
  readonly before: EditorSnapshot
  readonly after: EditorSnapshot
  readonly revision: RevisionTransitionDescriptor
  readonly effects: readonly []
}

export interface SessionStateChangedTransition {
  readonly kind: 'session-state-changed'
  readonly id: SessionTransitionId
  readonly coalescing: 'break' | 'preserve'
  readonly before: EditorSnapshot
  readonly after: EditorSnapshot
  readonly effects: readonly []
}

export type SessionTransition = RevisionChangedTransition | SessionStateChangedTransition

interface CommittedDispatchResult {
  readonly kind: 'committed'
  readonly transition: RevisionChangedTransition
}

interface StateChangedDispatchResult {
  readonly kind: 'state-changed'
  readonly transition: SessionStateChangedTransition
}

export type RejectionCode =
  | 'stale-selection'
  | 'selection-not-collapsed'
  /** A delete whose target covers nothing — it would change the document not at all. */
  | 'selection-collapsed'
  | 'nothing-to-undo'
  | 'nothing-to-redo'
  | 'no-source-change'
  | 'invalid-command-argument'
  | 'read-only-change-arm'
  | 'read-only-projection'
  | 'source-only-revision'
  | 'precommit-failed'
  | TransformationRejectionReason

export interface DispatchFailureEffect {
  readonly id: SessionEffectId
  readonly kind: 'dispatch-failure'
  readonly ticket: IntentId
  readonly code: 'precommit-failed'
  readonly status: 'pending' | 'acknowledged' | 'cancelled'
}

export type SessionEffect = DispatchFailureEffect

export interface PendingInputDraft {
  readonly id: DraftId
  readonly ticketIds: readonly IntentId[]
  readonly sequence: number
  readonly submittedAgainst: RevisionId
  readonly text: string
  readonly target: ModelSelection
  readonly reason: RejectionCode
  readonly status: 'blocked'
  readonly allowedActions: readonly ['retry', 'discard']
}

export interface PendingSessionState {
  readonly retained: readonly PendingInputDraft[]
  readonly status: 'idle' | 'blocked'
}

interface RejectedDispatchResult {
  readonly kind: 'rejected'
  readonly reason: RejectionCode
  readonly snapshot: EditorSnapshot
  readonly retainedDraft?: PendingInputDraft
  readonly effect?: SessionEffect
}

interface NoopDispatchResult {
  readonly kind: 'noop'
  readonly reason: 'empty-insertion'
  readonly snapshot: EditorSnapshot
}

interface CancelledDispatchResult {
  readonly kind: 'cancelled'
  readonly reason: 'cancelled'
  readonly snapshot: EditorSnapshot
}

export type DispatchResult =
  | CommittedDispatchResult
  | StateChangedDispatchResult
  | RejectedDispatchResult
  | NoopDispatchResult
  | CancelledDispatchResult

interface SessionTicketOutcomeBase {
  readonly ticket: IntentId
  readonly sequence: number
  readonly submittedAgainst: RevisionId
}

export interface CommittedSessionTicketOutcome extends SessionTicketOutcomeBase {
  readonly kind: 'committed'
  readonly transition: SessionTransitionId
  readonly cause: RevisionChangedTransition['cause']
  readonly history: RevisionChangedTransition['history']
  readonly revision: RevisionTransitionDescriptor
  readonly sourceHash: SourceHashV1
  readonly semanticHash: RevisionSemanticHashV1
}

export interface RejectedSessionTicketOutcome extends SessionTicketOutcomeBase {
  readonly kind: 'rejected'
  readonly reason: RejectionCode
  readonly revision: RevisionId
  readonly retainedDraft?: PendingInputDraft
  readonly effect?: SessionEffect
}

export interface NoopSessionTicketOutcome extends SessionTicketOutcomeBase {
  readonly kind: 'noop'
  readonly reason: 'empty-insertion'
  readonly revision: RevisionId
}

export interface CancelledSessionTicketOutcome extends SessionTicketOutcomeBase {
  readonly kind: 'cancelled'
  readonly reason: 'cancelled'
  readonly revision: RevisionId
}

export interface StateChangedSessionTicketOutcome extends SessionTicketOutcomeBase {
  readonly kind: 'state-changed'
  readonly transition: SessionTransitionId
  readonly revision: RevisionId
  readonly trackChanges: boolean
  readonly projection: CriticMarkupProjection
}

/**
 * Serializable terminal fact retained across a coordinator/worker restart.
 *
 * This deliberately is not a `DispatchResult`: live results contain snapshots
 * and functions. A durable outcome names the exact terminal decision and ids.
 */
export type SessionTicketOutcome =
  | CommittedSessionTicketOutcome
  | RejectedSessionTicketOutcome
  | NoopSessionTicketOutcome
  | CancelledSessionTicketOutcome
  | StateChangedSessionTicketOutcome

export interface DispatchTicket {
  readonly id: IntentId
  readonly clientSequence: number
  readonly admission: Promise<AdmissionResult>
  readonly completion: Promise<DispatchResult>
}

export interface CanonicalSourceChunk {
  readonly offset: number
  readonly text: string
}

export type LeaseReleaseReason = 'consumer-finished'

export type LeaseReleaseResult =
  | { readonly kind: 'released'; readonly lease: SourceLeaseId }
  | { readonly kind: 'already-terminal'; readonly lease: SourceLeaseId }

export interface SessionOperation<T> {
  readonly id: SessionOperationId
  readonly clientSequence: number
  readonly completion: Promise<T>
}

export interface StaticMaterializationRevision {
  readonly kind: 'complete'
  readonly session: SessionId
  readonly id: RevisionId
  readonly sourceHash: SourceHashV1
  readonly semanticHash: RevisionSemanticHashV1
}

export type SessionStaticMaterializationResult<
  Consumer extends StaticConsumer
> =
  | {
    readonly kind: 'materialized'
    readonly revision: StaticMaterializationRevision
    /**
     * Same-process capability. It must be consumed by the owning host sink and
     * never serialized or transported over IPC.
     */
    readonly artifact: StaticConsumerResult<Consumer>
  }
  | {
    readonly kind: 'unavailable'
    readonly reason: 'source-only-revision'
    readonly revision: Readonly<{
      readonly kind: 'source-only'
      readonly session: SessionId
      readonly id: RevisionId
      readonly fatalDiagnostic: ResourceDiagnostic
    }>
  }

export type SessionClipboardMaterializationResult =
  | {
    readonly kind: 'materialized'
    readonly revision: StaticMaterializationRevision
    readonly artifact: ClipboardConsumerResult
  }
  | {
    readonly kind: 'unavailable'
    readonly reason: 'source-only-revision'
  }

export type SessionCancelResult =
  | {
    readonly kind: 'cancelled'
    readonly ticket: IntentId
  }
  | {
    readonly kind: 'already-terminal'
    readonly ticket: IntentId
    readonly outcome: SessionTicketOutcome['kind']
  }
  | {
    readonly kind: 'too-late'
    readonly ticket: IntentId
  }
  | {
    readonly kind: 'unknown-ticket'
    readonly ticket: IntentId
  }

export type SessionCloseResult =
  | { readonly kind: 'closed' }
  | { readonly kind: 'already-closing' }
  | { readonly kind: 'already-closed' }

export type EffectAcknowledgementResult =
  | {
    readonly kind: 'acknowledged'
    readonly effect: SessionEffectId
  }
  | {
    readonly kind: 'already-terminal'
    readonly effect: SessionEffectId
    readonly status: 'acknowledged' | 'cancelled'
  }
  | {
    readonly kind: 'unknown-effect'
    readonly effect: SessionEffectId
  }

export type SessionLifecycleStatus = 'open' | 'closing' | 'closed'

export interface CanonicalSourceLease {
  readonly id: SourceLeaseId
  readonly watermark: number
  readonly revision: RevisionDescriptor
  readonly sourceHash: SourceHashV1
  readonly readChunks: () => AsyncIterable<CanonicalSourceChunk>
  readonly release: (reason: LeaseReleaseReason) => SessionOperation<LeaseReleaseResult>
}

export type FlushReason = 'materialize' | 'print'
export type PersistenceReason = 'save' | 'autosave'

export type DocumentCoreMarkdownOptionPatch = Readonly<
  Partial<
    Pick<
      MarkdownOptionsV1,
      'footnotes' | 'gitLabMath' | 'subscriptAndSuperscript'
    >
  >
>

export interface SessionMarkdownReconfigurationResult {
  readonly kind: 'reconfigured'
  readonly snapshot: EditorSnapshot
  readonly historyState: DocumentHistoryState
}

interface FlushedResult {
  readonly kind: 'flushed'
  readonly watermark: number
  readonly revision: RevisionDescriptor
  /** Parser-owned semantic metadata pinned to the leased revision. */
  readonly facts: DocumentFacts
  readonly source: CanonicalSourceLease
}

interface BlockedFlushResult {
  readonly kind: 'blocked'
  readonly watermark: number
  readonly reason: 'pending-input'
  readonly retainedDrafts: readonly PendingInputDraft[]
}

export type FlushResult = FlushedResult | BlockedFlushResult

export interface Disposable {
  readonly dispose: () => void
}

export type SessionTransitionListener = (transition: SessionTransition) => void | Promise<void>

export interface DocumentSession {
  readonly snapshot: () => EditorSnapshot
  readonly historyState: () => DocumentHistoryState
  readonly markPersisted: (
    headIdentity: string
  ) => Promise<DocumentHistoryState>
  /**
   * Confirm the leased bytes are durably installed. Durability is proven
   * against the held lease — the revision it pinned cannot have been
   * replaced — never inferred from a successful write callback. Rejects a
   * forged, foreign, or released lease.
   */
  readonly installed: (
    lease: CanonicalSourceLease
  ) => Promise<DocumentHistoryState>
  readonly dispatch: (
    intent: EditorIntent,
    beforePrepare?: Promise<void>,
    /**
     * Wire origin for host-only intents; defaults to the restrictive
     * renderer origin. Only the session's host may vouch for 'host'.
     */
    origin?: 'host' | 'renderer'
  ) => DispatchTicket
  readonly reconfigureMarkdownOptions: (
    patch: DocumentCoreMarkdownOptionPatch
  ) => SessionOperation<SessionMarkdownReconfigurationResult>
  readonly preparePersistence: (reason: PersistenceReason) => SessionOperation<FlushResult>
  readonly flush: (reason: FlushReason) => SessionOperation<FlushResult>
  /**
   * Materialize a static consumer from the causally settled immutable head.
   *
   * The returned TrustedHtml is an in-process capability: a main-process host
   * consumes it into the named sink. It is not a wire payload.
   */
  readonly materializeStatic: <Consumer extends StaticConsumer>(
    request: StaticConsumerRequest<Consumer>
  ) => SessionOperation<SessionStaticMaterializationResult<Consumer>>
  readonly materializeClipboard: (
    request: ClipboardConsumerRequest
  ) => SessionOperation<SessionClipboardMaterializationResult>
  /**
   * Move the caret or selection within the current revision.
   *
   * Selection is session state, not document state, so this commits no revision,
   * records no history and emits no transition — the document did not change.
   * It exists because the caret is a position the engine owns: a view keeping
   * its own copy would be a second source of truth for it.
   *
   * @throws RangeError when a position is outside the document.
   */
  readonly select: (selection: InitialModelSelection) => void
  /**
   * Move the authoritative canonical-source selection without committing a
   * document revision or history entry.
   */
  readonly selectSource: (selection: InitialModelSelection) => void
  /**
   * The one public settlement barrier. Resolves once every operation
   * enqueued before the call has settled — journal, watermark, and
   * publication; work enqueued afterwards is not awaited. Consumers await
   * this instead of sleeping or owning a second settlement notion.
   */
  readonly settled: () => Promise<void>
  readonly ticketOutcome: (ticket: IntentId) => SessionTicketOutcome | null
  readonly effects: () => readonly SessionEffect[]
  readonly cancel: (ticket: IntentId) => SessionOperation<SessionCancelResult>
  readonly close: () => SessionOperation<SessionCloseResult>
  readonly status: () => SessionLifecycleStatus
  readonly acknowledgeEffect: (
    effect: SessionEffectId
  ) => SessionOperation<EffectAcknowledgementResult>
  /**
   * Physical parse work attributed to this session's engine alone, including
   * work its lazily read parse products perform later. Hosts read operation
   * deltas from here instead of any process-global counter bank.
   */
  readonly physicalWork: () => Profile1PhysicalTraversalCountsV1
  readonly subscribe: (listener: SessionTransitionListener) => Disposable
}

export async function createDocumentSession(
  options: DocumentSessionOpenOptions
): Promise<DocumentSession> {
  return (await createSessionCoordinator(options)).client()
}

export async function recoverDocumentSession(
  options: DocumentSessionRecoveryOptions
): Promise<DocumentSession> {
  return (
    await recoverSessionCoordinator(
      options.durability,
      options.executionControl
    )
  ).client()
}
