import { createCoreActor } from './coreActor'
import type { CoreModelOwner, CoreReply, CoreRequest } from './coreProtocol'

export interface CoreModelTestControl {
  crash(): void
  staleNextTransaction(): void
}

export interface LocalCoreOwnerOptions {
  readonly onFailure?: (error: Error) => void
  readonly registerTestControl?: (control: CoreModelTestControl) => void
}

/** One actor is the live model; native actions receive its decision in this call. */
export function createLocalCoreOwner(options: LocalCoreOwnerOptions = {}): CoreModelOwner {
  const actor = createCoreActor()
  let disposed = false
  let terminalError: Error | undefined
  let staleNextTransaction = false
  const fail = (error: Error): void => {
    if (disposed || terminalError !== undefined) return
    terminalError = error
    actor.dispose()
    options.onFailure?.(error)
  }
  options.registerTestControl?.(
    Object.freeze({
      crash(): void {
        fail(new Error('Core model was terminated by the test harness'))
      },
      staleNextTransaction(): void {
        staleNextTransaction = true
      }
    })
  )
  return Object.freeze({
    request(request: CoreRequest): CoreReply {
      if (disposed) throw new Error('Core model owner is disposed')
      if (terminalError !== undefined) throw terminalError
      try {
        const mutation =
          request.type === 'source-input' ||
          request.type === 'clipboard' ||
          request.type === 'format' ||
          request.type === 'input' ||
          request.type === 'apply' ||
          request.type === 'undo' ||
          request.type === 'redo'
        const makeStale = staleNextTransaction && mutation
        if (makeStale) staleNextTransaction = false
        return actor.handle(
          makeStale && 'baseRevision' in request
            ? Object.freeze({ ...request, baseRevision: request.baseRevision - 1 })
            : request
        )
      } catch (error) {
        const failure = error instanceof Error ? error : new Error('Core model operation failed')
        fail(failure)
        throw failure
      }
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      if (terminalError === undefined) actor.dispose()
    }
  })
}
