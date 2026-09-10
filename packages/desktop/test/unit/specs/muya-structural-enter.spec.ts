// @vitest-environment jsdom
import { Muya } from '@muyajs/core'
import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import { sourceEditForMuyaStructuralEnter } from '@/documentAuthority/muyaStructuralEnter'
import { createMuyaPlainTextSourceEditAdapter } from '@/documentAuthority/muyaPlainTextSourceEdit'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

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
      it(`preserves the exact source for ${JSON.stringify(example.source)} with batched ${JSON.stringify(typed)}`, () => {
        const core = createDocumentCore()
        const revision = core.open(example.source)
        const view = createMuyaMarkupView(core.project(revision, 'markup'))
        const host = document.createElement('div')
        document.body.append(host)
        const muya = new Muya(host)
        muya.init()
        muya.setContent(structuredClone([...view.state]) as Parameters<Muya['setContent']>[0])
        try {
          const block = muya.editor.scrollPage?.queryBlock([...example.path])
          if (block == null || !block.isContent()) throw new Error('Expected content leaf')
          muya.editor.activeContentBlock = block
          block.setCursor(block.text.length, block.text.length)
          let edit: ReturnType<typeof sourceEditForMuyaStructuralEnter>
          muya.eventCenter.on('json-change', (change: unknown) => {
            edit = sourceEditForMuyaStructuralEnter(view.bindings, change)
          })
          block.enterHandler(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
          )
          if (typed.length > 0) {
            const inserted = muya.editor.activeContentBlock
            if (inserted === undefined || inserted === null) { throw new Error('Expected new content leaf') }
            inserted.domNode.textContent = typed
            inserted.setCursor(typed.length, typed.length)
            inserted.inputHandler(
              new InputEvent('input', { data: typed, inputType: 'insertText', bubbles: true })
            )
          }
          muya.flush()
          expect(edit).toBeDefined()
          const next = core.apply(revision, [edit!.edit]).revision
          const ending = example.source.endsWith('\r\n') ? '\r\n' : '\n'
          expect(next.source).toBe(example.expected.slice(0, -ending.length) + typed + ending)
          const nextView = createMuyaMarkupView(core.project(next, 'markup'))
          const newBinding = nextView.bindings.at(-1)!
          expect(newBinding.sourceRange).toEqual(edit!.bindings.at(-1)!.sourceRange)
          const native = createMuyaPlainTextSourceEditAdapter(edit!.bindings.at(-1)!)
          let following: ReturnType<typeof native.accept> | undefined
          muya.eventCenter.on('json-change', (change: unknown) => {
            following = native.accept(change)
          })
          const inserted = muya.editor.activeContentBlock!
          inserted.domNode.textContent = typed + 'x'
          inserted.setCursor(typed.length + 1, typed.length + 1)
          inserted.inputHandler(
            new InputEvent('input', { data: 'x', inputType: 'insertText', bubbles: true })
          )
          muya.flush()
          expect(following).toEqual({
            kind: 'edit',
            edit: {
              start: newBinding.sourceRange.end,
              end: newBinding.sourceRange.end,
              insert: 'x'
            }
          })
        } finally {
          muya.destroy()
          muya.domNode.remove()
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
