// @vitest-environment jsdom
import { ParagraphFrontMenu, ParagraphQuickInsertMenu } from '@muyajs/core'
import { createDocumentCore } from '@marktext/document-core'
import { afterEach, expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

afterEach(() => vi.unstubAllGlobals())

it.each(
  ['/code', '/c{++o++}de', '/co{>>inside<<}de', '{>>inside<<}/code', '/code{>>inside<<}'].flatMap(
    (trigger) =>
      ['\n', '\r\n', '\r'].flatMap((ending) =>
        [false, true].map((tracked) => ({ trigger, ending, tracked }))
      )
  )
)(
  'Quick Insert Code consumes $trigger and owns its next key ($ending Track=$tracked)',
  async({ trigger, ending, tracked }) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const source = trigger + ending + ending + 'outside{>>keep<<}' + ending
    const blockSource = '```' + ending + ending + '```'
    const converted =
      (tracked ? '{~~' + trigger + '~>' + blockSource + '~~}' : blockSource) +
      ending +
      ending +
      'outside{>>keep<<}' +
      ending
    const typed = converted.replace('```' + ending + ending, '```' + ending + 'x' + ending)
    const app = bootBoundMuya(source)
    app.track(tracked)
    const menu = new ParagraphQuickInsertMenu(app.muya)
    if (menu.container) menu.container.scrollTo = () => {}
    try {
      const block = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Expected code trigger paragraph')
      block.setCursor(block.text.length, block.text.length, true)
      app.muya.eventCenter.emit('content-change', { block })
      const entry = menu.renderArray.find((item: { label: string }) => item.label === 'code-block')
      if (!entry) throw new Error('Expected Code Block quick-insert entry')
      menu.selectItem(entry)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: converted })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      const input = app.muya.editor.selection.getSelection()?.anchor.block
      expect(input?.blockName).toBe('codeblock.content')
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
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: converted })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      const core = createDocumentCore()
      const reopened = core.open(typed)
      expect(core.project(reopened, 'revised').markdown).toBe(
        ['```', 'x', '```', '', 'outside', ''].join(ending)
      )
      expect(core.project(reopened, 'original').markdown).toBe(
        tracked
          ? trigger.replace('{++o++}', '').replace('{>>inside<<}', '') +
              ending +
              ending +
              'outside' +
              ending
          : ['```', 'x', '```', '', 'outside', ''].join(ending)
      )
    } finally {
      menu.destroy()
      app.dispose()
    }
  }
)

it.each(
  [
    {
      name: 'Format after ordinary prose',
      source: 'seed\n\noutside{>>keep<<}\n',
      converted: 'seed\n\n```\n\n```\n\noutside{>>keep<<}\n',
      trackedSource: 'seed{++\n\n```\n\n```++}\n\noutside{>>keep<<}\n',
      trigger: false
    },
    {
      name: 'Format inside a list',
      source: '- seed{++x++}{>>keep<<}\n- other\n',
      converted: '- seed{++x++}{>>keep<<}\n\n  ```\n  \n  ```\n- other\n',
      trackedSource: '- seed{++x++}{>>keep<<}{++\n\n  ```\n  \n  ```++}\n- other\n',
      trigger: false
    },
    {
      name: 'Quick Insert inside a list',
      source: '- /c{++o++}de\n- other\n',
      converted: '- ```\n  \n  ```\n- other\n',
      trackedSource: '- {~~/c{++o++}de~>```\n  \n  ```~~}\n- other\n',
      trigger: true
    },
    {
      name: 'Quick Insert inside a quote',
      source: '> /c{++o++}de\n\noutside\n',
      converted: '> ```\n> \n> ```\n\noutside\n',
      trackedSource: '> {~~/c{++o++}de~>```\n> \n> ```~~}\n\noutside\n',
      trigger: true
    }
  ].flatMap((example) => [false, true].map((tracked) => ({ ...example, tracked })))
)(
  '$name retains its context, next key and history (Track=$tracked)',
  async({ source, converted: ordinary, trackedSource, trigger, tracked }) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const app = bootBoundMuya(source)
    const menu = trigger ? new ParagraphQuickInsertMenu(app.muya) : undefined
    if (menu?.container) menu.container.scrollTo = () => {}
    app.track(tracked)
    const converted = tracked ? trackedSource : ordinary
    const typed = converted.replace(
      /```(\n(?: {2}|> )?)\n/u,
      (_, prefix: string) => '```' + prefix + 'x\n'
    )
    try {
      const block = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Expected target paragraph')
      block.setCursor(block.text.length, block.text.length, true)
      app.muya.editor.activeContentBlock = block
      if (menu) {
        app.muya.eventCenter.emit('content-change', { block })
        const code = menu.renderArray.find((item: { label: string }) => item.label === 'code-block')
        if (!code) throw new Error('Expected Code Block menu entry')
        menu.selectItem(code)
      } else app.muya.updateParagraph('pre')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: converted })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      const input = app.muya.editor.selection.getSelection()?.anchor.block
      if (!input) throw new Error('Expected live code body')
      if (source.startsWith('- ')) expect(input.domNode.closest('li')).not.toBeNull()
      if (source.startsWith('> ')) expect(input.domNode.closest('blockquote')).not.toBeNull()
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
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      const core = createDocumentCore()
      expect(core.open(typed).source).toBe(typed)
    } finally {
      menu?.destroy()
      app.dispose()
    }
  }
)

it.each([false, true])(
  'front menu creates an empty code body before the next key (Track=%s)',
  async(tracked) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const app = bootBoundMuya('')
    const menu = new ParagraphFrontMenu(app.muya)
    app.track(tracked)
    const converted = tracked ? '{++```\n\n```++}' : '```\n\n```'
    const typed = tracked ? '{++```\nx\n```++}' : '```\nx\n```'
    try {
      const block = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Expected empty paragraph')
      block.setCursor(0, 0, true)
      app.muya.eventCenter.emit('muya-front-menu', {
        reference: block.domNode,
        block: block.parent
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      menu.selectItem(new MouseEvent('click'), { label: 'code-block' })
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: converted })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      const input = app.muya.editor.selection.getSelection()?.anchor.block
      if (!input) throw new Error('Expected live code body')
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
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '' })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    } finally {
      menu.destroy()
      app.dispose()
    }
  }
)

it.each(
  ['seed', 'se{++e++}d{>>keep<<}'].flatMap((text) =>
    [false, true].map((tracked) => ({ text, tracked }))
  )
)(
  'Format Code restores the actual middle caret on undo ($text Track=$tracked)',
  async({ text, tracked }) => {
    const source = text + '\n\nother\n'
    const converted = text + (tracked ? '{++\n\n```\n\n```++}' : '\n\n```\n\n```') + '\n\nother\n'
    const app = bootBoundMuya(source)
    app.track(tracked)
    try {
      const block = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Expected target paragraph')
      block.setCursor(2, 2, true)
      app.muya.editor.activeContentBlock = block
      app.muya.updateParagraph('pre')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: converted })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 2 } })
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: converted })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
    } finally {
      app.dispose()
    }
  }
)

it('front-menu Code still replaces its target when the caret is elsewhere', async() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  const source = 'other\n'
  const app = bootBoundMuya(source)
  const menu = new ParagraphFrontMenu(app.muya)
  try {
    const first = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!first) throw new Error('Expected initial paragraph')
    first.setCursor(5, 5, true)
    first.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertParagraph',
        data: null,
        bubbles: true,
        cancelable: true
      })
    )
    const target = app.muya.editor.selection.getSelection()?.anchor.block
    const elsewhere = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!target || !elsewhere || target === elsewhere) { throw new Error('Expected empty target and other paragraph') }
    expect(target.text).toBe('')
    elsewhere.setCursor(2, 2, true)
    app.muya.eventCenter.emit('muya-front-menu', {
      reference: target.domNode,
      block: target.parent
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    menu.selectItem(new MouseEvent('click'), { label: 'code-block' })
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'other\n\n```\n\n```\n' })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input) throw new Error('Expected new code body')
    input.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'other\n\n```\nx\n```\n' })
    await app.adapter.history('undo', app.reconcile)
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'other\n\n\n' })
    expect(app.legacyChanges).toEqual([])
  } finally {
    menu.destroy()
    app.dispose()
  }
})
