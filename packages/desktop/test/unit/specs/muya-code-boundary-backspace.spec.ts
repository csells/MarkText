// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it('uses paragraph syntax for wrapping immediately after a code boundary', async() => {
  const app = bootBoundMuya('```\na\n```\nb\n')
  try {
    const paragraph = app.muya.editor.scrollPage?.queryBlock([1, 'text'])
    if (!paragraph?.isContent()) throw new Error('Expected paragraph after code')
    paragraph.setCursor(0, 1, true)
    paragraph.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: '*',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '```\na\n```\n*b*\n' })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 2 } })
    const live = app.muya.editor.selection.getSelection()?.anchor.block
    if (!live) throw new Error('Expected wrapped paragraph selection')
    live.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '```\na\n```\n*x*\n' })
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '```\na\n```\nb\n' })
    await app.adapter.history('redo', app.reconcile)
    const saved = app.binding.sourceAtBarrier()
    if (saved.type !== 'source') throw new Error('Expected acknowledged source')
    expect(saved.source).toBe('```\na\n```\n*x*\n')
    const reopened = bootBoundMuya(saved.source)
    try {
      expect(reopened.muya.getState()).toMatchObject([
        { name: 'code-block', text: 'a' },
        { name: 'paragraph', text: '*x*' }
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
    { name: 'plain', body: 'a', donor: 'b', visible: 'b' },
    { name: 'CM spelling', body: 'a{++old++}', donor: 'b{>>note<<}', visible: 'b' },
    { name: 'HTML image', body: 'a{++old++}', donor: '<img src="x">', visible: '<img src="x">' }
  ].flatMap((example) =>
    ['\n', '\r\n', '\r'].flatMap((ending) =>
      [false, true].map((tracked) => ({ ...example, ending, tracked }))
    )
  )
)(
  'joins $name into code before the next key ($ending Track=$tracked)',
  async({ body, donor, visible, ending, tracked }) => {
    const eol = (value: string) => value.replaceAll('\n', ending)
    const before = '```\n' + body + '\n```\n' + donor + '\n'
    const after = '```\n' + body + donor + '\n```\n'
    const afterTyping = '```\n' + body + 'x' + donor + '\n```\n'
    const outside = '\noutside{>>keep<<}\n'
    const source = eol(before + outside)
    const joined = eol((tracked ? '{~~' + before + '~>' + after + '~~}' : after) + outside)
    const typed = eol(
      (tracked ? '{~~' + before + '~>' + afterTyping + '~~}' : afterTyping) + outside
    )
    const app = bootBoundMuya(source)
    app.track(tracked)
    try {
      const paragraph = app.muya.editor.scrollPage?.queryBlock([1, 'text'])
      if (!paragraph?.isContent()) throw new Error('Expected paragraph after code')
      expect(paragraph.text).toBe(visible)
      paragraph.setCursor(0, 0, true)
      paragraph.domNode.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
      )
      expect(app.adapter.state().status, JSON.stringify(app.adapter.state())).toBe('ready')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: joined })
      expect(app.muya.getSelection()).toMatchObject({
        anchor: { offset: body.length },
        focus: { offset: body.length }
      })
      const live = app.muya.editor.selection.getSelection()?.anchor.block
      if (!live?.domNode.isConnected) throw new Error('Expected live code selection')
      expect(live.blockName).toBe('codeblock.content')
      expect(live.text).toBe(body + donor)
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
        anchor: { offset: body.length + 1 },
        focus: { offset: body.length + 1 }
      })
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: joined })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      const saved = app.binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Expected acknowledged source')
      expect(saved.source).toBe(typed)
      const reopened = bootBoundMuya(saved.source)
      try {
        expect(reopened.muya.getState()).toContainEqual(
          expect.objectContaining({ name: 'code-block', text: body + 'x' + donor })
        )
        expect(reopened.muya.getState().at(-1)).toMatchObject({
          name: 'paragraph',
          text: 'outside'
        })
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)
