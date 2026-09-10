// @vitest-environment jsdom

import { Muya } from '@muyajs/core'
import { createDocumentCore } from '@marktext/document-core'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import type { CoreAppliedReply } from '@/documentAuthority/coreProtocol'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'
import {
  muyaActiveFormats,
  muyaFormatToModel,
  muyaInputToModel
} from '@/documentAuthority/muyaModelSelection'
import { reconcileMuyaDocumentView } from '@/documentAuthority/reconcileMuyaDocumentView'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'

beforeEach(() => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
})

describe('native fence input on the common model', () => {
  it.each([false, true])('preserves typed fence info with Enter=%s', async(enter) => {
    const owner = createLocalCoreOwner()
    const binding = createEditorCoreBinding(owner)
    binding.open({ documentId: 'native-fence.md', source: '\n' })
    const initial = binding.plainTextViewAtBarrier()
    if (initial.type !== 'plain-text-view' || !('state' in initial.view)) { throw new Error('Missing Core view') }
    let currentView = initial.view
    let presentation = createMuyaMarkupPresentationIndex(initial.view)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const muya = new Muya(host, { autoPairMarkdownSyntax: false })
    const reconcile = (outcome: CoreAppliedReply) => {
      const next = binding.plainTextViewAtBarrier()
      if (next.type !== 'plain-text-view' || !('state' in next.view)) { throw new Error('Missing Core view') }
      currentView = next.view
      presentation = createMuyaMarkupPresentationIndex(next.view, presentation)
      muya.setInlinePresentation(presentation.render)
      reconcileMuyaDocumentView({
        muya,
        view: next.view,
        outcome,
        sourcePosition: adapter.reconciledSourcePosition,
        dirtyPaths: presentation.changedPaths,
        applyEditability: () => {}
      })
      return next.view.bindings
    }
    const adapter = createMuyaPlainTextCoreAdapter(
      initial.view.bindings,
      binding,
      undefined,
      reconcile
    )
    const results: string[] = []
    try {
      muya.setInlinePresentation(presentation.render)
      muya.init()
      muya.setContent(structuredClone([...initial.view.state]))
      muya.editor.bindDocumentEditing({
        prepareImage() {
          throw new Error('Unexpected image preparation')
        },
        prepareClipboard() {
          throw new Error('Unexpected async clipboard preparation in this test')
        },
        activeFormats: (selection) => muyaActiveFormats(muya, currentView, selection),
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
        format(operation) {
          return adapter.format(muyaFormatToModel(muya, currentView, operation, false), reconcile)
            .changed
        },
        input(operation, present) {
          const result = adapter.input(muyaInputToModel(muya, currentView, operation), reconcile)
          results.push(result.accepted ? 'accepted' : 'unsupported')
          if (!result.accepted) present()
          return result.changed
        }
      })
      muya.on('json-change', (change: { source: string }) => {
        if (change.source === 'user') results.push(adapter.accept(change))
      })
      const initialBlock = muya.editor.scrollPage?.firstContentInDescendant()
      if (!initialBlock?.domNode) throw new Error('Missing native paragraph')
      muya.editor.activeContentBlock = initialBlock
      initialBlock.setCursor(0, 0)
      let typed = ''
      for (const data of '```js') {
        const block = muya.editor.scrollPage?.firstContentInDescendant()
        if (!block?.domNode) throw new Error('Missing active native content')
        block.domNode.dispatchEvent(
          new KeyboardEvent('keydown', { key: data, bubbles: true, cancelable: true })
        )
        const event = new InputEvent('beforeinput', {
          inputType: 'insertText',
          data,
          bubbles: true,
          cancelable: true
        })
        block.domNode.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        muya.flush()
        typed += data
        expect(binding.sourceAtBarrier()).toMatchObject({ source: typed + '\n' })
        expect(muya.editor.scrollPage?.firstContentInDescendant()?.text).toBe(typed)
        expect(muya.getSelection()).toMatchObject({
          anchor: { offset: typed.length },
          focus: { offset: typed.length }
        })
      }
      expect(results).toEqual(Array(5).fill('accepted'))
      if (enter) {
        const block = muya.editor.scrollPage?.firstContentInDescendant()
        block?.domNode?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        )
        const event = new InputEvent('beforeinput', {
          inputType: 'insertParagraph',
          data: null,
          bubbles: true,
          cancelable: true
        })
        block?.domNode?.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        muya.flush()
      }
      await adapter.settled()
      const expected = enter ? '```js\n\n```\n' : '```js\n'
      expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(muya.getSelection()).toMatchObject({
        anchor: { offset: enter ? 0 : 5 },
        focus: { offset: enter ? 0 : 5 }
      })
      await adapter.history('undo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: enter ? '```js\n' : '\n' })
      await adapter.history('redo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: expected })
      const reopened = createEditorCoreBinding(createLocalCoreOwner())
      try {
        reopened.open({ documentId: 'reopened-fence.md', source: expected })
        expect(reopened.sourceAtBarrier()).toMatchObject({ source: expected })
        const view = reopened.plainTextViewAtBarrier()
        expect(view).toMatchObject({
          type: 'plain-text-view',
          view: {
            state: [{ name: enter ? 'code-block' : 'paragraph', text: enter ? '' : '```js' }]
          }
        })
      } finally {
        reopened.dispose()
      }
    } finally {
      adapter.dispose()
      binding.dispose()
      muya.destroy()
      muya.domNode.remove()
      host.remove()
      document.getSelection()?.removeAllRanges()
    }
  })
})

describe('owned fence opening line presentation', () => {
  it.each([
    { source: '```js', name: 'paragraph', text: '```js' },
    { source: '```js\n', name: 'paragraph', text: '```js' },
    { source: '~~~js\n', name: 'paragraph', text: '~~~js' },
    { source: '```js\n\n', name: 'code-block', text: '' },
    { source: '```js\n```\n', name: 'code-block', text: '' },
    { source: '```js\nbody\n', name: 'code-block', text: 'body' },
    { source: '```js\nbody\n```\n', name: 'code-block', text: 'body' }
  ])('keeps the syntax owner while rendering $source as $name', ({ source, name, text }) => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const projection = core.project(revision, 'markup')
    const view = createMuyaMarkupView(projection, revision.annotations, source)
    expect(view.state).toMatchObject([{ name, text }])
    expect(view.bindings[0]?.syntax.kind).toBe('code-block')
    if (name === 'paragraph') {
      expect(view.bindings[0]?.sourceRange).toEqual({ start: 0, end: text.length })
      expect(view.bindings[0]?.segments).toEqual([
        {
          source: { start: 0, end: text.length },
          text: { start: 0, end: text.length },
          syntax: { start: 0, end: text.length }
        }
      ])
    }
  })
})
