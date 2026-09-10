import type { DocumentCompositionResult } from '@muyajs/core'
import type {
  DocumentSelection,
  DocumentClipboardAction,
  DocumentClipboardContent,
  DocumentClipboardPasteAction,
  DocumentClipboardSelection,
  DocumentFormatAction,
  DocumentInputAction,
  DocumentInputSelection,
  DocumentSourceEdit,
  MarkdownOptions
} from '@marktext/document-core'

import type { EditorCoreBinding } from './editorCoreBinding'
import type {
  CoreAppliedReply,
  CorePreparedOperation,
  CoreAuthorForm,
  CoreReviewDecision,
  CoreReviewItemLocator
} from './coreProtocol'
import type { CoreAuthorityPerformanceEvent } from './coreAuthorityPerformanceTrace'
import {
  advanceMuyaSourceBinding,
  assertMuyaDocumentSourceBinding,
  createMuyaPlainTextSourceEditAdapter,
  nativeMuyaTextEdit,
  sourceEditForMuyaTwoParagraphPaste,
  type MuyaPlainTextSourceBinding
} from './muyaPlainTextSourceEdit'
import { muyaSourceEdits } from './muyaContainerSourceEdit'
import { mappedMuyaSourceRange } from './muyaMarkupView'
import {
  reconcileOptimisticTransaction,
  transformOptimisticHistory
} from './optimisticHistoryTransform'
import { sourceEditForMuyaStructuralEnter } from './muyaStructuralEnter'
import {
  nativeMuyaStructuralDraft,
  sourceEditForMuyaStructuralChange
} from './muyaStructuralSourceEdit'
import {
  reconcileMuyaNativeBindings,
  reconcileMuyaNativeStructureBindings
} from './muyaNativeReconciliation'

export type { MuyaPlainTextSourceBinding } from './muyaPlainTextSourceEdit'

export type MuyaPlainTextAuthorSelection = Readonly<{
  readonly anchor: Readonly<{
    readonly path: readonly (string | number)[]
    readonly offset: number
  }>
  readonly focus: Readonly<{
    readonly path: readonly (string | number)[]
    readonly offset: number
  }>
}>

/** Canonical source positions resolved from the current model's rendered DOM. */
export type MuyaModelInput = DocumentInputAction & Readonly<{ historyGroup?: number }>

export type MuyaPlainTextCoreAdapterState =
  | Readonly<{ readonly status: 'ready'; readonly revision: number }>
  | Readonly<{ readonly status: 'faulted'; readonly message: string }>

/** Diagnostics omit mixed coordinate lengths instead of reporting a guessed source size. */
function selectionMeasurement(selection: DocumentInputSelection): { deletedUnits?: number } {
  if ('ranges' in selection) {
    return {
      deletedUnits: selection.ranges.reduce(
        (total, range) => total + Math.abs(range.focus - range.anchor),
        0
      )
    }
  }
  if (selection.kind === 'table-cell') { return { deletedUnits: Math.abs(selection.focus - selection.anchor) } }
  const { anchor, focus } = selection
  if (typeof anchor === 'number' && typeof focus === 'number') { return { deletedUnits: Math.abs(focus - anchor) } }
  if (
    typeof anchor !== 'number' &&
    typeof focus !== 'number' &&
    anchor.text.start === focus.text.start &&
    anchor.text.end === focus.text.end
  ) { return { deletedUnits: Math.abs(focus.offset - anchor.offset) } }
  return {}
}

export interface MuyaRecoveryDraft {
  readonly revision: number
  readonly nativeChange: unknown
  readonly commands: readonly Readonly<Record<string, unknown>>[]
  readonly composition: unknown
  readonly clipboardPreparations?: readonly unknown[]
}

interface MuyaResourcePreparation {
  readonly finished: Promise<void>
  modelSelection(): DocumentClipboardSelection
  capturePayload(payload: unknown): void
  cancel(): void
  fail(error: Error): void
}

interface PendingResourcePreparation {
  target: string
  selection: DocumentClipboardSelection
  selectionRevision: number
  tracked: boolean
  payload: unknown
  completion?: unknown
  targetFailure?: string
  submitting: boolean
  finish(): void
}

type ImagePropertiesAction = Extract<DocumentFormatAction, { format: 'image-properties' }>

export interface MuyaImagePreparation extends MuyaResourcePreparation {
  complete(
    properties: ImagePropertiesAction['properties'],
    currentSelection?: () => DocumentInputSelection
  ): Promise<Readonly<{ accepted: boolean; changed: boolean }>>
}

type MuyaClipboardCapture =
  | Omit<Extract<DocumentClipboardPasteAction, { kind: 'paste' }>, 'kind' | 'markdown'>
  | Omit<Extract<DocumentClipboardPasteAction, { kind: 'table' }>, 'markdown'>

export interface MuyaClipboardPreparation extends MuyaResourcePreparation {
  complete(
    markdown: string,
    imported?: Readonly<{
      plainText?: string
      bareUrl?: string
      pasteAsPlainText?: boolean
      currentSelection?: () => DocumentSelection
    }>
  ): Promise<Readonly<{ accepted: boolean; changed: boolean }>>
  fail(error: Error): void
}

export interface MuyaPlainTextCoreAdapter {
  reconciledSourcePosition(point: MuyaPlainTextAuthorSelection['focus']): number | undefined
  hasPendingEdits(): boolean
  recoveryDraft(): MuyaRecoveryDraft | undefined
  input(
    operation: MuyaModelInput,
    reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[],
    tracked?: boolean
  ): Readonly<{ accepted: boolean; changed: boolean }>
  prepareImage(
    action: ImagePropertiesAction,
    payload: unknown,
    reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
  ): MuyaImagePreparation
  prepareClipboard(
    action: MuyaClipboardCapture,
    payload: unknown,
    reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
  ): MuyaClipboardPreparation
  clipboard(
    action: DocumentClipboardAction,
    reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
  ): Readonly<{ accepted: boolean; changed: boolean }>
  format(
    action: DocumentFormatAction,
    reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
  ): Readonly<{ accepted: boolean; changed: boolean }>
  accept(change: unknown): 'accepted' | 'unsupported'
  selectionSourceRange(
    selection: MuyaPlainTextAuthorSelection
  ): Readonly<{ readonly start: number; readonly end: number }> | undefined
  acceptTracked(
    change: unknown,
    reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[],
    markup?: boolean
  ): 'accepted' | 'unsupported'
  compositionStart(operation: MuyaModelInput): void
  compositionUpdate(data: string): void
  compositionEnd(
    result: DocumentCompositionResult,
    reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[],
    tracked?: boolean
  ): Readonly<{ accepted: boolean; changed: boolean }>
  configure(
    options: Readonly<Partial<MarkdownOptions>>,
    reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
  ): Promise<CoreAppliedReply | undefined>
  history(
    command: 'undo' | 'redo',
    reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
  ): Promise<CoreAppliedReply | undefined>
  resolve(
    annotation: CoreReviewItemLocator,
    authoredRevision: number,
    decision: CoreReviewDecision,
    reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
  ): Promise<CoreAppliedReply | undefined>
  resolveAll(
    decision: 'accept' | 'reject',
    reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
  ): Promise<CoreAppliedReply | undefined>
  editComment(
    annotation: CoreReviewItemLocator,
    authoredRevision: number,
    text: string,
    reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
  ): Promise<CoreAppliedReply | undefined>
  author(
    form: CoreAuthorForm,
    selection: MuyaPlainTextAuthorSelection,
    text: string,
    reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
  ): Promise<CoreAppliedReply | undefined>
  reconcileApplied(
    outcome: CoreAppliedReply,
    reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
  ): Promise<void>
  isComposing(): boolean
  isSettled(): boolean
  settled(): Promise<void>
  state(): MuyaPlainTextCoreAdapterState
  dispose(): void
}

const MAXIMUM_PENDING_TRANSACTIONS = 128
const MAXIMUM_PENDING_INSERT_UNITS = 4 * 1024 * 1024

type PendingCommand =
  | Readonly<{
    readonly kind: 'apply-prepared'
    readonly target: string
    readonly operation: CorePreparedOperation
    readonly reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    readonly resolve: (outcome: CoreAppliedReply | undefined) => void
    readonly reject: (error: Error) => void
  }>
  | Readonly<{
    readonly kind: 'clipboard'
    readonly action: DocumentClipboardAction
    readonly reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    readonly resolve: (outcome: CoreAppliedReply | undefined) => void
    readonly reject: (error: Error) => void
  }>
  | Readonly<{
    readonly kind: 'format'
    readonly action: DocumentFormatAction
    readonly reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    readonly resolve: (outcome: CoreAppliedReply | undefined) => void
    readonly reject: (error: Error) => void
  }>
  | Readonly<{
    readonly kind: 'edit'
    readonly nativeHistoryGroup?: string
    readonly edit: DocumentSourceEdit
    readonly remapFollowingNative?: true
  }>
  | Readonly<{
    readonly kind: 'track'
    readonly input?: MuyaModelInput
    readonly nativeTextOnly: boolean
    readonly nativeHistoryGroup?: string
    readonly markup?: boolean
    readonly edit?: DocumentSourceEdit
    readonly deferredChange?: unknown
    readonly reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    readonly resolve: (outcome: CoreAppliedReply) => void
    readonly reject: (error: Error) => void
  }>
  | Readonly<{
    readonly kind: 'history'
    readonly command: 'undo' | 'redo' | 'configure'
    readonly options?: Readonly<Partial<MarkdownOptions>>
    readonly reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    readonly resolve: (outcome: CoreAppliedReply | undefined) => void
    readonly reject: (error: Error) => void
  }>
  | Readonly<{
    readonly kind: 'resolve'
    readonly annotation: CoreReviewItemLocator
    readonly authoredRevision: number
    readonly decision: CoreReviewDecision
    readonly reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    readonly resolve: (outcome: CoreAppliedReply | undefined) => void
    readonly reject: (error: Error) => void
  }>
  | Readonly<{
    readonly kind: 'author'
    readonly form: CoreAuthorForm
    readonly selection: MuyaPlainTextAuthorSelection
    readonly text: string
    readonly reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    readonly resolve: (outcome: CoreAppliedReply | undefined) => void
    readonly reject: (error: Error) => void
  }>
  | Readonly<{
    readonly kind: 'edit-comment'
    readonly annotation: CoreReviewItemLocator
    readonly authoredRevision: number
    readonly text: string
    readonly reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    readonly resolve: (outcome: CoreAppliedReply | undefined) => void
    readonly reject: (error: Error) => void
  }>
  | Readonly<{
    readonly kind: 'resolve-all'
    readonly decision: 'accept' | 'reject'
    readonly reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    readonly resolve: (outcome: CoreAppliedReply | undefined) => void
    readonly reject: (error: Error) => void
  }>

const pathOf = (change: unknown): string | undefined => {
  if (change === null || typeof change !== 'object') return undefined
  const operation = (change as { readonly op?: unknown }).op
  if (!Array.isArray(operation) || operation.length < 2) return undefined
  return JSON.stringify(operation.slice(0, -1))
}

/**
 * Serializes the currently proven native Muya paragraph operations through one
 * Core binding. The view stays speculative; any unsupported or rejected
 * operation faults closed for the owner to reconcile or recover.
 */
export function createMuyaPlainTextCoreAdapter(
  bindings: readonly MuyaPlainTextSourceBinding[],
  binding: Pick<
    EditorCoreBinding,
    'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
  >,
  performanceTrace?: Readonly<{
    readonly documentId: string
    readonly clock?: () => number
    readonly record: (event: CoreAuthorityPerformanceEvent) => void
  }>,
  reconcileOrdinaryEdit?: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[],
  initialRevision = 1,
  regionalMarkup = false
): MuyaPlainTextCoreAdapter {
  const adapters = new Map<
    string,
    ReturnType<typeof createMuyaPlainTextSourceEditAdapter> | undefined
  >()
  const bindingByPath = new Map<string, MuyaPlainTextSourceBinding>()
  let currentBindings: readonly MuyaPlainTextSourceBinding[] = Object.freeze([])
  let selectionBindings: readonly MuyaPlainTextSourceBinding[] = Object.freeze([])
  const queued: PendingCommand[] = []
  const preparations = new Set<PendingResourcePreparation>()
  const refreshPreparation = (preparation: PendingResourcePreparation): void => {
    if (preparation.submitting) return
    try {
      const target = binding.retainedSelectionAtBarrier(preparation.target)
      if (target.type === 'retained-selection') {
        preparation.selection = structuredClone(target.selection)
        preparation.selectionRevision = target.selectionRevision
        if (target.status === 'conflict') { preparation.targetFailure = 'Prepared resource overlaps newer input' }
      } else preparation.targetFailure = `Prepared resource target read was ${target.reason}`
    } catch (error) {
      preparation.targetFailure = error instanceof Error ? error.message : String(error)
    }
  }
  const releasePreparation = (preparation: PendingResourcePreparation): void => {
    try {
      const reply = binding.releaseSelection(preparation.target)
      if (reply.type !== 'selection-released') { preparation.targetFailure = `Prepared resource release was ${reply.reason}` }
    } catch (error) {
      preparation.targetFailure = error instanceof Error ? error.message : String(error)
    }
  }
  let latestNativeChange: unknown
  let latestSubmitted: PendingCommand | undefined
  let failedDraft: MuyaRecoveryDraft | undefined
  const waiters = new Set<{
    readonly resolve: () => void
    readonly reject: (error: Error) => void
  }>()
  let active: PendingCommand | undefined
  let disposed = false
  let pendingInsertUnits = 0
  // The native view can lag a history command while the user keeps typing.
  // Keep its bindings in that coordinate domain until the visible draft drains.
  let pendingHistory: { baseSourceLength: number; edits: readonly DocumentSourceEdit[] } | undefined
  let nativeBindingsPending = false
  let reconciledNativePositionReady = false
  const historyIsPending = (): boolean =>
    pendingHistory !== undefined ||
    active?.kind === 'history' ||
    queued.some((command) => command.kind === 'history')
  const directHistoryScope = crypto.randomUUID()
  let revision = initialRevision
  let terminalError: Error | undefined
  let composing = false
  let compositionInput: Extract<MuyaModelInput, { inputType: string }> | undefined
  let compositionChange: unknown
  let compositionBarrier:
    | Readonly<{
      readonly promise: Promise<void>
      readonly resolve: () => void
      readonly reject: (error: Error) => void
    }>
    | undefined

  type PerformanceEventInput =
    | Readonly<{
      readonly phase: 'dispatch'
      readonly transaction: number
      readonly pendingDepth: number
      readonly insertedUnits?: number
      readonly deletedUnits?: number
    }>
    | Readonly<{ readonly phase: 'ack'; readonly transaction: number }>
    | Readonly<{
      readonly phase: 'reconcile'
      readonly transaction: number
      readonly corrected: boolean
    }>
  const recordPerformance = (event: PerformanceEventInput, capturedAt?: number): void => {
    if (performanceTrace === undefined) return
    const at = capturedAt ?? (performanceTrace.clock ?? (() => performance.now()))()
    if (!Number.isFinite(at) || at < 0) return
    try {
      performanceTrace.record(
        Object.freeze({
          ...event,
          documentId: performanceTrace.documentId,
          at
        }) as CoreAuthorityPerformanceEvent
      )
    } catch {
      // Measurement is diagnostic-only and cannot perturb authority.
    }
  }

  const installBindings = (nextBindings: readonly MuyaPlainTextSourceBinding[]): void => {
    const nextAdapters = new Map<
      string,
      ReturnType<typeof createMuyaPlainTextSourceEditAdapter> | undefined
    >()
    for (const item of nextBindings) {
      if (item.editable === false) continue
      const key = JSON.stringify(item.path)
      if (nextAdapters.has(key)) {
        throw new Error('Core Muya projection contains duplicate bindings')
      }
      try {
        assertMuyaDocumentSourceBinding(item)
        nextAdapters.set(key, undefined)
      } catch (error) {
        const range = item.sourceRange
        throw new RangeError(
          'Core Muya projection binding is invalid ' +
            `(block=${String(item.path[0])}, field=${String(item.path[1])}, ` +
            `start=${String(range.start)}, end=${String(range.end)}, ` +
            `textUnits=${String(item.text.length)}): ` +
            `${error instanceof Error ? error.message : 'invalid binding'}`
        )
      }
    }
    adapters.clear()
    bindingByPath.clear()
    for (const item of nextBindings) bindingByPath.set(JSON.stringify(item.path), item)
    for (const [key, adapter] of nextAdapters) adapters.set(key, adapter)
    currentBindings = Object.freeze(nextBindings.filter((item) => item.editable !== false))
    selectionBindings = Object.freeze([...nextBindings])
  }
  installBindings(bindings)

  const adapterForPath = (
    key: string | undefined
  ): ReturnType<typeof createMuyaPlainTextSourceEditAdapter> | undefined => {
    if (key === undefined || !adapters.has(key)) return undefined
    let adapter = adapters.get(key)
    if (adapter === undefined) {
      const binding = bindingByPath.get(key)
      if (binding === undefined || binding.emptyLiteralLineEnding !== undefined) return undefined
      adapter = createMuyaPlainTextSourceEditAdapter(binding, true)
      adapters.set(key, adapter)
    }
    return adapter
  }

  const installAppliedEdit = (edit: DocumentSourceEdit): void => {
    installBindings(selectionBindings.map((item) => advanceMuyaSourceBinding(item, edit)))
  }

  const decodeNativeEdit = (change: unknown): DocumentSourceEdit | undefined => {
    const key = pathOf(change)
    const sourceAdapter = adapterForPath(key)
    const result = sourceAdapter?.accept(change)
    if (result?.kind === 'edit') return result.edit
    return (
      sourceEditForMuyaStructuralEnter(currentBindings, change)?.edit ??
      sourceEditForMuyaTwoParagraphPaste(currentBindings, change) ??
      sourceEditForMuyaStructuralChange(
        currentBindings,
        change,
        MAXIMUM_PENDING_INSERT_UNITS - pendingInsertUnits
      )
    )
  }

  const sourceRangeForSelection = (
    selection: MuyaPlainTextAuthorSelection,
    allowCollapsed = false,
    sourceBindings = selectionBindings
  ): Readonly<{ readonly start: number; readonly end: number }> | undefined => {
    const samePath = (
      left: readonly (string | number)[],
      right: readonly (string | number)[]
    ): boolean => left.length === right.length && left.every((part, index) => part === right[index])
    const anchorBinding = sourceBindings.find((item) => samePath(item.path, selection.anchor.path))
    const focusBinding = sourceBindings.find((item) => samePath(item.path, selection.focus.path))
    if (
      anchorBinding === undefined ||
      focusBinding === undefined ||
      !Number.isSafeInteger(selection.anchor.offset) ||
      !Number.isSafeInteger(selection.focus.offset) ||
      selection.anchor.offset < 0 ||
      selection.focus.offset < 0 ||
      selection.anchor.offset > anchorBinding.text.length ||
      selection.focus.offset > focusBinding.text.length
    ) {
      return undefined
    }
    const forward =
      sourceBindings.indexOf(anchorBinding) < sourceBindings.indexOf(focusBinding) ||
      (anchorBinding === focusBinding && selection.anchor.offset <= selection.focus.offset)
    const anchorRange = mappedMuyaSourceRange(
      anchorBinding,
      {
        start: selection.anchor.offset,
        end: selection.anchor.offset
      },
      selection.anchor.offset === selection.focus.offset && anchorBinding === focusBinding
        ? 'previous'
        : forward
          ? 'next'
          : 'previous'
    )
    const focusRange = mappedMuyaSourceRange(
      focusBinding,
      {
        start: selection.focus.offset,
        end: selection.focus.offset
      },
      forward ? 'previous' : 'next'
    )
    if (anchorRange === undefined || focusRange === undefined) return undefined
    const anchor = anchorRange.start
    const focus = focusRange.start
    let start = Math.min(anchor, focus)
    const end = Math.max(anchor, focus)
    const first = sourceBindings[0]
    const last = sourceBindings[sourceBindings.length - 1]
    const beginPoint = forward ? selection.anchor : selection.focus
    const endPoint = forward ? selection.focus : selection.anchor
    if (
      allowCollapsed &&
      start !== end &&
      first !== undefined &&
      last !== undefined &&
      samePath(beginPoint.path, first.path) &&
      beginPoint.offset === 0 &&
      samePath(endPoint.path, last.path) &&
      endPoint.offset === last.text.length
    ) {
      // Selecting the whole displayed document also selects its block prefixes.
      // The Core Markup operation retains hidden comments and the final EOL.
      start = 0
    }
    if (start === end && !allowCollapsed) return undefined
    return Object.freeze({
      start,
      end
    })
  }

  const resolveWaiters = (): void => {
    if (!adapter.isSettled()) return
    for (const waiter of waiters) waiter.resolve()
    waiters.clear()
  }
  const captureDraft = (): MuyaRecoveryDraft | undefined => {
    if (
      latestNativeChange === undefined &&
      compositionChange === undefined &&
      preparations.size === 0
    ) { return undefined }
    for (const preparation of preparations) refreshPreparation(preparation)
    const submitted = active ?? latestSubmitted
    return structuredClone({
      revision,
      nativeChange: latestNativeChange,
      commands: [...(submitted === undefined ? [] : [submitted]), ...queued].map((command) =>
        Object.fromEntries(
          Object.entries(command ?? {}).filter(([, value]) => typeof value !== 'function')
        )
      ),
      composition: compositionChange,
      clipboardPreparations: [...preparations].map(
        ({ finish: _finish, ...preparation }) => preparation
      )
    })
  }
  const fault = (message: string | Error): void => {
    if (terminalError !== undefined) return
    failedDraft = captureDraft()
    for (const preparation of preparations) {
      preparation.finish()
      releasePreparation(preparation)
    }
    terminalError = message instanceof Error ? message : new Error(message)
    for (const command of queued.splice(0)) {
      if (command.kind !== 'edit') command.reject(terminalError)
    }
    pendingInsertUnits = 0
    compositionBarrier?.reject(terminalError)
    for (const waiter of waiters) waiter.reject(terminalError)
    waiters.clear()
  }
  const pump = (): void => {
    if (active !== undefined || disposed || terminalError !== undefined) return
    const command = queued.shift()
    if (command === undefined) {
      resolveWaiters()
      return
    }
    if (command.kind === 'edit' || command.kind === 'track') {
      pendingInsertUnits -=
        command.kind === 'track' && command.input !== undefined
          ? ('data' in command.input ? (command.input.data ?? '') : '').length
          : command.edit!.insert.length
    }
    if (command.kind === 'apply-prepared' && command.operation.kind === 'clipboard') { pendingInsertUnits -= command.operation.action.markdown.length }
    if (command.kind === 'clipboard') { pendingInsertUnits -= 'markdown' in command.action ? command.action.markdown.length : 0 }
    if (command.kind === 'author' || command.kind === 'edit-comment') {
      pendingInsertUnits -= command.text.length
    }
    active = command
    latestSubmitted = command
    const deferredTrackEdit =
      command.kind === 'track' && command.deferredChange !== undefined
        ? decodeNativeEdit(command.deferredChange)
        : undefined
    if (
      command.kind === 'track' &&
      command.deferredChange !== undefined &&
      deferredTrackEdit === undefined
    ) {
      active = undefined
      const failure = new Error(
        'Core Muya pending Track operation no longer matches its projection'
      )
      command.reject(failure)
      fault(failure)
      return
    }
    const authorRange =
      command.kind === 'author' ? sourceRangeForSelection(command.selection) : undefined
    if (command.kind === 'author' && authorRange === undefined) {
      active = undefined
      command.resolve(undefined)
      pump()
      return
    }
    const historyBeforeSubmission = pendingHistory
    let submittedEdit =
      (command.kind === 'track' && command.input === undefined) || command.kind === 'edit'
        ? (deferredTrackEdit ?? command.edit)
        : undefined
    let inputAction: DocumentInputAction | undefined
    if (command.kind === 'track' && command.input !== undefined) {
      const { historyGroup: _historyGroup, ...action } = command.input
      inputAction = structuredClone(action)
    }
    const authoredEdit = submittedEdit
    let submittedEdits = submittedEdit === undefined ? undefined : muyaSourceEdits(submittedEdit)
    try {
      if (
        pendingHistory !== undefined &&
        submittedEdit !== undefined &&
        !(command.kind === 'track' && command.input !== undefined)
      ) {
        const transformed = transformOptimisticHistory({
          baseSourceLength: pendingHistory.baseSourceLength,
          appliedEdits: pendingHistory.edits,
          queuedTransactions: [submittedEdits!]
        })
        if (transformed.kind === 'conflict') {
          const failure = new Error('Core history overlaps pending editor input')
          if (command.kind !== 'edit') command.reject(failure)
          fault(failure)
          active = undefined
          return
        }
        pendingHistory = {
          baseSourceLength:
            pendingHistory.baseSourceLength +
            submittedEdit.insert.length -
            (submittedEdit.end - submittedEdit.start),
          edits: transformed.reconciliationEdits
        }
        submittedEdits = transformed.rebasedTransactions[0]!
        submittedEdit = submittedEdits[0]!
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('Core history transform failed')
      if (command.kind !== 'edit') command.reject(failure)
      fault(failure)
      active = undefined
      return
    }
    let acknowledged
    let transactionId = 0
    try {
      const dispatchedAt =
        performanceTrace === undefined
          ? undefined
          : (performanceTrace.clock ?? (() => performance.now()))()
      const submission = binding.submit(
        command.kind === 'apply-prepared'
          ? Object.freeze({
            kind: 'apply-prepared' as const,
            target: command.target,
            operation: command.operation,
            projections: Object.freeze([])
          })
          : command.kind === 'clipboard'
            ? Object.freeze({
              kind: 'clipboard' as const,
              action: command.action,
              projections: Object.freeze([])
            })
            : command.kind === 'format'
              ? Object.freeze({
                kind: 'format' as const,
                action: command.action,
                projections: Object.freeze([])
              })
              : command.kind === 'track' && command.input !== undefined
                ? Object.freeze({
                  kind: 'input' as const,
                  action: inputAction!,
                  tracked: !command.markup,
                  ...(command.nativeHistoryGroup === undefined
                    ? {}
                    : { nativeHistoryGroup: command.nativeHistoryGroup }),
                  projections: regionalMarkup
                    ? Object.freeze(['markup'] as const)
                    : Object.freeze([])
                })
                : command.kind === 'edit'
                  ? Object.freeze({
                    edits: Object.freeze(submittedEdits!),
                    ...(command.nativeHistoryGroup === undefined
                      ? {}
                      : { nativeHistoryGroup: command.nativeHistoryGroup }),
                    projections: regionalMarkup
                      ? Object.freeze(['markup'] as const)
                      : Object.freeze([])
                  })
                  : command.kind === 'track'
                    ? command.markup
                      ? Object.freeze({
                        kind: 'markup-edits' as const,
                        ...(command.nativeHistoryGroup === undefined
                          ? {}
                          : { nativeHistoryGroup: command.nativeHistoryGroup }),
                        edits: Object.freeze(submittedEdits!),
                        projections: regionalMarkup
                          ? Object.freeze(['markup'] as const)
                          : Object.freeze([])
                      })
                      : submittedEdits!.length > 1
                        ? Object.freeze({
                          kind: 'track-edits' as const,
                          ...(command.nativeHistoryGroup === undefined
                            ? {}
                            : { nativeHistoryGroup: command.nativeHistoryGroup }),
                          edits: Object.freeze(submittedEdits!),
                          projections: regionalMarkup
                            ? Object.freeze(['markup'] as const)
                            : Object.freeze([])
                        })
                        : Object.freeze({
                          kind: 'track' as const,
                          ...(command.nativeHistoryGroup === undefined
                            ? {}
                            : { nativeHistoryGroup: command.nativeHistoryGroup }),
                          range: Object.freeze({
                            start: submittedEdit!.start,
                            end: submittedEdit!.end
                          }),
                          text: submittedEdit!.insert,
                          projections: regionalMarkup
                            ? Object.freeze(['markup'] as const)
                            : Object.freeze([])
                        })
                    : command.kind === 'history'
                      ? command.command === 'configure'
                        ? Object.freeze({
                          kind: 'configure' as const,
                          options: command.options!,
                          projections: Object.freeze([])
                        })
                        : Object.freeze({ kind: command.command, projections: Object.freeze([]) })
                      : command.kind === 'resolve'
                        ? Object.freeze({
                          kind: 'resolve' as const,
                          authoredRevision: command.authoredRevision,
                          annotation: command.annotation,
                          decision: command.decision,
                          projections: Object.freeze([])
                        })
                        : command.kind === 'resolve-all'
                          ? Object.freeze({
                            kind: 'resolve-all' as const,
                            decision: command.decision,
                            projections: Object.freeze([])
                          })
                          : command.kind === 'edit-comment'
                            ? Object.freeze({
                              kind: 'edit-comment' as const,
                              authoredRevision: command.authoredRevision,
                              annotation: command.annotation,
                              text: command.text,
                              projections: Object.freeze([])
                            })
                            : Object.freeze({
                              kind: 'author' as const,
                              form: command.form,
                              range: authorRange!,
                              text: command.text,
                              projections: Object.freeze([])
                            })
      )
      acknowledged = submission.acknowledged
      transactionId = submission.identity.transactionId
      recordPerformance(
        {
          phase: 'dispatch',
          transaction: submission.identity.transactionId,
          pendingDepth: queued.length + 1,
          ...(authoredEdit !== undefined
            ? {
              insertedUnits: authoredEdit!.insert.length,
              deletedUnits: authoredEdit!.end - authoredEdit!.start
            }
            : command.kind === 'track' && command.input !== undefined
              ? {
                insertedUnits: 'data' in command.input ? (command.input.data?.length ?? 0) : 0,
                ...selectionMeasurement(command.input.selection)
              }
              : command.kind === 'clipboard'
                ? {
                  insertedUnits:
                      'markdown' in command.action ? command.action.markdown.length : 0,
                  ...(command.action.kind === 'table'
                    ? {}
                    : selectionMeasurement(command.action.selection))
                }
                : command.kind === 'apply-prepared' && command.operation.kind === 'clipboard'
                  ? { insertedUnits: command.operation.action.markdown.length }
                  : {})
        },
        dispatchedAt
      )
    } catch (error) {
      active = undefined
      const failure = error instanceof Error ? error : new Error('Core submission failed')
      if (command.kind !== 'edit') command.reject(failure)
      fault(failure)
      return
    }
    try {
      const outcome = acknowledged
      recordPerformance({
        phase: 'ack',
        transaction: transactionId
      })
      if (disposed) {
        if (command.kind !== 'edit') {
          command.reject(new Error('Core Muya adapter is disposed'))
        }
        return
      }
      if (outcome.type !== 'applied') {
        if (outcome.type === 'rejected' && outcome.reason === 'no-change') {
          active = undefined
          if (command.kind !== 'edit' && command.kind !== 'track') {
            command.resolve(undefined)
          }
          pump()
          return
        }
        if (
          command.kind === 'history' &&
          outcome.type === 'rejected' &&
          outcome.reason === 'history-empty'
        ) {
          active = undefined
          command.resolve(undefined)
          pump()
          return
        }
        if (
          command.kind === 'resolve' &&
          outcome.type === 'rejected' &&
          (outcome.reason === 'stale-base' ||
            outcome.reason === 'annotation-not-found' ||
            outcome.reason === 'resolution-invalid')
        ) {
          active = undefined
          command.resolve(undefined)
          pump()
          return
        }
        if (
          command.kind === 'edit-comment' &&
          outcome.type === 'rejected' &&
          (outcome.reason === 'stale-base' ||
            outcome.reason === 'annotation-not-found' ||
            outcome.reason === 'author-invalid')
        ) {
          active = undefined
          command.resolve(undefined)
          pump()
          return
        }
        if (
          outcome.type === 'rejected' &&
          outcome.reason === 'history-resource' &&
          command.kind !== 'edit' &&
          command.kind !== 'track' &&
          command.kind !== 'clipboard' &&
          command.kind !== 'apply-prepared'
        ) {
          active = undefined
          command.resolve(undefined)
          pump()
          return
        }
        if (
          (command.kind === 'author' || command.kind === 'format') &&
          outcome.type === 'rejected' &&
          outcome.reason === 'author-invalid'
        ) {
          active = undefined
          command.resolve(undefined)
          pump()
          return
        }
        const failure = new Error(
          outcome.type === 'rejected' && outcome.reason === 'prepared-selection-conflict'
            ? 'Prepared resource overlaps newer input'
            : `Core Muya transaction was ${outcome.type}`
        )
        if (command.kind !== 'edit') command.reject(failure)
        active = undefined
        fault(failure)
        return
      }
      revision = outcome.revision
      // Admission belongs to this exact model command. A subsequent view
      // failure must never make its caller replay already accepted input.
      if (
        command.kind === 'apply-prepared' ||
        command.kind === 'clipboard' ||
        command.kind === 'format' ||
        (command.kind === 'track' && command.input !== undefined)
      ) { command.resolve(outcome) }
      reconciledNativePositionReady = false
      if (
        command.kind === 'track' &&
        command.input !== undefined &&
        outcome.inputResult?.selection === undefined
      ) {
        active = undefined
        fault('Core input compilation has no proven resulting selection')
        return
      }
      if (
        command.kind === 'track' &&
        command.input === undefined &&
        command.nativeTextOnly &&
        !command.markup &&
        pendingHistory === undefined &&
        outcome.nativeReconciliation !== undefined &&
        (nativeBindingsPending || outcome.nativeReconciliation.length > 0)
      ) {
        installBindings(
          reconcileMuyaNativeBindings(
            selectionBindings.map((item) => advanceMuyaSourceBinding(item, submittedEdit!)),
            outcome.nativeReconciliation
          )
        )
        nativeBindingsPending = true
        reconciledNativePositionReady = true
      }
      if (
        historyBeforeSubmission !== undefined &&
        command.kind === 'track' &&
        command.input === undefined
      ) {
        pendingHistory = {
          baseSourceLength:
            historyBeforeSubmission.baseSourceLength +
            authoredEdit!.insert.length -
            (authoredEdit!.end - authoredEdit!.start),
          edits: reconcileOptimisticTransaction({
            baseSourceLength: historyBeforeSubmission.baseSourceLength,
            precedingEdits: historyBeforeSubmission.edits,
            optimisticEdits: muyaSourceEdits(authoredEdit!),
            appliedEdits: outcome.change.appliedEdits
          })
        }
      }
      if (command.kind === 'history') {
        const delta = outcome.change.appliedEdits.reduce(
          (sum, edit) => sum + edit.insert.length - (edit.end - edit.start),
          0
        )
        pendingHistory =
          historyBeforeSubmission === undefined
            ? {
              baseSourceLength: outcome.sourceLength - delta,
              edits: outcome.change.appliedEdits
            }
            : {
              baseSourceLength: historyBeforeSubmission.baseSourceLength,
              edits: reconcileOptimisticTransaction({
                baseSourceLength: historyBeforeSubmission.baseSourceLength,
                precedingEdits: historyBeforeSubmission.edits,
                optimisticEdits: [],
                appliedEdits: outcome.change.appliedEdits
              })
            }
      }
      if (command.kind === 'edit' && reconcileOrdinaryEdit !== undefined) {
        try {
          const nextBindings = reconcileOrdinaryEdit(outcome)
          if (disposed) throw new Error('Core Muya adapter is disposed')
          // Ordinary queued edits are already mapped against the speculative
          // revision. Keep that map until the last acknowledgement catches up.
          if (
            queued.every(
              (pending) =>
                pending.kind !== 'edit' &&
                (pendingHistory === undefined || pending.kind !== 'track')
            )
          ) {
            installBindings(nextBindings)
            pendingHistory = undefined
          }
        } catch (error) {
          active = undefined
          fault(error instanceof Error ? error : new Error('Core Muya reconciliation failed'))
          return
        }
      }
      if (command.kind !== 'edit') {
        try {
          const nextBindings = command.reconcile(outcome)
          if (
            nativeBindingsPending &&
            command.kind === 'track' &&
            !command.nativeTextOnly &&
            command.deferredChange !== undefined
          ) {
            const reconciled = reconcileMuyaNativeStructureBindings(
              selectionBindings,
              nextBindings,
              command.deferredChange,
              outcome.change.appliedEdits
            )
            installBindings(reconciled)
            nativeBindingsPending = reconciled.some((item, index) => item !== nextBindings[index])
          }
          if (disposed) throw new Error('Core Muya adapter is disposed')
          if (
            (pendingHistory === undefined ||
              queued.every((pending) => pending.kind !== 'edit' && pending.kind !== 'track')) &&
            (!nativeBindingsPending ||
              (!composing &&
                queued.every((pending) => pending.kind !== 'edit' && pending.kind !== 'track')))
          ) {
            installBindings(nextBindings)
            pendingHistory = undefined
            nativeBindingsPending = false
            reconciledNativePositionReady = false
          }
          if (
            command.kind !== 'clipboard' &&
            command.kind !== 'format' &&
            (command.kind !== 'track' || command.input === undefined)
          ) { command.resolve(outcome) }
        } catch (error) {
          const failure =
            error instanceof Error
              ? error
              : new Error('Core Muya authoritative reconciliation failed')
          command.reject(failure)
          active = undefined
          fault(failure)
          return
        }
      }
      recordPerformance({
        phase: 'reconcile',
        transaction: transactionId,
        corrected: command.kind !== 'edit'
      })
      active = undefined
      latestSubmitted = undefined
      pump()
    } catch (error) {
      if (disposed) return
      const failure = error instanceof Error ? error : new Error('Core submission failed')
      if (command.kind !== 'edit') command.reject(failure)
      fault(failure)
      active = undefined
    }
  }
  const enqueue = (
    edit: DocumentSourceEdit,
    remapFollowingNative = false,
    nativeHistoryGroup?: string
  ): boolean => {
    if (
      queued.length + (active === undefined ? 0 : 1) >= MAXIMUM_PENDING_TRANSACTIONS ||
      pendingInsertUnits + edit.insert.length > MAXIMUM_PENDING_INSERT_UNITS
    ) {
      fault('Core Muya pending work exceeds its resource policy')
      return false
    }
    queued.push(
      Object.freeze({
        kind: 'edit',
        edit,
        ...(nativeHistoryGroup === undefined ? {} : { nativeHistoryGroup }),
        ...(remapFollowingNative ? { remapFollowingNative: true as const } : {})
      })
    )
    pendingInsertUnits += edit.insert.length
    pump()
    return true
  }
  const acceptEdit = (
    edit: DocumentSourceEdit,
    retainPlainBindings = true,
    nativeHistoryGroup?: string
  ): boolean => {
    if (retainPlainBindings) installAppliedEdit(edit)
    else installBindings(Object.freeze([]))
    return enqueue(edit, !retainPlainBindings, nativeHistoryGroup)
  }

  const enqueueTracked = (
    edit: DocumentSourceEdit,
    reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[],
    deferredChange?: unknown,
    markup = false,
    nativeHistoryGroup?: string,
    nativeTextOnly = false
  ): boolean => {
    if (
      queued.length + (active === undefined ? 0 : 1) >= MAXIMUM_PENDING_TRANSACTIONS ||
      pendingInsertUnits + edit.insert.length > MAXIMUM_PENDING_INSERT_UNITS
    ) {
      return false
    }
    queued.push(
      Object.freeze({
        kind: 'track',
        nativeTextOnly,
        ...(nativeHistoryGroup === undefined ? {} : { nativeHistoryGroup }),
        markup,
        edit,
        ...(deferredChange === undefined ? {} : { deferredChange }),
        reconcile,
        resolve: () => {},
        reject: () => {}
      })
    )
    pendingInsertUnits += edit.insert.length
    pump()
    return true
  }

  const enqueueHistory = (
    command: 'undo' | 'redo' | 'configure',
    reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[],
    options?: Readonly<Partial<MarkdownOptions>>
  ): Promise<CoreAppliedReply | undefined> => {
    if (disposed) return Promise.reject(new Error('Core Muya adapter is disposed'))
    if (terminalError !== undefined) return Promise.reject(terminalError)
    if (composing) {
      return Promise.reject(new Error('Core Muya history cannot run during composition'))
    }
    if (queued.length + (active === undefined ? 0 : 1) >= MAXIMUM_PENDING_TRANSACTIONS) {
      const failure = new Error('Core Muya pending work exceeds its resource policy')
      fault(failure)
      return Promise.reject(failure)
    }
    return new Promise<CoreAppliedReply | undefined>((resolve, reject) => {
      queued.push(
        Object.freeze({
          kind: 'history',
          command,
          options,
          reconcile,
          resolve,
          reject
        })
      )
      pump()
    })
  }

  const applyPrepared = (
    target: string,
    operation: CorePreparedOperation,
    reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
  ): Readonly<{ accepted: boolean; changed: boolean }> => {
    latestNativeChange = { target, operation }
    if (disposed || terminalError !== undefined || composing) { return Object.freeze({ accepted: false, changed: false }) }
    const insertUnits = operation.kind === 'clipboard' ? operation.action.markdown.length : 0
    if (
      queued.length + (active === undefined ? 0 : 1) >= MAXIMUM_PENDING_TRANSACTIONS ||
      pendingInsertUnits + insertUnits > MAXIMUM_PENDING_INSERT_UNITS
    ) {
      fault('Core Muya pending work exceeds its resource policy')
      return Object.freeze({ accepted: false, changed: false })
    }
    const previousRevision = revision
    let accepted = false
    let changed = false
    queued.push(
      Object.freeze({
        kind: 'apply-prepared',
        target,
        operation: structuredClone(operation),
        reconcile,
        resolve: (outcome) => {
          accepted = outcome !== undefined
          changed = outcome !== undefined && outcome.revision !== previousRevision
        },
        reject: () => {}
      })
    )
    pendingInsertUnits += insertUnits
    pump()
    return Object.freeze({ accepted, changed })
  }

  const prepareResource = <
    T,
    A extends { selection: DocumentClipboardSelection; tracked: boolean },
    C extends DocumentClipboardSelection
  >(
    action: A,
    payload: unknown,
    apply: (
      target: string,
      value: T,
      currentSelection?: C
    ) => Readonly<{ accepted: boolean; changed: boolean }>
  ): MuyaResourcePreparation & {
    complete(
      value: T,
      currentSelection?: () => C
    ): Promise<Readonly<{ accepted: boolean; changed: boolean }>>
  } => {
    if (disposed) throw new Error('Core Muya adapter is disposed')
    if (terminalError !== undefined) throw terminalError
    if (preparations.size >= MAXIMUM_PENDING_TRANSACTIONS) { throw new Error('Core resource preparation exceeds its resource policy') }
    const captured = structuredClone(action)
    const capturedPayload = structuredClone(payload)
    const retained = binding.retainSelection(captured.selection)
    if (retained.type !== 'retained-selection') { throw new Error(`Core resource target was ${retained.reason}`) }
    let finish!: () => void
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const preparation = {
      ...captured,
      submitting: false,
      target: retained.id,
      selection: structuredClone(retained.selection),
      selectionRevision: retained.selectionRevision,
      finish,
      payload: capturedPayload,
      completion: undefined as unknown
    }
    preparations.add(preparation)
    let completed = false
    return Object.freeze({
      finished,
      modelSelection() {
        refreshPreparation(preparation)
        return structuredClone(preparation.selection)
      },
      capturePayload(payload: unknown) {
        preparation.payload = structuredClone(payload)
        if (terminalError !== undefined) failedDraft = captureDraft()
      },
      cancel() {
        if (completed) return
        completed = true
        preparation.finish()
        releasePreparation(preparation)
        preparations.delete(preparation)
        resolveWaiters()
      },
      async complete(value: T, currentSelection?: () => C) {
        if (completed) throw new Error('Resource preparation already completed')
        completed = true
        const completion = structuredClone(value)
        preparation.completion = completion
        try {
          for (;;) {
            const pendingComposition = compositionBarrier
            if (!composing || pendingComposition === undefined) break
            await pendingComposition.promise
          }
          if (disposed || terminalError !== undefined) {
            fault('Prepared resource owner is unavailable')
            failedDraft = captureDraft()
            return Object.freeze({ accepted: false, changed: false })
          }
          refreshPreparation(preparation)
          const selection = currentSelection?.()
          preparation.completion = { value: completion, currentSelection: selection }
          // Keep the payload discoverable if presentation fails after admission.
          // The captured model position is recovery provenance, never a retry.
          preparation.submitting = true
          const result = apply(preparation.target, completion, selection)
          if (result.accepted && terminalError === undefined) preparations.delete(preparation)
          else failedDraft = captureDraft()
          return result
        } catch (error) {
          fault(error instanceof Error ? error : new Error(String(error)))
          throw error
        } finally {
          preparation.finish()
          releasePreparation(preparation)
          resolveWaiters()
        }
      },
      fail(error: Error) {
        if (completed) return
        completed = true
        preparation.finish()
        fault(error)
      }
    })
  }

  const adapter: MuyaPlainTextCoreAdapter = Object.freeze({
    input(
      operation: MuyaModelInput,
      reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[],
      tracked = false
    ): Readonly<{ accepted: boolean; changed: boolean }> {
      latestNativeChange = operation
      if (disposed || terminalError !== undefined || composing) { return Object.freeze({ accepted: false, changed: false }) }
      if (
        queued.length + (active === undefined ? 0 : 1) >= MAXIMUM_PENDING_TRANSACTIONS ||
        pendingInsertUnits + ('data' in operation ? (operation.data ?? '') : '').length >
          MAXIMUM_PENDING_INSERT_UNITS
      ) {
        fault('Core Muya pending work exceeds its resource policy')
        return Object.freeze({ accepted: false, changed: false })
      }
      const previousRevision = revision
      let accepted = false
      let changed = false
      queued.push(
        Object.freeze({
          kind: 'track',
          input: structuredClone(operation),
          ...(operation.historyGroup === undefined
            ? {}
            : { nativeHistoryGroup: `${directHistoryScope}:${operation.historyGroup}` }),
          nativeTextOnly: false,
          markup: !tracked,
          reconcile,
          resolve: (outcome) => {
            accepted = true
            changed = outcome.revision !== previousRevision
          },
          reject: () => {}
        })
      )
      pendingInsertUnits += ('data' in operation ? (operation.data ?? '') : '').length
      pump()
      return Object.freeze({ accepted, changed })
    },
    prepareClipboard(
      action: MuyaClipboardCapture,
      payload: unknown,
      reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    ): MuyaClipboardPreparation {
      const captured = structuredClone(action)
      const prepared = prepareResource(
        { ...captured, kind: 'kind' in captured ? captured.kind : 'paste' },
        payload,
        (
          target,
          value: Omit<DocumentClipboardContent, 'currentSelection'>,
          currentSelection?: DocumentSelection
        ) =>
          applyPrepared(
            target,
            {
              kind: 'clipboard',
              action: {
                ...('kind' in captured && captured.kind === 'table'
                  ? { kind: 'table' as const, operation: 'paste' as const }
                  : { kind: 'paste' as const }),
                tracked: captured.tracked,
                ...value,
                ...(currentSelection === undefined ? {} : { currentSelection })
              }
            },
            reconcile
          )
      )
      return Object.freeze({
        ...prepared,
        complete: (
          markdown: string,
          imported?: {
            plainText?: string
            bareUrl?: string
            pasteAsPlainText?: boolean
            currentSelection?: () => DocumentSelection
          }
        ) => {
          const { currentSelection, ...content } = imported ?? {}
          return prepared.complete({ markdown, ...content }, currentSelection)
        }
      })
    },
    prepareImage(
      action: ImagePropertiesAction,
      payload: unknown,
      reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    ): MuyaImagePreparation {
      const { selection, ...captured } = structuredClone(action)
      const prepared = prepareResource(
        { selection, ...captured },
        payload,
        (
          target,
          value: { properties: ImagePropertiesAction['properties'] },
          currentSelection?: DocumentInputSelection
        ) =>
          applyPrepared(
            target,
            {
              kind: 'format',
              action: {
                ...captured,
                ...value,
                ...(currentSelection === undefined ? {} : { currentSelection })
              }
            },
            reconcile
          )
      )
      return Object.freeze({
        ...prepared,
        complete: (
          properties: ImagePropertiesAction['properties'],
          currentSelection?: () => DocumentInputSelection
        ) => prepared.complete({ properties }, currentSelection)
      })
    },

    clipboard(
      action: DocumentClipboardAction,
      reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    ): Readonly<{ accepted: boolean; changed: boolean }> {
      latestNativeChange = action
      if (disposed || terminalError !== undefined || composing) { return Object.freeze({ accepted: false, changed: false }) }
      if (
        queued.length + (active === undefined ? 0 : 1) >= MAXIMUM_PENDING_TRANSACTIONS ||
        pendingInsertUnits + ('markdown' in action ? action.markdown.length : 0) >
          MAXIMUM_PENDING_INSERT_UNITS
      ) {
        fault('Core Muya pending work exceeds its resource policy')
        return Object.freeze({ accepted: false, changed: false })
      }
      const previousRevision = revision
      let accepted = false
      let changed = false
      queued.push(
        Object.freeze({
          kind: 'clipboard',
          action: structuredClone(action),
          reconcile,
          resolve: (outcome) => {
            accepted = outcome !== undefined
            changed = outcome !== undefined && outcome.revision !== previousRevision
          },
          reject: () => {}
        })
      )
      pendingInsertUnits += 'markdown' in action ? action.markdown.length : 0
      pump()
      return Object.freeze({ accepted, changed })
    },
    format(
      action: DocumentFormatAction,
      reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    ): Readonly<{ accepted: boolean; changed: boolean }> {
      latestNativeChange = action
      if (disposed || terminalError !== undefined || composing) { return Object.freeze({ accepted: false, changed: false }) }
      if (queued.length + (active === undefined ? 0 : 1) >= MAXIMUM_PENDING_TRANSACTIONS) {
        fault('Core Muya pending work exceeds its resource policy')
        return Object.freeze({ accepted: false, changed: false })
      }
      const previousRevision = revision
      let accepted = false
      let changed = false
      queued.push(
        Object.freeze({
          kind: 'format',
          action: structuredClone(action),
          reconcile,
          resolve: (outcome) => {
            accepted = outcome !== undefined
            changed = outcome !== undefined && outcome.revision !== previousRevision
          },
          reject: () => {}
        })
      )
      pump()
      return Object.freeze({ accepted, changed })
    },
    reconciledSourcePosition(point: MuyaPlainTextAuthorSelection['focus']): number | undefined {
      if (!reconciledNativePositionReady) return undefined
      const binding = selectionBindings.find(
        (item) => JSON.stringify(item.path) === JSON.stringify(point.path)
      )
      return binding === undefined
        ? undefined
        : mappedMuyaSourceRange(binding, { start: point.offset, end: point.offset }, 'next')?.start
    },
    recoveryDraft(): MuyaRecoveryDraft | undefined {
      return failedDraft ?? captureDraft()
    },
    hasPendingEdits(): boolean {
      return (
        preparations.size > 0 ||
        composing ||
        queued.some(
          (command) =>
            command.kind === 'edit' ||
            command.kind === 'track' ||
            command.kind === 'format' ||
            command.kind === 'clipboard' ||
            command.kind === 'apply-prepared'
        )
      )
    },
    async reconcileApplied(
      outcome: CoreAppliedReply,
      reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    ): Promise<void> {
      if (disposed) throw new Error('Core Muya adapter is disposed')
      if (terminalError !== undefined) throw terminalError
      if (
        composing ||
        active !== undefined ||
        queued.length > 0 ||
        outcome.revision !== revision + 1
      ) {
        throw new Error('Core Muya external reconciliation is stale')
      }
      try {
        const nextBindings = await reconcile(outcome)
        if (disposed) throw new Error('Core Muya adapter is disposed')
        installBindings(nextBindings)
        revision = outcome.revision
      } catch (error) {
        const failure =
          error instanceof Error
            ? error
            : new Error('Core Muya authoritative reconciliation failed')
        fault(failure)
        throw failure
      }
    },
    selectionSourceRange(
      selection: MuyaPlainTextAuthorSelection
    ): Readonly<{ readonly start: number; readonly end: number }> | undefined {
      if (disposed || terminalError !== undefined) return undefined
      return sourceRangeForSelection(selection)
    },
    accept(change: unknown): 'accepted' | 'unsupported' {
      const nativeHistoryGroup =
        change !== null &&
        typeof change === 'object' &&
        typeof (change as { nativeHistoryGroup?: unknown }).nativeHistoryGroup === 'string'
          ? (change as { nativeHistoryGroup: string }).nativeHistoryGroup
          : undefined
      latestNativeChange = change
      if (disposed || terminalError !== undefined) return 'unsupported'
      if (composing) throw new Error('Composition must use its captured model action')
      if (historyIsPending() && !composing) {
        const edit = decodeNativeEdit(change)
        if (edit === undefined) {
          fault('Core Muya pending history input cannot be mapped')
          return 'unsupported'
        }
        const annotated = currentBindings.some(
          (item) =>
            item.annotationContext === true &&
            item.sourceRange.start <= edit.end &&
            item.sourceRange.end >= edit.start
        )
        if (annotated && reconcileOrdinaryEdit !== undefined) {
          installAppliedEdit(edit)
          return enqueueTracked(
            edit,
            reconcileOrdinaryEdit,
            undefined,
            true,
            nativeHistoryGroup,
            nativeMuyaTextEdit(change) !== undefined
          )
            ? 'accepted'
            : 'unsupported'
        }
        return acceptEdit(edit, true, nativeHistoryGroup) ? 'accepted' : 'unsupported'
      }
      const nativePath = pathOf(change)
      const context = nativePath === undefined ? undefined : bindingByPath.get(nativePath)
      // Structural commands replace native paths. Keep following input as native
      // intent until the acknowledged projection supplies the new source map.
      const semanticPending =
        active?.kind === 'track' ||
        (active?.kind === 'edit' && active.remapFollowingNative === true) ||
        queued.some(
          (command) =>
            command.kind === 'track' ||
            (command.kind === 'edit' && command.remapFollowingNative === true)
        )
      if (
        reconcileOrdinaryEdit !== undefined &&
        (semanticPending ||
          (nativePath !== undefined &&
            adapters.has(nativePath) &&
            context?.annotationContext === true))
      ) {
        return this.acceptTracked(change, reconcileOrdinaryEdit, true)
      }
      if (
        (active !== undefined && active.kind !== 'edit') ||
        queued.some((command) => command.kind !== 'edit')
      ) {
        fault('Core Muya input arrived during history reconciliation')
        return 'unsupported'
      }
      const key = pathOf(change)
      const adapter = adapterForPath(key)
      if (adapter === undefined) {
        const paragraphPaste = sourceEditForMuyaTwoParagraphPaste(currentBindings, change)
        if (
          paragraphPaste !== undefined &&
          currentBindings.some(
            (item) =>
              item.annotationContext === true &&
              item.sourceRange.start <= paragraphPaste.end &&
              item.sourceRange.end >= paragraphPaste.start
          )
        ) {
          return reconcileOrdinaryEdit === undefined
            ? 'unsupported'
            : this.acceptTracked(change, reconcileOrdinaryEdit, true)
        }
        const entered = sourceEditForMuyaStructuralEnter(currentBindings, change)
        if (entered !== undefined) {
          installBindings(entered.bindings)
          return enqueue(entered.edit, false, nativeHistoryGroup) ? 'accepted' : 'unsupported'
        }
        const structuralEdit =
          paragraphPaste ??
          sourceEditForMuyaStructuralChange(
            currentBindings,
            change,
            MAXIMUM_PENDING_INSERT_UNITS - pendingInsertUnits
          )
        if (structuralEdit !== undefined) {
          const operation =
            change !== null && typeof change === 'object'
              ? (change as { op?: unknown }).op
              : undefined
          if (
            Array.isArray(operation) &&
            operation.length === 2 &&
            typeof operation[0] === 'number' &&
            structuralEdit.insert === '\n\n'
          ) {
            const index = operation[0]
            const next = currentBindings.map((item) => {
              const block = item.path[0]
              return typeof block === 'number' && block >= index
                ? {
                  ...advanceMuyaSourceBinding(item, structuralEdit),
                  path: [block + 1, ...item.path.slice(1)]
                }
                : item
            })
            next.splice(index, 0, {
              path: [index, 'text'],
              text: '',
              sourceRange: { start: structuralEdit.start + 2, end: structuralEdit.start + 2 }
            })
            installBindings(next)
            return enqueue(structuralEdit, false, nativeHistoryGroup) ? 'accepted' : 'unsupported'
          }
          return acceptEdit(structuralEdit, false, nativeHistoryGroup) ? 'accepted' : 'unsupported'
        }
        fault('Core Muya operation-shape is unsupported')
        return 'unsupported'
      }
      const result = adapter.accept(change)
      if (result.kind !== 'edit') {
        fault(`Core Muya ${result.reason} is unsupported`)
        return 'unsupported'
      }
      return acceptEdit(result.edit, true, nativeHistoryGroup) ? 'accepted' : 'unsupported'
    },
    acceptTracked(
      change: unknown,
      reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[],
      markup = false
    ): 'accepted' | 'unsupported' {
      const nativeHistoryGroup =
        change !== null &&
        typeof change === 'object' &&
        typeof (change as { nativeHistoryGroup?: unknown }).nativeHistoryGroup === 'string'
          ? (change as { nativeHistoryGroup: string }).nativeHistoryGroup
          : undefined
      latestNativeChange = change
      if (disposed || terminalError !== undefined) return 'unsupported'
      if (composing) throw new Error('Composition must use its captured model action')
      if (!composing && historyIsPending()) {
        const edit = decodeNativeEdit(change)
        if (edit === undefined) return 'unsupported'
        installAppliedEdit(edit)
        return enqueueTracked(
          edit,
          reconcile,
          undefined,
          markup,
          nativeHistoryGroup,
          nativeMuyaTextEdit(change) !== undefined
        )
          ? 'accepted'
          : 'unsupported'
      }
      if (!composing && (active !== undefined || queued.length > 0)) {
        const local =
          nativeMuyaTextEdit(change) ??
          nativeMuyaStructuralDraft(change, MAXIMUM_PENDING_INSERT_UNITS - pendingInsertUnits)
        if (local !== undefined) {
          return enqueueTracked(
            local,
            reconcile,
            structuredClone(change),
            markup,
            nativeHistoryGroup,
            nativeMuyaTextEdit(change) !== undefined
          )
            ? 'accepted'
            : 'unsupported'
        }
      }
      const edit = decodeNativeEdit(change)
      if (edit === undefined) return 'unsupported'
      if (edit.start === edit.end && edit.insert.length === 0) return 'unsupported'
      const deferUntilPriorReconciliation = active !== undefined || queued.length > 0
      return enqueueTracked(
        edit,
        reconcile,
        deferUntilPriorReconciliation ? structuredClone(change) : undefined,
        markup,
        nativeHistoryGroup,
        nativeMuyaTextEdit(change) !== undefined
      )
        ? 'accepted'
        : 'unsupported'
    },
    compositionStart(operation: MuyaModelInput): void {
      if (disposed) throw new Error('Core Muya adapter is disposed')
      if (terminalError !== undefined) throw terminalError
      if (composing || active !== undefined || queued.length > 0) { throw new Error('Core Muya composition requires its settled starting revision') }
      composing = true
      if ('kind' in operation) throw new Error('Composition requires browser input')
      compositionInput = structuredClone(operation)
      compositionChange = { input: compositionInput, data: null }
      let resolveBarrier: (() => void) | undefined
      let rejectBarrier: ((error: Error) => void) | undefined
      const promise = new Promise<void>((resolve, reject) => {
        resolveBarrier = resolve
        rejectBarrier = reject
      })
      // An unobserved draft fault is still retained until the next save/handoff.
      promise.catch(() => {})
      compositionBarrier = {
        promise,
        resolve: () => resolveBarrier?.(),
        reject: (error) => rejectBarrier?.(error)
      }
    },
    compositionUpdate(data: string): void {
      if (!composing || compositionInput === undefined) { throw new Error('Core Muya composition is not active') }
      compositionChange = { input: compositionInput, data }
      if (data.length > MAXIMUM_PENDING_INSERT_UNITS) { fault('Core Muya composition exceeds its resource policy') }
    },
    compositionEnd(
      result: DocumentCompositionResult,
      reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[],
      tracked = false
    ): Readonly<{ accepted: boolean; changed: boolean }> {
      if (!composing || compositionInput === undefined || compositionBarrier === undefined) { throw new Error('Core Muya composition is not active') }
      const input = compositionInput
      const barrier = compositionBarrier
      composing = false
      if (result.kind === 'unavailable') {
        const failure = new Error(
          'The native composition result is ambiguous; its draft is preserved'
        )
        fault(failure)
        barrier.reject(failure)
        return Object.freeze({ accepted: false, changed: false })
      }
      const outcome = adapter.input(
        {
          ...input,
          inputType: result.kind === 'cancel' ? 'cancelComposition' : 'insertCompositionText',
          data: result.kind === 'commit' ? result.data : null
        },
        reconcile,
        tracked
      )
      if (!outcome.accepted || terminalError !== undefined) {
        const failure = terminalError ?? new Error('Core Muya composition was not admitted')
        fault(failure)
        barrier.reject(failure)
        return outcome
      }
      compositionInput = undefined
      compositionChange = undefined
      compositionBarrier = undefined
      barrier.resolve()
      resolveWaiters()
      return outcome
    },
    history: enqueueHistory,
    async configure(
      options: Readonly<Partial<MarkdownOptions>>,
      reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    ) {
      await adapter.settled()
      return enqueueHistory('configure', reconcile, Object.freeze({ ...options }))
    },
    resolve(
      annotation: CoreReviewItemLocator,
      authoredRevision: number,
      decision: CoreReviewDecision,
      reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    ): Promise<CoreAppliedReply | undefined> {
      if (disposed) return Promise.reject(new Error('Core Muya adapter is disposed'))
      if (terminalError !== undefined) return Promise.reject(terminalError)
      if (composing) {
        return Promise.reject(new Error('Core Muya resolution cannot run during composition'))
      }
      if (queued.length + (active === undefined ? 0 : 1) >= MAXIMUM_PENDING_TRANSACTIONS) {
        const failure = new Error('Core Muya pending work exceeds its resource policy')
        fault(failure)
        return Promise.reject(failure)
      }
      const captured: CoreReviewItemLocator =
        annotation.kind === 'commented-span'
          ? Object.freeze({
            kind: annotation.kind,
            range: Object.freeze({ ...annotation.range }),
            highlightRange: Object.freeze({ ...annotation.highlightRange }),
            commentRange: Object.freeze({ ...annotation.commentRange })
          })
          : Object.freeze({
            kind: annotation.kind,
            range: Object.freeze({ ...annotation.range })
          })
      return new Promise<CoreAppliedReply | undefined>((resolve, reject) => {
        queued.push(
          Object.freeze({
            kind: 'resolve',
            annotation: captured,
            authoredRevision,
            decision,
            reconcile,
            resolve,
            reject
          })
        )
        pump()
      })
    },
    resolveAll(
      decision: 'accept' | 'reject',
      reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    ): Promise<CoreAppliedReply | undefined> {
      if (disposed) return Promise.reject(new Error('Core Muya adapter is disposed'))
      if (terminalError !== undefined) return Promise.reject(terminalError)
      if (composing) {
        return Promise.reject(new Error('Core Muya bulk resolution cannot run during composition'))
      }
      if (queued.length + (active === undefined ? 0 : 1) >= MAXIMUM_PENDING_TRANSACTIONS) {
        const failure = new Error('Core Muya pending work exceeds its resource policy')
        fault(failure)
        return Promise.reject(failure)
      }
      return new Promise<CoreAppliedReply | undefined>((resolve, reject) => {
        queued.push(
          Object.freeze({
            kind: 'resolve-all',
            decision,
            reconcile,
            resolve,
            reject
          })
        )
        pump()
      })
    },
    editComment(
      annotation: CoreReviewItemLocator,
      authoredRevision: number,
      text: string,
      reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    ): Promise<CoreAppliedReply | undefined> {
      if (disposed) return Promise.reject(new Error('Core Muya adapter is disposed'))
      if (terminalError !== undefined) return Promise.reject(terminalError)
      if (composing) {
        return Promise.reject(new Error('Core Muya Comment editing cannot run during composition'))
      }
      if (
        queued.length + (active === undefined ? 0 : 1) >= MAXIMUM_PENDING_TRANSACTIONS ||
        pendingInsertUnits + text.length > MAXIMUM_PENDING_INSERT_UNITS
      ) {
        const failure = new Error('Core Muya pending work exceeds its resource policy')
        fault(failure)
        return Promise.reject(failure)
      }
      const captured: CoreReviewItemLocator =
        annotation.kind === 'commented-span'
          ? Object.freeze({
            kind: annotation.kind,
            range: Object.freeze({ ...annotation.range }),
            highlightRange: Object.freeze({ ...annotation.highlightRange }),
            commentRange: Object.freeze({ ...annotation.commentRange })
          })
          : Object.freeze({
            kind: annotation.kind,
            range: Object.freeze({ ...annotation.range })
          })
      return new Promise<CoreAppliedReply | undefined>((resolve, reject) => {
        queued.push(
          Object.freeze({
            kind: 'edit-comment',
            annotation: captured,
            authoredRevision,
            text,
            reconcile,
            resolve,
            reject
          })
        )
        pendingInsertUnits += text.length
        pump()
      })
    },
    author(
      form: CoreAuthorForm,
      selection: MuyaPlainTextAuthorSelection,
      text: string,
      reconcile: (outcome: CoreAppliedReply) => readonly MuyaPlainTextSourceBinding[]
    ): Promise<CoreAppliedReply | undefined> {
      if (disposed) return Promise.reject(new Error('Core Muya adapter is disposed'))
      if (terminalError !== undefined) return Promise.reject(terminalError)
      if (composing) {
        return Promise.reject(new Error('Core Muya authoring cannot run during composition'))
      }
      if (
        sourceRangeForSelection(selection) === undefined ||
        (form === 'substitution' && text.length === 0)
      ) {
        return Promise.resolve(undefined)
      }
      if (
        queued.length + (active === undefined ? 0 : 1) >= MAXIMUM_PENDING_TRANSACTIONS ||
        pendingInsertUnits + text.length > MAXIMUM_PENDING_INSERT_UNITS
      ) {
        const failure = new Error('Core Muya pending work exceeds its resource policy')
        fault(failure)
        return Promise.reject(failure)
      }
      return new Promise<CoreAppliedReply | undefined>((resolve, reject) => {
        queued.push(
          Object.freeze({
            kind: 'author',
            form,
            selection: Object.freeze({
              anchor: Object.freeze({
                path: Object.freeze([...selection.anchor.path]),
                offset: selection.anchor.offset
              }),
              focus: Object.freeze({
                path: Object.freeze([...selection.focus.path]),
                offset: selection.focus.offset
              })
            }),
            text,
            reconcile,
            resolve,
            reject
          })
        )
        pendingInsertUnits += text.length
        pump()
      })
    },
    isComposing(): boolean {
      return composing
    },
    isSettled(): boolean {
      return (
        terminalError === undefined &&
        !disposed &&
        !composing &&
        active === undefined &&
        queued.length === 0 &&
        preparations.size === 0
      )
    },
    settled(): Promise<void> {
      if (terminalError !== undefined) return Promise.reject(terminalError)
      if (adapter.isSettled()) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        waiters.add({ resolve, reject })
      })
    },
    state(): MuyaPlainTextCoreAdapterState {
      return terminalError === undefined
        ? Object.freeze({ status: 'ready', revision })
        : Object.freeze({ status: 'faulted', message: terminalError.message })
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      if (active !== undefined && active.kind !== 'edit') {
        active.reject(new Error('Core Muya adapter is disposed'))
      }
      fault('Core Muya adapter is disposed')
    }
  })
  return adapter
}
