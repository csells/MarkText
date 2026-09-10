import { describe, expect, it, vi } from 'vitest'
import { createCoreActor } from '@/documentAuthority/coreActor'
import { createEditorCoreBinding } from '@/documentAuthority/editorCoreBinding'
import { createCoreDocumentSessionManager } from '@/documentAuthority/coreDocumentSessionManager'

import {
  coordinateCoreDocumentRecovery,
  coreDocumentRecoveryAuthority,
  type CoreDocumentViewLease
} from '@/documentAuthority'

const lease = (documentId: string, generation: number): CoreDocumentViewLease =>
  ({
    documentId,
    binding: { generation },
    lineEnding: '\n'
  }) as unknown as CoreDocumentViewLease

describe('Core document recovery authority', () => {
  it('blocks saves, reconciles exact recovered source, and publishes only the new lease', async() => {
    const faulted = lease('recover.md', 1)
    const replacement = lease('recover.md', 2)
    let currentLease = faulted
    let releaseReplay!: () => void
    const replaying = new Promise<void>((resolve) => {
      releaseReplay = resolve
    })
    const order: string[] = []
    const recover = vi.fn(async() => {
      order.push('recover')
      await replaying
      return replacement
    })
    const saveBarrier = vi.fn(async() => {
      order.push('source')
      return {
        documentId: 'recover.md',
        revision: 2,
        identity: { generation: 7, revision: 2 },
        source: 'exact acknowledged source',
        lineEnding: '\n' as const
      }
    })
    const publish = vi.fn((next: CoreDocumentViewLease) => {
      order.push('publish')
      currentLease = next
    })
    const unregister = coreDocumentRecoveryAuthority.register('recover.md', (request) =>
      coordinateCoreDocumentRecovery({
        request,
        manager: {
          recover,
          saveBarrier,
          activate: vi.fn(async() => {
            order.push('activate')
          }),
          handoff: vi.fn(async() => {
            order.push('handoff')
          })
        },
        currentLease: () => currentLease,
        setRecovering: () => {
          order.push('recovering')
        },
        reconcileSource: (_documentId, source) => {
          order.push(`reconcile:${source}`)
        },
        publishLease: publish
      }).then(() => {})
    )

    const recovering = coreDocumentRecoveryAuthority.recover({
      documentId: 'recover.md',
      lease: faulted,
      error: new Error('Core Worker crashed')
    })
    const duplicate = coreDocumentRecoveryAuthority.recover({
      documentId: 'recover.md',
      lease: faulted,
      error: new Error('late duplicate fault')
    })
    expect(recovering).toBeDefined()
    expect(duplicate).toBe(recovering)
    const saving = (async() => {
      await coreDocumentRecoveryAuthority.settled('recover.md')
      return 'saved'
    })()
    expect(await Promise.race([saving, Promise.resolve('replaying')])).toBe('replaying')
    expect(order).toEqual(['recovering', 'recover'])

    releaseReplay()
    await expect(recovering).resolves.toBeUndefined()
    await expect(saving).resolves.toBe('saved')
    expect(order).toEqual([
      'recovering',
      'recover',
      'source',
      'activate',
      'reconcile:exact acknowledged source',
      'publish'
    ])
    expect(currentLease).toBe(replacement)
    expect(publish).toHaveBeenCalledTimes(1)

    await expect(
      coreDocumentRecoveryAuthority.recover({
        documentId: 'recover.md',
        lease: faulted,
        error: new Error('late old-generation callback')
      })
    ).resolves.toBeUndefined()
    expect(recover).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledTimes(1)

    unregister()
    expect(
      coreDocumentRecoveryAuthority.recover({
        documentId: 'recover.md',
        lease: replacement,
        error: new Error('unregistered')
      })
    ).toBeUndefined()
  })

  it('keeps recovery unsettled until an asynchronous replacement view is published', async() => {
    const faulted = lease('recover-view.md', 1)
    const replacement = lease('recover-view.md', 2)
    let finishPublication!: () => void
    const publication = new Promise<void>((resolve) => {
      finishPublication = resolve
    })
    let beginPublication!: () => void
    const publicationStarted = new Promise<void>((resolve) => {
      beginPublication = resolve
    })
    let published = false

    const recovering = coordinateCoreDocumentRecovery({
      request: {
        documentId: 'recover-view.md',
        lease: faulted,
        error: new Error('view fault')
      },
      manager: {
        recover: vi.fn(async() => replacement),
        saveBarrier: vi.fn(async() => ({
          documentId: 'recover-view.md',
          revision: 2,
          identity: { generation: 2, revision: 2 },
          source: 'acknowledged',
          lineEnding: '\n' as const
        })),
        activate: vi.fn(async() => {}),
        handoff: vi.fn(async() => {})
      },
      currentLease: () => faulted,
      setRecovering: () => {},
      reconcileSource: () => {},
      publishLease: async() => {
        beginPublication()
        await publication
        published = true
      }
    })

    let recovered = false
    const recoveryObservation = recovering.then(() => {
      recovered = true
    })
    await publicationStarted
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(recovered).toBe(false)
    expect(published).toBe(false)
    finishPublication()
    await expect(recovering).resolves.toBe(true)
    await recoveryObservation
    expect(published).toBe(true)
  })
})

it('preserves the accepted suffix and rejects a waiting old-view save during recovery', async() => {
  let releaseSource!: () => void
  const heldSource = new Promise<void>((resolve) => {
    releaseSource = resolve
  })
  let sourceRequested!: () => void
  const sourceStarted = new Promise<void>((resolve) => {
    sourceRequested = resolve
  })
  let releaseOpen!: () => void
  const heldOpen = new Promise<void>((resolve) => {
    releaseOpen = resolve
  })
  let openRequested!: () => void
  const openStarted = new Promise<void>((resolve) => {
    openRequested = resolve
  })
  const manager = createCoreDocumentSessionManager({
    createBinding: () => {
      const actor = createCoreActor()
      return createEditorCoreBinding({
        request: (request) => actor.handle(request),
        dispose: () => actor.dispose()
      })
    }
  })
  const documentId = 'unsaved-heading-recovery.md'
  const original = '# A\n\n## B\n\n### B1\n\n## C\n'
  const expected = '# A\n\n## B\n\n### B1 Renamed\n\n## C\n'
  await manager.open({ documentId, source: original, lineEnding: '\n' })
  const originalLease = manager.lease(documentId)
  let current = originalLease
  for (const [index, letter] of [...' Renamed'].entries()) {
    expect(
      await current.binding.submit({
        nativeHistoryGroup: 'rename:1',
        edits: [{ start: 17 + index, end: 17 + index, insert: letter }],
        projections: []
      }).acknowledged
    ).toMatchObject({ type: 'applied' })
  }
  current.settleView(async() => {
    sourceRequested()
    await heldSource
  })
  const priorBarrier = manager.saveBarrier(documentId)
  await sourceStarted
  const failure = new Error('Native insertion cannot be reconciled')
  current.faultView(failure)
  let reconciled = ''
  const recovering = coordinateCoreDocumentRecovery({
    request: { documentId, lease: originalLease, error: failure },
    manager,
    currentLease: () => current,
    setRecovering: () => {},
    reconcileSource: (_id, source) => {
      reconciled = source
    },
    publishLease: async(replacement) => {
      openRequested()
      await heldOpen
      current = replacement
    }
  })
  releaseSource()
  await openStarted
  releaseOpen()
  await expect(priorBarrier).rejects.toThrow('Native insertion cannot be reconciled')
  try {
    expect(await recovering).toBe(true)
    expect(reconciled).toBe(expected)
    const projection = await current.projectAcknowledgedPlainTextView(current.identity.revision)
    expect(projection.view).toMatchObject({ kind: 'view', markdown: expected })
    expect(await manager.saveBarrier(documentId)).toMatchObject({ source: expected })
    expect(
      await current.binding.submit({ kind: 'undo', projections: [] }).acknowledged
    ).toMatchObject({ type: 'applied' })
    expect(await manager.saveBarrier(documentId)).toMatchObject({ source: original })
  } finally {
    await manager.handoff(current)
    await manager.close(documentId)
  }
})
