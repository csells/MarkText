import path from 'node:path'
import {
  IMAGE_ASSET_MEDIA_TYPES,
  MAX_IMAGE_ASSET_BYTES,
  type ImageAssetMediaType
} from '../../shared/types/imageAsset'
import type {
  UploaderAvailabilityRequest,
  UploaderSelectionRequest,
  UploaderUploadRequest,
  UploaderUploadSource
} from '../../shared/types/uploader'

export const MAX_UPLOADER_IMAGE_BYTES = MAX_IMAGE_ASSET_BYTES

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

function nonemptyString(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0')
  ) {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}

function safeFilename(value: unknown): string {
  const name = nonemptyString(value, 'Uploader binary name')
  if (
    name === '.' ||
    name === '..' ||
    name.length > 255 ||
    path.isAbsolute(name) ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    throw new TypeError('Uploader binary name must be one safe filename')
  }
  return name
}

function mediaType(value: unknown): ImageAssetMediaType {
  if (
    typeof value !== 'string' ||
    !IMAGE_ASSET_MEDIA_TYPES.includes(value as ImageAssetMediaType)
  ) {
    throw new TypeError('Unsupported uploader image media type')
  }
  return value as ImageAssetMediaType
}

function source(value: unknown): UploaderUploadSource {
  const record = closedRecord(value, 'Uploader binary source', [
    'kind',
    'name',
    'mediaType',
    'bytes'
  ])
  if (record.kind !== 'binary') {
    throw new TypeError('Unknown uploader source kind')
  }
  if (!(record.bytes instanceof Uint8Array)) {
    throw new TypeError('Uploader binary bytes must be a Uint8Array')
  }
  if (
    record.bytes.byteLength === 0 ||
    record.bytes.byteLength > MAX_UPLOADER_IMAGE_BYTES
  ) {
    throw new RangeError('Uploader binary bytes are outside the size boundary')
  }
  return Object.freeze({
    kind: 'binary',
    name: safeFilename(record.name),
    mediaType: mediaType(record.mediaType),
    bytes: new Uint8Array(record.bytes)
  })
}

export function decodeUploaderUploadRequest(
  value: unknown
): UploaderUploadRequest {
  const record = closedRecord(value, 'Uploader request', [
    'schema',
    'documentId',
    'source'
  ])
  if (record.schema !== 'uploader-upload-1') {
    throw new TypeError('Invalid uploader request schema')
  }
  return Object.freeze({
    schema: 'uploader-upload-1',
    documentId: nonemptyString(record.documentId, 'Uploader documentId'),
    source: source(record.source)
  })
}

export function decodeUploaderAvailabilityRequest(
  value: unknown
): UploaderAvailabilityRequest {
  const record = closedRecord(value, 'Uploader availability request', [
    'schema',
    'kind'
  ])
  if (
    record.schema !== 'uploader-availability-1' ||
    (record.kind !== 'picgo' && record.kind !== 'custom-cli')
  ) {
    throw new TypeError('Invalid uploader availability request')
  }
  return Object.freeze({
    schema: 'uploader-availability-1',
    kind: record.kind
  })
}

export function decodeUploaderSelectionRequest(
  value: unknown
): UploaderSelectionRequest {
  const record = closedRecord(value, 'Uploader selection request', [
    'schema',
    'kind'
  ])
  if (
    record.schema !== 'uploader-selection-1' ||
    (record.kind !== 'picgo' && record.kind !== 'custom-cli')
  ) {
    throw new TypeError('Invalid uploader selection request')
  }
  return Object.freeze({
    schema: 'uploader-selection-1',
    kind: record.kind
  })
}
