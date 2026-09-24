// @vitest-environment jsdom
import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

const typeText = (muya: ReturnType<typeof bootBoundMuya>['muya'], text: string): void => {
  for (const character of text) {
    const target = muya.editor.selection.getSelection()?.anchor.block.domNode
    if (!target?.isConnected) throw new Error('Expected live selection')
    target.dispatchEvent(
      new InputEvent('beforeinput', {
        data: character,
        inputType: 'insertText',
        bubbles: true,
        cancelable: true
      })
    )
  }
}

for (const example of [
  { source: '# Heading\n', path: [0, 'text'], expected: '# Heading\n\n\n' },
  { source: '- item\n', path: [0, 'children', 0, 'children', 0, 'text'], expected: '- item\n- \n' },
  {
    source: '- item\r\n',
    path: [0, 'children', 0, 'children', 0, 'text'],
    expected: '- item\r\n- \r\n'
  },
  {
    source: '- [x] item\n',
    path: [0, 'children', 0, 'children', 0, 'text'],
    expected: '- [x] item\n- [ ] \n'
  },
  { source: '+ item\n', path: [0, 'children', 0, 'children', 0, 'text'], expected: '+ item\n+ \n' }
]) {
  for (const typed of ['', 'n']) {
    describe('native structural Enter', () => {
      it(`preserves the exact source for ${JSON.stringify(example.source)} with typed ${JSON.stringify(typed)}`, async() => {
        const app = bootBoundMuya(example.source)
        const { muya, binding, adapter, legacyChanges } = app
        try {
          const content = muya.editor.scrollPage?.queryBlock([...example.path])
          if (content == null || !content.isContent()) throw new Error('Expected content leaf')
          content.setCursor(content.text.length, content.text.length, true)
          content.domNode.dispatchEvent(
            new InputEvent('beforeinput', {
              inputType: 'insertParagraph',
              data: null,
              bubbles: true,
              cancelable: true
            })
          )
          const ending = example.source.endsWith('\r\n') ? '\r\n' : '\n'
          const expected = (following: string) =>
            example.expected.slice(0, -ending.length) + following + ending
          expect(binding.sourceAtBarrier()).toMatchObject({ source: expected('') })
          typeText(muya, typed)
          expect(binding.sourceAtBarrier()).toMatchObject({ source: expected(typed) })
          // The next key uses the model's resulting selection at the new leaf's end.
          typeText(muya, 'x')
          await adapter.settled()
          expect(binding.sourceAtBarrier()).toMatchObject({ source: expected(typed + 'x') })
          expect(muya.getSelection()).toMatchObject({
            anchor: { offset: typed.length + 1 },
            focus: { offset: typed.length + 1 }
          })
          expect(legacyChanges).toEqual([])
        } finally {
          app.dispose()
        }
      })
    })
  }
}

for (const example of [
  { source: '# Heading\n', path: [0, 'text'], expected: '# Heading{++\n\nnext++}\n' },
  {
    source: '- item\n',
    path: [0, 'children', 0, 'children', 0, 'text'],
    expected: '- item{++\n- next++}\n'
  }
]) {
  it(`tracks native Enter and continued typing through the production owner for ${JSON.stringify(example.source)}`, async() => {
    const app = bootBoundMuya(example.source)
    const { muya, binding, adapter, reconcile, legacyChanges } = app
    app.track(true)
    try {
      const content = muya.editor.scrollPage?.queryBlock([...example.path])
      if (content == null || !content.isContent()) throw new Error('Expected content leaf')
      content.setCursor(content.text.length, content.text.length, true)
      content.domNode.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      )
      content.domNode.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertParagraph',
          data: null,
          bubbles: true,
          cancelable: true
        })
      )
      const afterEnter = example.expected.replace('next', '')
      expect(binding.sourceAtBarrier()).toMatchObject({ source: afterEnter })
      expect(muya.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 0 } })
      for (const character of 'next') {
        const target = muya.editor.selection.getSelection()?.anchor.block.domNode
        if (!target?.isConnected) throw new Error('Expected live selection after Enter')
        target.dispatchEvent(
          new InputEvent('beforeinput', {
            data: character,
            inputType: 'insertText',
            bubbles: true,
            cancelable: true
          })
        )
      }
      expect(binding.sourceAtBarrier()).toMatchObject({ source: example.expected })
      expect(muya.getSelection()).toMatchObject({ anchor: { offset: 4 }, focus: { offset: 4 } })
      expect(legacyChanges).toEqual([])
      await adapter.settled()
      expect(binding.sourceAtBarrier()).toMatchObject({ source: example.expected })
      await adapter.history('undo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: afterEnter })
      await adapter.history('undo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: example.source })
      await adapter.history('redo', reconcile)
      await adapter.history('redo', reconcile)
      expect(binding.sourceAtBarrier()).toMatchObject({ source: example.expected })
      const core = createDocumentCore()
      const reopened = core.open(example.expected)
      expect(core.project(reopened, 'original').markdown).toBe(example.source)
      expect(core.project(reopened, 'revised').markdown).toBe(
        example.expected.replace('{++', '').replace('++}', '')
      )
    } finally {
      app.dispose()
    }
  })
}
