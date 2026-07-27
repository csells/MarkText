import {
  IMAGE_ASSET_MEDIA_TYPES,
  MAX_IMAGE_ASSET_BYTES
} from '@shared/types/imageAsset'
import type {
  UploaderAvailabilityReceipt,
  UploaderAvailabilityRequest,
  UploaderUploadReceipt,
  UploaderUploadRequest,
  UploaderUploadSource
} from '@shared/types/uploader'
import {
  decodeUploaderDeletionClipboardCapability,
  decodeUploaderDeletionClipboardReceipt,
  type UploaderDeletionClipboardCapability,
  type UploaderDeletionClipboardRequest
} from '@shared/types/clipboardTransactions'

function closedRecord(
  value: unknown,
  label: string,
  fields: readonly string[]
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a closed record`)
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length !== fields.length ||
    keys.some(key => !fields.includes(key))
  ) {
    throw new TypeError(`${label} fields are not closed`)
  }
  return record
}

export function decodeUploaderUploadReceipt(
  value: unknown,
  documentId: string
): UploaderUploadReceipt {
  const record = closedRecord(value, 'Uploader receipt', [
    'schema',
    'documentId',
    'url',
    'deletionClipboard'
  ])
  if (
    record.schema !== 'uploader-upload-receipt-1' ||
    record.documentId !== documentId ||
    typeof record.url !== 'string'
  ) {
    throw new TypeError('Uploader receipt identity is invalid')
  }
  try {
    const parsed = new URL(record.url)
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.hostname.length === 0 ||
      /\s/.test(record.url)
    ) {
      throw new TypeError('Uploader receipt URL is invalid')
    }
  } catch {
    throw new TypeError('Uploader receipt URL is invalid')
  }
  return Object.freeze({
    schema: 'uploader-upload-receipt-1',
    documentId,
    url: record.url,
    deletionClipboard: record.deletionClipboard === null
      ? null
      : decodeUploaderDeletionClipboardCapability(record.deletionClipboard)
  })
}

export async function uploadImage(
  documentId: string,
  source: UploaderUploadSource
): Promise<UploaderUploadReceipt> {
  if (!IMAGE_ASSET_MEDIA_TYPES.includes(source.mediaType)) {
    throw new TypeError('Unsupported uploader image media type')
  }
  if (
    source.kind !== 'binary' ||
    source.name.length === 0 ||
    !(source.bytes instanceof Uint8Array) ||
    source.bytes.byteLength === 0 ||
    source.bytes.byteLength > MAX_IMAGE_ASSET_BYTES
  ) {
    throw new RangeError('Uploader image is outside the size boundary')
  }
  const request: UploaderUploadRequest = Object.freeze({
    schema: 'uploader-upload-1',
    documentId,
    source: Object.freeze({
      kind: 'binary',
      name: source.name,
      mediaType: source.mediaType,
      bytes: new Uint8Array(source.bytes)
    })
  })
  const receipt = decodeUploaderUploadReceipt(
    await window.uploader.uploadImage(request),
    documentId
  )
  return receipt
}

export async function copyUploaderDeletionUrl(
  rawCapability: UploaderDeletionClipboardCapability
): Promise<boolean> {
  const capability = decodeUploaderDeletionClipboardCapability(
    rawCapability
  )
  const request: UploaderDeletionClipboardRequest = Object.freeze({
    schema: 'uploader-deletion-clipboard-request-1',
    token: capability.token
  })
  decodeUploaderDeletionClipboardReceipt(
    await window.uploader.copyDeletionUrl(request)
  )
  return true
}

export async function inspectConfiguredUploader(
  kind: UploaderAvailabilityRequest['kind']
): Promise<boolean> {
  const request: UploaderAvailabilityRequest = Object.freeze({
    schema: 'uploader-availability-1',
    kind
  })
  const record = closedRecord(
    await window.uploader.inspectAvailability(request),
    'Uploader availability receipt',
    ['schema', 'kind', 'available']
  )
  if (
    record.schema !== 'uploader-availability-receipt-1' ||
    record.kind !== kind ||
    typeof record.available !== 'boolean'
  ) {
    throw new TypeError('Uploader availability receipt is invalid')
  }
  const receipt: UploaderAvailabilityReceipt = Object.freeze({
    schema: 'uploader-availability-receipt-1',
    kind,
    available: record.available
  })
  return receipt.available
}
