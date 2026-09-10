import codeMirror from 'codemirror'
import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCodeMirrorCoreAdapter } from '@/documentAuthority/codeMirrorCoreAdapter'

it('retains Source text and rejected intent during a pending native history paint', async() => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({
    request: (request) => actor.handle(request),
    dispose: () => actor.dispose()
  })
  binding.open({ documentId: 'source.md', source: 'seed' })
  const doc = new codeMirror.Doc('seed')
  const adapter = createCodeMirrorCoreAdapter(doc, binding, {
    canonicalSource: 'seed',
    insertedLineEnding: '\n',
    maxPending: 1
  })
  try {
    doc.replaceRange('q', { line: 0, ch: 4 })
    await adapter.settled()
    const undoing = adapter.history('undo')
    undoing.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))
    doc.replaceRange('a', { line: 0, ch: 5 })
    doc.replaceRange('b', { line: 0, ch: 6 })
    await expect(adapter.settled()).rejects.toThrow('reconciliation')
    expect(adapter.recoveryDraft()).toMatchObject({
      text: 'seedqab',
      revision: 3,
      unsubmittedEdits: [{ start: 5, end: 5, insert: 'a' }]
    })
    await Promise.allSettled([undoing])
    expect(binding.sourceAtBarrier()).toMatchObject({ source: 'seed' })
    expect(doc.getValue()).toBe('seedqab')
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})
