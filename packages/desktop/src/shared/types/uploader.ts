import type { ImageAssetMediaType } from './imageAsset'
import type {
  UploaderDeletionClipboardCapability
} from './clipboardTransactions'

export type UploaderUploadSource = Readonly<{
  readonly kind: 'binary'
  readonly name: string
  readonly mediaType: ImageAssetMediaType
  readonly bytes: Uint8Array
}>

export interface UploaderUploadRequest {
  readonly schema: 'uploader-upload-1'
  readonly documentId: string
  readonly source: UploaderUploadSource
}

export interface UploaderUploadReceipt {
  readonly schema: 'uploader-upload-receipt-1'
  readonly documentId: string
  readonly url: string
  readonly deletionClipboard: UploaderDeletionClipboardCapability | null
}

export type UploaderAvailabilityRequest =
  | Readonly<{
    readonly schema: 'uploader-availability-1'
    readonly kind: 'picgo'
  }>
  | Readonly<{
    readonly schema: 'uploader-availability-1'
    readonly kind: 'custom-cli'
  }>

export interface UploaderAvailabilityReceipt {
  readonly schema: 'uploader-availability-receipt-1'
  readonly kind: 'picgo' | 'custom-cli'
  readonly available: boolean
}

export interface UploaderSelectionRequest {
  readonly schema: 'uploader-selection-1'
  readonly kind: 'picgo' | 'custom-cli'
}

export interface UploaderSelectionReceipt {
  readonly schema: 'uploader-selection-receipt-1'
  readonly kind: 'picgo' | 'custom-cli'
}

export type UploaderCustomExecutableReceipt =
  | Readonly<{
    readonly schema: 'uploader-custom-executable-receipt-1'
    readonly selected: false
    readonly executablePath: null
  }>
  | Readonly<{
    readonly schema: 'uploader-custom-executable-receipt-1'
    readonly selected: true
    readonly executablePath: string
  }>
