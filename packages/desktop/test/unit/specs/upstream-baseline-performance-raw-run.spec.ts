import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  createUpstreamBaselinePerformanceRawRun,
  writeUpstreamBaselinePerformanceRawRun,
  type UpstreamBaselinePerformanceRawSample
} from '../../e2e/helpers/upstreamBaselinePerformanceRawRun'

const PINNED_BASELINE = '43bd8b77795fb27b1a9512737c000f7362031ea0'

const sample = (
  documentId: string,
  phase: 'warmup' | 'measured',
  value: number
): UpstreamBaselinePerformanceRawSample => ({
  documentId,
  phase,
  report: {
    t_dispatch: 0,
    t_ack: value + 1,
    t_reconcile: value + 2,
    open: value + 3,
    first_viewport: value + 4
  }
})

const input = (
  evidenceClass: 'ratification' | 'smoke-non-ratifying',
  warmupSamples: number,
  measuredSamples: number
) => ({
  evidenceClass,
  runId: `upstream-${evidenceClass}`,
  baselineCommit: PINNED_BASELINE,
  buildCommit: PINNED_BASELINE,
  measuredAt: '2026-08-13T12:00:00.000Z',
  environment: { build: 'MarkText production Electron bundle' },
  sampling: { warmupSamples, measuredSamples },
  documents: [{ id: 'doc', sourceSha256: 'a'.repeat(64) }],
  provenance: {
    detachedWorktreeHead: PINNED_BASELINE,
    detachedWorktreeClean: true,
    packageArtifactSha256: 'b'.repeat(64),
    executableSha256: 'c'.repeat(64),
    packageVersion: '0.20.0-dev',
    packageManager: 'pnpm@10.33.4',
    nodeVersion: 'v22.20.0',
    playwrightVersion: '1.61.0',
    lockfileSha256: 'd'.repeat(64),
    producerSha256: 'e'.repeat(64),
    probeSha256: 'f'.repeat(64),
    launcherSha256: '1'.repeat(64),
    measurementBoundary: 'external-browser-dom-v1' as const,
    launchBoundary: 'external-inspector-hidden-cdp-v1' as const,
    windowVisibility: 'hidden-unfocused' as const
  },
  samples: [
    ...Array.from({ length: warmupSamples }, (_, index) =>
      sample('doc', 'warmup', index + 1)),
    ...Array.from({ length: measuredSamples }, (_, index) =>
      sample('doc', 'measured', index + 101))
  ]
})

describe('upstream baseline raw performance producer', () => {
  it('creates an accepted v1 shape only for pinned 20/200 ratification evidence', () => {
    const run = createUpstreamBaselinePerformanceRawRun(
      input('ratification', 20, 200)
    )

    expect(run).toMatchObject({
      schema: 'marktext-criticmarkup-raw-performance-run-v1',
      runId: 'upstream-ratification',
      implementation: 'upstream-baseline',
      baselineCommit: PINNED_BASELINE,
      buildCommit: PINNED_BASELINE,
      sampling: { warmupSamples: 20, measuredSamples: 200 },
      provenance: {
        detachedWorktreeHead: PINNED_BASELINE,
        detachedWorktreeClean: true,
        lockfileSha256: 'd'.repeat(64),
        producerSha256: 'e'.repeat(64),
        probeSha256: 'f'.repeat(64),
        launcherSha256: '1'.repeat(64),
        measurementBoundary: 'external-browser-dom-v1',
        launchBoundary: 'external-inspector-hidden-cdp-v1',
        windowVisibility: 'hidden-unfocused'
      },
      metricDefinitions: {
        t_dispatch: 'Captured beforeinput dispatch origin; elapsed value is zero.',
        t_ack: 'First exact matching Muya DOM state observed after dispatch.',
        t_reconcile: 'Next animation frame whose matching Muya DOM state remains stable.',
        open: 'External elapsed time from file-open request until its tab is active.',
        first_viewport: 'External elapsed time from file-open request until its editor is editable.'
      }
    })
    expect(run.documents[0]?.warmup.t_dispatch).toEqual(Array(20).fill(0))
    expect(run.documents[0]?.measured.t_ack).toHaveLength(200)
  })

  it('marks configurable smoke output with a schema rejected by ratification', () => {
    const smoke = createUpstreamBaselinePerformanceRawRun(
      input('smoke-non-ratifying', 1, 2)
    )

    expect(smoke).toMatchObject({
      schema: 'marktext-criticmarkup-raw-performance-smoke-v1',
      evidenceClass: 'smoke-non-ratifying',
      sampling: { warmupSamples: 1, measuredSamples: 2 }
    })
    expect(() => createUpstreamBaselinePerformanceRawRun(
      input('ratification', 1, 2)
    )).toThrow(/ratification.*20 warmup and 200 measured/i)
  })

  it('rejects stale provenance, unordered observations, and incomplete documents', () => {
    expect(() => createUpstreamBaselinePerformanceRawRun({
      ...input('smoke-non-ratifying', 1, 2),
      buildCommit: 'd'.repeat(40)
    })).toThrow(/build commit.*pinned baseline/i)
    expect(() => createUpstreamBaselinePerformanceRawRun({
      ...input('smoke-non-ratifying', 1, 2),
      provenance: {
        ...input('smoke-non-ratifying', 1, 2).provenance,
        launcherSha256: 'not-a-digest'
      }
    })).toThrow(/launcher digest/i)

    const invalid = input('smoke-non-ratifying', 1, 2)
    const invalidSample = invalid.samples[0]
    if (invalidSample === undefined) throw new Error('Synthetic sample is missing')
    invalid.samples[0] = {
      ...invalidSample,
      report: { ...invalidSample.report, t_reconcile: 0 }
    }
    expect(() => createUpstreamBaselinePerformanceRawRun(invalid))
      .toThrow(/timing order/i)

    expect(() => createUpstreamBaselinePerformanceRawRun({
      ...input('smoke-non-ratifying', 1, 2),
      samples: input('smoke-non-ratifying', 1, 2).samples.slice(0, 2)
    })).toThrow(/measured sample count must be 2/i)
  })

  it('writes exclusively and never allows smoke into the ratification directory', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'marktext-upstream-raw-'))
    try {
      const ratification = createUpstreamBaselinePerformanceRawRun(
        input('ratification', 20, 200)
      )
      const output = resolve(root, 'ratification.json')
      writeUpstreamBaselinePerformanceRawRun(output, ratification)
      expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(ratification)
      expect(() => writeUpstreamBaselinePerformanceRawRun(output, ratification))
        .toThrow(/refusing to replace/i)

      const smoke = createUpstreamBaselinePerformanceRawRun(
        input('smoke-non-ratifying', 1, 2)
      )
      expect(() => writeUpstreamBaselinePerformanceRawRun(
        resolve(root, 'specs/baselines/runs/performance/smoke.json'),
        smoke
      )).toThrow(/smoke.*ratification directory/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
