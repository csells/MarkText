// @vitest-environment jsdom
import { CodeBlockLanguageSelector } from '@muyajs/core'
import { afterEach, expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

afterEach(() => vi.unstubAllGlobals())

it.each([
  {
    source: '```js\ncode\n```\n\noutside{>>keep<<}\n',
    converted: '```typescript\ncode\n```\n\noutside{>>keep<<}\n',
    bodyText: 'code',
    target: 'language-input'
  },
  {
    source: '{++```js\ncode\n```++}\n\noutside{>>keep<<}\n',
    converted: '{++```typescript\ncode\n```++}\n\noutside{>>keep<<}\n',
    bodyText: 'code',
    target: 'language-input'
  },
  {
    source: '```js\n',
    converted: '```typescript\n\n```\n',
    bodyText: '',
    target: 'paragraph.content'
  },
  {
    source: '~~~js\n',
    converted: '~~~typescript\n\n~~~\n',
    bodyText: '',
    target: 'paragraph.content'
  },
  {
    source: '> ```js\n',
    converted: '> ```typescript\n> \n> ```\n',
    bodyText: '> ',
    target: 'paragraph.content'
  }
])(
  'chooses a code language in $source before the next input and retains exact history',
  async({ source, converted, bodyText, target }) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const typed = converted.replace(
      '\n' + bodyText,
      '\n' + (bodyText === '> ' ? '> x' : 'x' + bodyText)
    )
    const app = bootBoundMuya(source)
    const picker = new CodeBlockLanguageSelector(app.muya)
    if (picker.container) picker.container.scrollTo = () => {}
    try {
      const language = app.muya.editor.scrollPage?.firstContentInDescendant()
      expect(language?.blockName).toBe(target)
      const originalCaret = language!.text.length
      language!.setCursor(originalCaret, originalCaret, true)
      app.muya.eventCenter.emit('content-change', { block: language })
      picker.selectItem({ name: 'typescript' })
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: converted })
      const body = app.muya.editor.selection.getSelection()?.anchor.block
      expect(body?.blockName).toBe('codeblock.content')
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      body!.domNode!.dispatchEvent(
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
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: converted })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: originalCaret },
        focus: { offset: originalCaret }
      })
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: converted })
      const reopened = bootBoundMuya(converted)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: converted })
        expect(reopened.muya.editor.scrollPage?.firstContentInDescendant()?.text).toBe('typescript')
      } finally {
        reopened.dispose()
      }
    } finally {
      picker.destroy()
      app.dispose()
    }
  }
)
