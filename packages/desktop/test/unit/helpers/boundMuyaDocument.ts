// @vitest-environment jsdom
import { Muya } from '@muyajs/core'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import {
  createEditorCoreBinding,
  type EditorCoreOpenInput
} from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'
import {
  muyaInputToModel,
  muyaCaretStep,
  muyaBackspaceRemovesGrapheme,
  muyaCodeLanguage,
  muyaEmojiContext,
  muyaActiveFormats,
  muyaFormatToModel,
  muyaClipboardToModel,
  muyaClipboardCurrentSelection
} from '@/documentAuthority/muyaModelSelection'
import { reconcileMuyaDocumentView } from '@/documentAuthority/reconcileMuyaDocumentView'
import type { CoreAppliedReply } from '@/documentAuthority/coreProtocol'
import { asMuyaStates } from './muyaTypes'

/**
 * Ends the current macrotask. V8 keeps every WeakRef target alive until the
 * task that created it ends, and jsdom registers each Range it creates by
 * WeakRef on the range's boundary nodes. A loop that boots, edits and disposes
 * editors inside one task therefore keeps every Range alive on document.body,
 * where jsdom walks them all on each later DOM mutation, so each iteration
 * runs slower than the last. Await this between iterations.
 */
export const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve))

type EventListenerArguments = Parameters<EventTarget['addEventListener']>
type WindowListener = { target: EventTarget, listener: EventListenerArguments }

/** Window listeners added while each live editor was booted and running. */
const editorWindowListeners = new Set<WindowListener[]>()

// jsdom gives every Document its own selector engine, which adds capture
// listeners to the one shared window and never removes them. Muya parses each
// HTML preview into a fresh Document and queries it, so in jsdom every preview
// leaves listeners, and the Document they hold, on the window, and every later
// key or focus event walks them all. A browser has no such listeners. The main
// document's engine is created first so that its listeners stay; a disposed
// editor removes every window listener added during its lifetime.
document.documentElement.matches('*')
{
  // The engine holds jsdom's own window object, which is not the test
  // global's window, so listeners are caught where every window inherits them.
  const addEventListener = EventTarget.prototype.addEventListener
  EventTarget.prototype.addEventListener = function(this: EventTarget, ...listener: EventListenerArguments) {
    if (!(this instanceof Node) && (this as Partial<Window>).document === document) {
      for (const listeners of editorWindowListeners) listeners.push({ target: this, listener })
    }
    return addEventListener.apply(this, listener)
  }
}

export const bootBoundMuya = (source: string, options?: EditorCoreOpenInput['options']) => {
  const windowListeners: WindowListener[] = []
  editorWindowListeners.add(windowListeners)
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  binding.open({ documentId: 'bound-editor.md', source, options })
  const view = () => {
    const next = binding.plainTextViewAtBarrier()
    if (next.type !== 'plain-text-view' || !('state' in next.view)) {
      throw new Error('Expected typed view')
    }
    return next.view
  }
  const host = document.body.appendChild(document.createElement('div'))
  const muya = new Muya(host)
  let presentation = createMuyaMarkupPresentationIndex(view())
  const reconcile = (outcome: CoreAppliedReply) => {
    const current = view()
    presentation = createMuyaMarkupPresentationIndex(current, presentation)
    muya.setInlinePresentation(presentation.render)
    // Match the production acknowledgement gate: an already visible native
    // draft must survive until its own model operation has been admitted.
    muya.flush()
    if (adapter.hasPendingEdits()) return current.bindings
    reconcileMuyaDocumentView({
      muya,
      view: current,
      outcome,
      dirtyPaths: presentation.changedPaths,
      applyEditability: () => {}
    })
    return current.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(view().bindings, binding)
  const legacyChanges: unknown[] = []
  let tracking = false
  muya.eventCenter.on('json-change', (change: unknown) => {
    if (
      change !== null &&
      typeof change === 'object' &&
      (change as { source?: unknown }).source === 'user'
    ) {
      legacyChanges.push(change)
    }
  })
  muya.setInlinePresentation(presentation.render)
  muya.init()
  muya.setContent(asMuyaStates(structuredClone([...view().state])))
  const unexpected = (): never => {
    throw new Error('Unexpected operation in bound editor test')
  }
  muya.editor.bindDocumentEditing({
    emojiContext: (point) => muyaEmojiContext(muya, view(), point),
    codeLanguage: (point) => muyaCodeLanguage(muya, view(), point),
    caretStep: (point, direction) => muyaCaretStep(muya, view(), point, direction),
    backspaceRemovesGrapheme: (point) => muyaBackspaceRemovesGrapheme(muya, view(), point),
    prepareImage: unexpected,
    async prepareClipboard(selection, payload, prepare, blockPlacement, historyGroup) {
      const operation =
        'kind' in selection
          ? { kind: 'table' as const, operation: 'paste' as const, selection, markdown: '' }
          : { kind: 'paste' as const, selection, markdown: '' }
      const action = muyaClipboardToModel(muya, view(), operation, tracking)
      if (action.kind !== 'paste' && !(action.kind === 'table' && action.operation === 'paste')) {
        throw new Error('Expected clipboard paste')
      }
      const pending = adapter.prepareClipboard(
        {
          ...action,
          ...(blockPlacement === undefined
            ? {}
            : { blockPlacement, currentSelection: muyaClipboardCurrentSelection(muya, view()) })
        },
        payload,
        reconcile,
        historyGroup
      )
      try {
        const imported = await prepare((payload) => pending.capturePayload(payload))
        const result = await pending.complete(imported.markdown, {
          ...imported,
          currentSelection: () => {
            const selection = muyaClipboardCurrentSelection(muya, view())
            if (!selection && blockPlacement === undefined) {
              throw new Error('Expected current clipboard selection')
            }
            return selection
          }
        })
        return result.changed
      } catch (error) {
        pending.fail(error instanceof Error ? error : new Error(String(error)))
        throw error
      }
    },
    activeFormats: (selection) => muyaActiveFormats(muya, view(), selection),
    clipboard(operation, present) {
      const result = adapter.clipboard(
        muyaClipboardToModel(muya, view(), operation, tracking),
        reconcile,
        operation.historyGroup
      )
      if (!result.accepted) present()
      return result.changed
    },
    compositionStart: (operation) =>
      adapter.compositionStart(muyaInputToModel(muya, view(), operation)),
    compositionUpdate: (data) => adapter.compositionUpdate(data),
    compositionEnd(outcome, present) {
      const result = adapter.compositionEnd(outcome, reconcile, tracking)
      if (!result.accepted) present()
      return result.changed
    },
    format(operation) {
      const result = adapter.format(
        muyaFormatToModel(muya, view(), operation, tracking),
        reconcile,
        operation.historyGroup
      )
      return result.changed
    },
    input(operation, present) {
      const result = adapter.input(muyaInputToModel(muya, view(), operation), reconcile, tracking)
      if (!result.accepted) present()
      return result.changed
    }
  })
  return {
    muya,
    view,
    binding,
    adapter,
    reconcile,
    legacyChanges,
    track: (value: boolean) => {
      tracking = value
    },
    dispose() {
      adapter.dispose()
      binding.dispose()
      muya.destroy()
      host.remove()
      document.getSelection()?.removeAllRanges()
      editorWindowListeners.delete(windowListeners)
      for (const { target, listener } of windowListeners) target.removeEventListener(...listener)
    }
  }
}
