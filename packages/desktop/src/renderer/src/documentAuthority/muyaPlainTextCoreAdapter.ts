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
  assertMuyaDocumentSourceBinding,
  type MuyaPlainTextSourceBinding
} from './muyaSourceBinding'
import { mappedMuyaSourceRange, type MuyaMarkupBinding, type MuyaMarkupView } from './muyaMarkupView'
import { muyaMarkupViewPatch } from './muyaMarkupChanges'
import {
  muyaViewBindingPrecedes,
  muyaViewBindingsInRoots,
  muyaViewFirstBinding,
  muyaViewItemAtPath,
  muyaViewLastBinding
} from './muyaMarkupViewLookup'

export type { MuyaPlainTextSourceBinding } from './muyaSourceBinding'

/**
 * The bindings a view installs: a whole list, or a Muya Markup view, whose
 * bindings are read one root at a time.
 */
export type MuyaPlainTextBindings = readonly MuyaPlainTextSourceBinding[] | MuyaMarkupView

/** Installed bindings, looked up without listing them. */
interface InstalledBindings {
  at(path: readonly (string | number)[]): MuyaPlainTextSourceBinding | undefined
  /** Whether `left` is listed before `right`; both must be installed. */
  precedes(left: MuyaPlainTextSourceBinding, right: MuyaPlainTextSourceBinding): boolean
  first(): MuyaPlainTextSourceBinding | undefined
  last(): MuyaPlainTextSourceBinding | undefined
}

const samePath = (
  left: readonly (string | number)[],
  right: readonly (string | number)[]
): boolean => left.length === right.length && left.every((part, index) => part === right[index])

const isView = (bindings: MuyaPlainTextBindings): bindings is MuyaMarkupView =>
  !Array.isArray(bindings)

function installedBindingsOf(bindings: MuyaPlainTextBindings): InstalledBindings {
  if (isView(bindings)) {
    return {
      at: (path) => muyaViewItemAtPath(bindings, 'bindings', path),
      precedes: (left, right) =>
        muyaViewBindingPrecedes(bindings, left as MuyaMarkupBinding, right as MuyaMarkupBinding),
      first: () => muyaViewFirstBinding(bindings),
      last: () => muyaViewLastBinding(bindings)
    }
  }
  const list = Object.freeze([...bindings])
  return {
    at: (path) => list.find((item) => samePath(item.path, path)),
    precedes: (left, right) => list.indexOf(left) < list.indexOf(right),
    first: () => list[0],
    last: () => list[list.length - 1]
  }
}

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
/**
 * What review authoring addresses: a Muya selection, or a source range such
 * as a highlight's text when commenting on the highlight itself.
 */
export type MuyaPlainTextAuthorTarget =
  | MuyaPlainTextAuthorSelection
  | Readonly<{ readonly start: number; readonly end: number }>

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
  if (selection.kind === 'table-cell') {
    return { deletedUnits: Math.abs(selection.focus - selection.anchor) }
  }
  const { anchor, focus } = selection
  if (typeof anchor === 'number' && typeof focus === 'number') {
    return { deletedUnits: Math.abs(focus - anchor) }
  }
  if (
    typeof anchor !== 'number' &&
    typeof focus !== 'number' &&
    anchor.text.start === focus.text.start &&
    anchor.text.end === focus.text.end
  ) {
    return { deletedUnits: Math.abs(focus.offset - anchor.offset) }
  }
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
  initialSelectionTarget?: string
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
      currentSelection?: () => DocumentSelection | undefined
    }>
  ): Promise<Readonly<{ accepted: boolean; changed: boolean }>>
  fail(error: Error): void
}

export interface MuyaPlainTextCoreAdapter {
  hasPendingEdits(): boolean
  recoveryDraft(): MuyaRecoveryDraft | undefined
  input(
    operation: MuyaModelInput,
    reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings,
    tracked?: boolean
  ): Readonly<{ accepted: boolean; changed: boolean }>
  /** `historyGroup` is Muya's undo step for this command, as for `input`. */
  prepareImage(
    action: ImagePropertiesAction,
    payload: unknown,
    reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings,
    historyGroup?: number
  ): MuyaImagePreparation
  /** `historyGroup` is Muya's undo step for this command, as for `input`. */
  prepareClipboard(
    action: MuyaClipboardCapture,
    payload: unknown,
    reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings,
    historyGroup?: number
  ): MuyaClipboardPreparation
  /** `historyGroup` is Muya's undo step for this command, as for `input`. */
  clipboard(
    action: DocumentClipboardAction,
    reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings,
    historyGroup?: number
  ): Readonly<{ accepted: boolean; changed: boolean }>
  /** `historyGroup` is Muya's undo step for this command, as for `input`. */
  format(
    action: DocumentFormatAction,
    reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings,
    historyGroup?: number
  ): Readonly<{ accepted: boolean; changed: boolean }>
  selectionSourceRange(
    selection: MuyaPlainTextAuthorSelection
  ): Readonly<{ readonly start: number; readonly end: number }> | undefined
  compositionStart(operation: MuyaModelInput): void
  compositionUpdate(data: string): void
  compositionEnd(
    result: DocumentCompositionResult,
    reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings,
    tracked?: boolean
  ): Readonly<{ accepted: boolean; changed: boolean }>
  configure(
    options: Readonly<Partial<MarkdownOptions>>,
    reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
  ): Promise<CoreAppliedReply | undefined>
  history(
    command: 'undo' | 'redo',
    reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
  ): Promise<CoreAppliedReply | undefined>
  resolve(
    annotation: CoreReviewItemLocator,
    authoredRevision: number,
    decision: CoreReviewDecision,
    reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
  ): Promise<CoreAppliedReply | undefined>
  resolveAll(
    decision: 'accept' | 'reject',
    reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
  ): Promise<CoreAppliedReply | undefined>
  editComment(
    annotation: CoreReviewItemLocator,
    authoredRevision: number,
    text: string,
    reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
  ): Promise<CoreAppliedReply | undefined>
  author(
    form: CoreAuthorForm,
    target: MuyaPlainTextAuthorTarget,
    text: string,
    reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
  ): Promise<CoreAppliedReply | undefined>
  reconcileApplied(
    outcome: CoreAppliedReply,
    reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
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
    readonly nativeHistoryGroup?: string
    readonly reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
    readonly resolve: (outcome: CoreAppliedReply | undefined) => void
    readonly reject: (error: Error) => void
  }>
  | Readonly<{
    readonly kind: 'clipboard'
    readonly action: DocumentClipboardAction
    readonly nativeHistoryGroup?: string
    readonly reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
    readonly resolve: (outcome: CoreAppliedReply | undefined) => void
    readonly reject: (error: Error) => void
  }>
  | Readonly<{
    readonly kind: 'format'
    readonly action: DocumentFormatAction
    readonly nativeHistoryGroup?: string
    readonly reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
    readonly resolve: (outcome: CoreAppliedReply | undefined) => void
    readonly reject: (error: Error) => void
  }>
  | Readonly<{
    readonly kind: 'track'
    readonly input: MuyaModelInput
    readonly nativeHistoryGroup?: string
    readonly markup: boolean
    readonly reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
    readonly resolve: (outcome: CoreAppliedReply) => void
    readonly reject: (error: Error) => void
  }>
  | Readonly<{
    readonly kind: 'history'
    readonly command: 'undo' | 'redo' | 'configure'
    readonly options?: Readonly<Partial<MarkdownOptions>>
    readonly reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
    readonly resolve: (outcome: CoreAppliedReply | undefined) => void
    readonly reject: (error: Error) => void
  }>
  | Readonly<{
    readonly kind: 'resolve'
    readonly annotation: CoreReviewItemLocator
    readonly authoredRevision: number
    readonly decision: CoreReviewDecision
    readonly reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
    readonly resolve: (outcome: CoreAppliedReply | undefined) => void
    readonly reject: (error: Error) => void
  }>
  | Readonly<{
    readonly kind: 'author'
    readonly form: CoreAuthorForm
    readonly selection: MuyaPlainTextAuthorTarget
    readonly text: string
    readonly reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
    readonly resolve: (outcome: CoreAppliedReply | undefined) => void
    readonly reject: (error: Error) => void
  }>
  | Readonly<{
    readonly kind: 'edit-comment'
    readonly annotation: CoreReviewItemLocator
    readonly authoredRevision: number
    readonly text: string
    readonly reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
    readonly resolve: (outcome: CoreAppliedReply | undefined) => void
    readonly reject: (error: Error) => void
  }>
  | Readonly<{
    readonly kind: 'resolve-all'
    readonly decision: 'accept' | 'reject'
    readonly reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
    readonly resolve: (outcome: CoreAppliedReply | undefined) => void
    readonly reject: (error: Error) => void
  }>

/**
 * Serializes captured Muya model operations through one Core binding. The view
 * stays speculative; any rejected operation faults closed for the owner to
 * reconcile or recover.
 */
export function createMuyaPlainTextCoreAdapter(
  bindings: MuyaPlainTextBindings,
  binding: Pick<
    EditorCoreBinding,
    'submit' | 'retainSelection' | 'retainedSelectionAtBarrier' | 'releaseSelection'
  >,
  performanceTrace?: Readonly<{
    readonly documentId: string
    readonly clock?: () => number
    readonly record: (event: CoreAuthorityPerformanceEvent) => void
  }>,
  initialRevision = 1,
  regionalMarkup = false
): MuyaPlainTextCoreAdapter {
  let selectionBindings = installedBindingsOf([])
  const queued: PendingCommand[] = []
  const preparations = new Set<PendingResourcePreparation>()
  const refreshPreparation = (preparation: PendingResourcePreparation): void => {
    if (preparation.submitting) return
    try {
      const target = binding.retainedSelectionAtBarrier(preparation.target)
      if (target.type === 'retained-selection') {
        preparation.selection = structuredClone(target.selection)
        preparation.selectionRevision = target.selectionRevision
        if (target.status === 'conflict') {
          preparation.targetFailure = 'Prepared resource overlaps newer input'
        }
      } else preparation.targetFailure = `Prepared resource target read was ${target.reason}`
    } catch (error) {
      preparation.targetFailure = error instanceof Error ? error.message : String(error)
    }
  }
  const releasePreparation = (preparation: PendingResourcePreparation): void => {
    try {
      const reply = binding.releaseSelection(preparation.target)
      if (reply.type !== 'selection-released') {
        preparation.targetFailure = `Prepared resource release was ${reply.reason}`
      }
      if (preparation.initialSelectionTarget !== undefined) {
        binding.releaseSelection(preparation.initialSelectionTarget)
      }
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

  let installedBindings: MuyaPlainTextBindings | undefined
  const installBindings = (nextBindings: MuyaPlainTextBindings): void => {
    // A regional change leaves every other root's bindings as they were
    // validated, moved together, so only the roots it made are checked.
    const patch = isView(nextBindings) ? muyaMarkupViewPatch(nextBindings) : undefined
    const checked = !isView(nextBindings)
      ? nextBindings
      : patch !== undefined && patch.previous === installedBindings
        ? muyaViewBindingsInRoots(nextBindings, patch.start, patch.nextEnd)
        : nextBindings.bindings
    installedBindings = nextBindings
    const editablePaths = new Set<string>()
    for (const item of checked) {
      if (item.editable === false) continue
      const key = JSON.stringify(item.path)
      if (editablePaths.has(key)) {
        throw new Error('Core Muya projection contains duplicate bindings')
      }
      try {
        assertMuyaDocumentSourceBinding(item)
        editablePaths.add(key)
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
    selectionBindings = installedBindingsOf(nextBindings)
  }
  installBindings(bindings)

  const authorSourceRange = (
    target: MuyaPlainTextAuthorTarget
  ): Readonly<{ readonly start: number; readonly end: number }> | undefined =>
    'start' in target
      ? Number.isSafeInteger(target.start) && Number.isSafeInteger(target.end) && target.start <= target.end
        ? target
        : undefined
      : sourceRangeForSelection(target)
  const sourceRangeForSelection = (
    selection: MuyaPlainTextAuthorSelection,
    allowCollapsed = false,
    sourceBindings = selectionBindings
  ): Readonly<{ readonly start: number; readonly end: number }> | undefined => {
    const anchorBinding = sourceBindings.at(selection.anchor.path)
    const focusBinding = sourceBindings.at(selection.focus.path)
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
      sourceBindings.precedes(anchorBinding, focusBinding) ||
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
    const first = sourceBindings.first()
    const last = sourceBindings.last()
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
    ) {
      return undefined
    }
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
    for (const command of queued.splice(0)) command.reject(terminalError)
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
    if (command.kind === 'track') {
      pendingInsertUnits -= ('data' in command.input ? (command.input.data ?? '') : '').length
    }
    if (command.kind === 'apply-prepared' && command.operation.kind === 'clipboard') {
      pendingInsertUnits -= command.operation.action.markdown.length
    }
    if (command.kind === 'clipboard') {
      pendingInsertUnits -= 'markdown' in command.action ? command.action.markdown.length : 0
    }
    if (command.kind === 'author' || command.kind === 'edit-comment') {
      pendingInsertUnits -= command.text.length
    }
    active = command
    latestSubmitted = command
    const authorRange =
      command.kind === 'author' ? authorSourceRange(command.selection) : undefined
    if (command.kind === 'author' && authorRange === undefined) {
      active = undefined
      command.resolve(undefined)
      pump()
      return
    }
    let inputAction: DocumentInputAction | undefined
    if (command.kind === 'track') {
      const { historyGroup: _historyGroup, ...action } = command.input
      inputAction = structuredClone(action)
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
            ...(command.nativeHistoryGroup === undefined
              ? {}
              : { nativeHistoryGroup: command.nativeHistoryGroup }),
            projections: regionalMarkup ? Object.freeze(['markup'] as const) : Object.freeze([])
          })
          : command.kind === 'clipboard'
            ? Object.freeze({
              kind: 'clipboard' as const,
              action: command.action,
              ...(command.nativeHistoryGroup === undefined
                ? {}
                : { nativeHistoryGroup: command.nativeHistoryGroup }),
              projections: regionalMarkup ? Object.freeze(['markup'] as const) : Object.freeze([])
            })
            : command.kind === 'format'
              ? Object.freeze({
                kind: 'format' as const,
                action: command.action,
                ...(command.nativeHistoryGroup === undefined
                  ? {}
                  : { nativeHistoryGroup: command.nativeHistoryGroup }),
                projections: Object.freeze([])
              })
              : command.kind === 'track'
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
                : command.kind === 'history'
                  ? command.command === 'configure'
                    ? Object.freeze({
                      kind: 'configure' as const,
                      options: command.options!,
                      projections: Object.freeze([])
                    })
                    : Object.freeze({
                      kind: command.command,
                      projections: regionalMarkup
                        ? Object.freeze(['markup'] as const)
                        : Object.freeze([])
                    })
                  : command.kind === 'resolve'
                    ? Object.freeze({
                      kind: 'resolve' as const,
                      authoredRevision: command.authoredRevision,
                      annotation: command.annotation,
                      decision: command.decision,
                      projections: regionalMarkup
                        ? Object.freeze(['markup'] as const)
                        : Object.freeze([])
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
          ...(command.kind === 'track'
            ? {
              insertedUnits: 'data' in command.input ? (command.input.data?.length ?? 0) : 0,
              ...selectionMeasurement(command.input.selection)
            }
            : command.kind === 'clipboard'
              ? {
                insertedUnits: 'markdown' in command.action ? command.action.markdown.length : 0,
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
      command.reject(failure)
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
        command.reject(new Error('Core Muya adapter is disposed'))
        return
      }
      if (outcome.type !== 'applied') {
        if (outcome.type === 'rejected' && outcome.reason === 'no-change') {
          active = undefined
          if (command.kind !== 'track') command.resolve(undefined)
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
        command.reject(failure)
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
        command.kind === 'track'
      ) {
        command.resolve(outcome)
      }
      if (command.kind === 'track' && outcome.inputResult?.selection === undefined) {
        active = undefined
        fault('Core input compilation has no proven resulting selection')
        return
      }
      try {
        const nextBindings = command.reconcile(outcome)
        if (disposed) throw new Error('Core Muya adapter is disposed')
        installBindings(nextBindings)
        if (command.kind !== 'clipboard' && command.kind !== 'format' && command.kind !== 'track') {
          command.resolve(outcome)
        }
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
      recordPerformance({
        phase: 'reconcile',
        transaction: transactionId,
        corrected: true
      })
      active = undefined
      latestSubmitted = undefined
      pump()
    } catch (error) {
      if (disposed) return
      const failure = error instanceof Error ? error : new Error('Core submission failed')
      command.reject(failure)
      fault(failure)
      active = undefined
    }
  }
  const enqueueHistory = (
    command: 'undo' | 'redo' | 'configure',
    reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings,
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

  const nativeGroup = (historyGroup: number | undefined) =>
    historyGroup === undefined
      ? {}
      : { nativeHistoryGroup: `${directHistoryScope}:${historyGroup}` }

  const applyPrepared = (
    target: string,
    operation: CorePreparedOperation,
    reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings,
    historyGroup?: number
  ): Readonly<{ accepted: boolean; changed: boolean }> => {
    latestNativeChange = { target, operation }
    if (disposed || terminalError !== undefined || composing) {
      return Object.freeze({ accepted: false, changed: false })
    }
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
        ...nativeGroup(historyGroup),
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
      currentSelection?: C,
      initialSelection?: DocumentSelection
    ) => Readonly<{ accepted: boolean; changed: boolean }>,
    initialSelection?: DocumentSelection
  ): MuyaResourcePreparation & {
    complete(
      value: T,
      currentSelection?: () => C | undefined
    ): Promise<Readonly<{ accepted: boolean; changed: boolean }>>
  } => {
    if (disposed) throw new Error('Core Muya adapter is disposed')
    if (terminalError !== undefined) throw terminalError
    if (preparations.size >= MAXIMUM_PENDING_TRANSACTIONS) {
      throw new Error('Core resource preparation exceeds its resource policy')
    }
    const captured = structuredClone(action)
    const capturedPayload = structuredClone(payload)
    const retained = binding.retainSelection(captured.selection)
    if (retained.type !== 'retained-selection') {
      throw new Error(`Core resource target was ${retained.reason}`)
    }
    const initial =
      initialSelection === undefined ? undefined : binding.retainSelection(initialSelection)
    if (initial !== undefined && initial.type !== 'retained-selection') {
      binding.releaseSelection(retained.id)
      throw new Error(`Core resource initial selection was ${initial.reason}`)
    }
    let finish!: () => void
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const preparation = {
      ...captured,
      submitting: false,
      target: retained.id,
      ...(initial === undefined ? {} : { initialSelectionTarget: initial.id }),
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
      async complete(value: T, currentSelection?: () => C | undefined) {
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
          const initial =
            preparation.initialSelectionTarget === undefined
              ? undefined
              : binding.retainedSelectionAtBarrier(preparation.initialSelectionTarget)
          const initialSelection =
            initial?.type === 'retained-selection' &&
            initial.status === 'ready' &&
            !('start' in initial.selection)
              ? initial.selection
              : undefined
          const result = apply(preparation.target, completion, selection, initialSelection)
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
      reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings,
      tracked = false
    ): Readonly<{ accepted: boolean; changed: boolean }> {
      latestNativeChange = operation
      if (disposed || terminalError !== undefined || composing) {
        return Object.freeze({ accepted: false, changed: false })
      }
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
      reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings,
      historyGroup?: number
    ): MuyaClipboardPreparation {
      const captured = structuredClone(action)
      const prepared = prepareResource(
        { ...captured, kind: 'kind' in captured ? captured.kind : 'paste' },
        payload,
        (
          target,
          value: Omit<DocumentClipboardContent, 'currentSelection'>,
          currentSelection?: DocumentSelection,
          initialSelection?: DocumentSelection
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
                ...(captured.blockPlacement === undefined
                  ? {}
                  : { blockPlacement: captured.blockPlacement }),
                ...(initialSelection === undefined ? {} : { initialSelection }),
                ...(currentSelection === undefined ? {} : { currentSelection })
              }
            },
            reconcile,
            historyGroup
          ),
        captured.blockPlacement === undefined ? undefined : captured.currentSelection
      )
      return Object.freeze({
        ...prepared,
        complete: (
          markdown: string,
          imported?: {
            plainText?: string
            bareUrl?: string
            pasteAsPlainText?: boolean
            currentSelection?: () => DocumentSelection | undefined
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
      reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings,
      historyGroup?: number
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
            reconcile,
            historyGroup
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
      reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings,
      historyGroup?: number
    ): Readonly<{ accepted: boolean; changed: boolean }> {
      latestNativeChange = action
      if (disposed || terminalError !== undefined || composing) {
        return Object.freeze({ accepted: false, changed: false })
      }
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
          ...nativeGroup(historyGroup),
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
      reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings,
      historyGroup?: number
    ): Readonly<{ accepted: boolean; changed: boolean }> {
      latestNativeChange = action
      if (disposed || terminalError !== undefined || composing) {
        return Object.freeze({ accepted: false, changed: false })
      }
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
          ...nativeGroup(historyGroup),
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
    recoveryDraft(): MuyaRecoveryDraft | undefined {
      return failedDraft ?? captureDraft()
    },
    hasPendingEdits(): boolean {
      // Resource preparations retain model targets and recovery payloads, not
      // unacknowledged native text. They keep isSettled() false without blocking
      // presentation of accepted edits, including their own completion.
      return (
        composing ||
        queued.some(
          (command) =>
            command.kind === 'track' ||
            command.kind === 'format' ||
            command.kind === 'clipboard' ||
            command.kind === 'apply-prepared'
        )
      )
    },
    async reconcileApplied(
      outcome: CoreAppliedReply,
      reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
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
    compositionStart(operation: MuyaModelInput): void {
      if (disposed) throw new Error('Core Muya adapter is disposed')
      if (terminalError !== undefined) throw terminalError
      if (composing || active !== undefined || queued.length > 0) {
        throw new Error('Core Muya composition requires its settled starting revision')
      }
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
      if (!composing || compositionInput === undefined) {
        throw new Error('Core Muya composition is not active')
      }
      compositionChange = { input: compositionInput, data }
      if (data.length > MAXIMUM_PENDING_INSERT_UNITS) {
        fault('Core Muya composition exceeds its resource policy')
      }
    },
    compositionEnd(
      result: DocumentCompositionResult,
      reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings,
      tracked = false
    ): Readonly<{ accepted: boolean; changed: boolean }> {
      if (!composing || compositionInput === undefined || compositionBarrier === undefined) {
        throw new Error('Core Muya composition is not active')
      }
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
      reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
    ) {
      await adapter.settled()
      return enqueueHistory('configure', reconcile, Object.freeze({ ...options }))
    },
    resolve(
      annotation: CoreReviewItemLocator,
      authoredRevision: number,
      decision: CoreReviewDecision,
      reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
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
      reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
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
      reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
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
      selection: MuyaPlainTextAuthorTarget,
      text: string,
      reconcile: (outcome: CoreAppliedReply) => MuyaPlainTextBindings
    ): Promise<CoreAppliedReply | undefined> {
      if (disposed) return Promise.reject(new Error('Core Muya adapter is disposed'))
      if (terminalError !== undefined) return Promise.reject(terminalError)
      if (composing) {
        return Promise.reject(new Error('Core Muya authoring cannot run during composition'))
      }
      if (
        authorSourceRange(selection) === undefined ||
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
            selection:
              'start' in selection
                ? Object.freeze({ start: selection.start, end: selection.end })
                : Object.freeze({
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
      active?.reject(new Error('Core Muya adapter is disposed'))
      fault('Core Muya adapter is disposed')
    }
  })
  return adapter
}
