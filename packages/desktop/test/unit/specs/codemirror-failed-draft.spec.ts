import codeMirror from 'codemirror'
import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCodeMirrorCoreAdapter } from '@/documentAuthority/codeMirrorCoreAdapter'

it('retains Source text and rejected intent when the model refuses native input', async() => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({
    request: (request) => actor.handle(request),
    dispose: () => actor.dispose()
  })
  binding.open({ documentId: 'source.md', source: 'seed' })
  const doc = new codeMirror.Doc('seed')
  const adapter = createCodeMirrorCoreAdapter(doc, binding, {
    canonicalSource: 'seed',
    canonicalRevision: 1,
    insertedLineEnding: '\n'
  })
  // Blockquotes nested past the desktop's 128-level Markdown depth.
  const refused = `\n${'>'.repeat(129)} deep`
  try {
    doc.replaceRange('q', { line: 0, ch: 4 })
    await adapter.settled()
    await adapter.history('undo')
    doc.replaceRange(refused, { line: 0, ch: 4 })
    await expect(adapter.settled()).rejects.toThrow('reconciliation')
    expect(adapter.recoveryDraft()).toMatchObject({
      text: `seed${refused}`,
      revision: 3,
      unsubmittedEdits: [{ start: 4, end: 4, insert: refused }]
    })
    expect(() => binding.sourceAtBarrier()).toThrow('reconciliation is required')
    expect(doc.getValue()).toBe(`seed${refused}`)
  } finally {
    adapter.dispose()
    binding.dispose()
  }
})
