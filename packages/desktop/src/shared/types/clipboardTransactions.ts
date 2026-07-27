import type { ModelSelection } from '@marktext/document-core'

export interface DocumentPathClipboardRequest {
  readonly schema: 'document-path-clipboard-1'
  readonly documentId: string
}

export interface DocumentPathClipboardReceipt {
  readonly schema: 'document-path-clipboard-receipt-1'
  readonly kind: 'written'
}

export function decodeDocumentPathClipboardReceipt(
  value: unknown
): DocumentPathClipboardReceipt {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'Document path clipboard receipt must be a closed record'
    )
  }
  const record = value as Record<string, unknown>
  const fields = ['schema', 'kind']
  const keys = Reflect.ownKeys(record)
  if (
    keys.length !== fields.length ||
    keys.some(key => typeof key !== 'string' || !fields.includes(key)) ||
    record.schema !== 'document-path-clipboard-receipt-1' ||
    record.kind !== 'written'
  ) {
    throw new TypeError('Invalid document path clipboard receipt')
  }
  return Object.freeze({
    schema: 'document-path-clipboard-receipt-1',
    kind: 'written'
  })
}

export interface DocumentClipboardPasteRequest {
  readonly schema: 'document-clipboard-paste-1'
  readonly documentId: string
  readonly baseSnapshotId: string
  readonly target: ModelSelection
}

export interface UploaderDeletionClipboardCapability {
  readonly schema: 'uploader-deletion-clipboard-capability-1'
  readonly token: string
}

export interface UploaderDeletionClipboardRequest {
  readonly schema: 'uploader-deletion-clipboard-request-1'
  readonly token: string
}

export interface UploaderDeletionClipboardReceipt {
  readonly schema: 'uploader-deletion-clipboard-receipt-1'
  readonly kind: 'written'
}

export function decodeUploaderDeletionClipboardCapability(
  value: unknown
): UploaderDeletionClipboardCapability {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'Uploader deletion clipboard capability must be a closed record'
    )
  }
  const record = value as Record<string, unknown>
  const fields = ['schema', 'token']
  const keys = Reflect.ownKeys(record)
  if (
    keys.length !== fields.length ||
    keys.some(key => typeof key !== 'string' || !fields.includes(key)) ||
    record.schema !== 'uploader-deletion-clipboard-capability-1' ||
    typeof record.token !== 'string' ||
    record.token.length === 0 ||
    record.token.length > 256 ||
    record.token.includes('\0')
  ) {
    throw new TypeError('Invalid uploader deletion clipboard capability')
  }
  return Object.freeze({
    schema: 'uploader-deletion-clipboard-capability-1',
    token: record.token
  })
}

export function decodeUploaderDeletionClipboardReceipt(
  value: unknown
): UploaderDeletionClipboardReceipt {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'Uploader deletion clipboard receipt must be a closed record'
    )
  }
  const record = value as Record<string, unknown>
  const fields = ['schema', 'kind']
  const keys = Reflect.ownKeys(record)
  if (
    keys.length !== fields.length ||
    keys.some(key => typeof key !== 'string' || !fields.includes(key)) ||
    record.schema !== 'uploader-deletion-clipboard-receipt-1' ||
    record.kind !== 'written'
  ) {
    throw new TypeError('Invalid uploader deletion clipboard receipt')
  }
  return Object.freeze({
    schema: 'uploader-deletion-clipboard-receipt-1',
    kind: 'written'
  })
}
