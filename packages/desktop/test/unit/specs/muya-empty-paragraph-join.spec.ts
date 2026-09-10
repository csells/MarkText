// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each(
  [
    {
      source: 'a\n\n- \n\nb\n',
      key: 'Backspace',
      offset: 0,
      target: 2,
      joined: 'a\n\n- b\n',
      typed: 'a\n\n- xb\n',
      visible: 'xb'
    },
    {
      source: 'a\n\n>\n\nb\n',
      key: 'Backspace',
      offset: 0,
      target: 2,
      joined: 'a\n\n>b\n',
      typed: 'a\n\n>xb\n',
      visible: 'xb'
    },
    {
      source: '>\n\nb\n',
      key: 'Delete',
      offset: 0,
      target: 0,
      joined: '>b\n',
      typed: '>xb\n',
      visible: 'xb'
    },
    {
      source: 'a\n\n>\n\nb\n',
      key: 'Delete',
      offset: 1,
      target: 0,
      joined: 'a\n\nb\n',
      typed: 'ax\n\nb\n',
      visible: 'ax'
    }
  ].flatMap((example) => ['\n', '\r\n', '\r'].map((ending) => ({ ...example, ending })))
)(
  'joins an empty container boundary with $key before the next key ($source, $ending)',
  async(example) => {
    const { key, offset, target, visible } = example
    const source = example.source.replaceAll('\n', example.ending)
    const joined = example.joined.replaceAll('\n', example.ending)
    const typed = example.typed.replaceAll('\n', example.ending)
    const app = bootBoundMuya(source)
    try {
      let paragraph = app.muya.editor.scrollPage?.firstContentInDescendant()
      for (let index = 0; index < target; index++) { paragraph = paragraph?.nextContentInContext() ?? undefined }
      if (!paragraph) throw new Error('Expected paragraph at the join')
      const at = key === 'Backspace' ? 0 : paragraph.text.length
      paragraph.setCursor(at, at, true)
      paragraph.domNode.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      )
      expect(app.adapter.state().status, JSON.stringify(app.adapter.state())).toBe('ready')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: joined })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset }, focus: { offset } })
      const live = app.muya.editor.selection.getSelection()?.anchor.block
      if (!live?.domNode.isConnected) throw new Error('Expected live joined caret')
      live.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: joined })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      const reopened = bootBoundMuya(typed)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: typed })
        expect(
          (offset === 0
            ? reopened.muya.editor.scrollPage?.lastContentInDescendant()
            : reopened.muya.editor.scrollPage?.firstContentInDescendant()
          )?.text
        ).toBe(visible)
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)
