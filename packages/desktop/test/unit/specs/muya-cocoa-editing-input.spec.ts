// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

// macOS text-system bindings (Ctrl+T, Ctrl+Y, …) reach the bound document as
// beforeinput types outside plain typing. Chromium states each action with
// its data and target range; the model must own it or the browser must not
// edit the rendered view at all.

type App = ReturnType<typeof bootBoundMuya>

const textNode = (app: App): Text => {
  const leaf = app.muya.editor.scrollPage!.firstContentInDescendant()!
  const walker = document.createTreeWalker(leaf.domNode!, NodeFilter.SHOW_TEXT)
  const node = walker.nextNode()
  if (!(node instanceof Text)) throw new Error('Expected paragraph text')
  return node
}

const dispatchInput = (
  app: App,
  inputType: string,
  data: string | null,
  target: { start: number; end: number },
  caret: number
): InputEvent => {
  const text = textNode(app)
  app.muya.editor.selection.setDOMSelection(
    { node: text, offset: caret },
    { node: text, offset: caret }
  )
  const event = new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'getTargetRanges', {
    value: () => [
      { startContainer: text, startOffset: target.start, endContainer: text, endOffset: target.end }
    ]
  })
  text.parentElement!.dispatchEvent(event)
  return event
}

it.each([
  { tracked: false, expected: 'ab cdef\n' },
  { tracked: true, expected: 'ab{~~c ~> c~~}def\n' }
])(
  'Ctrl+T transposes the characters Chromium names through the model (tracked $tracked)',
  async({ tracked, expected }) => {
    const source = 'abc def\n'
    const app = bootBoundMuya(source)
    try {
      app.track(tracked)
      const dispatch = vi.spyOn(app.muya.editor.documentEditing!, 'input')
      // Chromium: caret after "c" swaps "c " into " c" and reports that range.
      const event = dispatchInput(app, 'insertTranspose', ' c', { start: 2, end: 4 }, 3)
      expect(event.defaultPrevented).toBe(true)
      expect(dispatch).toHaveBeenCalledOnce()
      expect(dispatch.mock.calls[0][0]).toMatchObject({ inputType: 'insertTranspose', data: ' c' })
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      app.dispose()
    }
  }
)

it('Ctrl+Y inserts the yanked text Chromium supplies at its target', async() => {
  const source = 'abc\n'
  const app = bootBoundMuya(source)
  try {
    const event = dispatchInput(app, 'insertFromYank', ' def', { start: 3, end: 3 }, 3)
    expect(event.defaultPrevented).toBe(true)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'abc def\n' })
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    app.dispose()
  }
})

it.each([
  { inputType: 'insertFromYank', data: null },
  { inputType: 'insertFromYank', data: '' },
  { inputType: 'insertTranspose', data: null },
  { inputType: 'insertHorizontalRule', data: null },
  { inputType: 'insertOrderedList', data: null },
  { inputType: 'insertLink', data: 'https://example.com' },
  { inputType: 'formatBold', data: null },
  { inputType: 'formatSetBlockTextDirection', data: 'rtl' },
  { inputType: 'historyUndo', data: null },
  { inputType: 'deleteContent', data: null }
])('$inputType ($data) never edits the rendered view behind the model', ({ inputType, data }) => {
  const source = 'abc def\n'
  const app = bootBoundMuya(source)
  try {
    const dispatch = vi.spyOn(app.muya.editor.documentEditing!, 'input')
    const event = dispatchInput(app, inputType, data, { start: 3, end: 3 }, 3)
    expect(event.defaultPrevented).toBe(true)
    expect(dispatch).not.toHaveBeenCalled()
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})
