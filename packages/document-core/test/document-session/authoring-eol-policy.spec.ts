import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { chooseAuthoringEolV1 } from '../../src/authoringEol.js'

interface Vector {
  readonly id: string
  readonly source: string
  readonly owner: Readonly<{ readonly start: number, readonly end: number }>
  readonly position: number
  readonly documentPreference: string
  readonly expected: string
}

interface Manifest {
  readonly schema: string
  readonly policy: string
  readonly vectors: readonly Vector[]
}

const manifestPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../specs/migration/authoring-eol-vectors.yml'
)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest

describe('nearest-owner-eol-v1', () => {
  it('chooses every frozen authoring EOL vector without normalizing source', () => {
    expect(manifest.schema).toBe('marktext-authoring-eol-vectors-v1')
    expect(manifest.policy).toBe('nearest-owner-eol-v1')

    for (const vector of manifest.vectors) {
      const before = vector.source
      const decision = chooseAuthoringEolV1(
        vector.source,
        vector.owner,
        vector.position
      )
      expect(decision.token, vector.id).toBe(vector.expected)
      expect(decision.documentPreference, vector.id).toBe(
        vector.documentPreference
      )
      expect(vector.source, `${vector.id} must remain exact`).toBe(before)
      expect(Object.isFrozen(decision), vector.id).toBe(true)
    }
  })

  it('rejects a position or owner outside exact source coordinates', () => {
    expect(() => chooseAuthoringEolV1('abc', { start: -1, end: 2 }, 0))
      .toThrow(RangeError)
    expect(() => chooseAuthoringEolV1('abc', { start: 0, end: 4 }, 0))
      .toThrow(RangeError)
    expect(() => chooseAuthoringEolV1('abc', { start: 1, end: 2 }, 0))
      .toThrow(RangeError)
    expect(() => chooseAuthoringEolV1('abc', { start: 0.5, end: 2 }, 1))
      .toThrow(RangeError)
  })
})
