// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each([false, true])(
  'replaces the selected repeated word through the common model (Track Changes %s)',
  async(tracked) => {
    const source = 'teh {++teh++} teh{>>keep<<}\n'
    const corrected = tracked
      ? 'teh {++teh++} {~~teh~>the~~}{>>keep<<}\n'
      : 'teh {++teh++} the{>>keep<<}\n'
    const app = bootBoundMuya(source)
    try {
      const body = app.muya.editor.scrollPage!.firstContentInDescendant()!
      const from = body.text.lastIndexOf('teh')
      body.setCursor(from, from + 3, true)
      app.track(tracked)
      expect(app.muya.replaceCurrentWordInlineUnsafe('teh', 'the')).toBe(true)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: corrected })
      const caret = from + (tracked ? 6 : 3)
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: caret },
        focus: { offset: caret }
      })
      app.track(false)
      app.muya.editor.selection.getSelection()!.anchor.block.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: corrected.replace(tracked ? 'the~~}' : 'the{>>', tracked ? 'thex~~}' : 'thex{>>')
      })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: corrected })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: corrected })
      const reopened = bootBoundMuya(corrected)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: corrected })
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)
