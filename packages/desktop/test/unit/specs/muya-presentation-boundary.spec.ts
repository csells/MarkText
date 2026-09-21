// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each(['> **s{++am++}e**{>>keep<<}\n', '- **s{++am++}e**{>>keep<<}\n'])(
  'mounts a nested common-model view without invoking the standalone inline parser: %s',
  (source) => {
    const seed = bootBoundMuya('')
    const prototype = Object.getPrototypeOf(seed.muya.editor.inlineRenderer) as {
      _tokenizer: (...args: unknown[]) => unknown
    }
    seed.dispose()
    const tokenize = vi.spyOn(prototype, '_tokenizer')
    const app = bootBoundMuya(source)
    try {
      expect(tokenize).not.toHaveBeenCalled()
      const leaf = app.muya.editor.scrollPage!.firstContentInDescendant()!
      expect(
        [...leaf.domNode!.querySelectorAll('strong')].map((node) => node.textContent).join('')
      ).toBe('same')
      leaf.setCursor(0, 0, true)
      leaf.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: source.replace('**', 'X**') })
      expect(tokenize).not.toHaveBeenCalled()
      expect(app.legacyChanges).toEqual([])
    } finally {
      app.dispose()
      tokenize.mockRestore()
    }
  }
)
