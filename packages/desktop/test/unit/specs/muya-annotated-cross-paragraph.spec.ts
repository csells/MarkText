import { describe, expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'
import { sourceEditForMuyaCrossParagraphChange } from '@/documentAuthority/muyaPlainTextSourceEdit'

describe('ordinary native replacement across annotated paragraphs', () => {
  it.each([
    { source: 'a{++bc++}\n\ndef\n', expected: 'a{++bX++}f\n', start: 5, end: 13 },
    { source: 'a{--bc--}\n\ndef\n', expected: 'a{--bX--}f\n', start: 5, end: 13 },
    { source: 'a{==bc==}\n\ndef\n', expected: 'a{==bX==}f\n', start: 5, end: 13 },
    { source: 'a{~~old~>bc~~}\n\ndef\n', expected: 'a{~~old~>bX~~}f\n', start: 10, end: 18 },
    { source: 'a{++b{>>note<<}c++}\n\ndef\n', expected: 'a{++b{>>note<<}X++}f\n', start: 15, end: 23 },
    { source: 'abc\n\n{++def++}g\n', expected: 'abX{++f++}g\n', start: 2, end: 10, suffix: 'fg' }
  ])('preserves partial wrappers and history for $source', async({ source, expected, start, end, suffix = 'f' }) => {
    const actor = createCoreActor()
    const requests: string[] = []
    const binding = createEditorCoreBinding({
      request: request => {
        requests.push(request.type === 'apply' && request.markup === true ? 'markup-edits' : request.type)
        return Promise.resolve(actor.handle(request))
      },
      dispose: () => {}
    })
    await binding.open({ documentId: 'cross-paragraph.md', source })
    const initial = await binding.plainTextViewAtBarrier()
    if (initial.type !== 'plain-text-view' || !('state' in initial.view)) throw new Error('Missing native view')
    const first = initial.view.bindings[0].text
    const change = {
      source: 'user',
      prevDoc: initial.view.state,
      doc: [{ name: 'paragraph', text: first.slice(0, -1) + 'X' + suffix }],
      op: [[0, 'text', { es: [first.length - 1, { d: first.slice(-1) }, 'X' + suffix] }], [1, { r: true }]]
    }
    expect(sourceEditForMuyaCrossParagraphChange(initial.view.bindings, change)).toEqual({ start, end, insert: 'X' })
    const reconcile = async() => {
      const reply = await binding.plainTextViewAtBarrier()
      if (reply.type !== 'plain-text-view') throw new Error('Missing acknowledged view')
      return reply.view.bindings
    }
    const adapter = createMuyaPlainTextCoreAdapter(initial.view.bindings, binding, undefined, reconcile)
    try {
      expect(adapter.accept(change)).toBe('accepted')
      await adapter.settled()
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: expected })
      expect(requests).toContain('markup-edits')
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
