import { describe, expect, it } from 'vitest'

import {
  createCoreActor,
  createCoreAuthorityPerformanceTestBridge,
  createEditorCoreBinding,
  type CoreActorPort,
  type CoreReply,
  type CoreRequest
} from '@/documentAuthority'

const actorPort = (
  rejectSource = false
): Readonly<{ actor: ReturnType<typeof createCoreActor>; port: CoreActorPort }> => {
  const actor = createCoreActor()
  return Object.freeze({
    actor,
    port: {
      async request(request: CoreRequest): Promise<CoreReply> {
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
      dispose(): void { actor.dispose() }
    }
  })
}

describe('Core authority performance test bridge', () => {
  it('omits the bridge when PERF_TESTING is disabled', async() => {
    const { port } = actorPort()
    const binding = createEditorCoreBinding(port)
    await binding.open({ documentId: 'blank', source: '' })

    expect(createCoreAuthorityPerformanceTestBridge(false, binding))
      .toBeUndefined()
  })

  it('delegates authority bytes through a real source-at-barrier binding', async() => {
    const { port } = actorPort()
    const binding = createEditorCoreBinding(port)
    await binding.open({ documentId: 'real', source: 'actor-owned bytes' })
    const bridge = createCoreAuthorityPerformanceTestBridge(true, binding)

    await expect(bridge?.authoritySource()).resolves.toBe('actor-owned bytes')
  })

  it('rejects a non-source reply from the production binding', async() => {
    const { port } = actorPort(true)
    const binding = createEditorCoreBinding(port)
    await binding.open({ documentId: 'rejected', source: '' })
    const bridge = createCoreAuthorityPerformanceTestBridge(true, binding)

    await expect(bridge?.authoritySource()).rejects.toThrow(
      /authority source.*unavailable/i
    )
  })
})
