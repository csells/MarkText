import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'

const nativeInsertion = (before: string, insert: string) => ({
  source: 'user',
  prevDoc: [{ name: 'paragraph', text: before }],
  doc: [{ name: 'paragraph', text: before + insert }],
  op: [0, 'text', { es: [before.length, insert] }]
})

it('admits 129 consecutive native edits without retaining an asynchronous model queue', async() => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({
    request: (request) => actor.handle(request),
    dispose: () => actor.dispose()
  })
  binding.open({ documentId: 'draft.md', source: 'seed\n' })
  const view = binding.plainTextViewAtBarrier()
  if (view.type !== 'plain-text-view') throw new Error('Missing view')
  const adapter = createMuyaPlainTextCoreAdapter(view.view.bindings, binding)
  try {
    for (let index = 0; index < 129; index += 1) {
      const before = 'seed' + 'x'.repeat(index)
      expect(adapter.accept(nativeInsertion(before, 'x'))).toBe('accepted')
      expect(binding.sourceAtBarrier()).toMatchObject({ source: before + 'x\n' })
      expect(adapter.hasPendingEdits()).toBe(false)
    }
    expect(adapter.recoveryDraft()).toMatchObject({ revision: 130, commands: [] })
    await adapter.settled()
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})

it('retains the complete rejected native draft when the inserted-unit policy refuses input', async() => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({
    request: (request) => actor.handle(request),
    dispose: () => actor.dispose()
  })
  binding.open({ documentId: 'draft.md', source: 'seed\n' })
  const view = binding.plainTextViewAtBarrier()
  if (view.type !== 'plain-text-view') throw new Error('Missing view')
  const adapter = createMuyaPlainTextCoreAdapter(view.view.bindings, binding)
  try {
    expect(adapter.accept(nativeInsertion('seed', 'x'))).toBe('accepted')
    const insert = 'x'.repeat(4 * 1024 * 1024 + 1)
    const rejected = nativeInsertion('seedx', insert)
    expect(adapter.accept(rejected)).toBe('unsupported')
    const retained = adapter.recoveryDraft()
    expect(retained).toMatchObject({ revision: 2, nativeChange: rejected })
    expect(structuredClone(retained)).toEqual(retained)
    await expect(adapter.settled()).rejects.toThrow('resource policy')
    expect(binding.sourceAtBarrier()).toMatchObject({ source: 'seedx\n' })
    expect(adapter.recoveryDraft()).toEqual(retained)
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})
