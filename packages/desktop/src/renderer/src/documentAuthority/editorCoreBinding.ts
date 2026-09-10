import type {
  DocumentSelection,
  DocumentTableSelection,
  DocumentModelTextSelection,
  SourceRange
} from '@marktext/document-core'
import {
  copyClipboardAction,
  copyDocumentSelection,
  type DocumentSourceInputAction
} from '@marktext/document-core'
import type {
  DocumentSourceEdit,
  DocumentInputAction,
  DocumentClipboardSelection,
  DocumentFormatAction,
  DocumentClipboardAction,
  DocumentProjectionRequest,
  MarkdownOptions,
  MarkdownProjectionName
} from '@marktext/document-core'

import type {
  CoreModelOwner,
  CorePreparedOperation,
  CoreRetainedSelectionReply,
  CoreReleasedSelectionReply,
  CoreAppliedReply,
  CoreAuthorForm,
  CoreConsumerProjectionReply,
  CoreDisplayProjectionReply,
  CoreConsumerSearchReplacement,
  CoreSelectionProjectionReply,
  CoreOpenedReply,
  CoreSourceSyntaxReply,
  CoreSourceSelectionReply,
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
  retainSelection(
    selection: DocumentClipboardSelection
  ): CoreRetainedSelectionReply | CoreRejectedReply
  retainedSelectionAtBarrier(id: string): CoreRetainedSelectionReply | CoreRejectedReply
  releaseSelection(id: string): CoreReleasedSelectionReply | CoreRejectedReply
  readonly mode: 'core'
  readonly durableSourceAuthority: 'core'
  open(input: EditorCoreOpenInput): CoreOpenedReply | CoreResourceReply | CoreRejectedReply
  submit(input: EditorCoreSubmitInput): EditorCoreSubmission
  sourceAtBarrier(): CoreSourceReply | CoreRejectedReply
  sourceSelectionAtBarrier(
    selection: DocumentSelection
  ): CoreSourceSelectionReply | CoreRejectedReply
  sourceSyntaxAtBarrier(): CoreSourceSyntaxReply | CoreRejectedReply
  plainTextViewAtBarrier(): CorePlainTextViewReply | CoreRejectedReply
  consumerProjectionAtBarrier?(): CoreConsumerProjectionReply | CoreRejectedReply
  displayProjectionAtBarrier?(
    name: MarkdownProjectionName
  ): CoreDisplayProjectionReply | CoreRejectedReply
  selectionProjectionAtBarrier(
    range: SourceRange | DocumentTableSelection | DocumentModelTextSelection
  ): CoreSelectionProjectionReply | CoreResourceReply | CoreRejectedReply
  reviewItemAtBarrier(
    direction: 'next' | 'previous',
    from: number,
    includeOverview?: boolean
  ): CoreReviewItemReply | CoreRejectedReply
  observe(listener: (event: EditorCoreObservation) => void): () => void
  dispose(): void
}

export type EditorCoreSubmitInput =
  | Readonly<{
    kind: 'apply-prepared'
    target: string
    operation: CorePreparedOperation
    projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly kind: 'source-input'
    readonly action: DocumentSourceInputAction
    readonly nativeHistoryGroup?: string
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly kind: 'clipboard'
    readonly action: DocumentClipboardAction
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly kind: 'format'
    readonly action: DocumentFormatAction
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly kind: 'input'
    readonly action: DocumentInputAction
    readonly tracked: boolean
    readonly nativeHistoryGroup?: string
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly kind: 'configure'
    readonly options: Readonly<Partial<MarkdownOptions>>
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly kind?: 'source-edits' | 'markup-edits' | 'track-edits'
    readonly nativeHistoryGroup?: string
    readonly edits: readonly DocumentSourceEdit[]
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly kind: 'replace-consumer-search'
    readonly authoredRevision: number
    readonly replacements: readonly CoreConsumerSearchReplacement[]
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly kind: 'undo' | 'redo'
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly kind: 'resolve'
    readonly authoredRevision: number
    readonly annotation: CoreReviewItemLocator
    readonly decision: CoreReviewDecision
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly kind: 'resolve-all'
    readonly decision: 'accept' | 'reject'
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly kind: 'author'
    readonly form: CoreAuthorForm
    readonly range: Readonly<{ readonly start: number; readonly end: number }>
    readonly text: string
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly kind: 'edit-comment'
    readonly authoredRevision: number
    readonly annotation: CoreReviewItemLocator
    readonly text: string
    readonly projections: readonly DocumentProjectionRequest[]
  }>
  | Readonly<{
    readonly kind: 'track'
    readonly nativeHistoryGroup?: string
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

export type EditorCoreApplyOutcome = CoreAppliedReply | CoreRejectedReply | CoreResourceReply

export interface EditorCoreSubmission {
  readonly identity: EditorCoreTransactionIdentity
  readonly acknowledged: EditorCoreApplyOutcome
}

let nextCoreSession = 1

const copyHistorySnapshot = (snapshot: CoreHistorySnapshot): CoreHistorySnapshot | undefined => {
  if (
    snapshot === null ||
    typeof snapshot !== 'object' ||
    !Array.isArray(snapshot.undo) ||
    !Array.isArray(snapshot.redo)
  ) {
    return undefined
  }
  const copyEdits = (edits: readonly DocumentSourceEdit[]) =>
    Object.freeze(edits.map((edit) => Object.freeze({ ...edit })))
  const copyEntries = (entries: CoreHistorySnapshot['undo']) =>
    Object.freeze(
      entries.map((entry) => {
        if (
          entry === null ||
          typeof entry !== 'object' ||
          !Array.isArray(entry.undo) ||
          !Array.isArray(entry.redo)
        ) {
          throw new TypeError('Invalid Core recovery history')
        }
        return Object.freeze({
          undo: copyEdits(entry.undo),
          redo: copyEdits(entry.redo),
          ...(entry.beforeSelection === undefined
            ? {}
            : {
              beforeSelection: copyDocumentSelection(
                entry.beforeSelection,
                Number.MAX_SAFE_INTEGER
              )
            }),
          ...(entry.afterSelection === undefined
            ? {}
            : {
              afterSelection: copyDocumentSelection(entry.afterSelection, Number.MAX_SAFE_INTEGER)
            })
        })
      })
    )
  try {
    return Object.freeze({
      undo: copyEntries(snapshot.undo),
      redo: copyEntries(snapshot.redo),
      ...(snapshot.nativeHistoryGroup === undefined
        ? {}
        : { nativeHistoryGroup: snapshot.nativeHistoryGroup })
    })
  } catch {
    return undefined
  }
}

export function copyFormatAction(action: DocumentFormatAction): DocumentFormatAction {
  return action.format === 'image-properties'
    ? Object.freeze({
      ...action,
      selection: Object.freeze({ ...action.selection }),
      properties: Object.freeze({ ...action.properties }),
      ...(action.currentSelection === undefined
        ? {}
        : {
          currentSelection: copyDocumentSelection(
            action.currentSelection,
            Number.MAX_SAFE_INTEGER
          )
        })
    })
    : Object.freeze({
      ...action,
      selection: copyDocumentSelection(action.selection, Number.MAX_SAFE_INTEGER)
    })
}

export function copyPreparedOperation(operation: CorePreparedOperation): CorePreparedOperation {
  if (operation.kind === 'format') {
    const current = operation.action.currentSelection
    return Object.freeze({
      kind: 'format',
      action: Object.freeze({
        ...operation.action,
        properties: Object.freeze({ ...operation.action.properties }),
        ...(current === undefined
          ? {}
          : { currentSelection: copyDocumentSelection(current, Number.MAX_SAFE_INTEGER) })
      })
    })
  }
  const current = operation.action.currentSelection
  return Object.freeze({
    kind: 'clipboard',
    action: Object.freeze({
      ...operation.action,
      ...(current === undefined
        ? {}
        : { currentSelection: copyDocumentSelection(current, Number.MAX_SAFE_INTEGER) })
    })
  })
}

export function createEditorCoreBinding(port: CoreModelOwner): EditorCoreBinding {
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

  const accept = (request: Parameters<CoreModelOwner['request']>[0]) => {
    const reply = port.request(request)
    if (reply.type === 'opened' || reply.type === 'applied') {
      revision = reply.revision
    }
    return reply
  }
  const selectionRequest = (
    input:
      | { type: 'retain-selection'; selection: DocumentClipboardSelection }
      | { type: 'read-retained-selection' | 'release-selection'; id: string }
  ) => {
    if (disposed) throw new Error('Editor Core binding is disposed')
    if (!opened) throw new Error('Editor Core document is not open')
    if (reconciliationRequired) throw new Error('Editor Core reconciliation is required')
    if (inFlight) throw new Error('Core edit transaction is already in flight')
    sequence += 1
    return port.request(Object.freeze({ ...input, session, sequence, baseRevision: revision }))
  }
  return Object.freeze({
    retainSelection(selection: DocumentClipboardSelection) {
      const copied =
        'start' in selection
          ? Object.freeze({ ...selection })
          : copyDocumentSelection(selection, Number.MAX_SAFE_INTEGER)
      const reply = selectionRequest({ type: 'retain-selection', selection: copied })
      if (reply.type !== 'retained-selection' && reply.type !== 'rejected') { throw new Error('Core retained selection reply is invalid') }
      return reply
    },
    retainedSelectionAtBarrier(id: string) {
      const reply = selectionRequest({ type: 'read-retained-selection', id })
      if (reply.type !== 'retained-selection' && reply.type !== 'rejected') { throw new Error('Core retained selection reply is invalid') }
      return reply
    },
    releaseSelection(id: string) {
      const reply = selectionRequest({ type: 'release-selection', id })
      if (reply.type !== 'selection-released' && reply.type !== 'rejected') { throw new Error('Core released selection reply is invalid') }
      return reply
    },
    mode: 'core',
    durableSourceAuthority: 'core',
    open(input: EditorCoreOpenInput): CoreOpenedReply | CoreResourceReply | CoreRejectedReply {
      if (disposed) throw new Error('Editor Core binding is disposed')
      if (opened || opening) throw new Error('Editor Core document is already open')
      opening = true
      sequence += 1
      try {
        const copiedHistory =
          input.recoveryHistory === undefined
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
        const reply = accept(
          Object.freeze({
            type: 'open',
            session,
            sequence,
            source: input.source,
            ...(input.options === undefined ? {} : { options: input.options }),
            ...(copiedHistory === undefined ? {} : { recoveryHistory: copiedHistory })
          })
        )
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
      const copyConsumerSearchReplacements = (
        replacements: readonly CoreConsumerSearchReplacement[]
      ) =>
        Object.freeze(
          replacements.map((replacement) =>
            Object.freeze({
              match: Object.freeze({
                ...replacement.match,
                path: Object.freeze([...replacement.match.path])
              }),
              insert: replacement.insert
            })
          )
        )
      let acknowledged: EditorCoreApplyOutcome
      try {
        const request =
          input.kind === 'apply-prepared'
            ? Object.freeze({
              type: 'apply-prepared' as const,
              session,
              sequence: transactionId,
              baseRevision: revision,
              target: input.target,
              operation: copyPreparedOperation(input.operation),
              projections
            })
            : input.kind === 'source-input'
              ? Object.freeze({
                type: 'source-input' as const,
                session,
                sequence: transactionId,
                baseRevision: revision,
                action: Object.freeze({
                  edits: Object.freeze(
                    input.action.edits.map((edit) => Object.freeze({ ...edit }))
                  ),
                  beforeSelection: copyDocumentSelection(
                    input.action.beforeSelection,
                    Number.MAX_SAFE_INTEGER
                  ),
                  afterSelection: copyDocumentSelection(
                    input.action.afterSelection,
                    Number.MAX_SAFE_INTEGER
                  )
                }),
                ...(input.nativeHistoryGroup === undefined
                  ? {}
                  : { nativeHistoryGroup: input.nativeHistoryGroup }),
                projections
              })
              : input.kind === 'clipboard'
                ? Object.freeze({
                  type: 'clipboard' as const,
                  session,
                  sequence: transactionId,
                  baseRevision: revision,
                  action: copyClipboardAction(input.action),
                  projections
                })
                : input.kind === 'format'
                  ? Object.freeze({
                    type: 'format' as const,
                    session,
                    sequence: transactionId,
                    baseRevision: revision,
                    action: copyFormatAction(input.action),
                    projections
                  })
                  : input.kind === 'input'
                    ? Object.freeze({
                      type: 'input' as const,
                      session,
                      sequence: transactionId,
                      baseRevision: revision,
                      action: Object.freeze({
                        ...input.action,
                        ...('range' in input.action
                          ? {
                            range:
                                  'kind' in input.action.range
                                    ? copyDocumentSelection(
                                      input.action.range,
                                      Number.MAX_SAFE_INTEGER
                                    )
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
                              ? {
                                command: input.action.command,
                                change: Object.freeze({ ...input.action.change })
                              }
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
                        selection: copyDocumentSelection(
                          input.action.selection,
                          Number.MAX_SAFE_INTEGER
                        ),
                        options: Object.freeze({ ...input.action.options })
                      }),
                      tracked: input.tracked,
                      ...(input.nativeHistoryGroup === undefined
                        ? {}
                        : { nativeHistoryGroup: input.nativeHistoryGroup }),
                      projections
                    })
                    : 'edits' in input
                      ? Object.freeze({
                        type: 'apply' as const,
                        session,
                        sequence: transactionId,
                        baseRevision: revision,
                        edits: Object.freeze(
                          input.edits.map((edit) => Object.freeze({ ...edit }))
                        ),
                        ...(input.kind === 'markup-edits' ? { markup: true as const } : {}),
                        ...(input.kind === 'track-edits' ? { tracked: true as const } : {}),
                        ...(input.nativeHistoryGroup === undefined
                          ? {}
                          : { nativeHistoryGroup: input.nativeHistoryGroup }),
                        projections
                      })
                      : input.kind === 'configure'
                        ? Object.freeze({
                          type: 'configure' as const,
                          session,
                          sequence: transactionId,
                          baseRevision: revision,
                          options: Object.freeze({ ...input.options }),
                          projections
                        })
                        : input.kind === 'replace-consumer-search'
                          ? Object.freeze({
                            type: 'replace-consumer-search' as const,
                            session,
                            sequence: transactionId,
                            baseRevision: input.authoredRevision,
                            replacements: copyConsumerSearchReplacements(input.replacements),
                            projections
                          })
                          : input.kind === 'resolve'
                            ? Object.freeze({
                              type: 'resolve' as const,
                              session,
                              sequence: transactionId,
                              baseRevision: input.authoredRevision,
                              annotation:
                                  input.annotation.kind === 'commented-span'
                                    ? Object.freeze({
                                      kind: input.annotation.kind,
                                      range: Object.freeze({ ...input.annotation.range }),
                                      highlightRange: Object.freeze({
                                        ...input.annotation.highlightRange
                                      }),
                                      commentRange: Object.freeze({
                                        ...input.annotation.commentRange
                                      })
                                    })
                                    : Object.freeze({
                                      kind: input.annotation.kind,
                                      range: Object.freeze({ ...input.annotation.range })
                                    }),
                              decision: input.decision,
                              projections
                            })
                            : input.kind === 'resolve-all'
                              ? Object.freeze({
                                type: 'resolve-all' as const,
                                session,
                                sequence: transactionId,
                                baseRevision: revision,
                                decision: input.decision,
                                projections
                              })
                              : input.kind === 'edit-comment'
                                ? Object.freeze({
                                  type: 'edit-comment' as const,
                                  session,
                                  sequence: transactionId,
                                  baseRevision: input.authoredRevision,
                                  annotation:
                                      input.annotation.kind === 'commented-span'
                                        ? Object.freeze({
                                          kind: input.annotation.kind,
                                          range: Object.freeze({ ...input.annotation.range }),
                                          highlightRange: Object.freeze({
                                            ...input.annotation.highlightRange
                                          }),
                                          commentRange: Object.freeze({
                                            ...input.annotation.commentRange
                                          })
                                        })
                                        : Object.freeze({
                                          kind: input.annotation.kind,
                                          range: Object.freeze({ ...input.annotation.range })
                                        }),
                                  text: input.text,
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
                                      ...(input.nativeHistoryGroup === undefined
                                        ? {}
                                        : { nativeHistoryGroup: input.nativeHistoryGroup }),
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
        const reply = port.request(request)
        if (reply.type !== 'applied' && reply.type !== 'rejected' && reply.type !== 'resource') {
          throw new Error('Core apply reply is invalid')
        }
        if (reply.type === 'applied') revision = reply.revision
        else if (
          !(
            reply.type === 'rejected' &&
            (reply.reason === 'history-empty' ||
              reply.reason === 'no-change' ||
              (reply.reason === 'history-resource' &&
                input.kind !== 'source-edits' &&
                input.kind !== 'track' &&
                input.kind !== 'track-edits' &&
                input.kind !== 'input') ||
              (reply.reason === 'stale-base' &&
                (input.kind === 'resolve' ||
                  input.kind === 'edit-comment' ||
                  input.kind === 'replace-consumer-search')) ||
              reply.reason === 'annotation-not-found' ||
              reply.reason === 'resolution-invalid' ||
              reply.reason === 'author-invalid' ||
              reply.reason === 'prepared-selection-unavailable' ||
              reply.reason === 'prepared-selection-conflict' ||
              reply.reason === 'consumer-search-match-invalid')
          )
        ) {
          reconciliationRequired = true
        }
        acknowledged = reply
      } catch (error) {
        reconciliationRequired = true
        throw error
      } finally {
        inFlight = false
      }
      const event = Object.freeze({ identity, outcome: acknowledged })
      for (const observer of observers) {
        try {
          observer(event)
        } catch {
          // Observers are diagnostics; one cannot corrupt the authority path.
        }
      }
      return Object.freeze({ identity, acknowledged })
    },
    sourceAtBarrier(): CoreSourceReply | CoreRejectedReply {
      if (disposed) throw new Error('Editor Core binding is disposed')
      if (!opened) throw new Error('Editor Core document is not open')
      if (reconciliationRequired) {
        throw new Error('Editor Core reconciliation is required')
      }
      if (inFlight) throw new Error('Core edit transaction is already in flight')
      sequence += 1
      const reply = port.request(
        Object.freeze({
          type: 'source-at-barrier',
          session,
          sequence,
          baseRevision: revision
        })
      )
      if (reply.type !== 'source' && reply.type !== 'rejected') {
        throw new Error('Core source-at-barrier reply is invalid')
      }
      return reply
    },
    sourceSelectionAtBarrier(
      selection: DocumentSelection
    ): CoreSourceSelectionReply | CoreRejectedReply {
      if (disposed) throw new Error('Editor Core binding is disposed')
      if (!opened) throw new Error('Editor Core document is not open')
      if (reconciliationRequired) throw new Error('Editor Core reconciliation is required')
      if (inFlight) throw new Error('Core edit transaction is already in flight')
      sequence += 1
      const reply = port.request(
        Object.freeze({
          type: 'source-selection-at-barrier',
          session,
          sequence,
          baseRevision: revision,
          selection: copyDocumentSelection(selection, Number.MAX_SAFE_INTEGER)
        })
      )
      if (reply.type !== 'source-selection' && reply.type !== 'rejected') { throw new Error('Core source selection barrier reply is invalid') }
      return reply
    },
    sourceSyntaxAtBarrier(): CoreSourceSyntaxReply | CoreRejectedReply {
      if (disposed) throw new Error('Editor Core binding is disposed')
      if (!opened) throw new Error('Editor Core document is not open')
      if (reconciliationRequired) {
        throw new Error('Editor Core reconciliation is required')
      }
      if (inFlight) throw new Error('Core edit transaction is already in flight')
      sequence += 1
      const reply = port.request(
        Object.freeze({
          type: 'source-syntax-at-barrier',
          session,
          sequence,
          baseRevision: revision
        })
      )
      if (reply.type !== 'source-syntax' && reply.type !== 'rejected') {
        throw new Error('Core source-syntax barrier reply is invalid')
      }
      return reply
    },
    plainTextViewAtBarrier(): CorePlainTextViewReply | CoreRejectedReply {
      if (disposed) throw new Error('Editor Core binding is disposed')
      if (!opened) throw new Error('Editor Core document is not open')
      if (reconciliationRequired) {
        throw new Error('Editor Core reconciliation is required')
      }
      if (inFlight) throw new Error('Core edit transaction is already in flight')
      sequence += 1
      const reply = port.request(
        Object.freeze({
          type: 'plain-text-view-at-barrier',
          session,
          sequence,
          baseRevision: revision
        })
      )
      if (reply.type !== 'plain-text-view' && reply.type !== 'rejected') {
        throw new Error('Core plain-text-view barrier reply is invalid')
      }
      return reply
    },
    displayProjectionAtBarrier(
      name: MarkdownProjectionName
    ): CoreDisplayProjectionReply | CoreRejectedReply {
      if (disposed) throw new Error('Editor Core binding is disposed')
      if (!opened) throw new Error('Editor Core document is not open')
      if (reconciliationRequired) throw new Error('Editor Core reconciliation is required')
      if (inFlight) throw new Error('Core edit transaction is already in flight')
      sequence += 1
      const reply = port.request(
        Object.freeze({
          type: 'display-projection-at-barrier',
          session,
          sequence,
          baseRevision: revision,
          name
        })
      )
      if (reply.type !== 'display-projection' && reply.type !== 'rejected') {
        throw new Error('Core display projection barrier reply is invalid')
      }
      return reply
    },
    consumerProjectionAtBarrier(): CoreConsumerProjectionReply | CoreRejectedReply {
      if (disposed) throw new Error('Editor Core binding is disposed')
      if (!opened) throw new Error('Editor Core document is not open')
      if (reconciliationRequired) {
        throw new Error('Editor Core reconciliation is required')
      }
      if (inFlight) throw new Error('Core edit transaction is already in flight')
      sequence += 1
      const reply = port.request(
        Object.freeze({
          type: 'consumer-projection-at-barrier',
          session,
          sequence,
          baseRevision: revision
        })
      )
      if (reply.type !== 'consumer-projection' && reply.type !== 'rejected') {
        throw new Error('Core consumer projection barrier reply is invalid')
      }
      return reply
    },
    selectionProjectionAtBarrier(
      range: SourceRange | DocumentTableSelection | DocumentModelTextSelection
    ): CoreSelectionProjectionReply | CoreResourceReply | CoreRejectedReply {
      if (disposed) throw new Error('Editor Core binding is disposed')
      if (!opened) throw new Error('Editor Core document is not open')
      if (reconciliationRequired) {
        throw new Error('Editor Core reconciliation is required')
      }
      if (inFlight) throw new Error('Core edit transaction is already in flight')
      sequence += 1
      const reply = port.request(
        Object.freeze({
          type: 'selection-projection-at-barrier',
          session,
          sequence,
          baseRevision: revision,
          range:
            'kind' in range
              ? (copyDocumentSelection(range, Number.MAX_SAFE_INTEGER) as
                  | DocumentTableSelection
                  | DocumentModelTextSelection)
              : Object.freeze({ ...range })
        })
      )
      if (
        reply.type !== 'selection-projection' &&
        reply.type !== 'resource' &&
        reply.type !== 'rejected'
      ) {
        throw new Error('Core selection projection barrier reply is invalid')
      }
      return reply
    },
    reviewItemAtBarrier(
      direction: 'next' | 'previous',
      from: number,
      includeOverview = false
    ): CoreReviewItemReply | CoreRejectedReply {
      if (disposed) throw new Error('Editor Core binding is disposed')
      if (!opened) throw new Error('Editor Core document is not open')
      if (reconciliationRequired) {
        throw new Error('Editor Core reconciliation is required')
      }
      if (inFlight) throw new Error('Core edit transaction is already in flight')
      sequence += 1
      const reply = port.request(
        Object.freeze({
          type: 'review-item-at-barrier',
          session,
          sequence,
          baseRevision: revision,
          direction,
          from,
          ...(includeOverview ? { includeOverview: true } : {})
        })
      )
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
