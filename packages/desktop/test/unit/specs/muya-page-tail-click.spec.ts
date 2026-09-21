// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each(
  ['same\n', '> s{++am++}e{>>keep<<}\n'].flatMap((source) =>
    ['page-click', 'ArrowRight', 'ArrowDown'].map((action) => ({ source, action }))
  )
)(
  'creates a model-owned trailing paragraph through $action: $source',
  async({ source, action }) => {
    const app = bootBoundMuya(source)
    try {
      const page = app.muya.editor.scrollPage!
      const initial = page.firstContentInDescendant()!
      initial.setCursor(initial.text.length, initial.text.length, true)
      if (action === 'page-click') { page.domNode!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientY: 100 })) } else {
        initial.domNode!.dispatchEvent(
          new KeyboardEvent('keydown', { key: action, bubbles: true, cancelable: true })
        )
      }
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: source + '\n\n' })
      const body = app.muya.editor.selection.getSelection()!.anchor.block
      expect(body.blockName).toBe('paragraph.content')
      expect(body.text).toBe('')
      body.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: source + '\nx\n' })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      const reopened = bootBoundMuya(source + '\nx\n')
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: source + '\nx\n' })
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)
