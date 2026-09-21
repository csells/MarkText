// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

const displayedText = (node: Node): string => {
  if (node instanceof Element && node.hasAttribute('data-character')) { return node.getAttribute('data-character')! }
  return node.nodeType === Node.TEXT_NODE
    ? (node.textContent ?? '')
    : [...node.childNodes].map(displayedText).join('')
}

it.each([
  { prefix: '', body: '<div>body</div>', escaped: '\\<div\\>body\\<\\/div\\>' },
  {
    prefix: 'first{++a++}{>>keep<<}\n\n',
    body: '<div>{++literal++} &amp; *raw*</div>',
    escaped: '\\<div\\>\\{\\+\\+literal\\+\\+\\} \\&amp\\; \\*raw\\*\\<\\/div\\>'
  }
])(
  'HTML boundary reset preserves its literal displayed payload in $body',
  async({ prefix, body, escaped }) => {
    const source = prefix + body + '\n'
    const app = bootBoundMuya(source)
    try {
      const code = app.muya.editor.scrollPage!.lastContentInDescendant()!
      code.setCursor(0, 0, true)
      code.domNode.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
      )
      const input = app.muya.editor.selection.getSelection()!.anchor.block
      expect(input.blockName).toBe('paragraph.content')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: prefix + escaped + '\n' })
      expect(displayedText(input.domNode)).toBe(body)
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      input.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      const typed = prefix + 'x' + escaped + '\n'
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(displayedText(app.muya.editor.selection.getSelection()!.anchor.block.domNode)).toBe(
        'x' + body
      )
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      const reopened = bootBoundMuya(typed)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: typed })
        expect(
          displayedText(reopened.muya.editor.scrollPage!.lastContentInDescendant()!.domNode)
        ).toBe('x' + body)
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)

it.each([
  { name: 'fenced code', source: '```js\nbody\n```\n', changed: 'body\n', typed: 'xbody\n' },
  {
    name: 'CM fenced code',
    source: '{++```js\nbody\n```++}\n',
    changed: '{++body++}\n',
    typed: '{++xbody++}\n'
  },
  { name: 'empty code', source: '```\n\n```\n', changed: '\n', typed: 'x\n' },
  { name: 'indented code', source: '    body\n', changed: 'body\n', typed: 'xbody\n' },
  {
    name: 'quoted code',
    source: '> ```js\n> body\n> ```\n',
    changed: '> body\n',
    typed: '> xbody\n'
  },
  { name: 'math', source: '$$\nbody\n$$\n', changed: 'body\n', typed: 'xbody\n' },
  {
    name: 'CM math',
    source: '{++$$\nbody\n$$++}\n',
    changed: '{++body++}\n',
    typed: '{++xbody++}\n'
  },
  { name: 'front matter', source: '---\nbody\n---\n', changed: 'body\n', typed: 'xbody\n' },
  {
    name: 'diagram',
    source: '```mermaid\ngraph A-->B\n```\n',
    changed: 'graph A-->B\n',
    typed: 'xgraph A-->B\n'
  }
])(
  '$name body-start Backspace is a model reset before the next input',
  async({ source, changed, typed }) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const app = bootBoundMuya(source)
    try {
      const body = app.muya.editor.scrollPage!.lastContentInDescendant()!
      expect(body.blockName).toBe('codeblock.content')
      body.setCursor(0, 0, true)
      const key = new KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
        cancelable: true
      })
      body.domNode.dispatchEvent(key)
      expect(key.defaultPrevented).toBe(true)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: changed })
      const input = app.muya.editor.selection.getSelection()!.anchor.block
      expect(input.blockName).toBe('paragraph.content')
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      input.domNode.dispatchEvent(
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
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.editor.selection.getSelection()!.anchor.block.blockName).toBe(
        'codeblock.content'
      )
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      const reopened = bootBoundMuya(typed)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
      vi.unstubAllGlobals()
    }
  }
)

it.each([
  { source: 'same\n====\n', changed: 'same\n' },
  { source: 's{++a++}me{>>keep<<}\n====\n', changed: 's{++a++}me{>>keep<<}\n' },
  { source: 'same{>>body<<}\n=={>>underline<<}==\n', changed: 'same{>>body<<}{>>underline<<}\n' }
])(
  'setext boundary Backspace consumes the native key once in $source',
  async({ source, changed }) => {
    const app = bootBoundMuya(source)
    try {
      const heading = app.muya.editor.scrollPage!.firstContentInDescendant()!
      heading.setCursor(0, 0, true)
      const key = new KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
        cancelable: true
      })
      heading.domNode.dispatchEvent(key)
      expect(key.defaultPrevented).toBe(true)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: changed })
      const input = app.muya.editor.selection.getSelection()!.anchor.block
      input.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'x' + changed })
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    } finally {
      app.dispose()
    }
  }
)

it('tracks native code-start Backspace as one reset with its new paragraph caret', async() => {
  const source = '```js\nbody\n```\n'
  const app = bootBoundMuya(source)
  app.track(true)
  try {
    const body = app.muya.editor.scrollPage!.lastContentInDescendant()!
    body.setCursor(0, 0, true)
    body.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: '{~~```js\nbody\n```\n~>body\n~~}'
    })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
    const input = app.muya.editor.selection.getSelection()!.anchor.block
    input.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: '{~~```js\nbody\n```\n~>xbody\n~~}'
    })
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    app.dispose()
  }
})
