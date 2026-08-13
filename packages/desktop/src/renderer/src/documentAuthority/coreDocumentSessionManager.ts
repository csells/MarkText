import {
  DOCUMENT_RESOURCE_POLICY_V1,
  type MarkdownOptions
} from '@marktext/document-core'

import type {
  EditorCoreApplyOutcome,
  EditorCoreBinding,
  EditorCoreObservation,
  EditorCoreSubmitInput
} from './editorCoreBinding'
import type { CoreHistorySnapshot } from './coreProtocol'
import type { CorePlainTextViewReply } from './coreProtocol'
import type { CanonicalLineEnding } from './canonicalEolIndex'
import type { DocumentSaveIdentity } from '@shared/types/files'

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
  projectAcknowledgedPlainTextView(
    revision: number
  ): Promise<CorePlainTextViewReply>
  faultView(error: unknown): void
  settleView(barrier: () => Promise<unknown>): void
  onHandoff(cleanup: () => void): void
}

export interface CoreDocumentSessionManager {
  open(input: CoreDocumentOpenInput): Promise<void>
  lease(documentId: string): CoreDocumentViewLease
  replace(
    lease: CoreDocumentViewLease,
    input: CoreDocumentOpenInput
  ): Promise<CoreDocumentViewLease>
  recover(lease: CoreDocumentViewLease): Promise<CoreDocumentViewLease>
  activate(documentId: string): Promise<void>
  handoff(lease: CoreDocumentViewLease): Promise<void>
  saveBarrier(documentId: string): Promise<Readonly<{
    readonly documentId: string
    readonly revision: number
    readonly identity: DocumentSaveIdentity
    readonly source: string
    readonly lineEnding: CanonicalLineEnding
  }>>
  plainTextViewBarrier(documentId: string): Promise<CorePlainTextViewReply>
  abort(documentId: string): void
  close(documentId: string): Promise<void>
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
  readonly pending: Set<Promise<EditorCoreApplyOutcome>>
  checkpoint: RecoveryCheckpoint
  journal: RecoveryJournalEntry[]
  journalVersion: number
  leaseCount: number
  barrierFailure?: Error
  terminalFault?: Error
  viewFault?: Error
  settleView?: () => Promise<unknown>
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
  const projections = Object.freeze(input.projections.map(projection =>
    projection === 'markup'
      ? projection
      : Object.freeze({
        ...projection,
        annotationRange: Object.freeze({ ...projection.annotationRange })
      })
  ))
  if (!('edits' in input) && input.kind === 'resolve') {
    return Object.freeze({
      kind: 'resolve',
      authoredRevision: input.authoredRevision,
      annotation: input.annotation.kind === 'commented-span'
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
    edits: Object.freeze(input.edits.map(edit => Object.freeze({ ...edit }))),
    projections
  })
}

const recoveryReplayInput = (
  input: EditorCoreSubmitInput,
  revision: number
): EditorCoreSubmitInput => !('edits' in input) && input.kind === 'resolve'
  ? Object.freeze({ ...input, authoredRevision: revision })
  : input

const checkpointOf = (input: CoreDocumentOpenInput): RecoveryCheckpoint =>
  Object.freeze({
    source: input.source,
    recoveryHistory: Object.freeze({ undo: Object.freeze([]), redo: Object.freeze([]) }),
    ...(input.options === undefined
      ? {}
      : { options: Object.freeze({ ...input.options }) })
  })

export function createCoreDocumentSessionManager(
  options: CoreDocumentSessionManagerOptions
): CoreDocumentSessionManager {
  const sessions = new Map<string, Session>()
  const openingDocumentIds = new Set<string>()
  const releaseLease = new WeakMap<CoreDocumentViewLease, () => void>()
  const leaseSession = new WeakMap<CoreDocumentViewLease, Session>()
  let activeDocumentId: string | undefined

  const sessionOf = (documentId: string): Session => {
    const session = sessions.get(documentId)
    if (session === undefined) throw new Error('Core document is not open')
    return session
  }
  const settle = async(session: Session): Promise<void> => {
    while (session.pending.size > 0) {
      await Promise.allSettled([...session.pending])
    }
  }
  const currentSessionOf = (lease: CoreDocumentViewLease): Session => {
    const session = leaseSession.get(lease)
    if (session === undefined || sessions.get(lease.documentId) !== session) {
      throw new Error('Core document view lease belongs to a retired generation')
    }
    return session
  }

  const manager: CoreDocumentSessionManager = {
    async open(input: CoreDocumentOpenInput): Promise<void> {
      if (sessions.has(input.documentId) || openingDocumentIds.has(input.documentId)) {
        throw new Error('Core document is already open')
      }
      openingDocumentIds.add(input.documentId)
      const binding = options.createBinding(input.documentId)
      try {
        const opened = await binding.open({
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
          pending: new Set(),
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
      const session = sessionOf(documentId)
      if (session.leaseCount !== 0) {
        throw new Error('Core document already has a live view')
      }
      session.leaseCount += 1
      let released = false
      const viewSubscriptions = new Set<() => void>()
      const viewBinding: EditorCoreBinding = Object.freeze({
        mode: 'core',
        durableSourceAuthority: 'core',
        open: () => Promise.reject(new Error('Core session is already open')),
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
          const submission = session.binding.submit(journalInput)
          session.pending.add(submission.acknowledged)
          submission.acknowledged.then(outcome => {
            session.pending.delete(submission.acknowledged)
            if (outcome.type === 'applied') {
              session.currentIdentity = Object.freeze({
                generation: submission.identity.generation,
                revision: outcome.revision
              })
              session.journal.push(Object.freeze({ input: journalInput }))
            } else if (
              !(
                outcome.type === 'rejected' &&
                (outcome.reason === 'history-empty' ||
                  outcome.reason === 'no-change' ||
                  (outcome.reason === 'history-resource' &&
                    !('edits' in journalInput) && journalInput.kind !== 'track') ||
                  (outcome.reason === 'stale-base' && journalInput.kind === 'resolve') ||
                  outcome.reason === 'annotation-not-found' ||
                  outcome.reason === 'resolution-invalid' ||
                  outcome.reason === 'author-invalid')
              )
            ) {
              session.barrierFailure = new Error(
                `Core document requires reconciliation: ${outcome.type}`
              )
            }
          }, error => {
            session.pending.delete(submission.acknowledged)
            const failure = error instanceof Error
              ? error
              : new Error('Core document submission failed')
            session.barrierFailure = failure
            session.terminalFault = failure
          })
          return submission
        },
        sourceAtBarrier: () => Promise.reject(
          new Error('Core view cannot bypass the session save barrier')
        ),
        plainTextViewAtBarrier: () => Promise.reject(
          new Error('Core view cannot bypass the session projection barrier')
        ),
        reviewItemAtBarrier: (
          direction: 'next' | 'previous',
          from: number
        ) => {
          if (released) {
            return Promise.reject(new Error('Core document view lease is released'))
          }
          return session.binding.reviewItemAtBarrier(direction, from)
        },
        observe(listener: (event: EditorCoreObservation) => void) {
          if (released) throw new Error('Core document view lease is released')
          const unsubscribe = session.binding.observe(listener)
          viewSubscriptions.add(unsubscribe)
          return () => {
            viewSubscriptions.delete(unsubscribe)
            unsubscribe()
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
        async projectAcknowledgedPlainTextView(
          revision: number
        ): Promise<CorePlainTextViewReply> {
          if (released) throw new Error('Core document view lease is released')
          if (!Number.isSafeInteger(revision) || revision < 1) {
            throw new Error('Core document projection revision is invalid')
          }
          if (session.recovery !== undefined || session.terminalFault !== undefined) {
            throw new Error('Core document Worker recovery is required')
          }
          await settle(session)
          if (
            released || sessions.get(documentId) !== session ||
            session.currentIdentity.revision !== revision
          ) {
            throw new Error('Core document projection revision changed')
          }
          if (session.barrierFailure !== undefined) throw session.barrierFailure
          const result = await session.binding.plainTextViewAtBarrier()
          if (
            result.type !== 'plain-text-view' ||
            result.session !== session.currentIdentity.generation ||
            result.revision !== revision || released ||
            sessions.get(documentId) !== session
          ) {
            throw new Error('Core document plain-text view barrier is stale')
          }
          return result
        },
        faultView(error: unknown): void {
          if (released) throw new Error('Core document view lease is released')
          const failure = error instanceof Error
            ? error
            : new Error('Core document view requires recovery')
          session.viewFault = failure
          session.barrierFailure ??= failure
        },
        settleView(barrier: () => Promise<unknown>): void {
          if (released) throw new Error('Core document view lease is released')
          session.settleView = barrier
        },
        onHandoff(cleanup: () => void): void {
          if (released) throw new Error('Core document view lease is released')
          session.handoffCleanup = cleanup
        }
      })
      releaseLease.set(lease, () => {
        if (released) return
        released = true
        for (const unsubscribe of viewSubscriptions) unsubscribe()
        viewSubscriptions.clear()
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
      if (sessions.get(input.documentId) !== previous) {
        throw new Error('Core document replacement generation changed during its view barrier')
      }

      const priorJournalVersion = previous.journalVersion
      const priorCheckpoint = previous.checkpoint
      const priorJournal = [...previous.journal]
      const replacementOptions = input.options ?? previous.checkpoint.options

      const binding = options.createBinding(input.documentId)
      let committed = false
      try {
        const opened = await binding.open({
          documentId: input.documentId,
          source: priorCheckpoint.source,
          recoveryHistory: priorCheckpoint.recoveryHistory,
          ...(replacementOptions === undefined ? {} : { options: replacementOptions })
        })
        if (opened.type !== 'opened') {
          throw new Error('Core document replacement open was rejected')
        }
        let replayRevision = opened.revision
        for (const entry of priorJournal) {
          const replayed = await binding.submit(
            recoveryReplayInput(entry.input, replayRevision)
          ).acknowledged
          if (replayed.type !== 'applied') {
            throw new Error('Core document replacement replay was rejected')
          }
          replayRevision = replayed.revision
        }
        const beforeReload = await binding.sourceAtBarrier()
        if (beforeReload.type !== 'source') {
          throw new Error('Core document replacement source barrier is stale')
        }
        const replacementCheckpoint = beforeReload.source === input.source
          ? beforeReload
          : await (async() => {
            const reloaded = await binding.submit(Object.freeze({
              edits: Object.freeze([Object.freeze({
                start: 0,
                end: beforeReload.source.length,
                insert: input.source
              })]),
              projections: Object.freeze([])
            })).acknowledged
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
          pending: new Set(),
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
        previous.handoffCleanup = undefined
        releaseLease.get(lease)?.()
        previous.releaseView = undefined
        previous.binding.dispose()
        sessions.set(input.documentId, replacement)
        committed = true
        return manager.lease(input.documentId)
      } finally {
        if (!committed) binding.dispose()
      }
    },
    recover(lease: CoreDocumentViewLease): Promise<CoreDocumentViewLease> {
      const previous = currentSessionOf(lease)
      if (previous.leaseCount !== 1 || previous.releaseView !== releaseLease.get(lease)) {
        return Promise.reject(
          new Error('Core document recovery requires its one live view lease')
        )
      }
      if (previous.recovery !== undefined) return previous.recovery

      const recovery = (async(): Promise<CoreDocumentViewLease> => {
        // A failed adapter barrier describes speculative presentation. Recovery
        // discards it; renderer-recorded actor acceptance remains the authority.
        try {
          await previous.settleView?.()
        } catch {}
        await settle(previous)
        if (
          previous.terminalFault === undefined &&
          previous.viewFault === undefined
        ) {
          throw new Error('Core document recovery is not required')
        }
        if (sessions.get(previous.documentId) !== previous) {
          throw new Error('Core document recovery generation changed')
        }

        const binding = options.createBinding(previous.documentId)
        try {
          const opened = await binding.open({
            documentId: previous.documentId,
            source: previous.checkpoint.source,
            recoveryHistory: previous.checkpoint.recoveryHistory,
            ...(previous.checkpoint.options === undefined
              ? {}
              : { options: previous.checkpoint.options })
          })
          if (opened.type !== 'opened') {
            throw new Error('Core document recovery checkpoint was rejected')
          }
          let recoveredIdentity: DocumentSaveIdentity = Object.freeze({
            generation: opened.session,
            revision: opened.revision
          })
          for (const entry of previous.journal) {
            const replay = binding.submit(
              recoveryReplayInput(entry.input, recoveredIdentity.revision)
            )
            const outcome = await replay.acknowledged
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
            pending: new Set(),
            checkpoint: previous.checkpoint,
            journal: [...previous.journal],
            journalVersion: previous.journalVersion,
            leaseCount: 0
          }
          const cleanup = previous.handoffCleanup
          cleanup?.()
          previous.settleView = undefined
          previous.handoffCleanup = undefined
          releaseLease.get(lease)?.()
          previous.releaseView = undefined
          previous.binding.dispose()
          sessions.set(previous.documentId, replacement)
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
      await settle(session)
      if (session.barrierFailure !== undefined) throw session.barrierFailure
      const cleanup = session.handoffCleanup
      session.settleView = undefined
      session.handoffCleanup = undefined
      try {
        cleanup?.()
      } finally {
        releaseLease.get(lease)?.()
        session.releaseView = undefined
      }
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
        await settle(session)
        if (session.barrierFailure !== undefined) throw session.barrierFailure
        const result = await session.binding.sourceAtBarrier()
        if (result.type !== 'source') {
          throw new Error('Core document save barrier is stale')
        }
        session.currentIdentity = Object.freeze({
          generation: result.session,
          revision: result.revision
        })
        if (session.journalVersion === journalVersion) {
          session.checkpoint = Object.freeze({
            source: result.source,
            recoveryHistory: result.recoveryHistory,
            ...(session.checkpoint.options === undefined
              ? {}
              : { options: session.checkpoint.options })
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
      barrier.finally(() => {
        if (session.sourceBarrier === barrier) session.sourceBarrier = undefined
      }).catch(() => {})
      return barrier
    },
    async plainTextViewBarrier(documentId: string): Promise<CorePlainTextViewReply> {
      const session = sessionOf(documentId)
      if (session.recovery !== undefined) {
        await session.recovery
        return manager.plainTextViewBarrier(documentId)
      }
      await session.settleView?.()
      await settle(session)
      if (session.barrierFailure !== undefined) throw session.barrierFailure
      const result = await session.binding.plainTextViewAtBarrier()
      if (result.type !== 'plain-text-view') {
        throw new Error('Core document plain-text view barrier is stale')
      }
      return result
    },
    abort(documentId: string): void {
      const session = sessionOf(documentId)
      sessions.delete(documentId)
      const cleanup = session.handoffCleanup
      session.settleView = undefined
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
    async close(documentId: string): Promise<void> {
      const session = sessionOf(documentId)
      if (session.leaseCount !== 0) {
        throw new Error('Core document has a live view; handoff is required')
      }
      if (session.closing !== undefined) return session.closing
      session.closing = (async() => {
        await session.sourceBarrier
        await session.settleView?.()
        await settle(session)
        if (session.barrierFailure !== undefined) throw session.barrierFailure
        sessions.delete(documentId)
        session.binding.dispose()
        if (activeDocumentId === documentId) activeDocumentId = undefined
      })()
      return session.closing
    }
  }
  return Object.freeze(manager)
}
