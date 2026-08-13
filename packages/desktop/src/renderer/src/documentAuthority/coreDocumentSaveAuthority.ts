import type { DocumentSaveIdentity } from '@shared/types/files'

export interface CoreDocumentSaveSnapshot {
  readonly documentId: string
  readonly identity: DocumentSaveIdentity
  readonly source: string
}

export type CoreDocumentSaveBarrier = () => Promise<CoreDocumentSaveSnapshot>

export interface CoreDocumentSourceRequest {
  readonly documentId: string
  readonly fallbackSource: string
}

export interface CoreDocumentResolvedSource {
  readonly documentId: string
  readonly identity: DocumentSaveIdentity | null
  readonly source: string
  readonly authority: 'core' | 'fallback'
}

export interface CoreDocumentSaveAuthority {
  register(documentId: string, barrier: CoreDocumentSaveBarrier): () => void
  request(documentId: string): Promise<CoreDocumentSaveSnapshot> | undefined
  resolve(
    requests: readonly CoreDocumentSourceRequest[]
  ): readonly CoreDocumentResolvedSource[] | Promise<readonly CoreDocumentResolvedSource[]>
}

const createCoreDocumentSaveAuthority = (): CoreDocumentSaveAuthority => {
  const barriers = new Map<string, CoreDocumentSaveBarrier>()

  const request = (documentId: string): Promise<CoreDocumentSaveSnapshot> | undefined => {
    const barrier = barriers.get(documentId)
    if (barrier === undefined) return undefined

    let pending: Promise<CoreDocumentSaveSnapshot>
    try {
      pending = Promise.resolve(barrier()).then(snapshot => {
        if (snapshot.documentId !== documentId) {
          throw new Error('Core document save barrier returned the wrong document identity')
        }
        if (
          !Number.isSafeInteger(snapshot.identity?.generation) ||
          snapshot.identity.generation < 1 ||
          !Number.isSafeInteger(snapshot.identity.revision) ||
          snapshot.identity.revision < 1
        ) {
          throw new Error('Core document save barrier returned an invalid identity')
        }
        if (typeof snapshot.source !== 'string') {
          throw new Error('Core document save barrier returned an invalid source')
        }
        return Object.freeze({
          ...snapshot,
          identity: Object.freeze({ ...snapshot.identity })
        })
      })
    } catch (error) {
      pending = Promise.reject(error)
    }
    return pending
  }

  return Object.freeze({
    register(documentId: string, barrier: CoreDocumentSaveBarrier): () => void {
      if (!documentId || barriers.has(documentId)) {
        throw new Error('Core document save authority is already registered')
      }
      barriers.set(documentId, barrier)
      let registered = true
      return () => {
        if (!registered) return
        registered = false
        if (barriers.get(documentId) === barrier) barriers.delete(documentId)
      }
    },
    request(documentId: string): Promise<CoreDocumentSaveSnapshot> | undefined {
      return request(documentId)
    },
    resolve(
      requests: readonly CoreDocumentSourceRequest[]
    ): readonly CoreDocumentResolvedSource[] | Promise<readonly CoreDocumentResolvedSource[]> {
      let asynchronous = false
      const batch = new Map<string, Promise<CoreDocumentSaveSnapshot> | undefined>()
      const sources = requests.map<CoreDocumentResolvedSource | Promise<CoreDocumentResolvedSource>>(
        item => {
          const source = batch.has(item.documentId)
            ? batch.get(item.documentId)
            : request(item.documentId)
          batch.set(item.documentId, source)
          if (source === undefined) {
            return Object.freeze({
              documentId: item.documentId,
              identity: null,
              source: item.fallbackSource,
              authority: 'fallback' as const
            })
          }
          asynchronous = true
          return source.then(snapshot => Object.freeze({
            ...snapshot,
            authority: 'core' as const
          }))
        }
      )
      return asynchronous ? Promise.all(sources) : sources as readonly CoreDocumentResolvedSource[]
    }
  })
}

export const coreDocumentSaveAuthority = createCoreDocumentSaveAuthority()
