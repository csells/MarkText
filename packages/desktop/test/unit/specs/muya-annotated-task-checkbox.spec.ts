import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'

it.each([false, true])('toggles an annotated checkbox from checked=%s without rewriting its annotations', async checked => {
  const source = `- [${checked ? 'X' : ' '}] {++task++}{>>keep<<}\n`
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => actor.dispose() })
  await binding.open({ documentId: 'checkbox.md', source })
  const view = async() => {
    const reply = await binding.plainTextViewAtBarrier()
    if (reply.type !== 'plain-text-view' || !('state' in reply.view)) throw new Error('Expected native view')
    return reply.view
  }
  const initial = await view()
  const reconcile = async() => (await view()).bindings
  const adapter = createMuyaPlainTextCoreAdapter(initial.bindings, binding, undefined, reconcile)
  const after = structuredClone(initial.state) as unknown as Array<{ children: Array<{ meta: { checked: boolean } }> }>
  after[0].children[0].meta.checked = !checked
  try {
    expect(adapter.accept({ source: 'user', prevDoc: initial.state, doc: after, op: [0, { r: true, i: after[0] }] })).toBe('accepted')
    await adapter.settled()
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: `- [${checked ? ' ' : 'x'}] {++task++}{>>keep<<}\n` })
    expect((await view()).state).toEqual(after)
    await adapter.history('undo', reconcile)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})
