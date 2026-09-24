// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each([
  {
    name: 'table',
    source: '| h |\n|---|\n| a |\n\nb{++c++}d\n',
    // Upstream writes the table afresh after the join and after the cell edit.
    joined: '| h          |\n| ---------- |\n| ab{++c++}d |\n',
    typed: '| h           |\n| ----------- |\n| axb{++c++}d |\n',
    caret: 1
  },
  {
    name: 'thematic break',
    source: '***\n\nb{++c++}d\n',
    joined: '***b{++c++}d\n',
    typed: '***xb{++c++}d\n',
    caret: 3
  }
])('joins a following paragraph into $name before the next native key', async(example) => {
  const suffix = '\noutside{>>keep<<}\n'
  const source = example.source + suffix
  const joined = example.joined + suffix
  const typed = example.typed + suffix
  const app = bootBoundMuya(source)
  try {
    let paragraph = app.muya.editor.scrollPage?.firstContentInDescendant()
    while (paragraph && paragraph.text !== 'bcd') paragraph = paragraph.nextContentInContext()
    if (!paragraph) throw new Error('Expected paragraph after table')
    expect(paragraph.text).toBe('bcd')
    paragraph.setCursor(0, 0, true)
    paragraph.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: joined })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { offset: example.caret },
      focus: { offset: example.caret }
    })
    const live = app.muya.editor.selection.getSelection()?.anchor.block
    if (!live?.domNode.isConnected) throw new Error('Expected table selection')
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
