import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  WireEnvelopeCodecV1,
  type WireEnvelopeV1,
  type WireMemberNameV1
} from '@marktext/document-core'

interface WireVector {
  readonly id: string
  readonly publicationId: string
  readonly baseSnapshotId: string
  readonly nextSnapshotId: string
  readonly transitionId: string | null
  readonly members?: Readonly<Record<string, string>>
  readonly memberGenerator?: {
    readonly member: string
    readonly byte: string
    readonly length: number
  }
  readonly expectedChunkCounts: Readonly<Record<string, number>>
  readonly expectedHashes: {
    readonly chunks: Readonly<Record<string, readonly string[]>>
    readonly members: Readonly<Record<string, string>>
    readonly root: string
  }
}

interface WireManifest {
  readonly maxChunkBytes: number
  readonly vectors: readonly WireVector[]
}

const MANIFEST = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../specs/migration/wire-envelope-v1.yml', import.meta.url)
    ),
    'utf8'
  )
) as WireManifest

function bytesOf(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

function materializeMembers(
  vector: WireVector
): Partial<Record<WireMemberNameV1, Uint8Array>> {
  const members: Partial<Record<WireMemberNameV1, Uint8Array>> = {}
  for (const [name, hex] of Object.entries(vector.members ?? {})) {
    members[name as WireMemberNameV1] = bytesOf(hex)
  }
  if (vector.memberGenerator !== undefined) {
    members[vector.memberGenerator.member as WireMemberNameV1] = new Uint8Array(
      vector.memberGenerator.length
    ).fill(Number.parseInt(vector.memberGenerator.byte, 16))
  }
  return members
}

function encodeVector(vector: WireVector): WireEnvelopeV1 {
  return new WireEnvelopeCodecV1().encode({
    publicationId: vector.publicationId,
    baseSnapshotId: vector.baseSnapshotId,
    nextSnapshotId: vector.nextSnapshotId,
    transitionId: vector.transitionId,
    members: materializeMembers(vector)
  })
}

function vector(id: string): WireVector {
  const found = MANIFEST.vectors.find((candidate) => candidate.id === id)
  if (found === undefined) {
    throw new Error(`Wire manifest has no ${id} vector`)
  }
  return found
}

function firstMember(envelope: WireEnvelopeV1) {
  const member = envelope.members[0]
  if (member === undefined) {
    throw new Error('Expected one encoded wire member')
  }
  return member
}

describe('WireEnvelopeCodecV1', () => {
  it('matches every published chunk, member, and root known answer', () => {
    for (const vector of MANIFEST.vectors) {
      const envelope = encodeVector(vector)
      expect(envelope.rootHash, `${vector.id} root`).toBe(vector.expectedHashes.root)
      for (const member of envelope.members) {
        const expectedChunkCount = vector.expectedChunkCounts[member.name]
        if (expectedChunkCount === undefined) {
          throw new Error(`${vector.id}/${member.name} has no expected chunk count`)
        }
        expect(member.chunks, `${vector.id}/${member.name} count`).toHaveLength(
          expectedChunkCount
        )
        expect(
          member.chunks.map((chunk) => chunk.hash),
          `${vector.id}/${member.name} chunks`
        ).toEqual(vector.expectedHashes.chunks[member.name])
        expect(member.hash, `${vector.id}/${member.name} member`).toBe(
          vector.expectedHashes.members[member.name]
        )
      }
    }
  })

  it('uses one chunk at the exact 256 KiB boundary and two one byte above it', () => {
    const below = encodeVector(vector('below-boundary'))
    expect(below.members[0]?.chunks.map((chunk) => chunk.bytes.length)).toEqual([
      MANIFEST.maxChunkBytes - 1
    ])

    const boundary = encodeVector(vector('exact-boundary'))
    expect(boundary.members[0]?.chunks.map((chunk) => chunk.bytes.length)).toEqual([
      MANIFEST.maxChunkBytes
    ])

    const over = encodeVector(vector('two-chunk'))
    expect(over.members[0]?.chunks.map((chunk) => chunk.bytes.length)).toEqual([
      MANIFEST.maxChunkBytes,
      1
    ])

    const empty = encodeVector(vector('empty-member'))
    expect(empty.members[0]?.chunks.map((chunk) => chunk.bytes.length)).toEqual([0])
  })

  it('publishes only after all members and the root validate', () => {
    const codec = new WireEnvelopeCodecV1()
    const envelope = encodeVector(vector('all-members'))

    const published = codec.publish(envelope, 'snapshot-4')
    expect(published).toMatchObject({
      kind: 'published',
      previousSnapshotId: 'snapshot-4',
      mountedSnapshotId: 'snapshot-5'
    })
    if (published.kind !== 'published') {
      throw new Error('Expected a valid publication')
    }
    expect(Buffer.from(published.members.reviewDelta ?? []).toString('utf8')).toBe(
      'review'
    )
  })

  it('accepts authenticated Uint8Array chunks from a foreign JavaScript realm', () => {
    const codec = new WireEnvelopeCodecV1()
    const envelope = encodeVector(vector('all-members'))
    const foreignEnvelope = {
      ...envelope,
      members: envelope.members.map(member => ({
        ...member,
        chunks: member.chunks.map(chunk => ({
          ...chunk,
          bytes: runInNewContext(
            `Uint8Array.from(${JSON.stringify([...chunk.bytes])})`
          ) as Uint8Array
        }))
      }))
    } as WireEnvelopeV1

    const published = codec.publish(
      foreignEnvelope,
      foreignEnvelope.baseSnapshotId
    )
    expect(published.kind).toBe('published')
    if (published.kind !== 'published') {
      throw new Error('Expected a foreign-realm publication to validate')
    }
    for (const bytes of Object.values(published.members)) {
      expect(bytes).toBeInstanceOf(Uint8Array)
    }
  })

  it('keeps the prior snapshot mounted for corruption, gaps, missing members, and base mismatch', () => {
    const codec = new WireEnvelopeCodecV1()
    const valid = encodeVector(vector('two-chunk'))
    const member = firstMember(valid)
    const first = member.chunks[0]
    if (first === undefined) {
      throw new Error('Expected the two-chunk vector to have a first chunk')
    }

    const corruptBytes = first.bytes.slice()
    corruptBytes[0] = (corruptBytes[0] ?? 0) ^ 0xff
    const corrupt = {
      ...valid,
      members: [
        {
          ...member,
          chunks: [{ ...first, bytes: corruptBytes }, ...member.chunks.slice(1)]
        }
      ]
    } as WireEnvelopeV1
    expect(codec.publish(corrupt, 'snapshot-3')).toEqual({
      kind: 'full-snapshot-required',
      mountedSnapshotId: 'snapshot-3',
      reason: 'checksum-failure'
    })

    const gap = {
      ...valid,
      members: [{ ...member, chunks: member.chunks.slice(1) }]
    } as WireEnvelopeV1
    expect(codec.publish(gap, 'snapshot-3')).toEqual({
      kind: 'full-snapshot-required',
      mountedSnapshotId: 'snapshot-3',
      reason: 'gap'
    })

    const missing = { ...valid, members: [] } as unknown as WireEnvelopeV1
    expect(codec.publish(missing, 'snapshot-3')).toEqual({
      kind: 'full-snapshot-required',
      mountedSnapshotId: 'snapshot-3',
      reason: 'missing-member'
    })

    expect(codec.publish(valid, 'snapshot-other')).toEqual({
      kind: 'full-snapshot-required',
      mountedSnapshotId: 'snapshot-other',
      reason: 'base-mismatch'
    })
  })

  it('fails closed instead of throwing for null nested members and chunks', () => {
    const codec = new WireEnvelopeCodecV1()
    const valid = encodeVector(vector('two-chunk'))
    const member = firstMember(valid)

    const nullMember = {
      ...valid,
      members: [null]
    } as unknown as WireEnvelopeV1
    expect(() => codec.publish(nullMember, 'snapshot-3')).not.toThrow()
    expect(codec.publish(nullMember, 'snapshot-3')).toEqual({
      kind: 'full-snapshot-required',
      mountedSnapshotId: 'snapshot-3',
      reason: 'invalid-envelope'
    })

    const nullChunk = {
      ...valid,
      members: [{ ...member, chunks: [null] }]
    } as unknown as WireEnvelopeV1
    expect(() => codec.publish(nullChunk, 'snapshot-3')).not.toThrow()
    expect(codec.publish(nullChunk, 'snapshot-3')).toEqual({
      kind: 'full-snapshot-required',
      mountedSnapshotId: 'snapshot-3',
      reason: 'invalid-envelope'
    })
  })

  it.each([
    {
      description: 'an extended envelope',
      mutate: (valid: WireEnvelopeV1) => ({
        ...valid,
        extension: true
      })
    },
    {
      description: 'an extended member',
      mutate: (valid: WireEnvelopeV1) => ({
        ...valid,
        members: valid.members.map((member, index) =>
          index === 0 ? { ...member, extension: true } : member)
      })
    },
    {
      description: 'an extended chunk',
      mutate: (valid: WireEnvelopeV1) => ({
        ...valid,
        members: valid.members.map((member, memberIndex) =>
          memberIndex === 0
            ? {
              ...member,
              chunks: member.chunks.map((chunk, chunkIndex) =>
                chunkIndex === 0 ? { ...chunk, extension: true } : chunk)
            }
            : member)
      })
    }
  ])('rejects $description at its unknown boundary', ({ mutate }) => {
    const codec = new WireEnvelopeCodecV1()
    const valid = encodeVector(vector('all-members'))
    expect(codec.publish(mutate(valid), valid.baseSnapshotId)).toEqual({
      kind: 'full-snapshot-required',
      mountedSnapshotId: valid.baseSnapshotId,
      reason: 'invalid-envelope'
    })
  })

  it('accepts outcome-only publication without inventing a state transition', () => {
    const codec = new WireEnvelopeCodecV1()
    const envelope = encodeVector(vector('outcome-only'))
    const published = codec.publish(envelope, 'snapshot-5')
    expect(published).toMatchObject({
      kind: 'published',
      previousSnapshotId: 'snapshot-5',
      mountedSnapshotId: 'snapshot-5'
    })
    if (published.kind !== 'published') {
      throw new Error('Expected outcome-only publication to validate')
    }
    expect(Buffer.from(published.members.terminalOutcomeDelta ?? []).toString('utf8')).toBe(
      'ok'
    )
  })

  it('rejects a terminal-only envelope that claims to advance document state', () => {
    const codec = new WireEnvelopeCodecV1()
    expect(() => codec.encode({
      publicationId: 'publication-terminal-only-state-change',
      baseSnapshotId: 'snapshot-1',
      nextSnapshotId: 'snapshot-2',
      transitionId: 'transition-envelope',
      members: {
        terminalOutcomeDelta: new TextEncoder().encode(JSON.stringify({
          schema: 'document-core-terminal-outcome-1',
          kind: 'committed',
          transitionId: 'transition-terminal',
          cause: 'source-edit',
          history: 'record'
        }))
      }
    })).toThrow(/publication rule/i)
  })
})
