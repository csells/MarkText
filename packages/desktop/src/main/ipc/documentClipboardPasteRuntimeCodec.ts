import type {
  DocumentClipboardPasteRequest
} from '@shared/types/clipboardTransactions'
import {
  decodeDocumentCoreMainDispatchRequest
} from './documentCoreRuntimeCodec'

export function decodeDocumentClipboardPasteRequest(
  value: unknown
): DocumentClipboardPasteRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'Document clipboard paste request must be a closed record'
    )
  }
  const record = value as Record<string, unknown>
  const fields = ['schema', 'documentId', 'baseSnapshotId', 'target']
  const keys = Reflect.ownKeys(record)
  if (
    keys.length !== fields.length ||
    keys.some(key => typeof key !== 'string' || !fields.includes(key)) ||
    record.schema !== 'document-clipboard-paste-1'
  ) {
    throw new TypeError('Document clipboard paste request fields are invalid')
  }

  // Reuse the sole document-intent codec so selection identity, offsets,
  // affinities, and identifier bounds cannot drift from normal dispatch.
  const dispatch = decodeDocumentCoreMainDispatchRequest({
    documentId: record.documentId,
    baseSnapshotId: record.baseSnapshotId,
    intent: {
      kind: 'paste-text',
      target: record.target,
      payload: { kind: 'external-text', text: '' }
    }
  })
  if (dispatch.intent.kind !== 'paste-text') {
    throw new TypeError('Document clipboard paste target is invalid')
  }
  return Object.freeze({
    schema: 'document-clipboard-paste-1',
    documentId: dispatch.documentId,
    baseSnapshotId: dispatch.baseSnapshotId,
    target: dispatch.intent.target
  })
}
