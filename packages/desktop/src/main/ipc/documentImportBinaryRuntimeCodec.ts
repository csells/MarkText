import path from 'node:path'
import type {
  DocumentImportBinaryRequest
} from '@shared/types/documentImport'
import {
  MAX_DOCUMENT_IMPORT_BYTES
} from '@shared/types/documentImport'
import { hasMarkdownExtension } from 'common/filesystem/paths'
import { PANDOC_EXTENSIONS } from '../config'

const MAX_FILENAME_LENGTH = 255

function closedRecord(
  value: unknown,
  label: string,
  fields: readonly string[]
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a closed record`)
  }
  const record = value as Record<string, unknown>
  const keys = Reflect.ownKeys(record)
  if (
    keys.length !== fields.length ||
    keys.some(key => typeof key !== 'string' || !fields.includes(key))
  ) {
    throw new TypeError(`${label} fields are not closed`)
  }
  return record
}

function safeFilename(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_FILENAME_LENGTH ||
    value === '.' ||
    value === '..' ||
    path.isAbsolute(value) ||
    value.includes('/') ||
    value.includes('\\') ||
    [...value].some(character => {
      const point = character.codePointAt(0) ?? 0
      return point <= 0x1f || (point >= 0x7f && point <= 0x9f)
    })
  ) {
    throw new TypeError('Document import name must be one safe filename')
  }
  return value
}

export function decodeDocumentImportBinaryRequest(
  value: unknown
): DocumentImportBinaryRequest {
  const record = closedRecord(value, 'Document import request', [
    'schema',
    'name',
    'bytes'
  ])
  if (record.schema !== 'document-import-binary-request-1') {
    throw new TypeError('Invalid document import schema')
  }
  if (!(record.bytes instanceof Uint8Array)) {
    throw new TypeError('Document import bytes must be a Uint8Array')
  }
  if (record.bytes.byteLength > MAX_DOCUMENT_IMPORT_BYTES) {
    throw new RangeError('Document import exceeds the supported size')
  }
  const name = safeFilename(record.name)
  const extension = path.extname(name).slice(1).toLowerCase()
  if (
    !hasMarkdownExtension(name) &&
    !PANDOC_EXTENSIONS.includes(extension)
  ) {
    throw new TypeError('Unsupported document import filename')
  }
  return Object.freeze({
    schema: 'document-import-binary-request-1',
    name,
    bytes: new Uint8Array(record.bytes)
  })
}
