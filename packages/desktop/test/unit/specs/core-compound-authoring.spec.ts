import { expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'

it.each(['markup-edits', 'track-edits'] as const)(
  'recovers %s as one acknowledged transaction with exact undo and redo',
  async(kind) => {
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
      expect(
        await lease.binding.submit({ kind, edits, projections: [] }).acknowledged
      ).toMatchObject({ type: 'applied' })
      lease.faultView(new Error('Recover the acknowledged compound operation'))
      const recovered = await manager.recover(lease)
      const expected =
        kind === 'markup-edits'
          ? '- {++first++}{>>note<<}\n  - second\n  - third\n'
          : '- {++first++}{>>note<<}\n{++  ++}- second\n{++  ++}- third\n'
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
  }
)

it('rejects overlapping sparse authoring edits with a typed outcome and unchanged source', async() => {
  const actor = createCoreActor()
  const binding = createEditorCoreBinding({
    request: (request) => actor.handle(request),
    dispose: () => actor.dispose()
  })
  await binding.open({ documentId: 'overlap.md', source: 'first\nsecond\n' })
  try {
    expect(
      await binding.submit({
        kind: 'markup-edits',
        projections: [],
        edits: [
          { start: 0, end: 3, insert: 'a' },
          { start: 2, end: 5, insert: 'b' }
        ]
      }).acknowledged
    ).toMatchObject({ type: 'rejected', accepted: false, reason: 'author-invalid' })
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'first\nsecond\n' })
  } finally {
    binding.dispose()
  }
})
