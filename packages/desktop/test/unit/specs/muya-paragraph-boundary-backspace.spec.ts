// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { createDocumentCore } from '@marktext/document-core'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it('joins beside a reference definition without removing the definition or earlier paragraph', () => {
  const app = bootBoundMuya('a\n\n[id]: /url\n\nb\n')
  try {
    const paragraph = app.muya.editor.scrollPage
      ?.firstContentInDescendant()
      ?.nextContentInContext()
      ?.nextContentInContext()
    if (!paragraph) throw new Error('Expected paragraph after reference definition')
    expect(paragraph.text).toBe('b')
    paragraph.setCursor(0, 0, true)
    paragraph.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'a\n\n[id]: /urlb\n' })
    const live = app.muya.editor.selection.getSelection()?.anchor.block
    if (!live?.domNode.isConnected) throw new Error('Expected live definition selection')
    live.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'a\n\n[id]: /urlxb\n' })
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})

it('joins a reference definition at its own selected boundary', () => {
  const app = bootBoundMuya('a\n\n[id]: /url\n')
  try {
    const paragraph = app.muya.editor.scrollPage?.firstContentInDescendant()?.nextContentInContext()
    if (!paragraph) throw new Error('Expected reference definition')
    paragraph.setCursor(0, 0, true)
    paragraph.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'a[id]: /url\n' })
    const live = app.muya.editor.selection.getSelection()?.anchor.block
    if (!live?.domNode.isConnected) throw new Error('Expected joined paragraph')
    live.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'ax[id]: /url\n' })
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})

it('joins the selected repeated paragraph without touching the earlier identical text', () => {
  const source = '- same{>>first<<}\n\n  same{>>second<<}\n\n  same{>>third<<}\n'
  const app = bootBoundMuya(source)
  try {
    const paragraph = app.muya.editor.scrollPage
      ?.firstContentInDescendant()
      ?.nextContentInContext()
      ?.nextContentInContext()
    if (!paragraph) throw new Error('Expected third paragraph')
    paragraph.setCursor(0, 0, true)
    paragraph.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: '- same{>>first<<}\n\n  same{>>second<<}same{>>third<<}\n'
    })
    const live = app.muya.editor.selection.getSelection()?.anchor.block
    if (!live?.domNode.isConnected) throw new Error('Expected joined selection')
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 4 }, focus: { offset: 4 } })
    live.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({
      source: '- same{>>first<<}\n\n  same{>>second<<}xsame{>>third<<}\n'
    })
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})

it.each(
  [
    { name: 'plain', source: 'a\n\nb\n', joined: 'ab\n', typed: 'axb\n' },
    {
      name: 'comment',
      source: 'a{>>keep<<}\n\nb\n',
      joined: 'a{>>keep<<}b\n',
      typed: 'a{>>keep<<}xb\n'
    },
    {
      name: 'list',
      source: '- a{>>keep<<}\n\n  b\n',
      joined: '- a{>>keep<<}b\n',
      typed: '- a{>>keep<<}xb\n'
    },
    {
      name: 'quote',
      source: '> a{>>keep<<}\n>\n> b\n',
      joined: '> a{>>keep<<}b\n',
      typed: '> a{>>keep<<}xb\n'
    },
    {
      name: 'adjacent annotations',
      source: '- {++a++}{>>keep<<}\n\n  {==b==}\n',
      joined: '- {++a++}{>>keep<<}{==b==}\n',
      typed: '- {++a++}{>>keep<<}x{==b==}\n'
    }
  ].flatMap((example) => ['\n', '\r\n', '\r'].map((ending) => ({ ...example, ending })))
)(
  'merges $name paragraphs through the live model before the next key ($ending)',
  async(example) => {
    const source = example.source.replaceAll('\n', example.ending)
    const joined = example.joined.replaceAll('\n', example.ending)
    const typed = example.typed.replaceAll('\n', example.ending)
    const app = bootBoundMuya(source)
    try {
      const paragraph = app.muya.editor.scrollPage
        ?.firstContentInDescendant()
        ?.nextContentInContext()
      if (!paragraph) throw new Error('Expected second paragraph')
      expect(paragraph.text).toBe('b')
      paragraph.setCursor(0, 0, true)
      paragraph.domNode.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: joined })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
      const live = app.muya.editor.selection.getSelection()?.anchor.block
      if (!live?.domNode.isConnected) throw new Error('Expected live selection')
      live.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 2 } })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: joined })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      const reopened = bootBoundMuya(typed)
      try {
        expect(reopened.muya.editor.scrollPage?.firstContentInDescendant()?.text).toBe('axb')
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)

it.each(
  [
    {
      name: 'ATX',
      source: '# a{>>keep<<}\n\nb\n',
      joined: '# a{>>keep<<}b\n',
      typed: '# a{>>keep<<}xb\n',
      offset: 3
    },
    {
      name: 'Setext',
      source: 'a{>>keep<<}\n===\n\nb\n',
      joined: 'a{>>keep<<}b\n===\n',
      typed: 'a{>>keep<<}xb\n===\n',
      offset: 1
    }
  ].flatMap((example) => ['\n', '\r\n', '\r'].map((ending) => ({ ...example, ending })))
)('joins into a preceding $name heading through the model ($ending)', async(example) => {
  const { offset } = example
  const source = example.source.replaceAll('\n', example.ending)
  const joined = example.joined.replaceAll('\n', example.ending)
  const typed = example.typed.replaceAll('\n', example.ending)
  const app = bootBoundMuya(source)
  try {
    const paragraph = app.muya.editor.scrollPage?.firstContentInDescendant()?.nextContentInContext()
    if (!paragraph) throw new Error('Expected paragraph after heading')
    expect(paragraph.text).toBe('b')
    paragraph.setCursor(0, 0, true)
    paragraph.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: joined })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset }, focus: { offset } })
    const live = app.muya.editor.selection.getSelection()?.anchor.block
    if (!live?.domNode.isConnected) throw new Error('Expected live heading selection')
    live.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { offset: offset + 1 },
      focus: { offset: offset + 1 }
    })
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

it.each(['\n', '\r\n', '\r'])(
  'tracks the paragraph separator without losing the following input (%s)',
  async(ending) => {
    const source = '- a{>>keep<<}' + ending + ending + '  b' + ending
    const app = bootBoundMuya(source)
    const core = createDocumentCore()
    app.track(true)
    try {
      const paragraph = app.muya.editor.scrollPage
        ?.firstContentInDescendant()
        ?.nextContentInContext()
      if (!paragraph) throw new Error('Expected second paragraph')
      paragraph.setCursor(0, 0, true)
      paragraph.domNode.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
      )
      expect(app.adapter.state().status, JSON.stringify(app.adapter.state())).toBe('ready')
      const joined = app.binding.sourceAtBarrier()
      if (joined.type !== 'source') throw new Error('Expected joined source')
      expect(joined.source).toBe('- a{>>keep<<}{--' + ending + ending + '  --}b' + ending)
      expect(core.project(core.open(joined.source), 'original').markdown).toBe(
        '- a' + ending + ending + '  b' + ending
      )
      expect(core.project(core.open(joined.source), 'revised').markdown).toBe('- ab' + ending)
      const live = app.muya.editor.selection.getSelection()?.anchor.block
      if (!live?.domNode.isConnected) throw new Error('Expected live selection')
      live.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      const typed = app.binding.sourceAtBarrier()
      if (typed.type !== 'source') throw new Error('Expected typed source')
      expect(typed.source).toBe('- a{>>keep<<}{--' + ending + ending + '  --}{++x++}b' + ending)
      expect(core.project(core.open(typed.source), 'revised').markdown).toBe('- axb' + ending)
      expect(core.project(core.open(typed.source), 'original').markdown).toBe(
        '- a' + ending + ending + '  b' + ending
      )
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: joined.source })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed.source })
    } finally {
      app.dispose()
    }
  }
)

it.each([
  { source: '# a{>>keep<<}\n\nb\n', original: '# a\n\nb\n', joined: '# ab\n', typed: '# axb\n' },
  {
    source: 'a{>>keep<<}\n===\n\nb\n',
    original: 'a\n===\n\nb\n',
    joined: 'ab\n===\n',
    typed: 'axb\n===\n'
  }
])('tracks the heading join with independent projections ($source)', async(example) => {
  const app = bootBoundMuya(example.source)
  const core = createDocumentCore()
  app.track(true)
  try {
    const paragraph = app.muya.editor.scrollPage?.firstContentInDescendant()?.nextContentInContext()
    if (!paragraph) throw new Error('Expected paragraph after heading')
    paragraph.setCursor(0, 0, true)
    paragraph.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    )
    expect(app.adapter.state().status, JSON.stringify(app.adapter.state())).toBe('ready')
    const joined = app.binding.sourceAtBarrier()
    if (joined.type !== 'source') throw new Error('Expected joined source')
    expect(core.project(core.open(joined.source), 'revised').markdown).toBe(example.joined)
    expect(core.project(core.open(joined.source), 'original').markdown).toBe(example.original)
    const live = app.muya.editor.selection.getSelection()?.anchor.block
    if (!live?.domNode.isConnected) throw new Error('Expected live heading caret')
    live.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    const typed = app.binding.sourceAtBarrier()
    if (typed.type !== 'source') throw new Error('Expected typed source')
    expect(core.project(core.open(typed.source), 'revised').markdown).toBe(example.typed)
    expect(core.project(core.open(typed.source), 'original').markdown).toBe(example.original)
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: joined.source })
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: example.source })
    await app.adapter.history('redo', app.reconcile)
    await app.adapter.history('redo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed.source })
  } finally {
    app.dispose()
  }
})
