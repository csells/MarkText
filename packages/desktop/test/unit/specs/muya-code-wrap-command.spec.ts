// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it('keeps the adjacent preceding code block outside a selected wrap', async() => {
  const preceding = '```\npreceding\n```\n'
  const source = preceding + '# first\n\nsecond\n\noutside{>>keep<<}\n'
  const wrapped = preceding + '```\n# first\n\nsecond\n```\n\noutside{>>keep<<}\n'
  const typed = preceding + '```\nx# first\n\nsecond\n```\n\noutside{>>keep<<}\n'
  const app = bootBoundMuya(source)
  try {
    const first = app.muya.editor.scrollPage?.queryBlock([1, 'text'])
    const second = app.muya.editor.scrollPage?.queryBlock([2, 'text'])
    if (!first?.isContent() || !second?.isContent()) { throw new Error('Expected selected blocks after the existing code') }
    app.muya.editor.activeContentBlock = second
    app.muya.editor.selection.setSelection(
      { offset: 0, block: first, path: first.path },
      { offset: second.text.length, block: second, path: second.path }
    )
    app.muya.updateParagraph('pre')
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: wrapped })
    const input = app.muya.editor.selection.getSelection()?.anchor.block
    if (!input) throw new Error('Expected newly wrapped code body')
    expect(input.text).toBe('# first\n\nsecond')
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
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
    app.muya.flush()
    expect(app.legacyChanges).toEqual([])
    await app.adapter.history('undo', app.reconcile)
    await app.adapter.history('undo', app.reconcile)
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
    await app.adapter.history('redo', app.reconcile)
    await app.adapter.history('redo', app.reconcile)
    const saved = app.binding.sourceAtBarrier()
    if (saved.type !== 'source') throw new Error('Expected acknowledged source')
    expect(saved.source).toBe(typed)
    const reopened = bootBoundMuya(saved.source)
    try {
      expect(reopened.muya.getState()).toMatchObject([
        { name: 'code-block', text: 'preceding' },
        { name: 'code-block', text: 'x# first\n\nsecond' },
        { name: 'paragraph', text: 'outside' }
      ])
    } finally {
      reopened.dispose()
    }
  } finally {
    app.dispose()
  }
})

it.each(
  ['\n', '\r\n', '\r'].flatMap((ending) => [false, true].map((tracked) => ({ ending, tracked })))
)(
  'wraps selected blocks through the live model before the next key ($ending Track=$tracked)',
  async({ ending, tracked }) => {
    const source = '# T\n\na{++b++}c{>>note<<}\n\noutside{>>keep<<}\n'.replaceAll('\n', ending)
    const wrapped = (
      tracked
        ? '{~~# T\n\na{++b++}c{>>note<<}~>```\n# T\n\na{++b++}c{>>note<<}\n```~~}\n\noutside{>>keep<<}\n'
        : '```\n# T\n\na{++b++}c{>>note<<}\n```\n\noutside{>>keep<<}\n'
    ).replaceAll('\n', ending)
    const typed = wrapped.replace('```' + ending + '# T', '```' + ending + 'x# T')
    const app = bootBoundMuya(source)
    try {
      app.track(tracked)
      const first = app.muya.editor.scrollPage?.queryBlock([0, 'text'])
      const second = app.muya.editor.scrollPage?.queryBlock([1, 'text'])
      if (!first?.isContent() || !second?.isContent()) { throw new Error('Expected selected document blocks') }
      app.muya.editor.activeContentBlock = second
      app.muya.editor.selection.setSelection(
        { offset: 0, block: first, path: first.path },
        { offset: second.text.length, block: second, path: second.path }
      )
      app.muya.updateParagraph('pre')
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: wrapped })
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      const input = app.muya.editor.selection.getSelection()?.anchor.block
      if (!input) throw new Error('Expected wrapped code body')
      expect(input.blockName).toBe('codeblock.content')
      expect(input.text).toBe('# T\n\na{++b++}c{>>note<<}')
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
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: wrapped })
      await app.adapter.history('undo', app.reconcile)
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
      await app.adapter.history('redo', app.reconcile)
      await app.adapter.history('redo', app.reconcile)
      const saved = app.binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Expected acknowledged source')
      expect(saved.source).toBe(typed)
      const reopened = bootBoundMuya(saved.source)
      try {
        const state = reopened.muya.getState()
        expect(
          state.filter((block: { name: string }) => block.name === 'code-block')
        ).toMatchObject([{ name: 'code-block', text: 'x# T\n\na{++b++}c{>>note<<}' }])
        expect(state.at(-1)).toMatchObject({ name: 'paragraph', text: 'outside' })
      } finally {
        reopened.dispose()
      }
    } finally {
      app.dispose()
    }
  }
)
