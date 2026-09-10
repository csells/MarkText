// @vitest-environment jsdom
import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each([false, true])(
  'reset-to-paragraph unwraps the quote before the next key (Track=%s)',
  async(tracked) => {
    const source = '> a{++a++}a\n>\n> bravo\n\noutside{>>keep<<}\n'
    const reset = tracked
      ? '{--> --}a{++a++}a\n{-->--}\n{--> --}bravo\n\noutside{>>keep<<}\n'
      : 'a{++a++}a\n\nbravo\n\noutside{>>keep<<}\n'
    const typed = reset.replace('bravo', tracked ? 'b{++X++}ravo' : 'bXravo')
    const app = bootBoundMuya(source)
    app.track(tracked)
    try {
      const first = app.muya.editor.scrollPage?.firstContentInDescendant()
      const second = first?.nextContentInContext()
      if (!second) throw new Error('Expected second quoted paragraph')
      second.setCursor(1, 1, true)
      app.muya.editor.activeContentBlock = second
      app.muya.updateParagraph('reset-to-paragraph')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: reset })
      const path = tracked ? [0, 'children', 1, 'text'] : [1, 'text']
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: 1, path },
        focus: { offset: 1, path }
      })
      const current = app.muya.editor.selection.getSelection()?.anchor.block
      if (!current) throw new Error('Expected resulting live paragraph')
      current.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: reset })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: 1, path: [0, 'children', 1, 'text'] }
      })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      const core = createDocumentCore()
      const reopened = core.open(typed)
      expect(reopened.source).toBe(typed)
      expect(core.project(reopened, 'revised').markdown).toBe('aaa\n\nbXravo\n\noutside\n')
      expect(core.project(reopened, 'original').markdown).toBe(
        tracked ? '> aa\n>\n> bravo\n\noutside\n' : 'aa\n\nbXravo\n\noutside\n'
      )
    } finally {
      app.dispose()
    }
  }
)

it.each([
  {
    source: '> > a{++a++}a\n> >\n> > bravo\n\noutside{>>keep<<}\n',
    reset: '> a{++a++}a\n>\n> bravo\n\noutside{>>keep<<}\n',
    path: [0, 'children', 1, 'text']
  },
  {
    source: '> # a{++a++}a\n>\n> bravo\n\noutside{>>keep<<}\n',
    reset: '# a{++a++}a\n\nbravo\n\noutside{>>keep<<}\n',
    path: [1, 'text']
  }
])('quote reset removes only its outer wrapper: $source', async({ source, reset, path }) => {
  const app = bootBoundMuya(source)
  try {
    const first = app.muya.editor.scrollPage?.firstContentInDescendant()
    const second = first?.nextContentInContext()
    if (!second) throw new Error('Expected second quoted paragraph')
    second.setCursor(1, 1, true)
    app.muya.editor.activeContentBlock = second
    app.muya.updateParagraph('reset-to-paragraph')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: reset })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1, path } })
    const current = app.muya.editor.selection.getSelection()?.anchor.block
    if (!current) throw new Error('Expected live paragraph after quote reset')
    current.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'X',
        bubbles: true,
        cancelable: true
      })
    )
    const typed = reset.replace('bravo', 'bXravo')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: reset })
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    await app.adapter.history('redo', app.reconcile)
    await app.adapter.history('redo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    expect(createDocumentCore().open(typed).source).toBe(typed)
  } finally {
    app.dispose()
  }
})
