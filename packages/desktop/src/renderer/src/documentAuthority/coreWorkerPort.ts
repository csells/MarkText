import type {
  CoreActorPort,
  CoreReply,
  CoreRequest,
  CoreWorkerRequestEnvelope,
  CoreWorkerResponseEnvelope
} from './coreProtocol'

type MessageListener = (event: MessageEvent<CoreWorkerResponseEnvelope>) => void
type ErrorListener = (event: ErrorEvent) => void
type MessageErrorListener = (event: MessageEvent) => void

export interface CoreWorkerLike {
  postMessage(message: CoreWorkerRequestEnvelope): void
  addEventListener(type: 'message', listener: MessageListener): void
  addEventListener(type: 'error', listener: ErrorListener): void
  addEventListener(type: 'messageerror', listener: MessageErrorListener): void
  removeEventListener(type: 'message', listener: MessageListener): void
  removeEventListener(type: 'error', listener: ErrorListener): void
  removeEventListener(type: 'messageerror', listener: MessageErrorListener): void
  terminate(): void
}

export interface CoreWorkerPortOptions {
  readonly responseDelayMs?: number
  readonly registerTestControl?: (control: CoreWorkerTestControl) => void
}

export interface CoreWorkerTestControl {
  crash(): void
  staleNextTransaction(): void
}

export function createWorkerCorePort(
  suppliedWorker?: CoreWorkerLike,
  options: CoreWorkerPortOptions = {}
): CoreActorPort {
  const worker: CoreWorkerLike = suppliedWorker ?? new Worker(
    new URL('../workers/coreDocumentAuthority.worker.ts', import.meta.url),
    { name: 'marktext-document-authority', type: 'module' }
  ) as unknown as CoreWorkerLike
  const pending = new Map<string, Readonly<{
    resolve: (reply: CoreReply) => void
    reject: (error: Error) => void
  }>>()
  const delayed = new Map<string, Readonly<{
    timer: ReturnType<typeof setTimeout>
    reject: (error: Error) => void
  }>>()
  let disposed = false
  let terminalError: Error | undefined
  let staleNextTransaction = false
  const keyOf = (request: Pick<CoreRequest, 'session' | 'sequence'>): string =>
    `${String(request.session)}:${String(request.sequence)}`
  const onMessage: MessageListener = event => {
    if (terminalError !== undefined) return
    const envelope = event.data
    const identity = envelope.type === 'core-result'
      ? envelope.reply
      : envelope
    const key = keyOf(identity)
    const request = pending.get(key)
    if (request === undefined) {
      terminalError = new Error('Core Worker returned an unexpected response')
      rejectAll(terminalError)
      worker.terminate()
      return
    }
    pending.delete(key)
    if (envelope.type === 'core-failure') {
      terminalError = new Error(envelope.message)
      request.reject(terminalError)
      rejectAll(terminalError)
      worker.terminate()
      return
    }
    const deliver = (): void => {
      delayed.delete(key)
      request.resolve(envelope.reply)
    }
    const responseDelayMs = options.responseDelayMs ?? 0
    if (responseDelayMs > 0) {
      const timer = setTimeout(deliver, responseDelayMs)
      delayed.set(key, Object.freeze({ timer, reject: request.reject }))
    } else deliver()
  }
  const rejectAll = (error: Error): void => {
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    for (const response of delayed.values()) {
      clearTimeout(response.timer)
      response.reject(error)
    }
    delayed.clear()
  }
  const failWorker = (error: Error): void => {
    if (disposed || terminalError !== undefined) return
    terminalError = error
    rejectAll(error)
    worker.terminate()
  }
  const onError: ErrorListener = event => {
    failWorker(new Error(event.message || 'Core Worker failed'))
  }
  const onMessageError: MessageErrorListener = () => {
    failWorker(new Error('Core Worker message could not be decoded'))
  }
  worker.addEventListener('message', onMessage)
  worker.addEventListener('error', onError)
  worker.addEventListener('messageerror', onMessageError)
  options.registerTestControl?.(Object.freeze({
    crash(): void {
      failWorker(new Error('Core Worker was terminated by the test harness'))
    },
    staleNextTransaction(): void {
      staleNextTransaction = true
    }
  }))

  return Object.freeze({
    request(request: CoreRequest): Promise<CoreReply> {
      if (disposed) return Promise.reject(new Error('Core Worker port is disposed'))
      if (terminalError !== undefined) return Promise.reject(terminalError)
      const key = keyOf(request)
      if (pending.has(key)) {
        return Promise.reject(new Error('Duplicate Core Worker request identity'))
      }
      return new Promise((resolve, reject) => {
        pending.set(key, Object.freeze({ resolve, reject }))
        try {
          const makeStale = staleNextTransaction && (
            request.type === 'apply' || request.type === 'undo' ||
            request.type === 'redo'
          )
          if (makeStale) staleNextTransaction = false
          const forwarded = makeStale
            ? Object.freeze({ ...request, baseRevision: request.baseRevision - 1 })
            : request
          worker.postMessage(Object.freeze({
            type: 'core-request',
            request: forwarded
          }))
        } catch (error) {
          pending.delete(key)
          terminalError = error instanceof Error
            ? error
            : new Error('Core Worker postMessage failed')
          reject(terminalError)
          rejectAll(terminalError)
          worker.terminate()
        }
      })
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.removeEventListener('messageerror', onMessageError)
      if (terminalError === undefined) worker.terminate()
      rejectAll(new Error('Core Worker port is disposed'))
    }
  })
}
