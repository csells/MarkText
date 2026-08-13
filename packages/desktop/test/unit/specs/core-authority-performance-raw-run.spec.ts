import { describe, expect, it } from 'vitest'

import {
  createCoreAuthorityPerformanceRawRun,
  type CoreAuthorityPerformanceRawSample
} from '../../e2e/helpers/coreAuthorityPerformanceRawRun'

const report = (
  value: number,
  pendingDepthMaximum = 1,
  correctionCount = 0
) => Object.freeze({
  t_dispatch: Object.freeze([value]),
  t_ack: Object.freeze([value + 1]),
  t_reconcile: Object.freeze([value + 2]),
  open: value + 3,
  first_viewport: value + 4,
  pendingDepthMaximum,
  correctionCount
})

describe('Core authority raw performance producer', () => {
  it('assembles exact per-document distributions and queue/correction evidence', () => {
    const digest = 'a'.repeat(64)
    const samples: CoreAuthorityPerformanceRawSample[] = [
      { documentId: 'doc', phase: 'warmup', surface: 'source', report: report(1) },
      {
        documentId: 'doc',
        phase: 'measured',
        surface: 'source',
        report: report(2, 3, 1)
      },
      {
        documentId: 'doc',
        phase: 'measured',
        surface: 'source',
        report: report(3, 2, 0)
      }
    ]

    expect(createCoreAuthorityPerformanceRawRun({
      runId: 'core-2026-08-13',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 2 },
      documents: [{ id: 'doc', sourceSha256: digest }],
      samples
    })).toEqual({
      schema: 'marktext-criticmarkup-raw-performance-run-v2',
      runId: 'core-2026-08-13',
      implementation: 'core-candidate',
      surfaces: ['source'],
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 2 },
      documents: [{
        id: 'doc',
        sourceSha256: digest,
        surface: 'source',
        warmup: {
          t_dispatch: [1],
          t_ack: [2],
          t_reconcile: [3],
          open: [4],
          first_viewport: [5]
        },
        measured: {
          t_dispatch: [2, 3],
          t_ack: [3, 4],
          t_reconcile: [4, 5],
          open: [5, 6],
          first_viewport: [6, 7]
        },
        authorityEvidence: {
          warmup: {
            pendingDepthMaximum: [1],
            correctionCount: [0]
          },
          measured: {
            pendingDepthMaximum: [3, 2],
            correctionCount: [1, 0]
          }
        }
      }]
    })
  })

  it('rejects incomplete or pooled browser transactions', () => {
    const input = {
      runId: 'core',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }]
    } as const

    expect(() => createCoreAuthorityPerformanceRawRun({
      ...input,
      samples: [{
        documentId: 'doc',
        phase: 'warmup',
        surface: 'wysiwyg',
        report: report(1)
      }]
    })).toThrow(/measured sample count/i)
    expect(() => createCoreAuthorityPerformanceRawRun({
      ...input,
      samples: [
        {
          documentId: 'doc',
          phase: 'warmup',
          surface: 'wysiwyg',
          report: { ...report(1), t_dispatch: [1, 2] }
        },
        {
          documentId: 'doc',
          phase: 'measured',
          surface: 'wysiwyg',
          report: report(2)
        }
      ]
    })).toThrow(/one browser transaction/i)
  })

  it('rejects mixed editor surfaces within one document distribution', () => {
    expect(() => createCoreAuthorityPerformanceRawRun({
      runId: 'core',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: [
        {
          documentId: 'doc',
          phase: 'warmup',
          surface: 'wysiwyg',
          report: report(1)
        },
        {
          documentId: 'doc',
          phase: 'measured',
          surface: 'source',
          report: report(2)
        }
      ]
    })).toThrow(/one editor surface/i)
  })
})
