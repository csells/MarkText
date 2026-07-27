import type { ModelSelection } from '@marktext/document-core'
import type { DocumentCorePublication } from './documentCore'

export const IMAGE_ASSET_MEDIA_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml'
] as const)

export const MAX_IMAGE_ASSET_BYTES = 25 * 1024 * 1024

export type ImageAssetMediaType = typeof IMAGE_ASSET_MEDIA_TYPES[number]

export type ImageAssetStorage =
  | 'reference'
  | 'configured-folder'
  | 'document-relative'

export type ImageAssetSource =
  | Readonly<{
    readonly kind: 'native-capability'
    readonly token: string
  }>
  | Readonly<{
    readonly kind: 'binary'
    readonly name: string
    readonly mediaType: ImageAssetMediaType
    readonly bytes: Uint8Array
  }>

export interface ImageAssetInsertRequest {
  readonly schema: 'image-asset-insert-1'
  readonly documentId: string
  readonly baseSnapshotId: string
  readonly revisionId: string
  readonly target: ModelSelection
  readonly source: ImageAssetSource
  readonly storage: ImageAssetStorage
  readonly alt: string
  readonly title?: string
}

export type ImageAssetMaterializationReceipt = Readonly<{
  readonly schema: 'image-asset-receipt-1'
  readonly kind: 'referenced' | 'stored' | 'reused'
  readonly documentId: string
  readonly reference: string
  readonly mediaType: ImageAssetMediaType
  readonly byteLength: number
}>

export type ImageAssetInsertReceipt =
  | Readonly<{
    readonly schema: 'image-asset-insert-receipt-1'
    readonly kind: 'published'
    readonly documentId: string
    readonly asset: ImageAssetMaterializationReceipt | null
    readonly publication: DocumentCorePublication
  }>
  | Readonly<{
    readonly schema: 'image-asset-insert-receipt-1'
    readonly kind: 'cancelled'
    readonly documentId: string
    readonly reason: 'document-deactivated'
  }>

export interface ImageAssetActivationRequest {
  readonly schema: 'image-asset-activation-1'
  readonly documentId: string
}

export interface ImageAssetActivationReceipt {
  readonly schema: 'image-asset-activation-receipt-1'
  readonly documentId: string
  readonly generation: number
}

export interface ImageSourceCapability {
  readonly schema: 'image-source-capability-1'
  readonly token: string
}

export interface ImageDisplayRequest {
  readonly schema: 'image-display-1'
  readonly documentId: string
  readonly revisionId: string
  readonly reference: string
}

export type ImageDisplayReceipt =
  | Readonly<{
    readonly schema: 'image-display-receipt-1'
    readonly kind: 'resolved'
    readonly documentId: string
    readonly revisionId: string
    readonly reference: string
    readonly src: string
  }>
  | Readonly<{
    readonly schema: 'image-display-receipt-1'
    readonly kind: 'unavailable'
    readonly documentId: string
    readonly revisionId: string
    readonly reference: string
    readonly reason:
      | 'untitled-document'
      | 'unsafe-reference'
      | 'missing-image'
      | 'unsupported-image'
  }>
