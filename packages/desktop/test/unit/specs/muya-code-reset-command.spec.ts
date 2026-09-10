// @vitest-environment jsdom
import { Muya } from '@muyajs/core'
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each([
  { command: 'pre', caret: 2 },
  { command: 'paragraph', caret: 2 },
  { command: 'reset-to-paragraph', caret: 9 },
  { command: 'direct', caret: 9 }
])('$command supplies the paragraph and caret before the next key', async({ command, caret }) => {
  const source = '```\ncode here\n```\n'
  const app = bootBoundMuya(source)
  try {
    const block = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (!block?.isContent()) throw new Error('Expected code body')
    expect(block.blockName).toBe('codeblock.content')
    expect(block.text).toBe('code here')
    block.setCursor(2, 2, true)
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 2 } })
    if (command === 'direct') {
      const code = block.closestBlock('code-block')
      if (!code) throw new Error('Expected code parent')
      app.muya.resetToParagraph(code)
    } else app.muya.updateParagraph(command)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'code here\n' })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { offset: caret },
      focus: { offset: caret }
    })
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input) throw new Error('Expected paragraph after code toggle')
    expect(input.blockName).toBe('paragraph.content')
    input.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    const typed = caret === 2 ? 'coxde here\n' : 'code herex\n'
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    expect(app.muya.getSelection()).toMatchObject({
      anchor: { offset: caret + 1 },
      focus: { offset: caret + 1 }
    })
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: 'code here\n' })
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 2 } })
    await app.adapter.history('redo', app.reconcile)
    await app.adapter.history('redo', app.reconcile)
    const saved = app.binding.sourceAtBarrier()
    if (saved.type !== 'source') throw new Error('Expected acknowledged source')
    expect(saved.source).toBe(typed)
    const reopened = bootBoundMuya(saved.source)
    try {
      expect(reopened.muya.getState()).toMatchObject([
        { name: 'paragraph', text: typed.slice(0, -1) }
      ])
    } finally {
      reopened.dispose()
    }
  } finally {
    app.dispose()
  }
})

it.each([
  { command: 'pre', caret: 2 },
  { command: 'paragraph', caret: 2 },
  { command: 'reset-to-paragraph', caret: 9 },
  { command: 'direct', caret: 9 }
])('retains the native $command caret convention', ({ command, caret }) => {
  ;(window as Window & { MUYA_VERSION?: string }).MUYA_VERSION = 'test'
  const host = document.body.appendChild(document.createElement('div'))
  const muya = new Muya(host, { markdown: '```\ncode here\n```\n' })
  muya.init()
  try {
    const block = muya.editor.scrollPage?.queryBlock([0, 'text'])
    if (!block?.isContent()) throw new Error('Expected native code body')
    expect(block.blockName).toBe('codeblock.content')
    block.setCursor(2, 2, true)
    if (command === 'direct') {
      const code = block.closestBlock('code-block')
      if (!code) throw new Error('Expected native code parent')
      muya.resetToParagraph(code)
    } else muya.updateParagraph(command)
    muya.flush()
    expect(muya.getMarkdown()).toBe('code here\n')
    expect(muya.getSelection()).toMatchObject({
      anchor: { offset: caret },
      focus: { offset: caret }
    })
  } finally {
    muya.destroy()
    host.remove()
    document.getSelection()?.removeAllRanges()
  }
})

it('resets the selected repeated code block and preserves the selected range for the next key', async() => {
  const source = '```\ncode here\n```\n\n```\ncode here\n```\n\noutside{>>keep<<}\n'
  const converted = '```\ncode here\n```\n\ncode here\n\noutside{>>keep<<}\n'
  const typed = '```\ncode here\n```\n\ncoxere\n\noutside{>>keep<<}\n'
  const app = bootBoundMuya(source)
  try {
    const block = app.muya.editor.scrollPage?.queryBlock([1, 'text'])
    if (!block?.isContent()) throw new Error('Expected repeated second code body')
    expect(block.blockName).toBe('codeblock.content')
    block.setCursor(2, 6, true)
    app.muya.updateParagraph('pre')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: converted })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 6 } })
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input) throw new Error('Expected second paragraph selection')
    input.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'x',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 3 }, focus: { offset: 3 } })
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 6 } })
    await app.adapter.history('redo', app.reconcile)
    await app.adapter.history('redo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
    const reopened = bootBoundMuya(typed)
    try {
      expect(reopened.muya.getState()).toMatchObject([
        { name: 'code-block', text: 'code here' },
        { name: 'paragraph', text: 'coxere' },
        { name: 'paragraph', text: 'outside' }
      ])
    } finally {
      reopened.dispose()
    }
  } finally {
    app.dispose()
  }
})

it.each(['\n', '\r\n', '\r'])(
  'tracked Code Block toggle selects its new paragraph before the next key (%s)',
  async(ending) => {
    const source = ['```', 'code here', '```', ''].join(ending)
    const converted = ['{~~```', 'code here', '```', '~>code here', '~~}'].join(ending)
    const typed = ['{~~```', 'code here', '```', '~>coxde here', '~~}'].join(ending)
    const app = bootBoundMuya(source)
    app.track(true)
    try {
      const block = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
      if (!block?.isContent()) throw new Error('Expected tracked code body')
      expect(block.blockName).toBe('codeblock.content')
      block.setCursor(2, 2, true)
      app.muya.updateParagraph('pre')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: converted })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 2 } })
      const input = app.muya.editor.selection.getSelection()?.anchor.block
      if (!input) throw new Error('Expected accepted new paragraph')
      expect(input.blockName).toBe('paragraph.content')
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
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: converted })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
      const reopened = bootBoundMuya(typed)
      try {
        expect(reopened.muya.getState()).toContainEqual(
          expect.objectContaining({ name: 'paragraph', text: 'coxde here' })
        )
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)
