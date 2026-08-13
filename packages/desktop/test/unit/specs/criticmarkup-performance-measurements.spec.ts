import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  type CriticMarkupPerformanceMeasurementManifest,
  type CriticMarkupRawPerformanceRun,
  requireCriticMarkupPerformanceEvidenceForRatification,
  validateCriticMarkupPerformanceMeasurements
} from '../../../../../scripts/criticmarkupPerformanceMeasurements'

const repoRoot = resolve(import.meta.dirname, '../../../../..')
const manifestPath = resolve(
  repoRoot,
  'specs/baselines/criticmarkup-performance-measurements.json'
)
const targetPath = resolve(
  repoRoot,
  'specs/baselines/criticmarkup-performance-targets.json'
)
const documentsPath = resolve(
  repoRoot,
  'specs/baselines/criticmarkup-representative-documents.json'
)
const manifest = JSON.parse(
  readFileSync(manifestPath, 'utf8')
) as CriticMarkupPerformanceMeasurementManifest
const targetsSource = readFileSync(targetPath, 'utf8')
const documentsSource = readFileSync(documentsPath, 'utf8')
const targets = JSON.parse(targetsSource) as {
  environment: Record<string, string>
  sampling: { warmupSamples: number, measuredSamples: number }
}
const documents = JSON.parse(documentsSource) as {
  documents: Array<{ id: string, sha256: string }>
}

const sha256 = (source: string): string => createHash('sha256')
  .update(source)
  .digest('hex')

const first = <Value>(values: Value[]): Value => {
  const value = values[0]
  if (value === undefined) throw new Error('Synthetic fixture requires an entry')
  return value
}

const sampleRecord = (length: number, base: number) => ({
  t_dispatch: Array.from({ length }, (_, index) => base + index / 1000),
  t_ack: Array.from({ length }, (_, index) => base + 10 + index / 1000),
  t_reconcile: Array.from({ length }, (_, index) => base + 20 + index / 1000),
  open: Array.from({ length }, (_, index) => base + 100 + index / 1000),
  first_viewport: Array.from({ length }, (_, index) => base + 200 + index / 1000)
})

const rawRun = (
  implementation: 'upstream-baseline' | 'core-candidate'
): CriticMarkupRawPerformanceRun => ({
  schema: implementation === 'core-candidate'
    ? 'marktext-criticmarkup-raw-performance-run-v2'
    : 'marktext-criticmarkup-raw-performance-run-v1',
  runId: `${implementation}-synthetic-validator-fixture`,
  implementation,
  ...(implementation === 'core-candidate'
    ? { surfaces: ['source'] }
    : {}),
  baselineCommit: manifest.baselineCommit,
  buildCommit: implementation === 'upstream-baseline'
    ? manifest.baselineCommit
    : 'a'.repeat(40),
  measuredAt: '2026-08-13T00:00:00.000Z',
  environment: targets.environment,
  sampling: {
    warmupSamples: targets.sampling.warmupSamples,
    measuredSamples: targets.sampling.measuredSamples
  },
  documents: documents.documents.map((document, documentIndex) => ({
    id: document.id,
    sourceSha256: document.sha256,
    ...(implementation === 'core-candidate'
      ? {
        surface: 'source',
        authorityEvidence: {
          warmup: {
            pendingDepthMaximum: Array.from(
              { length: targets.sampling.warmupSamples },
              () => 1
            ),
            correctionCount: Array.from(
              { length: targets.sampling.warmupSamples },
              () => 0
            )
          },
          measured: {
            pendingDepthMaximum: Array.from(
              { length: targets.sampling.measuredSamples },
              () => 1
            ),
            correctionCount: Array.from(
              { length: targets.sampling.measuredSamples },
              () => 0
            )
          }
        }
      }
      : {}),
    warmup: sampleRecord(targets.sampling.warmupSamples, documentIndex + 1),
    measured: sampleRecord(targets.sampling.measuredSamples, documentIndex + 1)
  }))
} as unknown as CriticMarkupRawPerformanceRun)

const withSyntheticRuns = (
  action: (
    root: string,
    measured: CriticMarkupPerformanceMeasurementManifest,
    rawPath: string
  ) => void
): void => {
  const root = mkdtempSync(resolve(tmpdir(), 'marktext-performance-'))
  try {
    const write = (path: string, source: string): void => {
      const absolute = resolve(root, path)
      mkdirSync(dirname(absolute), { recursive: true })
      writeFileSync(absolute, source)
    }
    write(manifest.targetManifest.path, targetsSource)
    write(manifest.representativeDocuments.path, documentsSource)

    const runs = (['upstream-baseline', 'core-candidate'] as const).map(implementation => {
      const raw = `${JSON.stringify(rawRun(implementation), null, 2)}\n`
      const path = `specs/baselines/runs/performance/${implementation}-synthetic.json`
      write(path, raw)
      return {
        id: `${implementation}-synthetic-validator-fixture`,
        implementation,
        path,
        sha256: sha256(raw)
      }
    })
    action(root, {
      ...structuredClone(manifest),
      status: 'measured-unratified',
      runs
    }, runs[0].path)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('CriticMarkup raw performance evidence', () => {
  it('records the missing Core measurement denominator without inventing samples', () => {
    expect(manifest).toMatchObject({
      status: 'awaiting-raw-runs',
      runs: [],
      requiredMetrics: [
        't_dispatch',
        't_ack',
        't_reconcile',
        'open',
        'first_viewport'
      ]
    })
    expect(() => validateCriticMarkupPerformanceMeasurements(repoRoot, manifest))
      .not.toThrow()
    expect(() => requireCriticMarkupPerformanceEvidenceForRatification(repoRoot, manifest))
      .toThrow(
        /requires checked-in raw runs for: upstream-baseline, core-candidate/
      )
  })

  it('accepts complete synthetic raw runs for both required implementations', () => {
    withSyntheticRuns((root, measured) => {
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .not.toThrow()
      const summary = requireCriticMarkupPerformanceEvidenceForRatification(root, measured)
      expect(summary.rows).toHaveLength(50)
      expect(first(summary.rows)).toMatchObject({
        runId: 'upstream-baseline-synthetic-validator-fixture',
        implementation: 'upstream-baseline',
        documentId: 'all-blocks',
        metric: 't_dispatch',
        targetP95Ms: 8,
        meetsTarget: true
      })
      expect(first(summary.rows).p95Ms).toBeCloseTo(1.189)
    })
  })

  it('rejects Core v2 evidence without exact per-document authority metadata', () => {
    withSyntheticRuns((root, measured) => {
      const coreRef = measured.runs.find(run => run.implementation === 'core-candidate')
      if (coreRef === undefined) throw new Error('Synthetic Core run is missing')
      const raw = JSON.parse(
        readFileSync(resolve(root, coreRef.path), 'utf8')
      ) as unknown as {
        documents: Array<{ authorityEvidence?: unknown }>
      }
      delete first(raw.documents).authorityEvidence
      const source = `${JSON.stringify(raw, null, 2)}\n`
      writeFileSync(resolve(root, coreRef.path), source)
      coreRef.sha256 = sha256(source)
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/authority evidence/i)
    })
  })

  it('rejects missing, stale, or incomplete raw evidence', () => {
    const absent = structuredClone(manifest)
    absent.status = 'measured-unratified'
    absent.runs = [{
      id: 'missing-run',
      implementation: 'core-candidate',
      path: 'specs/baselines/runs/performance/missing.json',
      sha256: '0'.repeat(64)
    }]
    expect(() => validateCriticMarkupPerformanceMeasurements(repoRoot, absent))
      .toThrow(/Raw performance evidence is absent/)

    withSyntheticRuns((root, measured, rawPath) => {
      writeFileSync(resolve(root, rawPath), '{"tampered":true}\n')
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/Raw performance evidence digest is stale/)
    })

    withSyntheticRuns((root, measured) => {
      const firstRun = first(measured.runs)
      const rawPath = firstRun.path
      const raw = JSON.parse(
        readFileSync(resolve(root, rawPath), 'utf8')
      ) as CriticMarkupRawPerformanceRun
      first(raw.documents).measured.t_ack.pop()
      const source = `${JSON.stringify(raw, null, 2)}\n`
      writeFileSync(resolve(root, rawPath), source)
      firstRun.sha256 = sha256(source)
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/t_ack .*measured sample count must be 200/)
    })
  })

  it('rejects stale target and representative-document prerequisites', () => {
    const staleTargets = structuredClone(manifest)
    staleTargets.targetManifest.sha256 = '0'.repeat(64)
    expect(() => validateCriticMarkupPerformanceMeasurements(repoRoot, staleTargets))
      .toThrow(/Performance target manifest digest is stale/)

    const staleDocuments = structuredClone(manifest)
    staleDocuments.representativeDocuments.sha256 = '0'.repeat(64)
    expect(() => validateCriticMarkupPerformanceMeasurements(repoRoot, staleDocuments))
      .toThrow(/Representative document manifest digest is stale/)
  })
})
