// @vitest-environment jsdom
import { createDocumentCore } from '@marktext/document-core'
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

it.each(
  [
    {
      kind: 'bullet',
      command: 'ul-bullet',
      source: '- {++first++}{>>keep<<}\n- second\n',
      expected: '{++first++}{>>keep<<}\n\nsecond\n'
    },
    {
      kind: 'ordered',
      command: 'ol-order',
      source: '1. {++first++}{>>keep<<}\n2. second\n',
      expected: '{++first++}{>>keep<<}\n\nsecond\n'
    },
    {
      kind: 'task',
      command: 'ul-task',
      source: '- [X] {++first++}{>>keep<<}\n- [ ] second\n',
      expected: '{++first++}{>>keep<<}\n\nsecond\n'
    },
    {
      kind: 'code',
      command: 'ul-bullet',
      source: '- {++first++}{>>keep<<}\n\n  ```js\n  const x = 1\n  ```\n- second\n',
      expected: '{++first++}{>>keep<<}\n\n```js\nconst x = 1\n```\n\nsecond\n'
    },
    {
      kind: 'quote',
      command: 'ul-bullet',
      source: '- {++first++}{>>keep<<}\n\n  > quoted\n  > continued\n- second\n',
      expected: '{++first++}{>>keep<<}\n\n> quoted\n> continued\n\nsecond\n'
    }
  ].flatMap((example) =>
    ['\n', '\r\n', '\r'].flatMap((ending) =>
      [false, true].map((tracked) => ({ ...example, ending, tracked }))
    )
  )
)(
  'removes $kind list formatting with $ending endings (tracked=$tracked) while preserving annotated items',
  async({ command, source: original, expected, ending, tracked }) => {
    const source = original.replaceAll('\n', ending)
    const app = bootBoundMuya(source)
    const { muya, binding, adapter, reconcile, legacyChanges } = app
    app.track(tracked)
    try {
      const first = muya.editor.scrollPage?.firstContentInDescendant()
      if (!first) throw new Error('Expected first item')
      muya.editor.activeContentBlock = first
      first.setCursor(0, 0, true)
      muya.updateParagraph(command)
      muya.flush()
      expect(legacyChanges).toEqual([])
      expect(muya.getState()).toEqual(app.view().state)
      expect(muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
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
        expect(muya.domNode.querySelectorAll('ul li, ol li')).toHaveLength(0)
      }
      // Use the resulting model selection immediately, without reselection or
      // an acknowledgement wait after the list command.
      app.track(false)
      const liveTarget = muya.editor.selection.getSelection()?.anchor.block.domNode
      if (!liveTarget?.isConnected) { throw new Error('Expected the resulting live paragraph selection') }
      liveTarget.dispatchEvent(
        new InputEvent('beforeinput', {
          data: 'X',
          inputType: 'insertText',
          bubbles: true,
          cancelable: true
        })
      )
      const at = saved.source.lastIndexOf('first')
      const typed = saved.source.slice(0, at) + 'X' + saved.source.slice(at)
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
      const core = createDocumentCore()
      const reopened = core.open(typed)
      expect(core.project(reopened, 'revised').markdown).toBe(
        expected.replace('{++first++}{>>keep<<}', 'Xfirst').replaceAll('\n', ending)
      )
    } finally {
      app.dispose()
    }
  }
)
