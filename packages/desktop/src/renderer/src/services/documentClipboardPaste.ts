import type {
  DocumentClipboardPasteRequest
} from '@shared/types/clipboardTransactions'

export interface DocumentClipboardPasteOuterReceipt {
  readonly documentId: string
  readonly baseSnapshotId: string
  readonly envelope: unknown
  readonly execution: unknown
}

export type DocumentClipboardPasteInvoker = (
  channel: 'mt::document::paste-clipboard',
  request: DocumentClipboardPasteRequest
) => Promise<unknown>

function assertPublication(
  value: unknown,
  expectedDocumentId: string,
  expectedBaseSnapshotId: string
): DocumentClipboardPasteOuterReceipt {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== 5
  ) {
    throw new TypeError(
      'Main returned an invalid document clipboard paste publication'
    )
  }
  const fields = Object.freeze([
    'documentId',
    'baseSnapshotId',
    'envelope',
    'execution',
    'capabilities'
  ])
  const record: Record<string, unknown> = {}
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new TypeError(
        'Main returned an invalid document clipboard paste publication'
      )
    }
    record[field] = descriptor.value
  }
  if (
    Reflect.ownKeys(value).some(key =>
      typeof key !== 'string' || !fields.includes(key)) ||
    record['documentId'] !== expectedDocumentId ||
    record['baseSnapshotId'] !== expectedBaseSnapshotId ||
    record['envelope'] === null ||
    typeof record['envelope'] !== 'object' ||
    Array.isArray(record['envelope']) ||
    record['execution'] === null ||
    typeof record['execution'] !== 'object' ||
    Array.isArray(record['execution']) ||
    record['capabilities'] === null ||
    typeof record['capabilities'] !== 'object' ||
    Array.isArray(record['capabilities'])
  ) {
    throw new TypeError(
      'Main returned an invalid document clipboard paste publication'
    )
  }
  return Object.freeze({
    documentId: expectedDocumentId,
    baseSnapshotId: expectedBaseSnapshotId,
    envelope: record['envelope'],
    execution: record['execution'],
    capabilities: record['capabilities']
  })
}

export async function pasteDocumentClipboard(
  request: DocumentClipboardPasteRequest,
  invoke: DocumentClipboardPasteInvoker = (
    channel,
    value
  ) => window.electron.ipcRenderer.invoke(channel, value)
): Promise<DocumentClipboardPasteOuterReceipt> {
  const publication = await invoke(
    'mt::document::paste-clipboard',
    request
  )
  return assertPublication(
    publication,
    request.documentId,
    request.baseSnapshotId
  )
}
