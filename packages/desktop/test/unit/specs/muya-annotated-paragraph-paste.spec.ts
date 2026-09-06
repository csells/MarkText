import { describe, expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { sourceEditForMuyaTwoParagraphPaste } from '@/documentAuthority/muyaPlainTextSourceEdit'

describe('ordinary paragraph paste inside existing annotations', () => {
  it.each([
    { source: 'a{++bc++}d\n', expected: 'a{++bOne\n\nTwoc++}d\n', prefix: 2, position: 5 },
    { source: 'a{--bc--}d\n', expected: 'a{--bOne\n\nTwoc--}d\n', prefix: 2, position: 5 },
    { source: 'a{==bc==}d\n', expected: 'a{==bOne\n\nTwoc==}d\n', prefix: 2, position: 5 },
    { source: 'a{~~old~>bc~~}d\n', expected: 'a{~~old~>bOne\n\nTwoc~~}d\n', prefix: 5, position: 10 }
  ])('preserves the owner and exact history for $source', async({ source, expected, prefix, position }) => {
    const actor = createCoreActor()
    const semantic: boolean[] = []
    const binding = createEditorCoreBinding({
      request: request => {
        if (request.type === 'apply') semantic.push(request.markup === true)
        return Promise.resolve(actor.handle(request))
      },
      dispose: () => {}
    })
    await binding.open({ documentId: 'paste.md', source })
    const view = await binding.plainTextViewAtBarrier()
    if (view.type !== 'plain-text-view' || !('state' in view.view)) throw new Error('Missing native view')
    const text = view.view.bindings[0].text
    const suffix = text.slice(prefix)
    const inserted = { name: 'paragraph', text: 'Two' + suffix }
    const change = {
      source: 'user',
      prevDoc: view.view.state,
      doc: [{ name: 'paragraph', text: text.slice(0, prefix) + 'One' }, inserted],
      op: [[0, 'text', { es: [prefix, { d: suffix }, 'One'] }], [1, { i: inserted }]]
    }
    expect(sourceEditForMuyaTwoParagraphPaste(view.view.bindings, change))
      .toEqual({ start: position, end: position, insert: 'One\n\nTwo' })
    const reconcile = async() => {
      const next = await binding.plainTextViewAtBarrier()
      if (next.type !== 'plain-text-view') throw new Error('Missing acknowledged view')
      return next.view.bindings
    }
    const adapter = createMuyaPlainTextCoreAdapter(view.view.bindings, binding, undefined, reconcile)
    try {
      expect(adapter.accept(change)).toBe('accepted')
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(semantic).toEqual([true])
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source })
      await adapter.history('redo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: expected })
    } finally {
      adapter.dispose()
      binding.dispose()
    }
  })
})
