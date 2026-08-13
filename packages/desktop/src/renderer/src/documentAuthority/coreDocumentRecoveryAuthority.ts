import type {
  CoreDocumentSessionManager,
  CoreDocumentViewLease
} from './coreDocumentSessionManager'

export interface CoreDocumentRecoveryRequest {
  readonly documentId: string
  readonly lease: CoreDocumentViewLease
  readonly error: unknown
}

export type CoreDocumentRecoveryHandler = (
  request: CoreDocumentRecoveryRequest
) => Promise<void>

export interface CoreDocumentRecoveryAuthority {
  register(documentId: string, handler: CoreDocumentRecoveryHandler): () => void
  recover(request: CoreDocumentRecoveryRequest): Promise<void> | undefined
  settled(documentId: string): Promise<void> | undefined
}

export interface CoordinateCoreDocumentRecoveryInput {
  readonly request: CoreDocumentRecoveryRequest
  readonly manager: Pick<
    CoreDocumentSessionManager,
    'recover' | 'saveBarrier' | 'activate' | 'handoff'
  >
  readonly currentLease: () => CoreDocumentViewLease | undefined
  readonly setRecovering: () => void
  readonly reconcileSource: (documentId: string, source: string) => void
  readonly publishLease: (lease: CoreDocumentViewLease) => void | Promise<void>
}

export async function coordinateCoreDocumentRecovery(
  input: CoordinateCoreDocumentRecoveryInput
): Promise<boolean> {
  const { request, manager } = input
  if (request.documentId !== request.lease.documentId) {
    throw new Error('Core recovery document identity does not match its view lease')
  }
  if (input.currentLease() !== request.lease) return false

  input.setRecovering()
  const replacement = await manager.recover(request.lease)
  const snapshot = await manager.saveBarrier(request.documentId)
  if (snapshot.documentId !== request.documentId) {
    await manager.handoff(replacement)
    throw new Error('Core recovery source barrier returned the wrong document identity')
  }
  if (input.currentLease() !== request.lease) {
    await manager.handoff(replacement)
    return false
  }

  await manager.activate(request.documentId)
  if (input.currentLease() !== request.lease) {
    await manager.handoff(replacement)
    return false
  }
  input.reconcileSource(request.documentId, snapshot.source)
  if (input.currentLease() !== request.lease) {
    await manager.handoff(replacement)
    return false
  }
  await input.publishLease(replacement)
  return true
}

const createCoreDocumentRecoveryAuthority = (): CoreDocumentRecoveryAuthority => {
  const handlers = new Map<string, CoreDocumentRecoveryHandler>()
  const pending = new Map<string, Promise<void>>()

  return Object.freeze({
    register(documentId: string, handler: CoreDocumentRecoveryHandler): () => void {
      if (!documentId || handlers.has(documentId)) {
        throw new Error('Core document recovery authority is already registered')
      }
      handlers.set(documentId, handler)
      let registered = true
      return () => {
        if (!registered) return
        registered = false
        if (handlers.get(documentId) === handler) handlers.delete(documentId)
      }
    },
    recover(request: CoreDocumentRecoveryRequest): Promise<void> | undefined {
      const active = pending.get(request.documentId)
      if (active !== undefined) return active
      const handler = handlers.get(request.documentId)
      if (handler === undefined) return undefined

      let handled: Promise<void>
      try {
        handled = Promise.resolve(handler(Object.freeze({ ...request })))
      } catch (error) {
        handled = Promise.reject(error)
      }
      const tracked = handled.finally(() => {
        if (pending.get(request.documentId) === tracked) {
          pending.delete(request.documentId)
        }
      })
      pending.set(request.documentId, tracked)
      return tracked
    },
    settled(documentId: string): Promise<void> | undefined {
      return pending.get(documentId)
    }
  })
}

export const coreDocumentRecoveryAuthority = createCoreDocumentRecoveryAuthority()
