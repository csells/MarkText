// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each(
  ['ordinary', 'tracked'].flatMap((lane) =>
    ['plain', 'plain\nsecond'].map((text) => ({ lane, text }))
  )
)(
  'keeps $lane blockquote conversion editable inside an addition containing $text',
  async({ lane, text }) => {
    const source = `{++${text}++}\n`
    const converted = lane === 'ordinary' ? `> {++${text}++}\n` : `{++> ${text}++}\n`
    const typed = lane === 'ordinary' ? `> {++${text}!++}\n` : `{++> ${text}!++}\n`
    const app = bootBoundMuya(source)
    app.track(lane === 'tracked')
    try {
      const first = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (!first) throw new Error('Expected annotated paragraph')
      app.muya.editor.activeContentBlock = first
      first.setCursor(first.text.length, first.text.length, true)
      app.muya.updateParagraph('blockquote')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: converted })
      expect(app.view().state).toMatchObject([{ name: 'block-quote' }])
      expect(app.muya.domNode.querySelector('blockquote')).not.toBeNull()
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: text.length },
        focus: { offset: text.length }
      })
      const item = app.muya.editor.selection.getSelection()?.anchor.block
      if (!item?.domNode?.isConnected) throw new Error('Expected live quoted paragraph')
      item.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          data: '!',
          inputType: 'insertText',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: converted })
      const restored = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (!restored) throw new Error('Expected restored quote')
      app.muya.editor.activeContentBlock = restored
      restored.setCursor(0, 0, true)
      app.muya.updateParagraph('blockquote')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: converted })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      app.dispose()
    }
  }
)
