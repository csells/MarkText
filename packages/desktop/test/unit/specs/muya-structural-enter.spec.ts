// @vitest-environment happy-dom
import { Muya } from '@muyajs/core'
import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import { sourceEditForMuyaStructuralEnter } from '@/documentAuthority/muyaStructuralEnter'
import { createMuyaPlainTextSourceEditAdapter } from '@/documentAuthority/muyaPlainTextSourceEdit'

for (const example of [
  { source: '# Heading\n', path: [0, 'text'], expected: '# Heading\n\n\n' },
  { source: '- item\n', path: [0, 'children', 0, 'children', 0, 'text'], expected: '- item\n- \n' },
  { source: '- item\r\n', path: [0, 'children', 0, 'children', 0, 'text'], expected: '- item\r\n- \r\n' },
  { source: '- [x] item\n', path: [0, 'children', 0, 'children', 0, 'text'], expected: '- [x] item\n- [ ] \n' },
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
          block.enterHandler(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
          if (typed.length > 0) {
            const inserted = muya.editor.activeContentBlock
            if (inserted === undefined || inserted === null) throw new Error('Expected new content leaf')
            inserted.domNode.textContent = typed
            inserted.setCursor(typed.length, typed.length)
            inserted.inputHandler(new InputEvent('input', { data: typed, inputType: 'insertText', bubbles: true }))
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
          muya.eventCenter.on('json-change', (change: unknown) => { following = native.accept(change) })
          const inserted = muya.editor.activeContentBlock!
          inserted.domNode.textContent = typed + 'x'
          inserted.setCursor(typed.length + 1, typed.length + 1)
          inserted.inputHandler(new InputEvent('input', { data: 'x', inputType: 'insertText', bubbles: true }))
          muya.flush()
          expect(following).toEqual({
            kind: 'edit',
            edit: {
              start: newBinding.sourceRange.end, end: newBinding.sourceRange.end, insert: 'x'
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
  { source: '- item\n', path: [0, 'children', 0, 'children', 0, 'text'], expected: '- item{++\n- next++}\n' }
]) {
  it(`tracks native Enter and continued typing through the real actor for ${JSON.stringify(example.source)}`, async() => {
    const { createCoreActor } = await import('@/documentAuthority/coreActor')
    const { createEditorCoreBinding } = await import('@/documentAuthority/editorCoreBinding')
    const { createMuyaPlainTextCoreAdapter } = await import('@/documentAuthority/muyaPlainTextCoreAdapter')
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => {} })
    await binding.open({ documentId: 'structural-track.md', source: example.source })
    const first = await binding.plainTextViewAtBarrier()
    if (first.type !== 'plain-text-view' || !('state' in first.view)) throw new Error('Expected typed view')
    const host = document.createElement('div')
    document.body.append(host)
    const muya = new Muya(host)
    muya.init()
    muya.setContent(structuredClone([...first.view.state]) as Parameters<Muya['setContent']>[0])
    const reconcile = async() => {
      const next = await binding.plainTextViewAtBarrier()
      if (next.type !== 'plain-text-view' || !('state' in next.view)) throw new Error('Expected typed view')
      if (!adapter.hasPendingEdits()) {
        muya.setContent(structuredClone([...next.view.state]) as Parameters<Muya['setContent']>[0])
        const last = next.view.bindings.at(-1)!
        const content = muya.editor.scrollPage?.queryBlock([...last.path])
        if (content?.isContent()) content.setCursor(last.text.length, last.text.length)
      }
      return next.view.bindings
    }
    const adapter = createMuyaPlainTextCoreAdapter(first.view.bindings, binding, undefined, reconcile)
    const admissions: string[] = []
    muya.eventCenter.on('json-change', (change: unknown) => { admissions.push(adapter.acceptTracked(change, reconcile)) })
    try {
      const content = muya.editor.scrollPage?.queryBlock([...example.path])
      if (content == null || !content.isContent()) throw new Error('Expected content leaf')
      muya.editor.activeContentBlock = content
      content.setCursor(content.text.length, content.text.length)
      content.enterHandler(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      muya.flush()
      for (const character of 'next') {
        const inserted = muya.editor.activeContentBlock!
        const text = inserted.text + character
        inserted.domNode.textContent = text
        inserted.setCursor(text.length, text.length)
        inserted.inputHandler(new InputEvent('input', { data: character, inputType: 'insertText', bubbles: true }))
        muya.flush()
      }
      expect(admissions).toEqual(['accepted', 'accepted', 'accepted', 'accepted', 'accepted'])
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: example.expected })
    } finally {
      adapter.dispose()
      muya.destroy()
      muya.domNode.remove()
    }
  })
}
