import type {
  DocumentSourceEdit
} from '@marktext/document-core'

import type { EditorCoreBinding } from './editorCoreBinding'
import type {
  CoreAppliedReply,
  CoreAuthorForm,
  CoreReviewDecision,
  CoreReviewItemLocator
} from './coreProtocol'
import type {
  CoreAuthorityPerformanceEvent
} from './coreAuthorityPerformanceTrace'
import {
  advanceMuyaSourceBinding,
  assertMuyaPlainTextSourceBinding,
  composeMuyaNativeTextChange,
  createMuyaPlainTextSourceEditAdapter,
  nativeMuyaTextEdit,
  sourceEditForMuyaCrossParagraphChange,
  sourceEditForMuyaMathTextChange,
  sourceEditForMuyaTwoParagraphPaste,
  type MuyaMathSourceBinding,
  type MuyaPlainTextSourceBinding
} from './muyaPlainTextSourceEdit'
import { muyaSourceEdits } from './muyaContainerSourceEdit'
import { canonicalSourceForMuyaTable } from './muyaTableSourceCodec'
import { mappedMuyaSourceRange } from './muyaMarkupView'
import { reconcileOptimisticTransaction, transformOptimisticHistory } from './optimisticHistoryTransform'
import { sourceEditForMuyaStructuralEnter } from './muyaStructuralEnter'
import { nativeMuyaStructuralDraft, sourceEditForMuyaStructuralChange } from './muyaStructuralSourceEdit'
import { reconcileMuyaNativeBindings, reconcileMuyaNativeStructureBindings } from './muyaNativeReconciliation'

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

export type MuyaPlainTextCoreAdapterState =
  | Readonly<{ readonly status: 'ready'; readonly revision: number }>
  | Readonly<{ readonly status: 'faulted'; readonly message: string }>

export interface MuyaRecoveryDraft {
  readonly revision: number
  readonly nativeChange: unknown
  readonly commands: readonly Readonly<Record<string, unknown>>[]
  readonly composition: unknown
}

export interface MuyaPlainTextCoreAdapter {
  reconciledSourcePosition(point: MuyaPlainTextAuthorSelection['focus']): number | undefined
  hasPendingEdits(): boolean
  recoveryDraft(): MuyaRecoveryDraft | undefined
  accept(change: unknown): 'accepted' | 'unsupported'
  selectionSourceRange(
    selection: MuyaPlainTextAuthorSelection
  ): Readonly<{ readonly start: number; readonly end: number }> | undefined
  acceptTracked(
    change: unknown,
    reconcile: (
      outcome: CoreAppliedReply
    ) => Promise<readonly MuyaPlainTextSourceBinding[]>,
    markup?: boolean
  ): 'accepted' | 'unsupported'
  compositionStart(): void
  compositionEnd(): Promise<void>
  history(
    command: 'undo' | 'redo',
    reconcile: (
      outcome: CoreAppliedReply
    ) => Promise<readonly MuyaPlainTextSourceBinding[]>
  ): Promise<CoreAppliedReply | undefined>
  resolve(
    annotation: CoreReviewItemLocator,
    authoredRevision: number,
    decision: CoreReviewDecision,
    reconcile: (
      outcome: CoreAppliedReply
    ) => Promise<readonly MuyaPlainTextSourceBinding[]>
  ): Promise<CoreAppliedReply | undefined>
  resolveAll(
    decision: 'accept' | 'reject',
    reconcile: (
      outcome: CoreAppliedReply
    ) => Promise<readonly MuyaPlainTextSourceBinding[]>
  ): Promise<CoreAppliedReply | undefined>
  editComment(
    annotation: CoreReviewItemLocator,
    authoredRevision: number,
    text: string,
    reconcile: (
      outcome: CoreAppliedReply
    ) => Promise<readonly MuyaPlainTextSourceBinding[]>
  ): Promise<CoreAppliedReply | undefined>
  author(
    form: CoreAuthorForm,
    selection: MuyaPlainTextAuthorSelection,
    text: string,
    reconcile: (
      outcome: CoreAppliedReply
    ) => Promise<readonly MuyaPlainTextSourceBinding[]>
  ): Promise<CoreAppliedReply | undefined>
  reconcileApplied(
    outcome: CoreAppliedReply,
    reconcile: (
      outcome: CoreAppliedReply
    ) => Promise<readonly MuyaPlainTextSourceBinding[]>
  ): Promise<void>
  settled(): Promise<void>
  state(): MuyaPlainTextCoreAdapterState
  dispose(): void
}

const MAXIMUM_PENDING_TRANSACTIONS = 128
const MAXIMUM_PENDING_INSERT_UNITS = 4 * 1024 * 1024

type PendingCommand = Readonly<{
  readonly kind: 'edit'
  readonly nativeHistoryGroup?: string
  readonly edit: DocumentSourceEdit
  readonly remapFollowingNative?: true
}> | Readonly<{
  readonly kind: 'track'
  readonly nativeTextOnly: boolean
  readonly nativeHistoryGroup?: string
  readonly markup?: boolean
  readonly edit: DocumentSourceEdit
  readonly deferredChange?: unknown
  readonly reconcile: (
    outcome: CoreAppliedReply
  ) => Promise<readonly MuyaPlainTextSourceBinding[]>
  readonly resolve: (outcome: CoreAppliedReply) => void
  readonly reject: (error: Error) => void
}> | Readonly<{
  readonly kind: 'history'
  readonly command: 'undo' | 'redo'
  readonly reconcile: (
    outcome: CoreAppliedReply
  ) => Promise<readonly MuyaPlainTextSourceBinding[]>
  readonly resolve: (outcome: CoreAppliedReply | undefined) => void
  readonly reject: (error: Error) => void
}> | Readonly<{
  readonly kind: 'resolve'
  readonly annotation: CoreReviewItemLocator
  readonly authoredRevision: number
  readonly decision: CoreReviewDecision
  readonly reconcile: (
    outcome: CoreAppliedReply
  ) => Promise<readonly MuyaPlainTextSourceBinding[]>
  readonly resolve: (outcome: CoreAppliedReply | undefined) => void
  readonly reject: (error: Error) => void
}> | Readonly<{
  readonly kind: 'author'
  readonly form: CoreAuthorForm
  readonly selection: MuyaPlainTextAuthorSelection
  readonly text: string
  readonly reconcile: (
    outcome: CoreAppliedReply
  ) => Promise<readonly MuyaPlainTextSourceBinding[]>
  readonly resolve: (outcome: CoreAppliedReply | undefined) => void
  readonly reject: (error: Error) => void
}> | Readonly<{
  readonly kind: 'edit-comment'
  readonly annotation: CoreReviewItemLocator
  readonly authoredRevision: number
  readonly text: string
  readonly reconcile: (
    outcome: CoreAppliedReply
  ) => Promise<readonly MuyaPlainTextSourceBinding[]>
  readonly resolve: (outcome: CoreAppliedReply | undefined) => void
  readonly reject: (error: Error) => void
}> | Readonly<{
  readonly kind: 'resolve-all'
  readonly decision: 'accept' | 'reject'
  readonly reconcile: (
    outcome: CoreAppliedReply
  ) => Promise<readonly MuyaPlainTextSourceBinding[]>
  readonly resolve: (outcome: CoreAppliedReply | undefined) => void
  readonly reject: (error: Error) => void
}>

const pathOf = (change: unknown): string | undefined => {
  if (change === null || typeof change !== 'object') return undefined
  const operation = (change as { readonly op?: unknown }).op
  if (!Array.isArray(operation) || operation.length < 2) return undefined
  return JSON.stringify(operation.slice(0, -1))
}

const paragraphHeadingEdit = (
  change: unknown,
  bindings: ReadonlyMap<number, MuyaPlainTextSourceBinding>
): DocumentSourceEdit | undefined => {
  if (change === null || typeof change !== 'object') return undefined
  const candidate = change as {
    readonly source?: unknown
    readonly op?: unknown
    readonly prevDoc?: unknown
    readonly doc?: unknown
  }
  if (
    candidate.source !== 'user' || !Array.isArray(candidate.op) ||
    candidate.op.length !== 2 || !Number.isSafeInteger(candidate.op[0])
  ) return undefined
  const blockIndex = candidate.op[0] as number
  const binding = bindings.get(blockIndex)
  if (binding === undefined) return undefined
  const component = candidate.op[1]
  if (component === null || typeof component !== 'object') return undefined
  const replacement = component as { readonly r?: unknown; readonly i?: unknown }
  if (replacement.r !== true || replacement.i === null ||
      typeof replacement.i !== 'object') return undefined
  const inserted = replacement.i as {
    readonly name?: unknown
    readonly text?: unknown
    readonly meta?: unknown
  }
  if (
    inserted.name !== 'atx-heading' || typeof inserted.text !== 'string' ||
    inserted.meta === null || typeof inserted.meta !== 'object'
  ) return undefined
  const level = (inserted.meta as { readonly level?: unknown }).level
  if (!Number.isSafeInteger(level) || (level as number) < 1 || (level as number) > 6) {
    return undefined
  }
  const prefix = `${'#'.repeat(level as number)} `
  const marker = prefix.slice(0, -1)
  if (inserted.text !== marker && !inserted.text.startsWith(prefix)) {
    return undefined
  }
  if (!Array.isArray(candidate.prevDoc) || !Array.isArray(candidate.doc)) {
    return undefined
  }
  const previous = candidate.prevDoc[blockIndex]
  const next = candidate.doc[blockIndex]
  if (previous === null || typeof previous !== 'object' ||
      next === null || typeof next !== 'object') return undefined
  const previousBlock = previous as { readonly name?: unknown; readonly text?: unknown }
  const nextBlock = next as {
    readonly name?: unknown
    readonly text?: unknown
    readonly meta?: { readonly level?: unknown }
  }
  if (
    previousBlock.name !== 'paragraph' || previousBlock.text !== binding.text ||
    nextBlock.name !== inserted.name || nextBlock.text !== inserted.text ||
    nextBlock.meta?.level !== level
  ) return undefined
  if (binding.annotationContext === true) {
    if (inserted.text !== prefix + binding.text || binding.paragraphPrefixPosition === undefined) return undefined
    return { start: binding.paragraphPrefixPosition, end: binding.paragraphPrefixPosition, insert: prefix }
  }
  return Object.freeze({
    start: binding.sourceRange.start,
    end: binding.sourceRange.end,
    insert: inserted.text
  })
}

const paragraphBlockquoteEdit = (
  change: unknown,
  bindings: ReadonlyMap<number, MuyaPlainTextSourceBinding>
): DocumentSourceEdit | undefined => {
  if (change === null || typeof change !== 'object') return undefined
  const candidate = change as { source?: unknown; op?: unknown; prevDoc?: unknown; doc?: unknown }
  if (candidate.source !== 'user' || !Array.isArray(candidate.op) ||
      candidate.op.length !== 2 || !Number.isSafeInteger(candidate.op[0]) ||
      !Array.isArray(candidate.prevDoc) || !Array.isArray(candidate.doc)) return undefined
  const index = candidate.op[0] as number
  const binding = bindings.get(index)
  // This conversion owns one literal paragraph. A projected annotation arm
  // cannot be serialized as source without losing its delimiters/other arms.
  if (binding === undefined || binding.annotationContext === true ||
      binding.sourceRange.end - binding.sourceRange.start !== binding.text.length) return undefined
  const replacement = candidate.op[1] as { r?: unknown; i?: unknown } | null
  if (replacement === null || typeof replacement !== 'object' || replacement.r !== true) return undefined
  const isParagraph = (value: unknown): boolean => value !== null && typeof value === 'object' &&
    (value as { name?: unknown }).name === 'paragraph' &&
    (value as { text?: unknown }).text === binding.text
  const isQuote = (value: unknown): boolean => {
    if (value === null || typeof value !== 'object') return false
    const quote = value as { name?: unknown; children?: unknown }
    return quote.name === 'block-quote' && Array.isArray(quote.children) &&
      quote.children.length === 1 && isParagraph(quote.children[0])
  }
  if (candidate.prevDoc.length !== candidate.doc.length ||
      !isParagraph(candidate.prevDoc[index]) || !isQuote(replacement.i) ||
      !isQuote(candidate.doc[index])) return undefined
  return Object.freeze({
    start: binding.sourceRange.start,
    end: binding.sourceRange.end,
    insert: binding.text.split('\n').map(line => `> ${line}`).join('\n')
  })
}

const paragraphMathEdit = (
  change: unknown,
  bindings: ReadonlyMap<number, MuyaPlainTextSourceBinding>
): Readonly<{
  readonly edit: DocumentSourceEdit
  readonly binding: MuyaMathSourceBinding
}> | undefined => {
  if (change === null || typeof change !== 'object') return undefined
  const candidate = change as {
    readonly source?: unknown
    readonly op?: unknown
    readonly prevDoc?: unknown
    readonly doc?: unknown
  }
  if (
    candidate.source !== 'user' || !Array.isArray(candidate.op) ||
    candidate.op.length !== 2 || !Number.isSafeInteger(candidate.op[0]) ||
    !Array.isArray(candidate.prevDoc) || !Array.isArray(candidate.doc)
  ) return undefined
  const blockIndex = candidate.op[0] as number
  const sourceBinding = bindings.get(blockIndex)
  if (sourceBinding === undefined || sourceBinding.annotationContext === true) return undefined
  const replacement = candidate.op[1]
  if (replacement === null || typeof replacement !== 'object') return undefined
  const descriptor = replacement as { readonly r?: unknown; readonly i?: unknown }
  if (
    descriptor.r !== true || descriptor.i === null ||
    typeof descriptor.i !== 'object'
  ) return undefined
  const inserted = descriptor.i as {
    readonly name?: unknown
    readonly text?: unknown
    readonly meta?: unknown
  }
  const previous = candidate.prevDoc[blockIndex]
  const next = candidate.doc[blockIndex]
  if (
    inserted.name !== 'math-block' || inserted.text !== '' ||
    inserted.meta === null || typeof inserted.meta !== 'object' ||
    (inserted.meta as { readonly mathStyle?: unknown }).mathStyle !== '' ||
    previous === null || typeof previous !== 'object' ||
    next === null || typeof next !== 'object'
  ) return undefined
  const previousBlock = previous as { readonly name?: unknown; readonly text?: unknown }
  const nextBlock = next as {
    readonly name?: unknown
    readonly text?: unknown
    readonly meta?: { readonly mathStyle?: unknown }
  }
  if (
    previousBlock.name !== 'paragraph' ||
    previousBlock.text !== sourceBinding.text ||
    nextBlock.name !== 'math-block' || nextBlock.text !== '' ||
    nextBlock.meta?.mathStyle !== ''
  ) return undefined
  const insert = '$$\n\n$$'
  return Object.freeze({
    edit: Object.freeze({
      start: sourceBinding.sourceRange.start,
      end: sourceBinding.sourceRange.end,
      insert
    }),
    binding: Object.freeze({
      blockIndex,
      sourceRange: Object.freeze({
        start: sourceBinding.sourceRange.start + 3,
        end: sourceBinding.sourceRange.start + 3
      }),
      text: ''
    })
  })
}

const paragraphTableEdit = (
  change: unknown,
  bindings: ReadonlyMap<number, MuyaPlainTextSourceBinding>
): DocumentSourceEdit | undefined => {
  if (change === null || typeof change !== 'object') return undefined
  const candidate = change as {
    readonly source?: unknown
    readonly op?: unknown
    readonly prevDoc?: unknown
    readonly doc?: unknown
  }
  if (
    candidate.source !== 'user' || !Array.isArray(candidate.op) ||
    candidate.op.length !== 2 || !Number.isSafeInteger(candidate.op[0]) ||
    !Array.isArray(candidate.prevDoc) || !Array.isArray(candidate.doc)
  ) return undefined
  const blockIndex = candidate.op[0] as number
  const sourceBinding = bindings.get(blockIndex)
  if (sourceBinding === undefined || sourceBinding.annotationContext === true) return undefined
  const replacement = candidate.op[1]
  if (replacement === null || typeof replacement !== 'object') return undefined
  const descriptor = replacement as { readonly r?: unknown; readonly i?: unknown }
  if (descriptor.r !== true) return undefined
  const previous = candidate.prevDoc[blockIndex]
  if (previous === null || typeof previous !== 'object') return undefined
  const previousBlock = previous as { readonly name?: unknown; readonly text?: unknown }
  if (
    previousBlock.name !== 'paragraph' ||
    previousBlock.text !== sourceBinding.text
  ) return undefined
  const inserted = canonicalSourceForMuyaTable(
    descriptor.i,
    MAXIMUM_PENDING_INSERT_UNITS
  )
  const next = canonicalSourceForMuyaTable(
    candidate.doc[blockIndex],
    MAXIMUM_PENDING_INSERT_UNITS
  )
  if (
    inserted.kind !== 'source' || next.kind !== 'source' ||
    inserted.markdown !== next.markdown
  ) return undefined
  return Object.freeze({
    start: sourceBinding.sourceRange.start,
    end: sourceBinding.sourceRange.end,
    insert: inserted.markdown
  })
}

/**
 * Serializes the currently proven native Muya paragraph operations through one
 * Core binding. The view stays speculative; any unsupported or rejected
 * operation faults closed for the owner to reconcile or recover.
 */
export function createMuyaPlainTextCoreAdapter(
  bindings: readonly MuyaPlainTextSourceBinding[],
  binding: Pick<EditorCoreBinding, 'submit'>,
  performanceTrace?: Readonly<{
    readonly documentId: string
    readonly clock?: () => number
    readonly record: (event: CoreAuthorityPerformanceEvent) => void
  }>,
  reconcileOrdinaryEdit?: (
    outcome: CoreAppliedReply
  ) => Promise<readonly MuyaPlainTextSourceBinding[]>,
  initialRevision = 1,
  regionalMarkup = false
): MuyaPlainTextCoreAdapter {
  const adapters = new Map<string, ReturnType<
    typeof createMuyaPlainTextSourceEditAdapter
  > | undefined>()
  const bindingByBlock = new Map<number, MuyaPlainTextSourceBinding>()
  const bindingByPath = new Map<string, MuyaPlainTextSourceBinding>()
  const mathBindingByBlock = new Map<number, MuyaMathSourceBinding>()
  let currentBindings: readonly MuyaPlainTextSourceBinding[] = Object.freeze([])
  let selectionBindings: readonly MuyaPlainTextSourceBinding[] = Object.freeze([])
  const queued: PendingCommand[] = []
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
  const historyIsPending = (): boolean => pendingHistory !== undefined ||
    active?.kind === 'history' || queued.some(command => command.kind === 'history')
  let revision = initialRevision
  let terminalError: Error | undefined
  let composing = false
  let compositionEdit: DocumentSourceEdit | undefined
  let compositionChange: unknown
  let compositionNeedsRebase = false
  let compositionReconciliation: (() => Promise<readonly MuyaPlainTextSourceBinding[]>) | undefined
  let compositionMarkup = false
  let compositionTrackReconcile: ((
    outcome: CoreAppliedReply
  ) => Promise<readonly MuyaPlainTextSourceBinding[]>) | undefined
  let compositionBarrier: Readonly<{
    readonly promise: Promise<void>
    readonly resolve: () => void
    readonly reject: (error: Error) => void
  }> | undefined

  type PerformanceEventInput =
    | Readonly<{ readonly phase: 'dispatch'; readonly transaction: number; readonly pendingDepth: number; readonly insertedUnits?: number; readonly deletedUnits?: number }>
    | Readonly<{ readonly phase: 'ack'; readonly transaction: number }>
    | Readonly<{ readonly phase: 'reconcile'; readonly transaction: number; readonly corrected: boolean }>
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

  const installBindings = (
    nextBindings: readonly MuyaPlainTextSourceBinding[]
  ): void => {
    const nextAdapters = new Map<string, ReturnType<
      typeof createMuyaPlainTextSourceEditAdapter
    > | undefined>()
    const nextByBlock = new Map<number, MuyaPlainTextSourceBinding>()
    for (const item of nextBindings) {
      if (item.editable === false) continue
      const key = JSON.stringify(item.path)
      if (nextAdapters.has(key)) {
        throw new Error('Core Muya projection contains duplicate bindings')
      }
      try {
        assertMuyaPlainTextSourceBinding(item)
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
      if (item.path.length === 2 && typeof item.path[0] === 'number') {
        nextByBlock.set(item.path[0], item)
      }
    }
    adapters.clear()
    bindingByPath.clear()
    for (const item of nextBindings) bindingByPath.set(JSON.stringify(item.path), item)
    for (const [key, adapter] of nextAdapters) adapters.set(key, adapter)
    bindingByBlock.clear()
    for (const [blockIndex, item] of nextByBlock) {
      bindingByBlock.set(blockIndex, item)
    }
    mathBindingByBlock.clear()
    currentBindings = Object.freeze(nextBindings.filter(item => item.editable !== false))
    selectionBindings = Object.freeze([...nextBindings])
  }
  installBindings(bindings)

  const adapterForPath = (key: string | undefined): ReturnType<typeof createMuyaPlainTextSourceEditAdapter> | undefined => {
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
    installBindings(selectionBindings.map(item => advanceMuyaSourceBinding(item, edit)))
  }

  const decodeNativeEdit = (change: unknown): DocumentSourceEdit | undefined => {
    const key = pathOf(change)
    const sourceAdapter = adapterForPath(key)
    const result = sourceAdapter?.accept(change)
    if (result?.kind === 'edit') return result.edit
    return sourceEditForMuyaStructuralEnter(currentBindings, change)?.edit ??
      paragraphMathEdit(change, bindingByBlock)?.edit ??
      paragraphHeadingEdit(change, bindingByBlock) ??
      paragraphBlockquoteEdit(change, bindingByBlock) ??
      paragraphTableEdit(change, bindingByBlock) ??
      sourceEditForMuyaTwoParagraphPaste(currentBindings, change) ??
      sourceEditForMuyaCrossParagraphChange(currentBindings, change) ??
      sourceEditForMuyaStructuralChange(currentBindings, change, MAXIMUM_PENDING_INSERT_UNITS - pendingInsertUnits)
  }

  const sourceRangeForSelection = (
    selection: MuyaPlainTextAuthorSelection
  ): Readonly<{ readonly start: number; readonly end: number }> | undefined => {
    const samePath = (
      left: readonly (string | number)[],
      right: readonly (string | number)[]
    ): boolean => left.length === right.length &&
      left.every((part, index) => part === right[index])
    const anchorBinding = selectionBindings.find(item =>
      samePath(item.path, selection.anchor.path)
    )
    const focusBinding = selectionBindings.find(item =>
      samePath(item.path, selection.focus.path)
    )
    if (
      anchorBinding === undefined || focusBinding === undefined ||
      !Number.isSafeInteger(selection.anchor.offset) ||
      !Number.isSafeInteger(selection.focus.offset) ||
      selection.anchor.offset < 0 || selection.focus.offset < 0 ||
      selection.anchor.offset > anchorBinding.text.length ||
      selection.focus.offset > focusBinding.text.length
    ) return undefined
    const forward = selectionBindings.indexOf(anchorBinding) < selectionBindings.indexOf(focusBinding) ||
      (anchorBinding === focusBinding && selection.anchor.offset <= selection.focus.offset)
    const anchorRange = mappedMuyaSourceRange(anchorBinding, {
      start: selection.anchor.offset, end: selection.anchor.offset
    }, forward ? 'next' : 'previous')
    const focusRange = mappedMuyaSourceRange(focusBinding, {
      start: selection.focus.offset, end: selection.focus.offset
    }, forward ? 'previous' : 'next')
    if (anchorRange === undefined || focusRange === undefined) return undefined
    const anchor = anchorRange.start
    const focus = focusRange.start
    const start = Math.min(anchor, focus)
    const end = Math.max(anchor, focus)
    if (start === end) return undefined
    return Object.freeze({
      start,
      end
    })
  }

  const resolveWaiters = (): void => {
    if (active !== undefined || queued.length > 0) return
    for (const waiter of waiters) waiter.resolve()
    waiters.clear()
  }
  const captureDraft = (): MuyaRecoveryDraft | undefined => {
    if (latestNativeChange === undefined && compositionChange === undefined) return undefined
    const submitted = active ?? latestSubmitted
    return structuredClone({
      revision,
      nativeChange: latestNativeChange,
      commands: [...(submitted === undefined ? [] : [submitted]), ...queued]
        .map(command => Object.fromEntries(Object.entries(command ?? {})
          .filter(([, value]) => typeof value !== 'function'))),
      composition: compositionChange
    })
  }
  const fault = (message: string | Error): void => {
    if (terminalError !== undefined) return
    failedDraft = captureDraft()
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
      pendingInsertUnits -= command.edit.insert.length
    }
    if (command.kind === 'author' || command.kind === 'edit-comment') {
      pendingInsertUnits -= command.text.length
    }
    active = command
    latestSubmitted = command
    const deferredTrackEdit = command.kind === 'track' &&
      command.deferredChange !== undefined
      ? decodeNativeEdit(command.deferredChange)
      : undefined
    if (
      command.kind === 'track' && command.deferredChange !== undefined &&
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
    const authorRange = command.kind === 'author'
      ? sourceRangeForSelection(command.selection)
      : undefined
    if (command.kind === 'author' && authorRange === undefined) {
      active = undefined
      command.resolve(undefined)
      pump()
      return
    }
    const historyBeforeSubmission = pendingHistory
    let submittedEdit = command.kind === 'edit' || command.kind === 'track'
      ? deferredTrackEdit ?? command.edit
      : undefined
    let submittedEdits = submittedEdit === undefined ? undefined : muyaSourceEdits(submittedEdit)
    try {
      if (pendingHistory !== undefined && submittedEdit !== undefined) {
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
          baseSourceLength: pendingHistory.baseSourceLength + submittedEdit.insert.length - (submittedEdit.end - submittedEdit.start),
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
      const submission = binding.submit(command.kind === 'edit'
        ? Object.freeze({
          edits: Object.freeze(submittedEdits!),
          ...(command.nativeHistoryGroup === undefined ? {} : { nativeHistoryGroup: command.nativeHistoryGroup }),
          projections: regionalMarkup ? Object.freeze(['markup'] as const) : Object.freeze([])
        })
        : command.kind === 'track'
          ? command.markup
            ? Object.freeze({
              kind: 'markup-edits' as const,
              ...(command.nativeHistoryGroup === undefined ? {} : { nativeHistoryGroup: command.nativeHistoryGroup }),
              edits: Object.freeze(submittedEdits!),
              projections: regionalMarkup ? Object.freeze(['markup'] as const) : Object.freeze([])
            })
            : submittedEdits!.length > 1
              ? Object.freeze({
                kind: 'track-edits' as const,
                ...(command.nativeHistoryGroup === undefined ? {} : { nativeHistoryGroup: command.nativeHistoryGroup }),
                edits: Object.freeze(submittedEdits!),
                projections: regionalMarkup ? Object.freeze(['markup'] as const) : Object.freeze([])
              })
              : Object.freeze({
                kind: 'track' as const,
                ...(command.nativeHistoryGroup === undefined ? {} : { nativeHistoryGroup: command.nativeHistoryGroup }),
                range: Object.freeze({
                  start: (submittedEdit!).start,
                  end: (submittedEdit!).end
                }),
                text: (submittedEdit!).insert,
                projections: regionalMarkup ? Object.freeze(['markup'] as const) : Object.freeze([])
              })
          : command.kind === 'history'
            ? Object.freeze({
              kind: command.command,
              projections: Object.freeze([])
            })
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
                  }))
      acknowledged = submission.acknowledged
      transactionId = submission.identity.transactionId
      recordPerformance({
        phase: 'dispatch',
        transaction: submission.identity.transactionId,
        pendingDepth: queued.length + 1,
        ...(command.kind === 'edit' || command.kind === 'track'
          ? {
            insertedUnits: command.edit.insert.length,
            deletedUnits: command.edit.end - command.edit.start
          }
          : {})
      })
    } catch (error) {
      active = undefined
      const failure = error instanceof Error
        ? error
        : new Error('Core submission failed')
      if (command.kind !== 'edit') command.reject(failure)
      fault(failure)
      return
    }
    acknowledged.then(async outcome => {
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
          command.kind === 'history' && outcome.type === 'rejected' &&
          outcome.reason === 'history-empty'
        ) {
          active = undefined
          command.resolve(undefined)
          pump()
          return
        }
        if (
          command.kind === 'resolve' && outcome.type === 'rejected' &&
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
          command.kind === 'edit-comment' && outcome.type === 'rejected' &&
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
          outcome.type === 'rejected' && outcome.reason === 'history-resource' &&
          command.kind !== 'edit' && command.kind !== 'track'
        ) {
          active = undefined
          command.resolve(undefined)
          pump()
          return
        }
        if (
          command.kind === 'author' && outcome.type === 'rejected' &&
          outcome.reason === 'author-invalid'
        ) {
          active = undefined
          command.resolve(undefined)
          pump()
          return
        }
        const failure = new Error(`Core Muya transaction was ${outcome.type}`)
        if (command.kind !== 'edit') command.reject(failure)
        active = undefined
        fault(failure)
        return
      }
      revision = outcome.revision
      reconciledNativePositionReady = false
      if (command.kind === 'track' && command.nativeTextOnly && !command.markup && pendingHistory === undefined &&
          outcome.nativeReconciliation !== undefined &&
          (nativeBindingsPending || outcome.nativeReconciliation.length > 0)) {
        installBindings(reconcileMuyaNativeBindings(
          selectionBindings.map(item => advanceMuyaSourceBinding(item, submittedEdit!)),
          outcome.nativeReconciliation
        ))
        nativeBindingsPending = true
        reconciledNativePositionReady = true
      }
      if (historyBeforeSubmission !== undefined && command.kind === 'track') {
        pendingHistory = {
          baseSourceLength: historyBeforeSubmission.baseSourceLength + command.edit.insert.length - (command.edit.end - command.edit.start),
          edits: reconcileOptimisticTransaction({
            baseSourceLength: historyBeforeSubmission.baseSourceLength,
            precedingEdits: historyBeforeSubmission.edits,
            optimisticEdits: muyaSourceEdits(command.edit),
            appliedEdits: outcome.change.appliedEdits
          })
        }
      }
      if (command.kind === 'history') {
        const delta = outcome.change.appliedEdits.reduce((sum, edit) =>
          sum + edit.insert.length - (edit.end - edit.start), 0)
        pendingHistory = historyBeforeSubmission === undefined
          ? { baseSourceLength: outcome.sourceLength - delta, edits: outcome.change.appliedEdits }
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
          const nextBindings = await reconcileOrdinaryEdit(outcome)
          if (disposed) throw new Error('Core Muya adapter is disposed')
          if (composing) {
            compositionReconciliation = () => revision === outcome.revision
              ? reconcileOrdinaryEdit(outcome)
              : Promise.resolve(selectionBindings)
          }
          // Ordinary queued edits are already mapped against the speculative
          // revision. Keep that map until the last acknowledgement catches up.
          if (queued.every(pending => pending.kind !== 'edit' &&
              (pendingHistory === undefined || pending.kind !== 'track'))) {
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
          const nextBindings = await command.reconcile(outcome)
          if (nativeBindingsPending && command.kind === 'track' && !command.nativeTextOnly && command.deferredChange !== undefined) {
            const reconciled = reconcileMuyaNativeStructureBindings(selectionBindings, nextBindings, command.deferredChange, outcome.change.appliedEdits)
            installBindings(reconciled)
            nativeBindingsPending = reconciled.some((item, index) => item !== nextBindings[index])
          }
          if (disposed) throw new Error('Core Muya adapter is disposed')
          if (composing) {
            compositionReconciliation = () => revision === outcome.revision
              ? command.reconcile(outcome)
              : Promise.resolve(selectionBindings)
          }
          if ((pendingHistory === undefined ||
              queued.every(pending => pending.kind !== 'edit' && pending.kind !== 'track')) &&
              (!nativeBindingsPending || (!composing && queued.every(pending => pending.kind !== 'edit' && pending.kind !== 'track')))) {
            installBindings(nextBindings)
            pendingHistory = undefined
            nativeBindingsPending = false
            reconciledNativePositionReady = false
          }
          command.resolve(outcome)
        } catch (error) {
          const failure = error instanceof Error
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
    }).catch(error => {
      if (disposed) return
      const failure = error instanceof Error
        ? error
        : new Error('Core submission failed')
      if (command.kind !== 'edit') command.reject(failure)
      fault(failure)
      active = undefined
    })
  }
  const enqueue = (edit: DocumentSourceEdit, remapFollowingNative = false, nativeHistoryGroup?: string): boolean => {
    if (
      queued.length + (active === undefined ? 0 : 1) >=
        MAXIMUM_PENDING_TRANSACTIONS ||
      pendingInsertUnits + edit.insert.length > MAXIMUM_PENDING_INSERT_UNITS
    ) {
      fault('Core Muya pending work exceeds its resource policy')
      return false
    }
    queued.push(Object.freeze({
      kind: 'edit',
      edit,
      ...(nativeHistoryGroup === undefined ? {} : { nativeHistoryGroup }),
      ...(remapFollowingNative ? { remapFollowingNative: true as const } : {})
    }))
    pendingInsertUnits += edit.insert.length
    pump()
    return true
  }
  const acceptEdit = (
    edit: DocumentSourceEdit,
    retainPlainBindings = true,
    nativeHistoryGroup?: string
  ): boolean => {
    if (!composing) {
      if (retainPlainBindings) installAppliedEdit(edit)
      else installBindings(Object.freeze([]))
      return enqueue(edit, !retainPlainBindings, nativeHistoryGroup)
    }
    if (compositionEdit === undefined) {
      if (edit.insert.length > MAXIMUM_PENDING_INSERT_UNITS) {
        fault('Core Muya pending work exceeds its resource policy')
        return false
      }
      compositionEdit = edit
      return true
    }
    const relativeStart = edit.start - compositionEdit.start
    const relativeEnd = edit.end - compositionEdit.start
    if (
      relativeStart < 0 || relativeEnd < relativeStart ||
      relativeEnd > compositionEdit.insert.length
    ) {
      fault('Core Muya composition escaped its authored range')
      return false
    }
    const insert = compositionEdit.insert.slice(0, relativeStart) +
      edit.insert + compositionEdit.insert.slice(relativeEnd)
    if (insert.length > MAXIMUM_PENDING_INSERT_UNITS) {
      fault('Core Muya pending work exceeds its resource policy')
      return false
    }
    compositionEdit = Object.freeze({
      start: compositionEdit.start,
      end: compositionEdit.end,
      insert
    })
    return true
  }
  const enqueueTracked = (
    edit: DocumentSourceEdit,
    reconcile: (
      outcome: CoreAppliedReply
    ) => Promise<readonly MuyaPlainTextSourceBinding[]>,
    deferredChange?: unknown,
    markup = false,
    nativeHistoryGroup?: string,
    nativeTextOnly = false
  ): boolean => {
    if (
      queued.length + (active === undefined ? 0 : 1) >=
        MAXIMUM_PENDING_TRANSACTIONS ||
      pendingInsertUnits + edit.insert.length > MAXIMUM_PENDING_INSERT_UNITS
    ) return false
    queued.push(Object.freeze({
      kind: 'track',
      nativeTextOnly,
      ...(nativeHistoryGroup === undefined ? {} : { nativeHistoryGroup }),
      markup,
      edit,
      ...(deferredChange === undefined ? {} : { deferredChange }),
      reconcile,
      resolve: () => {},
      reject: () => {}
    }))
    pendingInsertUnits += edit.insert.length
    pump()
    return true
  }

  return Object.freeze({
    reconciledSourcePosition(point: MuyaPlainTextAuthorSelection['focus']): number | undefined {
      if (!reconciledNativePositionReady) return undefined
      const binding = selectionBindings.find(item => JSON.stringify(item.path) === JSON.stringify(point.path))
      return binding === undefined
        ? undefined
        : mappedMuyaSourceRange(binding,
          { start: point.offset, end: point.offset }, 'next')?.start
    },
    recoveryDraft(): MuyaRecoveryDraft | undefined {
      return failedDraft ?? captureDraft()
    },
    hasPendingEdits(): boolean {
      return composing || queued.some(command => command.kind === 'edit' || command.kind === 'track')
    },
    async reconcileApplied(
      outcome: CoreAppliedReply,
      reconcile: (
        outcome: CoreAppliedReply
      ) => Promise<readonly MuyaPlainTextSourceBinding[]>
    ): Promise<void> {
      if (disposed) throw new Error('Core Muya adapter is disposed')
      if (terminalError !== undefined) throw terminalError
      if (
        composing || active !== undefined || queued.length > 0 ||
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
        const failure = error instanceof Error
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
      const nativeHistoryGroup = change !== null && typeof change === 'object' &&
        typeof (change as { nativeHistoryGroup?: unknown }).nativeHistoryGroup === 'string'
        ? (change as { nativeHistoryGroup: string }).nativeHistoryGroup
        : undefined
      latestNativeChange = change
      if (disposed || terminalError !== undefined) return 'unsupported'
      if (composing && compositionNeedsRebase && reconcileOrdinaryEdit !== undefined) {
        return this.acceptTracked(change, reconcileOrdinaryEdit, true)
      }
      if (historyIsPending() && !composing) {
        const edit = decodeNativeEdit(change)
        if (edit === undefined) {
          fault('Core Muya pending history input cannot be mapped')
          return 'unsupported'
        }
        const annotated = currentBindings.some(item => item.annotationContext === true &&
          item.sourceRange.start <= edit.end && item.sourceRange.end >= edit.start)
        if (annotated && reconcileOrdinaryEdit !== undefined) {
          installAppliedEdit(edit)
          return enqueueTracked(edit, reconcileOrdinaryEdit, undefined, true, nativeHistoryGroup, nativeMuyaTextEdit(change) !== undefined)
            ? 'accepted'
            : 'unsupported'
        }
        return acceptEdit(edit, true, nativeHistoryGroup) ? 'accepted' : 'unsupported'
      }
      const nativePath = pathOf(change)
      const context = nativePath === undefined ? undefined : bindingByPath.get(nativePath)
      // Structural commands replace native paths. Keep following input as native
      // intent until the acknowledged projection supplies the new source map.
      const semanticPending = active?.kind === 'track' ||
        (active?.kind === 'edit' && active.remapFollowingNative === true) ||
        queued.some(command => command.kind === 'track' ||
          (command.kind === 'edit' && command.remapFollowingNative === true))
      if (reconcileOrdinaryEdit !== undefined && (semanticPending ||
          (nativePath !== undefined && adapters.has(nativePath) && context?.annotationContext === true))) {
        return this.acceptTracked(change, reconcileOrdinaryEdit, true)
      }
      if (
        (active !== undefined && active.kind !== 'edit') ||
        queued.some(command => command.kind !== 'edit')
      ) {
        fault('Core Muya input arrived during history reconciliation')
        return 'unsupported'
      }
      const key = pathOf(change)
      const blockIndex = change !== null && typeof change === 'object' &&
        Array.isArray((change as { readonly op?: unknown }).op)
        ? (change as { readonly op: readonly unknown[] }).op[0]
        : undefined
      if (Number.isSafeInteger(blockIndex)) {
        const mathBinding = mathBindingByBlock.get(blockIndex as number)
        if (mathBinding !== undefined) {
          const result = sourceEditForMuyaMathTextChange(mathBinding, change)
          if (result === undefined) {
            fault('Core Muya math operation-shape is unsupported')
            return 'unsupported'
          }
          if (!acceptEdit(result.edit, true, nativeHistoryGroup)) return 'unsupported'
          mathBindingByBlock.set(blockIndex as number, result.binding)
          return 'accepted'
        }
      }
      const adapter = adapterForPath(key)
      if (adapter === undefined) {
        const crossParagraph = sourceEditForMuyaCrossParagraphChange(currentBindings, change)
        const paragraphPaste = sourceEditForMuyaTwoParagraphPaste(currentBindings, change)
        const paragraphEdit = crossParagraph ?? paragraphPaste
        if (paragraphEdit !== undefined && currentBindings.some(item =>
          item.annotationContext === true && item.sourceRange.start <= paragraphEdit.end &&
          item.sourceRange.end >= paragraphEdit.start
        )) {
          return reconcileOrdinaryEdit === undefined
            ? 'unsupported'
            : this.acceptTracked(change, reconcileOrdinaryEdit, true)
        }
        const entered = sourceEditForMuyaStructuralEnter(currentBindings, change)
        if (entered !== undefined) {
          installBindings(entered.bindings)
          return enqueue(entered.edit, false, nativeHistoryGroup) ? 'accepted' : 'unsupported'
        }
        const math = paragraphMathEdit(change, bindingByBlock)
        if (math !== undefined) {
          if (!acceptEdit(math.edit, false, nativeHistoryGroup)) return 'unsupported'
          mathBindingByBlock.set(math.binding.blockIndex, math.binding)
          adapters.delete(JSON.stringify([math.binding.blockIndex, 'text']))
          bindingByBlock.delete(math.binding.blockIndex)
          return 'accepted'
        }
        const structuralEdit = paragraphBlockquoteEdit(change, bindingByBlock) ??
          paragraphHeadingEdit(change, bindingByBlock) ??
          paragraphTableEdit(change, bindingByBlock) ??
          paragraphPaste ??
          crossParagraph ??
          sourceEditForMuyaStructuralChange(currentBindings, change, MAXIMUM_PENDING_INSERT_UNITS - pendingInsertUnits)
        if (structuralEdit !== undefined) {
          const operation = change !== null && typeof change === 'object'
            ? (change as { op?: unknown }).op
            : undefined
          if (Array.isArray(operation) && operation.length === 2 &&
              typeof operation[0] === 'number' && structuralEdit.insert === '\n\n') {
            const index = operation[0]
            const next = currentBindings.map(item => {
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
      if (composing) compositionChange = composeMuyaNativeTextChange(compositionChange, change)
      return acceptEdit(result.edit, true, nativeHistoryGroup) ? 'accepted' : 'unsupported'
    },
    acceptTracked(
      change: unknown,
      reconcile: (
        outcome: CoreAppliedReply
      ) => Promise<readonly MuyaPlainTextSourceBinding[]>,
      markup = false
    ): 'accepted' | 'unsupported' {
      const nativeHistoryGroup = change !== null && typeof change === 'object' &&
        typeof (change as { nativeHistoryGroup?: unknown }).nativeHistoryGroup === 'string'
        ? (change as { nativeHistoryGroup: string }).nativeHistoryGroup
        : undefined
      latestNativeChange = change
      if (
        disposed || terminalError !== undefined
      ) return 'unsupported'
      if (composing) {
        const nextChange = composeMuyaNativeTextChange(compositionChange, change)
        if (nextChange === undefined) return 'unsupported'
        compositionChange = nextChange
        if (compositionNeedsRebase) {
          const local = nativeMuyaTextEdit(change)
          if (local === undefined || !acceptEdit(local, false)) return 'unsupported'
          compositionTrackReconcile = reconcile
          compositionMarkup = markup
          return 'accepted'
        }
      }
      if (!composing && historyIsPending()) {
        const edit = decodeNativeEdit(change)
        if (edit === undefined) return 'unsupported'
        installAppliedEdit(edit)
        return enqueueTracked(edit, reconcile, undefined, markup, nativeHistoryGroup, nativeMuyaTextEdit(change) !== undefined)
          ? 'accepted'
          : 'unsupported'
      }
      if (!composing && (active !== undefined || queued.length > 0)) {
        const local = nativeMuyaTextEdit(change) ?? nativeMuyaStructuralDraft(change, MAXIMUM_PENDING_INSERT_UNITS - pendingInsertUnits)
        if (local !== undefined) {
          return enqueueTracked(local, reconcile, structuredClone(change), markup, nativeHistoryGroup, nativeMuyaTextEdit(change) !== undefined)
            ? 'accepted'
            : 'unsupported'
        }
      }
      const edit = decodeNativeEdit(change)
      if (edit === undefined) return 'unsupported'
      if (
        edit.start === edit.end && edit.insert.length === 0
      ) return 'unsupported'
      if (composing) {
        if (!acceptEdit(edit, false)) return 'unsupported'
        compositionTrackReconcile ??= reconcile
        compositionMarkup = markup
        return 'accepted'
      }
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
    compositionStart(): void {
      if (disposed) throw new Error('Core Muya adapter is disposed')
      if (terminalError !== undefined) throw terminalError
      if (composing) throw new Error('Core Muya composition is already active')
      composing = true
      compositionEdit = undefined
      compositionChange = undefined
      compositionReconciliation = undefined
      compositionNeedsRebase = active !== undefined || queued.length > 0
      compositionMarkup = false
      compositionTrackReconcile = undefined
      let resolveBarrier: (() => void) | undefined
      let rejectBarrier: ((error: Error) => void) | undefined
      const promise = new Promise<void>((resolve, reject) => {
        resolveBarrier = resolve
        rejectBarrier = reject
      })
      compositionBarrier = Object.freeze({
        promise,
        resolve: () => resolveBarrier?.(),
        reject: error => rejectBarrier?.(error)
      })
    },
    async compositionEnd(): Promise<void> {
      if (!composing || compositionBarrier === undefined) {
        throw new Error('Core Muya composition is not active')
      }
      composing = false
      const barrier = compositionBarrier
      const nativeEdit = nativeMuyaTextEdit(compositionChange)
      const cancelled = compositionChange !== undefined && nativeEdit === undefined
      const edit = cancelled ? undefined : compositionEdit
      const trackReconcile = compositionTrackReconcile
      const markup = compositionMarkup
      const deferredChange = compositionNeedsRebase ? compositionChange : undefined
      const finishPresentation = compositionReconciliation
      compositionEdit = undefined
      compositionTrackReconcile = undefined
      compositionChange = undefined
      compositionNeedsRebase = false
      compositionReconciliation = undefined
      try {
        if (edit !== undefined && trackReconcile === undefined) installAppliedEdit(edit)
        if (
          edit !== undefined && !(trackReconcile === undefined
            ? enqueue(edit)
            : enqueueTracked(edit, trackReconcile, deferredChange, markup, undefined, true))
        ) throw terminalError ?? new Error('Core Muya composition exceeds its resource policy')
        if (terminalError !== undefined) throw terminalError
        if (active !== undefined || queued.length > 0) {
          await new Promise<void>((resolve, reject) => {
            waiters.add({ resolve, reject })
          })
        }
        if (edit === undefined && finishPresentation !== undefined) {
          installBindings(await finishPresentation())
        }
        barrier.resolve()
      } catch (error) {
        const failure = error instanceof Error
          ? error
          : new Error('Core Muya composition failed')
        barrier.reject(failure)
        throw failure
      } finally {
        if (compositionBarrier === barrier) compositionBarrier = undefined
      }
    },
    history(
      command: 'undo' | 'redo',
      reconcile: (
        outcome: CoreAppliedReply
      ) => Promise<readonly MuyaPlainTextSourceBinding[]>
    ): Promise<CoreAppliedReply | undefined> {
      if (disposed) return Promise.reject(new Error('Core Muya adapter is disposed'))
      if (terminalError !== undefined) return Promise.reject(terminalError)
      if (composing) {
        return Promise.reject(new Error(
          'Core Muya history cannot run during composition'
        ))
      }
      if (
        queued.length + (active === undefined ? 0 : 1) >=
        MAXIMUM_PENDING_TRANSACTIONS
      ) {
        const failure = new Error('Core Muya pending work exceeds its resource policy')
        fault(failure)
        return Promise.reject(failure)
      }
      return new Promise<CoreAppliedReply | undefined>((resolve, reject) => {
        queued.push(Object.freeze({
          kind: 'history',
          command,
          reconcile,
          resolve,
          reject
        }))
        pump()
      })
    },
    resolve(
      annotation: CoreReviewItemLocator,
      authoredRevision: number,
      decision: CoreReviewDecision,
      reconcile: (
        outcome: CoreAppliedReply
      ) => Promise<readonly MuyaPlainTextSourceBinding[]>
    ): Promise<CoreAppliedReply | undefined> {
      if (disposed) return Promise.reject(new Error('Core Muya adapter is disposed'))
      if (terminalError !== undefined) return Promise.reject(terminalError)
      if (composing) {
        return Promise.reject(new Error(
          'Core Muya resolution cannot run during composition'
        ))
      }
      if (
        queued.length + (active === undefined ? 0 : 1) >=
        MAXIMUM_PENDING_TRANSACTIONS
      ) {
        const failure = new Error('Core Muya pending work exceeds its resource policy')
        fault(failure)
        return Promise.reject(failure)
      }
      const captured: CoreReviewItemLocator = annotation.kind === 'commented-span'
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
        queued.push(Object.freeze({
          kind: 'resolve',
          annotation: captured,
          authoredRevision,
          decision,
          reconcile,
          resolve,
          reject
        }))
        pump()
      })
    },
    resolveAll(
      decision: 'accept' | 'reject',
      reconcile: (
        outcome: CoreAppliedReply
      ) => Promise<readonly MuyaPlainTextSourceBinding[]>
    ): Promise<CoreAppliedReply | undefined> {
      if (disposed) return Promise.reject(new Error('Core Muya adapter is disposed'))
      if (terminalError !== undefined) return Promise.reject(terminalError)
      if (composing) {
        return Promise.reject(new Error(
          'Core Muya bulk resolution cannot run during composition'
        ))
      }
      if (
        queued.length + (active === undefined ? 0 : 1) >=
        MAXIMUM_PENDING_TRANSACTIONS
      ) {
        const failure = new Error('Core Muya pending work exceeds its resource policy')
        fault(failure)
        return Promise.reject(failure)
      }
      return new Promise<CoreAppliedReply | undefined>((resolve, reject) => {
        queued.push(Object.freeze({
          kind: 'resolve-all',
          decision,
          reconcile,
          resolve,
          reject
        }))
        pump()
      })
    },
    editComment(
      annotation: CoreReviewItemLocator,
      authoredRevision: number,
      text: string,
      reconcile: (
        outcome: CoreAppliedReply
      ) => Promise<readonly MuyaPlainTextSourceBinding[]>
    ): Promise<CoreAppliedReply | undefined> {
      if (disposed) return Promise.reject(new Error('Core Muya adapter is disposed'))
      if (terminalError !== undefined) return Promise.reject(terminalError)
      if (composing) {
        return Promise.reject(new Error(
          'Core Muya Comment editing cannot run during composition'
        ))
      }
      if (
        queued.length + (active === undefined ? 0 : 1) >=
          MAXIMUM_PENDING_TRANSACTIONS ||
        pendingInsertUnits + text.length > MAXIMUM_PENDING_INSERT_UNITS
      ) {
        const failure = new Error('Core Muya pending work exceeds its resource policy')
        fault(failure)
        return Promise.reject(failure)
      }
      const captured: CoreReviewItemLocator = annotation.kind === 'commented-span'
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
        queued.push(Object.freeze({
          kind: 'edit-comment',
          annotation: captured,
          authoredRevision,
          text,
          reconcile,
          resolve,
          reject
        }))
        pendingInsertUnits += text.length
        pump()
      })
    },
    author(
      form: CoreAuthorForm,
      selection: MuyaPlainTextAuthorSelection,
      text: string,
      reconcile: (
        outcome: CoreAppliedReply
      ) => Promise<readonly MuyaPlainTextSourceBinding[]>
    ): Promise<CoreAppliedReply | undefined> {
      if (disposed) return Promise.reject(new Error('Core Muya adapter is disposed'))
      if (terminalError !== undefined) return Promise.reject(terminalError)
      if (composing) {
        return Promise.reject(new Error(
          'Core Muya authoring cannot run during composition'
        ))
      }
      if (
        sourceRangeForSelection(selection) === undefined ||
        (form === 'substitution' && text.length === 0)
      ) {
        return Promise.resolve(undefined)
      }
      if (
        queued.length + (active === undefined ? 0 : 1) >=
          MAXIMUM_PENDING_TRANSACTIONS ||
        pendingInsertUnits + text.length > MAXIMUM_PENDING_INSERT_UNITS
      ) {
        const failure = new Error('Core Muya pending work exceeds its resource policy')
        fault(failure)
        return Promise.reject(failure)
      }
      return new Promise<CoreAppliedReply | undefined>((resolve, reject) => {
        queued.push(Object.freeze({
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
        }))
        pendingInsertUnits += text.length
        pump()
      })
    },
    settled(): Promise<void> {
      if (terminalError !== undefined) return Promise.reject(terminalError)
      if (composing && compositionBarrier !== undefined) {
        return compositionBarrier.promise
      }
      if (active === undefined && queued.length === 0) return Promise.resolve()
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
}
