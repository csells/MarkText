import {
  closedRecord as decodeClosedRecord
} from '@shared/types/closedRecord'
import type {
  DocumentCoreStaticSinkReceipt
} from '@shared/types/documentCore'
import type { SourceHashV1 } from '@marktext/document-core'

type ClosedRecord = Readonly<Record<string, unknown>>

function closedRecord(
  value: unknown,
  fields: readonly string[]
): ClosedRecord {
  return decodeClosedRecord(
    value,
    'Static sink receipt',
    { required: fields }
  ) as ClosedRecord
}

function identifier(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1_024 ||
    [...value].some(character => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
    })
  ) {
    throw new TypeError(`Static sink receipt ${label} is invalid`)
  }
  return value
}

function view(value: unknown) {
  if (value !== 'markup' && value !== 'original' && value !== 'revised') {
    throw new TypeError('Static sink receipt view is invalid')
  }
  return value
}

function sourceHash(value: unknown): SourceHashV1 {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value)
  ) {
    throw new TypeError('Static sink receipt source hash is invalid')
  }
  return value as SourceHashV1
}

function targetPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 32_768 ||
    value.includes('\0') ||
    (
      !value.startsWith('/') &&
      !/^[a-zA-Z]:[\\/]/.test(value) &&
      !value.startsWith('\\\\')
    )
  ) {
    throw new TypeError('Static sink receipt target path is invalid')
  }
  return value
}

function base(
  record: ClosedRecord
): Readonly<{
    schema: 'document-core-static-sink-receipt-1'
    view: 'markup' | 'original' | 'revised'
    revisionId: string
  }> {
  if (record.schema !== 'document-core-static-sink-receipt-1') {
    throw new TypeError('Static sink receipt schema is invalid')
  }
  return Object.freeze({
    schema: record.schema,
    view: view(record.view),
    revisionId: identifier(record.revisionId, 'revision identity')
  })
}

export function decodeDocumentCoreStaticSinkReceipt(
  value: unknown
): DocumentCoreStaticSinkReceipt {
  const candidate = value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
  const kind = candidate?.kind
  if (kind === 'written' || kind === 'proof-written') {
    const record = closedRecord(value, [
      'schema',
      'kind',
      'consumer',
      'view',
      'revisionId',
      'sourceHash',
      'targetPath',
      'bytes'
    ])
    const consumer = record.consumer
    let closedConsumer: 'styled-html' | 'pdf' | 'print'
    if (kind === 'written') {
      if (consumer !== 'styled-html' && consumer !== 'pdf') {
        throw new TypeError('Static sink written receipt is invalid')
      }
      closedConsumer = consumer
    } else {
      if (consumer !== 'print') {
        throw new TypeError('Static sink written receipt is invalid')
      }
      closedConsumer = consumer
    }
    if (!Number.isSafeInteger(record.bytes) || Number(record.bytes) < 0) {
      throw new TypeError('Static sink written receipt is invalid')
    }
    return Object.freeze({
      ...base(record),
      kind,
      consumer: closedConsumer,
      sourceHash: sourceHash(record.sourceHash),
      targetPath: targetPath(record.targetPath),
      bytes: Number(record.bytes)
    })
  }
  if (kind === 'submitted') {
    const record = closedRecord(value, [
      'schema',
      'kind',
      'consumer',
      'view',
      'revisionId',
      'sourceHash'
    ])
    if (record.consumer !== 'print') {
      throw new TypeError('Static sink submitted receipt is invalid')
    }
    return Object.freeze({
      ...base(record),
      kind,
      consumer: 'print',
      sourceHash: sourceHash(record.sourceHash)
    })
  }
  if (kind === 'unavailable') {
    const record = closedRecord(value, [
      'schema',
      'kind',
      'consumer',
      'view',
      'reason',
      'revisionId'
    ])
    if (
      record.consumer !== 'styled-html' &&
      record.consumer !== 'pdf' &&
      record.consumer !== 'print'
    ) {
      throw new TypeError('Static sink unavailable receipt is invalid')
    }
    if (record.reason !== 'source-only-revision') {
      throw new TypeError('Static sink unavailable reason is invalid')
    }
    return Object.freeze({
      ...base(record),
      kind,
      consumer: record.consumer,
      reason: record.reason
    })
  }
  if (kind === 'cancelled') {
    const record = closedRecord(value, [
      'schema',
      'kind',
      'consumer',
      'view',
      'revisionId'
    ])
    if (record.consumer !== 'styled-html' && record.consumer !== 'pdf') {
      throw new TypeError('Static sink cancelled receipt is invalid')
    }
    return Object.freeze({
      ...base(record),
      kind,
      consumer: record.consumer
    })
  }
  throw new TypeError('Static sink receipt kind is invalid')
}
