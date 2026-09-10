import { describe, expect, it } from 'vitest'

import {
  createCoreAuthorityPerformanceTrace,
  measureCoreDocumentOpen,
  type CoreAuthorityPerformanceEvent
} from '@/documentAuthority/coreAuthorityPerformanceTrace'

describe('Core authority performance trace', () => {
  it('records one bounded open and transaction lifecycle in one clock domain', () => {
    let now = 10
    const trace = createCoreAuthorityPerformanceTrace({
      clock: () => now,
      maximumEvents: 6
    })

    trace.record('open-request', 'document.md')
    now = 14
    trace.record('open-ack', 'document.md')
    now = 18
    trace.record('first-editable-viewport', 'document.md', {
      surface: 'wysiwyg'
    })
    now = 20
    trace.record('dispatch', 'document.md', {
      transaction: 1,
      pendingDepth: 1
    })
    now = 23
    trace.record('ack', 'document.md', { transaction: 1 })
    now = 25
    trace.record('reconcile', 'document.md', {
      transaction: 1,
      corrected: false
    })

    expect(trace.events()).toEqual<readonly CoreAuthorityPerformanceEvent[]>([
      { phase: 'open-request', documentId: 'document.md', at: 10 },
      { phase: 'open-ack', documentId: 'document.md', at: 14 },
      {
        phase: 'first-editable-viewport',
        surface: 'wysiwyg',
        documentId: 'document.md',
        at: 18
      },
      {
        phase: 'dispatch',
        documentId: 'document.md',
        transaction: 1,
        pendingDepth: 1,
        at: 20
      },
      { phase: 'ack', documentId: 'document.md', transaction: 1, at: 23 },
      {
        phase: 'reconcile',
        documentId: 'document.md',
        transaction: 1,
        corrected: false,
        at: 25
      }
    ])
    expect(trace.status()).toEqual({
      accepting: false,
      eventCount: 6,
      stopReason: 'capacity'
    })
  })

  it('detaches snapshots and ignores invalid or late events', () => {
    const trace = createCoreAuthorityPerformanceTrace({
      clock: () => 7,
      maximumEvents: 2
    })
    trace.record('dispatch', 'a.md', { transaction: 1, pendingDepth: 1 })
    const first = trace.events()
    trace.record('ack', 'a.md', { transaction: 1 })
    trace.record('reconcile', 'a.md', { transaction: 1, corrected: true })

    expect(first).toEqual([
      {
        phase: 'dispatch',
        documentId: 'a.md',
        transaction: 1,
        pendingDepth: 1,
        at: 7
      }
    ])
    expect(trace.events()).toHaveLength(2)
    expect(() =>
      trace.record('dispatch', 'a.md', {
        transaction: 0,
        pendingDepth: 1
      })
    ).not.toThrow()
  })

  it('brackets synchronous model admission before returning and never acknowledges failure', () => {
    let now = 1
    const trace = createCoreAuthorityPerformanceTrace({ clock: () => now })
    const result = measureCoreDocumentOpen(trace, 'ok.md', () => {
      now = 4
      return 'opened'
    })
    expect(result).toBe('opened')
    expect(() =>
      measureCoreDocumentOpen(trace, 'bad.md', () => {
        now = 7
        throw new Error('open failed')
      })
    ).toThrow('open failed')

    expect(trace.events()).toEqual([
      { phase: 'open-request', documentId: 'ok.md', at: 1 },
      { phase: 'open-ack', documentId: 'ok.md', at: 4 },
      { phase: 'open-request', documentId: 'bad.md', at: 4 }
    ])
  })

  it('preserves browser event timestamps supplied by the input probe', () => {
    const trace = createCoreAuthorityPerformanceTrace({ clock: () => 99 })
    trace.capture({
      phase: 'dispatch',
      documentId: 'event.md',
      transaction: 3,
      pendingDepth: 1,
      at: 12.5
    })
    expect(trace.events()[0]).toEqual({
      phase: 'dispatch',
      documentId: 'event.md',
      transaction: 3,
      pendingDepth: 1,
      at: 12.5
    })
  })
})
