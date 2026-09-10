// @vitest-environment jsdom
import { ParagraphQuickInsertMenu } from '@muyajs/core'
import { afterEach, expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

afterEach(() => vi.unstubAllGlobals())

const formats = [
  { style: '-', open: '---', close: '---', lang: 'yaml' },
  { style: '+', open: '+++', close: '+++', lang: 'toml' },
  { style: ';', open: ';;;', close: ';;;', lang: 'json' },
  { style: '{', open: '{', close: '}', lang: 'json' }
]
const cases = formats.flatMap((format) =>
  ['\n', '\r\n', '\r'].flatMap((ending) =>
    [false, true].map((tracked) => ({ ...format, ending, tracked }))
  )
)

it.each(cases)(
  'Format Front Matter retains selected prose and the next key ($style $ending Track=$tracked)',
  async({ style, open, close, lang, ending, tracked }) => {
    const source = 'body{>>keep<<}' + ending
    const frontmatter = [open, '', close, '', ''].join(ending)
    const typedFrontmatter = [open, 'x', close, '', ''].join(ending)
    const inserted = (tracked ? '{++' + frontmatter + '++}' : frontmatter) + source
    const typed = (tracked ? '{++' + typedFrontmatter + '++}' : typedFrontmatter) + source
    const app = bootBoundMuya(source)
    app.muya.setOptions({ frontmatterType: style })
    app.track(tracked)
    try {
      const paragraph = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (!paragraph) throw new Error('Expected selected prose')
      paragraph.setCursor(1, 3, true)
      app.muya.updateParagraph('front-matter')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: inserted })
      const input = app.muya.editor.selection.getSelection()?.anchor.block
      expect(input?.blockName).toBe('codeblock.content')
      expect(app.muya.getState()[0]?.name).toBe('frontmatter')
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      if (!input) throw new Error('Expected front matter caret')
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
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: inserted })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 3 } })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      const reopened = bootBoundMuya(typed)
      try {
        expect(reopened.muya.getState()).toMatchObject([
          { name: 'frontmatter', meta: { lang, style }, text: 'x' },
          { name: 'paragraph', text: 'body' }
        ])
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)

it.each([
  ...cases.map((example) => ({ ...example, trigger: '/front' })),
  ...['{>>inside<<}/front', '/front{>>inside<<}', '/fr{++o++}nt'].flatMap((trigger) =>
    [false, true].map((tracked) => ({ ...formats[0], ending: '\n', tracked, trigger }))
  )
])(
  'Quick Insert Front Matter consumes $trigger and preserves exterior annotations ($style $ending Track=$tracked)',
  async({ style, open, close, ending, tracked, trigger }) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const suffix = ending + ending + 'outside{>>keep<<}' + ending
    const source = trigger + suffix
    const frontmatter = [open, '', close, '', ''].join(ending)
    const typedFrontmatter = [open, 'x', close, '', ''].join(ending)
    const inserted = (tracked ? '{~~' + trigger + '~>' + frontmatter + '~~}' : frontmatter) + suffix
    const typed =
      (tracked ? '{~~' + trigger + '~>' + typedFrontmatter + '~~}' : typedFrontmatter) + suffix
    const app = bootBoundMuya(source)
    app.muya.setOptions({ frontmatterType: style })
    app.track(tracked)
    const menu = new ParagraphQuickInsertMenu(app.muya)
    if (menu.container) menu.container.scrollTo = () => {}
    try {
      const block = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Expected Front Matter trigger')
      block.setCursor(block.text.length, block.text.length, true)
      app.muya.eventCenter.emit('content-change', { block })
      const entry = menu.renderArray.find((item: { label: string }) => item.label === 'frontmatter')
      if (!entry) throw new Error('Expected Front Matter Quick Insert entry')
      menu.selectItem(entry)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: inserted })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      const input = app.muya.editor.selection.getSelection()?.anchor.block
      if (!input) throw new Error('Expected front matter body')
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
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: inserted })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 6 }, focus: { offset: 6 } })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      const reopened = bootBoundMuya(typed)
      try {
        const state = reopened.muya.getState()
        if (tracked) expect(state[0]).toMatchObject({ name: 'paragraph', text: '/front' })
        expect(state[tracked ? 1 : 0]).toMatchObject({ name: 'frontmatter', text: 'x' })
      } finally {
        reopened.dispose()
      }
    } finally {
      menu.destroy()
      app.dispose()
    }
  }
)

it.each(formats)(
  'existing $lang front matter is unchanged by Format and a live preference change ($style)',
  ({ style, open, close }) => {
    const source = [open, 'key: value', close, '', 'body{>>keep<<}', ''].join('\n')
    const app = bootBoundMuya(source)
    try {
      const body = app.muya.editor.scrollPage?.lastContentInDescendant()
      if (!body) throw new Error('Expected body')
      body.setCursor(1, 3, true)
      app.muya.setOptions({ frontmatterType: style === '-' ? '+' : '-' })
      app.muya.updateParagraph('front-matter')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 3 } })
      expect(app.legacyChanges).toEqual([])
    } finally {
      app.dispose()
    }
  }
)
