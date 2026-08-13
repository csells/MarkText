import { describe, expect, it } from 'vitest'

import {
  reportCoreAuthorityPerformance
} from '../../e2e/helpers/coreAuthorityPerformanceReport'

describe('Core authority performance report', () => {
  it('joins ordered browser inputs to exact authority transactions', () => {
    expect(reportCoreAuthorityPerformance({
      surface: 'source',
      externalOpen: { open: 3, firstViewport: 9 },
      inputEvents: [
        { sequence: 1, tEvent: 10, tEcho: 12, tPresent: 16 },
        { sequence: 2, tEvent: 20, tEcho: 24, tPresent: 27 }
      ],
      authorityEvents: [
        { phase: 'open-request', documentId: 'a.md', at: 1 },
        { phase: 'open-ack', documentId: 'a.md', at: 4 },
        {
          phase: 'first-editable-viewport',
          surface: 'wysiwyg',
          documentId: 'a.md',
          at: 6
        },
        {
          phase: 'first-editable-viewport',
          surface: 'source',
          documentId: 'a.md',
          at: 7
        },
        { phase: 'dispatch', documentId: 'a.md', transaction: 4, pendingDepth: 1, at: 11 },
        { phase: 'ack', documentId: 'a.md', transaction: 4, at: 14 },
        { phase: 'reconcile', documentId: 'a.md', transaction: 4, corrected: false, at: 15 },
        { phase: 'dispatch', documentId: 'a.md', transaction: 5, pendingDepth: 1, at: 22 },
        { phase: 'ack', documentId: 'a.md', transaction: 5, at: 23 },
        { phase: 'reconcile', documentId: 'a.md', transaction: 5, corrected: true, at: 25 }
      ]
    })).toEqual({
      t_echo: [2, 4],
      t_dispatch: [1, 2],
      t_ack: [4, 3],
      t_reconcile: [5, 5],
      t_present: [6, 7],
      open: 3,
      first_viewport: 9,
      pendingDepthMaximum: 1,
      correctionCount: 1
    })
  })

  it('rejects missing, duplicate, misordered, or cross-document phases', () => {
    const inputEvents = [{ sequence: 1, tEvent: 10, tEcho: 12, tPresent: 16 }]
    const externalOpen = { open: 3, firstViewport: 9 }
    const base = [
      { phase: 'open-request' as const, documentId: 'a.md', at: 1 },
      { phase: 'open-ack' as const, documentId: 'a.md', at: 4 },
      {
        phase: 'first-editable-viewport' as const,
        surface: 'source' as const,
        documentId: 'a.md',
        at: 7
      },
      { phase: 'dispatch' as const, documentId: 'a.md', transaction: 4, pendingDepth: 1, at: 11 },
      { phase: 'ack' as const, documentId: 'a.md', transaction: 4, at: 14 },
      { phase: 'reconcile' as const, documentId: 'a.md', transaction: 4, corrected: false, at: 15 }
    ]
    expect(() => reportCoreAuthorityPerformance({
      inputEvents,
      externalOpen,
      surface: 'source',
      authorityEvents: base.slice(0, -1)
    })).toThrow(/complete transaction/i)
    expect(() => reportCoreAuthorityPerformance({
      inputEvents,
      externalOpen,
      surface: 'source',
      authorityEvents: [...base, { ...base[4]!, at: 16 }]
    })).toThrow(/duplicate/i)
    expect(() => reportCoreAuthorityPerformance({
      inputEvents,
      externalOpen,
      surface: 'source',
      authorityEvents: base.map(event => event.phase === 'ack'
        ? { ...event, at: 9 }
        : event)
    })).toThrow(/timestamp order/i)
    expect(() => reportCoreAuthorityPerformance({
      inputEvents,
      externalOpen,
      surface: 'source',
      authorityEvents: base.map(event => event.phase === 'reconcile'
        ? { ...event, documentId: 'b.md' }
        : event)
    })).toThrow(/one document/i)
    expect(() => reportCoreAuthorityPerformance({
      inputEvents: [{ sequence: 1, tEvent: 10, tEcho: 17, tPresent: 16 }],
      externalOpen,
      surface: 'source',
      authorityEvents: base
    })).toThrow(/browser input timestamp order/i)
    expect(() => reportCoreAuthorityPerformance({
      inputEvents,
      externalOpen: { open: 10, firstViewport: 9 },
      surface: 'source',
      authorityEvents: base
    })).toThrow(/external open timestamp order/i)
  })
})
