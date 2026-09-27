// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

// #5415: editing input the model does not enumerate (Ctrl+Y yank, macOS
// editing commands, input methods without a key press) over a selection that
// spans blocks replaces the selection, as upstream Muya does, instead of
// letting the browser delete the block elements between the endpoints.
describe('cross-block editing input without an enumerated input type (#5415)', () => {
  it.each([
    { inputType: 'insertFromYank', data: 'Y', expected: '- abYef\n' },
    { inputType: 'insertTranspose', data: null, expected: '- abef\n' },
    { inputType: 'deleteSomethingNewChromiumAdded', data: null, expected: '- abef\n' }
  ])('replaces the selection for $inputType', async({ inputType, data, expected }) => {
    const source = '- abc\n\ndef\n'
    const app = bootBoundMuya(source)
    try {
      const first = app.muya.editor.scrollPage?.firstContentInDescendant()
      const last = first?.nextContentInContext()
      if (!first || !last) throw new Error('Expected list and paragraph endpoints')
      app.muya.editor.selection.setSelection(
        { block: first, path: first.path, offset: 2 },
        { block: last, path: last.path, offset: 1 }
      )
      const input = new InputEvent('beforeinput', {
        inputType,
        data,
        bubbles: true,
        cancelable: true
      })
      first.domNode!.dispatchEvent(input)
      expect(input.defaultPrevented).toBe(true)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      app.dispose()
    }
  })

  // Plan 0012 G42: the browser must not edit model-owned text on its own.
  it('prevents an unenumerated type without stated text over a same-block selection', () => {
    const app = bootBoundMuya('abc\n')
    try {
      const block = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Expected paragraph')
      block.setCursor(0, 2, true)
      const input = new InputEvent('beforeinput', {
        inputType: 'insertTranspose',
        bubbles: true,
        cancelable: true
      })
      block.domNode!.dispatchEvent(input)
      expect(input.defaultPrevented).toBe(true)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'abc\n' })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
    } finally {
      app.dispose()
    }
  })
})
