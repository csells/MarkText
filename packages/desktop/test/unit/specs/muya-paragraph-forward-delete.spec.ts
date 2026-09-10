// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { createDocumentCore } from '@marktext/document-core'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each(
  [
    {
      name: 'list paragraph',
      source: '- a{>>keep<<}\n\n  b\n',
      joined: '- a{>>keep<<}b\n',
      typed: '- a{>>keep<<}xb\n',
      offset: 1,
      visible: 'axb'
    },
    {
      name: 'plain paragraph',
      source: 'a\n\nb\n',
      joined: 'ab\n',
      typed: 'axb\n',
      offset: 1,
      visible: 'axb'
    },
    {
      name: 'empty next list item',
      source: '* a\n\n* \n\n* c\n',
      joined: '* a\n\n* c\n',
      typed: '* ax\n\n* c\n',
      offset: 1,
      visible: 'ax'
    },
    {
      name: 'empty intervening list',
      source: 'a\n\n- \n\nb\n',
      joined: 'a\n\nb\n',
      typed: 'ax\n\nb\n',
      offset: 1,
      visible: 'ax'
    },
    {
      name: 'matching quoted item prefixes',
      source: '> - a\n> \n> - C\n> \n>   D\n',
      joined: '> - aC\n> \n>   D\n',
      typed: '> - axC\n> \n>   D\n',
      offset: 1,
      visible: 'axC'
    },
    {
      name: 'nested sublist',
      source: '* a{>>keep<<}\n\n* C\n  \n  - D\n',
      joined: '* a{>>keep<<}C\n  \n  - D\n',
      typed: '* a{>>keep<<}xC\n  \n  - D\n',
      offset: 1,
      visible: 'axC'
    },
    {
      name: 'empty item with nested sublist',
      source: '* \n\n* C\n  \n  - D\n',
      joined: '* C\n  \n  - D\n',
      typed: '* xC\n  \n  - D\n',
      offset: 0,
      visible: 'xC'
    },
    {
      name: 'ATX heading',
      source: '# a{>>keep<<}\n\nb\n',
      joined: '# a{>>keep<<}b\n',
      typed: '# a{>>keep<<}xb\n',
      offset: 3,
      visible: '# axb'
    },
    {
      name: 'Setext heading',
      source: 'a{>>keep<<}\n===\n\nb\n',
      joined: 'a{>>keep<<}b\n===\n',
      typed: 'a{>>keep<<}xb\n===\n',
      offset: 1,
      visible: 'axb'
    }
  ].flatMap((example) => ['\n', '\r\n', '\r'].map((ending) => ({ ...example, ending })))
)('joins the next $name before the following key ($ending)', async(example) => {
  const { offset, visible, name } = example
  const source = example.source.replaceAll('\n', example.ending)
  const joined = example.joined.replaceAll('\n', example.ending)
  const typed = example.typed.replaceAll('\n', example.ending)
  const app = bootBoundMuya(source)
  try {
    const paragraph = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!paragraph) throw new Error('Expected first paragraph')
    paragraph.setCursor(paragraph.text.length, paragraph.text.length, true)
    const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
    paragraph.domNode.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(app.adapter.state().status, JSON.stringify(app.adapter.state())).toBe('ready')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: joined })
    if (name.includes('nested sublist')) {
      expect(app.muya.getState()).toMatchObject([
        {
          name: 'bullet-list',
          children: [
            {
              name: 'list-item',
              children: [
                { name: 'paragraph' },
                { name: 'bullet-list', children: [{ children: [{ text: 'D' }] }] }
              ]
            }
          ]
        }
      ])
    }
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset }, focus: { offset } })
    const live = app.muya.editor.selection.getSelection()?.anchor.block
    if (!live?.domNode.isConnected) throw new Error('Expected live join caret')
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
    const reopened = bootBoundMuya(typed)
    try {
      expect(reopened.muya.editor.scrollPage?.firstContentInDescendant()?.text).toBe(visible)
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
      source: '- a{>>keep<<}\n\n  b\n',
      original: '- a\n\n  b\n',
      joined: '- ab\n',
      typed: '- axb\n'
    },
    {
      source: '* \n\n* C\n  \n  - D\n',
      original: '* \n\n* C\n  \n  - D\n',
      joined: '* C\n  \n  - D\n',
      typed: '* xC\n  \n  - D\n'
    },
    {
      source: 'a{>>keep<<}\n===\n\nb\n',
      original: 'a\n===\n\nb\n',
      joined: 'ab\n===\n',
      typed: 'axb\n===\n'
    }
  ].flatMap((example) => ['\n', '\r\n', '\r'].map((ending) => ({ ...example, ending })))
)('tracks the forward join and next input ($source, $ending)', async(example) => {
  const source = example.source.replaceAll('\n', example.ending)
  const app = bootBoundMuya(source)
  const core = createDocumentCore()
  app.track(true)
  try {
    const paragraph = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!paragraph) throw new Error('Expected first content')
    paragraph.setCursor(paragraph.text.length, paragraph.text.length, true)
    paragraph.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
    )
    expect(app.adapter.state().status, JSON.stringify(app.adapter.state())).toBe('ready')
    const joined = app.binding.sourceAtBarrier()
    if (joined.type !== 'source') throw new Error('Expected joined source')
    expect(core.project(core.open(joined.source), 'revised').markdown).toBe(
      example.joined.replaceAll('\n', example.ending)
    )
    expect(core.project(core.open(joined.source), 'original').markdown).toBe(
      example.original.replaceAll('\n', example.ending)
    )
    const live = app.muya.editor.selection.getSelection()?.anchor.block
    if (!live?.domNode.isConnected) throw new Error('Expected live joined caret')
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
    expect(core.project(core.open(typed.source), 'revised').markdown).toBe(
      example.typed.replaceAll('\n', example.ending)
    )
    expect(core.project(core.open(typed.source), 'original').markdown).toBe(
      example.original.replaceAll('\n', example.ending)
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
})
