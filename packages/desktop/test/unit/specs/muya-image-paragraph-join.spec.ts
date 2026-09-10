// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each(
  [
    {
      source: '<img src="x">\n\nb\n',
      key: 'Backspace',
      offset: 13,
      joined: '<img src="x">b\n',
      typed: '<img src="x">xb\n'
    },
    {
      source: '<img src="x">\n\nb\n',
      key: 'Delete',
      offset: 13,
      joined: '<img src="x">b\n',
      typed: '<img src="x">xb\n'
    },
    {
      source: 'a\n\n<img src="x">\n',
      key: 'Delete',
      offset: 1,
      joined: 'a<img src="x">\n',
      typed: 'ax<img src="x">\n'
    },
    {
      source: 'a\n\n<img src="x">\n',
      key: 'Backspace',
      offset: 1,
      joined: 'a<img src="x">\n',
      typed: 'ax<img src="x">\n'
    }
  ].flatMap((example) => ['\n', '\r\n', '\r'].map((ending) => ({ ...example, ending })))
)('joins an image paragraph with $key before the next key ($source, $ending)', async(example) => {
  const { key, offset } = example
  const source = example.source.replaceAll('\n', example.ending)
  const joined = example.joined.replaceAll('\n', example.ending)
  const typed = example.typed.replaceAll('\n', example.ending)
  const app = bootBoundMuya(source)
  try {
    const first = app.muya.editor.scrollPage?.firstContentInDescendant()
    const paragraph = key === 'Backspace' ? first?.nextContentInContext() : first
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
      expect(reopened.muya.editor.scrollPage?.firstContentInDescendant()?.text).toContain(
        typed.trimEnd()
      )
    } finally {
      reopened.dispose()
    }
  } finally {
    app.dispose()
  }
})
