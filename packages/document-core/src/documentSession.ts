import type {
  MarkdownDocument,
  MarkupMark,
  ParseConfiguration,
  SourceRange
} from './revision.js'
import type { SourceSnapshot } from './sourceSnapshot.js'
import { createSessionCoordinator } from './internal/session/sessionCoordinator.js'

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

export interface ModelPosition {
  /** UTF-16 code-unit offset in the named revision and view. */
  readonly offset: number
  readonly affinity: 'previous' | 'next'
}

export interface ModelSelection {
  readonly session: SessionId
  readonly revision: RevisionId
  readonly view: 'markup'
  readonly anchor: ModelPosition
  readonly focus: ModelPosition
}

export interface InitialModelSelection {
  readonly anchor: ModelPosition
  readonly focus: ModelPosition
}

export interface SessionConfiguration {
  readonly authoringTextPolicy: 'nearest-owner-eol-v1'
}

export interface DocumentSessionOpenOptions {
  readonly source: SourceSnapshot
  readonly parseConfiguration: ParseConfiguration
  readonly configuration: SessionConfiguration
  readonly initialView: 'markup'
  readonly trackChanges: false
  readonly initialSelection: InitialModelSelection
}

export interface RevisionDescriptor {
  readonly session: SessionId
  readonly id: RevisionId
  readonly kind: 'complete'
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
  readonly diagnostics: { readonly count: number }
  readonly selection: ModelSelection | null
}

export interface EditorSnapshot {
  readonly kind: 'complete'
  readonly id: EditorSnapshotId
  readonly configuration: SessionConfiguration
  readonly revision: RevisionDescriptor
  readonly view: 'markup'
  readonly livePlan: MarkupLiveRenderPlan
  /**
   * The block AST of the revision's editing view — what a WYSIWYG view mounts.
   * Served here so a view never re-parses to learn its own structure: doing that
   * would re-parse the whole document per keystroke and make the view a second
   * authority on what the document says (ADR-0009, ADR-0013). Its `source` is
   * the same text `livePlan` renders, so block ranges and run offsets share one
   * coordinate space.
   */
  readonly editingDocument: MarkdownDocument
  readonly pending: PendingSessionState
}

export interface ModelRange {
  readonly start: number
  readonly end: number
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
  readonly selectionAt: (selection: InitialModelSelection) => ModelSelection
}

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

export type EditorIntent =
  | InsertTextIntent
  | DeleteTextIntent
  | ReplaceTextIntent
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

export interface RevisionChangedTransition {
  readonly kind: 'revision-changed'
  readonly id: SessionTransitionId
  readonly cause: 'source-edit' | 'undo' | 'redo'
  readonly history: 'record' | 'none'
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

export type RejectionCode =
  | 'stale-selection'
  | 'selection-not-collapsed'
  /** A delete whose target covers nothing — it would change the document not at all. */
  | 'selection-collapsed'
  | 'nothing-to-undo'
  | 'nothing-to-redo'

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
}

interface NoopDispatchResult {
  readonly kind: 'noop'
  readonly reason: 'empty-insertion'
  readonly snapshot: EditorSnapshot
}

export type DispatchResult = CommittedDispatchResult | RejectedDispatchResult | NoopDispatchResult

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

export interface CanonicalSourceLease {
  readonly id: SourceLeaseId
  readonly watermark: number
  readonly revision: RevisionDescriptor
  readonly readChunks: () => AsyncIterable<CanonicalSourceChunk>
  readonly release: (reason: LeaseReleaseReason) => SessionOperation<LeaseReleaseResult>
}

export type FlushReason = 'materialize' | 'print'
export type PersistenceReason = 'save' | 'autosave'

interface FlushedResult {
  readonly kind: 'flushed'
  readonly watermark: number
  readonly revision: RevisionDescriptor
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
  readonly dispatch: (intent: EditorIntent) => DispatchTicket
  readonly preparePersistence: (reason: PersistenceReason) => SessionOperation<FlushResult>
  readonly flush: (reason: FlushReason) => SessionOperation<FlushResult>
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
  readonly subscribe: (listener: SessionTransitionListener) => Disposable
}

export async function createDocumentSession(
  options: DocumentSessionOpenOptions
): Promise<DocumentSession> {
  return createSessionCoordinator(options).client()
}
