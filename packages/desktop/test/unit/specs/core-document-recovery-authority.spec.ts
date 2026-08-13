import { describe, expect, it, vi } from 'vitest'

import {
  coordinateCoreDocumentRecovery,
  coreDocumentRecoveryAuthority,
  type CoreDocumentViewLease
} from '@/documentAuthority'

const lease = (documentId: string, generation: number): CoreDocumentViewLease => ({
  documentId,
  binding: { generation },
  lineEnding: '\n'
} as unknown as CoreDocumentViewLease)

describe('Core document recovery authority', () => {
  it('blocks saves, reconciles exact recovered source, and publishes only the new lease', async() => {
    const faulted = lease('recover.md', 1)
    const replacement = lease('recover.md', 2)
    let currentLease = faulted
    let releaseReplay!: () => void
    const replaying = new Promise<void>(resolve => { releaseReplay = resolve })
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
    const unregister = coreDocumentRecoveryAuthority.register(
      'recover.md',
      request => coordinateCoreDocumentRecovery({
        request,
        manager: {
          recover,
          saveBarrier,
          activate: vi.fn(async() => { order.push('activate') }),
          handoff: vi.fn(async() => { order.push('handoff') })
        },
        currentLease: () => currentLease,
        setRecovering: () => { order.push('recovering') },
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
    expect(await Promise.race([
      saving,
      Promise.resolve('replaying')
    ])).toBe('replaying')
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

    await expect(coreDocumentRecoveryAuthority.recover({
      documentId: 'recover.md',
      lease: faulted,
      error: new Error('late old-generation callback')
    })).resolves.toBeUndefined()
    expect(recover).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledTimes(1)

    unregister()
    expect(coreDocumentRecoveryAuthority.recover({
      documentId: 'recover.md',
      lease: replacement,
      error: new Error('unregistered')
    })).toBeUndefined()
  })

  it('keeps recovery unsettled until an asynchronous replacement view is published', async() => {
    const faulted = lease('recover-view.md', 1)
    const replacement = lease('recover-view.md', 2)
    let finishPublication!: () => void
    const publication = new Promise<void>(resolve => { finishPublication = resolve })
    let beginPublication!: () => void
    const publicationStarted = new Promise<void>(resolve => { beginPublication = resolve })
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
    void recovering.then(() => { recovered = true })
    await publicationStarted
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(recovered).toBe(false)
    expect(published).toBe(false)
    finishPublication()
    await expect(recovering).resolves.toBe(true)
    expect(published).toBe(true)
  })
})
