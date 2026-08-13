import type { DocumentSaveIdentity } from '@shared/types/files'

import type { CoreConsumerProjection } from './coreProtocol'

export interface CoreConsumerProjectionRegistry {
  publish(
    documentId: string,
    identity: DocumentSaveIdentity,
    projection: CoreConsumerProjection
  ): void
  read(
    documentId: string,
    identity: DocumentSaveIdentity
  ): CoreConsumerProjection | undefined
  retire(documentId: string): void
}

type RegistryEntry = Readonly<{
  readonly identity: DocumentSaveIdentity
  readonly projection: CoreConsumerProjection
}>

const validIdentity = (identity: DocumentSaveIdentity): boolean =>
  Number.isSafeInteger(identity.generation) && identity.generation > 0 &&
  Number.isSafeInteger(identity.revision) && identity.revision > 0

export function createCoreConsumerProjectionRegistry():
CoreConsumerProjectionRegistry {
  const entries = new Map<string, RegistryEntry>()
  return Object.freeze({
    publish(
      documentId: string,
      identity: DocumentSaveIdentity,
      projection: CoreConsumerProjection
    ): void {
      if (documentId.length === 0 || !validIdentity(identity)) {
        throw new TypeError('Core consumer projection identity is invalid')
      }
      entries.set(documentId, Object.freeze({
        identity: Object.freeze({ ...identity }),
        projection
      }))
    },
    read(
      documentId: string,
      identity: DocumentSaveIdentity
    ): CoreConsumerProjection | undefined {
      const entry = entries.get(documentId)
      return entry !== undefined &&
        entry.identity.generation === identity.generation &&
        entry.identity.revision === identity.revision
        ? entry.projection
        : undefined
    },
    retire(documentId: string): void {
      entries.delete(documentId)
    }
  })
}
