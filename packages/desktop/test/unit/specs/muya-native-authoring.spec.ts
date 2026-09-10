// @vitest-environment jsdom

import CodeMirror from '@/codeMirror'
import { createCodeMirrorCoreAdapter } from '@/documentAuthority/codeMirrorCoreAdapter'
import { Muya } from '@muyajs/core'
import { expect, it } from 'vitest'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'
import {
  muyaInputToModel,
  muyaFormatToModel,
  muyaActiveFormats
} from '@/documentAuthority/muyaModelSelection'
import { reconcileMuyaDocumentView } from '@/documentAuthority/reconcileMuyaDocumentView'
import type { CoreAppliedReply } from '@/documentAuthority/coreProtocol'

const unexpectedComposition = () => {
  throw new Error('Unexpected composition in the formatting fixture')
}

const bootAuthoring = (source: string, tracked = false, legacyFallback = false) => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const binding = createEditorCoreBinding(createLocalCoreOwner())
  binding.open({ documentId: 'author-controls.md', source })
  const view = () => {
    const reply = binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) { throw new Error('Missing model view') }
    return reply.view
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
  const formatResults: ReturnType<typeof adapter.format>[] = []
  const legacyChanges: unknown[] = []
  muya.eventCenter.on('json-change', (change: unknown) => {
    if (
      change !== null &&
      typeof change === 'object' &&
      (change as { source?: unknown }).source === 'user'
    ) {
      legacyChanges.push(change)
      if (legacyFallback) adapter.accept(change)
    }
  })
  muya.setInlinePresentation(presentation.render)
  muya.init()
  muya.setContent(structuredClone([...view().state]))
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
    compositionStart: unexpectedComposition,
    compositionUpdate: unexpectedComposition,
    compositionEnd: unexpectedComposition,
    format: (operation) => {
      const result = adapter.format(muyaFormatToModel(muya, view(), operation, tracked), reconcile)
      formatResults.push(result)
      return result.changed
    },
    input(operation, present) {
      const result = adapter.input(muyaInputToModel(muya, view(), operation), reconcile, tracked)
      if (!result.accepted) present()
      return result.changed
    }
  })
  return {
    muya,
    binding,
    adapter,
    reconcile,
    view,
    formatResults,
    legacyChanges,
    dispose() {
      adapter.dispose()
      binding.dispose()
      muya.destroy()
      host.remove()
      document.getSelection()?.removeAllRanges()
    }
  }
}

it.each([
  { form: 'highlight', text: '', authored: '{==aaa==}\n', typed: '{==X==}\n', start: 0, end: 3 },
  { form: 'addition', text: '', authored: '{++aaa++}\n', typed: '{++X++}\n', start: 0, end: 3 },
  {
    form: 'comment',
    text: 'note',
    authored: '{==aaa==}{>>note<<}\n',
    typed: '{==X==}{>>note<<}\n',
    start: 0,
    end: 3
  },
  {
    form: 'substitution',
    text: 'bbb',
    authored: '{~~aaa~>bbb~~}\n',
    typed: '{~~aaa~>X~~}\n',
    start: 3,
    end: 6
  }
] as const)(
  'retains selected repeated text after authoring $form before the next native input',
  async({ form, text, authored, typed, start, end }) => {
    const app = bootAuthoring('aaa\n')
    try {
      const block = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Missing native paragraph')
      block.setCursor(0, 3, true)
      const selection = app.muya.getSelection()
      if (!selection) throw new Error('Missing actual selected text')
      await app.adapter.author(form, selection, text, app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: authored })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: start },
        focus: { offset: end }
      })
      const target = app.muya.getSelection()?.focus.block.domNode
      if (!target) throw new Error('Missing native input target')
      target.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: authored })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: start },
        focus: { offset: end }
      })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'aaa\n' })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 3 } })
    } finally {
      app.dispose()
    }
  }
)

it.each(['highlight', 'addition'] as const)(
  'retains %s author selection through Source handoff and undo before typing',
  async(form) => {
    const app = bootAuthoring('aaa\n')
    try {
      const block = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Missing paragraph')
      block.setCursor(0, 3, true)
      const selection = app.muya.getSelection()
      if (!selection) throw new Error('Missing author selection')
      await app.adapter.author(form, selection, '', app.reconcile)
      await app.adapter.settled()
      app.adapter.dispose()
      const saved = app.binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Missing saved source')
      const doc = new CodeMirror.Doc(saved.source)
      const source = createCodeMirrorCoreAdapter(doc, app.binding, {
        canonicalSource: saved.source,
        insertedLineEnding: '\n'
      })
      try {
        await source.history('undo')
        expect(doc.getValue()).toBe('aaa\n')
        expect(doc.listSelections()).toMatchObject([
          { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 3 } }
        ])
        doc.replaceSelection('X', 'end', '+input')
        await source.settled()
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'X\n' })
      } finally {
        source.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)
