import type { DocumentSaveIdentity } from '@shared/types/files'

export interface CoreDocumentSaveSnapshot {
  readonly documentId: string
  readonly identity: DocumentSaveIdentity
  readonly source: string
}

export type CoreDocumentSaveBarrier = () => Promise<CoreDocumentSaveSnapshot>

export interface CoreDocumentSourceRequest {
  readonly documentId: string
  /**
   * The text the tab was loaded or last reconciled with. It is the document's
   * source only while no Core owner holds the document (a background tab never
   * shown); an open document always answers from its Core save barrier.
   */
  readonly loadedSource: string
}

export interface CoreDocumentResolvedSource {
  readonly documentId: string
  readonly identity: DocumentSaveIdentity | null
  readonly source: string
  readonly authority: 'core' | 'unopened'
}

export interface CoreWindowClosePreparation {
  readonly ready: Promise<void>
  /** An open Review composer; closing the window discards it only if confirmed. */
  readonly pendingReviewInput?: boolean
  resume(): Promise<void>
}

/** Unsubmitted Review composer input that closing a document would discard. */
export interface CoreReviewInputOwner {
  pending(documentIds: readonly string[]): boolean
  discard(documentIds: readonly string[]): void
}

export interface CoreDocumentSaveAuthority {
  registerClose(
    prepare: () => CoreWindowClosePreparation,
    assertAllowed?: (documentIds?: readonly string[]) => void,
    isClosing?: () => boolean,
    reviewInput?: CoreReviewInputOwner
  ): () => void
  isClosing(): boolean
  assertCloseAllowed(documentIds?: readonly string[]): void
  pendingReviewInput(documentIds: readonly string[]): boolean
  discardReviewInput(documentIds: readonly string[]): void
  prepareClose(): CoreWindowClosePreparation
  register(
    documentId: string,
    barrier: CoreDocumentSaveBarrier,
    isCurrent?: (identity: DocumentSaveIdentity) => boolean
  ): () => void
  request(documentId: string): Promise<CoreDocumentSaveSnapshot> | undefined
  isCurrent(sources: readonly CoreDocumentResolvedSource[]): boolean
  resolve(
    requests: readonly CoreDocumentSourceRequest[]
  ): readonly CoreDocumentResolvedSource[] | Promise<readonly CoreDocumentResolvedSource[]>
}

const createCoreDocumentSaveAuthority = (): CoreDocumentSaveAuthority => {
  let closePreparation: (() => CoreWindowClosePreparation) | undefined
  let closeIsPending: (() => boolean) | undefined
  let assertCloseAllowed: ((documentIds?: readonly string[]) => void) | undefined
  let reviewInputOwner: CoreReviewInputOwner | undefined
  const barriers = new Map<string, CoreDocumentSaveBarrier>()
  const currentChecks = new Map<string, (identity: DocumentSaveIdentity) => boolean>()

  const request = (documentId: string): Promise<CoreDocumentSaveSnapshot> | undefined => {
    const barrier = barriers.get(documentId)
    if (barrier === undefined) return undefined

    let pending: Promise<CoreDocumentSaveSnapshot>
    try {
      pending = Promise.resolve(barrier()).then((snapshot) => {
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
    registerClose(
      prepare: () => CoreWindowClosePreparation,
      assertAllowed?: (documentIds?: readonly string[]) => void,
      isClosing?: () => boolean,
      reviewInput?: CoreReviewInputOwner
    ): () => void {
      if (closePreparation !== undefined) {
        throw new Error('Window close owner is already registered')
      }
      closePreparation = prepare
      assertCloseAllowed = assertAllowed
      closeIsPending = isClosing
      reviewInputOwner = reviewInput
      return () => {
        if (closePreparation !== prepare) return
        closePreparation = undefined
        assertCloseAllowed = undefined
        closeIsPending = undefined
        reviewInputOwner = undefined
      }
    },
    pendingReviewInput(documentIds: readonly string[]): boolean {
      return reviewInputOwner?.pending(documentIds) ?? false
    },
    discardReviewInput(documentIds: readonly string[]): void {
      reviewInputOwner?.discard(documentIds)
    },
    isClosing(): boolean {
      return closeIsPending?.() ?? false
    },
    assertCloseAllowed(documentIds?: readonly string[]): void {
      assertCloseAllowed?.(documentIds)
    },
    prepareClose(): CoreWindowClosePreparation {
      if (closePreparation === undefined) throw new Error('Window close owner is unavailable')
      assertCloseAllowed?.()
      return closePreparation()
    },
    register(
      documentId: string,
      barrier: CoreDocumentSaveBarrier,
      isCurrent?: (identity: DocumentSaveIdentity) => boolean
    ): () => void {
      if (!documentId || barriers.has(documentId)) {
        throw new Error('Core document save authority is already registered')
      }
      barriers.set(documentId, barrier)
      if (isCurrent !== undefined) currentChecks.set(documentId, isCurrent)
      let registered = true
      return () => {
        if (!registered) return
        registered = false
        if (barriers.get(documentId) === barrier) {
          barriers.delete(documentId)
          currentChecks.delete(documentId)
        }
      }
    },
    isCurrent(sources: readonly CoreDocumentResolvedSource[]): boolean {
      return sources.every((source) => {
        if (source.authority === 'unopened') return !barriers.has(source.documentId)
        const check = currentChecks.get(source.documentId)
        if (check === undefined) {
          throw new Error('Core close requires a live document identity check')
        }
        return source.identity !== null && check(source.identity)
      })
    },
    request(documentId: string): Promise<CoreDocumentSaveSnapshot> | undefined {
      return request(documentId)
    },
    resolve(
      requests: readonly CoreDocumentSourceRequest[]
    ): readonly CoreDocumentResolvedSource[] | Promise<readonly CoreDocumentResolvedSource[]> {
      let asynchronous = false
      const batch = new Map<string, Promise<CoreDocumentSaveSnapshot> | undefined>()
      const sources = requests.map<
        CoreDocumentResolvedSource | Promise<CoreDocumentResolvedSource>
      >((item) => {
        const source = batch.has(item.documentId)
          ? batch.get(item.documentId)
          : request(item.documentId)
        batch.set(item.documentId, source)
        if (source === undefined) {
          return Object.freeze({
            documentId: item.documentId,
            identity: null,
            source: item.loadedSource,
            authority: 'unopened' as const
          })
        }
        asynchronous = true
        return source.then((snapshot) =>
          Object.freeze({
            ...snapshot,
            authority: 'core' as const
          })
        )
      })
      return asynchronous
        ? Promise.all(sources)
        : (sources as readonly CoreDocumentResolvedSource[])
    }
  })
}

export const coreDocumentSaveAuthority = createCoreDocumentSaveAuthority()
