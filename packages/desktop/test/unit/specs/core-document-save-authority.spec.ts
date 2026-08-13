import { afterEach, describe, expect, it } from 'vitest'
import { coreDocumentSaveAuthority } from '@/documentAuthority/coreDocumentSaveAuthority'

describe('Core document save authority', () => {
  const unregister: Array<() => void> = []

  afterEach(() => {
    while (unregister.length > 0) unregister.pop()?.()
  })

  it('coalesces duplicate ids within one resolution and preserves fallbacks', async() => {
    let calls = 0
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    unregister.push(coreDocumentSaveAuthority.register('core.md', async() => {
      calls += 1
      await pending
      return {
        documentId: 'core.md',
        identity: { generation: 1, revision: 7 },
        source: 'actor bytes'
      }
    }))

    const first = coreDocumentSaveAuthority.resolve([
      { documentId: 'plain.md', fallbackSource: 'Pinia bytes' },
      { documentId: 'core.md', fallbackSource: 'poisoned snapshot' },
      { documentId: 'core.md', fallbackSource: 'different poison' }
    ])

    expect(first).toBeInstanceOf(Promise)
    expect(calls).toBe(1)
    release()
    await expect(first).resolves.toEqual([
      {
        documentId: 'plain.md',
        identity: null,
        source: 'Pinia bytes',
        authority: 'fallback'
      },
      {
        documentId: 'core.md',
        identity: { generation: 1, revision: 7 },
        source: 'actor bytes',
        authority: 'core'
      },
      {
        documentId: 'core.md',
        identity: { generation: 1, revision: 7 },
        source: 'actor bytes',
        authority: 'core'
      }
    ])
  })

  it('does not reuse an in-flight snapshot after the authority generation changes', async() => {
    let releaseOld!: () => void
    const oldPending = new Promise<void>(resolve => { releaseOld = resolve })
    const unregisterOld = coreDocumentSaveAuthority.register('same.md', async() => {
      await oldPending
      return {
        documentId: 'same.md',
        identity: { generation: 3, revision: 4 },
        source: 'old session bytes'
      }
    })
    const oldRequest = coreDocumentSaveAuthority.resolve([
      { documentId: 'same.md', fallbackSource: 'old fallback' }
    ]) as Promise<readonly unknown[]>

    unregisterOld()
    unregister.push(coreDocumentSaveAuthority.register('same.md', async() => ({
      documentId: 'same.md',
      identity: { generation: 4, revision: 1 },
      source: 'new session bytes'
    })))
    const newRequest = coreDocumentSaveAuthority.resolve([
      { documentId: 'same.md', fallbackSource: 'new fallback' }
    ])

    await expect(newRequest).resolves.toEqual([
      {
        documentId: 'same.md',
        identity: { generation: 4, revision: 1 },
        source: 'new session bytes',
        authority: 'core'
      }
    ])
    releaseOld()
    await expect(oldRequest).resolves.toEqual([
      {
        documentId: 'same.md',
        identity: { generation: 3, revision: 4 },
        source: 'old session bytes',
        authority: 'core'
      }
    ])
  })

  it('preserves one structured generation-qualified identity', async() => {
    unregister.push(coreDocumentSaveAuthority.register('identity.md', async() => ({
      documentId: 'identity.md',
      identity: { generation: 17, revision: 2 },
      source: 'generation seventeen bytes'
    })))

    const result = await coreDocumentSaveAuthority.resolve([
      { documentId: 'identity.md', fallbackSource: 'poisoned fallback' }
    ])
    expect(result).toEqual([
      {
        documentId: 'identity.md',
        identity: { generation: 17, revision: 2 },
        source: 'generation seventeen bytes',
        authority: 'core'
      }
    ])
    expect(structuredClone(result)).toEqual(result)
  })

  it('fails closed when a registered barrier returns another document identity', async() => {
    unregister.push(coreDocumentSaveAuthority.register('core.md', async() => ({
      documentId: 'other.md',
      identity: { generation: 1, revision: 2 },
      source: 'wrong authority'
    })))

    await expect(coreDocumentSaveAuthority.resolve([
      { documentId: 'core.md', fallbackSource: 'must not persist' }
    ])).rejects.toThrow(/identity/)
  })
})
