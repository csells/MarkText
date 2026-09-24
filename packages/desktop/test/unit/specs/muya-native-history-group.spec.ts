// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each(['ordinary', 'tracked'] as const)(
  'preserves the actual native %s typing group across every authority acknowledgement',
  async(lane) => {
    const app = bootBoundMuya('seed\n')
    app.track(lane === 'tracked')
    try {
      const block = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
      if (block == null || !block.isContent()) throw new Error('Missing text')
      block.setCursor(4, 4, true)
      for (const text of 'ABC') {
        const target = app.muya.editor.selection.getSelection()?.anchor.block.domNode
        if (!target?.isConnected) throw new Error('Missing live selection')
        target.dispatchEvent(
          new InputEvent('beforeinput', {
            data: text,
            inputType: 'insertText',
            bubbles: true,
            cancelable: true
          })
        )
        await app.adapter.settled()
      }
      const expected = lane === 'ordinary' ? 'seedABC\n' : 'seed{++ABC++}\n'
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'seed\n' })
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
    } finally {
      app.dispose()
    }
  }
)
