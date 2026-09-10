import { expect, it } from 'vitest'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createLocalCoreOwner } from '@/documentAuthority/localCoreOwner'

it('drains admitted input then seals actors through close and resumes the same history on cancellation', async() => {
  const manager = createCoreDocumentSessionManager({
    createBinding: () => createEditorCoreBinding(createLocalCoreOwner())
  })
  manager.open({ documentId: 'a', source: 'seed\n', lineEnding: '\n' })
  const lease = manager.lease('a')
  const generation = lease.identity.generation
  let release!: () => void
  const retiring = new Promise<void>((resolve) => {
    release = resolve
  })
  const closing = manager.prepareClose(async() => {
    await retiring
    await manager.handoff(lease)
  })
  expect(() => manager.lease('a')).toThrow(/clos/i)
  expect(() => manager.open({ documentId: 'b', source: 'new', lineEnding: '\n' })).toThrow(/clos/i)
  await expect(
    manager.replace(lease, { documentId: 'a', source: 'replacement', lineEnding: '\n' })
  ).rejects.toThrow(/clos/i)
  expect(() => manager.recover(lease)).toThrow(/clos/i)
  expect(lease.identity.generation).toBe(generation)
  expect(
    lease.binding.submit({ edits: [{ start: 4, end: 4, insert: ' late' }], projections: [] })
      .acknowledged.type
  ).toBe('applied')
  release()
  const resume = await closing
  const snapshot = await manager.saveBarrier('a')
  expect(snapshot.source).toBe('seed late\n')
  expect(manager.isSaveSnapshotCurrent('a', snapshot.identity)).toBe(true)
  expect(() =>
    lease.binding.submit({ edits: [{ start: 4, end: 4, insert: ' lost' }], projections: [] })
  ).toThrow(/released/i)
  expect(() => manager.lease('a')).toThrow(/clos/i)
  resume()
  const resumed = manager.lease('a')
  expect(resumed.identity.generation).toBe(generation)
  expect(resumed.binding.submit({ kind: 'undo', projections: [] }).acknowledged.type).toBe(
    'applied'
  )
  expect((await manager.saveBarrier('a')).source).toBe('seed\n')
  expect(resumed.binding.submit({ kind: 'redo', projections: [] }).acknowledged.type).toBe(
    'applied'
  )
  expect((await manager.saveBarrier('a')).source).toBe('seed late\n')
  await manager.handoff(resumed)
  await manager.close('a')
})

it('does not seal or dispose an owner when pending input or recovery fails', async() => {
  const manager = createCoreDocumentSessionManager({
    createBinding: () => createEditorCoreBinding(createLocalCoreOwner())
  })
  manager.open({ documentId: 'a', source: 'seed\n', lineEnding: '\n' })
  const lease = manager.lease('a')
  lease.settleView(async() => {
    throw new Error('draft backup failed')
  })
  await expect(manager.prepareClose(() => manager.handoff(lease))).rejects.toThrow(
    'draft backup failed'
  )
  expect(
    lease.binding.submit({ edits: [{ start: 4, end: 4, insert: ' retained' }], projections: [] })
      .acknowledged.type
  ).toBe('applied')
  lease.settleView(
    async() => {},
    () => true
  )
  expect((await manager.saveBarrier('a')).source).toBe('seed retained\n')
  await manager.handoff(lease)
  const resumed = manager.lease('a')
  await manager.handoff(resumed)
  await manager.close('a')
})
