// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each([
  'deleteWordBackward',
  'deleteWordForward',
  'deleteSoftLineBackward',
  'deleteSoftLineForward',
  'deleteHardLineBackward',
  'deleteHardLineForward',
  'deleteEntireSoftLine'
])(
  '%s consumes the explicit browser target and preserves the directed history selection',
  async(inputType) => {
    const source = 'same {++same same++}{>>keep<<}\n'
    const app = bootBoundMuya(source)
    try {
      const leaf = app.muya.editor.scrollPage!.firstContentInDescendant()!
      const walker = document.createTreeWalker(leaf.domNode!, NodeFilter.SHOW_TEXT)
      let text = walker.nextNode()
      while (text && text.textContent !== 'same same') text = walker.nextNode()
      if (!text) throw new Error('Expected annotated repeated words')
      app.muya.editor.selection.setDOMSelection(
        { node: text, offset: 9 },
        { node: text, offset: 5 }
      )
      const dispatch = vi.spyOn(app.muya.editor.documentEditing!, 'input')
      const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true })
      Object.defineProperty(event, 'getTargetRanges', {
        value: () => [{ startContainer: text, startOffset: 5, endContainer: text, endOffset: 9 }]
      })
      leaf.domNode!.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(dispatch).toHaveBeenCalledOnce()
      expect(dispatch.mock.calls[0][0]).toMatchObject({ inputType, data: null })
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: 'same {++same ++}{>>keep<<}\n'
      })
      const input = app.muya.editor.selection.getSelection()!.anchor.block
      input.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: 'same {++same X++}{>>keep<<}\n'
      })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: 14 },
        focus: { offset: 10 }
      })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: 'same {++same X++}{>>keep<<}\n'
      })
    } finally {
      app.dispose()
    }
  }
)

it.each([
  { key: 'Backspace', altKey: true },
  { key: 'Backspace', ctrlKey: true },
  { key: 'Backspace', metaKey: true },
  { key: 'Delete', altKey: true },
  { key: 'Delete', ctrlKey: true },
  { key: 'Delete', metaKey: true }
])('modified $key preserves the native literal boundary command', (keys) => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  const source = '```js\nsame same\n```\n\n{++keep++}\n'
  const app = bootBoundMuya(source)
  try {
    const leaf = app.muya.editor.scrollPage!.queryBlock([0, 'text'])!
    if (!leaf.isContent()) throw new Error('Expected literal body')
    leaf.setCursor(keys.key === 'Backspace' ? 0 : 9, keys.key === 'Backspace' ? 0 : 9, true)
    const key = new KeyboardEvent('keydown', { ...keys, bubbles: true, cancelable: true })
    leaf.domNode!.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(true)
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: keys.key === 'Backspace' ? 'same same\n\n{++keep++}\n' : source
    })
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
    vi.unstubAllGlobals()
  }
})
