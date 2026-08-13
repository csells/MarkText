import type {
  DocumentSourceEdit,
  DocumentProjectionRequest,
  MarkdownOptions
} from '@marktext/document-core'

import type {
  CoreActorPort,
  CoreAppliedReply,
  CoreAuthorForm,
  CoreOpenedReply,
  CorePlainTextViewReply,
  CoreReviewItemReply,
  CoreReviewDecision,
  CoreReviewItemLocator,
  CoreSourceReply,
  CoreResourceReply,
  CoreRejectedReply
} from './coreProtocol'
import type { CoreHistorySnapshot } from './coreProtocol'

export interface EditorCoreOpenInput {
  readonly documentId: string
  readonly source: string
  readonly options?: Readonly<Partial<MarkdownOptions>>
  readonly recoveryHistory?: CoreHistorySnapshot
}

export interface EditorCoreBinding {
  readonly mode: 'core'
  readonly durableSourceAuthority: 'core'
  open(
    input: EditorCoreOpenInput
  ): Promise<CoreOpenedReply | CoreResourceReply | CoreRejectedReply>
  submit(input: EditorCoreSubmitInput): EditorCoreSubmission
  sourceAtBarrier(): Promise<CoreSourceReply | CoreRejectedReply>
  plainTextViewAtBarrier(): Promise<CorePlainTextViewReply | CoreRejectedReply>
  reviewItemAtBarrier(
    direction: 'next' | 'previous',
    from: number
  ): Promise<CoreReviewItemReply | CoreRejectedReply>
  observe(listener: (event: EditorCoreObservation) => void): () => void
  dispose(): void
}

export type EditorCoreSubmitInput = Readonly<{
  readonly kind?: 'source-edits'
  readonly edits: readonly DocumentSourceEdit[]
  readonly projections: readonly DocumentProjectionRequest[]
}> | Readonly<{
  readonly kind: 'undo' | 'redo'
  readonly projections: readonly DocumentProjectionRequest[]
}> | Readonly<{
  readonly kind: 'resolve'
  readonly authoredRevision: number
  readonly annotation: CoreReviewItemLocator
  readonly decision: CoreReviewDecision
  readonly projections: readonly DocumentProjectionRequest[]
}> | Readonly<{
  readonly kind: 'author'
  readonly form: CoreAuthorForm
  readonly range: Readonly<{ readonly start: number; readonly end: number }>
  readonly text: string
  readonly projections: readonly DocumentProjectionRequest[]
}> | Readonly<{
  readonly kind: 'track'
  readonly range: Readonly<{ readonly start: number; readonly end: number }>
  readonly text: string
  readonly projections: readonly DocumentProjectionRequest[]
}>

export interface EditorCoreTransactionIdentity {
  readonly documentId: string
  readonly generation: number
  readonly transactionId: number
}

export interface EditorCoreObservation {
  readonly identity: EditorCoreTransactionIdentity
  readonly outcome: EditorCoreApplyOutcome
}

export type EditorCoreApplyOutcome =
  | CoreAppliedReply
  | CoreRejectedReply
  | CoreResourceReply

export interface EditorCoreSubmission {
  readonly identity: EditorCoreTransactionIdentity
  readonly acknowledged: Promise<EditorCoreApplyOutcome>
}

let nextCoreSession = 1

const copyHistorySnapshot = (
  snapshot: CoreHistorySnapshot
): CoreHistorySnapshot | undefined => {
  if (
    snapshot === null || typeof snapshot !== 'object' ||
    !Array.isArray(snapshot.undo) || !Array.isArray(snapshot.redo)
  ) return undefined
  const copyEdits = (edits: readonly DocumentSourceEdit[]) => Object.freeze(
    edits.map(edit => Object.freeze({ ...edit }))
  )
  const copyEntries = (entries: CoreHistorySnapshot['undo']) => Object.freeze(
    entries.map(entry => {
      if (
        entry === null || typeof entry !== 'object' ||
        !Array.isArray(entry.undo) || !Array.isArray(entry.redo)
      ) throw new TypeError('Invalid Core recovery history')
      return Object.freeze({
        undo: copyEdits(entry.undo),
        redo: copyEdits(entry.redo)
      })
    })
  )
  try {
    return Object.freeze({
      undo: copyEntries(snapshot.undo),
      redo: copyEntries(snapshot.redo)
    })
  } catch {
    return undefined
  }
}

export function createEditorCoreBinding(port: CoreActorPort): EditorCoreBinding {
  const session = nextCoreSession
  nextCoreSession += 1
  let sequence = 0
  let revision = 0
  let opened = false
  let opening = false
  let inFlight = false
  let reconciliationRequired = false
  let disposed = false
  let documentId = ''
  const observers = new Set<(event: EditorCoreObservation) => void>()

  const accept = async(request: Parameters<CoreActorPort['request']>[0]) => {
    const reply = await port.request(request)
    if (reply.type === 'opened' || reply.type === 'applied') {
      revision = reply.revision
    }
    return reply
  }
  return Object.freeze({
    mode: 'core',
    durableSourceAuthority: 'core',
    async open(
      input: EditorCoreOpenInput
    ): Promise<CoreOpenedReply | CoreResourceReply | CoreRejectedReply> {
      if (disposed) throw new Error('Editor Core binding is disposed')
      if (opened || opening) throw new Error('Editor Core document is already open')
      opening = true
      sequence += 1
      try {
        const copiedHistory = input.recoveryHistory === undefined
          ? undefined
          : copyHistorySnapshot(input.recoveryHistory)
        if (input.recoveryHistory !== undefined && copiedHistory === undefined) {
          return Object.freeze({
            type: 'rejected',
            session,
            sequence,
            revision: 0,
            accepted: false,
            reason: 'recovery-history-invalid',
            sourceLength: 0
          })
        }
        const reply = await accept(Object.freeze({
          type: 'open',
          session,
          sequence,
          source: input.source,
          ...(input.options === undefined ? {} : { options: input.options }),
          ...(copiedHistory === undefined
            ? {}
            : { recoveryHistory: copiedHistory })
        }))
        if (reply.type === 'resource' || reply.type === 'rejected') return reply
        if (reply.type !== 'opened') throw new Error('Core open reply is invalid')
        opened = true
        documentId = input.documentId
        return reply
      } finally {
        opening = false
      }
    },
    submit(input: EditorCoreSubmitInput): EditorCoreSubmission {
      if (disposed) throw new Error('Editor Core binding is disposed')
      if (!opened) throw new Error('Editor Core document is not open')
      if (reconciliationRequired) {
        throw new Error('Editor Core reconciliation is required')
      }
      if (inFlight) throw new Error('Core edit transaction is already in flight')
      inFlight = true
      sequence += 1
      const transactionId = sequence
      const identity = Object.freeze({
        documentId,
        generation: session,
        transactionId
      })
      const projections = Object.freeze(input.projections.map(projection =>
        projection === 'markup'
          ? projection
          : Object.freeze({
            ...projection,
            annotationRange: Object.freeze({ ...projection.annotationRange })
          })
      ))
      let requested: Promise<EditorCoreApplyOutcome>
      try {
        const request = 'edits' in input
          ? Object.freeze({
            type: 'apply' as const,
            session,
            sequence: transactionId,
            baseRevision: revision,
            edits: Object.freeze(input.edits.map(edit => Object.freeze({ ...edit }))),
            projections
          })
          : input.kind === 'resolve'
            ? Object.freeze({
              type: 'resolve' as const,
              session,
              sequence: transactionId,
              baseRevision: input.authoredRevision,
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
            : input.kind === 'author'
              ? Object.freeze({
                type: 'author' as const,
                session,
                sequence: transactionId,
                baseRevision: revision,
                form: input.form,
                range: Object.freeze({ ...input.range }),
                text: input.text,
                projections
              })
              : input.kind === 'track'
                ? Object.freeze({
                  type: 'track' as const,
                  session,
                  sequence: transactionId,
                  baseRevision: revision,
                  range: Object.freeze({ ...input.range }),
                  text: input.text,
                  projections
                })
                : Object.freeze({
                  type: input.kind,
                  session,
                  sequence: transactionId,
                  baseRevision: revision,
                  projections
                })
        requested = port.request(request).then(reply => {
          if (
            reply.type !== 'applied' && reply.type !== 'rejected' &&
            reply.type !== 'resource'
          ) {
            throw new Error('Core apply reply is invalid')
          }
          if (reply.type === 'applied') revision = reply.revision
          else if (!(
            reply.type === 'rejected' &&
            (reply.reason === 'history-empty' ||
              reply.reason === 'no-change' ||
              (reply.reason === 'history-resource' &&
                input.kind !== 'source-edits' && input.kind !== 'track') ||
              (reply.reason === 'stale-base' && input.kind === 'resolve') ||
              reply.reason === 'annotation-not-found' ||
              reply.reason === 'resolution-invalid' ||
              reply.reason === 'author-invalid')
          )) {
            reconciliationRequired = true
          }
          return reply
        })
      } catch (error) {
        inFlight = false
        requested = Promise.reject(error)
      }
      const acknowledged = requested.then(outcome => {
        inFlight = false
        const event = Object.freeze({ identity, outcome })
        for (const observer of observers) {
          try {
            observer(event)
          } catch {
            // Observers are diagnostics; one cannot corrupt the authority path.
          }
        }
        return outcome
      }, error => {
        inFlight = false
        throw error
      })
      return Object.freeze({ identity, acknowledged })
    },
    async sourceAtBarrier(): Promise<CoreSourceReply | CoreRejectedReply> {
      if (disposed) throw new Error('Editor Core binding is disposed')
      if (!opened) throw new Error('Editor Core document is not open')
      if (reconciliationRequired) {
        throw new Error('Editor Core reconciliation is required')
      }
      if (inFlight) throw new Error('Core edit transaction is already in flight')
      sequence += 1
      const reply = await port.request(Object.freeze({
        type: 'source-at-barrier',
        session,
        sequence,
        baseRevision: revision
      }))
      if (reply.type !== 'source' && reply.type !== 'rejected') {
        throw new Error('Core source-at-barrier reply is invalid')
      }
      return reply
    },
    async plainTextViewAtBarrier(): Promise<
      CorePlainTextViewReply | CoreRejectedReply
    > {
      if (disposed) throw new Error('Editor Core binding is disposed')
      if (!opened) throw new Error('Editor Core document is not open')
      if (reconciliationRequired) {
        throw new Error('Editor Core reconciliation is required')
      }
      if (inFlight) throw new Error('Core edit transaction is already in flight')
      sequence += 1
      const reply = await port.request(Object.freeze({
        type: 'plain-text-view-at-barrier',
        session,
        sequence,
        baseRevision: revision
      }))
      if (reply.type !== 'plain-text-view' && reply.type !== 'rejected') {
        throw new Error('Core plain-text-view barrier reply is invalid')
      }
      return reply
    },
    async reviewItemAtBarrier(
      direction: 'next' | 'previous',
      from: number
    ): Promise<CoreReviewItemReply | CoreRejectedReply> {
      if (disposed) throw new Error('Editor Core binding is disposed')
      if (!opened) throw new Error('Editor Core document is not open')
      if (reconciliationRequired) {
        throw new Error('Editor Core reconciliation is required')
      }
      if (inFlight) throw new Error('Core edit transaction is already in flight')
      sequence += 1
      const reply = await port.request(Object.freeze({
        type: 'review-item-at-barrier',
        session,
        sequence,
        baseRevision: revision,
        direction,
        from
      }))
      if (reply.type !== 'review-item' && reply.type !== 'rejected') {
        throw new Error('Core Review item barrier reply is invalid')
      }
      return reply
    },
    observe(listener: (event: EditorCoreObservation) => void): () => void {
      if (disposed) throw new Error('Editor Core binding is disposed')
      observers.add(listener)
      return () => observers.delete(listener)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      observers.clear()
      port.dispose()
    }
  })
}
