import { describe, expect, it } from 'vitest'

import {
  chooseCoreAuthorityPerformanceSurface,
  createCoreAuthorityPerformanceRawRun,
  formatMacHardwareFingerprint,
  type CoreAuthorityPerformanceBuildProvenance,
  type CoreAuthorityPerformanceRawSample
} from '../../e2e/helpers/coreAuthorityPerformanceRawRun'

const report = (
  value: number,
  pendingDepthMaximum = 1,
  correctionCount = 0
) => Object.freeze({
  t_echo: Object.freeze([value + 0.5]),
  t_dispatch: Object.freeze([value]),
  t_ack: Object.freeze([value + 1]),
  t_reconcile: Object.freeze([value + 2]),
  t_frame: Object.freeze([value + 2.5]),
  open: value + 3,
  first_viewport: value + 4,
  pendingDepthMaximum,
  correctionCount
})

const authenticatedProvenance = Object.freeze({
  checkoutHead: '2'.repeat(40),
  checkoutClean: true,
  harnessCommit: '2'.repeat(40),
  packageArtifactSha256: '3'.repeat(64),
  executableSha256: '4'.repeat(64),
  packageVersion: '0.17.0',
  packageManager: 'pnpm@10.14.0',
  nodeVersion: 'v22.18.0',
  playwrightVersion: '1.61.0',
  lockfileSha256: '5'.repeat(64),
  producerSha256: '6'.repeat(64),
  probeSha256: '7'.repeat(64),
  launcherSha256: '8'.repeat(64),
  measurementBoundary: 'core-authority-browser-external-v3',
  launchBoundary: 'playwright-electron-packaged-v1',
  windowVisibility: 'hidden-unfocused'
})

describe('Core authority raw performance producer', () => {
  it('formats the frozen Mac hardware fingerprint exactly', () => {
    expect(formatMacHardwareFingerprint({
      machineName: 'MacBook Pro',
      machineModel: 'Mac17,6',
      chipType: 'Apple M5 Max',
      physicalMemory: '128 GB'
    })).toBe('MacBook Pro Mac17,6, Apple M5 Max, 128 GB')
  })

  it('keeps an active Source surface ahead of hidden WYSIWYG bindings', () => {
    expect(chooseCoreAuthorityPerformanceSurface({
      sourceActive: true,
      wysiwygEditable: true
    })).toBe('source')
    expect(chooseCoreAuthorityPerformanceSurface({
      sourceActive: false,
      wysiwygEditable: true
    })).toBe('wysiwyg')
    expect(chooseCoreAuthorityPerformanceSurface({
      sourceActive: false,
      wysiwygEditable: false
    })).toBe('source')
  })

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
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 2 },
      provenance: authenticatedProvenance,
      documents: [{ id: 'doc', sourceSha256: digest }],
      samples
    })).toEqual({
      schema: 'marktext-criticmarkup-raw-performance-smoke-v3',
      evidenceClass: 'smoke-non-ratifying',
      runId: 'core-2026-08-13',
      implementation: 'core-candidate',
      surfaces: ['source'],
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 2 },
      provenance: authenticatedProvenance,
      documents: [{
        id: 'doc',
        sourceSha256: digest,
        surface: 'source',
        warmup: {
          t_echo: [1.5],
          t_dispatch: [1],
          t_ack: [2],
          t_reconcile: [3],
          t_frame: [3.5],
          open: [4],
          first_viewport: [5]
        },
        measured: {
          t_echo: [2.5, 3.5],
          t_dispatch: [2, 3],
          t_ack: [3, 4],
          t_reconcile: [4, 5],
          t_frame: [4.5, 5.5],
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

  it('keeps short Core smoke output structurally non-ratifying', () => {
    const smoke = createCoreAuthorityPerformanceRawRun({
      runId: 'core-smoke',
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance: authenticatedProvenance,
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: [
        { documentId: 'doc', phase: 'warmup', surface: 'source', report: report(1) },
        { documentId: 'doc', phase: 'measured', surface: 'source', report: report(2) }
      ]
    })
    expect(smoke).toMatchObject({
      schema: 'marktext-criticmarkup-raw-performance-smoke-v3',
      evidenceClass: 'smoke-non-ratifying'
    })
  })

  it('requires the fixed 20/200 protocol for ratification output', () => {
    expect(() => createCoreAuthorityPerformanceRawRun({
      runId: 'core',
      evidenceClass: 'ratification',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance: authenticatedProvenance,
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: [
        { documentId: 'doc', phase: 'warmup', surface: 'source', report: report(1) },
        { documentId: 'doc', phase: 'measured', surface: 'source', report: report(2) }
      ]
    })).toThrow(/20 warmup and 200 measured/i)
  })

  it('rejects incomplete or pooled browser transactions', () => {
    const input = {
      runId: 'core',
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance: authenticatedProvenance,
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
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance: authenticatedProvenance,
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

  it('rejects evidence produced from a dirty checkout', () => {
    expect(() => createCoreAuthorityPerformanceRawRun({
      runId: 'core',
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance: { ...authenticatedProvenance, checkoutClean: false },
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: [
        {
          documentId: 'doc',
          phase: 'warmup',
          surface: 'source',
          report: report(1)
        },
        {
          documentId: 'doc',
          phase: 'measured',
          surface: 'source',
          report: report(2)
        }
      ]
    })).toThrow(/clean checkout/i)
  })

  it('rejects evidence whose checkout does not authenticate the build commit', () => {
    expect(() => createCoreAuthorityPerformanceRawRun({
      runId: 'core',
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance: { ...authenticatedProvenance, checkoutHead: '9'.repeat(40) },
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: [
        {
          documentId: 'doc',
          phase: 'warmup',
          surface: 'source',
          report: report(1)
        },
        {
          documentId: 'doc',
          phase: 'measured',
          surface: 'source',
          report: report(2)
        }
      ]
    })).toThrow(/checkout head must equal the build commit/i)
  })

  it.each([
    'packageArtifactSha256',
    'executableSha256',
    'lockfileSha256',
    'producerSha256',
    'probeSha256',
    'launcherSha256'
  ] as const)('rejects an invalid %s provenance digest', field => {
    expect(() => createCoreAuthorityPerformanceRawRun({
      runId: 'core',
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance: { ...authenticatedProvenance, [field]: 'not-a-digest' },
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: [
        {
          documentId: 'doc',
          phase: 'warmup',
          surface: 'source',
          report: report(1)
        },
        {
          documentId: 'doc',
          phase: 'measured',
          surface: 'source',
          report: report(2)
        }
      ]
    })).toThrow(/invalid/i)
  })

  it.each([
    ['packageVersion', ''],
    ['packageManager', ''],
    ['nodeVersion', ''],
    ['playwrightVersion', ''],
    ['measurementBoundary', 'legacy-core-timing'],
    ['launchBoundary', 'development-preview'],
    ['windowVisibility', 'visible']
  ] as const)('rejects unauthenticated %s provenance', (field, value) => {
    const provenance = {
      ...authenticatedProvenance,
      [field]: value
    } as unknown as CoreAuthorityPerformanceBuildProvenance
    expect(() => createCoreAuthorityPerformanceRawRun({
      runId: 'core',
      evidenceClass: 'smoke-non-ratifying',
      baselineCommit: '1'.repeat(40),
      buildCommit: '2'.repeat(40),
      measuredAt: '2026-08-13T12:00:00.000Z',
      environment: { build: 'packaged' },
      sampling: { warmupSamples: 1, measuredSamples: 1 },
      provenance,
      documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
      samples: [
        {
          documentId: 'doc',
          phase: 'warmup',
          surface: 'source',
          report: report(1)
        },
        {
          documentId: 'doc',
          phase: 'measured',
          surface: 'source',
          report: report(2)
        }
      ]
    })).toThrow(/provenance/i)
  })
})
