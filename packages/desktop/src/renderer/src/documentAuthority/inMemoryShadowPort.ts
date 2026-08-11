import { createShadowActor } from './shadowActor'
import type {
  ShadowActorPort,
  ShadowQueueContext,
  ShadowReply,
  ShadowRequest
} from './protocol'

export function createInMemoryShadowPort(): ShadowActorPort {
  const actor = createShadowActor()
  let disposed = false

  return Object.freeze({
    request(
      request: ShadowRequest,
      queue: ShadowQueueContext = Object.freeze({
        queuedAt: Date.now(),
        queueDepth: 0
      })
    ): Promise<ShadowReply> {
      return new Promise((resolve, reject) => {
        queueMicrotask(() => {
          try {
            resolve(actor.handle(request, queue.queueDepth, queue.queuedAt))
          } catch (error) {
            reject(error)
          }
        })
      })
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      actor.dispose()
    }
  })
}
