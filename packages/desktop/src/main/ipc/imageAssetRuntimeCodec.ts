import path from 'node:path'
import type {
  ImageAssetActivationRequest,
  ImageDisplayRequest,
  ImageAssetInsertRequest,
  ImageAssetMediaType,
  ImageAssetSource,
  ImageAssetStorage
} from '@shared/types/imageAsset'
import {
  IMAGE_ASSET_MEDIA_TYPES,
  MAX_IMAGE_ASSET_BYTES
} from '@shared/types/imageAsset'
import { decodeDocumentCoreMainDispatchRequest } from './documentCoreRuntimeCodec'

export { MAX_IMAGE_ASSET_BYTES }

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
  const filename = nonemptyString(value, 'Image asset name')
  if (
    filename === '.' ||
    filename === '..' ||
    path.isAbsolute(filename) ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.length > 255
  ) {
    throw new TypeError('Image asset name must be one safe filename')
  }
  return filename
}

function mediaType(value: unknown): ImageAssetMediaType {
  if (
    typeof value !== 'string' ||
    !IMAGE_ASSET_MEDIA_TYPES.includes(value as ImageAssetMediaType)
  ) {
    throw new TypeError('Unsupported image asset media type')
  }
  return value as ImageAssetMediaType
}

function source(value: unknown): ImageAssetSource {
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { kind?: unknown }).kind === 'native-capability'
  ) {
    const record = closedRecord(value, 'Image asset native source', [
      'kind',
      'token'
    ])
    return Object.freeze({
      kind: 'native-capability',
      token: nonemptyString(record.token, 'Image asset source capability')
    })
  }

  const record = closedRecord(value, 'Image asset binary source', [
    'kind',
    'name',
    'mediaType',
    'bytes'
  ])
  if (record.kind !== 'binary') {
    throw new TypeError('Unknown image asset source kind')
  }
  if (!(record.bytes instanceof Uint8Array)) {
    throw new TypeError('Image asset bytes must be a Uint8Array')
  }
  if (
    record.bytes.byteLength === 0 ||
    record.bytes.byteLength > MAX_IMAGE_ASSET_BYTES
  ) {
    throw new RangeError('Image asset bytes are outside the supported size')
  }
  return Object.freeze({
    kind: 'binary',
    name: safeFilename(record.name),
    mediaType: mediaType(record.mediaType),
    bytes: new Uint8Array(record.bytes)
  })
}

function storage(value: unknown): ImageAssetStorage {
  if (
    value !== 'reference' &&
    value !== 'configured-folder' &&
    value !== 'document-relative'
  ) {
    throw new TypeError('Unknown image asset storage policy')
  }
  return value
}

export function decodeImageAssetInsertRequest(
  value: unknown
): ImageAssetInsertRequest {
  const record = closedRecord(value, 'Image asset insertion request', [
    'schema',
    'documentId',
    'baseSnapshotId',
    'revisionId',
    'target',
    'source',
    'storage',
    'alt'
  ].concat(
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.hasOwn(value, 'title')
      ? ['title']
      : []
  ))
  if (record.schema !== 'image-asset-insert-1') {
    throw new TypeError('Invalid image asset insertion schema')
  }
  const documentId = nonemptyString(
    record.documentId,
    'Image asset documentId'
  )
  const baseSnapshotId = nonemptyString(
    record.baseSnapshotId,
    'Image asset baseSnapshotId'
  )
  const revisionId = nonemptyString(
    record.revisionId,
    'Image asset revisionId'
  )
  const decodedDispatch = decodeDocumentCoreMainDispatchRequest({
    documentId,
    baseSnapshotId,
    intent: {
      kind: 'insert-image',
      target: record.target,
      src: 'main-owned:image-asset',
      alt: record.alt,
      ...(record.title === undefined ? {} : { title: record.title })
    }
  })
  if (
    decodedDispatch.intent.kind !== 'insert-image' ||
    decodedDispatch.intent.target.revision !== revisionId
  ) {
    throw new TypeError(
      'Image asset revision does not match its parser-owned selection'
    )
  }
  return Object.freeze({
    schema: 'image-asset-insert-1',
    documentId,
    baseSnapshotId,
    revisionId,
    target: decodedDispatch.intent.target,
    source: source(record.source),
    storage: storage(record.storage),
    alt: decodedDispatch.intent.alt,
    ...(decodedDispatch.intent.title === undefined
      ? {}
      : { title: decodedDispatch.intent.title })
  })
}

export function decodeImageAssetActivationRequest(
  value: unknown
): ImageAssetActivationRequest {
  const record = closedRecord(value, 'Image asset activation request', [
    'schema',
    'documentId'
  ])
  if (record.schema !== 'image-asset-activation-1') {
    throw new TypeError('Invalid image asset activation schema')
  }
  return Object.freeze({
    schema: 'image-asset-activation-1',
    documentId: nonemptyString(record.documentId, 'Image asset documentId'),
  })
}

export function decodeImageDisplayRequest(value: unknown): ImageDisplayRequest {
  const record = closedRecord(value, 'Image display request', [
    'schema',
    'documentId',
    'revisionId',
    'reference'
  ])
  if (record.schema !== 'image-display-1') {
    throw new TypeError('Invalid image display schema')
  }
  const reference = nonemptyString(
    record.reference,
    'Image display reference'
  )
  if (reference.length > 8192) {
    throw new RangeError('Image display reference is too long')
  }
  return Object.freeze({
    schema: 'image-display-1',
    documentId: nonemptyString(
      record.documentId,
      'Image display documentId'
    ),
    revisionId: nonemptyString(
      record.revisionId,
      'Image display revisionId'
    ),
    reference
  })
}
