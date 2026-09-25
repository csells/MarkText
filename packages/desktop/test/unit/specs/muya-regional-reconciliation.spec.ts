// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import { undoWindowClock } from '../helpers/separateUndoSteps'

const clock = undoWindowClock()

it.each([
  {
    name: 'plain',
    source: 'same\n\nmiddle\n\nsame\n',
    typed: 'same\n\nmiddleXY\n\nsame\n',
    before: 'middle',
    after: 'middleXY'
  },
  {
    name: 'CriticMarkup',
    source: 'same\n\nmid {++new++} end\n\nsame\n',
    typed: 'same\n\nmid {++new++} endXY\n\nsame\n',
    before: 'mid new end',
    after: 'mid new endXY'
  }
])(
  'keeps untouched $name paragraphs mounted through model input and history',
  async({ source, typed, before, after }) => {
    const app = bootBoundMuya(source)
    try {
      const paragraphs = () => [...app.muya.domNode.querySelectorAll('.mu-paragraph-content')]
      const [first, middle, last] = paragraphs()
      const target = app.muya.editor.scrollPage?.queryBlock([1, 'text'])
      if (!first || !middle || !last || !target?.isContent()) throw new Error('Missing paragraphs')
      target.setCursor(before.length, before.length, true)
      for (const data of ['X', 'Y']) {
        const caret = app.muya.editor.selection.getSelection()?.anchor.block
        if (!caret) throw new Error('Missing current model caret')
        caret.domNode!.dispatchEvent(
          new InputEvent('beforeinput', {
            inputType: 'insertText',
            data,
            bubbles: true,
            cancelable: true
          })
        )
        expect(paragraphs()[0]).toBe(first)
        expect(paragraphs()[2]).toBe(last)
        expect(first.isConnected && last.isConnected).toBe(true)
      }
      expect(paragraphs().map((node) => node.textContent)).toEqual(['same', after, 'same'])
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { path: [1, 'text'], offset: after.length },
        focus: { path: [1, 'text'], offset: after.length }
      })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(paragraphs()[0]).toBe(first)
      expect(paragraphs()[2]).toBe(last)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(paragraphs()[0]).toBe(first)
      expect(paragraphs()[2]).toBe(last)
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      const reopened = bootBoundMuya(typed)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: typed })
        expect(
          [...reopened.muya.domNode.querySelectorAll('.mu-paragraph-content')].map(
            (node) => node.textContent
          )
        ).toEqual(['same', after, 'same'])
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)

it('retains surrounding roots when native Enter changes root count and restores the shifted caret', async() => {
  const source = 'same\n\nmiddle\n\nsame\n'
  const split = 'same\n\nmidd\n\nle\n\nsame\n'
  const typed = 'same\n\nmidd\n\nXle\n\nsame\n'
  const app = bootBoundMuya(source)
  try {
    const paragraphs = () => [...app.muya.domNode.querySelectorAll('.mu-paragraph-content')]
    const [first, , last] = paragraphs()
    const target = app.muya.editor.scrollPage?.queryBlock([1, 'text'])
    if (!first || !last || !target?.isContent()) throw new Error('Missing paragraphs')
    target.setCursor(4, 4, true)
    target.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertParagraph',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: split })
    expect(paragraphs()[0]).toBe(first)
    expect(paragraphs()[3]).toBe(last)
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { path: [2, 'text'], offset: 0 },
      focus: { path: [2, 'text'], offset: 0 }
    })
    const caret = app.muya.editor.selection.getSelection()?.anchor.block
    if (!caret) throw new Error('Missing shifted model caret')
    // Typed over a second after Enter, the key is its own undo step.
    clock.pause()
    caret.domNode!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'X',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    expect(paragraphs().map((node) => node.textContent)).toEqual(['same', 'midd', 'Xle', 'same'])
    for (const expected of [split, source]) {
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(paragraphs()[0]).toBe(first)
      expect(paragraphs().at(-1)).toBe(last)
    }
    for (const expected of [split, typed]) {
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(paragraphs()[0]).toBe(first)
      expect(paragraphs().at(-1)).toBe(last)
    }
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})
