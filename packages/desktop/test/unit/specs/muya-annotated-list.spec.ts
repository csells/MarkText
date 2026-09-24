// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each(
  [
    { lane: 'ordinary', command: 'ul-bullet', prefix: '- ', indent: '  ', selector: 'ul li' },
    { lane: 'tracked', command: 'ul-bullet', prefix: '- ', indent: '  ', selector: 'ul li' },
    { lane: 'ordinary', command: 'ol-order', prefix: '1. ', indent: '   ', selector: 'ol li' },
    { lane: 'tracked', command: 'ol-order', prefix: '1. ', indent: '   ', selector: 'ol li' },
    { lane: 'ordinary', command: 'ul-task', prefix: '- [ ] ', indent: '  ', selector: 'ul li' },
    { lane: 'tracked', command: 'ul-task', prefix: '- [ ] ', indent: '  ', selector: 'ul li' }
  ].flatMap((example) => ['plain', 'plain\nsecond'].map((original) => ({ ...example, original })))
)(
  'keeps $lane native $command conversion editable inside an addition containing $original',
  async({ lane, command, prefix, indent, selector, original }) => {
    const source = `{++${original}++}\n`
    // The model's list command indents continuation lines under the new item marker.
    const text = original.replace('\n', `\n${indent}`)
    const app = bootBoundMuya(source)
    const { muya, binding, adapter, reconcile } = app
    app.track(lane === 'tracked')
    try {
      const first = muya.editor.scrollPage?.firstContentInDescendant()
      if (first == null) throw new Error('Expected paragraph')
      first.setCursor(first.text.length, first.text.length, true)
      muya.updateParagraph(command)
      await adapter.settled()
      expect(muya.domNode.querySelector(selector)).not.toBeNull()
      const converted =
        lane === 'ordinary' ? `${prefix}{++${text}++}\n` : `{++${prefix}${text}++}\n`
      expect(binding.sourceAtBarrier()).toMatchObject({ source: converted })
      const item = muya.editor.scrollPage?.firstContentInDescendant()
      if (item == null) throw new Error('Expected list item')
      const itemEnd = item.text.length
      item.setCursor(itemEnd, itemEnd, true)
      item.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          data: '!',
          inputType: 'insertText',
          bubbles: true,
          cancelable: true
        })
      )
      await adapter.settled()
      expect(binding.sourceAtBarrier()).toMatchObject({
        source: lane === 'ordinary' ? `${prefix}{++${text}!++}\n` : `{++${prefix}${text}!++}\n`
      })
      await adapter.history('undo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: converted })
      const restored = muya.editor.scrollPage?.firstContentInDescendant()
      if (restored == null) throw new Error('Expected restored content')
      restored.setCursor(0, 0, true)
      muya.updateParagraph(command)
      await adapter.settled()
      expect(binding.sourceAtBarrier()).toMatchObject({ source })
      await adapter.history('undo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: converted })
      await adapter.history('undo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.legacyChanges).toEqual([])
    } finally {
      app.dispose()
    }
  }
)
