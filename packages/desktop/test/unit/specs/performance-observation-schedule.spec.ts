import { describe, expect, it } from 'vitest'

import {
  canonicalPerformanceObservationScheduleJson,
  createPerformanceObservationSchedule,
  PERFORMANCE_OBSERVATION_SCHEDULE,
  performanceObservationScheduleSha256
} from '../../e2e/helpers/performanceObservationSchedule'

describe('performance observation schedule', () => {
  it('runs every warmup round before measured rounds and rotates the start continuously', () => {
    const schedule = createPerformanceObservationSchedule({
      documentIds: ['a', 'b', 'c'],
      warmupSamples: 2,
      measuredSamples: 3
    })

    expect(PERFORMANCE_OBSERVATION_SCHEDULE).toBe(
      'warmup-then-measured-rotating-round-robin-v1'
    )
    expect(schedule).toEqual([
      { ordinal: 1, phase: 'warmup', phaseRound: 1, roundPosition: 1, documentId: 'a' },
      { ordinal: 2, phase: 'warmup', phaseRound: 1, roundPosition: 2, documentId: 'b' },
      { ordinal: 3, phase: 'warmup', phaseRound: 1, roundPosition: 3, documentId: 'c' },
      { ordinal: 4, phase: 'warmup', phaseRound: 2, roundPosition: 1, documentId: 'b' },
      { ordinal: 5, phase: 'warmup', phaseRound: 2, roundPosition: 2, documentId: 'c' },
      { ordinal: 6, phase: 'warmup', phaseRound: 2, roundPosition: 3, documentId: 'a' },
      { ordinal: 7, phase: 'measured', phaseRound: 1, roundPosition: 1, documentId: 'c' },
      { ordinal: 8, phase: 'measured', phaseRound: 1, roundPosition: 2, documentId: 'a' },
      { ordinal: 9, phase: 'measured', phaseRound: 1, roundPosition: 3, documentId: 'b' },
      { ordinal: 10, phase: 'measured', phaseRound: 2, roundPosition: 1, documentId: 'a' },
      { ordinal: 11, phase: 'measured', phaseRound: 2, roundPosition: 2, documentId: 'b' },
      { ordinal: 12, phase: 'measured', phaseRound: 2, roundPosition: 3, documentId: 'c' },
      { ordinal: 13, phase: 'measured', phaseRound: 3, roundPosition: 1, documentId: 'b' },
      { ordinal: 14, phase: 'measured', phaseRound: 3, roundPosition: 2, documentId: 'c' },
      { ordinal: 15, phase: 'measured', phaseRound: 3, roundPosition: 3, documentId: 'a' }
    ])
    expect(Object.isFrozen(schedule)).toBe(true)
    expect(schedule.every(Object.isFrozen)).toBe(true)
  })

  it('authenticates a canonical positional schedule without object-key ambiguity', () => {
    const schedule = createPerformanceObservationSchedule({
      documentIds: ['doc-a'],
      warmupSamples: 1,
      measuredSamples: 1
    })

    expect(canonicalPerformanceObservationScheduleJson(schedule)).toBe(
      '[[1,"warmup",1,1,"doc-a"],[2,"measured",1,1,"doc-a"]]'
    )
    expect(performanceObservationScheduleSha256(schedule)).toBe(
      'f77308a5ef274186c6d2b86250fc376d00c29271b27270c4e005329eacddb35c'
    )
  })

  it('rejects missing or duplicate authenticated document identities', () => {
    expect(() => createPerformanceObservationSchedule({
      documentIds: [],
      warmupSamples: 1,
      measuredSamples: 1
    })).toThrow(/document IDs.*non-empty/i)
    expect(() => createPerformanceObservationSchedule({
      documentIds: ['a', 'a'],
      warmupSamples: 1,
      measuredSamples: 1
    })).toThrow(/document IDs.*unique/i)
  })

  it('rejects blank identities and non-positive integer sample counts', () => {
    expect(() => createPerformanceObservationSchedule({
      documentIds: [' '],
      warmupSamples: 1,
      measuredSamples: 1
    })).toThrow(/document ID.*non-empty/i)
    expect(() => createPerformanceObservationSchedule({
      documentIds: ['a'],
      warmupSamples: 0,
      measuredSamples: 1
    })).toThrow(/sample counts.*positive integers/i)
    expect(() => createPerformanceObservationSchedule({
      documentIds: ['a'],
      warmupSamples: 1,
      measuredSamples: 1.5
    })).toThrow(/sample counts.*positive integers/i)
  })

  it('balances the authenticated five-document 20/200 ratification schedule', () => {
    const documentIds = ['a', 'b', 'c', 'd', 'e']
    const schedule = createPerformanceObservationSchedule({
      documentIds,
      warmupSamples: 20,
      measuredSamples: 200
    })

    expect(schedule).toHaveLength(1_100)
    expect(schedule.slice(0, 100).every(entry => entry.phase === 'warmup'))
      .toBe(true)
    expect(schedule.slice(100).every(entry => entry.phase === 'measured'))
      .toBe(true)
    for (let offset = 0; offset < schedule.length; offset += documentIds.length) {
      expect(schedule.slice(offset, offset + documentIds.length)
        .map(entry => entry.documentId).sort()).toEqual(documentIds)
    }
    for (const documentId of documentIds) {
      expect(schedule.filter(entry =>
        entry.documentId === documentId && entry.roundPosition === 1
      )).toHaveLength(44)
    }
  })

  it('carries rotation across a phase boundary not divisible by document count', () => {
    const schedule = createPerformanceObservationSchedule({
      documentIds: ['a', 'b', 'c', 'd', 'e'],
      warmupSamples: 1,
      measuredSamples: 2
    })

    expect(schedule.filter(entry => entry.roundPosition === 1)).toEqual([
      { ordinal: 1, phase: 'warmup', phaseRound: 1, roundPosition: 1, documentId: 'a' },
      { ordinal: 6, phase: 'measured', phaseRound: 1, roundPosition: 1, documentId: 'b' },
      { ordinal: 11, phase: 'measured', phaseRound: 2, roundPosition: 1, documentId: 'c' }
    ])
  })
})
