import {
  freezeDocumentCoreHistoryState,
  type DocumentCoreExternalChangeResult,
  type DocumentCorePathReceipt,
  type DocumentCoreSaveReceipt,
  type DocumentCoreTabDescriptor
} from '@shared/types/documentCore'
import {
  closedRecord as decodeClosedRecord
} from '@shared/types/closedRecord'

export type DocumentCoreSavedReceipt = Extract<
  DocumentCoreSaveReceipt,
  { readonly kind: 'written' }
>

function closedRecord(
  value: unknown,
  label: string,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  return decodeClosedRecord(value, label, { required: keys })
}
function printableString(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 32_768 ||
    [...value].some(character => {
      const codePoint = character.codePointAt(0) ?? 0
      return (
        codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f)
      )
    })
  ) {
    throw new TypeError(`${label} must be a bounded printable string`)
  }
  return value
}

export function decodeDocumentCoreTabDescriptor(
  value: unknown
): DocumentCoreTabDescriptor {
  const record = closedRecord(value, 'document tab descriptor', [
    'schema',
    'documentId',
    'filename',
    'pathname',
    'selected'
  ])
  if (
    record.schema !== 'document-core-tab-1' ||
    typeof record.selected !== 'boolean' ||
    (
      record.pathname !== null &&
      typeof record.pathname !== 'string'
    )
  ) {
    throw new TypeError('Invalid document tab descriptor')
  }
  return Object.freeze({
    schema: record.schema,
    documentId: printableString(
      record.documentId,
      'document tab descriptor.documentId'
    ),
    filename: printableString(
      record.filename,
      'document tab descriptor.filename'
    ),
    pathname: record.pathname,
    selected: record.selected
  })
}

export function decodeDocumentCoreSavedReceipt(
  value: unknown
): DocumentCoreSavedReceipt {
  const record = closedRecord(value, 'document save receipt', [
    'schema',
    'kind',
    'documentId',
    'pathname',
    'revisionId',
    'historyState'
  ])
  if (
    record.schema !== 'document-core-save-receipt-1' ||
    record.kind !== 'written'
  ) {
    throw new TypeError('Invalid document save receipt')
  }
  closedRecord(record.historyState, 'document save history', [
    'canUndo',
    'canRedo',
    'dirty',
    'headIdentity',
    'savedIdentity'
  ])
  return Object.freeze({
    schema: record.schema,
    kind: record.kind,
    documentId: printableString(
      record.documentId,
      'document save receipt.documentId'
    ),
    pathname: printableString(
      record.pathname,
      'document save receipt.pathname'
    ),
    revisionId: printableString(
      record.revisionId,
      'document save receipt.revisionId'
    ),
    historyState: freezeDocumentCoreHistoryState(record.historyState)
  })
}

export function decodeDocumentCorePathReceipt(
  value: unknown
): DocumentCorePathReceipt {
  const record = closedRecord(value, 'document path receipt', [
    'schema',
    'documentId',
    'previousPathname',
    'pathname',
    'filename'
  ])
  if (record.schema !== 'document-core-path-receipt-1') {
    throw new TypeError('Invalid document path receipt')
  }
  return Object.freeze({
    schema: record.schema,
    documentId: printableString(
      record.documentId,
      'document path receipt.documentId'
    ),
    previousPathname: printableString(
      record.previousPathname,
      'document path receipt.previousPathname'
    ),
    pathname: printableString(
      record.pathname,
      'document path receipt.pathname'
    ),
    filename: printableString(
      record.filename,
      'document path receipt.filename'
    )
  })
}

export function decodeDocumentCoreExternalChangeResult(
  value: unknown
): DocumentCoreExternalChangeResult {
  if (
    value !== null &&
    typeof value === 'object' &&
    'kind' in value &&
    (value.kind === 'removed' || value.kind === 'kept')
  ) {
    const record = closedRecord(value, 'external document change', [
      'schema',
      'kind',
      'documentId'
    ])
    if (
      record.schema !== 'document-core-file-reload-1' ||
      (record.kind !== 'removed' && record.kind !== 'kept')
    ) {
      throw new TypeError('Invalid external document change')
    }
    return Object.freeze({
      schema: record.schema,
      kind: record.kind,
      documentId: printableString(
        record.documentId,
        'external document change.documentId'
      )
    })
  }
  const record = closedRecord(value, 'external document change', [
    'schema',
    'kind',
    'documentId',
    'revisionId',
    'historyState'
  ])
  if (
    record.schema !== 'document-core-file-reload-1' ||
    (
      record.kind !== 'reloaded' &&
      record.kind !== 'unchanged' &&
      record.kind !== 'conflict'
    )
  ) {
    throw new TypeError('Invalid external document change')
  }
  closedRecord(record.historyState, 'external document change history', [
    'canUndo',
    'canRedo',
    'dirty',
    'headIdentity',
    'savedIdentity'
  ])
  return Object.freeze({
    schema: record.schema,
    kind: record.kind,
    documentId: printableString(
      record.documentId,
      'external document change.documentId'
    ),
    revisionId: printableString(
      record.revisionId,
      'external document change.revisionId'
    ),
    historyState: freezeDocumentCoreHistoryState(record.historyState)
  })
}
