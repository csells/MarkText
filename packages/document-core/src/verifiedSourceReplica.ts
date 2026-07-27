import {
  reopenSourceHashV1WithCache,
  sourceHashV1WithCache,
  type SourceHashCacheV1,
  type SourceHashEditV1,
  type SourceHashV1
} from './hashCodec.js'
import { DOCUMENT_RESOURCE_POLICY_V1 } from './resourcePolicy.js'

declare const verifiedSourceReplicaBrand: unique symbol

export interface VerifiedSourceReplicaV1 {
  readonly sourceHash: SourceHashV1
  readonly sourceLength: number
  readonly [verifiedSourceReplicaBrand]: 'VerifiedSourceReplicaV1'
}

const caches = new WeakMap<VerifiedSourceReplicaV1, SourceHashCacheV1>()

function assertExpectedHash(hash: SourceHashV1): void {
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new TypeError('Verified source replica requires a SourceHashV1')
  }
}

function createReplica(
  sourceHash: SourceHashV1,
  sourceLength: number,
  cache: SourceHashCacheV1
): VerifiedSourceReplicaV1 {
  const replica = Object.freeze({
    sourceHash,
    sourceLength
  }) as VerifiedSourceReplicaV1
  caches.set(replica, cache)
  return replica
}

export function openVerifiedSourceReplicaV1(
  source: string,
  expectedHash: SourceHashV1
): VerifiedSourceReplicaV1 {
  assertExpectedHash(expectedHash)
  if (source.length > DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits) {
    throw new RangeError('Verified source replica exceeds its resource limit')
  }
  const verified = sourceHashV1WithCache(source)
  if (verified.hash !== expectedHash) {
    throw new TypeError('Verified source replica has an invalid source hash')
  }
  return createReplica(verified.hash, source.length, verified.cache)
}

export function retainVerifiedSourceReplicaV1(
  base: VerifiedSourceReplicaV1,
  expectedHash: SourceHashV1,
  expectedLength: number
): VerifiedSourceReplicaV1 {
  assertExpectedHash(expectedHash)
  if (
    caches.get(base) === undefined ||
    base.sourceHash !== expectedHash ||
    base.sourceLength !== expectedLength
  ) {
    throw new TypeError('Retained source replica has an unverified base')
  }
  return base
}

export function reviseVerifiedSourceReplicaV1(
  base: VerifiedSourceReplicaV1,
  source: string,
  edits: readonly SourceHashEditV1[],
  expectedHash: SourceHashV1
): VerifiedSourceReplicaV1 {
  assertExpectedHash(expectedHash)
  const cache = caches.get(base)
  if (cache === undefined) {
    throw new TypeError('Revised source replica has an unverified base')
  }
  if (
    source.length > DOCUMENT_RESOURCE_POLICY_V1.maximumSourceUnits ||
    edits.length === 0 ||
    edits.length >
      DOCUMENT_RESOURCE_POLICY_V1.maximumSourceEditsPerTransaction
  ) {
    throw new RangeError('Revised source replica exceeds its resource limit')
  }
  let expectedLength = base.sourceLength
  let previousEnd = 0
  for (const [index, edit] of edits.entries()) {
    if (
      !Number.isSafeInteger(edit.start) ||
      !Number.isSafeInteger(edit.end) ||
      edit.start < previousEnd ||
      edit.end < edit.start ||
      edit.end > base.sourceLength ||
      typeof edit.insert !== 'string'
    ) {
      throw new TypeError(`Verified source edit ${String(index)} is invalid`)
    }
    previousEnd = edit.end
    expectedLength += edit.insert.length - (edit.end - edit.start)
  }
  if (expectedLength !== source.length) {
    throw new TypeError('Verified source edits do not produce the next length')
  }
  const verified = reopenSourceHashV1WithCache(cache, source, edits)
  if (verified.hash !== expectedHash) {
    throw new TypeError('Revised source replica has an invalid source hash')
  }
  return createReplica(verified.hash, source.length, verified.cache)
}
