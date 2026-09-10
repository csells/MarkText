// @vitest-environment jsdom
import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each(
  ['\n', '\r\n', '\r'].flatMap((ending) => [false, true].map((tracked) => ({ ending, tracked })))
)(
  'edits the imported ordered replacement in its own container ($ending tracked=$tracked)',
  async({ ending, tracked }) => {
    const source = [
      '8) same',
      '{~~9) {++sa++}me{>>keep<<}',
      '10) ~>',
      '   {++sa++}me{>>keep<<}',
      '9) ~~}final',
      ''
    ].join(ending)
    const typed = [
      '8) same',
      '{~~9) {++sa++}me{>>keep<<}',
      '10) ~>',
      '   {++XYsa++}me{>>keep<<}',
      '9) ~~}final',
      ''
    ].join(ending)
    const app = bootBoundMuya(source)
    const { muya, binding, adapter, reconcile, legacyChanges } = app
    app.track(tracked)
    try {
      let paragraph = muya.editor.scrollPage?.firstContentInDescendant()
      for (let index = 0; index < 3; index++) paragraph = paragraph?.nextContentInContext()
      if (!paragraph) throw new Error('Expected the replacement arm list item')
      expect(paragraph.text).toBe('same')
      paragraph.setCursor(0, 0, true)
      paragraph.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
      )
      expect(muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
      const next = muya.editor.selection.getSelection()?.anchor.block
      if (!next) throw new Error('Expected the live selection after input')
      expect(next.text).toBe('Xsame')
      next.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'Y',
          bubbles: true,
          cancelable: true
        })
      )
      expect(binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 2 } })
      expect(muya.getState()).toEqual(app.view().state)
      expect(legacyChanges).toEqual([])
      await adapter.history('undo', reconcile)
      await adapter.history('undo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source })
      await adapter.history('redo', reconcile)
      await adapter.history('redo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: typed })
      const core = createDocumentCore()
      const reopened = core.open(typed)
      expect(core.project(reopened, 'original').markdown).toBe(
        ['8) same', '9) me', '10) final', ''].join(ending)
      )
      expect(core.project(reopened, 'revised').markdown).toBe(
        ['8) same', '', '   XYsame', '9) final', ''].join(ending)
      )
    } finally {
      app.dispose()
    }
  }
)
