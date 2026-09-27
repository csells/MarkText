import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'

it('recovers a multi-edit source transaction as one acknowledged step with exact undo and redo', async() => {
  const manager = createCoreDocumentSessionManager({
    createBinding: () => {
      const actor = createCoreActor()
      return createEditorCoreBinding({
        request: (request) => actor.handle(request),
        dispose: () => actor.dispose()
      })
    }
  })
  const source = '- {++first++}{>>note<<}\n- second\n- third\n'
  const documentId = 'compound.md'
  await manager.open({ documentId, source, lineEnding: '\n' })
  const lease = manager.lease(documentId)
  const edits = ['- second', '- third'].map((text) => ({
    start: source.indexOf(text),
    end: source.indexOf(text),
    insert: '  '
  }))
  try {
    expect(await lease.binding.submit({ edits, projections: [] }).acknowledged).toMatchObject({
      type: 'applied'
    })
    lease.faultView(new Error('Recover the acknowledged compound operation'))
    const recovered = await manager.recover(lease)
    const expected = '- {++first++}{>>note<<}\n  - second\n  - third\n'
    expect(await manager.saveBarrier(documentId)).toMatchObject({ source: expected })
    expect(
      await recovered.binding.submit({ kind: 'undo', projections: [] }).acknowledged
    ).toMatchObject({ type: 'applied' })
    expect(await manager.saveBarrier(documentId)).toMatchObject({ source })
    expect(
      await recovered.binding.submit({ kind: 'redo', projections: [] }).acknowledged
    ).toMatchObject({ type: 'applied' })
    expect(await manager.saveBarrier(documentId)).toMatchObject({ source: expected })
    await manager.handoff(recovered)
  } finally {
    await manager.close(documentId).catch(() => {})
  }
})
