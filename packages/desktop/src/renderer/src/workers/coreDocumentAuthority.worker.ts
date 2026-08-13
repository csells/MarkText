import { createCoreActor } from '../documentAuthority/coreActor'
import type {
  CoreWorkerRequestEnvelope,
  CoreWorkerResponseEnvelope
} from '../documentAuthority/coreProtocol'

interface CoreWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<CoreWorkerRequestEnvelope>) => void
  ): void
  postMessage(message: CoreWorkerResponseEnvelope): void
}

const scope = globalThis as unknown as CoreWorkerScope
const actor = createCoreActor()

scope.addEventListener('message', event => {
  const envelope = event.data
  if (envelope.type !== 'core-request') return
  try {
    scope.postMessage(Object.freeze({
      type: 'core-result',
      reply: actor.handle(envelope.request)
    }))
  } catch (error) {
    scope.postMessage(Object.freeze({
      type: 'core-failure',
      session: envelope.request.session,
      sequence: envelope.request.sequence,
      message: error instanceof Error
        ? error.message
        : 'Unknown Core actor failure'
    }))
  }
})
