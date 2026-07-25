import type {
  AdmissionResult,
  CanonicalSourceChunk,
  CanonicalSourceLease,
  DispatchResult,
  DispatchTicket,
  Disposable,
  DocumentSession,
  DocumentSessionOpenOptions,
  SessionConfiguration,
  DraftId,
  EditorIntent,
  EditorSnapshot,
  EditorSnapshotId,
  FlushReason,
  FlushResult,
  InitialModelSelection,
  IntentId,
  LeaseReleaseReason,
  LeaseReleaseResult,
  LiveRenderPlanId,
  MarkupLiveRenderPlan,
  ModelPosition,
  ModelSelection,
  PendingInputDraft,
  PersistenceReason,
  RevisionChangedTransition,
  RevisionDescriptor,
  RevisionId,
  SessionOperation,
  SessionOperationId,
  SessionId,
  SessionStateChangedTransition,
  SessionTransition,
  SessionTransitionId,
  SessionTransitionListener,
  SourceLeaseId
} from '../../documentSession.js'
import { createLanguageEngine } from '../../languageEngine.js'
import type { MarkupView } from './markupView.js'
import { IntentRejection, RevisionWorker } from './revisionWorker.js'
import { VolatileSessionJournal } from './sessionJournal.js'

const EMPTY_EFFECTS = Object.freeze([]) as readonly []
let nextSessionOrdinal = 0

function createSessionId(): SessionId {
  nextSessionOrdinal += 1
  return `session-${nextSessionOrdinal}` as SessionId
}

interface LeaseState {
  readonly id: SourceLeaseId
  readonly watermark: number
  readonly revision: RevisionDescriptor
  readonly source: string
  released: boolean
}

function copyPosition(position: ModelPosition): ModelPosition {
  return Object.freeze({
    offset: position.offset,
    affinity: position.affinity
  })
}

function copySelection(selection: ModelSelection): ModelSelection {
  return Object.freeze({
    session: selection.session,
    revision: selection.revision,
    view: selection.view,
    anchor: copyPosition(selection.anchor),
    focus: copyPosition(selection.focus)
  })
}

function snapshotIntent(intent: EditorIntent): EditorIntent {
  if (intent.kind === 'insert-text') {
    return Object.freeze({
      kind: 'insert-text' as const,
      target: copySelection(intent.target),
      text: intent.text
    })
  }
  if (intent.kind === 'replace-text') {
    return Object.freeze({
      kind: 'replace-text' as const,
      target: copySelection(intent.target),
      text: intent.text
    })
  }
  if (intent.kind === 'delete-text') {
    return Object.freeze({
      kind: 'delete-text' as const,
      target: copySelection(intent.target)
    })
  }
  return Object.freeze({ kind: intent.kind })
}

class SessionIds {
  #revision = 0
  #snapshot = 0
  #intent = 0
  #operation = 0
  #transition = 0
  #lease = 0
  #draft = 0
  #plan = 0

  revision(): RevisionId {
    this.#revision += 1
    return `revision-${this.#revision}` as RevisionId
  }

  snapshot(): EditorSnapshotId {
    this.#snapshot += 1
    return `snapshot-${this.#snapshot}` as EditorSnapshotId
  }

  intent(): IntentId {
    this.#intent += 1
    return `intent-${this.#intent}` as IntentId
  }

  operation(): SessionOperationId {
    this.#operation += 1
    return `operation-${this.#operation}` as SessionOperationId
  }

  transition(): SessionTransitionId {
    this.#transition += 1
    return `transition-${this.#transition}` as SessionTransitionId
  }

  lease(): SourceLeaseId {
    this.#lease += 1
    return `lease-${this.#lease}` as SourceLeaseId
  }

  draft(): DraftId {
    this.#draft += 1
    return `draft-${this.#draft}` as DraftId
  }

  plan(): LiveRenderPlanId {
    this.#plan += 1
    return `plan-${this.#plan}` as LiveRenderPlanId
  }
}

function createDescriptor(worker: RevisionWorker): RevisionDescriptor {
  const state = worker.state
  return Object.freeze({
    session: state.session,
    id: state.id,
    kind: 'complete' as const,
    configuration: state.revision.configuration,
    sourceLength: state.revision.source.text.length,
    source: state.revision.source.text,
    diagnostics: Object.freeze({ count: state.revision.diagnostics.count }),
    selection: state.selection
  })
}

function createLiveRenderPlan(
  id: LiveRenderPlanId,
  session: SessionId,
  revision: RevisionId,
  view: MarkupView
): MarkupLiveRenderPlan {
  const selectionAt = Object.freeze((selection: InitialModelSelection): ModelSelection => {
    view.sourcePositionAt(selection.anchor)
    view.sourcePositionAt(selection.focus)
    return Object.freeze({
      session,
      revision,
      view: 'markup' as const,
      anchor: copyPosition(selection.anchor),
      focus: copyPosition(selection.focus)
    })
  })
  return Object.freeze({
    id,
    revision,
    view: 'markup' as const,
    editable: true as const,
    modelLength: view.modelLength,
    runs: view.runs,
    selectionAt
  })
}

export class SessionCoordinator {
  readonly #session = createSessionId()
  readonly #ids = new SessionIds()
  readonly #journal = new VolatileSessionJournal()
  readonly #worker: RevisionWorker
  readonly #configuration: SessionConfiguration
  readonly #listeners = new Set<SessionTransitionListener>()
  readonly #leases = new Map<SourceLeaseId, LeaseState>()
  #retainedDrafts: readonly PendingInputDraft[] = Object.freeze([])
  #clientSequence = 0
  #settledWatermark = 0
  #mailbox: Promise<void> = Promise.resolve()
  #snapshot: EditorSnapshot

  constructor(options: DocumentSessionOpenOptions) {
    const engine = createLanguageEngine()
    const revision = engine.open(options.source, options.parseConfiguration)
    if (revision.kind !== 'complete') {
      throw new Error('The Phase 0 session tracer requires a complete revision')
    }

    this.#configuration = Object.freeze({
      authoringTextPolicy:
        options.configuration?.authoringTextPolicy ?? 'nearest-owner-eol-v1'
    })
    this.#worker = new RevisionWorker(
      engine,
      this.#session,
      this.#ids.revision(),
      revision,
      options.initialSelection ?? Object.freeze({
        anchor: Object.freeze({ offset: 0, affinity: 'next' as const }),
        focus: Object.freeze({ offset: 0, affinity: 'next' as const })
      })
    )
    this.#snapshot = this.#createSnapshot()
  }

  client(): DocumentSession {
    const snapshot = Object.freeze(() => this.#snapshot)
    const dispatch = Object.freeze((intent: EditorIntent) => this.#dispatch(intent))
    const preparePersistence = Object.freeze((reason: PersistenceReason) =>
      this.#requestSourceLease('prepare-persistence', reason)
    )
    const flush = Object.freeze((reason: FlushReason) => this.#flush(reason))
    const select = Object.freeze((selection: InitialModelSelection) => {
      this.#worker.moveSelection(selection)
      // Republish so the caret is visible to the next reader. No revision is
      // committed and no transition is emitted: the document did not change,
      // and retained drafts are untouched.
      this.#snapshot = this.#createSnapshot()
    })
    const subscribe = Object.freeze((listener: SessionTransitionListener) =>
      this.#subscribe(listener)
    )

    return Object.freeze({
      snapshot,
      dispatch,
      preparePersistence,
      flush,
      select,
      subscribe
    })
  }

  #createSnapshot(
    retainedDrafts: readonly PendingInputDraft[] = this.#retainedDrafts,
    retainedPlan?: MarkupLiveRenderPlan
  ): EditorSnapshot {
    const state = this.#worker.state
    const livePlan =
      retainedPlan ??
      createLiveRenderPlan(this.#ids.plan(), state.session, state.id, state.markupView)
    return Object.freeze({
      kind: 'complete' as const,
      id: this.#ids.snapshot(),
      configuration: this.#configuration,
      revision: createDescriptor(this.#worker),
      view: 'markup' as const,
      livePlan,
      // Straight off the retained revision: the editing projection is lazy and
      // reuses an existing view when the text matches, so serving it here costs
      // no parse and spares the view re-parsing to learn its own structure.
      editingDocument: state.revision.projection('editing').markdown,
      pending: Object.freeze({
        retained: retainedDrafts,
        status: retainedDrafts.length === 0 ? ('idle' as const) : ('blocked' as const)
      })
    })
  }

  #dispatch(intent: EditorIntent): DispatchTicket {
    const stableIntent = snapshotIntent(intent)
    const id = this.#ids.intent()
    const clientSequence = this.#nextClientSequence()
    const submittedAgainst = this.#worker.state.id
    const admission = this.#journal
      .appendIngress(id, clientSequence, submittedAgainst, stableIntent)
      .then(
        (): AdmissionResult =>
          Object.freeze({
            kind: 'admitted' as const,
            sequence: clientSequence,
            submittedAgainst
          })
      )
    const completion = this.#enqueue(() =>
      this.#completeAdmittedDispatch(admission, id, clientSequence, stableIntent)
    )

    return Object.freeze({
      id,
      clientSequence,
      admission,
      completion
    })
  }

  async #completeAdmittedDispatch(
    admission: Promise<AdmissionResult>,
    id: IntentId,
    clientSequence: number,
    intent: EditorIntent
  ): Promise<DispatchResult> {
    const admitted = await admission
    return this.#commitIntent(id, clientSequence, admitted.submittedAgainst, intent)
  }

  async #commitIntent(
    ticket: IntentId,
    sequence: number,
    submittedAgainst: RevisionId,
    intent: EditorIntent
  ): Promise<DispatchResult> {
    const before = this.#snapshot
    if (intent.kind === 'insert-text' && intent.text.length === 0) {
      await this.#journal.appendDispatchOutcome(
        ticket,
        sequence,
        'noop',
        this.#worker.state.id,
        'empty-insertion'
      )
      this.#settledWatermark = sequence
      return Object.freeze({
        kind: 'noop' as const,
        reason: 'empty-insertion' as const,
        snapshot: this.#snapshot
      })
    }
    const next = this.#ids.revision()

    try {
      let prepared
      if (intent.kind === 'insert-text') {
        prepared = this.#worker.prepareInsertion(intent.target, intent.text, next)
      } else if (intent.kind === 'replace-text') {
        prepared = this.#worker.prepareReplacement(intent.target, intent.text, next)
      } else if (intent.kind === 'delete-text') {
        prepared = this.#worker.prepareDeletion(intent.target, next)
      } else if (intent.kind === 'undo') {
        prepared = this.#worker.prepareUndo(next)
      } else {
        prepared = this.#worker.prepareRedo(next)
      }
      const transitionId = this.#ids.transition()

      await this.#journal.appendCommit(
        ticket,
        sequence,
        transitionId,
        prepared.transition,
        prepared.revision.source.text
      )
      this.#worker.commit(prepared)

      const after = this.#createSnapshot()
      const transition: RevisionChangedTransition = Object.freeze({
        kind: 'revision-changed' as const,
        id: transitionId,
        // Insertion and deletion are both source edits; undo/redo name
        // themselves.
        cause: intent.kind === 'insert-text' ||
          intent.kind === 'delete-text' ||
          intent.kind === 'replace-text'
          ? 'source-edit'
          : intent.kind,
        history: prepared.history,
        before,
        after,
        revision: Object.freeze({
          base: prepared.transition.base,
          next: prepared.transition.next
        }),
        effects: EMPTY_EFFECTS
      })

      this.#snapshot = after
      this.#settledWatermark = sequence
      this.#publish(transition)
      return Object.freeze({ kind: 'committed' as const, transition })
    } catch (error) {
      if (!(error instanceof IntentRejection)) {
        throw error
      }

      let retainedDraft: PendingInputDraft | undefined
      if (intent.kind === 'insert-text') {
        retainedDraft = Object.freeze({
          id: this.#ids.draft(),
          ticketIds: Object.freeze([ticket]),
          sequence,
          submittedAgainst,
          text: intent.text,
          target: intent.target,
          reason: error.code,
          status: 'blocked' as const,
          allowedActions: Object.freeze(['retry', 'discard'] as const)
        })
      }
      const retainedDrafts =
        retainedDraft === undefined
          ? this.#retainedDrafts
          : Object.freeze([...this.#retainedDrafts, retainedDraft])
      let after = this.#snapshot
      let stateTransition: SessionStateChangedTransition | undefined
      if (retainedDraft !== undefined) {
        after = this.#createSnapshot(retainedDrafts, before.livePlan)
        stateTransition = Object.freeze({
          kind: 'session-state-changed' as const,
          id: this.#ids.transition(),
          coalescing: 'break' as const,
          before,
          after,
          effects: EMPTY_EFFECTS
        })
      }

      await this.#journal.appendDispatchOutcome(
        ticket,
        sequence,
        'rejected',
        this.#worker.state.id,
        error.code,
        retainedDraft,
        stateTransition?.id
      )
      this.#settledWatermark = sequence

      if (retainedDraft !== undefined && stateTransition !== undefined) {
        this.#retainedDrafts = retainedDrafts
        this.#snapshot = after
        this.#publish(stateTransition)
        return Object.freeze({
          kind: 'rejected' as const,
          reason: error.code,
          snapshot: after,
          retainedDraft
        })
      }

      return Object.freeze({
        kind: 'rejected' as const,
        reason: error.code,
        snapshot: after
      })
    }
  }

  #flush(reason: FlushReason): SessionOperation<FlushResult> {
    return this.#requestSourceLease('flush', reason)
  }

  #requestSourceLease(
    operation: 'flush' | 'prepare-persistence',
    reason: FlushReason | PersistenceReason
  ): SessionOperation<FlushResult> {
    const id = this.#ids.operation()
    const clientSequence = this.#nextClientSequence()
    const completion = this.#enqueue(() =>
      this.#performSourceLease(id, clientSequence, operation, reason)
    )

    return Object.freeze({ id, clientSequence, completion })
  }

  async #performSourceLease(
    id: SessionOperationId,
    clientSequence: number,
    operation: 'flush' | 'prepare-persistence',
    reason: FlushReason | PersistenceReason
  ): Promise<FlushResult> {
    await this.#journal.appendOperation(
      id,
      clientSequence,
      `${operation}:${reason}`,
      this.#worker.state.id
    )

    const watermark = this.#settledWatermark
    if (this.#retainedDrafts.length > 0) {
      return Object.freeze({
        kind: 'blocked' as const,
        watermark,
        reason: 'pending-input' as const,
        retainedDrafts: this.#retainedDrafts
      })
    }
    const revision = this.#snapshot.revision
    const leaseState: LeaseState = {
      id: this.#ids.lease(),
      watermark,
      revision,
      source: this.#worker.state.revision.source.text,
      released: false
    }
    this.#leases.set(leaseState.id, leaseState)
    const source = this.#createLease(leaseState)

    return Object.freeze({
      kind: 'flushed' as const,
      watermark,
      revision,
      source
    })
  }

  #createLease(state: LeaseState): CanonicalSourceLease {
    const readChunks = Object.freeze(() => this.#createChunkStream(state))
    const release = Object.freeze((reason: LeaseReleaseReason) => this.#releaseLease(state, reason))

    return Object.freeze({
      id: state.id,
      watermark: state.watermark,
      revision: state.revision,
      readChunks,
      release
    })
  }

  #createChunkStream(state: LeaseState): AsyncIterable<CanonicalSourceChunk> {
    let emitted = false
    const iterator: AsyncIterator<CanonicalSourceChunk> = Object.freeze({
      next(): Promise<IteratorResult<CanonicalSourceChunk>> {
        if (state.released) {
          return Promise.reject(new Error('Canonical source lease is already released'))
        }
        if (emitted) {
          return Promise.resolve(Object.freeze({ done: true, value: undefined }))
        }
        emitted = true
        return Promise.resolve(
          Object.freeze({
            done: false,
            value: Object.freeze({ offset: 0, text: state.source })
          })
        )
      }
    })

    return Object.freeze({
      [Symbol.asyncIterator](): AsyncIterator<CanonicalSourceChunk> {
        return iterator
      }
    })
  }

  #releaseLease(
    state: LeaseState,
    reason: LeaseReleaseReason
  ): SessionOperation<LeaseReleaseResult> {
    const id = this.#ids.operation()
    const clientSequence = this.#nextClientSequence()
    const completion = this.#enqueue(() => this.#performRelease(id, clientSequence, state, reason))

    return Object.freeze({ id, clientSequence, completion })
  }

  async #performRelease(
    id: SessionOperationId,
    clientSequence: number,
    state: LeaseState,
    reason: LeaseReleaseReason
  ): Promise<LeaseReleaseResult> {
    await this.#journal.appendOperation(id, clientSequence, `release:${reason}`, state.revision.id)
    if (state.released) {
      return Object.freeze({ kind: 'already-terminal' as const, lease: state.id })
    }
    state.released = true
    this.#leases.delete(state.id)
    return Object.freeze({ kind: 'released' as const, lease: state.id })
  }

  #subscribe(listener: SessionTransitionListener): Disposable {
    this.#listeners.add(listener)
    let disposed = false
    const dispose = Object.freeze((): void => {
      if (disposed) {
        return
      }
      disposed = true
      this.#listeners.delete(listener)
    })
    return Object.freeze({ dispose })
  }

  #publish(transition: SessionTransition): void {
    for (const listener of [...this.#listeners]) {
      try {
        const outcome = listener(transition)
        if (outcome !== undefined) {
          outcome.catch(() => undefined)
        }
      } catch {
        // Observer faults cannot roll back an already journaled source commit.
      }
    }
  }

  #nextClientSequence(): number {
    this.#clientSequence += 1
    return this.#clientSequence
  }

  #enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.#mailbox.then(operation)
    this.#mailbox = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

export function createSessionCoordinator(options: DocumentSessionOpenOptions): SessionCoordinator {
  return new SessionCoordinator(options)
}
