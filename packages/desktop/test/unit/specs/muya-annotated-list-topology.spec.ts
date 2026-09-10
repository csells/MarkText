// @vitest-environment jsdom
import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each(
  [
    {
      kind: 'nested bullet to ordered',
      command: 'ol-order',
      source: '- outer\n  - {++first++}{>>keep<<}\n  - second\n',
      expected: '- outer\n  1. {++first++}{>>keep<<}\n  2. second\n'
    },
    {
      kind: 'multiline bullet to ordered',
      command: 'ol-order',
      source: '- {++first++}{>>keep<<}\n\n  ```js\n  let x = 1\n  ```\n- second\n',
      expected: '1. {++first++}{>>keep<<}\n\n   ```js\n   let x = 1\n   ```\n2. second\n'
    },
    {
      kind: 'bullet to ordered',
      command: 'ol-order',
      source: '- {++first++}{>>keep<<}\n- second\n',
      expected: '1. {++first++}{>>keep<<}\n2. second\n'
    },
    {
      kind: 'bullet to task',
      command: 'ul-task',
      source: '- {++first++}{>>keep<<}\n- second\n',
      expected: '- [ ] {++first++}{>>keep<<}\n- [ ] second\n'
    },
    {
      kind: 'ordered to bullet',
      command: 'ul-bullet',
      source: '1. {++first++}{>>keep<<}\n2. second\n',
      expected: '- {++first++}{>>keep<<}\n- second\n'
    },
    {
      kind: 'task to bullet',
      command: 'ul-bullet',
      source: '- [ ] {++first++}{>>keep<<}\n- [x] second\n',
      expected: '- {++first++}{>>keep<<}\n- second\n'
    },
    {
      kind: 'loose to tight',
      command: 'loose-list-item',
      source: '- {++first++}{>>keep<<}\n\n- second\n',
      expected: '- {++first++}{>>keep<<}\n- second\n'
    },
    {
      kind: 'tight to loose',
      command: 'loose-list-item',
      source: '- {++first++}{>>keep<<}\n- second\n',
      expected: '- {++first++}{>>keep<<}\n\n- second\n'
    }
  ].flatMap((example) =>
    ['\n', '\r\n', '\r'].flatMap((ending) =>
      [false, true].map((tracked) => ({ ...example, ending, tracked }))
    )
  )
)(
  'changes $kind with $ending endings (tracked=$tracked) while retaining annotations, typing, and undo',
  async({ command, source: original, expected, ending, tracked }) => {
    const source = original.replaceAll('\n', ending)
    const app = bootBoundMuya(source)
    const { muya, view, binding, adapter, reconcile, legacyChanges } = app
    app.track(tracked)
    try {
      const firstTarget = view().bindings.find((binding) => binding.text === 'first')
      const first = firstTarget && muya.editor.scrollPage?.queryBlock([...firstTarget.path])
      if (!first) throw new Error('Expected first item')
      muya.editor.activeContentBlock = first
      first.setCursor(0, 0, true)
      muya.updateParagraph(command)
      muya.flush()
      const saved = binding.sourceAtBarrier()
      if (saved.type !== 'source') throw new Error('Expected canonical source')
      if (tracked) {
        const core = createDocumentCore()
        const revision = core.open(saved.source)
        expect(core.project(revision, 'revised').markdown).toBe(
          expected.replace('{++first++}{>>keep<<}', 'first').replaceAll('\n', ending)
        )
        expect(core.project(revision, 'original').markdown).toBe(
          source.replace('{++first++}{>>keep<<}', '')
        )
      } else {
        expect(saved.source).toBe(expected.replaceAll('\n', ending))
        expect(muya.domNode.querySelectorAll('ul li, ol li')).toHaveLength(
          source.includes('outer') ? 3 : 2
        )
      }
      expect(legacyChanges).toEqual([])
      expect(muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      const target = view().bindings.find((binding) => binding.text === 'first')
      const item = target && muya.editor.scrollPage?.queryBlock([...target.path])
      if (!item) throw new Error('Expected converted list item')
      muya.editor.activeContentBlock = item
      app.track(false)
      item.setCursor(5, 5, true)
      item.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          data: '!',
          inputType: 'insertText',
          bubbles: true,
          cancelable: true
        })
      )
      muya.flush()
      expect(legacyChanges).toEqual([])
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({
        source: saved.source.replace('{++first++}', '{++first!++}')
      })
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: saved.source })
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
      await adapter.history('redo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: saved.source })
      expect(muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      const reopened = createDocumentCore()
      expect(reopened.open(saved.source).source).toBe(saved.source)
    } finally {
      app.dispose()
    }
  }
)
