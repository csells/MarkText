import { describe, expect, it } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding, type EditorCoreSubmitInput } from '@/documentAuthority/editorCoreBinding'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'

describe('native authoritative undo groups', () => {
  it.each([
    { lane: 'ordinary', checkpoint: false }, { lane: 'tracked', checkpoint: false },
    { lane: 'ordinary', checkpoint: true }, { lane: 'tracked', checkpoint: true }
  ])('preserves a $lane typing group through recovery with mid-group checkpoint=$checkpoint', async({ lane, checkpoint }) => {
    const manager = createCoreDocumentSessionManager({
      createBinding: () => {
        const actor = createCoreActor()
        return createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => actor.dispose() })
      }
    })
    const documentId = 'recovered-native-group.md'
    await manager.open({ documentId, source: 'seed\n', lineEnding: '\n' })
    const lease = manager.lease(documentId)
    for (const [index, text] of ['A', 'B', 'C'].entries()) {
      const start = lane === 'ordinary' ? 4 + index : index === 0 ? 4 : 7 + index
      const input: EditorCoreSubmitInput = lane === 'ordinary'
        ? { edits: [{ start, end: start, insert: text }], projections: [], nativeHistoryGroup: 'view:1' }
        : { kind: 'track', range: { start, end: start }, text, projections: [], nativeHistoryGroup: 'view:1' }
      expect(await lease.binding.submit(input).acknowledged).toMatchObject({ type: 'applied' })
      if (checkpoint && index === 0) await manager.saveBarrier(documentId)
    }
    lease.faultView(new Error('Rebuild the native view after failure'))
    const recovered = await manager.recover(lease)
    const expected = lane === 'ordinary' ? 'seedABC\n' : 'seed{++ABC++}\n'
    expect(await manager.saveBarrier(documentId)).toMatchObject({ source: expected })
    expect(await recovered.binding.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({ type: 'applied' })
    expect(await manager.saveBarrier(documentId)).toMatchObject({ source: 'seed\n' })
    expect(await recovered.binding.submit({ kind: 'redo', projections: [] }).acknowledged).toMatchObject({ type: 'applied' })
    expect(await manager.saveBarrier(documentId)).toMatchObject({ source: expected })
    await manager.handoff(recovered)
    await manager.close(documentId)
  })

  it.each(['ordinary', 'tracked'] as const)('undoes one %s native typing group atomically and redoes exact source', async(lane) => {
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => {} })
    await binding.open({ documentId: 'native-group.md', source: 'seed\n' })
    for (const [index, text] of ['A', 'B', 'C'].entries()) {
      const start = lane === 'ordinary' ? 4 + index : index === 0 ? 4 : 7 + index
      const input = lane === 'ordinary'
        ? { edits: [{ start, end: start, insert: text }], projections: [], nativeHistoryGroup: 'view-one:1' }
        : { kind: 'track', range: { start, end: start }, text, projections: [], nativeHistoryGroup: 'view-one:1' }
      expect(await binding.submit(input as EditorCoreSubmitInput).acknowledged).toMatchObject({ type: 'applied' })
    }
    const expected = lane === 'ordinary' ? 'seedABC\n' : 'seed{++ABC++}\n'
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: expected })
    expect(await binding.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({ type: 'applied' })
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: 'seed\n' })
    expect(await binding.submit({ kind: 'redo', projections: [] }).acknowledged).toMatchObject({ type: 'applied' })
    expect(await binding.sourceAtBarrier()).toMatchObject({ source: expected })
    actor.dispose()
  })

  it('keeps Source edits, native group changes, and reused tokens after undo independent', async() => {
    const actor = createCoreActor()
    const binding = createEditorCoreBinding({ request: async request => actor.handle(request), dispose: () => {} })
    await binding.open({ documentId: 'native-boundaries.md', source: 'seed\n' })
    const insert = async(start: number, text: string, nativeHistoryGroup?: string) => {
      expect(await binding.submit({
        edits: [{ start, end: start, insert: text }],
        projections: [],
        ...(nativeHistoryGroup === undefined ? {} : { nativeHistoryGroup })
      } as EditorCoreSubmitInput).acknowledged).toMatchObject({ type: 'applied' })
    }
    const undo = async(expected: string) => {
      expect(await binding.submit({ kind: 'undo', projections: [] }).acknowledged).toMatchObject({ type: 'applied' })
      expect(await binding.sourceAtBarrier()).toMatchObject({ source: expected })
    }
    await insert(4, 'A', 'view-one:1')
    await insert(5, 'B')
    await insert(6, 'C', 'view-one:1')
    await insert(7, 'D', 'view-one:2')
    await undo('seedABC\n')
    await undo('seedAB\n')
    await insert(6, 'X', 'view-one:1')
    await undo('seedAB\n')
    await undo('seedA\n')
    await undo('seed\n')
    actor.dispose()
  })
})
