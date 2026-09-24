import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createMuyaPlainTextCoreAdapter } from '@/documentAuthority/muyaPlainTextCoreAdapter'

const insertion = (before: string, insert: string) => ({
  range: { start: before.length, end: before.length },
  selection: { ranges: [{ anchor: before.length, focus: before.length }], primary: 0 },
  inputType: 'insertText',
  data: insert,
  options: { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
})
const bindings = (binding: ReturnType<typeof createEditorCoreBinding>) => () => {
  const view = binding.plainTextViewAtBarrier()
  if (view.type !== 'plain-text-view') throw new Error('Missing view')
  return view.view.bindings
}

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
      expect(adapter.input(insertion(before, 'x'), bindings(binding))).toEqual({
        accepted: true,
        changed: true
      })
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
    expect(adapter.input(insertion('seed', 'x'), bindings(binding))).toEqual({
      accepted: true,
      changed: true
    })
    const insert = 'x'.repeat(4 * 1024 * 1024 + 1)
    const rejected = insertion('seedx', insert)
    expect(adapter.input(rejected, bindings(binding))).toEqual({
      accepted: false,
      changed: false
    })
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
