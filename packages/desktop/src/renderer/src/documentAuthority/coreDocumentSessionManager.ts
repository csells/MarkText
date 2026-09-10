import { copyFormatAction, copyPreparedOperation } from './editorCoreBinding'
import type {
  DocumentClipboardSelection,
  DocumentSelection,
  DocumentTableSelection,
  DocumentModelTextSelection,
  SourceRange
} from '@marktext/document-core'
import {
  DOCUMENT_RESOURCE_POLICY_V1,
  copyClipboardAction,
  copyDocumentSelection,
  type MarkdownOptions,
  type MarkdownProjectionName
} from '@marktext/document-core'

import type {
  EditorCoreApplyOutcome,
  EditorCoreBinding,
  EditorCoreObservation,
  EditorCoreSubmitInput
} from './editorCoreBinding'
import type { CoreHistorySnapshot } from './coreProtocol'
import type {
  CoreConsumerSearchReplacement,
  CoreConsumerProjection,
  CoreDisplayProjection,
  CoreSourceSyntaxReply,
  CorePlainTextViewReply
} from './coreProtocol'
import { createCoreConsumerProjectionRegistry } from './coreConsumerProjectionRegistry'
import type { CanonicalLineEnding } from './canonicalEolIndex'
import type { DocumentSaveIdentity } from '@shared/types/files'
import type { CoreRecoveryDraftInput } from '@shared/types/coreRecoveryDraft'

export interface CoreDocumentSessionManagerOptions {
  readonly createBinding: (documentId: string) => EditorCoreBinding
}

export interface CoreDocumentOpenInput {
  readonly documentId: string
  readonly source: string
  readonly options?: Readonly<Partial<MarkdownOptions>>
  readonly lineEnding: CanonicalLineEnding
}

export interface CoreDocumentViewLease {
  readonly documentId: string
  readonly identity: DocumentSaveIdentity
  readonly binding: EditorCoreBinding
  readonly lineEnding: CanonicalLineEnding
  sourceAtBarrier(): Promise<string>
  consumerProjection(): CoreConsumerProjection | undefined
  consumerProjectionAtBarrier(): Promise<CoreConsumerProjection>
  displayProjectionAtBarrier(name: MarkdownProjectionName): Promise<CoreDisplayProjection>
  selectionProjectionAtBarrier(
    range: SourceRange | DocumentTableSelection | DocumentModelTextSelection
  ): Promise<CoreConsumerProjection>
  replaceConsumerSearchAtBarrier(
    identity: DocumentSaveIdentity,
    replacements: readonly CoreConsumerSearchReplacement[]
  ): Promise<EditorCoreApplyOutcome>
  projectAcknowledgedSourceSyntax(revision: number): CoreSourceSyntaxReply
  projectAcknowledgedPlainTextView(revision: number): CorePlainTextViewReply
  faultView(error: unknown): void
  settleView(barrier: () => Promise<unknown>, isSettled?: () => boolean): void
  onHandoff(cleanup: () => void): void
  setRecoveryDraftCapture(capture: (error: unknown) => CoreRecoveryDraftInput | undefined): void
  captureRecoveryDraft(error: unknown): CoreRecoveryDraftInput | undefined
}

export interface CoreDocumentSessionManager {
  open(input: CoreDocumentOpenInput): void
  lease(documentId: string): CoreDocumentViewLease
  replace(
    lease: CoreDocumentViewLease,
    input: CoreDocumentOpenInput
  ): Promise<CoreDocumentViewLease>
  recover(lease: CoreDocumentViewLease): Promise<CoreDocumentViewLease>
  activate(documentId: string): Promise<void>
  handoff(lease: CoreDocumentViewLease): Promise<void>
  isSaveSnapshotCurrent(documentId: string, identity: DocumentSaveIdentity): boolean
  saveBarrier(documentId: string): Promise<
    Readonly<{
      readonly documentId: string
      readonly revision: number
      readonly identity: DocumentSaveIdentity
      readonly source: string
      readonly lineEnding: CanonicalLineEnding
    }>
  >
  plainTextViewBarrier(documentId: string): Promise<CorePlainTextViewReply>
  abort(documentId: string): void
  close(documentId: string): Promise<void>
  /** Retire input owners while preserving actors and history until close or cancellation. */
  prepareClose(retireInput: () => Promise<void>): Promise<() => void>
}

type CoreDocumentSaveResult = Readonly<{
  readonly documentId: string
  readonly revision: number
  readonly identity: DocumentSaveIdentity
  readonly source: string
  readonly lineEnding: CanonicalLineEnding
}>

type RecoveryCheckpoint = Readonly<{
  readonly source: string
  readonly options?: Readonly<Partial<MarkdownOptions>>
  readonly recoveryHistory: CoreHistorySnapshot
}>

type RecoveryJournalEntry = Readonly<{
  readonly input: EditorCoreSubmitInput
}>

interface Session {
  readonly documentId: string
  readonly binding: EditorCoreBinding
  readonly lineEnding: CanonicalLineEnding
  currentIdentity: DocumentSaveIdentity
  checkpoint: RecoveryCheckpoint
  journal: RecoveryJournalEntry[]
  journalVersion: number
  leaseCount: number
  barrierFailure?: Error
  terminalFault?: Error
  viewFault?: Error
  settleView?: () => Promise<unknown>
  isViewSettled?: () => boolean
  handoffCleanup?: () => void
  releaseView?: () => void
  sourceBarrier?: Promise<CoreDocumentSaveResult>
  closing?: Promise<void>
  recovery?: Promise<CoreDocumentViewLease>
}

const maximumRecoveryJournalEntries = Math.min(
  DOCUMENT_RESOURCE_POLICY_V1.maximumJournalIngress,
  DOCUMENT_RESOURCE_POLICY_V1.maximumJournalOutcomes
)

const copySubmitInput = (input: EditorCoreSubmitInput): EditorCoreSubmitInput => {
  const projections = Object.freeze(
    input.projections.map((projection) =>
      projection === 'markup'
        ? projection
        : Object.freeze({
          ...projection,
          annotationRange: Object.freeze({ ...projection.annotationRange })
        })
    )
  )
  if (input.kind === 'apply-prepared') {
    return Object.freeze({
      kind: input.kind,
      target: input.target,
      operation: copyPreparedOperation(input.operation),
      projections
    })
  }
  if (input.kind === 'source-input') {
    return Object.freeze({
      kind: input.kind,
      action: Object.freeze({
        edits: Object.freeze(input.action.edits.map((edit) => Object.freeze({ ...edit }))),
        beforeSelection: copyDocumentSelection(
          input.action.beforeSelection,
          Number.MAX_SAFE_INTEGER
        ),
        afterSelection: copyDocumentSelection(input.action.afterSelection, Number.MAX_SAFE_INTEGER)
      }),
      ...(input.nativeHistoryGroup === undefined
        ? {}
        : { nativeHistoryGroup: input.nativeHistoryGroup }),
      projections
    })
  }
  if (input.kind === 'clipboard') {
    return Object.freeze({
      kind: input.kind,
      action: copyClipboardAction(input.action),
      projections
    })
  }
  if (input.kind === 'format') {
    return Object.freeze({
      kind: input.kind,
      action: copyFormatAction(input.action),
      projections
    })
  }
  if (input.kind === 'input') {
    return Object.freeze({
      kind: input.kind,
      action: Object.freeze({
        ...input.action,
        ...('range' in input.action
          ? {
            range:
                'kind' in input.action.range
                  ? copyDocumentSelection(input.action.range, Number.MAX_SAFE_INTEGER)
                  : Object.freeze({ ...input.action.range })
          }
          : {}),
        ...('change' in input.action
          ? input.action.command === 'changeList'
            ? {
              command: input.action.command,
              change: Object.freeze({ ...input.action.change }),
              listOptions: Object.freeze({ ...input.action.listOptions })
            }
            : input.action.command === 'changeHeading'
              ? { command: input.action.command, change: Object.freeze({ ...input.action.change }) }
              : input.action.command === 'changeBlockquote'
                ? {
                  command: input.action.command,
                  change: Object.freeze({ ...input.action.change })
                }
                : {
                  command: input.action.command,
                  change: Object.freeze({ ...input.action.change })
                }
          : {}),
        ...('target' in input.action
          ? {
            target: Object.freeze({
              ...input.action.target,
              table: Object.freeze({ ...input.action.target.table })
            })
          }
          : {}),
        selection: copyDocumentSelection(input.action.selection, Number.MAX_SAFE_INTEGER),
        options: Object.freeze({ ...input.action.options })
      }),
      tracked: input.tracked,
      ...(input.nativeHistoryGroup === undefined
        ? {}
        : { nativeHistoryGroup: input.nativeHistoryGroup }),
      projections
    })
  }
  if (input.kind === 'configure') {
    return Object.freeze({
      kind: input.kind,
      options: Object.freeze({ ...input.options }),
      projections
    })
  }
  if (!('edits' in input) && input.kind === 'resolve') {
    return Object.freeze({
      kind: 'resolve',
      authoredRevision: input.authoredRevision,
      annotation:
        input.annotation.kind === 'commented-span'
          ? Object.freeze({
            kind: input.annotation.kind,
            range: Object.freeze({ ...input.annotation.range }),
            highlightRange: Object.freeze({ ...input.annotation.highlightRange }),
            commentRange: Object.freeze({ ...input.annotation.commentRange })
          })
          : Object.freeze({
            kind: input.annotation.kind,
            range: Object.freeze({ ...input.annotation.range })
          }),
      decision: input.decision,
      projections
    })
  }
  if (!('edits' in input) && input.kind === 'replace-consumer-search') {
    return Object.freeze({
      kind: input.kind,
      authoredRevision: input.authoredRevision,
      replacements: Object.freeze(
        input.replacements.map((replacement) =>
          Object.freeze({
            match: Object.freeze({
              ...replacement.match,
              path: Object.freeze([...replacement.match.path])
            }),
            insert: replacement.insert
          })
        )
      ),
      projections
    })
  }
  if (!('edits' in input) && input.kind === 'resolve-all') {
    return Object.freeze({ kind: input.kind, decision: input.decision, projections })
  }
  if (!('edits' in input) && input.kind === 'edit-comment') {
    return Object.freeze({
      kind: 'edit-comment',
      authoredRevision: input.authoredRevision,
      annotation:
        input.annotation.kind === 'commented-span'
          ? Object.freeze({
            kind: input.annotation.kind,
            range: Object.freeze({ ...input.annotation.range }),
            highlightRange: Object.freeze({ ...input.annotation.highlightRange }),
            commentRange: Object.freeze({ ...input.annotation.commentRange })
          })
          : Object.freeze({
            kind: input.annotation.kind,
            range: Object.freeze({ ...input.annotation.range })
          }),
      text: input.text,
      projections
    })
  }
  if (!('edits' in input) && input.kind === 'author') {
    return Object.freeze({
      kind: 'author',
      form: input.form,
      range: Object.freeze({ ...input.range }),
      text: input.text,
      projections
    })
  }
  if (!('edits' in input) && input.kind === 'track') {
    return Object.freeze({
      kind: 'track',
      ...(input.nativeHistoryGroup === undefined
        ? {}
        : { nativeHistoryGroup: input.nativeHistoryGroup }),
      range: Object.freeze({ ...input.range }),
      text: input.text,
      projections
    })
  }
  if (!('edits' in input)) {
    return Object.freeze({ kind: input.kind, projections })
  }
  return Object.freeze({
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(input.nativeHistoryGroup === undefined
      ? {}
      : { nativeHistoryGroup: input.nativeHistoryGroup }),
    edits: Object.freeze(input.edits.map((edit) => Object.freeze({ ...edit }))),
    projections
  })
}

const resolvedPreparedInput = (
  input: EditorCoreSubmitInput,
  outcome: EditorCoreApplyOutcome
): EditorCoreSubmitInput => {
  if (input.kind !== 'apply-prepared' || outcome.type !== 'applied') return input
  const selection = outcome.preparedSelection
  if (selection === undefined) throw new Error('Prepared operation lost its model-owned target')
  if (input.operation.kind === 'clipboard') {
    if (input.operation.action.kind === 'table') {
      if (!('kind' in selection) || selection.kind !== 'table') { throw new Error('Prepared table paste lost its rectangle') }
      return copySubmitInput({
        kind: 'clipboard',
        action: { ...input.operation.action, selection },
        projections: input.projections
      })
    }
    if ('start' in selection || selection.kind === 'table') { throw new Error('Prepared text paste lost its text target') }
    return copySubmitInput({
      kind: 'clipboard',
      action: { ...input.operation.action, selection },
      projections: input.projections
    })
  }
  if (!('start' in selection)) throw new Error('Prepared image has no source image target')
  return copySubmitInput({
    kind: 'format',
    action: { ...input.operation.action, selection },
    projections: input.projections
  })
}

const recoveryReplayInput = (
  input: EditorCoreSubmitInput,
  revision: number
): EditorCoreSubmitInput =>
  !('edits' in input) &&
  (input.kind === 'resolve' ||
    input.kind === 'edit-comment' ||
    input.kind === 'replace-consumer-search')
    ? Object.freeze({ ...input, authoredRevision: revision })
    : input

const optionsAfterJournal = (
  initial: Readonly<Partial<MarkdownOptions>> | undefined,
  journal: readonly RecoveryJournalEntry[]
): Readonly<Partial<MarkdownOptions>> | undefined =>
  journal.reduce(
    (options, entry) =>
      entry.input.kind === 'configure'
        ? Object.freeze({ ...options, ...entry.input.options })
        : options,
    initial
  )

const checkpointOf = (input: CoreDocumentOpenInput): RecoveryCheckpoint =>
  Object.freeze({
    source: input.source,
    recoveryHistory: Object.freeze({ undo: Object.freeze([]), redo: Object.freeze([]) }),
    ...(input.options === undefined ? {} : { options: Object.freeze({ ...input.options }) })
  })

export function createCoreDocumentSessionManager(
  options: CoreDocumentSessionManagerOptions
): CoreDocumentSessionManager {
  const sessions = new Map<string, Session>()
  const consumerProjections = createCoreConsumerProjectionRegistry()
  const openingDocumentIds = new Set<string>()
  const releaseLease = new WeakMap<CoreDocumentViewLease, () => void>()
  const leaseSession = new WeakMap<CoreDocumentViewLease, Session>()
  let activeDocumentId: string | undefined
  let windowClosePending = false
  const assertViewAdmission = (): void => {
    if (windowClosePending) throw new Error('Core window close is being prepared')
  }

  const sessionOf = (documentId: string): Session => {
    const session = sessions.get(documentId)
    if (session === undefined) throw new Error('Core document is not open')
    return session
  }
  const currentSessionOf = (lease: CoreDocumentViewLease): Session => {
    const session = leaseSession.get(lease)
    if (session === undefined || sessions.get(lease.documentId) !== session) {
      throw new Error('Core document view lease belongs to a retired generation')
    }
    return session
  }
  // The sole model accepts edits and publishes its checkpoint in this turn.
  // View settlement and durable persistence retain their independent barriers.
  const maintainRecoveryJournal = (session: Session): void => {
    if (
      session.journal.length < maximumRecoveryJournalEntries ||
      session.recovery !== undefined ||
      session.terminalFault !== undefined ||
      sessions.get(session.documentId) !== session
    ) { return }
    try {
      const result = session.binding.sourceAtBarrier()
      if (
        result.type !== 'source' ||
        result.session !== session.currentIdentity.generation ||
        result.revision !== session.currentIdentity.revision
      ) {
        throw new Error('Core document recovery maintenance barrier is stale')
      }
      const checkpointOptions = optionsAfterJournal(session.checkpoint.options, session.journal)
      session.checkpoint = Object.freeze({
        source: result.source,
        recoveryHistory: result.recoveryHistory,
        ...(checkpointOptions === undefined ? {} : { options: checkpointOptions })
      })
      session.journal = []
    } catch (error) {
      const failure =
        error instanceof Error ? error : new Error('Core document recovery maintenance failed')
      session.barrierFailure = failure
      session.terminalFault = failure
    }
  }

  const manager: CoreDocumentSessionManager = {
    open(input: CoreDocumentOpenInput): void {
      assertViewAdmission()
      if (sessions.has(input.documentId) || openingDocumentIds.has(input.documentId)) {
        throw new Error('Core document is already open')
      }
      openingDocumentIds.add(input.documentId)
      const binding = options.createBinding(input.documentId)
      try {
        const opened = binding.open({
          documentId: input.documentId,
          source: input.source,
          ...(input.options === undefined ? {} : { options: input.options })
        })
        if (opened.type !== 'opened') {
          throw new Error('Core document open was rejected')
        }
        sessions.set(input.documentId, {
          documentId: input.documentId,
          binding,
          lineEnding: input.lineEnding,
          currentIdentity: Object.freeze({
            generation: opened.session,
            revision: opened.revision
          }),
          checkpoint: checkpointOf(input),
          journal: [],
          journalVersion: 0,
          leaseCount: 0
        })
        activeDocumentId ??= input.documentId
      } catch (error) {
        binding.dispose()
        throw error
      } finally {
        openingDocumentIds.delete(input.documentId)
      }
    },
    lease(documentId: string): CoreDocumentViewLease {
      assertViewAdmission()
      const session = sessionOf(documentId)
      if (session.leaseCount !== 0) {
        throw new Error('Core document already has a live view')
      }
      session.leaseCount += 1
      let released = false
      let captureDraft: ((error: unknown) => CoreRecoveryDraftInput | undefined) | undefined
      const viewObservers = new Set<(event: EditorCoreObservation) => void>()
      const assertSelectionOwner = (): void => {
        if (released || sessions.get(documentId) !== session) { throw new Error('Core document view lease is released') }
        if (session.recovery !== undefined || session.terminalFault !== undefined) { throw new Error('Core document recovery is required') }
        if (session.barrierFailure !== undefined) throw session.barrierFailure
      }
      const viewBinding: EditorCoreBinding = Object.freeze({
        retainSelection(selection: DocumentClipboardSelection) {
          assertSelectionOwner()
          return session.binding.retainSelection(selection)
        },
        retainedSelectionAtBarrier(id: string) {
          assertSelectionOwner()
          return session.binding.retainedSelectionAtBarrier(id)
        },
        releaseSelection(id: string) {
          assertSelectionOwner()
          return session.binding.releaseSelection(id)
        },
        mode: 'core',
        durableSourceAuthority: 'core',
        open: () => {
          throw new Error('Core session is already open')
        },
        submit(input: EditorCoreSubmitInput) {
          if (released) throw new Error('Core document view lease is released')
          if (session.recovery !== undefined || session.terminalFault !== undefined) {
            throw new Error('Core document Worker recovery is required')
          }
          if (session.journal.length >= maximumRecoveryJournalEntries) {
            throw new Error('Core document recovery journal requires a checkpoint')
          }
          // A source reply already in flight names the revision from before
          // this transaction. Future barriers must issue a fresh actor request;
          // callers already holding the older Promise may still finish saving
          // that explicitly selected revision.
          session.sourceBarrier = undefined
          session.journalVersion += 1
          const journalInput = copySubmitInput(input)
          let submission: ReturnType<EditorCoreBinding['submit']>
          try {
            submission = session.binding.submit(journalInput)
          } catch (error) {
            const failure =
              error instanceof Error ? error : new Error('Core document submission failed')
            session.barrierFailure = failure
            session.terminalFault = failure
            throw failure
          }
          const outcome = submission.acknowledged
          if (outcome.type === 'applied') {
            session.currentIdentity = Object.freeze({
              generation: submission.identity.generation,
              revision: outcome.revision
            })
            const acceptedInput = resolvedPreparedInput(journalInput, outcome)
            if (
              (acceptedInput.kind !== 'source-input' &&
                acceptedInput.kind !== 'input' &&
                acceptedInput.kind !== 'format' &&
                acceptedInput.kind !== 'clipboard') ||
              outcome.change.appliedEdits.length > 0
            ) {
              session.journal.push(Object.freeze({ input: acceptedInput }))
            }
          } else if (
            !(
              outcome.type === 'rejected' &&
              (outcome.reason === 'history-empty' ||
                outcome.reason === 'no-change' ||
                (outcome.reason === 'history-resource' &&
                  !('edits' in journalInput) &&
                  journalInput.kind !== 'track' &&
                  journalInput.kind !== 'input' &&
                  journalInput.kind !== 'source-input') ||
                (outcome.reason === 'stale-base' &&
                  (journalInput.kind === 'resolve' ||
                    journalInput.kind === 'edit-comment' ||
                    journalInput.kind === 'replace-consumer-search')) ||
                outcome.reason === 'annotation-not-found' ||
                outcome.reason === 'resolution-invalid' ||
                outcome.reason === 'author-invalid' ||
                outcome.reason === 'prepared-selection-unavailable' ||
                outcome.reason === 'prepared-selection-conflict' ||
                outcome.reason === 'consumer-search-match-invalid')
            )
          ) {
            session.barrierFailure = new Error(
              `Core document requires reconciliation: ${outcome.type}`
            )
          }
          maintainRecoveryJournal(session)
          const event = Object.freeze({ identity: submission.identity, outcome })
          for (const observer of viewObservers) observer(event)
          return submission
        },
        sourceAtBarrier: () => {
          throw new Error('Core view cannot bypass the session save barrier')
        },
        sourceSelectionAtBarrier: (selection: DocumentSelection) => {
          if (released || sessions.get(documentId) !== session) { throw new Error('Core document view lease is released') }
          if (session.recovery !== undefined || session.terminalFault !== undefined) { throw new Error('Core document recovery is required') }
          if (session.barrierFailure !== undefined) throw session.barrierFailure
          return session.binding.sourceSelectionAtBarrier(selection)
        },
        sourceSyntaxAtBarrier: () => {
          throw new Error('Core view cannot bypass the session projection barrier')
        },
        plainTextViewAtBarrier: () => {
          throw new Error('Core view cannot bypass the session projection barrier')
        },
        consumerProjectionAtBarrier: () => {
          throw new Error('Core view cannot bypass the session consumer projection barrier')
        },
        displayProjectionAtBarrier: () => {
          throw new Error('Core view cannot bypass the session display projection barrier')
        },
        selectionProjectionAtBarrier: () => {
          throw new Error('Core view cannot bypass the session selection projection barrier')
        },
        reviewItemAtBarrier: (
          direction: 'next' | 'previous',
          from: number,
          includeOverview?: boolean
        ) => {
          if (released) {
            return (() => {
              throw new Error('Core document view lease is released')
            })()
          }

          if (released || sessions.get(documentId) !== session) {
            throw new Error('Core document review generation changed')
          }
          if (session.barrierFailure !== undefined) throw session.barrierFailure
          return session.binding.reviewItemAtBarrier(direction, from, includeOverview)
        },
        observe(listener: (event: EditorCoreObservation) => void) {
          if (released) throw new Error('Core document view lease is released')
          viewObservers.add(listener)
          return () => {
            viewObservers.delete(listener)
          }
        },
        dispose: () => {
          throw new Error('Core document view cannot dispose its session')
        }
      })
      const lease: CoreDocumentViewLease = Object.freeze({
        documentId,
        get identity(): DocumentSaveIdentity {
          return session.currentIdentity
        },
        binding: viewBinding,
        lineEnding: session.lineEnding,
        async sourceAtBarrier(): Promise<string> {
          if (released) {
            throw new Error('Core document view lease is released')
          }
          const ownedSession = currentSessionOf(lease)
          const snapshot = await manager.saveBarrier(documentId)
          if (released || sessions.get(documentId) !== ownedSession) {
            throw new Error('Core document source barrier generation changed')
          }
          return snapshot.source
        },
        consumerProjection(): CoreConsumerProjection | undefined {
          if (released || sessions.get(documentId) !== session) return undefined
          return consumerProjections.read(documentId, session.currentIdentity)
        },
        async displayProjectionAtBarrier(
          name: MarkdownProjectionName
        ): Promise<CoreDisplayProjection> {
          if (released) throw new Error('Core document view lease is released')
          if (session.recovery !== undefined || session.terminalFault !== undefined) {
            throw new Error('Core document Worker recovery is required')
          }
          await session.settleView?.()

          if (released || sessions.get(documentId) !== session) {
            throw new Error('Core document display projection generation changed')
          }
          if (session.barrierFailure !== undefined) throw session.barrierFailure
          const barrier = session.binding.displayProjectionAtBarrier
          if (barrier === undefined) {
            throw new Error('Core document display projection is unavailable')
          }
          const identity = session.currentIdentity
          const result = barrier(name)
          if (
            result.type !== 'display-projection' ||
            result.projection.name !== name ||
            result.session !== identity.generation ||
            result.revision !== identity.revision ||
            released ||
            sessions.get(documentId) !== session ||
            session.currentIdentity.generation !== identity.generation ||
            session.currentIdentity.revision !== identity.revision
          ) {
            throw new Error('Core document display projection barrier is stale')
          }
          return result.projection
        },
        async consumerProjectionAtBarrier(): Promise<CoreConsumerProjection> {
          if (released) throw new Error('Core document view lease is released')
          if (session.recovery !== undefined || session.terminalFault !== undefined) {
            throw new Error('Core document Worker recovery is required')
          }
          await session.settleView?.()

          if (released || sessions.get(documentId) !== session) {
            throw new Error('Core document consumer projection generation changed')
          }
          if (session.barrierFailure !== undefined) throw session.barrierFailure
          const barrier = session.binding.consumerProjectionAtBarrier
          if (barrier === undefined) {
            throw new Error('Core document consumer projection is unavailable')
          }
          const identity = session.currentIdentity
          const cached = consumerProjections.read(documentId, identity)
          if (cached !== undefined) return cached
          const result = barrier()
          if (
            result.type !== 'consumer-projection' ||
            result.session !== identity.generation ||
            result.revision !== identity.revision
          ) {
            throw new Error('Core document consumer projection barrier is stale')
          }
          consumerProjections.publish(documentId, identity, result.projection)
          return result.projection
        },
        async selectionProjectionAtBarrier(
          range: SourceRange | DocumentTableSelection | DocumentModelTextSelection
        ): Promise<CoreConsumerProjection> {
          if (released) throw new Error('Core document view lease is released')
          if (session.recovery !== undefined || session.terminalFault !== undefined) {
            throw new Error('Core document Worker recovery is required')
          }
          await session.settleView?.()

          if (released || sessions.get(documentId) !== session) {
            throw new Error('Core document selection projection generation changed')
          }
          if (session.barrierFailure !== undefined) throw session.barrierFailure
          const identity = session.currentIdentity
          const result = session.binding.selectionProjectionAtBarrier(range)
          if (
            result.type !== 'selection-projection' ||
            result.session !== identity.generation ||
            result.revision !== identity.revision ||
            released ||
            sessions.get(documentId) !== session ||
            session.currentIdentity.generation !== identity.generation ||
            session.currentIdentity.revision !== identity.revision
          ) {
            throw new Error('Core document selection projection barrier is stale')
          }
          return result.projection
        },
        async replaceConsumerSearchAtBarrier(
          identity: DocumentSaveIdentity,
          replacements: readonly CoreConsumerSearchReplacement[]
        ): Promise<EditorCoreApplyOutcome> {
          if (released) throw new Error('Core document view lease is released')
          if (session.recovery !== undefined || session.terminalFault !== undefined) {
            throw new Error('Core document Worker recovery is required')
          }
          if (
            identity.generation !== session.currentIdentity.generation ||
            consumerProjections.read(documentId, identity) === undefined
          ) {
            throw new Error('Core document consumer search identity is unavailable')
          }
          await session.settleView?.()

          if (released || sessions.get(documentId) !== session) {
            throw new Error('Core document consumer search generation changed')
          }
          if (session.barrierFailure !== undefined) throw session.barrierFailure
          return viewBinding.submit({
            kind: 'replace-consumer-search',
            authoredRevision: identity.revision,
            replacements,
            projections: []
          }).acknowledged
        },
        projectAcknowledgedSourceSyntax(revision: number): CoreSourceSyntaxReply {
          if (released) throw new Error('Core document view lease is released')
          if (!Number.isSafeInteger(revision) || revision < 1) {
            throw new Error('Core document projection revision is invalid')
          }
          if (session.recovery !== undefined || session.terminalFault !== undefined) {
            throw new Error('Core document Worker recovery is required')
          }

          if (
            released ||
            sessions.get(documentId) !== session ||
            session.currentIdentity.revision !== revision
          ) {
            throw new Error('Core document projection revision changed')
          }
          if (session.barrierFailure !== undefined) throw session.barrierFailure
          const result = session.binding.sourceSyntaxAtBarrier()
          if (
            result.type !== 'source-syntax' ||
            result.session !== session.currentIdentity.generation ||
            result.revision !== revision ||
            released ||
            sessions.get(documentId) !== session
          ) {
            throw new Error('Core document source syntax barrier is stale')
          }
          return result
        },
        projectAcknowledgedPlainTextView(revision: number): CorePlainTextViewReply {
          if (released) throw new Error('Core document view lease is released')
          if (!Number.isSafeInteger(revision) || revision < 1) {
            throw new Error('Core document projection revision is invalid')
          }
          if (session.recovery !== undefined || session.terminalFault !== undefined) {
            throw new Error('Core document Worker recovery is required')
          }

          if (
            released ||
            sessions.get(documentId) !== session ||
            session.currentIdentity.revision !== revision
          ) {
            throw new Error('Core document projection revision changed')
          }
          if (session.barrierFailure !== undefined) throw session.barrierFailure
          const result = session.binding.plainTextViewAtBarrier()
          if (
            result.type !== 'plain-text-view' ||
            result.session !== session.currentIdentity.generation ||
            result.revision !== revision ||
            released ||
            sessions.get(documentId) !== session
          ) {
            throw new Error('Core document plain-text view barrier is stale')
          }
          return result
        },
        faultView(error: unknown): void {
          if (released) throw new Error('Core document view lease is released')
          const failure =
            error instanceof Error ? error : new Error('Core document view requires recovery')
          session.viewFault = failure
          session.barrierFailure ??= failure
        },
        settleView(barrier: () => Promise<unknown>, isSettled?: () => boolean): void {
          if (released) throw new Error('Core document view lease is released')
          session.settleView = barrier
          session.isViewSettled = isSettled
        },
        onHandoff(cleanup: () => void): void {
          if (released) throw new Error('Core document view lease is released')
          session.handoffCleanup = cleanup
        },
        setRecoveryDraftCapture(
          capture: (error: unknown) => CoreRecoveryDraftInput | undefined
        ): void {
          if (released) throw new Error('Core document view lease is released')
          captureDraft = capture
        },
        captureRecoveryDraft(error: unknown): CoreRecoveryDraftInput | undefined {
          if (released) throw new Error('Core document view lease is released')
          return captureDraft?.(error)
        }
      })
      releaseLease.set(lease, () => {
        if (released) return
        released = true
        captureDraft = undefined
        viewObservers.clear()
        session.leaseCount -= 1
      })
      leaseSession.set(lease, session)
      session.releaseView = releaseLease.get(lease)
      return lease
    },
    async replace(
      lease: CoreDocumentViewLease,
      input: CoreDocumentOpenInput
    ): Promise<CoreDocumentViewLease> {
      assertViewAdmission()
      if (input.documentId !== lease.documentId) {
        throw new Error('Core replacement document identity does not match its view lease')
      }
      const previous = currentSessionOf(lease)
      if (previous.leaseCount !== 1 || previous.releaseView !== releaseLease.get(lease)) {
        throw new Error('Core document replacement requires its one live view lease')
      }

      // Freeze the outgoing view before retiring its generation. A pending
      // transport reply not owned by that view barrier is fenced by disposal
      // below and cannot publish into the replacement session.
      await previous.settleView?.()
      assertViewAdmission()
      if (sessions.get(input.documentId) !== previous) {
        throw new Error('Core document replacement generation changed during its view barrier')
      }

      const priorJournalVersion = previous.journalVersion
      const priorCheckpoint = previous.checkpoint
      const priorJournal = [...previous.journal]
      const currentOptions = optionsAfterJournal(previous.checkpoint.options, priorJournal)
      const replacementOptions =
        input.options === undefined
          ? currentOptions
          : Object.freeze({ ...currentOptions, ...input.options })

      const binding = options.createBinding(input.documentId)
      let committed = false
      try {
        const opened = binding.open({
          documentId: input.documentId,
          source: priorCheckpoint.source,
          recoveryHistory: priorCheckpoint.recoveryHistory,
          ...(priorCheckpoint.options === undefined ? {} : { options: priorCheckpoint.options })
        })
        if (opened.type !== 'opened') {
          throw new Error('Core document replacement open was rejected')
        }
        let replayRevision = opened.revision
        for (const entry of priorJournal) {
          const replayed = binding.submit(
            recoveryReplayInput(entry.input, replayRevision)
          ).acknowledged
          if (replayed.type !== 'applied') {
            throw new Error('Core document replacement replay was rejected')
          }
          replayRevision = replayed.revision
        }
        if (input.options !== undefined) {
          const configured = binding.submit({
            kind: 'configure',
            options: input.options,
            projections: []
          }).acknowledged
          if (configured.type !== 'applied') {
            throw new Error('Core replacement options were rejected')
          }
        }
        const beforeReload = binding.sourceAtBarrier()
        if (beforeReload.type !== 'source') {
          throw new Error('Core document replacement source barrier is stale')
        }
        const replacementCheckpoint =
          beforeReload.source === input.source
            ? beforeReload
            : await (async() => {
              const reloaded = binding.submit(
                Object.freeze({
                  edits: Object.freeze([
                    Object.freeze({
                      start: 0,
                      end: beforeReload.source.length,
                      insert: input.source
                    })
                  ]),
                  projections: Object.freeze([])
                })
              ).acknowledged
              if (reloaded.type !== 'applied') {
                throw new Error('Core document replacement edit was rejected')
              }
              return binding.sourceAtBarrier()
            })()
        if (
          replacementCheckpoint.type !== 'source' ||
          replacementCheckpoint.source !== input.source
        ) {
          throw new Error('Core document replacement source barrier is stale')
        }

        await previous.settleView?.()
        if (
          sessions.get(input.documentId) !== previous ||
          previous.journalVersion !== priorJournalVersion ||
          previous.journal.length !== priorJournal.length
        ) {
          throw new Error('Core document replacement source changed during candidate open')
        }

        const replacement: Session = {
          documentId: input.documentId,
          binding,
          lineEnding: input.lineEnding,
          currentIdentity: Object.freeze({
            generation: replacementCheckpoint.session,
            revision: replacementCheckpoint.revision
          }),
          checkpoint: Object.freeze({
            source: replacementCheckpoint.source,
            recoveryHistory: replacementCheckpoint.recoveryHistory,
            ...(replacementOptions === undefined
              ? {}
              : { options: Object.freeze({ ...replacementOptions }) })
          }),
          journal: [],
          journalVersion: 0,
          leaseCount: 0
        }
        const cleanup = previous.handoffCleanup
        cleanup?.()
        previous.settleView = undefined
        previous.isViewSettled = undefined
        previous.handoffCleanup = undefined
        releaseLease.get(lease)?.()
        previous.releaseView = undefined
        previous.binding.dispose()
        consumerProjections.retire(input.documentId)
        sessions.set(input.documentId, replacement)
        committed = true
        return manager.lease(input.documentId)
      } finally {
        if (!committed) binding.dispose()
      }
    },
    recover(lease: CoreDocumentViewLease): Promise<CoreDocumentViewLease> {
      assertViewAdmission()
      const previous = currentSessionOf(lease)
      if (previous.leaseCount !== 1 || previous.releaseView !== releaseLease.get(lease)) {
        return Promise.reject(new Error('Core document recovery requires its one live view lease'))
      }
      if (previous.recovery !== undefined) return previous.recovery

      const recovery = (async(): Promise<CoreDocumentViewLease> => {
        // A failed adapter barrier describes speculative presentation. Recovery
        // discards it; renderer-recorded actor acceptance remains the authority.
        try {
          await previous.settleView?.()
        } catch {}
        if (previous.terminalFault === undefined && previous.viewFault === undefined) {
          throw new Error('Core document recovery is not required')
        }
        if (sessions.get(previous.documentId) !== previous) {
          throw new Error('Core document recovery generation changed')
        }

        // A source barrier already in flight can compact the old session while
        // the replacement opens. Replay one coherent checkpoint and suffix.
        const checkpoint = previous.checkpoint
        const journal = [...previous.journal]
        const journalVersion = previous.journalVersion
        const binding = options.createBinding(previous.documentId)
        try {
          const opened = binding.open({
            documentId: previous.documentId,
            source: checkpoint.source,
            recoveryHistory: checkpoint.recoveryHistory,
            ...(checkpoint.options === undefined ? {} : { options: checkpoint.options })
          })
          if (opened.type !== 'opened') {
            throw new Error('Core document recovery checkpoint was rejected')
          }
          let recoveredIdentity: DocumentSaveIdentity = Object.freeze({
            generation: opened.session,
            revision: opened.revision
          })
          for (const entry of journal) {
            const replay = binding.submit(
              recoveryReplayInput(entry.input, recoveredIdentity.revision)
            )
            const outcome = replay.acknowledged
            if (outcome.type !== 'applied') {
              throw new Error('Core document recovery replay was rejected')
            }
            recoveredIdentity = Object.freeze({
              generation: replay.identity.generation,
              revision: outcome.revision
            })
          }

          if (sessions.get(previous.documentId) !== previous) {
            throw new Error('Core document recovery generation changed during replay')
          }
          const replacement: Session = {
            documentId: previous.documentId,
            binding,
            lineEnding: previous.lineEnding,
            currentIdentity: recoveredIdentity,
            checkpoint,
            journal,
            journalVersion,
            leaseCount: 0
          }
          const cleanup = previous.handoffCleanup
          cleanup?.()
          previous.settleView = undefined
          previous.isViewSettled = undefined
          previous.handoffCleanup = undefined
          releaseLease.get(lease)?.()
          previous.releaseView = undefined
          previous.binding.dispose()
          consumerProjections.retire(previous.documentId)
          sessions.set(previous.documentId, replacement)
          maintainRecoveryJournal(replacement)
          return manager.lease(previous.documentId)
        } catch (error) {
          binding.dispose()
          throw error
        }
      })()
      previous.recovery = recovery
      recovery.catch(() => {
        if (sessions.get(previous.documentId) === previous) {
          previous.recovery = undefined
        }
      })
      return recovery
    },
    async activate(documentId: string): Promise<void> {
      sessionOf(documentId)
      activeDocumentId = documentId
    },
    async handoff(lease: CoreDocumentViewLease): Promise<void> {
      const session = currentSessionOf(lease)
      await session.settleView?.()
      if (session.barrierFailure !== undefined) throw session.barrierFailure
      const cleanup = session.handoffCleanup
      session.settleView = undefined
      session.isViewSettled = undefined
      session.handoffCleanup = undefined
      try {
        cleanup?.()
      } finally {
        releaseLease.get(lease)?.()
        session.releaseView = undefined
      }
    },
    isSaveSnapshotCurrent(documentId: string, identity: DocumentSaveIdentity): boolean {
      const session = sessions.get(documentId)
      return (
        session !== undefined &&
        session.recovery === undefined &&
        session.barrierFailure === undefined &&
        session.terminalFault === undefined &&
        session.viewFault === undefined &&
        session.closing === undefined &&
        (session.settleView === undefined || session.isViewSettled?.() === true) &&
        session.currentIdentity.generation === identity.generation &&
        session.currentIdentity.revision === identity.revision
      )
    },
    async saveBarrier(documentId: string) {
      const session = sessionOf(documentId)
      if (session.recovery !== undefined) {
        await session.recovery
        return manager.saveBarrier(documentId)
      }
      if (session.sourceBarrier !== undefined) return session.sourceBarrier
      const journalVersion = session.journalVersion
      const barrier = (async(): Promise<CoreDocumentSaveResult> => {
        await session.settleView?.()

        if (session.barrierFailure !== undefined) throw session.barrierFailure
        const result = session.binding.sourceAtBarrier()
        if (result.type !== 'source') {
          throw new Error('Core document save barrier is stale')
        }
        session.currentIdentity = Object.freeze({
          generation: result.session,
          revision: result.revision
        })
        if (session.journalVersion === journalVersion) {
          const checkpointOptions = optionsAfterJournal(session.checkpoint.options, session.journal)
          session.checkpoint = Object.freeze({
            source: result.source,
            recoveryHistory: result.recoveryHistory,
            ...(checkpointOptions === undefined ? {} : { options: checkpointOptions })
          })
          session.journal = []
        }
        return Object.freeze({
          documentId,
          revision: result.revision,
          identity: Object.freeze({
            generation: result.session,
            revision: result.revision
          }),
          source: result.source,
          lineEnding: session.lineEnding
        })
      })()
      session.sourceBarrier = barrier
      barrier
        .finally(() => {
          if (session.sourceBarrier === barrier) session.sourceBarrier = undefined
        })
        .catch(() => {})
      return barrier
    },
    async plainTextViewBarrier(documentId: string): Promise<CorePlainTextViewReply> {
      const session = sessionOf(documentId)
      if (session.recovery !== undefined) {
        await session.recovery
        return manager.plainTextViewBarrier(documentId)
      }
      await session.settleView?.()

      if (session.barrierFailure !== undefined) throw session.barrierFailure
      const result = session.binding.plainTextViewAtBarrier()
      if (result.type !== 'plain-text-view') {
        throw new Error('Core document plain-text view barrier is stale')
      }
      return result
    },
    abort(documentId: string): void {
      const session = sessionOf(documentId)
      sessions.delete(documentId)
      consumerProjections.retire(documentId)
      const cleanup = session.handoffCleanup
      session.settleView = undefined
      session.isViewSettled = undefined
      session.handoffCleanup = undefined
      try {
        cleanup?.()
      } finally {
        try {
          session.releaseView?.()
          session.releaseView = undefined
        } finally {
          session.binding.dispose()
          if (activeDocumentId === documentId) activeDocumentId = undefined
        }
      }
    },
    async prepareClose(retireInput: () => Promise<void>): Promise<() => void> {
      assertViewAdmission()
      windowClosePending = true
      try {
        // The retiring lease still admits its already captured input. Once it
        // has drained and been released, no stale callback or fresh view can
        // mutate these actors while main saves or destroys the window.
        await retireInput()
        for (const session of sessions.values()) {
          if (session.leaseCount !== 0) throw new Error('Core close still has a live input view')
          await manager.saveBarrier(session.documentId)
        }
        let held = true
        return () => {
          if (!held) return
          held = false
          windowClosePending = false
        }
      } catch (error) {
        windowClosePending = false
        throw error
      }
    },
    async close(documentId: string): Promise<void> {
      const session = sessionOf(documentId)
      if (session.leaseCount !== 0) {
        throw new Error('Core document has a live view; handoff is required')
      }
      if (session.closing !== undefined) return session.closing
      session.closing = (async() => {
        await session.sourceBarrier
        await session.settleView?.()
        if (session.barrierFailure !== undefined) throw session.barrierFailure
        sessions.delete(documentId)
        consumerProjections.retire(documentId)
        session.binding.dispose()
        if (activeDocumentId === documentId) activeDocumentId = undefined
      })()
      return session.closing
    }
  }
  return Object.freeze(manager)
}
