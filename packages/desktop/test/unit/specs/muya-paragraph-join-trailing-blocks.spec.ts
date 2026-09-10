// @vitest-environment jsdom
import { Muya } from '@muyajs/core'
import { expect, it } from 'vitest'
import { createDocumentCore } from '@marktext/document-core'
import { muyaClipboardSourceRange } from '@/documentAuthority/muyaModelSelection'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

const source = 'a\n\n100. C\n\n     D\n'

it('retains native forward Delete promotion of the donor trailing paragraph', () => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const host = document.body.appendChild(document.createElement('div'))
  const muya = new Muya(host, { markdown: source })
  muya.init()
  try {
    const paragraph = muya.editor.scrollPage?.firstContentInDescendant()
    if (!paragraph) throw new Error('Expected first paragraph')
    paragraph.setCursor(1, 1, true)
    paragraph.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
    )
    muya.flush()
    expect(muya.getState()).toMatchObject([
      { name: 'paragraph', text: 'aC' },
      { name: 'paragraph', text: 'D' }
    ])
    expect(muya.getState()).toHaveLength(2)
  } finally {
    muya.destroy()
    host.remove()
    document.getSelection()?.removeAllRanges()
  }
})

const examples = [
  {
    name: 'root paragraph',
    source,
    joined: 'aC\n\nD\n',
    shape: [
      { name: 'paragraph', text: 'aC' },
      { name: 'paragraph', text: 'D' }
    ]
  },
  {
    name: 'multiline donor',
    source: 'a\n\n100. C\n     E\n\n     D\n',
    joined: 'aC\nE\n\nD\n',
    shape: [
      { name: 'paragraph', text: 'aC\nE' },
      { name: 'paragraph', text: 'D' }
    ]
  },
  {
    name: 'annotated paragraph',
    source: 'a{>>keep<<}\n\n100. C\n\n     {==D==}{>>note<<}\n',
    joined: 'a{>>keep<<}C\n\n{==D==}{>>note<<}\n',
    shape: [
      { name: 'paragraph', text: 'aC' },
      { name: 'paragraph', text: 'D' }
    ]
  },
  {
    name: 'nested relative indentation',
    source: 'a\n\n100. C\n\n     - D\n\n       E\n',
    joined: 'aC\n\n- D\n\n  E\n',
    shape: [
      { name: 'paragraph', text: 'aC' },
      {
        name: 'bullet-list',
        children: [
          {
            children: [
              { name: 'paragraph', text: 'D' },
              { name: 'paragraph', text: 'E' }
            ]
          }
        ]
      }
    ]
  },
  {
    name: 'bullet destination',
    source: '- a\n\n100. C\n\n     D\n',
    joined: '- aC\n\n  D\n',
    shape: [
      {
        name: 'bullet-list',
        children: [
          {
            children: [
              { name: 'paragraph', text: 'aC' },
              { name: 'paragraph', text: 'D' }
            ]
          }
        ]
      }
    ]
  },
  {
    name: 'quote origin',
    source: 'a\n\n> C\n>\n> D\n',
    joined: 'aC\n\nD\n',
    shape: [
      { name: 'paragraph', text: 'aC' },
      { name: 'paragraph', text: 'D' }
    ]
  },
  {
    name: 'quote destination',
    source: '> a\n\n100. C\n\n     D\n',
    joined: '> aC\n>\n> D\n',
    shape: [
      {
        name: 'block-quote',
        children: [
          { name: 'paragraph', text: 'aC' },
          { name: 'paragraph', text: 'D' }
        ]
      }
    ]
  }
]

it.each(
  examples.filter((example) => !['root paragraph', 'annotated paragraph'].includes(example.name))
)('retains native trailing block structure for $name', (example) => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const host = document.body.appendChild(document.createElement('div'))
  const muya = new Muya(host, { markdown: example.source })
  muya.init()
  try {
    const paragraph = muya.editor.scrollPage?.firstContentInDescendant()
    if (!paragraph) throw new Error('Expected first paragraph')
    paragraph.setCursor(1, 1, true)
    paragraph.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
    )
    muya.flush()
    expect(muya.getState()).toMatchObject(example.shape)
    expect(muya.getState()).toHaveLength(example.shape.length)
  } finally {
    muya.destroy()
    host.remove()
    document.getSelection()?.removeAllRanges()
  }
})

it.each(
  examples.flatMap((example) => ['\n', '\r\n', '\r'].map((ending) => ({ ...example, ending })))
)('retains $name through the live join, next key and history ($ending)', async(example) => {
  const source = example.source.replaceAll('\n', example.ending)
  const joined = example.joined.replaceAll('\n', example.ending)
  const typed = joined.replace('C', 'xC')
  const app = bootBoundMuya(source)
  try {
    const paragraph = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!paragraph) throw new Error('Expected first paragraph')
    paragraph.setCursor(1, 1, true)
    paragraph.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: joined })
    expect(app.muya.getState()).toMatchObject(
      example.name === 'multiline donor'
        ? [
          { name: 'paragraph', text: 'aC' + example.ending + 'E' },
          { name: 'paragraph', text: 'D' }
        ]
        : example.shape
    )
    expect(app.muya.getState()).toHaveLength(example.shape.length)
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
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
      expect(reopened.muya.editor.scrollPage?.firstContentInDescendant()?.text).toBe(
        example.name === 'multiline donor' ? 'axC' + example.ending + 'E' : 'axC'
      )
    } finally {
      reopened.dispose()
    }
  } finally {
    app.dispose()
  }
})

it.each(
  examples.flatMap((example) => ['\n', '\r\n', '\r'].map((ending) => ({ ...example, ending })))
)('tracks sparse container promotion for $name ($ending)', async(example) => {
  const source = example.source.replaceAll('\n', example.ending)
  const joined = example.joined.replaceAll('\n', example.ending)
  const app = bootBoundMuya(source)
  const core = createDocumentCore()
  app.track(true)
  try {
    const paragraph = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!paragraph) throw new Error('Expected first paragraph')
    paragraph.setCursor(1, 1, true)
    paragraph.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
    )
    const saved = app.binding.sourceAtBarrier()
    if (saved.type !== 'source') throw new Error('Expected joined source')
    const original = source
      .replaceAll('{>>keep<<}', '')
      .replaceAll('{>>note<<}', '')
      .replaceAll('{==D==}', 'D')
    const revised = joined
      .replaceAll('{>>keep<<}', '')
      .replaceAll('{>>note<<}', '')
      .replaceAll('{==D==}', 'D')
    expect(core.project(core.open(saved.source), 'original').markdown).toBe(original)
    expect(core.project(core.open(saved.source), 'revised').markdown).toBe(revised)
    if (example.name === 'root paragraph') {
      expect(saved.source).toBe(
        'a{--' +
          example.ending +
          example.ending +
          '100. --}C' +
          example.ending +
          example.ending +
          '{--     --}D' +
          example.ending
      )
    }
    // Markup retains the deleted separator, so root joins select the donor's
    // displayed paragraph; list joins and the complete quote suggestion
    // retain the caret at the destination paragraph's end.
    const offset = ['bullet destination', 'quote destination'].includes(example.name) ? 1 : 0
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset }, focus: { offset } })
    const live = app.muya.editor.selection.getSelection()?.anchor.block
    if (!live?.domNode.isConnected) throw new Error('Expected live join caret')
    expect(live.text).toBe(
      ['bullet destination', 'quote destination'].includes(example.name)
        ? 'a'
        : example.name === 'multiline donor'
          ? 'C' + example.ending + 'E'
          : 'C'
    )
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
    expect(core.project(core.open(typed.source), 'original').markdown).toBe(original)
    expect(core.project(core.open(typed.source), 'revised').markdown).toBe(
      revised.replace('C', 'xC')
    )
    const caret = muyaClipboardSourceRange(app.muya, app.view())
    if (caret === undefined) throw new Error('Expected an immediately mapped DOM caret')
    const projection = core.project(core.open(typed.source), 'revised')
    expect(caret.start).toBe(caret.end)
    expect(projection.coordinates.toProjected(caret.start, 'previous')).toBe(
      revised.indexOf('C') + 1
    )
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: saved.source })
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    await app.adapter.history('redo', app.reconcile)
    await app.adapter.history('redo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed.source })
    const reopened = bootBoundMuya(typed.source)
    try {
      expect(reopened.binding.sourceAtBarrier()).toMatchObject({ source: typed.source })
    } finally {
      reopened.dispose()
    }
  } finally {
    app.dispose()
  }
})
