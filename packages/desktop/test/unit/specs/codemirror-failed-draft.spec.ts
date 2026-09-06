import codeMirror from 'codemirror'
import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCodeMirrorCoreAdapter } from '@/documentAuthority/codeMirrorCoreAdapter'

it('retains Source text and rejected intent before a queue-cap reconciliation', async() => {
  const actor = createCoreActor()
  let release: (() => void) | undefined
  const binding = createEditorCoreBinding({
    request: request => request.type === 'apply'
      ? new Promise(resolve => { release = () => { release = undefined; resolve(actor.handle(request)) } })
      : Promise.resolve(actor.handle(request)),
    dispose: () => {}
  })
  await binding.open({ documentId: 'source.md', source: 'seed' })
  const doc = new codeMirror.Doc('seed')
  const adapter = createCodeMirrorCoreAdapter(doc, binding, {
    canonicalSource: 'seed', insertedLineEnding: '\n', maxPending: 1
  })
  try {
    doc.replaceRange('a', { line: 0, ch: 4 })
    await new Promise(resolve => setTimeout(resolve, 0))
    doc.replaceRange('b', { line: 0, ch: 5 })
    await expect(adapter.settled()).rejects.toThrow('reconciliation')
    expect(adapter.recoveryDraft()).toMatchObject({
      text: 'seedab',
      revision: 1,
      unsubmittedEdits: [{ start: 5, end: 5, insert: 'b' }]
    })
    expect(adapter.recoveryDraft().commands).toHaveLength(1)
    release?.()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'seeda' })
    expect(doc.getValue()).toBe('seedab')
  } finally {
    release?.()
    adapter.dispose()
    binding.dispose()
  }
})
