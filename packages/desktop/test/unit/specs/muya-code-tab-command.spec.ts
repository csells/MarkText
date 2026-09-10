// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createDocumentCore } from '@marktext/document-core'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

afterEach(() => vi.unstubAllGlobals())

it.each(
  [
    { language: 'js', body: 'ab', before: 1, after: 5, tabbed: 'a    b', typed: 'a    xb' },
    {
      language: 'html title="x"',
      body: 'div post-text',
      before: 3,
      after: 5,
      tabbed: '<div></div> post-text',
      typed: '<div>x</div> post-text'
    },
    {
      language: 'html',
      body: 'input tail',
      before: 5,
      after: 13,
      afterEnd: 17,
      tabbed: '<input type="text"> tail',
      typed: '<input type="x"> tail'
    }
  ].flatMap((example) =>
    ['\n', '\r\n', '\r'].flatMap((ending) =>
      [false, true].flatMap((wrapped) =>
        [false, true].map((tracked) => ({ ...example, ending, wrapped, tracked }))
      )
    )
  )
)(
  'Code Tab owns $language text and the immediate next key ($ending wrapped=$wrapped Track=$tracked)',
  async(example) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const wrap = (body: string) => {
      const literal = '```' + example.language + example.ending + body + example.ending + '```'
      const original =
        '```' + example.language + example.ending + example.body + example.ending + '```'
      const marked = example.wrapped
        ? '{++' + literal + '++}'
        : example.tracked && body !== example.body
          ? '{~~' + original + example.ending + '~>' + literal + example.ending + '~~}'
          : literal
      return (
        marked +
        (example.tracked && !example.wrapped && body !== example.body ? '' : example.ending) +
        example.ending +
        'outside{>>keep<<}' +
        example.ending
      )
    }
    const source = wrap(example.body)
    const app = bootBoundMuya(source)
    app.track(example.tracked)
    try {
      let block = app.muya.editor.scrollPage?.firstContentInDescendant()
      while (block && block.blockName !== 'codeblock.content') block = block.nextContentInContext()
      if (!block) throw new Error('Expected code body')
      expect(block.blockName).toBe('codeblock.content')
      block.setCursor(example.before, example.before, true)
      block.domNode.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      )
      expect(app.adapter.state().status, JSON.stringify(app.adapter.state())).toBe('ready')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: wrap(example.tabbed) })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: example.after },
        focus: { offset: 'afterEnd' in example ? example.afterEnd : example.after }
      })
      const live = app.muya.editor.selection.getSelection()?.anchor.block
      if (!live?.domNode.isConnected) throw new Error('Expected live code selection')
      live.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: wrap(example.typed) })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: example.after + 1 },
        focus: { offset: example.after + 1 }
      })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: wrap(example.tabbed) })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: wrap(example.typed) })
      expect(createDocumentCore().open(wrap(example.typed)).source).toBe(wrap(example.typed))
    } finally {
      app.dispose()
    }
  }
)

it.each([false, true])(
  'Code Shift+Tab retains native insertion and selection behavior (selected=%s)',
  async(selected) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const source = '```js\nab\n```\n'
    const app = bootBoundMuya(source)
    try {
      let block = app.muya.editor.scrollPage?.firstContentInDescendant()
      while (block && block.blockName !== 'codeblock.content') block = block.nextContentInContext()
      if (!block) throw new Error('Expected code body')
      block.setCursor(0, selected ? 2 : 0, true)
      block.domNode.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({
        source: selected ? source : '```js\n    ab\n```\n'
      })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: selected ? 0 : 4 },
        focus: { offset: selected ? 2 : 4 }
      })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
    } finally {
      app.dispose()
    }
  }
)

it.each([
  {
    name: 'list',
    source: '- ```html\n  first\n  div tail\n  ```\n',
    expected: '- ```html\n  first\n  <div></div> tail\n  ```\n',
    before: 9,
    after: 11
  },
  {
    name: 'quote',
    source: '> ```html\n> first\n> div tail\n> ```\n',
    expected: '> ```html\n> first\n> <div></div> tail\n> ```\n',
    before: 9,
    after: 11
  },
  {
    name: 'literal CM bytes',
    source: '```js\n{++literal++}ab\n```\n',
    expected: '```js\n{++literal++}a    b\n```\n',
    before: 14,
    after: 18
  }
])('Code Tab retains $name source ownership', async({ source, expected, before, after }) => {
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
    let block = app.muya.editor.scrollPage?.firstContentInDescendant()
    while (block && block.blockName !== 'codeblock.content') block = block.nextContentInContext()
    if (!block) throw new Error('Expected code body')
    block.setCursor(before, before, true)
    block.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { offset: after },
      focus: { offset: after }
    })
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    app.dispose()
  }
})
