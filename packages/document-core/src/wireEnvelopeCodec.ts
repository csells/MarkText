import { sha256Bytes } from './hashCodec.js'

declare const wireHashBrand: unique symbol

export type WireHashV1 = string & {
  readonly [wireHashBrand]: 'WireHashV1'
}

export const WIRE_MEMBER_ORDER_V1 = Object.freeze([
  'livePlanDelta',
  'reviewDelta',
  'sessionDelta',
  'terminalOutcomeDelta'
] as const)

export type WireMemberNameV1 = (typeof WIRE_MEMBER_ORDER_V1)[number]

const WIRE_SCHEMA_V1 = 'marktext-wire-envelope-v1'
const MAX_CHUNK_BYTES_V1 = 262_144
const IDENTITY = /^[A-Za-z0-9._:-]+$/
const HASH = /^[0-9a-f]{64}$/
const DOMAIN_CHUNK = ascii('MarkText.WireChunk.v1\0')
const DOMAIN_MEMBER = ascii('MarkText.WireMember.v1\0')
const DOMAIN_ENVELOPE = ascii('MarkText.WireEnvelope.v1\0')
const SCHEMA_BYTES = framedAscii(WIRE_SCHEMA_V1)

const MEMBER_BITS: Readonly<Record<WireMemberNameV1, number>> = Object.freeze({
  livePlanDelta: 1,
  reviewDelta: 2,
  sessionDelta: 4,
  terminalOutcomeDelta: 8
})

export interface WireChunkV1 {
  readonly index: number
  readonly count: number
  readonly bytes: Uint8Array
  readonly hash: WireHashV1
}

export interface WireMemberV1 {
  readonly name: WireMemberNameV1
  readonly byteLength: number
  readonly chunks: readonly WireChunkV1[]
  readonly hash: WireHashV1
}

export interface WireEnvelopeV1 {
  readonly schema: 'marktext-wire-envelope-v1'
  readonly publicationId: string
  readonly baseSnapshotId: string
  readonly nextSnapshotId: string
  readonly transitionId: string | null
  readonly memberMask: number
  readonly members: readonly WireMemberV1[]
  readonly rootHash: WireHashV1
}

export interface WireEnvelopeInputV1 {
  readonly publicationId: string
  readonly baseSnapshotId: string
  readonly nextSnapshotId: string
  readonly transitionId: string | null
  readonly members: Partial<Readonly<Record<WireMemberNameV1, Uint8Array>>>
}

export type WireDecodedMembersV1 = Readonly<
  Partial<Record<WireMemberNameV1, Uint8Array>>
>

export type WirePublicationFailureReasonV1 =
  | 'gap'
  | 'base-mismatch'
  | 'missing-member'
  | 'checksum-failure'
  | 'invalid-envelope'

export type WirePublicationResultV1 =
  | {
    readonly kind: 'published'
    readonly publicationId: string
    readonly previousSnapshotId: string
    readonly mountedSnapshotId: string
    readonly transitionId: string | null
    readonly members: WireDecodedMembersV1
  }
  | {
    readonly kind: 'full-snapshot-required'
    readonly mountedSnapshotId: string
    readonly reason: WirePublicationFailureReasonV1
  }

interface ValidationSuccess {
  readonly kind: 'valid'
  readonly members: WireDecodedMembersV1
}

type ValidationResult =
  | ValidationSuccess
  | {
    readonly kind: 'invalid'
    readonly reason: Exclude<WirePublicationFailureReasonV1, 'base-mismatch'>
  }

function ascii(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length)
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code > 0x7f) {
      throw new TypeError('WireEnvelopeCodecV1 framing identifiers must be ASCII')
    }
    bytes[index] = code
  }
  return bytes
}

function uint32(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError('WireEnvelopeCodecV1 integer is outside uint32')
  }
  return Uint8Array.of(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  )
}

function framedAscii(value: string): Uint8Array {
  const bytes = ascii(value)
  const framed = new Uint8Array(4 + bytes.length)
  framed.set(uint32(bytes.length))
  framed.set(bytes, 4)
  return framed
}

function hashBytes(hash: string): Uint8Array {
  if (!HASH.test(hash)) {
    throw new TypeError('WireEnvelopeCodecV1 hash is not lowercase SHA-256')
  }
  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hash.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function wireHash(...chunks: readonly Uint8Array[]): WireHashV1 {
  return sha256Bytes(...chunks) as WireHashV1
}

function assertIdentity(name: string, value: string): void {
  if (!IDENTITY.test(value)) {
    throw new TypeError(`WireEnvelopeCodecV1 ${name} is not a valid identity`)
  }
}

function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && IDENTITY.test(value)
}

function isMemberName(value: unknown): value is WireMemberNameV1 {
  return (
    typeof value === 'string' &&
    WIRE_MEMBER_ORDER_V1.some(name => name === value)
  )
}

function isWireHash(value: unknown): value is WireHashV1 {
  return typeof value === 'string' && HASH.test(value)
}

function isClosedRecord(
  value: unknown,
  fields: readonly string[]
): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  if (prototype !== Object.prototype && prototype !== null) return false
  const allowed = new Set(fields)
  const keys = Reflect.ownKeys(value)
  return keys.length === fields.length &&
    keys.every(key => typeof key === 'string' && allowed.has(key))
}

function decodeEnvelope(value: unknown): WireEnvelopeV1 | null {
  if (!isClosedRecord(value, [
    'schema',
    'publicationId',
    'baseSnapshotId',
    'nextSnapshotId',
    'transitionId',
    'memberMask',
    'members',
    'rootHash'
  ])) {
    return null
  }
  if (
    value.schema !== WIRE_SCHEMA_V1 ||
    !isIdentity(value.publicationId) ||
    !isIdentity(value.baseSnapshotId) ||
    !isIdentity(value.nextSnapshotId) ||
    (
      value.transitionId !== null &&
      !isIdentity(value.transitionId)
    ) ||
    !Number.isInteger(value.memberMask) ||
    Number(value.memberMask) < 0 ||
    Number(value.memberMask) > 0xffff_ffff ||
    !Array.isArray(value.members) ||
    !isWireHash(value.rootHash)
  ) {
    return null
  }

  const members: WireMemberV1[] = []
  for (const rawMember of value.members) {
    if (!isClosedRecord(rawMember, [
      'name',
      'byteLength',
      'chunks',
      'hash'
    ])) {
      return null
    }
    if (
      !isMemberName(rawMember.name) ||
      !Number.isInteger(rawMember.byteLength) ||
      Number(rawMember.byteLength) < 0 ||
      Number(rawMember.byteLength) > 0xffff_ffff ||
      !Array.isArray(rawMember.chunks) ||
      !isWireHash(rawMember.hash)
    ) {
      return null
    }
    const chunks: WireChunkV1[] = []
    for (const rawChunk of rawMember.chunks) {
      if (!isClosedRecord(rawChunk, [
        'index',
        'count',
        'bytes',
        'hash'
      ])) {
        return null
      }
      if (
        !Number.isInteger(rawChunk.index) ||
        Number(rawChunk.index) < 0 ||
        Number(rawChunk.index) > 0xffff_ffff ||
        !Number.isInteger(rawChunk.count) ||
        Number(rawChunk.count) < 0 ||
        Number(rawChunk.count) > 0xffff_ffff ||
        !(rawChunk.bytes instanceof Uint8Array) ||
        !isWireHash(rawChunk.hash)
      ) {
        return null
      }
      chunks.push(Object.freeze({
        index: Number(rawChunk.index),
        count: Number(rawChunk.count),
        bytes: rawChunk.bytes.slice(),
        hash: rawChunk.hash
      }))
    }
    members.push(Object.freeze({
      name: rawMember.name,
      byteLength: Number(rawMember.byteLength),
      chunks: Object.freeze(chunks),
      hash: rawMember.hash
    }))
  }

  return Object.freeze({
    schema: WIRE_SCHEMA_V1,
    publicationId: value.publicationId,
    baseSnapshotId: value.baseSnapshotId,
    nextSnapshotId: value.nextSnapshotId,
    transitionId: value.transitionId,
    memberMask: Number(value.memberMask),
    members: Object.freeze(members),
    rootHash: value.rootHash
  })
}

function chunkHash(
  member: WireMemberNameV1,
  index: number,
  count: number,
  bytes: Uint8Array
): WireHashV1 {
  return wireHash(
    DOMAIN_CHUNK,
    framedAscii(member),
    uint32(index),
    uint32(count),
    uint32(bytes.length),
    bytes
  )
}

function memberHash(
  name: WireMemberNameV1,
  byteLength: number,
  chunks: readonly WireChunkV1[]
): WireHashV1 {
  return wireHash(
    DOMAIN_MEMBER,
    framedAscii(name),
    uint32(byteLength),
    uint32(chunks.length),
    ...chunks.map((chunk) => hashBytes(chunk.hash))
  )
}

function rootHash(envelope: Omit<WireEnvelopeV1, 'rootHash'>): WireHashV1 {
  return wireHash(
    DOMAIN_ENVELOPE,
    SCHEMA_BYTES,
    framedAscii(envelope.publicationId),
    framedAscii(envelope.baseSnapshotId),
    framedAscii(envelope.nextSnapshotId),
    framedAscii(envelope.transitionId ?? ''),
    uint32(envelope.memberMask),
    uint32(envelope.members.length),
    ...envelope.members.flatMap((member) => [
      framedAscii(member.name),
      hashBytes(member.hash)
    ])
  )
}

function publicationRuleIsValid(
  baseSnapshotId: string,
  nextSnapshotId: string,
  transitionId: string | null,
  memberMask: number,
  terminalOutcomeLength: number | undefined
): boolean {
  if (transitionId !== null) {
    return (
      baseSnapshotId !== nextSnapshotId &&
      memberMask !== MEMBER_BITS.terminalOutcomeDelta
    )
  }
  return (
    baseSnapshotId === nextSnapshotId &&
    memberMask === MEMBER_BITS.terminalOutcomeDelta &&
    terminalOutcomeLength !== undefined &&
    terminalOutcomeLength > 0
  )
}

function encodeMember(name: WireMemberNameV1, input: Uint8Array): WireMemberV1 {
  if (input.length > 0xffff_ffff) {
    throw new RangeError('WireEnvelopeCodecV1 member is outside uint32')
  }
  const bytes = input.slice()
  const count = Math.max(1, Math.ceil(bytes.length / MAX_CHUNK_BYTES_V1))
  const chunks: WireChunkV1[] = []
  for (let index = 0; index < count; index += 1) {
    const start = index * MAX_CHUNK_BYTES_V1
    const payload = bytes.slice(start, Math.min(bytes.length, start + MAX_CHUNK_BYTES_V1))
    chunks.push(
      Object.freeze({
        index,
        count,
        bytes: payload,
        hash: chunkHash(name, index, count, payload)
      })
    )
  }
  const frozenChunks = Object.freeze(chunks)
  return Object.freeze({
    name,
    byteLength: bytes.length,
    chunks: frozenChunks,
    hash: memberHash(name, bytes.length, frozenChunks)
  })
}

function classifyMembers(
  envelope: WireEnvelopeV1
): ValidationResult {
  if (
    !Number.isInteger(envelope.memberMask) ||
    envelope.memberMask <= 0 ||
    envelope.memberMask > 0x0f ||
    !Array.isArray(envelope.members)
  ) {
    return Object.freeze({ kind: 'invalid', reason: 'invalid-envelope' })
  }

  const expectedNames = WIRE_MEMBER_ORDER_V1.filter(
    (name) => (envelope.memberMask & MEMBER_BITS[name]) !== 0
  )
  if (envelope.members.length < expectedNames.length) {
    return Object.freeze({ kind: 'invalid', reason: 'missing-member' })
  }
  if (envelope.members.length !== expectedNames.length) {
    return Object.freeze({ kind: 'invalid', reason: 'invalid-envelope' })
  }

  const decoded: Partial<Record<WireMemberNameV1, Uint8Array>> = {}
  for (let memberIndex = 0; memberIndex < expectedNames.length; memberIndex += 1) {
    const expectedName = expectedNames[memberIndex]
    const member = envelope.members[memberIndex]
    if (expectedName === undefined || member === undefined) {
      return Object.freeze({ kind: 'invalid', reason: 'missing-member' })
    }
    if (member === null || typeof member !== 'object') {
      return Object.freeze({ kind: 'invalid', reason: 'invalid-envelope' })
    }
    if (!isMemberName(member.name)) {
      return Object.freeze({ kind: 'invalid', reason: 'missing-member' })
    }
    if (member.name !== expectedName) {
      return Object.freeze({ kind: 'invalid', reason: 'invalid-envelope' })
    }
    if (
      !Number.isInteger(member.byteLength) ||
      member.byteLength < 0 ||
      member.byteLength > 0xffff_ffff ||
      !HASH.test(member.hash) ||
      !Array.isArray(member.chunks) ||
      member.chunks.length === 0
    ) {
      return Object.freeze({ kind: 'invalid', reason: 'invalid-envelope' })
    }

    const payloadChunks: Uint8Array[] = []
    let payloadOffset = 0
    for (let chunkIndex = 0; chunkIndex < member.chunks.length; chunkIndex += 1) {
      const chunk = member.chunks[chunkIndex]
      if (chunk === undefined) {
        return Object.freeze({ kind: 'invalid', reason: 'gap' })
      }
      if (chunk === null || typeof chunk !== 'object') {
        return Object.freeze({ kind: 'invalid', reason: 'invalid-envelope' })
      }
      if (chunk.index !== chunkIndex || chunk.count !== member.chunks.length) {
        return Object.freeze({ kind: 'invalid', reason: 'gap' })
      }
      if (
        !(chunk.bytes instanceof Uint8Array) ||
        chunk.bytes.length > MAX_CHUNK_BYTES_V1 ||
        !HASH.test(chunk.hash)
      ) {
        return Object.freeze({ kind: 'invalid', reason: 'invalid-envelope' })
      }
      const mustFillChunk = chunkIndex < member.chunks.length - 1
      if (
        (mustFillChunk && chunk.bytes.length !== MAX_CHUNK_BYTES_V1) ||
        (!mustFillChunk && member.byteLength > 0 && chunk.bytes.length === 0)
      ) {
        return Object.freeze({ kind: 'invalid', reason: 'gap' })
      }
      if (chunkHash(member.name, chunk.index, chunk.count, chunk.bytes) !== chunk.hash) {
        return Object.freeze({ kind: 'invalid', reason: 'checksum-failure' })
      }
      if (payloadOffset + chunk.bytes.length > member.byteLength) {
        return Object.freeze({ kind: 'invalid', reason: 'gap' })
      }
      payloadChunks.push(chunk.bytes)
      payloadOffset += chunk.bytes.length
    }
    if (payloadOffset !== member.byteLength) {
      return Object.freeze({ kind: 'invalid', reason: 'gap' })
    }
    if (memberHash(member.name, member.byteLength, member.chunks) !== member.hash) {
      return Object.freeze({ kind: 'invalid', reason: 'checksum-failure' })
    }
    const payload = new Uint8Array(member.byteLength)
    let copied = 0
    for (const chunk of payloadChunks) {
      payload.set(chunk, copied)
      copied += chunk.length
    }
    decoded[expectedName] = payload
  }
  return Object.freeze({
    kind: 'valid',
    members: Object.freeze(decoded)
  })
}

/**
 * Deterministic, fail-closed codec for immutable worker publications.
 *
 * Hash framing is fixed by specs/migration/wire-envelope-v1.yml. `publish`
 * returns decoded copies only after every declared chunk/member and the root
 * validate; all failure results retain the caller's mounted snapshot id.
 */
export class WireEnvelopeCodecV1 {
  encode(input: WireEnvelopeInputV1): WireEnvelopeV1 {
    assertIdentity('publicationId', input.publicationId)
    assertIdentity('baseSnapshotId', input.baseSnapshotId)
    assertIdentity('nextSnapshotId', input.nextSnapshotId)
    if (input.transitionId !== null) {
      assertIdentity('transitionId', input.transitionId)
    }

    for (const name of Object.keys(input.members)) {
      if (!isMemberName(name)) {
        throw new TypeError(`WireEnvelopeCodecV1 has unknown member ${name}`)
      }
    }
    const members = Object.freeze(
      WIRE_MEMBER_ORDER_V1.flatMap((name) => {
        const payload = input.members[name]
        return payload === undefined ? [] : [encodeMember(name, payload)]
      })
    )
    const memberMask = members.reduce(
      (mask, member) => mask | MEMBER_BITS[member.name],
      0
    )
    const terminalOutcomeLength = members.find(
      (member) => member.name === 'terminalOutcomeDelta'
    )?.byteLength
    if (
      members.length === 0 ||
      !publicationRuleIsValid(
        input.baseSnapshotId,
        input.nextSnapshotId,
        input.transitionId,
        memberMask,
        terminalOutcomeLength
      )
    ) {
      throw new TypeError('WireEnvelopeCodecV1 publication rule is invalid')
    }

    const withoutRoot = Object.freeze({
      schema: WIRE_SCHEMA_V1,
      publicationId: input.publicationId,
      baseSnapshotId: input.baseSnapshotId,
      nextSnapshotId: input.nextSnapshotId,
      transitionId: input.transitionId,
      memberMask,
      members
    })
    return Object.freeze({
      ...withoutRoot,
      rootHash: rootHash(withoutRoot)
    })
  }

  publish(envelope: unknown, mountedSnapshotId: string): WirePublicationResultV1 {
    const decodedEnvelope = decodeEnvelope(envelope)
    if (decodedEnvelope === null) {
      return Object.freeze({
        kind: 'full-snapshot-required',
        mountedSnapshotId,
        reason: 'invalid-envelope'
      })
    }

    const validation = classifyMembers(decodedEnvelope)
    if (validation.kind === 'invalid') {
      return Object.freeze({
        kind: 'full-snapshot-required',
        mountedSnapshotId,
        reason: validation.reason
      })
    }
    const terminalOutcomeLength = validation.members.terminalOutcomeDelta?.length
    if (
      !publicationRuleIsValid(
        decodedEnvelope.baseSnapshotId,
        decodedEnvelope.nextSnapshotId,
        decodedEnvelope.transitionId,
        decodedEnvelope.memberMask,
        terminalOutcomeLength
      )
    ) {
      return Object.freeze({
        kind: 'full-snapshot-required',
        mountedSnapshotId,
        reason: 'invalid-envelope'
      })
    }
    if (rootHash(decodedEnvelope) !== decodedEnvelope.rootHash) {
      return Object.freeze({
        kind: 'full-snapshot-required',
        mountedSnapshotId,
        reason: 'checksum-failure'
      })
    }
    if (decodedEnvelope.baseSnapshotId !== mountedSnapshotId) {
      return Object.freeze({
        kind: 'full-snapshot-required',
        mountedSnapshotId,
        reason: 'base-mismatch'
      })
    }

    return Object.freeze({
      kind: 'published',
      publicationId: decodedEnvelope.publicationId,
      previousSnapshotId: mountedSnapshotId,
      mountedSnapshotId: decodedEnvelope.nextSnapshotId,
      transitionId: decodedEnvelope.transitionId,
      members: validation.members
    })
  }
}
