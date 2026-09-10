// @vitest-environment jsdom
import { Muya, ParagraphQuickInsertMenu } from '@muyajs/core'
import { afterEach, expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

afterEach(() => vi.unstubAllGlobals())

it.each([false, true])(
  'Quick Insert Horizontal Line owns its following paragraph (Core=%s)',
  async(bound) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
    const source = bound ? '/hr{>>discard<<}\n' : '/hr\n'
    const app = bound ? bootBoundMuya(source) : undefined
    const host = app ? undefined : document.body.appendChild(document.createElement('div'))
    let muya: Muya
    if (app) muya = app.muya
    else {
      if (!host) throw new Error('Expected native editor host')
      muya = new Muya(host, { markdown: source })
      muya.init()
    }
    const menu = new ParagraphQuickInsertMenu(muya)
    if (menu.container) menu.container.scrollTo = () => {}
    try {
      const block = muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Expected horizontal line trigger')
      block.setCursor(block.text.length, block.text.length, true)
      muya.eventCenter.emit('content-change', { block })
      const entry = menu.renderArray.find(
        (item: { label: string }) => item.label === 'thematic-break'
      )
      if (!entry) throw new Error('Expected Horizontal Line Quick Insert entry')
      menu.selectItem(entry)
      if (app) expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '---\n\n\n' })
      else {
        muya.flush()
        expect(muya.getMarkdown()).toBe('---\n\n\n')
      }
      expect(muya.getState()).toMatchObject([
        { name: 'thematic-break' },
        { name: 'paragraph', text: '' }
      ])
      expect(muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      if (app) {
        const input = muya.editor.selection.getSelection()?.anchor.block
        if (!input) throw new Error('Expected editable paragraph after the rule')
        input.domNode.dispatchEvent(
          new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: 'x',
            bubbles: true,
            cancelable: true
          })
        )
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '---\n\nx\n' })
        expect(muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
        muya.flush()
        expect(app.legacyChanges).toEqual([])
        await app.adapter.history('undo', app.reconcile)
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '---\n\n\n' })
        await app.adapter.history('undo', app.reconcile)
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
        await app.adapter.history('redo', app.reconcile)
        await app.adapter.history('redo', app.reconcile)
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '---\n\nx\n' })
        const reopened = bootBoundMuya('---\n\nx\n')
        try {
          expect(reopened.muya.getState()).toMatchObject([
            { name: 'thematic-break' },
            { name: 'paragraph', text: 'x' }
          ])
        } finally {
          reopened.dispose()
        }
      }
    } finally {
      menu.destroy()
      if (app) app.dispose()
      else {
        muya.destroy()
        host?.remove()
      }
    }
  }
)

it('creates the following paragraph before existing content and owns the next key', async() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  const source = '/hr{>>discard<<}\n\noutside{>>keep<<}\n'
  const inserted = '---\n\n\n\noutside{>>keep<<}\n'
  const typed = '---\n\nx\n\noutside{>>keep<<}\n'
  const app = bootBoundMuya(source)
  const menu = new ParagraphQuickInsertMenu(app.muya)
  if (menu.container) menu.container.scrollTo = () => {}
  try {
    const block = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!block) throw new Error('Expected horizontal line trigger')
    block.setCursor(block.text.length, block.text.length, true)
    app.muya.eventCenter.emit('content-change', { block })
    const entry = menu.renderArray.find(
      (item: { label: string }) => item.label === 'thematic-break'
    )
    if (!entry) throw new Error('Expected Horizontal Line Quick Insert entry')
    menu.selectItem(entry)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: inserted })
    expect(app.muya.getState()).toMatchObject([
      { name: 'thematic-break' },
      { name: 'paragraph', text: '' },
      { name: 'paragraph', text: 'outside' }
    ])
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input) throw new Error('Expected empty paragraph before existing content')
    input.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: inserted })
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    await app.adapter.history('redo', app.reconcile)
    await app.adapter.history('redo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    const reopened = bootBoundMuya(typed)
    try {
      expect(reopened.muya.getState()).toMatchObject([
        { name: 'thematic-break' },
        { name: 'paragraph', text: 'x' },
        { name: 'paragraph', text: 'outside' }
      ])
    } finally {
      reopened.dispose()
    }
  } finally {
    menu.destroy()
    app.dispose()
  }
})

it.each([
  { source: '', inserted: '---\n\n', typed: '---\n\nx', at: 0 },
  {
    source: 'before{>>keep<<}\n\nfollowing\n',
    inserted: 'before{>>keep<<}\n\n---\n\n\n\nfollowing\n',
    typed: 'before{>>keep<<}\n\n---\n\nx\n\nfollowing\n',
    at: 2
  }
])(
  'Format Horizontal Line preserves selected prose and owns its next key ($source)',
  async({ source, inserted, typed, at }) => {
    const app = bootBoundMuya(source)
    try {
      const block = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Expected Format target')
      block.setCursor(at, at, true)
      app.muya.updateParagraph('hr')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: inserted })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      const input = app.muya.editor.selection.getSelection()?.anchor.block
      if (!input) throw new Error('Expected new paragraph')
      input.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: inserted })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: at },
        focus: { offset: at }
      })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    } finally {
      app.dispose()
    }
  }
)

it.each(['toggle', 'paragraph'])(
  'resets the selected second horizontal rule through the model (%s)',
  async(action) => {
    const source = 'a\n\n---\n\nb\n\n---\n\nc{>>keep<<}\n'
    const reset = 'a\n\n---\n\nb\n\n\n\nc{>>keep<<}\n'
    const typed = 'a\n\n---\n\nb\n\nx\n\nc{>>keep<<}\n'
    const app = bootBoundMuya(source)
    try {
      const block = app.muya.editor.scrollPage?.queryBlock([3, 'text'])
      if (!block?.isContent()) throw new Error('Expected second horizontal rule')
      block.setCursor(0, 0, true)
      app.muya.updateParagraph(action === 'toggle' ? 'hr' : 'paragraph')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: reset })
      expect(app.muya.getState()[1]?.name).toBe('thematic-break')
      const input = app.muya.editor.selection.getSelection()?.anchor.block
      if (!input) throw new Error('Expected former rule insertion point')
      expect(input.text).toBe('')
      input.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { path: [3, 'text'], offset: 0 },
        focus: { path: [3, 'text'], offset: 0 }
      })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    } finally {
      app.dispose()
    }
  }
)

const creationCases = [
  {
    label: 'Quick EOF',
    quick: true,
    source: '/hr{>>discard<<}\n',
    anchor: 3,
    focus: 3,
    ordinary: '---\n\n\n',
    tracked: '{~~/hr{>>discard<<}~>---\n\n~~}\n'
  },
  {
    label: 'Quick middle',
    quick: true,
    source: '/hr{>>discard<<}\n\noutside{>>keep<<}\n',
    anchor: 3,
    focus: 3,
    ordinary: '---\n\n\n\noutside{>>keep<<}\n',
    tracked: '{~~/hr{>>discard<<}~>---\n\n~~}\n\noutside{>>keep<<}\n'
  },
  {
    label: 'Format selected prose',
    quick: false,
    source: 'before{>>keep<<}\n\nfollowing\n',
    anchor: 1,
    focus: 3,
    ordinary: 'before{>>keep<<}\n\n---\n\n\n\nfollowing\n',
    tracked: 'before{>>keep<<}{++\n\n---\n\n++}\n\nfollowing\n'
  }
].flatMap((example) =>
  ['\n', '\r\n', '\r'].flatMap((ending) =>
    [false, true].map((tracked) => ({ ...example, ending, tracking: tracked }))
  )
)

it.each(creationCases)(
  'Horizontal Line $label retains EOL and tracking through immediate input ($ending Track=$tracking)',
  async(example) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const source = example.source.replaceAll('\n', example.ending)
    const inserted = (example.tracking ? example.tracked : example.ordinary).replaceAll(
      '\n',
      example.ending
    )
    // The new editable paragraph follows the rule's two line endings.
    const typed = inserted.replace(
      '---' + example.ending + example.ending,
      '---' + example.ending + example.ending + 'xy'
    )
    const app = bootBoundMuya(source)
    app.track(example.tracking)
    const menu = new ParagraphQuickInsertMenu(app.muya)
    if (menu.container) menu.container.scrollTo = () => {}
    try {
      const block = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Expected Horizontal Line command target')
      block.setCursor(example.anchor, example.focus, true)
      if (example.quick) {
        app.muya.eventCenter.emit('content-change', { block })
        const entry = menu.renderArray.find(
          (item: { label: string }) => item.label === 'thematic-break'
        )
        if (!entry) throw new Error('Expected Horizontal Line entry')
        menu.selectItem(entry)
      } else app.muya.updateParagraph('hr')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: inserted })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      for (const data of ['x', 'y']) {
        const input = app.muya.editor.selection.getSelection()?.anchor.block
        if (!input) throw new Error('Expected following paragraph selection')
        expect(input.blockName).toBe('paragraph.content')
        input.domNode.dispatchEvent(
          new InputEvent('beforeinput', {
            inputType: 'insertText',
            data,
            bubbles: true,
            cancelable: true
          })
        )
      }
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 2 } })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: inserted })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: example.anchor },
        focus: { offset: example.focus }
      })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      const reopened = bootBoundMuya(typed)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      } finally {
        reopened.dispose()
      }
    } finally {
      menu.destroy()
      app.dispose()
    }
  }
)

it('resetting the first rule preserves its leading insertion point before existing content', async() => {
  const source = '---\n\nbody{>>keep<<}\n'
  const app = bootBoundMuya(source)
  try {
    const rule = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!rule) throw new Error('Expected leading rule')
    rule.setCursor(0, 0, true)
    app.muya.updateParagraph('paragraph')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '\n\nbody{>>keep<<}\n' })
    expect(app.muya.getState()).toMatchObject([
      { name: 'paragraph', text: '' },
      { name: 'paragraph', text: 'body' }
    ])
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input) throw new Error('Expected former rule insertion point')
    input.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'x\n\nbody{>>keep<<}\n' })
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
    await app.adapter.history('redo', app.reconcile)
    await app.adapter.history('redo', app.reconcile)
    const reopened = bootBoundMuya('x\n\nbody{>>keep<<}\n')
    try {
      expect(reopened.muya.getState()).toMatchObject([
        { name: 'paragraph', text: 'x' },
        { name: 'paragraph', text: 'body' }
      ])
    } finally {
      reopened.dispose()
    }
  } finally {
    app.dispose()
  }
})

it.each(
  [
    {
      kind: 'list',
      source: '- /hr{>>discard<<}\n- other{>>keep<<}\n',
      inserted: '- ___\n\n  \n- other{>>keep<<}\n',
      tracked: '- {~~/hr{>>discard<<}~>___\n\n  ~~}\n- other{>>keep<<}\n',
      typed: '- ___\n\n  x\n- other{>>keep<<}\n',
      trackedTyped: '- {~~/hr{>>discard<<}~>___\n\n  x~~}\n- other{>>keep<<}\n'
    },
    {
      kind: 'quote',
      source: '> /hr{>>discard<<}\n\noutside{>>keep<<}\n',
      inserted: '> ---\n>\n> \n\noutside{>>keep<<}\n',
      tracked: '> {~~/hr{>>discard<<}~>---\n>\n> ~~}\n\noutside{>>keep<<}\n',
      typed: '> ---\n>\n> x\n\noutside{>>keep<<}\n',
      trackedTyped: '> {~~/hr{>>discard<<}~>---\n>\n> x~~}\n\noutside{>>keep<<}\n'
    }
  ].flatMap((example) => [false, true].map((tracking) => ({ ...example, tracking })))
)(
  'Quick Horizontal Line retains the following paragraph inside its $kind (Track=$tracking)',
  async(example) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const app = bootBoundMuya(example.source)
    app.track(example.tracking)
    const menu = new ParagraphQuickInsertMenu(app.muya)
    if (menu.container) menu.container.scrollTo = () => {}
    try {
      const block = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Expected nested trigger')
      block.setCursor(3, 3, true)
      app.muya.eventCenter.emit('content-change', { block })
      const entry = menu.renderArray.find(
        (item: { label: string }) => item.label === 'thematic-break'
      )
      if (!entry) throw new Error('Expected Horizontal Line entry')
      menu.selectItem(entry)
      const inserted = example.tracking ? example.tracked : example.inserted
      const typed = example.tracking ? example.trackedTyped : example.typed
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: inserted })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      const input = app.muya.editor.selection.getSelection()?.anchor.block
      if (!input) throw new Error('Expected nested following paragraph')
      expect(input.blockName).toBe('paragraph.content')
      expect(input.domNode.closest(example.kind === 'list' ? 'li' : 'blockquote')).not.toBeNull()
      input.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'x',
          bubbles: true,
          cancelable: true
        })
      )
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: inserted })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: example.source })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      const reopened = bootBoundMuya(typed)
      try {
        expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      } finally {
        reopened.dispose()
      }
    } finally {
      menu.destroy()
      app.dispose()
    }
  }
)

it('Reset to Paragraph keeps its existing container-unwrapping meaning when the selected leaf is a rule', async() => {
  const source = '> ---\n>\n> body{>>keep<<}\n'
  const app = bootBoundMuya(source)
  try {
    const rule = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!rule) throw new Error('Expected rule inside quote')
    rule.setCursor(0, 0, true)
    app.muya.updateParagraph('reset-to-paragraph')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '---\n\nbody{>>keep<<}\n' })
    expect(app.muya.getState()).toMatchObject([
      { name: 'thematic-break' },
      { name: 'paragraph', text: 'body' }
    ])
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input) throw new Error('Expected preserved rule selection')
    input.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'x---\n\nbody{>>keep<<}\n' })
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    app.dispose()
  }
})
