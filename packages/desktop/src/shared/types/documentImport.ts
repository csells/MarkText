export const MAX_DOCUMENT_IMPORT_BYTES = 25 * 1024 * 1024

/**
 * Renderer intent contains file content only. It never carries an OS pathname,
 * destination, project root, window identity, or process option.
 */
export interface DocumentImportBinaryRequest {
  readonly schema: 'document-import-binary-request-1'
  readonly name: string
  readonly bytes: Uint8Array
}

export interface DocumentImportBinaryReceipt {
  readonly schema: 'document-import-binary-receipt-1'
  readonly disposition:
    | 'opened-markdown'
    | 'converted'
    | 'pandoc-unavailable'
}

export function decodeDocumentImportBinaryReceipt(
  value: unknown
): DocumentImportBinaryReceipt {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Document import receipt must be a closed record')
  }
  const record = value as Record<string, unknown>
  const fields = ['schema', 'disposition']
  const keys = Reflect.ownKeys(record)
  if (
    keys.length !== fields.length ||
    keys.some(key => typeof key !== 'string' || !fields.includes(key)) ||
    record.schema !== 'document-import-binary-receipt-1' ||
    (
      record.disposition !== 'opened-markdown' &&
      record.disposition !== 'converted' &&
      record.disposition !== 'pandoc-unavailable'
    )
  ) {
    throw new TypeError('Invalid document import receipt')
  }
  return Object.freeze({
    schema: 'document-import-binary-receipt-1',
    disposition: record.disposition
  })
}
