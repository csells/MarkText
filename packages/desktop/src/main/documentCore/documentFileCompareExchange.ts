import { createHash } from 'node:crypto'

const SHA256_PATTERN = /^[0-9a-f]{64}$/u

export type DocumentCoreFileByteHash = string | null

export interface DocumentCoreFileCompareExchangeRequest {
  readonly schema: 'document-core-file-compare-exchange-1'
  readonly pathname: string
  /** SHA-256 of the expected file bytes; null means the path must be absent. */
  readonly expectedByteHash: DocumentCoreFileByteHash
  /** Exact replacement bytes; null removes the expected file. */
  readonly bytes: Uint8Array | null
}

export type DocumentCoreFileCompareExchangeResult =
  | Readonly<{
    readonly schema: 'document-core-file-compare-exchange-result-1'
    readonly kind: 'exchanged'
    readonly previousByteHash: DocumentCoreFileByteHash
  }>
  | Readonly<{
    readonly schema: 'document-core-file-compare-exchange-result-1'
    readonly kind: 'conflict'
    readonly actualByteHash: DocumentCoreFileByteHash
  }>

export function documentCoreFileByteHash(
  bytes: Uint8Array | null
): DocumentCoreFileByteHash {
  return bytes === null
    ? null
    : createHash('sha256').update(bytes).digest('hex')
}

function assertByteHash(
  value: unknown,
  label: string
): asserts value is DocumentCoreFileByteHash {
  if (
    value !== null &&
    (
      typeof value !== 'string' ||
      !SHA256_PATTERN.test(value)
    )
  ) {
    throw new TypeError(`${label} must be a SHA-256 byte hash or null`)
  }
}

function isUint8Array(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === '[object Uint8Array]'
  )
}

/**
 * Strict native-boundary decoder for the only document-file mutation shape.
 *
 * Keeping this closed prevents an unchecked or unconditional write variant
 * from being smuggled into the filesystem surface.
 */
export function decodeDocumentCoreFileCompareExchangeRequest(
  value: unknown
): DocumentCoreFileCompareExchangeRequest {
  if (
    value === null ||
    typeof value !== 'object' ||
    Reflect.ownKeys(value).length !== 4 ||
    !('schema' in value) ||
    value.schema !== 'document-core-file-compare-exchange-1' ||
    !('pathname' in value) ||
    typeof value.pathname !== 'string' ||
    value.pathname.length === 0 ||
    !('expectedByteHash' in value) ||
    !('bytes' in value) ||
    (
      value.bytes !== null &&
      !isUint8Array(value.bytes)
    )
  ) {
    throw new TypeError('Document file compare-exchange request is not closed')
  }
  assertByteHash(value.expectedByteHash, 'expectedByteHash')
  return Object.freeze({
    schema: 'document-core-file-compare-exchange-1',
    pathname: value.pathname,
    expectedByteHash: value.expectedByteHash,
    bytes: value.bytes === null ? null : Uint8Array.from(value.bytes)
  })
}

export function decodeDocumentCoreFileCompareExchangeResult(
  value: unknown
): DocumentCoreFileCompareExchangeResult {
  if (
    value === null ||
    typeof value !== 'object' ||
    Reflect.ownKeys(value).length !== 3 ||
    !('schema' in value) ||
    value.schema !== 'document-core-file-compare-exchange-result-1' ||
    !('kind' in value) ||
    (
      value.kind !== 'exchanged' &&
      value.kind !== 'conflict'
    )
  ) {
    throw new TypeError('Invalid document file compare-exchange result')
  }
  if (value.kind === 'exchanged') {
    if (
      !('previousByteHash' in value) ||
      'actualByteHash' in value
    ) {
      throw new TypeError('Invalid exchanged document file result')
    }
    assertByteHash(value.previousByteHash, 'previousByteHash')
    return Object.freeze({
      schema: 'document-core-file-compare-exchange-result-1',
      kind: 'exchanged',
      previousByteHash: value.previousByteHash
    })
  }
  if (
    !('actualByteHash' in value) ||
    'previousByteHash' in value
  ) {
    throw new TypeError('Invalid conflicted document file result')
  }
  assertByteHash(value.actualByteHash, 'actualByteHash')
  return Object.freeze({
    schema: 'document-core-file-compare-exchange-result-1',
    kind: 'conflict',
    actualByteHash: value.actualByteHash
  })
}
