// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'
import type { MaybeContent } from '../helpers/muyaTypes'
import { separateUndoSteps } from '../helpers/separateUndoSteps'

separateUndoSteps()

// Expected bytes and carets were recorded from upstream MarkText (8d6c198c):
// Enter in a lone known opening tag and Paragraph → HTML Block. Upstream's
// caret sat on the template's middle line, or at the end after the menu
// replaced an empty paragraph; typing `x` there proves the same position.

afterEach(() => vi.unstubAllGlobals())

type App = ReturnType<typeof bootBoundMuya>

const stubResizeObserver = () =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )

const live = (app: App) => {
  const block = app.muya.editor.selection.getSelection()?.anchor.block
  if (!block?.domNode?.isConnected) throw new Error('Expected a live selection')
  return block
}

const input = (app: App, inputType: string, data: string | null = null) =>
  live(app).domNode!.dispatchEvent(
    new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true })
  )

const lastContent = (app: App) => {
  let block: MaybeContent = app.muya.editor.scrollPage?.firstContentInDescendant()
  while (block?.nextContentInContext()) block = block.nextContentInContext()
  if (!block) throw new Error('Expected content')
  return block
}

const blockNames = (app: App) => app.muya.getState().map((state: { name: string }) => state.name)

const source = (app: App) => {
  const reply = app.binding.sourceAtBarrier()
  if (reply.type !== 'source') throw new Error('Expected source')
  return reply.source
}

it.each([
  {
    name: 'a bare opener',
    original: '<div>\n',
    template: '<div>\n\n</div>\n',
    typed: '<div>\nx\n</div>\n'
  },
  {
    name: 'a section',
    original: '<section>\n',
    template: '<section>\n\n</section>\n',
    typed: '<section>\nx\n</section>\n'
  },
  {
    name: 'attributes',
    original: '<div class="x">\n',
    template: '<div>\n\n</div>\n',
    typed: '<div>\nx\n</div>\n'
  },
  {
    name: 'a list item',
    original: '- <div>\n',
    template: '- <div>\n  \n  </div>\n',
    typed: '- <div>\n  x\n  </div>\n',
    container: 'li'
  },
  {
    name: 'a blockquote',
    original: '> <div>\n',
    template: '> <div>\n> \n> </div>\n',
    typed: '> <div>\n> x\n> </div>\n',
    container: 'blockquote'
  },
  {
    name: 'a CRLF document',
    original: '<div>\r\n',
    template: '<div>\r\n\r\n</div>\r\n',
    typed: '<div>\r\nx\r\n</div>\r\n'
  }
])(
  'Enter after $name writes the upstream template and the next key joins one HTML block',
  async({ original, template, typed, container }) => {
    const app = bootBoundMuya(original)
    try {
      const opener = lastContent(app)
      expect(opener.blockName).toBe('codeblock.content')
      opener.setCursor(opener.text.length, opener.text.length, true)
      input(app, 'insertParagraph')
      expect(source(app)).toBe(template)
      expect(app.muya.getState()).toEqual(app.view().state)
      const gap = live(app)
      expect(gap.blockName).toBe('paragraph.content')
      expect(gap.text).toBe('')
      if (container) expect(gap.domNode!.closest(container)).not.toBeNull()
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      input(app, 'insertText', 'x')
      expect(source(app)).toBe(typed)
      const joined = live(app)
      expect(joined.blockName).toBe('codeblock.content')
      expect(joined.text.replace(/\r\n/g, '\n')).toMatch(
        /^<(?:div|section)>\nx\n<\/(?:div|section)>$/
      )
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: joined.text.indexOf('x') + 1 }
      })
      expect(app.muya.domNode.querySelectorAll('figure').length).toBe(1)
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(template)
      await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(original)
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(source(app)).toBe(typed)
    } finally {
      app.dispose()
    }
  }
)

it.each(['<br>\n', '<DIV>\n', '<custom-el>\n'])(
  'Enter after %j keeps paragraph Enter',
  (original) => {
    const app = bootBoundMuya(original)
    try {
      const opener = lastContent(app)
      opener.setCursor(opener.text.length, opener.text.length, true)
      input(app, 'insertParagraph')
      expect(source(app)).toBe(original + '\n\n')
      expect(app.legacyChanges).toEqual([])
    } finally {
      app.dispose()
    }
  }
)

it('reopening a template shows its editable middle line', () => {
  const app = bootBoundMuya('<div>\n\n</div>\n')
  try {
    expect(blockNames(app)).toEqual(['html-block', 'paragraph', 'html-block'])
    const middle = app.muya.editor.scrollPage?.find(1)
    const gap = middle?.isParent() ? middle.firstContentInDescendant() : undefined
    if (!gap) throw new Error('Expected the middle line')
    gap.setCursor(0, 0, true)
    input(app, 'insertText', 'x')
    expect(source(app)).toBe('<div>\nx\n</div>\n')
    expect(blockNames(app)).toEqual(['html-block'])
  } finally {
    app.dispose()
  }
})

const keydown = (app: App, key: string) =>
  live(app).domNode!.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  )

it.each([
  {
    name: 'Enter',
    act: (app: App) => input(app, 'insertParagraph'),
    edited: '<div>\n\n\n</div>\n',
    typed: '<div>\n\nx\n</div>\n'
  },
  {
    name: 'Backspace',
    act: (app: App) => keydown(app, 'Backspace'),
    edited: '<div>\n</div>\n',
    typed: '<div>x\n</div>\n'
  },
  {
    name: 'Delete',
    act: (app: App) => keydown(app, 'Delete'),
    edited: '<div>\n</div>\n',
    typed: '<div>\nx</div>\n'
  }
])(
  '$name on a template middle line edits it like the HTML widget',
  async({ act, edited, typed }) => {
    const original = '<div>\n\n</div>\n'
    const app = bootBoundMuya(original)
    try {
      const middle = app.muya.editor.scrollPage?.find(1)
      const gap = middle?.isParent() ? middle.firstContentInDescendant() : undefined
      if (!gap) throw new Error('Expected the middle line')
      gap.setCursor(0, 0, true)
      act(app)
      expect(source(app)).toBe(edited)
      expect(app.muya.getState()).toEqual(app.view().state)
      input(app, 'insertText', 'x')
      expect(source(app)).toBe(typed)
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(original)
    } finally {
      app.dispose()
    }
  }
)

it('plain paragraphs keep their single separator without an editable gap', () => {
  const app = bootBoundMuya('a\n\nb\n')
  try {
    expect(blockNames(app)).toEqual(['paragraph', 'paragraph'])
  } finally {
    app.dispose()
  }
})

it.each([
  {
    name: 'an empty paragraph',
    original: '',
    at: 0,
    template: '<div>\n\n</div>',
    typed: '<div>\n\n</div>x'
  },
  {
    name: 'a paragraph',
    original: 'hello\n',
    at: 5,
    template: 'hello\n\n<div>\n\n</div>\n',
    typed: 'hello\n\n<div>\nx\n</div>\n'
  },
  {
    name: 'a heading',
    original: '# head\n',
    at: 4,
    template: '# head\n\n<div>\n\n</div>\n',
    typed: '# head\n\n<div>\nx\n</div>\n'
  },
  {
    name: 'a list item',
    original: '- hello\n',
    at: 5,
    template: '- hello\n\n  <div>\n  \n  </div>\n',
    typed: '- hello\n\n  <div>\n  x\n  </div>\n'
  },
  {
    name: 'a blockquote',
    original: '> hello\n',
    at: 5,
    template: '> hello\n>\n> <div>\n> \n> </div>\n',
    typed: '> hello\n>\n> <div>\n> x\n> </div>\n'
  },
  {
    name: 'a CRLF paragraph',
    original: 'hello\r\n\r\nworld\r\n',
    at: 5,
    template: 'hello\r\n\r\n<div>\r\n\r\n</div>\r\n\r\nworld\r\n',
    typed: 'hello\r\n\r\n<div>\r\nx\r\n</div>\r\n\r\nworld\r\n'
  }
])(
  'Paragraph → HTML Block in $name goes through the model',
  async({ original, at, template, typed }) => {
    const app = bootBoundMuya(original)
    try {
      const block = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Expected paragraph')
      app.muya.editor.activeContentBlock = block
      block.setCursor(at, at, true)
      app.muya.updateParagraph('html')
      expect(source(app)).toBe(template)
      expect(app.muya.getState()).toEqual(app.view().state)
      input(app, 'insertText', 'x')
      expect(source(app)).toBe(typed)
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(template)
      await app.adapter.history('undo', app.reconcile)
      expect(source(app)).toBe(original)
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: at },
        focus: { offset: at }
      })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(source(app)).toBe(typed)
    } finally {
      app.dispose()
    }
  }
)

it('Quick Insert HTML Block places the caret on the middle line', async() => {
  stubResizeObserver()
  const { ParagraphQuickInsertMenu } = await import('@muyajs/core')
  const app = bootBoundMuya('/html\n')
  const menu = new ParagraphQuickInsertMenu(app.muya)
  if (menu.container) menu.container.scrollTo = () => {}
  try {
    const block = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!block) throw new Error('Expected quick-insert trigger')
    block.setCursor(block.text.length, block.text.length, true)
    app.muya.eventCenter.emit('content-change', { block })
    const html = menu.renderArray.find((item: { label: string }) => item.label === 'html-block')
    if (!html) throw new Error('Expected HTML Block menu entry')
    menu.selectItem(html)
    expect(source(app)).toBe('<div>\n\n</div>\n')
    input(app, 'insertText', 'x')
    expect(source(app)).toBe('<div>\nx\n</div>\n')
    expect(app.legacyChanges).toEqual([])
  } finally {
    menu.destroy()
    app.dispose()
  }
})

// Track Changes suggests the same template: accepting it yields the
// untracked bytes, rejecting it the source before the command.
it.each([
  { name: 'Enter', original: '<div>\n', tracked: '{~~<div>\n~><div>\n\n</div>\n~~}' },
  { name: 'the Paragraph menu', original: 'hello\n', tracked: 'hello\n{++\n<div>\n\n</div>\n++}' }
])('Track Changes suggests $name on an HTML template', ({ name, original, tracked }) => {
  const app = bootBoundMuya(original)
  app.track(true)
  try {
    const block = lastContent(app)
    block.setCursor(block.text.length, block.text.length, true)
    app.muya.editor.activeContentBlock = block
    if (name === 'Enter') input(app, 'insertParagraph')
    else app.muya.updateParagraph('html')
    expect(source(app)).toBe(tracked)
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})

it('Paragraph menu replacing an empty paragraph keeps the model caret for other literal blocks', () => {
  const app = bootBoundMuya('')
  try {
    const block = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!block) throw new Error('Expected paragraph')
    app.muya.editor.activeContentBlock = block
    block.setCursor(0, 0, true)
    app.muya.updateParagraph('mathblock')
    expect(source(app)).toBe('$$\n\n$$')
    input(app, 'insertText', 'x')
    expect(source(app)).toBe('$$\nx\n$$')
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})
