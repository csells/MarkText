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
  muyaActiveFormats,
  muyaFormatToModel,
  muyaClipboardToModel
} from '@/documentAuthority/muyaModelSelection'
import { reconcileMuyaDocumentView } from '@/documentAuthority/reconcileMuyaDocumentView'
import type { CoreAppliedReply } from '@/documentAuthority/coreProtocol'

export const bootBoundMuya = (source: string, options?: EditorCoreOpenInput['options']) => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  binding.open({ documentId: 'bound-editor.md', source, options })
  const view = () => {
    const next = binding.plainTextViewAtBarrier()
    if (next.type !== 'plain-text-view' || !('state' in next.view)) { throw new Error('Expected typed view') }
    return next.view
  }
  const host = document.body.appendChild(document.createElement('div'))
  const muya = new Muya(host)
  let presentation = createMuyaMarkupPresentationIndex(view())
  const reconcile = (outcome: CoreAppliedReply) => {
    const current = view()
    presentation = createMuyaMarkupPresentationIndex(current, presentation)
    muya.setInlinePresentation(presentation.render)
    reconcileMuyaDocumentView({
      muya,
      view: current,
      outcome,
      sourcePosition: adapter.reconciledSourcePosition,
      dirtyPaths: presentation.changedPaths,
      applyEditability: () => {}
    })
    return current.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(view().bindings, binding, undefined, reconcile)
  const legacyChanges: unknown[] = []
  let tracking = false
  muya.eventCenter.on('json-change', (change: unknown) => {
    if (
      change !== null &&
      typeof change === 'object' &&
      (change as { source?: unknown }).source === 'user'
    ) { legacyChanges.push(change) }
  })
  muya.setInlinePresentation(presentation.render)
  muya.init()
  muya.setContent(structuredClone([...view().state]))
  const unexpected = (): never => {
    throw new Error('Unexpected operation in bound editor test')
  }
  muya.editor.bindDocumentEditing({
    prepareImage: unexpected,
    prepareClipboard: unexpected,
    activeFormats: (selection) => muyaActiveFormats(muya, view(), selection),
    clipboard(operation, present) {
      const result = adapter.clipboard(
        muyaClipboardToModel(muya, view(), operation, tracking),
        reconcile
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
      const result = adapter.format(muyaFormatToModel(muya, view(), operation, tracking), reconcile)
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
