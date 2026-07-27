import type {
  DocumentPathClipboardRequest
} from '@shared/types/clipboardTransactions'

export function decodeDocumentPathClipboardRequest(
  value: unknown
): DocumentPathClipboardRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'Document path clipboard request must be a closed record'
    )
  }
  const record = value as Record<string, unknown>
  const fields = ['schema', 'documentId']
  const keys = Reflect.ownKeys(record)
  if (
    keys.length !== fields.length ||
    keys.some(key => typeof key !== 'string' || !fields.includes(key)) ||
    record.schema !== 'document-path-clipboard-1' ||
    typeof record.documentId !== 'string' ||
    record.documentId.length === 0 ||
    record.documentId.length > 1024 ||
    record.documentId.includes('\0')
  ) {
    throw new TypeError('Document path clipboard request fields are invalid')
  }
  return Object.freeze({
    schema: 'document-path-clipboard-1',
    documentId: record.documentId
  })
}
