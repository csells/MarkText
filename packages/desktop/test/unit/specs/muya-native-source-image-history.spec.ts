// @vitest-environment jsdom

import { Muya } from '@muyajs/core'
import { afterEach, beforeEach, expect, it } from 'vitest'
import CodeMirror from '@/codeMirror'
import { createCodeMirrorCoreAdapter } from '@/documentAuthority/codeMirrorCoreAdapter'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'
import { muyaInputToModel, muyaActiveFormats } from '@/documentAuthority/muyaModelSelection'
import { reconcileMuyaDocumentView } from '@/documentAuthority/reconcileMuyaDocumentView'
import type { CoreAppliedReply } from '@/documentAuthority/coreProtocol'

const unexpectedAction = () => {
  throw new Error('Unexpected action in the history fixture')
}

const bootMarkup = (binding: ReturnType<typeof createEditorCoreBinding>) => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
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
      applyEditability: (bindings) =>
        muya.setEditablePaths(
          bindings.filter((item) => item.editable !== false).map((item) => item.path)
        )
    })
    return current.bindings
  }
  const adapter = createMuyaPlainTextCoreAdapter(view().bindings, binding, undefined, reconcile)
  muya.setInlinePresentation(presentation.render)
  muya.init()
  muya.setContent(structuredClone([...view().state]))
  muya.editor.bindDocumentEditing({
    prepareImage: unexpectedAction,
    prepareClipboard: unexpectedAction,
    activeFormats: (selection) => muyaActiveFormats(muya, view(), selection),
    clipboard: unexpectedAction,
    compositionStart: unexpectedAction,
    compositionUpdate: unexpectedAction,
    compositionEnd: unexpectedAction,
    format: unexpectedAction,
    input(operation, present) {
      const result = adapter.input(muyaInputToModel(muya, view(), operation), reconcile, false)
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
    dispose() {
      adapter.dispose()
      binding.dispose()
      muya.destroy()
      host.remove()
      document.getSelection()?.removeAllRanges()
    }
  }
}

const rect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
const rects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
beforeEach(() =>
  Object.defineProperties(Range.prototype, {
    getBoundingClientRect: { configurable: true, value: () => new DOMRect(0, 0, 10, 20) },
    getClientRects: { configurable: true, value: () => [new DOMRect(0, 0, 10, 20)] }
  })
)
afterEach(() => {
  for (const [name, descriptor] of [
    ['getBoundingClientRect', rect],
    ['getClientRects', rects]
  ] as const) {
    if (descriptor === undefined) Reflect.deleteProperty(Range.prototype, name)
    else Object.defineProperty(Range.prototype, name, descriptor)
  }
})

it.each([
  { source: '![aaa](url)\n', labelStart: 2 },
  { source: '| ![aaa](url) | b |\n| --- | --- |\n| x | y |\n', labelStart: 4 }
])(
  'restores an editable native selection after Source image-label replacement in $source',
  async({ source, labelStart }) => {
    const binding = createEditorCoreBinding(createLocalCoreOwner())
    binding.open({ documentId: 'source-native-image.md', source })
    const sourceHost = document.body.appendChild(document.createElement('div'))
    const cm = CodeMirror(sourceHost, { value: source, mode: null })
    const sourceAdapter = createCodeMirrorCoreAdapter(cm.getDoc(), binding, {
      canonicalSource: source,
      insertedLineEnding: '\n'
    })
    cm.setSelection({ line: 0, ch: labelStart }, { line: 0, ch: labelStart + 3 })
    cm.replaceSelection('bbb', 'end', '+input')
    await sourceAdapter.settled()
    expect(binding.sourceAtBarrier()).toMatchObject({ source: source.replace('aaa', 'bbb') })
    sourceAdapter.dispose()
    sourceHost.remove()
    const native = bootMarkup(binding)
    try {
      await native.adapter.history('undo', native.reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source })
      const selection = native.muya.editor.selection.getDOMSelection()
      expect(selection).not.toBeNull()
      if (!selection) throw new Error('Missing restored model history selection')
      expect(selection.anchor.offset).toBe(2)
      expect(selection.focus.offset).toBe(5)
      const element =
        selection.focus.node instanceof Element
          ? selection.focus.node
          : selection.focus.node.parentElement
      expect(
        element?.closest('[contenteditable="false"], .mu-hide'),
        'restored source selection must receive native keyboard input'
      ).toBeNull()
      const content = native.muya.getSelection()?.focus.block
      if (!content?.isContent()) throw new Error('Missing editable image label')
      content.domNode.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'X', bubbles: true, cancelable: true })
      )
      const input = new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'X',
        bubbles: true,
        cancelable: true
      })
      content.domNode.dispatchEvent(input)
      expect(input.defaultPrevented).toBe(true)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: source.replace('aaa', 'X') })
      const next = native.muya.editor.selection.getDOMSelection()
      if (!next) throw new Error('Missing image-label caret after input')
      const nextElement =
        next.focus.node instanceof Element ? next.focus.node : next.focus.node.parentElement
      expect(
        nextElement?.closest('[contenteditable="false"], .mu-hide'),
        'next image-label key must remain editable'
      ).toBeNull()
      await native.adapter.history('undo', native.reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source })
      const block = native.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Missing native paragraph')
      block.setCursor(block.text.length, block.text.length, true)
      expect(block.domNode?.querySelectorAll('.mu-inline-image')).toHaveLength(1)
      const outside = native.muya.editor.selection.getDOMSelection()?.focus
      const outsideElement =
        outside?.node instanceof Element ? outside.node : outside?.node.parentElement
      expect(outsideElement?.closest('[contenteditable="false"], .mu-hide')).toBeNull()
    } finally {
      native.dispose()
    }
  }
)
