import type { DocumentCoreTableShape } from '@marktext/document-view'

interface TableShapeDialogHooks {
  readonly open: () => void
  readonly close: () => void
}

interface PendingTableShapeRequest {
  readonly signal: AbortSignal
  readonly onAbort: () => void
  readonly resolve: (shape: DocumentCoreTableShape | null) => void
}

interface TableShapeCandidate {
  readonly rows: unknown
  readonly columns: unknown
}

export interface TableShapeDialogRequest {
  readonly request: (
    signal: AbortSignal
  ) => Promise<DocumentCoreTableShape | null>
  readonly confirm: (shape: TableShapeCandidate) => void
  readonly cancel: () => void
  readonly hasPendingRequest: () => boolean
}

const validDimension = (
  value: unknown,
  maximum: number
): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 1 &&
  value <= maximum

/**
 * Coordinates the shell-owned dimensions dialog without accepting a document,
 * selection, revision, or mutation callback. The document view keeps all target
 * authority and may discard the returned shape if that target becomes stale.
 */
export function createTableShapeDialogRequest(
  hooks: TableShapeDialogHooks
): TableShapeDialogRequest {
  let pending: PendingTableShapeRequest | null = null

  const settle = (shape: DocumentCoreTableShape | null): void => {
    const request = pending
    if (request === null) return
    pending = null
    request.signal.removeEventListener('abort', request.onAbort)
    hooks.close()
    request.resolve(shape)
  }

  const cancel = (): void => settle(null)

  return Object.freeze({
    request: (signal: AbortSignal) => {
      cancel()
      if (signal.aborted) return Promise.resolve(null)

      return new Promise<DocumentCoreTableShape | null>((resolve, reject) => {
        const onAbort = (): void => settle(null)
        pending = Object.freeze({ signal, onAbort, resolve })
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) {
          onAbort()
          return
        }
        try {
          hooks.open()
        } catch (error) {
          pending = null
          signal.removeEventListener('abort', onAbort)
          reject(error)
        }
      })
    },
    confirm: (shape: TableShapeCandidate) => {
      if (
        !validDimension(shape.rows, 30) ||
        !validDimension(shape.columns, 20)
      ) {
        cancel()
        return
      }
      settle(Object.freeze({ rows: shape.rows, columns: shape.columns }))
    },
    cancel,
    hasPendingRequest: () => pending !== null
  })
}
