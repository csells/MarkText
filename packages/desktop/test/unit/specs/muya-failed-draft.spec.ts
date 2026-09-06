import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'

it('retains the rejected native draft and queued intents when the finite queue fills', async() => {
  const actor = createCoreActor()
  let release: (() => void) | undefined
  const binding = createEditorCoreBinding({
    request: request => request.type === 'apply'
      ? new Promise(resolve => { release = () => { release = undefined; resolve(actor.handle(request)) } })
      : Promise.resolve(actor.handle(request)),
    dispose: () => {}
  })
  await binding.open({ documentId: 'draft.md', source: 'seed\n' })
  const view = await binding.plainTextViewAtBarrier()
  if (view.type !== 'plain-text-view') throw new Error('Missing view')
  const adapter = createMuyaPlainTextCoreAdapter(view.view.bindings, binding)
  try {
    for (let index = 0; index < 129; index += 1) {
      const before = 'seed' + 'x'.repeat(index)
      const result = adapter.accept({
        source: 'user',
        prevDoc: [{ name: 'paragraph', text: before }],
        doc: [{ name: 'paragraph', text: before + 'x' }],
        op: [0, 'text', { es: [before.length, 'x'] }]
      })
      expect(result).toBe(index === 128 ? 'unsupported' : 'accepted')
    }
    const retained = adapter.recoveryDraft()
    expect(retained).toMatchObject({
      revision: 1,
      nativeChange: { doc: [{ name: 'paragraph', text: 'seed' + 'x'.repeat(129) }] }
    })
    expect(retained?.commands).toHaveLength(128)
    expect(structuredClone(retained)).toEqual(retained)
    release?.()
    await expect(adapter.settled()).rejects.toThrow('resource policy')
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'seedx\n' })
    expect(adapter.recoveryDraft()).toEqual(retained)
  } finally {
    release?.()
    adapter.dispose()
    binding.dispose()
  }
})
