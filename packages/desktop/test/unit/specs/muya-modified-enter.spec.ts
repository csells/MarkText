// @vitest-environment jsdom
import { createDocumentCore } from '@marktext/document-core'
import { InlineFormatToolbar, Muya, ParagraphQuickInsertMenu } from '@muyajs/core'
import { afterEach, expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

afterEach(() => vi.unstubAllGlobals())

it.each(['metaKey', 'ctrlKey', 'altKey'] as const)(
  'lets the actual Quick Insert menu own %s Enter before document input',
  async(modifier) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const app = bootBoundMuya('/math\n')
    const menu = new ParagraphQuickInsertMenu(app.muya)
    if (menu.container) menu.container.scrollTo = () => {}
    try {
      const content = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (content == null) throw new Error('Expected menu trigger')
      content.setCursor(content.text.length, content.text.length, true)
      app.muya.eventCenter.emit('content-change', { block: content })
      expect(menu.status).toBe(true)
      expect(menu.activeItem?.label).toBe('math-block')
      content.domNode.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          [modifier]: true,
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '$$\n\n$$\n' })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      const target = app.muya.editor.selection.getSelection()?.anchor.block.domNode
      if (!target?.isConnected) throw new Error('Expected live math selection')
      target.dispatchEvent(
        new InputEvent('beforeinput', {
          data: 'x',
          inputType: 'insertText',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '$$\nx\n$$\n' })
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '/math\n' })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '$$\nx\n$$\n' })
    } finally {
      menu.destroy()
      app.dispose()
    }
  }
)

it('keeps a passive inline toolbar from swallowing modified Enter', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  const app = bootBoundMuya('aaaa\n')
  const toolbar = new InlineFormatToolbar(app.muya)
  try {
    app.muya.ui.shownFloat.add(toolbar)
    const content = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (content == null) throw new Error('Expected selected paragraph')
    content.setCursor(1, 3, true)
    content.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'a\n\na\n' })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
    expect(app.legacyChanges).toEqual([])
  } finally {
    toolbar.destroy()
    app.dispose()
  }
})

it.each([false, true])(
  'preserves the primary table-row shortcut precedence with Alt=%s',
  (altKey) => {
    const app = bootBoundMuya('| aa | bb |\n| --- | --- |\n| cc | dd |\n')
    try {
      const content = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (content == null) throw new Error('Expected table cell')
      content.setCursor(1, 1, true)
      content.domNode.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          metaKey: true,
          ctrlKey: true,
          altKey,
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: '| aa | bb |\n| --- | --- |\n|     |     |\n| cc | dd |\n'
      })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      expect(app.legacyChanges).toEqual([])
    } finally {
      app.dispose()
    }
  }
)

for (const modifier of ['metaKey', 'ctrlKey', 'altKey'] as const) {
  for (const source of ['| a | b |', '$$']) {
    it(`retains upstream ${modifier} Enter conversion for ${source}`, () => {
      const host = document.body.appendChild(document.createElement('div'))
      const muya = new Muya(host)
      muya.init()
      muya.setContent([{ name: 'paragraph', text: source }])
      try {
        const content = muya.editor.scrollPage?.firstContentInDescendant()
        if (content == null) throw new Error('Expected content leaf')
        content.setCursor(content.text.length, content.text.length, true)
        content.domNode.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            [modifier]: true,
            bubbles: true,
            cancelable: true
          })
        )
        muya.flush()
        expect(muya.getState()).toMatchObject(
          source === '$$'
            ? [{ name: 'math-block', text: '' }]
            : [
              {
                name: 'table',
                children: [
                  { name: 'table.row', children: [{ text: ' a ' }, { text: ' b ' }] },
                  { name: 'table.row', children: [{ text: '' }, { text: '' }] }
                ]
              }
            ]
        )
        expect(muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
        expect(muya.getMarkdown()).toBe(
          source === '$$' ? '$$\n\n$$\n' : '| a   | b   |\n| --- | --- |\n|     |     |\n'
        )
      } finally {
        muya.destroy()
        host.remove()
        document.getSelection()?.removeAllRanges()
      }
    })
  }
  for (const source of ['| a | b |\n', '| {++a++} | b |\n', '$$\n']) {
    it(`owns ${modifier} Enter and the immediate next key in ${JSON.stringify(source)}`, async() => {
      const app = bootBoundMuya(source)
      const { muya, binding, adapter, reconcile, legacyChanges } = app
      try {
        const content = muya.editor.scrollPage?.firstContentInDescendant()
        if (content == null) throw new Error('Expected content leaf')
        content.setCursor(content.text.length, content.text.length, true)
        const event = new KeyboardEvent('keydown', {
          key: 'Enter',
          [modifier]: true,
          bubbles: true,
          cancelable: true
        })
        content.domNode.dispatchEvent(event)
        const afterEnter =
          source === '$$\n' ? '$$\n\n$$\n' : `${source.slice(0, -1)}\n| --- | --- |\n| | |\n`
        const afterTyping =
          source === '$$\n' ? '$$\nx\n$$\n' : `${source.slice(0, -1)}\n| --- | --- |\n| x| |\n`
        expect(event.defaultPrevented).toBe(true)
        expect(binding.sourceAtBarrier()).toMatchObject({ source: afterEnter })
        expect(muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
        const target = muya.editor.selection.getSelection()?.anchor.block.domNode
        if (!target?.isConnected) throw new Error('Expected live selection after Enter')
        target.dispatchEvent(
          new InputEvent('beforeinput', {
            data: 'x',
            inputType: 'insertText',
            bubbles: true,
            cancelable: true
          })
        )
        expect(binding.sourceAtBarrier()).toMatchObject({ source: afterTyping })
        expect(muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
        expect(legacyChanges).toEqual([])
        await adapter.settled()
        await adapter.history('undo', reconcile)
        expect(binding.sourceAtBarrier()).toMatchObject({ source: afterEnter })
        await adapter.history('undo', reconcile)
        expect(binding.sourceAtBarrier()).toMatchObject({ source })
        await adapter.history('redo', reconcile)
        await adapter.history('redo', reconcile)
        expect(binding.sourceAtBarrier()).toMatchObject({ source: afterTyping })
        const core = createDocumentCore()
        const reopened = core.open(afterTyping)
        expect(reopened.source).toBe(afterTyping)
        expect(core.project(reopened, 'original').markdown).toBe(afterTyping.replace('{++a++}', ''))
        expect(core.project(reopened, 'revised').markdown).toBe(afterTyping.replace('{++a++}', 'a'))
      } finally {
        app.dispose()
      }
    })
  }
}
