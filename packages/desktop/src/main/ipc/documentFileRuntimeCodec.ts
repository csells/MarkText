import type {
  DocumentCoreAttachRequest,
  DocumentCoreLifecycleIntent,
  DocumentCoreRelocateRequest,
  DocumentCoreResolveExternalChangeRequest,
  DocumentCoreSaveRequest
} from '../../shared/types/documentCore'

/*
 * These codecs are the only renderer-to-main admission seam for file
 * lifecycle requests. File source/configuration/path/revision never appear in
 * the accepted shapes.
 */

function closedRecord(
  value: unknown,
  label: string,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be a closed record`)
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.some(key => typeof key !== 'string') ||
    keys.length !== expectedKeys.length ||
    keys.some(key => !expectedKeys.includes(key as string))
  ) {
    throw new TypeError(`${label} fields are not closed`)
  }
  return value as Readonly<Record<string, unknown>>
}

function identifier(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1_024 ||
    [...value].some(character => {
      const codePoint = character.codePointAt(0) ?? 0
      return (
        codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f)
      )
    })
  ) {
    throw new TypeError(`${label} must be a bounded printable identifier`)
  }
  return value
}

function filename(value: unknown, label: string): string {
  const result = identifier(value, label)
  if (
    result === '.' ||
    result === '..' ||
    result.includes('/') ||
    result.includes('\\') ||
    result.trim() !== result
  ) {
    throw new TypeError(`${label} must be one filename, not a path`)
  }
  return result
}

export function decodeDocumentCoreAttachRequest(
  value: unknown
): DocumentCoreAttachRequest {
  const record = closedRecord(
    value,
    'document attach request',
    ['documentId']
  )
  return Object.freeze({
    documentId: identifier(
      record.documentId,
      'document attach request.documentId'
    )
  })
}

export function decodeDocumentCoreSaveRequest(
  value: unknown
): DocumentCoreSaveRequest {
  const record = closedRecord(
    value,
    'document save request',
    ['documentId', 'mode']
  )
  if (
    record.mode !== 'save' &&
    record.mode !== 'save-as' &&
    record.mode !== 'autosave'
  ) {
    throw new TypeError('document save request.mode is invalid')
  }
  return Object.freeze({
    documentId: identifier(
      record.documentId,
      'document save request.documentId'
    ),
    mode: record.mode
  })
}

export function decodeDocumentCoreRelocateRequest(
  value: unknown
): DocumentCoreRelocateRequest {
  const record = closedRecord(
    value,
    'document relocation request',
    ['documentId', 'intent']
  )
  const intentRecord = record.intent === null ||
    typeof record.intent !== 'object' ||
    Array.isArray(record.intent)
    ? null
    : record.intent as Readonly<Record<string, unknown>>
  if (intentRecord === null) {
    throw new TypeError('document relocation request.intent must be closed')
  }
  if (intentRecord.kind === 'move-to') {
    closedRecord(intentRecord, 'move-to intent', ['kind'])
    return Object.freeze({
      documentId: identifier(
        record.documentId,
        'document relocation request.documentId'
      ),
      intent: Object.freeze({ kind: 'move-to' as const })
    })
  }
  if (intentRecord.kind === 'rename') {
    const rename = closedRecord(
      intentRecord,
      'rename intent',
      ['kind', 'filename']
    )
    return Object.freeze({
      documentId: identifier(
        record.documentId,
        'document relocation request.documentId'
      ),
      intent: Object.freeze({
        kind: 'rename' as const,
        filename: filename(
          rename.filename,
          'document relocation request.intent.filename'
        )
      })
    })
  }
  throw new TypeError('document relocation request.intent.kind is invalid')
}

export function decodeDocumentCoreLifecycleIntent(
  value: unknown
): DocumentCoreLifecycleIntent {
  const unclosed = value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
    ? null
    : value as Readonly<Record<string, unknown>>
  if (unclosed === null) {
    throw new TypeError('document lifecycle intent must be a closed record')
  }

  if (
    unclosed.kind === 'save-all' ||
    unclosed.kind === 'close-saved' ||
    unclosed.kind === 'close-all' ||
    unclosed.kind === 'close-window'
  ) {
    const record = closedRecord(
      unclosed,
      'document lifecycle intent',
      ['kind']
    )
    return Object.freeze({
      kind: record.kind
    }) as DocumentCoreLifecycleIntent
  }
  if (unclosed.kind === 'close-document') {
    const record = closedRecord(
      unclosed,
      'close-document lifecycle intent',
      ['kind', 'documentId']
    )
    return Object.freeze({
      kind: 'close-document',
      documentId: identifier(
        record.documentId,
        'close-document lifecycle intent.documentId'
      )
    })
  }
  if (unclosed.kind === 'close-others') {
    const record = closedRecord(
      unclosed,
      'close-others lifecycle intent',
      ['kind', 'keepDocumentId']
    )
    return Object.freeze({
      kind: 'close-others',
      keepDocumentId: identifier(
        record.keepDocumentId,
        'close-others lifecycle intent.keepDocumentId'
      )
    })
  }
  throw new TypeError('document lifecycle intent.kind is invalid')
}

export function decodeDocumentCoreResolveExternalChangeRequest(
  value: unknown
): DocumentCoreResolveExternalChangeRequest {
  const record = closedRecord(
    value,
    'external document change request',
    ['documentId', 'resolution']
  )
  if (record.resolution !== 'reload' && record.resolution !== 'keep') {
    throw new TypeError(
      'external document change request.resolution is invalid'
    )
  }
  return Object.freeze({
    documentId: identifier(
      record.documentId,
      'external document change request.documentId'
    ),
    resolution: record.resolution
  })
}
