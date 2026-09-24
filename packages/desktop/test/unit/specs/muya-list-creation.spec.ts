// @vitest-environment jsdom
import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

const containers = [
  { command: 'ul-bullet', prefix: '- ', selector: 'ul li' },
  { command: 'ol-order', prefix: '1. ', selector: 'ol li' },
  { command: 'ul-task', prefix: '- [ ] ', selector: 'ul li' }
]

it.each(
  containers.flatMap((container) => [false, true].map((tracked) => ({ ...container, tracked })))
)(
  'formats and edits a multiline addition as $command through the model (tracked=$tracked)',
  async({ command, prefix, selector, tracked }) => {
    const source = '{++first\nsecond++}\n'
    const app = bootBoundMuya(source)
    const { muya, binding, adapter, reconcile, legacyChanges } = app
    app.track(tracked)
    try {
      const block = muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Expected paragraph')
      muya.editor.activeContentBlock = block
      block.setCursor(block.text.length, block.text.length, true)
      muya.updateParagraph(command)
      muya.flush()
      // Upstream MarkText indents continuation lines by the marker's width.
      const indent = ' '.repeat(prefix.startsWith('1') ? 3 : 2)
      const formatted = tracked
        ? `{++${prefix}first\n${indent}second++}\n`
        : `${prefix}{++first\n${indent}second++}\n`
      expect(binding.sourceAtBarrier()).toMatchObject({ source: formatted })
      expect(legacyChanges).toEqual([])
      expect(muya.getState()).toEqual(app.view().state)
      expect(muya.domNode.querySelector(selector)).not.toBeNull()
      const live = muya.editor.selection.getSelection()?.anchor.block
      if (!live?.domNode?.isConnected) throw new Error('Expected the resulting live item selection')
      live.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          data: '!',
          inputType: 'insertText',
          bubbles: true,
          cancelable: true
        })
      )
      expect(binding.sourceAtBarrier()).toMatchObject({
        source: formatted.replace('second', 'second!')
      })
      await adapter.history('undo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: formatted })
      await adapter.history('undo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source })
      expect(legacyChanges).toEqual([])
    } finally {
      app.dispose()
    }
  }
)

it.each([
  { command: 'ul-bullet', source: 'alpha\n', expected: '- alpha\n' },
  { command: 'ol-order', source: 'alpha\nbeta\n', expected: '1. alpha\n   beta\n' },
  { command: 'ul-task', source: 'alpha\n', expected: '- [ ] alpha\n' }
])(
  'converts a plain paragraph with $command without a native tree mutation',
  ({ command, source, expected }) => {
    const app = bootBoundMuya(source)
    try {
      const block = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (!block) throw new Error('Expected paragraph')
      app.muya.editor.activeContentBlock = block
      block.setCursor(2, 2, true)
      app.muya.updateParagraph(command)
      app.muya.flush()
      expect(app.binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(app.legacyChanges).toEqual([])
      expect(app.muya.getState()).toEqual(app.view().state)
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 2 } })
    } finally {
      app.dispose()
    }
  }
)

it.each([false, true])(
  'unlists with the caret at the end of an annotated item (tracked=%s)',
  (tracked) => {
    const source = '- {++first++}{>>keep<<}\n- second\n'
    const app = bootBoundMuya(source)
    app.track(tracked)
    try {
      const first = app.muya.editor.scrollPage?.firstContentInDescendant()
      if (!first) throw new Error('Expected first item')
      app.muya.editor.activeContentBlock = first
      first.setCursor(first.text.length, first.text.length, true)
      app.muya.updateParagraph('ul-bullet')
      app.muya.flush()
      expect(app.legacyChanges).toEqual([])
      const saved = app.binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Expected canonical source')
      if (!tracked) expect(saved.source).toBe('{++first++}{>>keep<<}\n\nsecond\n')
      const live = app.muya.editor.selection.getSelection()?.anchor.block
      if (!live?.domNode?.isConnected) {
        throw new Error('Expected the resulting live paragraph selection')
      }
      expect(live.text).toBe('first')
      expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 5 }, focus: { offset: 5 } })
      app.track(false)
      live.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          data: 'X',
          inputType: 'insertText',
          bubbles: true,
          cancelable: true
        })
      )
      const core = createDocumentCore()
      const typed = app.binding.sourceAtBarrier()
      if (typed.type !== 'source') throw new Error('Expected canonical source')
      expect(core.project(core.open(typed.source), 'revised').markdown).toBe('firstX\n\nsecond\n')
    } finally {
      app.dispose()
    }
  }
)

it('Tab nests the second ordered item as a new list starting at 1', () => {
  const app = bootBoundMuya('1. alpha\n2. beta\n')
  try {
    const block = app.muya.editor.scrollPage?.firstContentInDescendant()?.nextContentInContext()
    if (!block) throw new Error('Expected second item')
    block.setCursor(2, 2, true)
    block.domNode.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '1. alpha\n   1. beta\n' })
    expect(app.muya.domNode.querySelectorAll('ol li ol li')).toHaveLength(1)
    expect(app.muya.getSelection()).toMatchObject({ anchor: { offset: 2 }, focus: { offset: 2 } })
    expect(app.legacyChanges).toEqual([])
  } finally {
    app.dispose()
  }
})
