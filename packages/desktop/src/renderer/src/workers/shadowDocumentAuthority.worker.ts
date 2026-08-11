import { createShadowActor } from '../documentAuthority/shadowActor'
import type {
  ShadowWorkerRequestEnvelope,
  ShadowWorkerResponseEnvelope
} from '../documentAuthority/protocol'

interface ShadowWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<ShadowWorkerRequestEnvelope>) => void
  ): void
  postMessage(message: ShadowWorkerResponseEnvelope): void
}

const scope = globalThis as unknown as ShadowWorkerScope
const actor = createShadowActor()

scope.addEventListener('message', event => {
  const envelope = event.data
  if (envelope.type !== 'shadow-request') return
  try {
    const reply = actor.handle(
      envelope.request,
      envelope.queue.queueDepth,
      envelope.queue.queuedAt
    )
    scope.postMessage(Object.freeze({ type: 'shadow-result', reply }))
  } catch (error) {
    scope.postMessage(Object.freeze({
      type: 'shadow-failure',
      session: envelope.request.session,
      generation: envelope.request.generation,
      sequence: envelope.request.sequence,
      message: error instanceof Error
        ? error.message
        : 'Unknown Shadow actor failure'
    }))
  }
})
