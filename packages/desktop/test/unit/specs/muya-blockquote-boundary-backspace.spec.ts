// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it('unwraps only the first quote paragraph before the next native key', async() => {
  const source = '> a{++b++}c\n>\n> tail{>>keep<<}\n'
  const joined = 'a{++b++}c\n\n> tail{>>keep<<}\n'
  const typed = 'xa{++b++}c\n\n> tail{>>keep<<}\n'
  const app = bootBoundMuya(source)
  try {
    const paragraph = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!paragraph) throw new Error('Expected first quote paragraph')
    paragraph.setCursor(0, 0, true)
    paragraph.domNode!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: joined })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
    const live = app.muya.editor.selection.getSelection()?.anchor.block
    if (!live?.domNode?.isConnected) throw new Error('Expected unquoted selection')
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
  } finally {
    app.dispose()
  }
})
