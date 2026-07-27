import type { DocumentCoreMainDispatchRequest } from '@shared/types/documentCore'
import type {
  ImageAssetMaterializationReceipt,
  ImageAssetInsertReceipt,
  ImageAssetInsertRequest
} from '@shared/types/imageAsset'

interface ActiveDocument {
  readonly documentId: string
  readonly generation: number
}

export interface ImageAssetActiveDocumentAuthority {
  readonly activate: (
    senderId: number,
    documentId: string
  ) => ActiveDocument
  readonly capture: (
    senderId: number,
    documentId: string
  ) => ActiveDocument
  readonly isCurrent: (senderId: number, active: ActiveDocument) => boolean
  readonly revokeSender: (senderId: number) => void
}

export interface PreparedImageAsset {
  readonly receipt: ImageAssetMaterializationReceipt
  readonly commit: () => void
  readonly rollback: () => Promise<void>
}

export interface ImageAssetDispatchResult {
  readonly publication: Extract<ImageAssetInsertReceipt, {
    kind: 'published'
  }>['publication']
  readonly outcome: 'committed' | 'rejected' | 'noop' | 'cancelled'
}

export interface CoordinateImageAssetInsertOptions {
  readonly senderId: number
  readonly request: ImageAssetInsertRequest
  readonly authority: ImageAssetActiveDocumentAuthority
  readonly assertRevision: (
    documentId: string,
    revisionId: string
  ) => Promise<void>
  readonly prepare: () => Promise<PreparedImageAsset>
  readonly dispatch: (
    request: DocumentCoreMainDispatchRequest
  ) => Promise<ImageAssetDispatchResult>
}

function assertIdentity(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`)
  }
}

export function createImageAssetActiveDocumentAuthority():
ImageAssetActiveDocumentAuthority {
  const activeBySender = new Map<number, ActiveDocument>()
  let nextGeneration = 1

  const activate = (
    senderId: number,
    documentId: string
  ): ActiveDocument => {
    assertIdentity(documentId, 'Active image document id')
    const active = Object.freeze({
      documentId,
      generation: nextGeneration
    })
    nextGeneration += 1
    activeBySender.set(senderId, active)
    return active
  }

  const capture = (
    senderId: number,
    documentId: string
  ): ActiveDocument => {
    const active = activeBySender.get(senderId)
    if (active === undefined || active.documentId !== documentId) {
      throw new Error(
        `Image document ${documentId} is not active for sender ${senderId}`
      )
    }
    return active
  }

  const isCurrent = (
    senderId: number,
    active: ActiveDocument
  ): boolean => activeBySender.get(senderId) === active

  return Object.freeze({
    activate,
    capture,
    isCurrent,
    revokeSender: (senderId: number) => {
      activeBySender.delete(senderId)
    }
  })
}

export async function coordinateImageAssetInsert({
  senderId,
  request,
  authority,
  assertRevision,
  prepare,
  dispatch
}: CoordinateImageAssetInsertOptions): Promise<ImageAssetInsertReceipt> {
  const active = authority.capture(senderId, request.documentId)
  await assertRevision(request.documentId, request.revisionId)
  if (!authority.isCurrent(senderId, active)) {
    return Object.freeze({
      schema: 'image-asset-insert-receipt-1',
      kind: 'cancelled',
      documentId: request.documentId,
      reason: 'document-deactivated'
    })
  }

  const prepared = await prepare()
  let committed = false
  try {
    if (!authority.isCurrent(senderId, active)) {
      return Object.freeze({
        schema: 'image-asset-insert-receipt-1',
        kind: 'cancelled',
        documentId: request.documentId,
        reason: 'document-deactivated'
      })
    }
    const dispatched = await dispatch(Object.freeze({
      documentId: request.documentId,
      baseSnapshotId: request.baseSnapshotId,
      intent: Object.freeze({
        kind: 'insert-image',
        target: request.target,
        src: prepared.receipt.reference,
        alt: request.alt,
        ...(request.title === undefined ? {} : { title: request.title })
      })
    }))
    if (dispatched.outcome === 'committed') {
      prepared.commit()
      committed = true
    }
    return Object.freeze({
      schema: 'image-asset-insert-receipt-1',
      kind: 'published',
      documentId: request.documentId,
      asset: committed ? prepared.receipt : null,
      publication: dispatched.publication
    })
  } finally {
    if (!committed) await prepared.rollback()
  }
}
