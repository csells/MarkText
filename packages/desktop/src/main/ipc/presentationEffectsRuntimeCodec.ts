import {
  EXTERNAL_RESOURCE_TARGETS,
  type DocumentRevealRequest,
  type ExternalResourceOpenRequest,
  type ExternalResourceTarget,
  type ImageFolderOpenRequest,
  type ProjectRevealRequest,
  type StaticOutputRevealRequest
} from '../../shared/types/presentationEffects'

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

function identifier(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    value.includes('\0')
  ) {
    throw new TypeError(`${label} must be one bounded identifier`)
  }
  return value
}

function externalTarget(value: unknown): ExternalResourceTarget {
  if (
    typeof value !== 'string' ||
    !EXTERNAL_RESOURCE_TARGETS.includes(
      value as ExternalResourceTarget
    )
  ) {
    throw new TypeError('Unknown external resource target')
  }
  return value as ExternalResourceTarget
}

function safeEntrySegment(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 255 ||
    value === '.' ||
    value === '..' ||
    value.includes('\0') ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    throw new TypeError('Project reveal requires safe entry segments')
  }
  return value
}

export function decodeExternalResourceOpenRequest(
  value: unknown
): ExternalResourceOpenRequest {
  const record = closedRecord(value, 'External resource request', [
    'schema',
    'target'
  ])
  if (record.schema !== 'external-resource-open-1') {
    throw new TypeError('Invalid external resource request schema')
  }
  return Object.freeze({
    schema: 'external-resource-open-1',
    target: externalTarget(record.target)
  })
}

export function decodeDocumentRevealRequest(
  value: unknown
): DocumentRevealRequest {
  const record = closedRecord(value, 'Document reveal request', [
    'schema',
    'documentId'
  ])
  if (record.schema !== 'document-reveal-1') {
    throw new TypeError('Invalid document reveal request schema')
  }
  return Object.freeze({
    schema: 'document-reveal-1',
    documentId: identifier(record.documentId, 'Document reveal identity')
  })
}

export function decodeProjectRevealRequest(
  value: unknown
): ProjectRevealRequest {
  const record = closedRecord(value, 'Project reveal request', [
    'schema',
    'entrySegments'
  ])
  if (
    record.schema !== 'project-reveal-1' ||
    !Array.isArray(record.entrySegments) ||
    record.entrySegments.length > 128
  ) {
    throw new TypeError('Invalid project reveal request')
  }
  return Object.freeze({
    schema: 'project-reveal-1',
    entrySegments: Object.freeze(
      record.entrySegments.map(safeEntrySegment)
    )
  })
}

export function decodeImageFolderOpenRequest(
  value: unknown
): ImageFolderOpenRequest {
  const record = closedRecord(value, 'Image folder request', ['schema'])
  if (record.schema !== 'image-folder-open-1') {
    throw new TypeError('Invalid image folder request schema')
  }
  return Object.freeze({ schema: 'image-folder-open-1' })
}

export function decodeStaticOutputRevealRequest(
  value: unknown
): StaticOutputRevealRequest {
  const record = closedRecord(value, 'Static output reveal request', [
    'schema',
    'documentId',
    'revisionId',
    'consumer',
    'view'
  ])
  if (
    record.schema !== 'static-output-reveal-1' ||
    (
      record.consumer !== 'styled-html' &&
      record.consumer !== 'pdf' &&
      record.consumer !== 'print'
    ) ||
    (
      record.view !== 'markup' &&
      record.view !== 'original' &&
      record.view !== 'revised'
    )
  ) {
    throw new TypeError('Invalid static output reveal request')
  }
  return Object.freeze({
    schema: 'static-output-reveal-1',
    documentId: identifier(
      record.documentId,
      'Static output document identity'
    ),
    revisionId: identifier(
      record.revisionId,
      'Static output revision identity'
    ),
    consumer: record.consumer,
    view: record.view
  })
}
