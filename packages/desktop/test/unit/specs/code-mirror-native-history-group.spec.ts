import { expect, it } from 'vitest'
import codeMirror from '@/codeMirror'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCodeMirrorCoreAdapter } from '@/documentAuthority/codeMirrorCoreAdapter'

it('uses the native CodeMirror typing group for one authoritative undo and redo', async() => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({
    request: (request) => actor.handle(request),
    dispose: () => actor.dispose()
  })
  await binding.open({ documentId: 'source-groups.md', source: 'seed\n' })
  const doc = new codeMirror.Doc('seed\n')
  const adapter = createCodeMirrorCoreAdapter(doc, binding, {
    canonicalSource: 'seed\n',
    insertedLineEnding: '\n',
    nativeHistoryScope: 'source-view'
  })
  try {
    for (const [index, text] of ['A', 'B', 'C'].entries()) {
      doc.replaceRange(text, { line: 0, ch: 4 + index }, undefined, '+input')
      await adapter.settled()
    }
    expect(doc.historySize().undo).toBe(1)
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'seedABC\n' })
    await adapter.history('undo')
    expect(doc.getValue()).toBe('seed\n')
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'seed\n' })
    await adapter.history('redo')
    expect(doc.getValue()).toBe('seedABC\n')
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'seedABC\n' })
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})
