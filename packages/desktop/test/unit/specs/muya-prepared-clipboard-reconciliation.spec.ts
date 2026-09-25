// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import { undoWindowClock } from '../helpers/separateUndoSteps'

const clock = undoWindowClock()

function richPaste(app: ReturnType<typeof bootBoundMuya>, text: string, html: string) {
  const payload: Record<string, string> = { 'text/plain': text, 'text/html': html }
  return app.muya.editor.clipboard.pasteHandler({
    preventDefault() {},
    stopPropagation() {},
    clipboardData: { getData: (type: string) => payload[type] ?? '', files: [], items: [] }
  } as unknown as ClipboardEvent)
}

it.each([
  { name: 'plain', middle: 'new', visible: 'new' },
  { name: 'CriticMarkup', middle: '{--gone--}{++new++}', visible: 'gonenew' }
])(
  'rich paste reconciles its $name document before the next native key',
  async({ middle, visible }) => {
    const source = `alpha copied\n\n${middle}\n\nbeta\n\nZ\n`
    const pasted = `alpha copied\n\n${middle}\n\nbeta\n\nZcopied\n\nnew\n\nbe\n`
    const typed = `alpha copied\n\n${middle}\n\nbeta\n\nZcopied\n\nnew\n\nbeX\n`
    const app = bootBoundMuya(source)
    try {
      const target = app.muya.editor.scrollPage?.lastContentInDescendant()
      if (!target) throw new Error('Missing paste target')
      target.setCursor(1, 1, true)
      await richPaste(app, 'copied\n\nnew\n\nbe', '<p>copied</p><p>new</p><p>be</p>')

      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: pasted })
      expect(
        [...app.muya.domNode.querySelectorAll('.mu-paragraph-content')].map(
          (node) => node.textContent
        )
      ).toEqual(['alpha copied', visible, 'beta', 'Zcopied', 'new', 'be'])
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { path: [5, 'text'], offset: 2 },
        focus: { path: [5, 'text'], offset: 2 }
      })
      const caret = app.muya.editor.selection.getSelection()?.anchor.block
      if (!caret) throw new Error('Missing resulting paste selection')
      // Typed over a second after the paste, the key is its own undo step.
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
      expect(app.muya.editor.selection.getSelection()?.anchor.block.text).toBe('beX')
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: pasted })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { path: [3, 'text'], offset: 1 },
        focus: { path: [3, 'text'], offset: 1 }
      })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      const reopened = bootBoundMuya(typed)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: typed })
        expect(reopened.muya.editor.scrollPage?.lastContentInDescendant()?.text).toBe('beX')
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)

it.each(['input', 'completion'] as const)(
  'reconciles native %s while a separate rich paste remains pending',
  async(firstAction) => {
    const app = bootBoundMuya('one\n\ntail\n')
    const releases: Array<(value: string) => void> = []
    const pastes: Array<Promise<void>> = []
    try {
      app.muya.options.clipboardFilePath = () =>
        new Promise((resolve) => {
          releases.push(resolve)
        })
      const first = app.muya.editor.scrollPage?.firstContentInDescendant()
      const last = app.muya.editor.scrollPage?.lastContentInDescendant()
      if (!first || !last) throw new Error('Missing paste targets')
      first.setCursor(3, 3, true)
      pastes.push(richPaste(app, 'A', '<p>A</p>'))
      last.setCursor(4, 4, true)
      pastes.push(richPaste(app, 'B', '<p>B</p>'))
      const [releaseFirst, releaseSecond] = releases
      if (!releaseFirst || !releaseSecond) throw new Error('Both clipboard imports must be pending')
      expect(app.adapter.isSettled()).toBe(false)

      if (firstAction === 'input') {
        last.domNode!.dispatchEvent(
          new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: 'X',
            bubbles: true,
            cancelable: true
          })
        )
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'one\n\ntailX\n' })
        expect(app.muya.editor.scrollPage?.lastContentInDescendant()?.text).toBe('tailX')
        expect(app.muya.getSelection()).toMatchObject({ anchor: { path: [1, 'text'], offset: 5 } })
      }
      releaseFirst('')
      await pastes[0]
      expect(app.muya.editor.scrollPage?.firstContentInDescendant()?.text).toBe('oneA')
      expect(app.adapter.isSettled()).toBe(false)
      const caret = app.muya.editor.selection.getSelection()?.anchor.block
      if (!caret) throw new Error('Missing current selection while second paste is pending')
      caret.domNode!.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'Y',
          bubbles: true,
          cancelable: true
        })
      )
      const typed = firstAction === 'input' ? 'tailXY' : 'tailY'
      expect(app.muya.editor.scrollPage?.lastContentInDescendant()?.text).toBe(typed)
      releaseSecond('')
      await pastes[1]
      const completed = firstAction === 'input' ? 'tailBXY' : 'tailBY'
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: `oneA\n\n${completed}\n` })
      expect(app.muya.editor.scrollPage?.lastContentInDescendant()?.text).toBe(completed)
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { path: [1, 'text'], offset: completed.length }
      })
      expect(app.adapter.isSettled()).toBe(true)
      expect(app.legacyChanges).toEqual([])
    } finally {
      for (const release of releases) release('')
      await Promise.allSettled(pastes)
      app.dispose()
    }
  }
)
