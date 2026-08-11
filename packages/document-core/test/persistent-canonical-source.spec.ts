import { describe, expect, it } from 'vitest'

import { applyExactSourceEdits } from '../src/exactSourceEdits.js'
import {
  createPersistentCanonicalSource,
  type PersistentCanonicalSourceRecorder
} from '../src/internal/persistentCanonicalSource.js'

describe('persistent canonical source', () => {
  it('retains balanced historical roots before reverse materialization', () => {
    let maximumHeight = 0
    const recorder: PersistentCanonicalSourceRecorder = Object.freeze({
      recordNodeVisit: (): void => {},
      recordRootShape: (height: number): void => {
        maximumHeight = Math.max(maximumHeight, height)
      },
      recordNodeAllocation: (): void => {},
      recordCoalesce: (): void => {},
      recordRebalance: (): void => {},
      recordSlice: (): void => {},
      recordMaterialization: (): void => {},
      recordGetterHit: (): void => {},
      recordGetterMiss: (): void => {},
      recordCompaction: (): void => {},
      recordAttemptedRoot: (): void => {}
    })
    let randomState = 0xc0decafe
    const random = (limit: number): number => {
      randomState = (Math.imul(randomState, 1_103_515_245) + 12_345) >>> 0
      return limit === 0 ? 0 : randomState % limit
    }
    const insertions = ['', 'X', 'yz', '\r\n', '😀', '{++'] as const
    let expected = 'start\r\n😀 middle\nend\n'
    let source = createPersistentCanonicalSource(expected, recorder)
    const retained = [{ source, expected }]

    for (let batch = 0; batch < 512; batch += 1) {
      const edits: Array<{ start: number, end: number, insert: string }> = []
      let cursor = 0
      const count = 1 + random(5)
      for (let ordinal = 0; ordinal < count; ordinal += 1) {
        const start = cursor + random(expected.length - cursor + 1)
        const end = start + random(Math.min(5, expected.length - start) + 1)
        edits.push({
          start,
          end,
          insert: insertions[random(insertions.length)] ?? ''
        })
        cursor = end
      }
      expected = applyExactSourceEdits(expected, edits, 'oracle edit')
      source = source.applyExact(edits, 'persistent source edit')
      expect(source.length).toBe(expected.length)
      if (batch % 16 === 15) retained.push({ source, expected })
    }

    expect(maximumHeight).toBeLessThan(64)
    for (const snapshot of retained.reverse()) {
      expect(snapshot.source.materialize('getter')).toBe(snapshot.expected)
    }
  })

  it('bounds path copying across prepend, same-point, and moving edits', () => {
    let allocations = 0
    let maximumHeight = 0
    const recorder: PersistentCanonicalSourceRecorder = Object.freeze({
      recordNodeVisit: (): void => {},
      recordRootShape: (height: number): void => {
        maximumHeight = Math.max(maximumHeight, height)
      },
      recordNodeAllocation: (): void => {
        allocations += 1
      },
      recordCoalesce: (): void => {},
      recordRebalance: (): void => {},
      recordSlice: (): void => {},
      recordMaterialization: (): void => {},
      recordGetterHit: (): void => {},
      recordGetterMiss: (): void => {},
      recordCompaction: (): void => {},
      recordAttemptedRoot: (): void => {}
    })
    let expected = 'middle'
    let source = createPersistentCanonicalSource(expected, recorder)
    const beforeAllocations = allocations

    for (let ordinal = 0; ordinal < 300; ordinal += 1) {
      const at = ordinal % 3 === 0
        ? 0
        : ordinal % 3 === 1
          ? expected.indexOf('middle') + 3
          : expected.length
      const edit = {
        start: at,
        end: at,
        insert: String.fromCharCode(65 + ordinal % 26)
      }
      expected = applyExactSourceEdits(expected, [edit], 'oracle edit')
      source = source.applyExact([edit], 'persistent source edit')
    }

    expect(allocations - beforeAllocations).toBeLessThan(3_600)
    expect(maximumHeight).toBeLessThan(16)
    expect(source.materialize('getter')).toBe(expected)
  })
})
