import type {
  UploaderDeletionClipboardRequest
} from '../../shared/types/clipboardTransactions'

export function decodeUploaderDeletionClipboardRequest(
  value: unknown
): UploaderDeletionClipboardRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'Uploader deletion clipboard request must be a closed record'
    )
  }
  const record = value as Record<string, unknown>
  const fields = ['schema', 'token']
  const keys = Reflect.ownKeys(record)
  if (
    keys.length !== fields.length ||
    keys.some(key => typeof key !== 'string' || !fields.includes(key)) ||
    record.schema !== 'uploader-deletion-clipboard-request-1' ||
    typeof record.token !== 'string' ||
    record.token.length === 0 ||
    record.token.length > 256 ||
    record.token.includes('\0')
  ) {
    throw new TypeError('Invalid uploader deletion clipboard request fields')
  }
  return Object.freeze({
    schema: 'uploader-deletion-clipboard-request-1',
    token: record.token
  })
}
