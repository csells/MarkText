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

export const bootBoundMuya = (source: string, options?: EditorCoreOpenInput['options']) => {
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
    }
  }
}
