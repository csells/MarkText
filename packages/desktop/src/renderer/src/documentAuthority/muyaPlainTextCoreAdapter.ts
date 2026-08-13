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
import {
  createMuyaPlainTextSourceEditAdapter,
  sourceEditForMuyaCrossParagraphChange,
  sourceEditForMuyaMathTextChange,
  sourceEditForMuyaTwoParagraphPaste,
  type MuyaMathSourceBinding,
  type MuyaPlainTextSourceBinding
} from './muyaPlainTextSourceEdit'
import { canonicalSourceForMuyaTable } from './muyaTableSourceCodec'

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

export interface MuyaPlainTextCoreAdapter {
  accept(change: unknown): 'accepted' | 'unsupported'
  acceptTracked(
    change: unknown,
    reconcile: (
      outcome: CoreAppliedReply
    ) => Promise<readonly MuyaPlainTextSourceBinding[]>
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
  author(
    form: CoreAuthorForm,
    selection: MuyaPlainTextAuthorSelection,
    text: string,
    reconcile: (
      outcome: CoreAppliedReply
    ) => Promise<readonly MuyaPlainTextSourceBinding[]>
  ): Promise<CoreAppliedReply | undefined>
  settled(): Promise<void>
  state(): MuyaPlainTextCoreAdapterState
  dispose(): void
}

const MAXIMUM_PENDING_TRANSACTIONS = 128
const MAXIMUM_PENDING_INSERT_UNITS = 4 * 1024 * 1024

type PendingCommand = Readonly<{
  readonly kind: 'edit'
  readonly edit: DocumentSourceEdit
}> | Readonly<{
  readonly kind: 'track'
  readonly edit: DocumentSourceEdit
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
}>

const pathOf = (change: unknown): string | undefined => {
  if (change === null || typeof change !== 'object') return undefined
  const operation = (change as { readonly op?: unknown }).op
  if (!Array.isArray(operation) || operation.length < 2) return undefined
  return `${String(operation[0])}:${String(operation[1])}`
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
  if (!inserted.text.startsWith(prefix) || inserted.text.length === prefix.length) {
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
  return Object.freeze({
    start: binding.sourceRange.start,
    end: binding.sourceRange.end,
    insert: inserted.text
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
  if (sourceBinding === undefined) return undefined
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
  if (sourceBinding === undefined) return undefined
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
  binding: Pick<EditorCoreBinding, 'submit'>
): MuyaPlainTextCoreAdapter {
  const adapters = new Map<string, ReturnType<
    typeof createMuyaPlainTextSourceEditAdapter
  >>()
  const bindingByBlock = new Map<number, MuyaPlainTextSourceBinding>()
  const mathBindingByBlock = new Map<number, MuyaMathSourceBinding>()
  let currentBindings: readonly MuyaPlainTextSourceBinding[] = Object.freeze([])
  const queued: PendingCommand[] = []
  const waiters = new Set<{
    readonly resolve: () => void
    readonly reject: (error: Error) => void
  }>()
  let active: PendingCommand | undefined
  let disposed = false
  let pendingInsertUnits = 0
  let revision = 1
  let terminalError: Error | undefined
  let composing = false
  let compositionEdit: DocumentSourceEdit | undefined
  let compositionTrackReconcile: ((
    outcome: CoreAppliedReply
  ) => Promise<readonly MuyaPlainTextSourceBinding[]>) | undefined
  let compositionBarrier: Readonly<{
    readonly promise: Promise<void>
    readonly resolve: () => void
    readonly reject: (error: Error) => void
  }> | undefined

  const installBindings = (
    nextBindings: readonly MuyaPlainTextSourceBinding[]
  ): void => {
    const nextAdapters = new Map<string, ReturnType<
      typeof createMuyaPlainTextSourceEditAdapter
    >>()
    const nextByBlock = new Map<number, MuyaPlainTextSourceBinding>()
    for (const item of nextBindings) {
      const key = `${String(item.path[0])}:${item.path[1]}`
      if (nextAdapters.has(key) || nextByBlock.has(item.path[0])) {
        throw new Error('Core Muya projection contains duplicate bindings')
      }
      try {
        nextAdapters.set(key, createMuyaPlainTextSourceEditAdapter(item))
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
      nextByBlock.set(item.path[0], item)
    }
    adapters.clear()
    for (const [key, adapter] of nextAdapters) adapters.set(key, adapter)
    bindingByBlock.clear()
    for (const [blockIndex, item] of nextByBlock) {
      bindingByBlock.set(blockIndex, item)
    }
    mathBindingByBlock.clear()
    currentBindings = Object.freeze([...nextBindings])
  }
  installBindings(bindings)

  const installAppliedEdit = (edit: DocumentSourceEdit): void => {
    const ownerIndex = currentBindings.findIndex(item =>
      edit.start >= item.sourceRange.start &&
      edit.end <= item.sourceRange.end
    )
    if (ownerIndex < 0) return
    const delta = edit.insert.length - (edit.end - edit.start)
    const nextBindings = currentBindings.map((item, index) => {
      if (index === ownerIndex) {
        const localStart = edit.start - item.sourceRange.start
        const localEnd = edit.end - item.sourceRange.start
        return Object.freeze({
          path: item.path,
          sourceRange: Object.freeze({
            start: item.sourceRange.start,
            end: item.sourceRange.end + delta
          }),
          text: item.text.slice(0, localStart) + edit.insert + item.text.slice(localEnd)
        })
      }
      if (item.sourceRange.start >= edit.end) {
        return Object.freeze({
          path: item.path,
          sourceRange: Object.freeze({
            start: item.sourceRange.start + delta,
            end: item.sourceRange.end + delta
          }),
          text: item.text
        })
      }
      return item
    })
    installBindings(Object.freeze(nextBindings))
  }

  const sourceRangeForSelection = (
    selection: MuyaPlainTextAuthorSelection
  ): Readonly<{ readonly start: number; readonly end: number }> | undefined => {
    const samePath = (
      left: readonly (string | number)[],
      right: readonly (string | number)[]
    ): boolean => left.length === right.length &&
      left.every((part, index) => part === right[index])
    const anchorBinding = currentBindings.find(item =>
      samePath(item.path, selection.anchor.path)
    )
    const focusBinding = currentBindings.find(item =>
      samePath(item.path, selection.focus.path)
    )
    if (
      anchorBinding === undefined || focusBinding === undefined ||
      anchorBinding !== focusBinding ||
      !Number.isSafeInteger(selection.anchor.offset) ||
      !Number.isSafeInteger(selection.focus.offset) ||
      selection.anchor.offset < 0 || selection.focus.offset < 0 ||
      selection.anchor.offset > anchorBinding.text.length ||
      selection.focus.offset > anchorBinding.text.length
    ) return undefined
    const startOffset = Math.min(selection.anchor.offset, selection.focus.offset)
    const endOffset = Math.max(selection.anchor.offset, selection.focus.offset)
    if (startOffset === endOffset) return undefined
    return Object.freeze({
      start: anchorBinding.sourceRange.start + startOffset,
      end: anchorBinding.sourceRange.start + endOffset
    })
  }

  const resolveWaiters = (): void => {
    if (active !== undefined || queued.length > 0) return
    for (const waiter of waiters) waiter.resolve()
    waiters.clear()
  }
  const fault = (message: string | Error): void => {
    if (terminalError !== undefined) return
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
    if (command.kind === 'author') pendingInsertUnits -= command.text.length
    active = command
    const authorRange = command.kind === 'author'
      ? sourceRangeForSelection(command.selection)
      : undefined
    if (command.kind === 'author' && authorRange === undefined) {
      active = undefined
      command.resolve(undefined)
      pump()
      return
    }
    let acknowledged
    try {
      acknowledged = binding.submit(command.kind === 'edit'
        ? Object.freeze({
          edits: Object.freeze([Object.freeze({ ...command.edit })]),
          projections: Object.freeze([])
        })
        : command.kind === 'track'
          ? Object.freeze({
            kind: 'track' as const,
            range: Object.freeze({
              start: command.edit.start,
              end: command.edit.end
            }),
            text: command.edit.insert,
            projections: Object.freeze([])
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
              : Object.freeze({
                kind: 'author' as const,
                form: command.form,
                range: authorRange!,
                text: command.text,
                projections: Object.freeze([])
              })).acknowledged
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
      if (command.kind !== 'edit') {
        try {
          const nextBindings = await command.reconcile(outcome)
          if (disposed) throw new Error('Core Muya adapter is disposed')
          installBindings(nextBindings)
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
      active = undefined
      pump()
    }, error => {
      active = undefined
      if (disposed) return
      const failure = error instanceof Error
        ? error
        : new Error('Core submission failed')
      if (command.kind !== 'edit') command.reject(failure)
      fault(failure)
    })
  }
  const enqueue = (edit: DocumentSourceEdit): boolean => {
    if (
      queued.length + (active === undefined ? 0 : 1) >=
        MAXIMUM_PENDING_TRANSACTIONS ||
      pendingInsertUnits + edit.insert.length > MAXIMUM_PENDING_INSERT_UNITS
    ) {
      fault('Core Muya pending work exceeds its resource policy')
      return false
    }
    queued.push(Object.freeze({ kind: 'edit', edit }))
    pendingInsertUnits += edit.insert.length
    pump()
    return true
  }
  const acceptEdit = (
    edit: DocumentSourceEdit,
    retainPlainBindings = true
  ): boolean => {
    if (!composing) {
      if (retainPlainBindings) installAppliedEdit(edit)
      else installBindings(Object.freeze([]))
      return enqueue(edit)
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
    ) => Promise<readonly MuyaPlainTextSourceBinding[]>
  ): boolean => {
    if (
      queued.length + (active === undefined ? 0 : 1) >=
        MAXIMUM_PENDING_TRANSACTIONS ||
      pendingInsertUnits + edit.insert.length > MAXIMUM_PENDING_INSERT_UNITS
    ) return false
    queued.push(Object.freeze({
      kind: 'track',
      edit,
      reconcile,
      resolve: () => {},
      reject: () => {}
    }))
    pendingInsertUnits += edit.insert.length
    pump()
    return true
  }

  return Object.freeze({
    accept(change: unknown): 'accepted' | 'unsupported' {
      if (disposed || terminalError !== undefined) return 'unsupported'
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
          if (!acceptEdit(result.edit)) return 'unsupported'
          mathBindingByBlock.set(blockIndex as number, result.binding)
          return 'accepted'
        }
      }
      const adapter = key === undefined ? undefined : adapters.get(key)
      if (adapter === undefined) {
        const math = paragraphMathEdit(change, bindingByBlock)
        if (math !== undefined) {
          if (!acceptEdit(math.edit, false)) return 'unsupported'
          mathBindingByBlock.set(math.binding.blockIndex, math.binding)
          adapters.delete(`${String(math.binding.blockIndex)}:text`)
          bindingByBlock.delete(math.binding.blockIndex)
          return 'accepted'
        }
        const structuralEdit = paragraphHeadingEdit(change, bindingByBlock) ??
          paragraphTableEdit(change, bindingByBlock) ??
          sourceEditForMuyaTwoParagraphPaste(currentBindings, change) ??
          sourceEditForMuyaCrossParagraphChange(currentBindings, change)
        if (structuralEdit !== undefined) {
          return acceptEdit(structuralEdit, false) ? 'accepted' : 'unsupported'
        }
        fault('Core Muya operation-shape is unsupported')
        return 'unsupported'
      }
      const result = adapter.accept(change)
      if (result.kind !== 'edit') {
        fault(`Core Muya ${result.reason} is unsupported`)
        return 'unsupported'
      }
      return acceptEdit(result.edit) ? 'accepted' : 'unsupported'
    },
    acceptTracked(
      change: unknown,
      reconcile: (
        outcome: CoreAppliedReply
      ) => Promise<readonly MuyaPlainTextSourceBinding[]>
    ): 'accepted' | 'unsupported' {
      if (
        disposed || terminalError !== undefined ||
        active !== undefined || queued.length > 0
      ) return 'unsupported'
      const key = pathOf(change)
      const sourceAdapter = key === undefined ? undefined : adapters.get(key)
      const edit = sourceAdapter === undefined
        ? paragraphMathEdit(change, bindingByBlock)?.edit ??
          paragraphHeadingEdit(change, bindingByBlock) ??
          paragraphTableEdit(change, bindingByBlock) ??
          sourceEditForMuyaTwoParagraphPaste(currentBindings, change) ??
          sourceEditForMuyaCrossParagraphChange(currentBindings, change)
        : (() => {
          const result = sourceAdapter.accept(change)
          return result.kind === 'edit'
            ? result.edit
            : paragraphMathEdit(change, bindingByBlock)?.edit ??
                paragraphHeadingEdit(change, bindingByBlock) ??
                paragraphTableEdit(change, bindingByBlock) ??
                sourceEditForMuyaTwoParagraphPaste(currentBindings, change)
        })()
      if (edit === undefined) return 'unsupported'
      if (
        edit.start === edit.end && edit.insert.length === 0
      ) return 'unsupported'
      if (composing) {
        if (!acceptEdit(edit, false)) return 'unsupported'
        compositionTrackReconcile ??= reconcile
        return 'accepted'
      }
      return enqueueTracked(edit, reconcile) ? 'accepted' : 'unsupported'
    },
    compositionStart(): void {
      if (disposed) throw new Error('Core Muya adapter is disposed')
      if (terminalError !== undefined) throw terminalError
      if (composing) throw new Error('Core Muya composition is already active')
      composing = true
      compositionEdit = undefined
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
      const edit = compositionEdit
      const trackReconcile = compositionTrackReconcile
      compositionEdit = undefined
      compositionTrackReconcile = undefined
      try {
        if (edit !== undefined && trackReconcile === undefined) installAppliedEdit(edit)
        if (
          edit !== undefined && !(trackReconcile === undefined
            ? enqueue(edit)
            : enqueueTracked(edit, trackReconcile))
        ) throw terminalError ?? new Error('Core Muya composition exceeds its resource policy')
        if (terminalError !== undefined) throw terminalError
        if (active !== undefined || queued.length > 0) {
          await new Promise<void>((resolve, reject) => {
            waiters.add({ resolve, reject })
          })
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
      if (sourceRangeForSelection(selection) === undefined || text.length === 0) {
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
