import type CodeMirror from 'codemirror'
import type {
  DocumentProjectionRequest,
  DocumentSourceEdit,
  CriticMarkupKind,
  DocumentResolutionDecision
} from '@marktext/document-core'

import type { CoreAppliedReply, CoreReviewItemReply } from './coreProtocol'
import type { EditorCoreBinding } from './editorCoreBinding'
import type { CoreAuthorityPerformanceEvent } from './coreAuthorityPerformanceTrace'
import { transformOptimisticHistory } from './optimisticHistoryTransform'
import {
  createCanonicalEolIndex,
  type CanonicalEolIndexInspection,
  type CanonicalLineEnding
} from './canonicalEolIndex'

export interface CodeMirrorCoreAdapter {
  recoveryDraft(): CodeMirrorRecoveryDraft
  settled(): Promise<CoreAppliedReply | undefined>
  history(command: 'undo' | 'redo'): Promise<CoreAppliedReply | undefined>
  resolve(
    annotation: Readonly<{
      readonly kind: CriticMarkupKind
      readonly range: Readonly<{ readonly start: number; readonly end: number }>
    }>,
    authoredRevision: number,
    decision: DocumentResolutionDecision
  ): Promise<CoreAppliedReply | undefined>
  reviewItem(
    direction: 'next' | 'previous',
    from: number
  ): Promise<CoreReviewItemReply>
  compositionStart(): void
  compositionEnd(): Promise<CoreAppliedReply | undefined>
  state(): CodeMirrorCoreAdapterState
  dispose(): void
}

export interface CodeMirrorRecoveryDraft {
  readonly revision: number
  readonly text: string
  readonly commands: readonly Readonly<Record<string, unknown>>[]
  readonly unsubmittedEdits: readonly DocumentSourceEdit[]
  readonly composition: DocumentSourceEdit | undefined
}

export type CodeMirrorCoreAdapterState =
  | Readonly<{ readonly status: 'ready'; readonly lastAcceptedRevision: number }>
  | Readonly<{
    readonly status: 'reconciliation-required'
    readonly lastAcceptedRevision: number
    readonly reason: 'rejected' | 'resource' | 'pending-limit'
  }>
  | Readonly<{
    readonly status: 'faulted'
    readonly lastAcceptedRevision: number
    readonly message: string
  }>

export interface CodeMirrorCoreAdapterOptions {
  /** Unique mounted native view; omitted for independently authored commands. */
  readonly nativeHistoryScope?: string
  /** Maximum accepted-but-unacknowledged native change transactions. */
  readonly maxPending?: number
  readonly maxPendingInsertUnits?: number
  /** Canonical source opened by the Core actor before CodeMirror normalized it. */
  readonly canonicalSource: string
  readonly insertedLineEnding: CanonicalLineEnding
  readonly projections?: () => readonly DocumentProjectionRequest[]
  readonly performanceTrace?: Readonly<{
    readonly documentId: string
    readonly clock?: () => number
    readonly record: (event: CoreAuthorityPerformanceEvent) => void
  }>
}

interface QueuedSourceChange {
  readonly kind: 'source'
  readonly generation: number
  readonly edits: readonly DocumentSourceEdit[]
  readonly nativeHistoryGroup?: string
}

interface QueuedHistoryCommand {
  readonly kind: 'history'
  readonly generation: number
  readonly command: 'undo' | 'redo'
  readonly resolve: (reply: CoreAppliedReply | undefined) => void
  readonly reject: (error: unknown) => void
}

interface QueuedResolveCommand {
  readonly kind: 'resolve'
  readonly generation: number
  readonly annotation: Readonly<{
    readonly kind: CriticMarkupKind
    readonly range: Readonly<{ readonly start: number; readonly end: number }>
  }>
  readonly authoredRevision: number
  readonly decision: DocumentResolutionDecision
  readonly resolve: (reply: CoreAppliedReply | undefined) => void
  readonly reject: (error: unknown) => void
}

type QueuedCommand = QueuedSourceChange | QueuedHistoryCommand | QueuedResolveCommand

interface Settlement {
  readonly generation: number
  readonly resolve: (reply: CoreAppliedReply | undefined) => void
  readonly reject: (error: unknown) => void
}

interface CapturedNativeChange {
  canceled: boolean
  indexApplied: boolean
  suppressed: boolean
  start: number
  end: number
  insert: string
  from: CodeMirror.Position
  to: CodeMirror.Position
  fromLine: number
  toLine: number
  text: readonly string[]
  origin: string | undefined
}

const isNoopCapture = (capture: CapturedNativeChange): boolean =>
  capture.from.line === capture.to.line && capture.from.ch === capture.to.ch &&
  capture.text.length === 1 && capture.text[0] === ''

const adapterInspections = new WeakMap<
  CodeMirrorCoreAdapter,
  () => CanonicalEolIndexInspection
>()

/** Package-private performance inspection; intentionally not re-exported. */
export function inspectCodeMirrorCoreAdapter(
  adapter: CodeMirrorCoreAdapter
): CanonicalEolIndexInspection {
  const inspect = adapterInspections.get(adapter)
  if (inspect === undefined) throw new Error('Unknown CodeMirror Core adapter')
  return inspect()
}

const nextMacrotask = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/**
 * Translates each CodeMirror native operation into exact edits in the previous
 * document's UTF-16 coordinate domain. It never reads a full editor snapshot;
 * the removed text carried by CodeMirror supplies each old extent.
 */
export function createCodeMirrorCoreAdapter(
  doc: CodeMirror.Doc,
  binding: EditorCoreBinding,
  options: CodeMirrorCoreAdapterOptions
): CodeMirrorCoreAdapter {
  const maxPending = options.maxPending ?? 128
  const maxPendingInsertUnits = options.maxPendingInsertUnits ?? 1_048_576
  if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
    throw new TypeError('CodeMirror Core maxPending must be a positive integer')
  }
  if (!Number.isSafeInteger(maxPendingInsertUnits) || maxPendingInsertUnits < 1) {
    throw new TypeError('CodeMirror Core insert-unit limit must be a positive integer')
  }
  return createAdapterWithIndex(
    doc,
    binding,
    maxPending,
    maxPendingInsertUnits,
    createCanonicalEolIndex(options.canonicalSource),
    options.insertedLineEnding,
    options.projections ?? (() => []),
    options.performanceTrace,
    options.nativeHistoryScope
  )
}

function createAdapterWithIndex(
  doc: CodeMirror.Doc,
  binding: EditorCoreBinding,
  maxPending: number,
  maxPendingInsertUnits: number,
  initialEolIndex: ReturnType<typeof createCanonicalEolIndex>,
  insertedLineEnding: CanonicalLineEnding,
  projections: () => readonly DocumentProjectionRequest[],
  performanceTrace: CodeMirrorCoreAdapterOptions['performanceTrace'],
  nativeHistoryScope?: string
): CodeMirrorCoreAdapter {
  const nativeGroups = new WeakMap<object, number>()
  let nextNativeGroup = 0
  const currentNativeGroup = (): string | undefined => {
    if (nativeHistoryScope === undefined) return undefined
    // CodeMirror 5's JSON history export omits event identity. Read the native
    // event object here, at the adapter boundary, without copying history or
    // duplicating CodeMirror's time/origin/operation grouping rules.
    const history = (doc as unknown as { history?: { done?: readonly unknown[] } }).history?.done
    if (!Array.isArray(history)) return undefined
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const event = history[index]
      if (event === null || typeof event !== 'object' || !Array.isArray((event as { changes?: unknown }).changes)) continue
      let group = nativeGroups.get(event)
      if (group === undefined) { group = ++nextNativeGroup; nativeGroups.set(event, group) }
      return `${nativeHistoryScope}:${group}`
    }
    return undefined
  }
  const eolIndex = initialEolIndex
  const queue: QueuedCommand[] = []
  const captures: CapturedNativeChange[] = []
  // CodeMirror 5 returns runtime `undefined` for an unattached Doc even though
  // its declaration says `null`; normalize both before choosing the event seam.
  const editor = doc.getEditor() ?? undefined
  const nativeOperationEdits: DocumentSourceEdit[] = []
  const settlements: Settlement[] = []
  let generation = 0
  const sourceCommandLedger: Array<Readonly<{
    readonly generation: number
    readonly edits: readonly DocumentSourceEdit[]
  }>> = []
  let completedGeneration = 0
  let active = false
  let activeCommand: QueuedCommand | undefined
  let latestSubmitted: QueuedCommand | undefined
  let latestNativeEdits: readonly DocumentSourceEdit[] = []
  let failedDraft: CodeMirrorRecoveryDraft | undefined
  let pendingInsertUnits = 0
  let lastAcceptedRevision = 1
  let reconciliationReason: 'rejected' | 'resource' | 'pending-limit' | undefined
  let faultMessage: string | undefined
  let latestReply: CoreAppliedReply | undefined
  let terminalError: unknown
  let disposed = false
  let suppressingAuthoritativeChange = false
  let composing = false
  let compositionEdit: DocumentSourceEdit | undefined
  let finishComposition: ((reply: CoreAppliedReply | undefined) => void) | undefined
  let failComposition: ((error: unknown) => void) | undefined
  let compositionFinished: Promise<CoreAppliedReply | undefined> | undefined

  type PerformanceEventInput =
    | Readonly<{
      readonly phase: 'dispatch'
      readonly transaction: number
      readonly pendingDepth: number
    }>
    | Readonly<{ readonly phase: 'ack'; readonly transaction: number }>
    | Readonly<{
      readonly phase: 'reconcile'
      readonly transaction: number
      readonly corrected: boolean
    }>
  const recordPerformance = (event: PerformanceEventInput): void => {
    if (performanceTrace === undefined) return
    const at = (performanceTrace.clock ?? (() => performance.now()))()
    if (!Number.isFinite(at) || at < 0) return
    try {
      performanceTrace.record(Object.freeze({
        ...event,
        documentId: performanceTrace.documentId,
        at
      }) as CoreAuthorityPerformanceEvent)
    } catch {
      // Measurement is diagnostic-only and cannot perturb authority.
    }
  }

  const rejectSettlements = (error: unknown): void => {
    for (const settlement of settlements.splice(0)) settlement.reject(error)
  }
  const resolveSettlements = (): void => {
    for (let index = 0; index < settlements.length;) {
      const settlement = settlements[index]
      if (settlement === undefined || settlement.generation > completedGeneration) {
        index += 1
        continue
      }
      settlements.splice(index, 1)
      settlement.resolve(latestReply)
    }
  }
  const captureDraft = (): CodeMirrorRecoveryDraft => {
    const submitted = activeCommand ?? latestSubmitted
    return structuredClone({
      revision: lastAcceptedRevision,
      text: doc.getValue(),
      commands: [...(submitted !== undefined && submitted.generation > completedGeneration ? [submitted] : []), ...queue]
        .map(command => Object.fromEntries(Object.entries(command).filter(([, value]) => typeof value !== 'function'))),
      unsubmittedEdits: latestNativeEdits,
      composition: compositionEdit
    })
  }
  const failCommandLane = (error: unknown): void => {
    faultMessage = error instanceof Error ? error.message : 'Core command failed'
    terminalError = error
    failedDraft ??= captureDraft()
    for (const command of queue.splice(0)) {
      if (command.kind !== 'source') command.reject(error)
    }
    rejectSettlements(error)
  }
  const applyHistoryToOptimisticView = async(
    appliedEdits: readonly DocumentSourceEdit[],
    nextSourceLength: number
  ): Promise<void> => {
    // A native edit mutates the Doc synchronously but CodeMirror publishes its
    // matching `change` notification later. Drain that turn before rebasing so
    // every draft already visible in the view is represented in the queue.
    await nextMacrotask()
    if (disposed) return
    const sourceCommands = queue.filter(
      (command): command is QueuedSourceChange => command.kind === 'source'
    )
    const historyDelta = appliedEdits.reduce(
      (sum, edit) => sum + edit.insert.length - (edit.end - edit.start),
      0
    )
    const transformed = transformOptimisticHistory({
      baseSourceLength: nextSourceLength - historyDelta,
      appliedEdits,
      queuedTransactions: sourceCommands.map(command => command.edits)
    })
    if (transformed.kind === 'conflict') {
      throw new Error('Core history overlaps pending editor input')
    }
    let transactionIndex = 0
    for (let index = 0; index < queue.length; index += 1) {
      const command = queue[index]
      if (command === undefined || command.kind !== 'source') continue
      const rebasedSource = transformed.rebasedTransactions[transactionIndex]
      if (rebasedSource === undefined) {
        throw new Error('Core history transform lost a pending transaction')
      }
      transactionIndex += 1
      queue[index] = Object.freeze({
        kind: 'source',
        generation: command.generation,
        edits: rebasedSource
      })
    }
    suppressingAuthoritativeChange = true
    try {
      for (
        let index = transformed.reconciliationEdits.length - 1;
        index >= 0;
        index -= 1
      ) {
        const edit = transformed.reconciliationEdits[index]
        if (edit === undefined) continue
        doc.replaceRange(
          edit.insert,
          eolIndex.position(edit.start),
          eolIndex.position(edit.end),
          'marktext-core-history'
        )
      }
    } finally {
      suppressingAuthoritativeChange = false
    }
    await nextMacrotask()
  }
  const pump = (): void => {
    if (active || disposed || terminalError !== undefined) return
    const queued = queue.shift()
    if (queued === undefined) return
    active = true
    activeCommand = queued
    latestSubmitted = queued
    let acknowledged: ReturnType<EditorCoreBinding['submit']>['acknowledged']
    let transactionId = 0
    try {
      const submission = binding.submit(queued.kind === 'source'
        ? {
          edits: queued.edits,
          projections: projections(),
          ...(queued.nativeHistoryGroup === undefined ? {} : { nativeHistoryGroup: queued.nativeHistoryGroup })
        }
        : queued.kind === 'history'
          ? { kind: queued.command, projections: projections() }
          : {
            kind: 'resolve',
            authoredRevision: queued.authoredRevision,
            annotation: queued.annotation,
            decision: queued.decision,
            projections: projections()
          }
      )
      acknowledged = submission.acknowledged
      transactionId = submission.identity.transactionId
      recordPerformance({
        phase: 'dispatch',
        transaction: transactionId,
        pendingDepth: queue.length + 1
      })
    } catch (error) {
      active = false
      activeCommand = undefined
      if (queued.kind !== 'source') queued.reject(error)
      failCommandLane(error)
      return
    }
    acknowledged.then(async reply => {
      recordPerformance({ phase: 'ack', transaction: transactionId })
      if (disposed) return
      if (queued.kind === 'source') {
        pendingInsertUnits -= queued.edits.reduce(
          (sum, edit) => sum + edit.insert.length,
          0
        )
      }
      if (
        queued.kind === 'history' && reply.type === 'rejected' &&
        reply.reason === 'history-empty'
      ) {
        active = false
        activeCommand = undefined
        completedGeneration = queued.generation
        queued.resolve(undefined)
        resolveSettlements()
        pump()
        return
      }
      if (
        queued.kind === 'source' && reply.type === 'rejected' &&
        reply.reason === 'no-change'
      ) {
        active = false
        activeCommand = undefined
        completedGeneration = queued.generation
        resolveSettlements()
        pump()
        return
      }
      if (
        queued.kind === 'resolve' && reply.type === 'rejected' &&
        reply.reason === 'history-resource'
      ) {
        active = false
        activeCommand = undefined
        completedGeneration = queued.generation
        queued.resolve(undefined)
        resolveSettlements()
        pump()
        return
      }
      if (
        queued.kind === 'resolve' && reply.type === 'rejected' &&
        (reply.reason === 'stale-base' ||
          reply.reason === 'annotation-not-found' ||
          reply.reason === 'resolution-invalid')
      ) {
        active = false
        activeCommand = undefined
        completedGeneration = queued.generation
        queued.reject(new Error('Core resolution target is no longer current'))
        resolveSettlements()
        pump()
        return
      }
      if (reply.type !== 'applied') {
        active = false
        activeCommand = undefined
        reconciliationReason = reply.type === 'resource' ? 'resource' : 'rejected'
        terminalError = new Error('CodeMirror Core reconciliation required')
        if (queued.kind !== 'source') queued.reject(terminalError)
        failedDraft ??= captureDraft()
        for (const command of queue.splice(0)) {
          if (command.kind !== 'source') command.reject(terminalError)
        }
        rejectSettlements(terminalError)
        return
      }
      if (queued.kind !== 'source') {
        try {
          await applyHistoryToOptimisticView(
            reply.change.appliedEdits,
            reply.sourceLength
          )
          if (disposed) return
        } catch (error) {
          active = false
          activeCommand = undefined
          queued.reject(error)
          failCommandLane(error)
          return
        }
      }
      latestReply = reply
      lastAcceptedRevision = reply.revision
      completedGeneration = queued.generation
      recordPerformance({
        phase: 'reconcile',
        transaction: transactionId,
        corrected: queued.kind !== 'source'
      })
      active = false
      activeCommand = undefined
      if (queued.kind !== 'source') queued.resolve(reply)
      resolveSettlements()
      pump()
    }, error => {
      if (disposed) return
      active = false
      activeCommand = undefined
      if (queued.kind !== 'source') queued.reject(error)
      failCommandLane(error)
    })
  }
  const enqueue = (edits: readonly DocumentSourceEdit[]): void => {
    latestNativeEdits = edits
    if (queue.length + (active ? 1 : 0) >= maxPending) {
      reconciliationReason = 'pending-limit'
      terminalError = new Error('CodeMirror Core reconciliation required')
      failedDraft ??= captureDraft()
      for (const command of queue.splice(0)) {
        if (command.kind !== 'source') command.reject(terminalError)
      }
      rejectSettlements(terminalError)
      return
    }
    const insertUnits = edits.reduce((sum, edit) => sum + edit.insert.length, 0)
    if (pendingInsertUnits + insertUnits > maxPendingInsertUnits) {
      reconciliationReason = 'pending-limit'
      terminalError = new Error('CodeMirror Core reconciliation required')
      failedDraft ??= captureDraft()
      for (const command of queue.splice(0)) {
        if (command.kind !== 'source') command.reject(terminalError)
      }
      rejectSettlements(terminalError)
      return
    }
    generation += 1
    pendingInsertUnits += insertUnits
    const stableEdits = Object.freeze(edits
      .map(edit => Object.freeze({ ...edit }))
      .sort((left, right) => left.start - right.start || left.end - right.end))
    const command = Object.freeze({
      kind: 'source',
      generation,
      edits: stableEdits,
      ...(nativeHistoryScope === undefined ? {} : { nativeHistoryGroup: currentNativeGroup() })
    })
    queue.push(command)
    sourceCommandLedger.push(command)
    if (sourceCommandLedger.length > maxPending) sourceCommandLedger.shift()
    pump()
  }
  const enqueueHistory = (
    command: 'undo' | 'redo'
  ): Promise<CoreAppliedReply | undefined> => {
    if (queue.length + (active ? 1 : 0) >= maxPending) {
      reconciliationReason = 'pending-limit'
      terminalError = new Error('CodeMirror Core reconciliation required')
      failedDraft ??= captureDraft()
      for (const queued of queue.splice(0)) {
        if (queued.kind !== 'source') queued.reject(terminalError)
      }
      rejectSettlements(terminalError)
      return Promise.reject(terminalError)
    }
    generation += 1
    return new Promise((resolve, reject) => {
      queue.push(Object.freeze({
        kind: 'history',
        generation,
        command,
        resolve,
        reject
      }))
      pump()
    })
  }
  const enqueueResolution = (
    annotation: QueuedResolveCommand['annotation'],
    authoredRevision: number,
    decision: DocumentResolutionDecision,
    authoredGeneration: number
  ): Promise<CoreAppliedReply | undefined> => {
    if (queue.length + (active ? 1 : 0) >= maxPending) {
      reconciliationReason = 'pending-limit'
      terminalError = new Error('CodeMirror Core reconciliation required')
      failedDraft ??= captureDraft()
      for (const queued of queue.splice(0)) {
        if (queued.kind !== 'source') queued.reject(terminalError)
      }
      rejectSettlements(terminalError)
      return Promise.reject(terminalError)
    }
    let range = { ...annotation.range }
    let rebasedRevision = authoredRevision
    for (const transaction of sourceCommandLedger) {
      if (transaction.generation <= authoredGeneration) continue
      // Every edit in a transaction uses the same pre-transaction coordinates.
      // Shift only after classifying all of them against that original range.
      let shift = 0
      for (const edit of transaction.edits) {
        if (edit.end <= range.start) {
          shift += edit.insert.length - (edit.end - edit.start)
        } else if (edit.start < range.end) {
          return Promise.reject(
            new Error('Core resolution target changed by pending editor input')
          )
        }
      }
      range = { start: range.start + shift, end: range.end + shift }
      rebasedRevision += 1
    }
    generation += 1
    return new Promise((resolve, reject) => {
      queue.push(Object.freeze({
        kind: 'resolve',
        generation,
        authoredRevision: rebasedRevision,
        annotation: Object.freeze({
          kind: annotation.kind,
          range: Object.freeze(range)
        }),
        decision,
        resolve,
        reject
      }))
      pump()
    })
  }
  const onBeforeChange = (
    changed: CodeMirror.Doc,
    change: CodeMirror.EditorChangeCancellable
  ): void => {
    if (disposed || terminalError !== undefined) return
    for (let index = captures.length - 1; index >= 0; index -= 1) {
      const prior = captures[index]
      if (prior === undefined || prior.canceled || prior.indexApplied) continue
      if (isNoopCapture(prior)) {
        prior.canceled = true
        continue
      }
      eolIndex.replace(
        prior.from,
        prior.to,
        prior.text,
        insertedLineEnding
      )
      prior.indexApplied = true
      break
    }
    const capture: CapturedNativeChange = {
      canceled: false,
      indexApplied: false,
      suppressed: suppressingAuthoritativeChange,
      start: 0,
      end: 0,
      insert: '',
      from: Object.freeze({ line: 0, ch: 0 }),
      to: Object.freeze({ line: 0, ch: 0 }),
      fromLine: 0,
      toLine: 0,
      text: [],
      origin: undefined
    }
    const refresh = (): void => {
      const plan = eolIndex.plan(
        change.from,
        change.to,
        change.text,
        insertedLineEnding
      )
      capture.start = plan.start
      capture.end = plan.end
      capture.insert = plan.insert
      capture.from = Object.freeze({ ...change.from })
      capture.to = Object.freeze({ ...change.to })
      capture.fromLine = change.from.line
      capture.toLine = change.to.line
      capture.text = Object.freeze([...change.text])
      capture.origin = change.origin
    }
    refresh()
    const cancel = change.cancel.bind(change)
    change.cancel = (): void => {
      capture.canceled = true
      cancel()
    }
    if (change.update !== undefined) {
      const update = change.update.bind(change)
      change.update = (from, to, text): void => {
        update(from, to, text)
        refresh()
      }
    }
    captures.push(capture)
  }
  const onChange = (
    _changed: CodeMirror.Doc,
    change: CodeMirror.EditorChange
  ): void => {
    while (
      captures[0]?.canceled === true ||
      (captures[0] !== undefined && isNoopCapture(captures[0]))
    ) captures.shift()
    const capture = captures.shift()
    if (capture === undefined) {
      faultMessage = 'CodeMirror Core change lacked a pre-change capture'
      terminalError = new Error(faultMessage)
      rejectSettlements(terminalError)
      return
    }
    if (
      capture.fromLine !== change.from.line ||
      capture.from.ch !== change.from.ch ||
      capture.toLine !== change.to.line ||
      capture.to.ch !== change.to.ch ||
      capture.origin !== change.origin ||
      capture.text.join('\n') !== change.text.join('\n')
    ) {
      faultMessage = 'CodeMirror Core change capture did not match'
      terminalError = new Error(faultMessage)
      rejectSettlements(terminalError)
      return
    }
    if (capture.suppressed) {
      if (!capture.indexApplied) {
        eolIndex.replace(
          capture.from,
          capture.to,
          capture.text,
          insertedLineEnding
        )
        capture.indexApplied = true
      }
      return
    }
    if (!capture.indexApplied) {
      eolIndex.replace(
        capture.from,
        capture.to,
        capture.text,
        insertedLineEnding
      )
      capture.indexApplied = true
    }
    const edit = Object.freeze({
      start: capture.start,
      end: capture.end,
      insert: capture.insert
    })
    if (!composing) {
      if (editor === undefined) {
        enqueue([edit])
      } else {
        nativeOperationEdits.push(edit)
      }
      return
    }
    if (compositionEdit === undefined) {
      compositionEdit = edit
      return
    }
    const relativeStart = edit.start - compositionEdit.start
    const relativeEnd = edit.end - compositionEdit.start
    if (
      relativeStart < 0 || relativeEnd < relativeStart ||
      relativeEnd > compositionEdit.insert.length
    ) {
      faultMessage = 'CodeMirror composition escaped its authored range'
      terminalError = new Error(faultMessage)
      failComposition?.(terminalError)
      rejectSettlements(terminalError)
      return
    }
    compositionEdit = Object.freeze({
      start: compositionEdit.start,
      end: compositionEdit.end,
      insert: compositionEdit.insert.slice(0, relativeStart) +
        edit.insert + compositionEdit.insert.slice(relativeEnd)
    })
  }
  const onChanges = (): void => {
    if (nativeOperationEdits.length === 0) return
    const edits = nativeOperationEdits.splice(0)
    if (disposed || terminalError !== undefined) return
    enqueue(edits)
  }
  doc.on('beforeChange', onBeforeChange)
  doc.on('change', onChange)
  editor?.on('changes', onChanges)

  const adapter: CodeMirrorCoreAdapter = Object.freeze({
    recoveryDraft(): CodeMirrorRecoveryDraft {
      return failedDraft ?? captureDraft()
    },
    async settled(): Promise<CoreAppliedReply | undefined> {
      // CodeMirror 5 delivers Doc change notifications through signalLater.
      // Cross that delivery turn before capturing the generation barrier.
      await nextMacrotask()
      if (composing && compositionFinished !== undefined) {
        return compositionFinished
      }
      if (terminalError !== undefined) throw terminalError
      if (generation === 0) return latestReply
      const target = generation
      if (completedGeneration >= target) {
        return latestReply
      }
      return new Promise<CoreAppliedReply | undefined>((resolve, reject) => {
        settlements.push(Object.freeze({
          generation: target,
          resolve,
          reject
        }))
      })
    },
    compositionStart(): void {
      if (disposed) throw new Error('CodeMirror Core adapter is disposed')
      if (terminalError !== undefined) throw terminalError
      if (composing) throw new Error('CodeMirror composition is already active')
      composing = true
      compositionEdit = undefined
      compositionFinished = new Promise((resolve, reject) => {
        finishComposition = resolve
        failComposition = reject
      })
    },
    async compositionEnd(): Promise<CoreAppliedReply | undefined> {
      if (!composing || compositionFinished === undefined) {
        throw new Error('CodeMirror composition is not active')
      }
      await nextMacrotask()
      composing = false
      const finished = compositionFinished
      const edit = compositionEdit
      compositionEdit = undefined
      if (edit === undefined) {
        finishComposition?.(latestReply)
      } else {
        enqueue([edit])
        adapter.settled().then(finishComposition, failComposition)
      }
      try {
        return await finished
      } finally {
        finishComposition = undefined
        failComposition = undefined
        compositionFinished = undefined
      }
    },
    async history(command: 'undo' | 'redo'): Promise<CoreAppliedReply | undefined> {
      // Cross CodeMirror's deferred change delivery so a native edit observed
      // immediately before this command occupies the earlier queue position.
      await nextMacrotask()
      if (composing && compositionFinished !== undefined) {
        await compositionFinished
      }
      if (terminalError !== undefined) throw terminalError
      return enqueueHistory(command)
    },
    async resolve(
      annotation: QueuedResolveCommand['annotation'],
      authoredRevision: number,
      decision: DocumentResolutionDecision
    ): Promise<CoreAppliedReply | undefined> {
      const capturedAnnotation = Object.freeze({
        kind: annotation.kind,
        range: Object.freeze({ ...annotation.range })
      })
      const authoredGeneration = generation
      await nextMacrotask()
      if (composing && compositionFinished !== undefined) {
        await compositionFinished
      }
      if (terminalError !== undefined) throw terminalError
      return enqueueResolution(
        capturedAnnotation,
        authoredRevision,
        decision,
        authoredGeneration
      )
    },
    async reviewItem(
      direction: 'next' | 'previous',
      from: number
    ): Promise<CoreReviewItemReply> {
      await adapter.settled()
      if (terminalError !== undefined) throw terminalError
      const reply = await binding.reviewItemAtBarrier(direction, from)
      if (reply.type !== 'review-item') {
        throw new Error('Core Review navigation became stale')
      }
      return reply
    },
    state(): CodeMirrorCoreAdapterState {
      if (faultMessage !== undefined) {
        return Object.freeze({
          status: 'faulted',
          lastAcceptedRevision,
          message: faultMessage
        })
      }
      return reconciliationReason === undefined
        ? Object.freeze({ status: 'ready', lastAcceptedRevision })
        : Object.freeze({
          status: 'reconciliation-required',
          lastAcceptedRevision,
          reason: reconciliationReason
        })
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      doc.off('beforeChange', onBeforeChange)
      doc.off('change', onChange)
      editor?.off('changes', onChanges)
      captures.splice(0)
      nativeOperationEdits.splice(0)
      const error = new Error('CodeMirror Core adapter is disposed')
      if (activeCommand?.kind !== undefined && activeCommand.kind !== 'source') {
        activeCommand.reject(error)
      }
      activeCommand = undefined
      active = false
      for (const command of queue.splice(0)) {
        if (command.kind !== 'source') command.reject(error)
      }
      failComposition?.(error)
      rejectSettlements(error)
      if (terminalError === undefined) {
        terminalError = error
      }
    }
  })
  adapterInspections.set(adapter, () => eolIndex.inspection())
  return adapter
}
