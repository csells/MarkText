// @vitest-environment jsdom

import { Muya } from '@muyajs/core'
import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'
import {
  muyaActiveFormats,
  muyaInputToModel,
  muyaFormatToModel
} from '@/documentAuthority/muyaModelSelection'
import { reconcileMuyaDocumentView } from '@/documentAuthority/reconcileMuyaDocumentView'
import type { CoreAppliedReply } from '@/documentAuthority/coreProtocol'

it.each([
  { before: 'word', selection: [0, 4], first: '', source: '{--word--}{++Y++}\n' },
  { before: '`word`', selection: [3, 3], first: 'X', source: '{~~`word`~>`woXYrd`~~}\n' },
  { before: 'word', selection: [1, 3], first: 'X', source: 'w{~~or~>XY~~}d\n' },
  { before: 'word', selection: [1, 3], first: '', source: 'w{--or--}{++Y++}d\n' }
])(
  'preserves successive native tracked input when Markup exposes old content ($source)',
  async(fixture) => {
    ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => actor.dispose()
    })
    binding.open({ documentId: 'tracked-queue.md', source: fixture.before + '\n' })
    const view = () => {
      const reply = binding.plainTextViewAtBarrier()
      if (reply.type !== 'plain-text-view' || !('state' in reply.view)) { throw new Error('Expected view') }
      return reply.view
    }
    const initial = view()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const muya = new Muya(host)
    let presentation = createMuyaMarkupPresentationIndex(initial)
    const reconcile = (outcome: CoreAppliedReply) => {
      const current = view()
      presentation = createMuyaMarkupPresentationIndex(current, presentation)
      muya.setInlinePresentation(presentation.render)
      reconcileMuyaDocumentView({
        muya,
        view: current,
        outcome,
        dirtyPaths: presentation.changedPaths,
        applyEditability: () => {}
      })
      return current.bindings
    }
    const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
    try {
      muya.setInlinePresentation(presentation.render)
      muya.init()
      muya.setContent(structuredClone([...initial.state]))
      muya.editor.bindDocumentEditing({
        prepareImage() {
          throw new Error('Unexpected image preparation')
        },
        prepareClipboard() {
          throw new Error('Unexpected async clipboard preparation in this test')
        },
        activeFormats: (selection) => muyaActiveFormats(muya, view(), selection),
        clipboard() {
          throw new Error('Unexpected clipboard action in this input test')
        },
        compositionStart() {
          throw new Error('Unexpected composition in this input test')
        },
        compositionUpdate() {
          throw new Error('Unexpected composition in this input test')
        },
        compositionEnd() {
          throw new Error('Unexpected composition in this input test')
        },
        format: (operation) =>
          adapter.format(muyaFormatToModel(muya, view(), operation, true), reconcile).changed,
        input(operation, present) {
          const result = adapter.input(muyaInputToModel(muya, view(), operation), reconcile, true)
          if (!result.accepted) present()
          expect(result.accepted).toBe(true)
          return result.changed
        }
      })
      const initialBlock = muya.editor.scrollPage?.queryBlock([0, 'text'])
      if (!initialBlock?.isContent()) throw new Error('Missing native leaf')
      initialBlock.setCursor(fixture.selection[0], fixture.selection[1], true)
      // Both real beforeinput events run in one task. The first model result,
      // rather than a fabricated raw replacement, supplies the next selection.
      for (const data of [fixture.first, 'Y']) {
        const selection = muya.getSelection()
        expect(selection).not.toBeNull()
        const target = selection?.focus.block.domNode
        if (target == null) throw new Error('Missing current native selection')
        const input = new InputEvent('beforeinput', {
          inputType: data === '' ? 'deleteContentBackward' : 'insertText',
          data: data === '' ? null : data,
          bubbles: true,
          cancelable: true
        })
        target.dispatchEvent(input)
        expect(input.defaultPrevented).toBe(true)
      }
      muya.flush()
      expect(binding.sourceAtBarrier()).toMatchObject({ source: fixture.source })
      await adapter.settled()
      expect(binding.sourceAtBarrier()).toMatchObject({ source: fixture.source })
      const undone = await adapter.history('undo', reconcile)
      expect(undone?.type).toBe('applied')
      await adapter.history('redo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: fixture.source })
    } finally {
      adapter.dispose()
      binding.dispose()
      muya.destroy()
      muya.domNode.remove()
      host.remove()
      document.getSelection()?.removeAllRanges()
    }
  }
)
