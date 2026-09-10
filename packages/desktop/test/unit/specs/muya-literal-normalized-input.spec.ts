// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each(
  ['\n', '\r\n', '\r'].flatMap((eol) => [false, true].map((annotated) => ({ eol, annotated })))
)(
  'edits normalized math payload and the next key through the same model, $eol, CM=$annotated',
  async({ eol, annotated }) => {
    const wrap = (value: string) => (annotated ? '{++' + value + '++}' : value)
    const source = wrap(['  ```math', '\tx', '  ```', ''].join(eol))
    const typed = wrap(['  ```math', '   y x', '  ```', ''].join(eol))
    const continued = wrap(['  ```math', '   yz x', '  ```', ''].join(eol))
    const app = bootBoundMuya(source, { gitLabMath: true })
    try {
      const body = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
      if (!body?.isContent()) throw new Error('Expected math body')
      expect(body.getAnchor()?.blockName).toBe('math-block')
      expect(body.text).toBe('  x')
      body.setCursor(1, 1, true)
      body.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'y',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.adapter.state().status, JSON.stringify(app.adapter.state())).toBe('ready')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 2 } })
      expect(app.muya.editor.selection.getSelection()?.anchor.block.text).toBe(' y x')
      // No acknowledgement or artificial wait before the next key.
      app.muya.editor.selection
        .getSelection()
        ?.anchor.block.domNode.dispatchEvent(
          new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: 'z',
            bubbles: true,
            cancelable: true
          })
        )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: continued })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 3 }, focus: { offset: 3 } })
      expect(app.muya.editor.selection.getSelection()?.anchor.block.text).toBe(' yz x')
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
      await app.adapter.history('redo', app.reconcile)
      const saved = app.binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Expected acknowledged source')
      expect(saved.source).toBe(continued)
      const reopened = bootBoundMuya(saved.source, { gitLabMath: true })
      try {
        expect(reopened.muya.getState()).toMatchObject([{ name: 'math-block', text: ' yz x' }])
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)
