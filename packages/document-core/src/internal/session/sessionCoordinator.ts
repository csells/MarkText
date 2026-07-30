import type {
  AdmissionResult,
  CanonicalSourceChunk,
  CanonicalSourceLease,
  CriticMarkupProjection,
  DispatchResult,
  DispatchTicket,
  Disposable,
  DocumentHistoryState,
  DocumentCoreMarkdownOptionPatch,
  DocumentSession,
  DocumentSessionDurability,
  DocumentSessionOpenOptions,
  DocumentLiveRenderPlan,
  EffectAcknowledgementResult,
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
  MarkupModelSelection,
  MarkupLiveRenderPlan,
  ModelRange,
  ModelPosition,
  ModelSelection,
  PendingInputDraft,
  PersistenceReason,
  RevisionChangedTransition,
  RevisionDescriptor,
  RevisionId,
  ReviewCommentedSpan,
  ReviewIndex,
  ReviewIndexItem,
  SessionOperation,
  SessionOperationId,
  SessionStaticMaterializationResult,
  SessionCancelResult,
  SessionCloseResult,
  SessionClipboardMaterializationResult,
  SessionLifecycleStatus,
  SessionMarkdownReconfigurationResult,
  SessionId,
  SessionStateChangedTransition,
  SessionEffect,
  SessionEffectId,
  SessionTicketOutcome,
  SessionTransition,
  SessionTransitionId,
  SessionTransitionListener,
  SourceLeaseId,
  SourceModelSelection
} from '../../documentSession.js'
import {
  authenticateCanonicalSourceLease
} from './canonicalSourceLeaseAuthority.js'
import type {
  CompleteDocumentRevision,
  CriticMarkupNode,
  NodeId,
  ProjectedMarkdown,
  SourceRange
} from '../../revision.js'
import {
  revisionSemanticHashV1,
  sourceHashV1
} from '../../hashCodec.js'
import type { RevisionSemanticHashV1 } from '../../hashCodec.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from '../../resourcePolicy.js'
import {
  materializeClipboardConsumer,
  materializeStaticConsumer,
  type ClipboardConsumerRequest,
  type CutPreparation,
  type StaticConsumer,
  type StaticConsumerRequest
} from '../../materialize/consumerPolicy.js'
import { materializeDocumentFacts } from '../../materialize/documentFacts.js'
import {
  createLanguageEngine,
  type LanguageEngine
} from '../../languageEngine.js'
import {
  createParseExecutionAccumulator,
  DocumentExecutionCancelledError,
  type ParseExecutionControl
} from '../../parseExecutionControl.js'
import { createMemoryDocumentSessionJournalStorage } from '../../sessionJournalStorage.js'
import { createSourceSnapshot } from '../../sourceSnapshot.js'
import type { MarkupView } from './markupView.js'
import { createSelectionAuthority } from './selectionAuthority.js'
import { IntentRejection, RevisionWorker } from './revisionWorker.js'
import {
  DurableSessionJournal,
  type SessionIdCheckpoint,
  type SessionRecoveryCheckpoint
} from './sessionJournal.js'
import { decodeEditorIntent } from './intentCodec.js'

const EMPTY_EFFECTS = Object.freeze([]) as readonly []

function createSessionId(identityNamespace: string | undefined): SessionId {
  const nonce = (
    globalThis as {
      readonly crypto?: { readonly randomUUID?: () => string }
    }
  ).crypto?.randomUUID?.()
  if (
    typeof nonce !== 'string' ||
    nonce.length === 0 ||
    nonce.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(nonce) ||
    (
      identityNamespace !== undefined &&
      (
        identityNamespace.length === 0 ||
        identityNamespace.length > 800 ||
        !/^[A-Za-z0-9._:-]+$/.test(identityNamespace)
      )
    )
  ) {
    throw new TypeError(
      'Document session identity namespace must be a bounded wire identity'
    )
  }
  return (
    identityNamespace === undefined
      ? `session:${nonce}`
      : `session:${identityNamespace}:${nonce}`
  ) as SessionId
}

interface LeaseState {
  readonly id: SourceLeaseId
  readonly watermark: number
  readonly revision: RevisionDescriptor
  readonly source: string
  released: boolean
}

interface LiveTicketState {
  readonly id: IntentId
  phase: 'admitting' | 'admitted' | 'preparing' | 'terminal'
  cancelRequested: boolean
  admission: Promise<AdmissionResult>
  completion: Promise<DispatchResult> | undefined
  cancelPersistence:
    | Promise<'requested' | 'too-late' | 'already-terminal' | 'unknown-ticket'>
    | undefined
}

function copyPosition(position: ModelPosition): ModelPosition {
  return Object.freeze({
    offset: position.offset,
    affinity: position.affinity
  })
}

function copySelection<Selection extends ModelSelection>(
  selection: Selection
): Selection {
  return Object.freeze({
    session: selection.session,
    revision: selection.revision,
    view: selection.view,
    anchor: copyPosition(selection.anchor),
    focus: copyPosition(selection.focus)
  }) as Selection
}

function copyDraft(draft: PendingInputDraft): PendingInputDraft {
  return Object.freeze({
    id: draft.id,
    ticketIds: Object.freeze([...draft.ticketIds]),
    sequence: draft.sequence,
    submittedAgainst: draft.submittedAgainst,
    text: draft.text,
    target: copySelection(draft.target),
    reason: draft.reason,
    status: 'blocked' as const,
    allowedActions: Object.freeze(['retry', 'discard'] as const)
  })
}

function copyEffect(effect: SessionEffect): SessionEffect {
  return Object.freeze({ ...effect })
}

class SessionIds {
  readonly #session: SessionId
  #revision = 0
  #snapshot = 0
  #intent = 0
  #operation = 0
  #transition = 0
  #lease = 0
  #draft = 0
  #plan = 0
  #effect = 0

  constructor(
    session: SessionId,
    checkpoint: SessionIdCheckpoint | undefined = undefined
  ) {
    this.#session = session
    if (checkpoint !== undefined) {
      this.restore(checkpoint)
    }
  }

  checkpoint(): SessionIdCheckpoint {
    return Object.freeze({
      revision: this.#revision,
      snapshot: this.#snapshot,
      intent: this.#intent,
      operation: this.#operation,
      transition: this.#transition,
      lease: this.#lease,
      draft: this.#draft,
      plan: this.#plan,
      effect: this.#effect
    })
  }

  restore(checkpoint: SessionIdCheckpoint): void {
    for (const value of Object.values(checkpoint)) {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error('Session id checkpoint contains an invalid ordinal')
      }
    }
    this.#revision = checkpoint.revision
    this.#snapshot = checkpoint.snapshot
    this.#intent = checkpoint.intent
    this.#operation = checkpoint.operation
    this.#transition = checkpoint.transition
    this.#lease = checkpoint.lease
    this.#draft = checkpoint.draft
    this.#plan = checkpoint.plan
    this.#effect = checkpoint.effect
  }

  revision(): RevisionId {
    this.#revision += 1
    return `${String(this.#session)}:revision:${this.#revision}` as RevisionId
  }

  snapshot(): EditorSnapshotId {
    this.#snapshot += 1
    return `${String(this.#session)}:snapshot:${this.#snapshot}` as EditorSnapshotId
  }

  intent(): IntentId {
    this.#intent += 1
    return `${String(this.#session)}:intent:${this.#intent}` as IntentId
  }

  operation(): SessionOperationId {
    this.#operation += 1
    return `${String(this.#session)}:operation:${this.#operation}` as SessionOperationId
  }

  transition(): SessionTransitionId {
    this.#transition += 1
    return `${String(this.#session)}:transition:${this.#transition}` as SessionTransitionId
  }

  lease(): SourceLeaseId {
    this.#lease += 1
    return `${String(this.#session)}:lease:${this.#lease}` as SourceLeaseId
  }

  draft(): DraftId {
    this.#draft += 1
    return `${String(this.#session)}:draft:${this.#draft}` as DraftId
  }

  plan(): LiveRenderPlanId {
    this.#plan += 1
    return `${String(this.#session)}:plan:${this.#plan}` as LiveRenderPlanId
  }

  effect(): SessionEffectId {
    this.#effect += 1
    return `${String(this.#session)}:effect:${this.#effect}` as SessionEffectId
  }
}

function createDescriptor(worker: RevisionWorker): RevisionDescriptor {
  const state = worker.state
  if (!('markupView' in state)) {
    return Object.freeze({
      session: state.session,
      id: state.id,
      kind: 'source-only' as const,
      configuration: state.revision.configuration,
      sourceLength: state.revision.source.text.length,
      source: state.revision.source.text,
      sourceHash: state.revision.sourceHash,
      semanticHash: state.revision.semanticHash,
      fatalDiagnostic: state.revision.fatalDiagnostic,
      selection: state.selection
    })
  }
  return Object.freeze({
    session: state.session,
    id: state.id,
    kind: 'complete' as const,
    configuration: state.revision.configuration,
    sourceLength: state.revision.source.text.length,
    source: state.revision.source.text,
    sourceHash: state.revision.sourceHash,
    semanticHash: state.revision.semanticHash,
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
  const selectionAt = Object.freeze((selection: InitialModelSelection): MarkupModelSelection => {
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
    coordinateMap: view.coordinateMap,
    sourcePositionAt: view.sourcePositionAt,
    modelPositionAt: view.modelPositionAt,
    selectionAt
  })
}

function createReadOnlyLiveRenderPlan(
  id: LiveRenderPlanId,
  revision: RevisionId,
  view: 'original' | 'revised',
  document: ProjectedMarkdown
): DocumentLiveRenderPlan {
  const source = document.source
  const runs = source.length === 0
    ? Object.freeze([])
    : Object.freeze([
      Object.freeze({
        key: `${view}:0:${source.length}`,
        marks: Object.freeze([]),
        text: source,
        modelRange: Object.freeze({ start: 0, end: source.length }),
        // A read-only projection has its own coordinate space. This member is
        // transported only for the common render-run shape; no edit maps it
        // back as canonical source.
        sourceRange: Object.freeze({
          start: 0,
          end: source.length
        }) as SourceRange
      })
    ])
  return Object.freeze({
    id,
    revision,
    view,
    editable: false as const,
    modelLength: source.length,
    runs
  })
}

const READ_ONLY_AUTHORING = Object.freeze({
  canCreateAddition: false,
  canCreateDeletion: false,
  canCreateSubstitution: false,
  canCreateHighlight: false,
  canCreateComment: false
})

interface MutableModelRange {
  start: number
  end: number
}

interface ReviewViewLookup {
  readonly modelRangeFor: (nodeId: NodeId) => ModelRange | null
  readonly focusOffsetFor: (sourceOffset: number) => number
}

function createReviewViewLookup(view: MarkupView): ReviewViewLookup {
  const mutableRanges = new Map<NodeId, MutableModelRange>()
  for (const run of view.runs) {
    for (const mark of run.marks) {
      const range = mutableRanges.get(mark.nodeId)
      if (range === undefined) {
        mutableRanges.set(mark.nodeId, {
          start: run.modelRange.start,
          end: run.modelRange.end
        })
      } else {
        range.start = Math.min(range.start, run.modelRange.start)
        range.end = Math.max(range.end, run.modelRange.end)
      }
    }
  }
  const modelRanges = new Map<NodeId, ModelRange>()
  for (const [nodeId, range] of mutableRanges) {
    modelRanges.set(nodeId, Object.freeze({
      start: range.start,
      end: range.end
    }))
  }

  const runAt = (index: number): MarkupView['runs'][number] => {
    const run = view.runs[index]
    if (run === undefined) {
      throw new Error('Review view run lookup is internally incomplete')
    }
    return run
  }
  const boundaryFocusOffset = (target: number): number => {
    let low = 0
    let high = view.runs.length - 1
    let previousIndex = -1
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      if (Number(runAt(middle).sourceRange.end) <= target) {
        previousIndex = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }

    low = 0
    high = view.runs.length - 1
    let nextIndex = view.runs.length
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      if (Number(runAt(middle).sourceRange.start) >= target) {
        nextIndex = middle
        high = middle - 1
      } else {
        low = middle + 1
      }
    }

    const previous = previousIndex < 0 ? undefined : runAt(previousIndex)
    const next = nextIndex >= view.runs.length ? undefined : runAt(nextIndex)
    if (previous === undefined) {
      return next?.modelRange.start ?? 0
    }
    if (next === undefined) {
      return previous.modelRange.end
    }
    return target - Number(previous.sourceRange.end) <=
      Number(next.sourceRange.start) - target
      ? previous.modelRange.end
      : next.modelRange.start
  }

  return Object.freeze({
    modelRangeFor: Object.freeze(
      (nodeId: NodeId): ModelRange | null => modelRanges.get(nodeId) ?? null
    ),
    focusOffsetFor: Object.freeze(boundaryFocusOffset)
  })
}

function createReviewIndex(
  revision: CompleteDocumentRevision,
  view: MarkupView,
  authoring: ReviewIndex['authoring']
): ReviewIndex {
  const items: ReviewIndexItem[] = []
  const commentedSpans: ReviewCommentedSpan[] = []
  const lookup = createReviewViewLookup(view)
  const revisedProvenance = revision.projection('revised').provenance

  const itemFor = (
    node: CriticMarkupNode,
    depth: number,
    parent: NodeId | null,
    withinCommentPayload: boolean
  ): ReviewIndexItem => {
    const modelRange = lookup.modelRangeFor(node.nodeId)
    return Object.freeze({
      nodeId: node.nodeId,
      kind: node.kind,
      sourceRange: Object.freeze({
        start: node.range.start,
        end: node.range.end
      }),
      modelRange,
      focusOffset: modelRange?.start ?? lookup.focusOffsetFor(
        Number(node.range.start)
      ),
      depth,
      parent,
      withinCommentPayload,
      payloadRange: Object.freeze({
        start: node.markers.open.end,
        end: node.markers.close.start
      }),
      commentRevisedText:
        node.kind === 'comment'
          ? revision.commentDisplay(node).source
          : null,
      oldContent:
        node.kind === 'substitution'
          ? revision.source.text.slice(
            Number(node.arms[0].range.start),
            Number(node.arms[0].range.end)
          )
          : null,
      newContent:
        node.kind === 'substitution'
          ? revision.source.text.slice(
            Number(node.arms[1].range.start),
            Number(node.arms[1].range.end)
          )
          : null
    })
  }

  type ReviewTraversalTask =
    | Readonly<{
      readonly kind: 'siblings'
      readonly siblings: readonly CriticMarkupNode[]
      readonly depth: number
      readonly parent: NodeId | null
      readonly withinCommentPayload: boolean
    }>
    | Readonly<{
      readonly kind: 'node'
      readonly node: CriticMarkupNode
      readonly depth: number
      readonly parent: NodeId | null
      readonly withinCommentPayload: boolean
    }>
    | Readonly<{
      readonly kind: 'commented-spans'
      readonly siblings: readonly CriticMarkupNode[]
    }>

  const roots = Array.from(
    { length: revision.criticMarkup.rootCount },
    (_, index) => revision.criticMarkup.rootAt(index)
  )
  const pending: ReviewTraversalTask[] = [{
    kind: 'siblings',
    siblings: roots,
    depth: 0,
    parent: null,
    withinCommentPayload: false
  }]
  while (pending.length > 0) {
    const task = pending.pop()
    if (task === undefined) {
      continue
    }
    if (task.kind === 'siblings') {
      pending.push({
        kind: 'commented-spans',
        siblings: task.siblings
      })
      for (
        let index = task.siblings.length - 1;
        index >= 0;
        index -= 1
      ) {
        const node = task.siblings[index]
        if (node !== undefined) {
          pending.push({
            kind: 'node',
            node,
            depth: task.depth,
            parent: task.parent,
            withinCommentPayload: task.withinCommentPayload
          })
        }
      }
      continue
    }
    if (task.kind === 'node') {
      items.push(itemFor(
        task.node,
        task.depth,
        task.parent,
        task.withinCommentPayload
      ))
      for (
        let armIndex = task.node.arms.length - 1;
        armIndex >= 0;
        armIndex -= 1
      ) {
        const children = task.node.arms[armIndex]?.children
        if (children !== undefined && children.length > 0) {
          pending.push({
            kind: 'siblings',
            siblings: children,
            depth: task.depth + 1,
            parent: task.node.nodeId,
            withinCommentPayload:
              task.withinCommentPayload || task.node.kind === 'comment'
          })
        }
      }
      continue
    }
    for (let index = 0; index + 1 < task.siblings.length; index += 1) {
      const highlight = task.siblings[index]
      const comment = task.siblings[index + 1]
      if (
        highlight?.kind !== 'highlight' ||
        comment?.kind !== 'comment' ||
        Number(highlight.range.end) !== Number(comment.range.start)
      ) {
        continue
      }
      const content = highlight.arms[0].range
      if (
        !revisedProvenance.canonicalSourceRangeIntersects(
          Number(content.start),
          Number(content.end)
        )
      ) {
        continue
      }
      const modelRange = lookup.modelRangeFor(highlight.nodeId)
      if (modelRange === null) {
        continue
      }
      commentedSpans.push(Object.freeze({
        highlight: highlight.nodeId,
        comment: comment.nodeId,
        sourceRange: Object.freeze({
          start: highlight.range.start,
          end: comment.range.end
        }),
        modelRange
      }))
    }
  }
  return Object.freeze({
    authoring,
    items: Object.freeze(items),
    commentedSpans: Object.freeze(commentedSpans)
  })
}

export class SessionCoordinator {
  readonly #session: SessionId
  readonly #ids: SessionIds
  readonly #journal: DurableSessionJournal
  readonly #worker: RevisionWorker
  #configuration: SessionConfiguration
  #projection: CriticMarkupProjection = 'marked'
  readonly #listeners = new Set<SessionTransitionListener>()
  readonly #leases = new Map<SourceLeaseId, LeaseState>()
  readonly #liveTickets = new Map<IntentId, LiveTicketState>()
  #retainedDrafts: readonly PendingInputDraft[] = Object.freeze([])
  #effects: readonly SessionEffect[] = Object.freeze([])
  #lifecycle: SessionLifecycleStatus = 'open'
  #reopenSemanticHashes: readonly RevisionSemanticHashV1[] = Object.freeze([])
  #clientSequence = 0
  #settledWatermark = 0
  #mailbox: Promise<void> = Promise.resolve()
  #snapshot: EditorSnapshot
  readonly #engine: LanguageEngine

  constructor(
    options: DocumentSessionOpenOptions,
    journal: DurableSessionJournal,
    recovery: SessionRecoveryCheckpoint | null
  ) {
    const engine = createLanguageEngine(options.executionControl)
    this.#engine = engine
    this.#journal = journal
    this.#configuration = Object.freeze({
      authoringTextPolicy:
        options.configuration?.authoringTextPolicy ?? 'nearest-owner-eol-v1',
      trackChanges: options.trackChanges ?? false
    })
    if (recovery === null) {
      this.#session = createSessionId(options.identityNamespace)
      this.#ids = new SessionIds(this.#session)
      const revision = engine.open(options.source, options.parseConfiguration)
      this.#worker = new RevisionWorker(
        engine,
        this.#session,
        this.#ids.revision(),
        revision,
        options.initialSelection ?? Object.freeze({
          anchor: Object.freeze({ offset: 0, affinity: 'next' as const }),
          focus: Object.freeze({ offset: 0, affinity: 'next' as const })
        }),
        options.trackChanges ?? false
      )
    } else {
      this.#session = recovery.worker.session
      this.#ids = new SessionIds(this.#session, recovery.ids)
      const revision = engine.open(
        createSourceSnapshot(recovery.worker.source),
        recovery.worker.configuration
      )
      this.#worker = new RevisionWorker(
        engine,
        recovery.worker.session,
        recovery.worker.id,
        revision,
        recovery.worker.selection,
        options.trackChanges ?? false,
        recovery.worker
      )
      this.#retainedDrafts = Object.freeze(
        recovery.retainedDrafts.map((draft) => copyDraft(draft))
      )
      this.#clientSequence = recovery.clientSequence
      this.#settledWatermark = recovery.settledWatermark
      this.#effects = Object.freeze(recovery.effects.map((effect) => copyEffect(effect)))
      this.#lifecycle = recovery.lifecycle
      this.#reopenSemanticHashes = Object.freeze(
        [...recovery.reopenSemanticHashes] as RevisionSemanticHashV1[]
      )
    }
    this.#configuration = Object.freeze({
      ...this.#configuration,
      trackChanges: this.#worker.trackChanges
    })
    this.#worker.prepareDocumentFacts()
    this.#snapshot = this.#createSnapshot()
  }

  checkpoint(
    retainedDrafts: readonly PendingInputDraft[] = this.#retainedDrafts,
    settledWatermark: number = this.#settledWatermark,
    effects: readonly SessionEffect[] = this.#effects,
    lifecycle: SessionLifecycleStatus = this.#lifecycle
  ): SessionRecoveryCheckpoint {
    return Object.freeze({
      worker: this.#worker.checkpoint(),
      ids: this.#ids.checkpoint(),
      retainedDrafts: Object.freeze(retainedDrafts.map((draft) => copyDraft(draft))),
      clientSequence: this.#clientSequence,
      settledWatermark,
      effects: Object.freeze(effects.map((effect) => copyEffect(effect))),
      lifecycle,
      reopenSemanticHashes: this.#reopenSemanticHashes
    })
  }

  async recoverPendingIngress(): Promise<void> {
    for (const record of this.#journal.pendingIngress()) {
      if (record.cancelRequested || this.#lifecycle !== 'open') {
        await this.#settleCancelled(
          record.ticket,
          record.sequence,
          record.submittedAgainst
        )
        continue
      }
      await this.#commitIntent(
        record.ticket,
        record.sequence,
        record.submittedAgainst,
        decodeEditorIntent(record.intent)
      )
    }
  }

  client(): DocumentSession {
    const snapshot = Object.freeze(() => this.#snapshot)
    const historyState = Object.freeze(() => this.#worker.historyState())
    const markPersisted = Object.freeze((headIdentity: string) =>
      this.#markPersisted(headIdentity)
    )
    const dispatch = Object.freeze((
      intent: EditorIntent,
      beforePrepare?: Promise<void>
    ) => this.#dispatch(intent, beforePrepare))
    const reconfigureMarkdownOptions = Object.freeze(
      (patch: DocumentCoreMarkdownOptionPatch) =>
        this.#reconfigureMarkdownOptions(patch)
    )
    const preparePersistence = Object.freeze((reason: PersistenceReason) =>
      this.#requestSourceLease('prepare-persistence', reason)
    )
    const flush = Object.freeze((reason: FlushReason) => this.#flush(reason))
    const materializeStatic = Object.freeze(
      <Consumer extends StaticConsumer>(
        request: StaticConsumerRequest<Consumer>
      ) => this.#materializeStatic(request)
    )
    const materializeClipboard = Object.freeze(
      (request: ClipboardConsumerRequest) =>
        this.#materializeClipboard(request)
    )
    const selectionAuthority = createSelectionAuthority({
      requireOpen: () => {
        if (this.#lifecycle !== 'open') {
          throw new Error('Document session is closed')
        }
      },
      moveSelection: (selection) => {
        this.#worker.moveSelection(selection)
      },
      moveSourceSelection: (selection) => {
        this.#worker.moveSourceSelection(selection)
      },
      republish: () => {
        this.#snapshot = this.#createSnapshot()
      },
      mailboxTail: () => this.#mailbox
    })
    const select = Object.freeze(selectionAuthority.select)
    const selectSource = Object.freeze(selectionAuthority.selectSource)
    const settled = Object.freeze(selectionAuthority.settled)
    const subscribe = Object.freeze((listener: SessionTransitionListener) =>
      this.#subscribe(listener)
    )
    const ticketOutcome = Object.freeze((ticket: IntentId) =>
      this.#journal.ticketOutcome(ticket)
    )
    const effects = Object.freeze(() =>
      Object.freeze(this.#effects.map((effect) => copyEffect(effect)))
    )
    const cancel = Object.freeze((ticket: IntentId) => this.#cancel(ticket))
    const close = Object.freeze(() => this.#close())
    const status = Object.freeze(() => this.#lifecycle)
    const acknowledgeEffect = Object.freeze((effect: SessionEffectId) =>
      this.#acknowledgeEffect(effect)
    )
    const physicalWork = Object.freeze(() =>
      this.#engine.traversalCounts()
    )

    return Object.freeze({
      snapshot,
      historyState,
      markPersisted,
      dispatch,
      reconfigureMarkdownOptions,
      preparePersistence,
      flush,
      materializeStatic,
      materializeClipboard,
      select,
      selectSource,
      settled,
      ticketOutcome,
      effects,
      cancel,
      close,
      status,
      acknowledgeEffect,
      physicalWork,
      subscribe
    })
  }

  #reconfigureMarkdownOptions(
    patch: DocumentCoreMarkdownOptionPatch
  ): SessionOperation<SessionMarkdownReconfigurationResult> {
    if (this.#lifecycle !== 'open') {
      throw new Error('Document session is closed')
    }
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new TypeError('Markdown option patch must be a closed record')
    }
    const allowed = new Set([
      'footnotes',
      'gitLabMath',
      'subscriptAndSuperscript'
    ])
    for (const [key, value] of Object.entries(patch)) {
      if (!allowed.has(key) || typeof value !== 'boolean') {
        throw new TypeError(`Invalid Markdown option patch field ${key}`)
      }
    }
    const stablePatch = Object.freeze({ ...patch })
    const id = this.#ids.operation()
    const clientSequence = this.#nextClientSequence()
    const completion = this.#enqueue(
      async(): Promise<SessionMarkdownReconfigurationResult> => {
        const current = this.#worker.state.revision.configuration
        if (
          (
            stablePatch.footnotes === undefined ||
            stablePatch.footnotes === current.markdownOptions.footnotes
          ) &&
          (
            stablePatch.gitLabMath === undefined ||
            stablePatch.gitLabMath === current.markdownOptions.gitLabMath
          ) &&
          (
            stablePatch.subscriptAndSuperscript === undefined ||
            stablePatch.subscriptAndSuperscript ===
              current.markdownOptions.subscriptAndSuperscript
          )
        ) {
          return Object.freeze({
            kind: 'reconfigured' as const,
            snapshot: this.#snapshot,
            historyState: this.#worker.historyState()
          })
        }
        const previous = this.#worker.checkpoint()
        const configuration = Object.freeze({
          ...current,
          markdownOptions: Object.freeze({
            ...current.markdownOptions,
            ...stablePatch
          })
        })
        this.#worker.reconfigure(configuration)
        try {
          await this.#journal.checkpoint(this.checkpoint())
        } catch (error) {
          this.#worker.restore(previous)
          throw error
        }
        this.#snapshot = this.#createSnapshot()
        return Object.freeze({
          kind: 'reconfigured' as const,
          snapshot: this.#snapshot,
          historyState: this.#worker.historyState()
        })
      }
    )
    return Object.freeze({ id, clientSequence, completion })
  }

  async #markPersisted(
    headIdentity: string
  ): Promise<DocumentHistoryState> {
    if (this.#lifecycle !== 'open') {
      throw new Error('Document session is closed')
    }
    return await this.#enqueue(async() => {
      const previous = this.#worker.historyState().savedIdentity
      this.#worker.markPersisted(headIdentity)
      try {
        await this.#journal.checkpoint(this.checkpoint())
      } catch (error) {
        this.#worker.markPersisted(previous)
        throw error
      }
      return this.#worker.historyState()
    })
  }

  #createSnapshot(
    retainedDrafts: readonly PendingInputDraft[] = this.#retainedDrafts,
    retainedPlan?: MarkupLiveRenderPlan
  ): EditorSnapshot {
    const state = this.#worker.state
    const pending = Object.freeze({
      retained: retainedDrafts,
      status: retainedDrafts.length === 0 ? ('idle' as const) : ('blocked' as const)
    })
    if (!('markupView' in state)) {
      const revision = createDescriptor(this.#worker)
      if (revision.kind !== 'source-only') {
        throw new Error('SourceOnly worker produced a complete descriptor')
      }
      return Object.freeze({
        kind: 'source-only' as const,
        id: this.#ids.snapshot(),
        configuration: this.#configuration,
        facts: materializeDocumentFacts(state.revision),
        sourceSelection: this.#worker.sourceSelection(),
        revision,
        view: 'source' as const,
        pending
      })
    }
    const projected =
      this.#projection === 'marked'
        ? state.revision.projection('editing')
        : state.revision.projection(this.#projection)
    const livePlan =
      retainedPlan ??
      createLiveRenderPlan(
        this.#ids.plan(),
        state.session,
        state.id,
        state.markupView
      )
    const displayPlan =
      this.#projection === 'marked'
        ? livePlan
        : createReadOnlyLiveRenderPlan(
          this.#ids.plan(),
          state.id,
          this.#projection,
          projected
        )
    const revision = createDescriptor(this.#worker)
    if (revision.kind !== 'complete') {
      throw new Error('Complete worker produced a SourceOnly descriptor')
    }
    return Object.freeze({
      kind: 'complete' as const,
      id: this.#ids.snapshot(),
      configuration: this.#configuration,
      facts: materializeDocumentFacts(state.revision),
      sourceSelection: this.#worker.sourceSelection(),
      revision,
      view: 'markup' as const,
      projection: this.#projection,
      livePlan,
      displayPlan,
      reviewIndex: createReviewIndex(
        state.revision,
        state.markupView,
        this.#projection === 'marked'
          ? this.#worker.criticMarkupAuthoringCapabilities()
          : READ_ONLY_AUTHORING
      ),
      // Straight off the retained revision: the editing projection is lazy and
      // reuses an existing view when the text matches, so serving it here costs
      // no parse and spares the view re-parsing to learn its own structure.
      editingDocument: state.revision.projection('editing').markdown,
      displayDocument: projected.markdown,
      pending
    })
  }

  #dispatch(
    intent: EditorIntent,
    beforePrepare: Promise<void> = Promise.resolve()
  ): DispatchTicket {
    if (this.#lifecycle !== 'open') {
      throw new Error('Document session is closed')
    }
    const stableIntent = decodeEditorIntent(intent)
    const id = this.#ids.intent()
    const clientSequence = this.#nextClientSequence()
    const submittedAgainst = this.#worker.state.id
    const state: LiveTicketState = {
      id,
      phase: 'admitting',
      cancelRequested: false,
      admission: Promise.resolve(
        Object.freeze({
          kind: 'admitted' as const,
          sequence: clientSequence,
          submittedAgainst
        })
      ),
      completion: undefined,
      cancelPersistence: undefined
    }
    const admission: Promise<AdmissionResult> = this.#journal
      .appendIngress(
        id,
        clientSequence,
        submittedAgainst,
        stableIntent,
        this.checkpoint()
      )
      .then(
        (): AdmissionResult => {
          state.phase = 'admitted'
          return Object.freeze({
            kind: 'admitted' as const,
            sequence: clientSequence,
            submittedAgainst
          })
        }
      )
    state.admission = admission
    this.#liveTickets.set(id, state)
    const completion = this.#enqueue(() =>
      this.#completeAdmittedDispatch(
        state,
        id,
        clientSequence,
        stableIntent,
        beforePrepare
      )
    )
    state.completion = completion

    return Object.freeze({
      id,
      clientSequence,
      admission,
      completion
    })
  }

  async #completeAdmittedDispatch(
    state: LiveTicketState,
    id: IntentId,
    clientSequence: number,
    intent: EditorIntent,
    beforePrepare: Promise<void>
  ): Promise<DispatchResult> {
    try {
      const admitted = await state.admission
      if (state.cancelRequested) {
        const decision = await state.cancelPersistence
        if (decision === 'requested') {
          return this.#settleCancelled(
            id,
            clientSequence,
            admitted.submittedAgainst
          )
        }
      }
      await beforePrepare
      if (state.cancelRequested) {
        const decision = await state.cancelPersistence
        if (decision === 'requested') {
          return this.#settleCancelled(
            id,
            clientSequence,
            admitted.submittedAgainst
          )
        }
      }
      state.phase = 'preparing'
      return await this.#commitIntent(
        id,
        clientSequence,
        admitted.submittedAgainst,
        intent
      )
    } finally {
      state.phase = 'terminal'
      this.#liveTickets.delete(id)
    }
  }

  async #commitIntent(
    ticket: IntentId,
    sequence: number,
    submittedAgainst: RevisionId,
    intent: EditorIntent
  ): Promise<DispatchResult> {
    const before = this.#snapshot
    if (intent.kind === 'insert-text' && intent.text.length === 0) {
      const outcome: SessionTicketOutcome = Object.freeze({
        kind: 'noop' as const,
        ticket,
        sequence,
        submittedAgainst,
        reason: 'empty-insertion' as const,
        revision: this.#worker.state.id
      })
      await this.#journal.settle(ticket, this.checkpoint(this.#retainedDrafts, sequence), outcome)
      this.#settledWatermark = sequence
      return Object.freeze({
        kind: 'noop' as const,
        reason: 'empty-insertion' as const,
        snapshot: this.#snapshot
      })
    }
    if (intent.kind === 'set-track-changes') {
      return this.#commitTrackChangesState(
        ticket,
        sequence,
        submittedAgainst,
        intent.enabled
      )
    }
    if (intent.kind === 'set-projection') {
      return this.#commitProjectionState(
        ticket,
        sequence,
        submittedAgainst,
        intent.projection
      )
    }
    const rollbackWorker = this.#worker.checkpoint()
    const rollbackIds = this.#ids.checkpoint()
    const next = this.#ids.revision()

    try {
      if (this.#projection !== 'marked') {
        throw new IntentRejection('read-only-projection')
      }
      let prepared
      if (intent.kind === 'insert-text') {
        // Typed insertions are the one coalescible admission: the History
        // rule may extend the open typed run instead of recording an entry.
        prepared = this.#worker.prepareInsertion(
          intent.target,
          intent.text,
          next,
          'semantic',
          true
        )
      } else if (intent.kind === 'replace-text') {
        prepared = this.#worker.prepareReplacement(intent.target, intent.text, next)
      } else if (intent.kind === 'replace-current-matches') {
        prepared = this.#worker.prepareCurrentMatchReplacement(
          intent.target,
          intent.query,
          intent.replacement,
          next
        )
      } else if (intent.kind === 'delete-text') {
        prepared = this.#worker.prepareDeletion(intent.target, next)
      } else if (intent.kind === 'format-text') {
        prepared = this.#worker.prepareFormatting(
          intent.target,
          intent.format,
          next
        )
      } else if (intent.kind === 'replace-structure') {
        prepared = this.#worker.prepareStructureReplacement(
          intent.target,
          intent.replacement,
          next
        )
      } else if (intent.kind === 'convert-block') {
        prepared = this.#worker.prepareBlockConversion(
          intent.target,
          intent.conversion,
          next
        )
      } else if (intent.kind === 'quick-insert-block') {
        prepared = this.#worker.prepareQuickInsertBlock(
          intent.target,
          intent.block,
          next
        )
      } else if (intent.kind === 'duplicate-block') {
        prepared = this.#worker.prepareBlockDuplication(intent.target, next)
      } else if (intent.kind === 'delete-block') {
        prepared = this.#worker.prepareBlockDeletion(intent.target, next)
      } else if (intent.kind === 'insert-paragraph') {
        prepared = this.#worker.prepareParagraphInsertion(
          intent.target,
          intent.location,
          next
        )
      } else if (intent.kind === 'insert-paragraph-break') {
        prepared = this.#worker.prepareSemanticBreak(
          intent.target,
          'paragraph',
          next
        )
      } else if (intent.kind === 'insert-line-break') {
        prepared = this.#worker.prepareSemanticBreak(
          intent.target,
          'line',
          next
        )
      } else if (intent.kind === 'set-list-indentation') {
        prepared = this.#worker.prepareListIndentation(
          intent.target,
          intent.direction,
          next
        )
      } else if (intent.kind === 'set-task-checked') {
        prepared = this.#worker.prepareTaskChecked(
          intent.target,
          intent.checked,
          intent.cascade,
          next
        )
      } else if (intent.kind === 'set-code-language') {
        prepared = this.#worker.prepareCodeLanguage(
          intent.target,
          intent.language,
          next
        )
      } else if (intent.kind === 'insert-link') {
        prepared = this.#worker.prepareLinkInsertion(
          intent.target,
          intent.href,
          intent.title,
          next
        )
      } else if (intent.kind === 'insert-image') {
        prepared = this.#worker.prepareImageInsertion(
          intent.target,
          {
            src: intent.src,
            alt: intent.alt,
            ...(intent.title === undefined ? {} : { title: intent.title })
          },
          next
        )
      } else if (intent.kind === 'insert-footnote') {
        prepared = this.#worker.prepareFootnoteInsertion(
          intent.target,
          intent.label,
          intent.content,
          next
        )
      } else if (intent.kind === 'create-table') {
        prepared = this.#worker.prepareTableCreation(
          intent.target,
          intent.rows,
          intent.columns,
          next
        )
      } else if (intent.kind === 'insert-table-row') {
        prepared = this.#worker.prepareTableRowInsertion(
          intent.target,
          intent.location,
          next
        )
      } else if (intent.kind === 'remove-table-row') {
        prepared = this.#worker.prepareTableRowRemoval(intent.target, next)
      } else if (intent.kind === 'insert-table-column') {
        prepared = this.#worker.prepareTableColumnInsertion(
          intent.target,
          intent.location,
          next
        )
      } else if (intent.kind === 'remove-table-column') {
        prepared = this.#worker.prepareTableColumnRemoval(intent.target, next)
      } else if (intent.kind === 'align-table-column') {
        prepared = this.#worker.prepareTableColumnAlignment(
          intent.target,
          intent.alignment,
          next
        )
      } else if (intent.kind === 'move-table-row') {
        prepared = this.#worker.prepareTableRowMove(
          intent.target,
          intent.direction,
          next
        )
      } else if (intent.kind === 'move-table-column') {
        prepared = this.#worker.prepareTableColumnMove(
          intent.target,
          intent.direction,
          next
        )
      } else if (intent.kind === 'delete-table-cell-contents') {
        prepared = this.#worker.prepareTableCellContentsDeletion(
          intent.target,
          next
        )
      } else if (intent.kind === 'paste-text') {
        prepared = this.#worker.preparePaste(
          intent.target,
          intent.text,
          intent.source,
          next
        )
      } else if (intent.kind === 'commit-composition') {
        prepared = this.#worker.prepareCompositionCommit(
          intent.target,
          intent.text,
          next
        )
      } else if (intent.kind === 'author-critic-markup') {
        prepared = this.#worker.prepareCriticMarkupAuthoring(
          intent.target,
          intent.input,
          next
        )
      } else if (intent.kind === 'reload-source-from-file') {
        prepared = this.#worker.prepareSourceCommit(intent.source, next)
      } else if (intent.kind === 'edit-source') {
        prepared = this.#worker.prepareSourceEdit(
          intent.target,
          intent.text,
          intent.selection,
          next
        )
      } else if (intent.kind === 'undo') {
        prepared = this.#worker.prepareUndo(next)
      } else if (intent.kind === 'redo') {
        prepared = this.#worker.prepareRedo(next)
      } else {
        prepared = this.#worker.prepareTransformation(intent, next)
      }
      // Facts are part of the candidate publication. Complete their
      // checkpointed, cancellable work before journal begin/worker commit so
      // cancellation cannot leave a committed head with no snapshot.
      this.#worker.prepareDocumentFacts(prepared.revision)
      const transitionId = this.#ids.transition()
      if (await this.#journal.beginCommit(ticket) === 'cancelled') {
        this.#ids.restore(rollbackIds)
        return this.#settleCancelled(ticket, sequence, submittedAgainst)
      }
      this.#worker.commit(prepared)

      const after = this.#createSnapshot()
      const cause =
        intent.kind === 'undo' || intent.kind === 'redo'
          ? intent.kind
          : ('source-edit' as const)
      const transition: RevisionChangedTransition = Object.freeze({
        kind: 'revision-changed' as const,
        id: transitionId,
        // Insertion and deletion are both source edits; undo/redo name
        // themselves.
        cause,
        history: prepared.history,
        edits: prepared.transition.edits,
        before,
        after,
        revision: Object.freeze({
          base: prepared.transition.base,
          next: prepared.transition.next
        }),
        effects: EMPTY_EFFECTS
      })
      const outcome: SessionTicketOutcome = Object.freeze({
        kind: 'committed' as const,
        ticket,
        sequence,
        submittedAgainst,
        transition: transitionId,
        cause,
        history: prepared.history,
        revision: Object.freeze({
          base: prepared.transition.base,
          next: prepared.transition.next
        }),
        sourceHash: prepared.revision.sourceHash,
        semanticHash: prepared.revision.semanticHash
      })

      try {
        await this.#journal.settle(
          ticket,
          this.checkpoint(this.#retainedDrafts, sequence),
          outcome
        )
      } catch (error) {
        this.#worker.restore(rollbackWorker)
        this.#ids.restore(rollbackIds)
        throw error
      }

      this.#snapshot = after
      this.#settledWatermark = sequence
      this.#publish(transition)
      return Object.freeze({ kind: 'committed' as const, transition })
    } catch (error) {
      if (error instanceof DocumentExecutionCancelledError) {
        if (this.#worker.state.id !== rollbackWorker.id) {
          this.#worker.restore(rollbackWorker)
        }
        this.#ids.restore(rollbackIds)
        return this.#settleCancelled(
          ticket,
          sequence,
          submittedAgainst
        )
      }
      if (!(error instanceof IntentRejection)) {
        if (this.#worker.state.id !== rollbackWorker.id) {
          this.#worker.restore(rollbackWorker)
        }
        this.#ids.restore(rollbackIds)
        const effect: SessionEffect = Object.freeze({
          id: this.#ids.effect(),
          kind: 'dispatch-failure' as const,
          ticket,
          code: 'precommit-failed' as const,
          status: 'pending' as const
        })
        const effects = Object.freeze([...this.#effects, effect])
        const outcome: SessionTicketOutcome = Object.freeze({
          kind: 'rejected' as const,
          ticket,
          sequence,
          submittedAgainst,
          reason: 'precommit-failed' as const,
          revision: rollbackWorker.id,
          effect
        })
        await this.#journal.settle(
          ticket,
          this.checkpoint(
            this.#retainedDrafts,
            sequence,
            effects
          ),
          outcome
        )
        this.#effects = effects
        this.#settledWatermark = sequence
        return Object.freeze({
          kind: 'rejected' as const,
          reason: 'precommit-failed' as const,
          snapshot: before,
          effect
        })
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
        after = this.#createSnapshot(
          retainedDrafts,
          before.kind === 'complete' ? before.livePlan : undefined
        )
        stateTransition = Object.freeze({
          kind: 'session-state-changed' as const,
          id: this.#ids.transition(),
          coalescing: 'break' as const,
          before,
          after,
          effects: EMPTY_EFFECTS
        })
      }

      const outcome: SessionTicketOutcome =
        retainedDraft === undefined
          ? Object.freeze({
            kind: 'rejected' as const,
            ticket,
            sequence,
            submittedAgainst,
            reason: error.code,
            revision: this.#worker.state.id
          })
          : Object.freeze({
            kind: 'rejected' as const,
            ticket,
            sequence,
            submittedAgainst,
            reason: error.code,
            revision: this.#worker.state.id,
            retainedDraft
          })
      try {
        await this.#journal.settle(
          ticket,
          this.checkpoint(retainedDrafts, sequence),
          outcome
        )
      } catch (journalError) {
        this.#ids.restore(rollbackIds)
        throw journalError
      }
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

  async #commitProjectionState(
    ticket: IntentId,
    sequence: number,
    submittedAgainst: RevisionId,
    projection: CriticMarkupProjection
  ): Promise<DispatchResult> {
    const before = this.#snapshot
    if (before.kind === 'source-only') {
      const outcome: SessionTicketOutcome = Object.freeze({
        kind: 'rejected' as const,
        ticket,
        sequence,
        submittedAgainst,
        reason: 'source-only-revision' as const,
        revision: this.#worker.state.id
      })
      await this.#journal.settle(
        ticket,
        this.checkpoint(this.#retainedDrafts, sequence),
        outcome
      )
      this.#settledWatermark = sequence
      return Object.freeze({
        kind: 'rejected' as const,
        reason: 'source-only-revision' as const,
        snapshot: before
      })
    }
    if (this.#projection === projection) {
      const outcome: SessionTicketOutcome = Object.freeze({
        kind: 'rejected' as const,
        ticket,
        sequence,
        submittedAgainst,
        reason: 'no-source-change' as const,
        revision: this.#worker.state.id
      })
      await this.#journal.settle(
        ticket,
        this.checkpoint(this.#retainedDrafts, sequence),
        outcome
      )
      this.#settledWatermark = sequence
      return Object.freeze({
        kind: 'rejected' as const,
        reason: 'no-source-change' as const,
        snapshot: before
      })
    }

    const rollbackIds = this.#ids.checkpoint()
    const rollbackProjection = this.#projection
    const transitionId = this.#ids.transition()
    try {
      if (await this.#journal.beginCommit(ticket) === 'cancelled') {
        this.#ids.restore(rollbackIds)
        return this.#settleCancelled(ticket, sequence, submittedAgainst)
      }
      this.#projection = projection
      const after = this.#createSnapshot()
      const transition: SessionStateChangedTransition = Object.freeze({
        kind: 'session-state-changed' as const,
        id: transitionId,
        coalescing: 'break' as const,
        before,
        after,
        effects: EMPTY_EFFECTS
      })
      const outcome: SessionTicketOutcome = Object.freeze({
        kind: 'state-changed' as const,
        ticket,
        sequence,
        submittedAgainst,
        transition: transitionId,
        revision: this.#worker.state.id,
        trackChanges: this.#worker.trackChanges,
        projection
      })
      await this.#journal.settle(
        ticket,
        this.checkpoint(this.#retainedDrafts, sequence),
        outcome
      )
      this.#snapshot = after
      this.#settledWatermark = sequence
      this.#publish(transition)
      return Object.freeze({
        kind: 'state-changed' as const,
        transition
      })
    } catch {
      this.#projection = rollbackProjection
      this.#ids.restore(rollbackIds)
      const effect: SessionEffect = Object.freeze({
        id: this.#ids.effect(),
        kind: 'dispatch-failure' as const,
        ticket,
        code: 'precommit-failed' as const,
        status: 'pending' as const
      })
      const effects = Object.freeze([...this.#effects, effect])
      const outcome: SessionTicketOutcome = Object.freeze({
        kind: 'rejected' as const,
        ticket,
        sequence,
        submittedAgainst,
        reason: 'precommit-failed' as const,
        revision: this.#worker.state.id,
        effect
      })
      await this.#journal.settle(
        ticket,
        this.checkpoint(this.#retainedDrafts, sequence, effects),
        outcome
      )
      this.#effects = effects
      this.#settledWatermark = sequence
      return Object.freeze({
        kind: 'rejected' as const,
        reason: 'precommit-failed' as const,
        snapshot: before,
        effect
      })
    }
  }

  async #commitTrackChangesState(
    ticket: IntentId,
    sequence: number,
    submittedAgainst: RevisionId,
    enabled: boolean
  ): Promise<DispatchResult> {
    const before = this.#snapshot
    if (this.#worker.trackChanges === enabled) {
      const outcome: SessionTicketOutcome = Object.freeze({
        kind: 'rejected' as const,
        ticket,
        sequence,
        submittedAgainst,
        reason: 'no-source-change' as const,
        revision: this.#worker.state.id
      })
      await this.#journal.settle(
        ticket,
        this.checkpoint(this.#retainedDrafts, sequence),
        outcome
      )
      this.#settledWatermark = sequence
      return Object.freeze({
        kind: 'rejected' as const,
        reason: 'no-source-change' as const,
        snapshot: before
      })
    }

    const rollbackWorker = this.#worker.checkpoint()
    const rollbackIds = this.#ids.checkpoint()
    const rollbackConfiguration = this.#configuration
    const transitionId = this.#ids.transition()
    try {
      if (await this.#journal.beginCommit(ticket) === 'cancelled') {
        this.#ids.restore(rollbackIds)
        return this.#settleCancelled(ticket, sequence, submittedAgainst)
      }
      this.#worker.setTrackChanges(enabled)
      this.#configuration = Object.freeze({
        ...this.#configuration,
        trackChanges: enabled
      })
      const after = this.#createSnapshot(
        this.#retainedDrafts,
        before.kind === 'complete' ? before.livePlan : undefined
      )
      const transition: SessionStateChangedTransition = Object.freeze({
        kind: 'session-state-changed' as const,
        id: transitionId,
        coalescing: 'break' as const,
        before,
        after,
        effects: EMPTY_EFFECTS
      })
      const outcome: SessionTicketOutcome = Object.freeze({
        kind: 'state-changed' as const,
        ticket,
        sequence,
        submittedAgainst,
        transition: transitionId,
        revision: this.#worker.state.id,
        trackChanges: enabled,
        projection: this.#projection
      })
      await this.#journal.settle(
        ticket,
        this.checkpoint(this.#retainedDrafts, sequence),
        outcome
      )
      this.#snapshot = after
      this.#settledWatermark = sequence
      this.#publish(transition)
      return Object.freeze({
        kind: 'state-changed' as const,
        transition
      })
    } catch {
      this.#worker.restore(rollbackWorker)
      this.#ids.restore(rollbackIds)
      this.#configuration = rollbackConfiguration
      const effect: SessionEffect = Object.freeze({
        id: this.#ids.effect(),
        kind: 'dispatch-failure' as const,
        ticket,
        code: 'precommit-failed' as const,
        status: 'pending' as const
      })
      const effects = Object.freeze([...this.#effects, effect])
      const outcome: SessionTicketOutcome = Object.freeze({
        kind: 'rejected' as const,
        ticket,
        sequence,
        submittedAgainst,
        reason: 'precommit-failed' as const,
        revision: rollbackWorker.id,
        effect
      })
      await this.#journal.settle(
        ticket,
        this.checkpoint(this.#retainedDrafts, sequence, effects),
        outcome
      )
      this.#effects = effects
      this.#settledWatermark = sequence
      return Object.freeze({
        kind: 'rejected' as const,
        reason: 'precommit-failed' as const,
        snapshot: before,
        effect
      })
    }
  }

  async #settleCancelled(
    ticket: IntentId,
    sequence: number,
    submittedAgainst: RevisionId
  ): Promise<DispatchResult> {
    const outcome: SessionTicketOutcome = Object.freeze({
      kind: 'cancelled' as const,
      ticket,
      sequence,
      submittedAgainst,
      reason: 'cancelled' as const,
      revision: this.#worker.state.id
    })
    await this.#journal.settle(
      ticket,
      this.checkpoint(
        this.#retainedDrafts,
        Math.max(this.#settledWatermark, sequence)
      ),
      outcome
    )
    this.#settledWatermark = Math.max(this.#settledWatermark, sequence)
    return Object.freeze({
      kind: 'cancelled' as const,
      reason: 'cancelled' as const,
      snapshot: this.#snapshot
    })
  }

  #requestCancellation(
    state: LiveTicketState
  ): Promise<'requested' | 'too-late' | 'already-terminal' | 'unknown-ticket'> {
    if (state.phase === 'preparing' || state.phase === 'terminal') {
      return Promise.resolve('too-late')
    }
    state.cancelRequested = true
    state.cancelPersistence ??= state.admission.then(() =>
      this.#journal.requestCancel(state.id, this.checkpoint())
    )
    return state.cancelPersistence
  }

  #cancel(ticket: IntentId): SessionOperation<SessionCancelResult> {
    const id = this.#ids.operation()
    const clientSequence = this.#nextClientSequence()
    const terminal = this.#journal.ticketOutcome(ticket)
    if (terminal !== null) {
      return Object.freeze({
        id,
        clientSequence,
        completion: Promise.resolve(
          Object.freeze({
            kind: 'already-terminal' as const,
            ticket,
            outcome: terminal.kind
          })
        )
      })
    }

    const state = this.#liveTickets.get(ticket)
    if (state === undefined) {
      return Object.freeze({
        id,
        clientSequence,
        completion: Promise.resolve(
          Object.freeze({ kind: 'unknown-ticket' as const, ticket })
        )
      })
    }

    const requested = this.#requestCancellation(state)
    const completion = Object.freeze(async(): Promise<SessionCancelResult> => {
      const decision = await requested
      if (decision === 'too-late') {
        return Object.freeze({ kind: 'too-late' as const, ticket })
      }
      if (decision === 'unknown-ticket') {
        return Object.freeze({ kind: 'unknown-ticket' as const, ticket })
      }
      const dispatch = state.completion
      if (dispatch !== undefined) {
        await dispatch
      }
      const outcome = this.#journal.ticketOutcome(ticket)
      if (outcome?.kind === 'cancelled') {
        return Object.freeze({ kind: 'cancelled' as const, ticket })
      }
      if (outcome !== null) {
        return Object.freeze({
          kind: 'already-terminal' as const,
          ticket,
          outcome: outcome.kind
        })
      }
      return Object.freeze({ kind: 'too-late' as const, ticket })
    })()
    return Object.freeze({ id, clientSequence, completion })
  }

  #close(): SessionOperation<SessionCloseResult> {
    const id = this.#ids.operation()
    const clientSequence = this.#nextClientSequence()
    if (this.#lifecycle === 'closed') {
      return Object.freeze({
        id,
        clientSequence,
        completion: Promise.resolve(
          Object.freeze({ kind: 'already-closed' as const })
        )
      })
    }
    if (this.#lifecycle === 'closing') {
      return Object.freeze({
        id,
        clientSequence,
        completion: Promise.resolve(
          Object.freeze({ kind: 'already-closing' as const })
        )
      })
    }

    this.#lifecycle = 'closing'
    for (const state of this.#liveTickets.values()) {
      this.#requestCancellation(state).catch(() => undefined)
    }
    const completion = this.#finishClose().then(
      (): SessionCloseResult => Object.freeze({ kind: 'closed' as const })
    )
    return Object.freeze({ id, clientSequence, completion })
  }

  async #finishClose(): Promise<void> {
    await Promise.all(
      [...this.#liveTickets.values()].map(async(state) => {
        try {
          await state.completion
        } catch {
          // A failed stale writer cannot keep a replacement coordinator open.
        }
      })
    )
    const effects = Object.freeze(
      this.#effects.map((effect): SessionEffect =>
        effect.status === 'pending'
          ? Object.freeze({ ...effect, status: 'cancelled' as const })
          : effect
      )
    )
    await this.#journal.checkpoint(
      this.checkpoint(
        this.#retainedDrafts,
        this.#settledWatermark,
        effects,
        'closed'
      )
    )
    this.#effects = effects
    this.#lifecycle = 'closed'
    for (const lease of this.#leases.values()) {
      lease.released = true
    }
    this.#leases.clear()
    this.#listeners.clear()
  }

  async finishRecoveredClose(): Promise<void> {
    if (this.#lifecycle === 'closing') {
      await this.#finishClose()
    }
  }

  #acknowledgeEffect(
    effectId: SessionEffectId
  ): SessionOperation<EffectAcknowledgementResult> {
    const id = this.#ids.operation()
    const clientSequence = this.#nextClientSequence()
    const completion = this.#enqueue(async(): Promise<EffectAcknowledgementResult> => {
      const effect = this.#effects.find((candidate) => candidate.id === effectId)
      if (effect === undefined) {
        return Object.freeze({
          kind: 'unknown-effect' as const,
          effect: effectId
        })
      }
      if (effect.status !== 'pending') {
        return Object.freeze({
          kind: 'already-terminal' as const,
          effect: effectId,
          status: effect.status
        })
      }
      const effects = Object.freeze(
        this.#effects.map((candidate): SessionEffect =>
          candidate.id === effectId
            ? Object.freeze({ ...candidate, status: 'acknowledged' as const })
            : candidate
        )
      )
      await this.#journal.checkpoint(
        this.checkpoint(
          this.#retainedDrafts,
          this.#settledWatermark,
          effects
        )
      )
      this.#effects = effects
      return Object.freeze({
        kind: 'acknowledged' as const,
        effect: effectId
      })
    })
    return Object.freeze({ id, clientSequence, completion })
  }

  #flush(reason: FlushReason): SessionOperation<FlushResult> {
    return this.#requestSourceLease('flush', reason)
  }

  #materializeStatic<Consumer extends StaticConsumer>(
    request: StaticConsumerRequest<Consumer>
  ): SessionOperation<SessionStaticMaterializationResult<Consumer>> {
    if (this.#lifecycle !== 'open') {
      throw new Error('Document session is closed')
    }
    const id = this.#ids.operation()
    const clientSequence = this.#nextClientSequence()
    const stableRequest = Object.freeze({
      consumer: request.consumer,
      view: request.view,
      structure: Object.freeze({
        headingAnchors: request.structure.headingAnchors,
        tableOfContents: Object.freeze({
          title: request.structure.tableOfContents.title,
          includeTopHeading:
            request.structure.tableOfContents.includeTopHeading
        })
      })
    }) as StaticConsumerRequest<Consumer>
    const completion = this.#enqueue(
      (): SessionStaticMaterializationResult<Consumer> => {
        const state = this.#worker.state
        if (!('markupView' in state)) {
          return Object.freeze({
            kind: 'unavailable' as const,
            reason: 'source-only-revision' as const,
            revision: Object.freeze({
              kind: 'source-only' as const,
              session: state.session,
              id: state.id,
              fatalDiagnostic: state.revision.fatalDiagnostic
            })
          })
        }
        return Object.freeze({
          kind: 'materialized' as const,
          revision: Object.freeze({
            kind: 'complete' as const,
            session: state.session,
            id: state.id,
            sourceHash: state.revision.sourceHash,
            semanticHash: state.revision.semanticHash
          }),
          artifact: materializeStaticConsumer(
            state.revision,
            stableRequest
          )
        })
      }
    )
    return Object.freeze({ id, clientSequence, completion })
  }

  #preflightCut(
    preparation: CutPreparation,
    consumer: 'cut' | 'cut-table'
  ): void {
    const state = this.#worker.state
    const range = preparation.selection
    const next = `${String(state.id)}:cut-preflight` as RevisionId
    if (preparation.view === 'source') {
      if (consumer !== 'cut') {
        throw new TypeError('Source cut cannot use a table consumer')
      }
      const retained = 'markupView' in state
        ? state.sourceSelection
        : state.selection
      const target: SourceModelSelection = Object.freeze({
        session: state.session,
        revision: state.id,
        view: 'source',
        anchor: Object.freeze({
          offset: range.start,
          affinity: (
            retained.anchor.offset === range.start
              ? retained.anchor.affinity
              : 'next'
          )
        }),
        focus: Object.freeze({
          offset: range.end,
          affinity: (
            retained.focus.offset === range.end
              ? retained.focus.affinity
              : range.start === range.end
                ? 'next'
                : 'previous'
          )
        })
      })
      this.#worker.prepareSourceEdit(
        target,
        '',
        Object.freeze({
          anchor: Object.freeze({
            offset: range.start,
            affinity: 'next'
          }),
          focus: Object.freeze({
            offset: range.start,
            affinity: 'next'
          })
        }),
        next
      )
      return
    }

    if (!('markupView' in state)) {
      throw new TypeError('Markup cut requires a complete revision')
    }
    const retained = state.selection
    const retainedStart = Math.min(
      retained.anchor.offset,
      retained.focus.offset
    )
    const retainedEnd = Math.max(
      retained.anchor.offset,
      retained.focus.offset
    )
    const target: MarkupModelSelection = (
      retainedStart === range.start &&
      retainedEnd === range.end
    )
      ? retained
      : Object.freeze({
        session: state.session,
        revision: state.id,
        view: 'markup',
        anchor: Object.freeze({
          offset: range.start,
          affinity: 'next'
        }),
        focus: Object.freeze({
          offset: range.end,
          affinity: range.start === range.end ? 'next' : 'previous'
        })
      })
    if (consumer === 'cut-table') {
      this.#worker.prepareTableCellContentsDeletion(target, next)
      return
    }
    this.#worker.prepareDeletion(target, next)
  }

  #materializeClipboard(
    request: ClipboardConsumerRequest
  ): SessionOperation<SessionClipboardMaterializationResult> {
    if (this.#lifecycle !== 'open') {
      throw new Error('Document session is closed')
    }
    const id = this.#ids.operation()
    const clientSequence = this.#nextClientSequence()
    const stableRequest: ClipboardConsumerRequest =
      request.consumer === 'copy-heading-link'
        ? Object.freeze({
          consumer: request.consumer,
          view: request.view,
          targetNodeId: request.targetNodeId
        })
        : Object.freeze({
          consumer: request.consumer,
          view: request.view,
          selection: Object.freeze({ ...request.selection })
        })
    const completion = this.#enqueue(() => {
      const state = this.#worker.state
      if (!('markupView' in state)) {
        return Object.freeze({
          kind: 'unavailable' as const,
          reason: 'source-only-revision' as const
        })
      }
      const artifact = materializeClipboardConsumer(
        state.revision,
        stableRequest
      )
      if (artifact.kind === 'cut-preparation') {
        if (
          stableRequest.consumer !== 'cut' &&
          stableRequest.consumer !== 'cut-table'
        ) {
          throw new TypeError('Cut preparation has no cut consumer')
        }
        this.#preflightCut(artifact, stableRequest.consumer)
      }
      return Object.freeze({
        kind: 'materialized' as const,
        revision: Object.freeze({
          kind: 'complete' as const,
          session: state.session,
          id: state.id,
          sourceHash: state.revision.sourceHash,
          semanticHash: state.revision.semanticHash
        }),
        artifact
      })
    })
    return Object.freeze({ id, clientSequence, completion })
  }

  #requestSourceLease(
    operation: 'flush' | 'prepare-persistence',
    reason: FlushReason | PersistenceReason
  ): SessionOperation<FlushResult> {
    if (this.#lifecycle !== 'open') {
      throw new Error('Document session is closed')
    }
    const id = this.#ids.operation()
    const clientSequence = this.#nextClientSequence()
    const completion = this.#enqueue(() =>
      this.#performSourceLease(id, clientSequence, operation, reason)
    )

    return Object.freeze({ id, clientSequence, completion })
  }

  async #performSourceLease(
    _id: SessionOperationId,
    _clientSequence: number,
    _operation: 'flush' | 'prepare-persistence',
    _reason: FlushReason | PersistenceReason
  ): Promise<FlushResult> {
    await this.#journal.checkpoint(this.checkpoint())

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
    const previousReopenSemanticHashes = this.#reopenSemanticHashes
    this.#reopenSemanticHashes = Object.freeze(
      [
        ...this.#reopenSemanticHashes.filter(
          (hash) => hash !== revision.semanticHash
        ),
        revision.semanticHash
      ].slice(-DOCUMENT_RESOURCE_POLICY_V1.maximumJournalOutcomes)
    )
    try {
      await this.#journal.checkpoint(this.checkpoint())
    } catch (error) {
      this.#leases.delete(leaseState.id)
      this.#reopenSemanticHashes = previousReopenSemanticHashes
      throw error
    }
    const source = this.#createLease(leaseState)

    return Object.freeze({
      kind: 'flushed' as const,
      watermark,
      revision,
      facts: this.#snapshot.facts,
      source
    })
  }

  #createLease(state: LeaseState): CanonicalSourceLease {
    const readChunks = Object.freeze(() => this.#createChunkStream(state))
    const release = Object.freeze((reason: LeaseReleaseReason) => this.#releaseLease(state, reason))

    return authenticateCanonicalSourceLease(Object.freeze({
      id: state.id,
      watermark: state.watermark,
      revision: state.revision,
      sourceHash: state.revision.sourceHash,
      readChunks,
      release
    }))
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
    _id: SessionOperationId,
    _clientSequence: number,
    state: LeaseState,
    _reason: LeaseReleaseReason
  ): Promise<LeaseReleaseResult> {
    await this.#journal.checkpoint(this.checkpoint())
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

export async function createSessionCoordinator(
  options: DocumentSessionOpenOptions
): Promise<SessionCoordinator> {
  const execution = options.executionControl === undefined
    ? undefined
    : createParseExecutionAccumulator(options.executionControl)
  const configuration = Object.freeze({
    authoringTextPolicy:
      options.configuration?.authoringTextPolicy ?? 'nearest-owner-eol-v1'
  })
  const identity = [
    revisionSemanticHashV1(
      sourceHashV1(options.source.text, execution?.stage()),
      options.parseConfiguration
    ),
    configuration.authoringTextPolicy
  ].join(':')
  const storage =
    options.durability?.storage ?? createMemoryDocumentSessionJournalStorage()
  const journal = await DurableSessionJournal.open(
    storage,
    options.durability?.key ?? 'ephemeral',
    identity
  )
  const coordinator = new SessionCoordinator(
    execution === undefined
      ? options
      : Object.freeze({
        ...options,
        executionControl: execution.stage()
      }),
    journal,
    journal.recoveryCheckpoint
  )
  await journal.initialize(coordinator.checkpoint())
  await coordinator.recoverPendingIngress()
  await coordinator.finishRecoveredClose()
  return coordinator
}

export async function recoverSessionCoordinator(
  durability: DocumentSessionDurability,
  executionControl?: ParseExecutionControl
): Promise<SessionCoordinator> {
  const journal = await DurableSessionJournal.recover(
    durability.storage,
    durability.key
  )
  const recovery = journal.recoveryCheckpoint
  if (recovery === null) {
    throw new Error('Document session journal has no recovery checkpoint')
  }
  const options: DocumentSessionOpenOptions = Object.freeze({
    source: createSourceSnapshot(recovery.worker.source),
    parseConfiguration: recovery.worker.configuration,
    configuration: Object.freeze({
      authoringTextPolicy: 'nearest-owner-eol-v1' as const
    }),
    initialView: 'markup' as const,
    trackChanges: recovery.worker.trackChanges,
    initialSelection: recovery.worker.selection,
    durability,
    ...(executionControl === undefined ? {} : { executionControl })
  })
  const coordinator = new SessionCoordinator(options, journal, recovery)
  await coordinator.recoverPendingIngress()
  await coordinator.finishRecoveredClose()
  return coordinator
}
