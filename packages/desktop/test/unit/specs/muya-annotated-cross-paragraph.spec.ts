// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

describe('ordinary native replacement across annotated paragraphs', () => {
  it.each([
    { source: 'a{++bc++}\n\ndef\n', expected: 'a{++bX++}f\n', text: 'abXf' },
    { source: 'a{--bc--}\n\ndef\n', expected: 'a{--bX--}f\n', text: 'abXf' },
    { source: 'a{==bc==}\n\ndef\n', expected: 'a{==bX==}f\n', text: 'abXf' },
    { source: 'a{~~old~>bc~~}\n\ndef\n', expected: 'a{~~old~>bX~~}f\n', text: 'aoldbXf' },
    {
      source: 'a{++b{>>note<<}c++}\n\ndef\n',
      expected: 'a{++b{>>note<<}X++}f\n',
      text: 'abXf',
      afterComment: true
    },
    { source: 'abc\n\n{++def++}g\n', expected: 'abX{++f++}g\n', text: 'abXfg' }
  ])(
    'preserves partial wrappers and history for $source',
    async({ source, expected, text, afterComment }) => {
      const app = bootBoundMuya(source)
      try {
        const first = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
        const last = app.muya.editor.scrollPage?.queryBlock([1, 'text'])
        if (!first?.isContent() || !last?.isContent()) { throw new Error('Expected paragraph endpoints') }
        const offset = first.text.length - 1
        app.muya.editor.selection.setSelection(
          { block: first, path: first.path, offset },
          { block: last, path: last.path, offset: 2 }
        )
        if (afterComment) {
          // The original source range starts after the comment marker. Its two
          // DOM sides share a text offset, so retain that actual boundary intent.
          const marker = first.domNode.querySelector('[data-critic-kind="comment"]')
          const focus = app.muya.editor.selection.getDOMPoint({ path: last.path, offset: 2 })
          if (!marker?.parentNode || !focus) throw new Error('Expected comment selection boundary')
          app.muya.editor.selection.setDOMSelection(
            {
              node: marker.parentNode,
              offset: Array.from(marker.parentNode.childNodes).indexOf(marker) + 1
            },
            focus
          )
        }
        const input = new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
        first.domNode.dispatchEvent(input)
        expect(input.defaultPrevented).toBe(true)
        expect(app.adapter.state().status, JSON.stringify(app.adapter.state())).toBe('ready')
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
        expect(app.muya.editor.scrollPage?.firstContentInDescendant()?.text).toBe(text)
        expect(app.muya.getSelection()).toMatchObject({
          anchor: { offset: offset + 1 },
          focus: { offset: offset + 1 }
        })
        app.muya.flush()
        expect(app.legacyChanges).toEqual([])
        await app.adapter.history('undo', app.reconcile)
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
        await app.adapter.history('redo', app.reconcile)
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
        const saved = app.binding.sourceAtBarrier()
        if (saved.type !== 'source') throw new Error('Expected save-barrier source')
        const reopened = bootBoundMuya(saved.source)
        try {
          expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: expected })
          expect(reopened.muya.editor.scrollPage?.firstContentInDescendant()?.text).toBe(text)
        } finally {
          reopened.dispose()
        }
      } finally {
        app.dispose()
      }
    }
  )
})
