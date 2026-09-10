// @vitest-environment jsdom
import { ParagraphFrontMenu } from '@muyajs/core'
import { createDocumentCore } from '@marktext/document-core'
import { afterEach, expect, it, vi } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

afterEach(() => vi.unstubAllGlobals())

it.each([
  { source: '{==plain==}\n', typed: '{==plainX==}\n' },
  { source: '{~~old~>new~~}\n', typed: '{~~old~>newX~~}\n' },
  { source: '{>>note<<}{++plain++}\n', typed: '{>>note<<}{++plainX++}\n' }
])('preserves the annotation-end caret without a quote command: $source', ({ source, typed }) => {
  const app = bootBoundMuya(source)
  try {
    const content = app.muya.editor.scrollPage?.firstContentInDescendant()
    if (!content) throw new Error('Expected annotated paragraph')
    content.setCursor(content.text.length, content.text.length, true)
    content.domNode.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'X',
        bubbles: true,
        cancelable: true
      })
    )
    expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
  } finally {
    app.dispose()
  }
})

for (const [content, typedContent] of [
  ['{==plain==}', '{==plainX==}'],
  ['{~~old~>new~~}', '{~~old~>newX~~}'],
  ['{>>note<<}{++plain++}', '{>>note<<}{++plainX++}']
]) {
  it.each(['front', 'Format'] as const)(
    `quotes the entire annotated paragraph through %s: ${content}`,
    async(surface) => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        }
      )
      const source = content + '\n'
      const app = bootBoundMuya(source)
      const menu = surface === 'front' ? new ParagraphFrontMenu(app.muya) : undefined
      try {
        const block = app.muya.editor.scrollPage?.firstContentInDescendant()
        if (!block) throw new Error('Expected annotated paragraph')
        const visibleLength = block.text.length
        block.setCursor(block.text.length, block.text.length, true)
        app.muya.editor.activeContentBlock = block
        if (menu) {
          app.muya.eventCenter.emit('muya-front-menu', {
            reference: block.domNode,
            block: block.parent
          })
          await new Promise((resolve) => setTimeout(resolve, 0))
          menu.selectItem(new MouseEvent('click'), { label: 'block-quote' })
        } else app.muya.updateParagraph('blockquote')
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '> ' + source })
        if (content === '{~~old~>new~~}') {
          expect(app.muya.getState()).toMatchObject([
            { name: 'block-quote', children: [{ name: 'paragraph', text: 'oldnew' }] }
          ])
        }
        expect(app.muya.getSelection()).toMatchObject({
          anchor: { offset: visibleLength },
          focus: { offset: visibleLength }
        })
        expect(app.legacyChanges).toEqual([])
        const core = createDocumentCore()
        const previous = core.open(source)
        const quoted = core.open('> ' + source)
        for (const projection of ['original', 'revised'] as const) {
          expect(core.project(quoted, projection).markdown).toBe(
            '> ' + core.project(previous, projection).markdown
          )
        }
        const selected = app.muya.editor.selection.getSelection()?.anchor.block
        if (!selected?.domNode?.isConnected) throw new Error('Expected live quoted paragraph')
        selected.domNode.dispatchEvent(
          new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: 'X',
            bubbles: true,
            cancelable: true
          })
        )
        const typed = '> ' + typedContent + '\n'
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
        expect(app.muya.getSelection()).toMatchObject({
          anchor: { offset: visibleLength + 1 },
          focus: { offset: visibleLength + 1 }
        })
        expect(app.legacyChanges).toEqual([])
        await app.adapter.history('undo', app.reconcile)
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: '> ' + source })
        await app.adapter.history('undo', app.reconcile)
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source })
        await app.adapter.history('redo', app.reconcile)
        await app.adapter.history('redo', app.reconcile)
        expect(app.binding.sourceAtBarrier()).toMatchObject({ source: typed })
        expect(core.open(typed).source).toBe(typed)
      } finally {
        menu?.destroy()
        app.dispose()
      }
    }
  )
}
