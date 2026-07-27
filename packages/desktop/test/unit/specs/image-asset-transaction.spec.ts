import { describe, expect, it, vi } from 'vitest'
import {
  coordinateImageAssetInsert,
  createImageAssetActiveDocumentAuthority
} from 'main_renderer/imageAssets/imageAssetTransaction'
import type {
  ImageAssetInsertRequest,
  ImageAssetMaterializationReceipt
} from '@shared/types/imageAsset'
import type { DocumentCorePublication } from '@shared/types/documentCore'

const target = Object.freeze({
  session: 'session:a',
  revision: 'revision:a',
  view: 'markup' as const,
  anchor: Object.freeze({ offset: 0, affinity: 'next' as const }),
  focus: Object.freeze({ offset: 0, affinity: 'next' as const })
}) as unknown as ImageAssetInsertRequest['target']

const request: ImageAssetInsertRequest = Object.freeze({
  schema: 'image-asset-insert-1',
  documentId: 'document:a',
  baseSnapshotId: 'snapshot:a',
  revisionId: 'revision:a',
  target,
  source: Object.freeze({
    kind: 'binary',
    name: 'clipboard.png',
    mediaType: 'image/png',
    bytes: new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    ])
  }),
  storage: 'document-relative',
  alt: ''
})

const receipt: ImageAssetMaterializationReceipt = Object.freeze({
  schema: 'image-asset-receipt-1',
  kind: 'stored',
  documentId: 'document:a',
  reference: 'assets/hash.png',
  mediaType: 'image/png',
  byteLength: 8
})

describe('image asset insertion transaction', () => {
  it('rolls back a delayed A preparation after B becomes active and mutates neither document', async() => {
    const authority = createImageAssetActiveDocumentAuthority()
    authority.activate(7, 'document:a')
    let release: (() => void) | undefined
    const delayed = new Promise<void>(resolve => {
      release = resolve
    })
    let enteredPreparation: (() => void) | undefined
    const preparationStarted = new Promise<void>(resolve => {
      enteredPreparation = resolve
    })
    const rollback = vi.fn(async() => {})
    const commit = vi.fn()
    const dispatch = vi.fn()
    const insertion = coordinateImageAssetInsert({
      senderId: 7,
      request,
      authority,
      assertRevision: vi.fn(async() => {}),
      prepare: async() => {
        enteredPreparation?.()
        await delayed
        return { receipt, rollback, commit }
      },
      dispatch
    })

    await preparationStarted
    authority.activate(7, 'document:b')
    release?.()

    await expect(insertion).resolves.toEqual({
      schema: 'image-asset-insert-receipt-1',
      kind: 'cancelled',
      documentId: 'document:a',
      reason: 'document-deactivated'
    })
    expect(dispatch).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    expect(rollback).toHaveBeenCalledOnce()
  })

  it('rolls back newly staged output when document commit fails', async() => {
    const authority = createImageAssetActiveDocumentAuthority()
    authority.activate(7, 'document:a')
    const rollback = vi.fn(async() => {})
    const commit = vi.fn()

    await expect(coordinateImageAssetInsert({
      senderId: 7,
      request,
      authority,
      assertRevision: vi.fn(async() => {}),
      prepare: async() => ({ receipt, rollback, commit }),
      dispatch: vi.fn(async() => {
        throw new Error('stale main head')
      })
    })).rejects.toThrow(/stale/)

    expect(commit).not.toHaveBeenCalled()
    expect(rollback).toHaveBeenCalledOnce()
  })

  it('dispatches exactly one parser-owned insert-image intent and commits the asset', async() => {
    const authority = createImageAssetActiveDocumentAuthority()
    authority.activate(7, 'document:a')
    const rollback = vi.fn(async() => {})
    const commit = vi.fn()
    const publication = Object.freeze({
      baseSnapshotId: 'snapshot:a',
      envelope: Object.freeze({})
    }) as unknown as DocumentCorePublication
    const dispatch = vi.fn(async() => Object.freeze({
      publication,
      outcome: 'committed' as const
    }))

    await expect(coordinateImageAssetInsert({
      senderId: 7,
      request,
      authority,
      assertRevision: vi.fn(async() => {}),
      prepare: async() => ({ receipt, rollback, commit }),
      dispatch
    })).resolves.toMatchObject({
      schema: 'image-asset-insert-receipt-1',
      kind: 'published',
      documentId: 'document:a',
      asset: receipt,
      publication
    })

    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledWith({
      documentId: 'document:a',
      baseSnapshotId: 'snapshot:a',
      intent: {
        kind: 'insert-image',
        target,
        src: 'assets/hash.png',
        alt: ''
      }
    })
    expect(commit).toHaveBeenCalledOnce()
    expect(rollback).not.toHaveBeenCalled()
  })
})
