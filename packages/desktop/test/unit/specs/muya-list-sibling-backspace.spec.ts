// @vitest-environment jsdom
import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each(
  [
    {
      name: 'ordinary first item',
      source: '- target\n- same\n- final\n',
      expected: 'target\n\n- same\n- final\n',
      target: 0
    },
    {
      name: 'ordinary middle item',
      source: '- same\n- target\n- final\n',
      expected: '- same\n\n  target\n- final\n',
      target: 1
    },
    {
      name: 'first bullet item',
      source: '- {++sa++}me{>>keep<<}\n- same\n- final\n',
      expected: '{++sa++}me{>>keep<<}\n\n- same\n- final\n',
      target: 0
    },
    {
      name: 'middle bullet item',
      source: '- same\n- {++sa++}me{>>keep<<}\n- final\n',
      expected: '- same\n\n  {++sa++}me{>>keep<<}\n- final\n',
      target: 1
    },
    {
      name: 'first ordered item',
      source: '8) {++sa++}me{>>keep<<}\n9) same\n10) final\n',
      expected: '{++sa++}me{>>keep<<}\n\n8) same\n9) final\n',
      target: 0
    },
    {
      name: 'middle ordered item',
      source: '8) same\n9) {++sa++}me{>>keep<<}\n10) final\n',
      expected: '8) same\n\n   {++sa++}me{>>keep<<}\n9) final\n',
      target: 1
    },
    {
      name: 'first task item',
      source: '- [x] {++sa++}me{>>keep<<}\n- [ ] same\n- [x] final\n',
      expected: '{++sa++}me{>>keep<<}\n\n- [ ] same\n- [x] final\n',
      target: 0
    },
    {
      name: 'middle task item',
      source: '- [x] same\n- [ ] {++sa++}me{>>keep<<}\n- [x] final\n',
      expected: '- [x] same\n\n  {++sa++}me{>>keep<<}\n- [x] final\n',
      target: 1
    },
    {
      name: 'nested first item',
      source: '- outer\n  - {++sa++}me{>>keep<<}\n  - same\n- final\n',
      expected: '- outer\n\n  {++sa++}me{>>keep<<}\n  - same\n- final\n',
      target: 1
    },
    {
      name: 'multiline middle item',
      source: '- same\n- {++sa++}me{>>keep<<}\n  continuation\n\n  second\n- final\n',
      expected: '- same\n\n  {++sa++}me{>>keep<<}\n  continuation\n\n  second\n- final\n',
      target: 1
    }
  ].flatMap((example) =>
    ['\n', '\r\n', '\r'].flatMap((eol) =>
      [false, true].flatMap((tracked) =>
        (tracked ? [false, true] : [false]).map((typingTracked) => ({
          ...example,
          eol,
          tracked,
          typingTracked
        }))
      )
    )
  )
)(
  'Backspace at $name preserves source, following input and history ($eol tracked=$tracked typingTracked=$typingTracked)',
  async({ source: original, expected: output, target, eol, tracked, typingTracked }) => {
    const source = original.replaceAll('\n', eol)
    const expected = output.replaceAll('\n', eol)
    const app = bootBoundMuya(source)
    const { muya, adapter, binding, reconcile, legacyChanges } = app
    const core = createDocumentCore()
    app.track(tracked)
    try {
      let paragraph = muya.editor.scrollPage!.firstContentInDescendant()!
      for (let index = 0; index < target; index++) paragraph = paragraph.nextContentInContext()!
      paragraph.setCursor(0, 0, true)
      paragraph.domNode.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
      )
      expect(legacyChanges).toEqual([])
      expect(muya.getState()).toEqual(app.view().state)
      const saved = binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Expected authoritative source')
      if (!tracked) expect(saved.source).toBe(expected)
      else {
        expect(core.project(core.open(saved.source), 'revised').markdown).toBe(
          expected.replace('{++sa++}me{>>keep<<}', 'same')
        )
        expect(core.project(core.open(saved.source), 'original').markdown).toBe(
          source.replace('{++sa++}me{>>keep<<}', 'me')
        )
      }
      expect(muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      const live = muya.editor.selection.getSelection()?.anchor.block.domNode
      if (!live?.isConnected) throw new Error('Missing live selection after Backspace')
      app.track(typingTracked)
      live.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: 'X',
          bubbles: true,
          cancelable: true
        })
      )
      const at = saved.source.lastIndexOf(source.includes('{++sa++}') ? 'sa++}' : 'target')
      const inserted = typingTracked && !source.includes('{++sa++}') ? '{++X++}' : 'X'
      const typed = saved.source.slice(0, at) + inserted + saved.source.slice(at)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(muya.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 1 } })
      expect(legacyChanges).toEqual([])
      await adapter.history('undo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: saved.source })
      await adapter.history('undo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source })
      await adapter.history('redo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: saved.source })
      await adapter.history('redo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: typed })
      expect(core.project(core.open(typed), 'revised').markdown).toBe(
        source.includes('{++sa++}')
          ? expected.replace('{++sa++}me{>>keep<<}', 'Xsame')
          : expected.replace('target', 'Xtarget')
      )
    } finally {
      app.dispose()
    }
  }
)
