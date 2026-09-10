import { describe, expect, it } from 'vitest'

import {
  createCoreActor,
  createCoreAuthorityPerformanceTestBridge,
  createCoreDocumentSessionManager,
  createEditorCoreBinding,
  type CoreModelOwner,
  type CoreReply,
  type CoreRequest
} from '@/documentAuthority'

const actorPort = (
  rejectSource = false
): Readonly<{
  actor: ReturnType<typeof createCoreActor>
  port: CoreModelOwner
  requests: CoreRequest[]
}> => {
  const actor = createCoreActor()
  const requests: CoreRequest[] = []
  return Object.freeze({
    actor,
    requests,
    port: {
      request(request: CoreRequest): CoreReply {
        requests.push(structuredClone(request))
        if (rejectSource && request.type === 'source-at-barrier') {
          return Object.freeze({
            type: 'rejected',
            session: request.session,
            sequence: request.sequence,
            revision: request.baseRevision,
            accepted: false,
            reason: 'stale-base',
            sourceLength: 0
          })
        }
        return structuredClone(actor.handle(structuredClone(request)))
      },
      dispose(): void {
        actor.dispose()
      }
    }
  })
}

const managedLease = async(source: string, rejectSource = false) => {
  const { port } = actorPort(rejectSource)
  const manager = createCoreDocumentSessionManager({
    createBinding: () => createEditorCoreBinding(port)
  })
  await manager.open({ documentId: 'managed', source, lineEnding: '\n' })
  return manager.lease('managed')
}

describe('Core authority performance test bridge', () => {
  it('omits the bridge when PERF_TESTING is disabled', async() => {
    const lease = await managedLease('')

    expect(createCoreAuthorityPerformanceTestBridge(false, lease)).toBeUndefined()
  })

  it('delegates exact empty authority through the manager barrier without view bypass', async() => {
    const lease = await managedLease('')
    const bridge = createCoreAuthorityPerformanceTestBridge(true, lease)

    await expect(() => lease.binding.sourceAtBarrier()).toThrow(/cannot bypass/i)
    await expect(bridge?.authoritySource()).resolves.toBe('')
  })

  it('rejects a non-source reply through the manager-owned save barrier', async() => {
    const lease = await managedLease('', true)
    const bridge = createCoreAuthorityPerformanceTestBridge(true, lease)

    await expect(bridge?.authoritySource()).rejects.toThrow(/save barrier.*stale/i)
  })

  it('rejects a released lease before issuing a manager source barrier request', async() => {
    const { port, requests } = actorPort()
    const manager = createCoreDocumentSessionManager({
      createBinding: () => createEditorCoreBinding(port)
    })
    await manager.open({ documentId: 'released', source: '', lineEnding: '\n' })
    const lease = manager.lease('released')
    await manager.handoff(lease)
    const requestCount = requests.length

    await expect(lease.sourceAtBarrier()).rejects.toThrow(/lease is released/i)
    expect(requests).toHaveLength(requestCount)
  })
})
