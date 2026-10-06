import { describe, expect, it } from 'vitest'
import {
  createCoreActor,
  createCoreDocumentSessionManager,
  createEditorCoreBinding
} from '@/documentAuthority'

// Upstream MarkText writes a saved file's final line breaks in the file's
// "Trailing newline" mode. A file save changes the document first, through the
// view that shows it, so the saved bytes and the document stay the same.

const managerWithView = async(documentId: string, source: string) => {
  const actor = createCoreActor()
  const manager = createCoreDocumentSessionManager({
    createBinding: () => createEditorCoreBinding({
      request: request => structuredClone(actor.handle(structuredClone(request))),
      dispose: () => actor.dispose()
    })
  })
  await manager.open({ documentId, source, lineEnding: '\n' })
  const lease = manager.lease(documentId)
  const painted: number[] = []
  lease.reconcileExternal(async outcome => {
    painted.push(outcome.revision)
  })
  return { manager, lease, painted }
}

describe('save-time trailing newline mode', () => {
  it.each([
    { name: 'ensures one final newline', source: 'Alpha.\n', edit: '\nSource line.', mode: 1, saved: 'Alpha.\n\nSource line.\n' },
    { name: 'reduces a run to one newline', source: 'Alpha.\n', edit: '\n', mode: 1, saved: 'Alpha.\n' },
    { name: 'trims every final newline', source: 'Alpha.', edit: '\n\n', mode: 0, saved: 'Alpha.' },
    { name: 'keeps the end in mode 2', source: 'Alpha.\n\n', edit: '\n', mode: 2, saved: 'Alpha.\n\n\n' }
  ])('$name before the source is read', async({ source, edit, mode, saved }) => {
    const { manager, lease, painted } = await managerWithView('save.md', source)
    await lease.binding.submit({ edits: [{ start: source.length, end: source.length, insert: edit }], projections: [] }).acknowledged
    const snapshot = await manager.saveBarrier('save.md', { trailingNewlineMode: mode })
    expect(snapshot.source).toBe(saved)
    // The document holds the saved bytes, and its view painted the change.
    expect(await lease.sourceAtBarrier()).toBe(saved)
    expect(painted).toHaveLength(saved === source + edit ? 0 : 1)
    await manager.handoff(lease)
    await manager.close('save.md')
  })

  it('saves a conforming document without changing it', async() => {
    for (const [source, mode] of [['Alpha.\n', 1], ['Alpha.', 0], ['Alpha.\n\n\n', 2]] as const) {
      const { manager, lease, painted } = await managerWithView('conforming.md', source)
      expect((await manager.saveBarrier('conforming.md', { trailingNewlineMode: mode })).source).toBe(source)
      expect(painted).toEqual([])
      await manager.handoff(lease)
      await manager.close('conforming.md')
    }
  })

  it('joins the newline to the last undo step, which typing after the save continues', async() => {
    const { manager, lease } = await managerWithView('undo.md', 'Alpha.\n')
    const type = (start: number, insert: string) => lease.binding.submit({
      edits: [{ start, end: start, insert }], nativeHistoryGroup: 'typing', projections: []
    }).acknowledged
    await type(7, '\nSource')
    expect((await manager.saveBarrier('undo.md', { trailingNewlineMode: 1 })).source).toBe('Alpha.\n\nSource\n')
    await type(14, ' line.')
    expect(await lease.sourceAtBarrier()).toBe('Alpha.\n\nSource line.\n')
    const undone = await lease.binding.submit({ kind: 'undo', projections: [] }).acknowledged
    expect(undone.type).toBe('applied')
    expect(await lease.sourceAtBarrier()).toBe('Alpha.\n')
    expect((await lease.binding.submit({ kind: 'undo', projections: [] }).acknowledged).type).toBe('rejected')
    await manager.handoff(lease)
    await manager.close('undo.md')
  })

  it('drops an undo step that the saved newline cancels', async() => {
    const { manager, lease } = await managerWithView('cancel.md', 'Alpha.\n')
    await lease.binding.submit({ edits: [{ start: 7, end: 7, insert: '\n' }], projections: [] }).acknowledged
    expect((await manager.saveBarrier('cancel.md', { trailingNewlineMode: 1 })).source).toBe('Alpha.\n')
    expect((await lease.binding.submit({ kind: 'undo', projections: [] }).acknowledged).type).toBe('rejected')
    await manager.handoff(lease)
    await manager.close('cancel.md')
  })

  it('keeps a final question mark and reads CRLF line breaks as line breaks', async() => {
    for (const [source, mode, saved] of [['Why?', 0, 'Why?'], ['Why?', 1, 'Why?\n'], ['Alpha.\r\n\r\n', 1, 'Alpha.\r\n'], ['Alpha.\r\n', 0, 'Alpha.']] as const) {
      const { manager, lease } = await managerWithView('ends.md', source)
      expect((await manager.saveBarrier('ends.md', { trailingNewlineMode: mode })).source).toBe(saved)
      await manager.handoff(lease)
      await manager.close('ends.md')
    }
  })

  it('leaves the end alone for a read that is not a file save', async() => {
    const { manager, lease } = await managerWithView('read.md', 'Alpha.')
    expect((await manager.saveBarrier('read.md')).source).toBe('Alpha.')
    await manager.handoff(lease)
    await manager.close('read.md')
  })
})
