// @vitest-environment happy-dom
import { Muya } from '@muyajs/core'
import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'

it.each(
  [
    { lane: 'ordinary', command: 'ul-bullet', prefix: '- ', selector: 'ul li' },
    { lane: 'tracked', command: 'ul-bullet', prefix: '- ', selector: 'ul li' },
    { lane: 'ordinary', command: 'ol-order', prefix: '1. ', selector: 'ol li' },
    { lane: 'tracked', command: 'ol-order', prefix: '1. ', selector: 'ol li' },
    { lane: 'ordinary', command: 'ul-task', prefix: '- [ ] ', selector: 'ul li' },
    { lane: 'tracked', command: 'ul-task', prefix: '- [ ] ', selector: 'ul li' }
  ].flatMap((example) => ['plain', 'plain\nsecond'].map((text) => ({ ...example, text })))
)(
  'keeps $lane native $command conversion editable inside an addition containing $text',
  async({ lane, command, prefix, selector, text }) => {
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => {}
    })
    await binding.open({ documentId: 'native-list.md', source: `{++${text}++}\n` })
    const initial = binding.plainTextViewAtBarrier()
    if (initial.type !== 'plain-text-view' || !('state' in initial.view)) { throw new Error('Expected typed view') }
    const host = document.createElement('div')
    document.body.append(host)
    const muya = new Muya(host)
    muya.init()
    muya.setContent(structuredClone([...initial.view.state]) as Parameters<Muya['setContent']>[0])
    const reconcile = () => {
      const next = binding.plainTextViewAtBarrier()
      if (next.type !== 'plain-text-view' || !('state' in next.view)) { throw new Error('Expected typed view') }
      if (!adapter.hasPendingEdits()) {
        muya.setContent(structuredClone([...next.view.state]) as Parameters<Muya['setContent']>[0])
      }
      return next.view.bindings
    }
    const adapter = createMuyaPlainTextCoreAdapter(
      initial.view.bindings,
      binding,
      undefined,
      reconcile
    )
    const admissions: string[] = []
    muya.eventCenter.on('json-change', (change: unknown) => {
      admissions.push(
        lane === 'tracked' ? adapter.acceptTracked(change, reconcile) : adapter.accept(change)
      )
    })
    try {
      const first = muya.editor.scrollPage?.firstContentInDescendant()
      if (first == null) throw new Error('Expected paragraph')
      muya.editor.activeContentBlock = first
      first.setCursor(first.text.length, first.text.length)
      muya.updateParagraph(command)
      muya.flush()
      expect(admissions).toEqual(['accepted'])
      await adapter.settled()
      expect(muya.domNode.querySelector(selector)).not.toBeNull()
      const item = muya.editor.scrollPage?.firstContentInDescendant()
      if (item == null) throw new Error('Expected list item')
      muya.editor.activeContentBlock = item
      item.domNode.textContent = text + '!'
      item.setCursor(text.length + 1, text.length + 1)
      item.inputHandler(
        new InputEvent('input', { data: '!', inputType: 'insertText', bubbles: true })
      )
      muya.flush()
      await adapter.settled()
      expect(admissions).toEqual(['accepted', 'accepted'])
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source: lane === 'ordinary' ? `${prefix}{++${text}!++}\n` : `{++${prefix}${text}!++}\n`
      })
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source: lane === 'ordinary' ? `${prefix}{++${text}++}\n` : `{++${prefix}${text}++}\n`
      })
      const restored = muya.editor.scrollPage?.firstContentInDescendant()
      if (restored == null) throw new Error('Expected restored content')
      muya.editor.activeContentBlock = restored
      restored.setCursor(0, 0)
      muya.updateParagraph(command)
      muya.flush()
      expect(admissions).toEqual(['accepted', 'accepted', 'accepted'])
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: `{++${text}++}\n` })
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source: lane === 'ordinary' ? `${prefix}{++${text}++}\n` : `{++${prefix}${text}++}\n`
      })
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: `{++${text}++}\n` })
    } finally {
      adapter.dispose()
      muya.destroy()
      muya.domNode.remove()
    }
  }
)
