import { describe, expect, it } from 'vitest'
import {
  openVerifiedSourceReplicaV1,
  retainVerifiedSourceReplicaV1,
  reviseVerifiedSourceReplicaV1,
  sourceHashV1,
  type VerifiedSourceReplicaV1
} from '../../src/index.js'

describe('verified source replica', () => {
  it('opens, explicitly retains, and revises exact source identity', () => {
    const baseSource = 'alpha'
    const baseHash = sourceHashV1(baseSource)
    const base = openVerifiedSourceReplicaV1(baseSource, baseHash)

    expect(base).toEqual({ sourceHash: baseHash, sourceLength: 5 })
    expect(retainVerifiedSourceReplicaV1(base, baseHash, 5)).toBe(base)

    const nextSource = 'alphz'
    const nextHash = sourceHashV1(nextSource)
    expect(reviseVerifiedSourceReplicaV1(
      base,
      nextSource,
      [{ start: 4, end: 5, insert: 'z' }],
      nextHash
    )).toEqual({ sourceHash: nextHash, sourceLength: 5 })
  })

  it('rejects a caller-fabricated base replica', () => {
    const source = 'alpha'
    const hash = sourceHashV1(source)
    const fabricated = Object.freeze({
      sourceHash: hash,
      sourceLength: source.length
    }) as VerifiedSourceReplicaV1

    expect(() => reviseVerifiedSourceReplicaV1(
      fabricated,
      'alphz',
      [{ start: 4, end: 5, insert: 'z' }],
      sourceHashV1('alphz')
    )).toThrow(/verified base/i)
  })
})
