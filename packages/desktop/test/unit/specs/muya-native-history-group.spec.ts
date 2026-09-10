// @vitest-environment happy-dom
import { Muya } from '@muyajs/core'
import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'

it.each(['ordinary', 'tracked'] as const)(
  'preserves the actual native %s typing group across every authority acknowledgement',
  async(lane) => {
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({
      request: (request) => actor.handle(request),
      dispose: () => {}
    })
    await binding.open({ documentId: 'native-group.md', source: 'seed\n' })
    const initial = binding.plainTextViewAtBarrier()
    if (initial.type !== 'plain-text-view' || !('state' in initial.view)) { throw new Error('Missing typed view') }
    const host = document.createElement('div')
    document.body.append(host)
    const muya = new Muya(host)
    muya.init()
    muya.setContent(structuredClone([...initial.view.state]))
    const reconcile = () => {
      const next = binding.plainTextViewAtBarrier()
      if (next.type !== 'plain-text-view' || !('state' in next.view)) { throw new Error('Missing typed view') }
      if (!adapter.hasPendingEdits()) {
        muya.setContent(structuredClone([...next.view.state]), false, {
          preserveInputGrouping: true
        })
      }
      return next.view.bindings
    }
    const adapter = createMuyaPlainTextCoreAdapter(
      initial.view.bindings,
      binding,
      undefined,
      reconcile
    )
    muya.on('json-change', (change: object) => {
      const group = muya.getInputHistoryGroup()
      expect(group).toEqual(expect.any(Number))
      const native = { ...change, nativeHistoryGroup: `one-view:${group}` }
      expect(
        lane === 'ordinary' ? adapter.accept(native) : adapter.acceptTracked(native, reconcile)
      ).toBe('accepted')
    })
    try {
      for (const text of 'ABC') {
        const block = muya.editor.scrollPage.queryBlock([0, 'text'])
        if (!block?.isContent()) throw new Error('Missing text')
        muya.editor.history.markInputBoundary('insertText', text)
        block.text += text
        muya.flush()
        await adapter.settled()
      }
      const expected = lane === 'ordinary' ? 'seedABC\n' : 'seed{++ABC++}\n'
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: expected })
      await adapter.history('undo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'seed\n' })
      await adapter.history('redo', reconcile)
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: expected })
    } finally {
      adapter.dispose()
      actor.dispose()
      muya.destroy()
      muya.domNode.remove()
    }
  }
)
