import type {
  ShadowActorPort,
  ShadowQueueContext,
  ShadowReply,
  ShadowRequest,
  ShadowWorkerRequestEnvelope,
  ShadowWorkerResponseEnvelope
} from './protocol'

type WorkerMessageListener = (
  event: MessageEvent<ShadowWorkerResponseEnvelope>
) => void
type WorkerErrorListener = (event: ErrorEvent) => void

export interface ShadowWorkerLike {
  postMessage(message: ShadowWorkerRequestEnvelope): void
  addEventListener(type: 'message', listener: WorkerMessageListener): void
  addEventListener(type: 'error', listener: WorkerErrorListener): void
  removeEventListener(type: 'message', listener: WorkerMessageListener): void
  removeEventListener(type: 'error', listener: WorkerErrorListener): void
  terminate(): void
}

interface PendingRequest {
  readonly resolve: (reply: ShadowReply) => void
  readonly reject: (error: Error) => void
}

const requestKey = (
  session: number,
  generation: number,
  sequence: number
): string => `${String(session)}:${String(generation)}:${String(sequence)}`

export function createWorkerShadowPort(
  suppliedWorker?: ShadowWorkerLike
): ShadowActorPort {
  const worker: ShadowWorkerLike = suppliedWorker ?? new Worker(
    new URL('../workers/shadowDocumentAuthority.worker.ts', import.meta.url),
    { name: 'marktext-document-shadow', type: 'module' }
  ) as unknown as ShadowWorkerLike
  const pending = new Map<string, PendingRequest>()
  let disposed = false
  let terminalError: Error | undefined

  const failAll = (error: Error): void => {
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  const onMessage: WorkerMessageListener = event => {
    if (terminalError !== undefined) return
    const envelope = event.data
    const session = envelope.type === 'shadow-result'
      ? envelope.reply.session
      : envelope.session
    const sequence = envelope.type === 'shadow-result'
      ? envelope.reply.sequence
      : envelope.sequence
    const generation = envelope.type === 'shadow-result'
      ? envelope.reply.generation
      : envelope.generation
    const key = requestKey(session, generation, sequence)
    const request = pending.get(key)
    if (request === undefined) return
    pending.delete(key)
    if (envelope.type === 'shadow-result') {
      request.resolve(envelope.reply)
    } else {
      request.reject(new Error(envelope.message))
    }
  }
  const onError: WorkerErrorListener = event => {
    if (terminalError !== undefined) return
    terminalError = new Error(event.message || 'Shadow Worker failed')
    failAll(terminalError)
    worker.terminate()
  }
  worker.addEventListener('message', onMessage)
  worker.addEventListener('error', onError)

  return Object.freeze({
    request(
      request: ShadowRequest,
      queue: ShadowQueueContext = Object.freeze({
        queuedAt: Date.now(),
        queueDepth: 0
      })
    ): Promise<ShadowReply> {
      if (disposed) return Promise.reject(new Error('Shadow Worker port is disposed'))
      if (terminalError !== undefined) return Promise.reject(terminalError)
      const key = requestKey(
        request.session,
        request.generation,
        request.sequence
      )
      if (pending.has(key)) {
        return Promise.reject(new Error('Duplicate Shadow Worker request identity'))
      }
      return new Promise((resolve, reject) => {
        pending.set(key, { resolve, reject })
        try {
          worker.postMessage(Object.freeze({
            type: 'shadow-request',
            request,
            queue
          }))
        } catch (error) {
          pending.delete(key)
          reject(error instanceof Error ? error : new Error('Shadow post failed'))
        }
      })
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      if (terminalError === undefined) worker.terminate()
      failAll(new Error('Shadow Worker port is disposed'))
    }
  })
}
