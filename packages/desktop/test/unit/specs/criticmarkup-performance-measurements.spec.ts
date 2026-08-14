import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
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
  CORE_PERFORMANCE_PRODUCER_PATHS,
  type CriticMarkupPerformanceMeasurementManifest,
  type CriticMarkupRawPerformanceRun,
  type CriticMarkupUpstreamRawPerformanceRunV10,
  materializeCriticMarkupMeasuredPerformanceManifest,
  writeCriticMarkupPerformanceCalibrationReport,
  UPSTREAM_PERFORMANCE_PRODUCER_PATHS,
  requireCriticMarkupPerformanceEvidenceForRatification,
  validateCriticMarkupPerformanceMeasurements
} from '../../../../../scripts/criticmarkupPerformanceMeasurements'
import {
  PERFORMANCE_OBSERVATION_SCHEDULE,
  createPerformanceObservationSchedule,
  performanceObservationScheduleSha256
} from '../../../test/e2e/helpers/performanceObservationSchedule'

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
const TOTAL_OBSERVATIONS = documents.documents.length * (
  targets.sampling.warmupSamples + targets.sampling.measuredSamples
)
const OBSERVATION_ORDER = createPerformanceObservationSchedule({
  documentIds: documents.documents.map(document => document.id),
  warmupSamples: targets.sampling.warmupSamples,
  measuredSamples: targets.sampling.measuredSamples
})
const OBSERVATION_SCHEDULE_SHA256 = performanceObservationScheduleSha256(
  OBSERVATION_ORDER
)

const authenticatedCoreProvenance = {
  checkoutHead: 'a'.repeat(40),
  checkoutClean: true,
  harnessCommit: 'a'.repeat(40),
  packageArtifactSha256: '1'.repeat(64),
  executableSha256: '2'.repeat(64),
  packageVersion: '0.17.0',
  packageManager: 'pnpm@10.14.0',
  nodeVersion: 'v22.18.0',
  playwrightVersion: '1.61.0',
  lockfileSha256: '3'.repeat(64),
  producerSha256: '4'.repeat(64),
  probeSha256: '5'.repeat(64),
  launcherSha256: '6'.repeat(64),
  measurementBoundary: 'core-authority-browser-compositor-v6',
  presentationBoundary: 'electron-webcontents-capture-page-transparent-v2',
  launchBoundary: 'playwright-electron-packaged-transparent-v3',
  windowPresentationPolicy: 'transparent-render-active-inactive-v5',
  windowPresentationPlatform: 'darwin',
  chromiumSchedulingPolicy: 'hidden-unthrottled-rendering-v2',
  sampleLifecycle: 'fresh-application-profile-per-observation-v1',
  applicationLaunchCount: TOTAL_OBSERVATIONS,
  uniqueProfileCount: TOTAL_OBSERVATIONS,
  applicationCloseCount: TOTAL_OBSERVATIONS,
  profileCleanupCount: TOTAL_OBSERVATIONS,
  observationSchedule: PERFORMANCE_OBSERVATION_SCHEDULE,
  observationScheduleSha256: OBSERVATION_SCHEDULE_SHA256
} as const

const authenticatedUpstreamProvenance = {
  detachedWorktreeHead: manifest.baselineCommit,
  detachedWorktreeClean: true,
  harnessCommit: 'b'.repeat(40),
  packageArtifactSha256: '1'.repeat(64),
  executableSha256: '2'.repeat(64),
  packageVersion: '0.17.0',
  packageManager: 'pnpm@10.14.0',
  nodeVersion: 'v22.18.0',
  playwrightVersion: '1.61.0',
  lockfileSha256: '3'.repeat(64),
  producerSha256: '4'.repeat(64),
  probeSha256: '5'.repeat(64),
  launcherSha256: '6'.repeat(64),
  measurementBoundary: 'external-browser-compositor-v4',
  presentationBoundary: 'electron-webcontents-capture-page-transparent-v2',
  launchBoundary: 'external-inspector-transparent-render-active-v3',
  windowPresentationPolicy: 'transparent-render-active-inactive-v5',
  windowPresentationPlatform: 'darwin',
  chromiumSchedulingPolicy: 'hidden-unthrottled-rendering-v2',
  sampleLifecycle: 'fresh-application-profile-per-observation-v1',
  applicationLaunchCount: TOTAL_OBSERVATIONS,
  uniqueProfileCount: TOTAL_OBSERVATIONS,
  applicationCloseCount: TOTAL_OBSERVATIONS,
  profileCleanupCount: TOTAL_OBSERVATIONS,
  observationSchedule: PERFORMANCE_OBSERVATION_SCHEDULE,
  observationScheduleSha256: OBSERVATION_SCHEDULE_SHA256
} as const

const sha256 = (source: string): string => createHash('sha256')
  .update(source)
  .digest('hex')

const compositeSha256 = (sources: readonly string[]): string => sha256(sources
  .map(source => `${sha256(source)}\n`)
  .join(''))

const first = <Value>(values: readonly Value[]): Value => {
  const value = values[0]
  if (value === undefined) throw new Error('Synthetic fixture requires an entry')
  return value
}

const commonSampleRecord = (length: number, base: number) => ({
  t_echo: Array.from({ length }, (_, index) => base + index / 1000),
  t_present: Array.from({ length }, (_, index) => base + 10 + index / 1000),
  open: Array.from({ length }, (_, index) => base + 100 + index / 1000),
  first_viewport: Array.from({ length }, (_, index) => base + 200 + index / 1000)
})

const coreSampleRecord = (length: number, base: number) => ({
  ...commonSampleRecord(length, base),
  t_dispatch: Array.from({ length }, (_, index) => base + index / 1000),
  t_ack: Array.from({ length }, (_, index) => base + 10 + index / 1000),
  t_reconcile: Array.from({ length }, (_, index) => base + 20 + index / 1000)
})

const rawRun = (
  implementation: 'upstream-baseline' | 'core-candidate'
): CriticMarkupRawPerformanceRun => ({
  schema: implementation === 'core-candidate'
    ? 'marktext-criticmarkup-raw-performance-run-v12'
    : 'marktext-criticmarkup-raw-performance-run-v10',
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
  observationOrder: OBSERVATION_ORDER,
  ...(implementation === 'core-candidate'
    ? { provenance: authenticatedCoreProvenance }
    : {
      provenance: authenticatedUpstreamProvenance,
      metricDefinitions: {
        t_echo: 'Exact DOM echo from browser event.',
        t_present: 'External compositor-surface capture upper bound.',
        open: 'External open request to active tab.',
        first_viewport: 'External open request to editable viewport.'
      }
    }),
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
    warmup: implementation === 'core-candidate'
      ? coreSampleRecord(targets.sampling.warmupSamples, documentIndex + 1)
      : commonSampleRecord(targets.sampling.warmupSamples, documentIndex + 1),
    measured: implementation === 'core-candidate'
      ? coreSampleRecord(targets.sampling.measuredSamples, documentIndex + 1)
      : commonSampleRecord(targets.sampling.measuredSamples, documentIndex + 1)
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

const withGitAuthenticatedUpstreamRun = (
  action: (
    root: string,
    measured: CriticMarkupPerformanceMeasurementManifest,
    upstream: CriticMarkupRawPerformanceRun,
    update: (raw: CriticMarkupRawPerformanceRun) => void,
    launcherSource: string,
    producerSources: readonly string[]
  ) => void
): void => {
  const root = mkdtempSync(resolve(tmpdir(), 'marktext-performance-git-'))
  try {
    const write = (path: string, source: string): void => {
      const absolute = resolve(root, path)
      mkdirSync(dirname(absolute), { recursive: true })
      writeFileSync(absolute, source)
    }
    const prefix = 'packages/desktop/test/e2e/'
    const lockfileSource = 'lockfileVersion: 9\n'
    const producerSources = [
      'upstream producer\n',
      'upstream raw-run helper\n',
      'upstream environment helper\n',
      'upstream playwright config\n',
      'upstream hidden-policy helper\n',
      'upstream lifecycle-cleanup helper\n',
      'fresh-observation lifecycle helper\n',
      'rotating observation schedule helper\n',
      'shared Chromium scheduling policy\n',
      'shared compositor presentation checkpoint\n'
    ] as const
    const probeSource = 'upstream input probe\n'
    const launcherSource = '#!/bin/sh\necho launch\n'
    const launcherHelperSource = '#!/bin/sh\necho helper\n'
    write(manifest.targetManifest.path, targetsSource)
    write(manifest.representativeDocuments.path, documentsSource)
    write('pnpm-lock.yaml', lockfileSource)
    write(`${prefix}upstream-baseline-performance.spec.ts`, producerSources[0])
    write(`${prefix}helpers/upstreamBaselinePerformanceRawRun.ts`, producerSources[1])
    write(`${prefix}helpers/upstreamBaselineEnvironment.ts`, producerSources[2])
    write(`${prefix}playwright.upstream-baseline-performance.config.ts`, producerSources[3])
    write(`${prefix}helpers/upstreamBaselineHiddenPolicy.ts`, producerSources[4])
    write(`${prefix}helpers/upstreamBaselineLifecycleCleanup.ts`, producerSources[5])
    write(`${prefix}helpers/performanceSampleLifecycle.ts`, producerSources[6])
    write(`${prefix}helpers/performanceObservationSchedule.ts`, producerSources[7])
    write(`${prefix}helpers/performanceChromiumLaunchPolicy.ts`, producerSources[8])
    write(`${prefix}helpers/performancePresentationCheckpoint.ts`, producerSources[9])
    write(`${prefix}helpers/upstreamBaselineInputProbe.ts`, probeSource)
    write(`${prefix}run-upstream-baseline-performance.sh`, launcherSource)
    write(`${prefix}helpers/upstreamBaselinePerformanceRunner.sh`, launcherHelperSource)
    execFileSync('git', ['-C', root, 'init', '--quiet'])
    execFileSync('git', ['-C', root, 'add', '.'])
    execFileSync('git', [
      '-C', root,
      '-c', 'user.name=MarkText Test',
      '-c', 'user.email=marktext-test@example.invalid',
      'commit', '--quiet', '-m', 'fixture'
    ])
    const harnessCommit = execFileSync(
      'git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }
    ).trim()
    const upstream = structuredClone(
      rawRun('upstream-baseline')
    ) as CriticMarkupUpstreamRawPerformanceRunV10
    upstream.baselineCommit = harnessCommit
    upstream.buildCommit = harnessCommit
    upstream.provenance = {
      ...upstream.provenance,
      detachedWorktreeHead: harnessCommit,
      harnessCommit,
      lockfileSha256: sha256(lockfileSource),
      producerSha256: compositeSha256(producerSources),
      probeSha256: sha256(probeSource),
      launcherSha256: compositeSha256([launcherSource, launcherHelperSource])
    }
    const rawPath = 'specs/baselines/runs/performance/upstream-git-fixture.json'
    const measured: CriticMarkupPerformanceMeasurementManifest = {
      ...structuredClone(manifest),
      status: 'measured-unratified',
      baselineCommit: harnessCommit,
      runs: [{
        id: upstream.runId,
        implementation: 'upstream-baseline',
        path: rawPath,
        sha256: ''
      }]
    }
    const update = (raw: CriticMarkupRawPerformanceRun): void => {
      const source = `${JSON.stringify(raw, null, 2)}\n`
      write(rawPath, source)
      first(measured.runs).sha256 = sha256(source)
    }
    update(upstream)
    action(root, measured, upstream, update, launcherSource, producerSources)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

interface MutableScheduleRawRun {
  observationOrder?: Array<Record<string, unknown>>
  provenance: Record<string, unknown>
}

const scheduleFailureCases = [
  {
    name: 'missing observation order',
    mutate: (raw: MutableScheduleRawRun): void => {
      delete raw.observationOrder
    },
    message: /observation order must be an array/i
  },
  {
    name: 'stale schedule digest',
    mutate: (raw: MutableScheduleRawRun): void => {
      raw.provenance.observationScheduleSha256 = '0'.repeat(64)
    },
    message: /observation schedule digest is stale/i
  },
  {
    name: 'reordered observations',
    mutate: (raw: MutableScheduleRawRun): void => {
      if (raw.observationOrder === undefined) throw new Error('Schedule is missing')
      const firstEntry = raw.observationOrder[0]
      const secondEntry = raw.observationOrder[1]
      if (firstEntry === undefined || secondEntry === undefined) {
        throw new Error('Synthetic schedule requires two observations')
      }
      raw.observationOrder[0] = secondEntry
      raw.observationOrder[1] = firstEntry
    },
    message: /observation order ordinal differs/i
  },
  {
    name: 'duplicate observations',
    mutate: (raw: MutableScheduleRawRun): void => {
      if (raw.observationOrder === undefined) throw new Error('Schedule is missing')
      const firstEntry = raw.observationOrder[0]
      if (firstEntry === undefined) throw new Error('Synthetic schedule is empty')
      raw.observationOrder[1] = structuredClone(firstEntry)
    },
    message: /observation order contains a duplicate ordinal/i
  },
  {
    name: 'wrong observation phase',
    mutate: (raw: MutableScheduleRawRun): void => {
      if (raw.observationOrder === undefined) throw new Error('Schedule is missing')
      const firstEntry = raw.observationOrder[0]
      if (firstEntry === undefined) throw new Error('Synthetic schedule is empty')
      firstEntry.phase = 'measured'
    },
    message: /observation order phase differs/i
  },
  {
    name: 'stale schedule policy',
    mutate: (raw: MutableScheduleRawRun): void => {
      raw.provenance.observationSchedule = 'document-at-a-time'
    },
    message: /observation schedule must use warmup then measured rotating round robin/i
  }
] as const

describe('CriticMarkup raw performance evidence', () => {
  it('materializes an exact measured-unratified manifest from an unordered raw pair', () => {
    withSyntheticRuns((root, measured) => {
      const awaiting = {
        ...structuredClone(measured),
        status: 'awaiting-raw-runs' as const,
        runs: []
      }
      const rawPaths = measured.runs.map(run => run.path).reverse()

      expect(materializeCriticMarkupMeasuredPerformanceManifest(
        root,
        awaiting,
        rawPaths
      )).toEqual(measured)
    })
  })

  it('writes one deterministic create-only calibration row and drift diagnostic per metric', () => {
    withSyntheticRuns((root, measured) => {
      const outputPath =
        'specs/baselines/runs/performance/synthetic-calibration.json'
      const materialized = writeCriticMarkupPerformanceCalibrationReport(
        root,
        measured,
        outputPath
      )

      expect(materialized.ref).toEqual({
        path: outputPath,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/u)
      })
      expect(materialized.report).toMatchObject({
        schema: 'marktext-criticmarkup-performance-calibration-v1',
        status: 'measured-unratified',
        provenance: {
          baselineCommit: measured.baselineCommit,
          targetManifest: measured.targetManifest,
          representativeDocuments: measured.representativeDocuments,
          rawRuns: measured.runs
        },
        percentiles: [50, 95, 99]
      })
      expect(materialized.report.rows).toHaveLength(55)
      expect(materialized.report.rows[0]).toEqual({
        runId: 'upstream-baseline-synthetic-validator-fixture',
        implementation: 'upstream-baseline',
        documentId: 'all-blocks',
        metric: 't_echo',
        sampleCount: 200,
        percentiles: { p50Ms: 1.099, p95Ms: 1.189, p99Ms: 1.197 },
        timeOrder: {
          firstMs: 1,
          lastMs: 1.199,
          firstHalfMeanMs: 1.0495,
          secondHalfMeanMs: 1.1495,
          halfMeanDeltaMs: 0.1
        }
      })
      const source = readFileSync(resolve(root, outputPath), 'utf8')
      expect(source).toBe(`${JSON.stringify(materialized.report, null, 2)}\n`)
      expect(sha256(source)).toBe(materialized.ref.sha256)
      expect(() => writeCriticMarkupPerformanceCalibrationReport(
        root,
        measured,
        outputPath
      )).toThrow(/already exists|EEXIST|replace/i)
    })
  })

  it('documents the deterministic schedule scope and its unresolved drift limit', () => {
    for (const path of [
      'specs/baselines/criticmarkup-phase0-review.md',
      'specs/plans/0010-marktext-criticmarkup-core-integration.md',
      'specs/baselines/criticmarkup-upstream-oracles.md'
    ]) {
      const source = readFileSync(resolve(repoRoot, path), 'utf8')
      expect(source).toContain(PERFORMANCE_OBSERVATION_SCHEDULE)
      expect(source).toMatch(/warmup rounds.*before.*measured rounds/is)
      expect(source).toMatch(/each.*document.*once per round/is)
      expect(source).toMatch(/rotat.*across.*phase boundar/is)
      expect(source).toMatch(
        /pre-timing readiness.*two consecutive.*exact Electron.*CGWindow.*bounded.*5 seconds/is
      )
      expect(source).toMatch(/only.*transient origin mismatch.*settle/is)
      expect(source).toMatch(
        /pre-timing.*only.*missing optional.*onScreen.*settle/is
      )
      expect(source).toMatch(/explicit.*onScreen.*false.*strict/is)
      expect(source).toMatch(/post-measurement.*one-shot strict/is)
      expect(source).toMatch(/post-measurement.*null.*onScreen.*strict/is)
      expect(source).toMatch(/launch.*readiness.*excluded.*timed\s+metric/is)
      expect(source).toMatch(/no retries/is)
      expect(source).toMatch(/mandatory.*time-ordered drift\s+diagnostics/is)
      expect(source).toMatch(/no.*pass\/fail threshold/is)
    }
  })

  it('documents the deterministic measured-unratified calibration flow', () => {
    const source = readFileSync(resolve(
      repoRoot,
      'specs/baselines/criticmarkup-phase0-review.md'
    ), 'utf8')

    expect(source).toContain('--materialize-measurements')
    expect(source).toContain('--write-calibration')
    expect(source).toContain('measured-unratified')
    expect(source).toMatch(/checked-in calibration report.*path.*SHA-256/is)
    expect(source).toContain('performance-calibration')
  })

  it('authenticates lifecycle, Chromium, and compositor policies in both producer composites', () => {
    const policy =
      'packages/desktop/test/e2e/helpers/performanceChromiumLaunchPolicy.ts'
    expect(UPSTREAM_PERFORMANCE_PRODUCER_PATHS).toEqual([
      'packages/desktop/test/e2e/upstream-baseline-performance.spec.ts',
      'packages/desktop/test/e2e/helpers/upstreamBaselinePerformanceRawRun.ts',
      'packages/desktop/test/e2e/helpers/upstreamBaselineEnvironment.ts',
      'packages/desktop/test/e2e/playwright.upstream-baseline-performance.config.ts',
      'packages/desktop/test/e2e/helpers/upstreamBaselineHiddenPolicy.ts',
      'packages/desktop/test/e2e/helpers/upstreamBaselineLifecycleCleanup.ts',
      'packages/desktop/test/e2e/helpers/performanceSampleLifecycle.ts',
      'packages/desktop/test/e2e/helpers/performanceObservationSchedule.ts',
      policy,
      'packages/desktop/test/e2e/helpers/performancePresentationCheckpoint.ts'
    ])
    expect(CORE_PERFORMANCE_PRODUCER_PATHS).toEqual([
      'packages/desktop/test/e2e/installed-core-performance.spec.ts',
      'packages/desktop/test/e2e/helpers/coreAuthorityPerformanceRawRun.ts',
      'packages/desktop/test/e2e/helpers/coreAuthorityPerformanceReport.ts',
      'packages/desktop/test/e2e/helpers/performanceSampleLifecycle.ts',
      'packages/desktop/test/e2e/helpers/performanceObservationSchedule.ts',
      'packages/desktop/test/e2e/installedArtifactProvenance.ts',
      'packages/desktop/test/e2e/playwright.installed-core-performance.config.ts',
      policy,
      'packages/desktop/test/e2e/helpers/performancePresentationCheckpoint.ts'
    ])

    const expectShellOrder = (
      runner: string,
      producerPaths: readonly string[]
    ): void => {
      const source = readFileSync(resolve(repoRoot, runner), 'utf8')
      const positions = producerPaths.map(path => source.indexOf(
        path.replace('packages/desktop/test/e2e/', '')
      ))
      expect(positions.every(position => position >= 0)).toBe(true)
      expect(positions).toEqual([...positions].sort((left, right) => left - right))
    }
    expectShellOrder(
      'packages/desktop/test/e2e/run-upstream-baseline-performance.sh',
      UPSTREAM_PERFORMANCE_PRODUCER_PATHS
    )
    expectShellOrder(
      'packages/desktop/test/e2e/run-installed-core-performance.sh',
      CORE_PERFORMANCE_PRODUCER_PATHS
    )
  })

  it('records the missing Core measurement denominator without inventing samples', () => {
    expect(manifest).toMatchObject({
      schema: 'marktext-criticmarkup-performance-measurements-v11',
      status: 'awaiting-raw-runs',
      runs: [],
      requiredMetrics: {
        'upstream-baseline': ['t_echo', 't_present', 'open', 'first_viewport'],
        'core-candidate': [
          't_echo',
          't_dispatch',
          't_ack',
          't_reconcile',
          't_present',
          'open',
          'first_viewport'
        ]
      }
    })
    expect(() => validateCriticMarkupPerformanceMeasurements(repoRoot, manifest))
      .not.toThrow()
    expect(() => requireCriticMarkupPerformanceEvidenceForRatification(
      repoRoot,
      manifest,
      {
        path: 'specs/baselines/runs/performance/absent-calibration.json',
        sha256: '0'.repeat(64)
      }
    ))
      .toThrow(
        /requires checked-in raw runs for: upstream-baseline, core-candidate/
      )
  })

  it('rejects superseded measurement and raw protocol schemas', () => {
    const staleManifest = structuredClone(manifest) as unknown as { schema: string }
    staleManifest.schema = 'marktext-criticmarkup-performance-measurements-v10'
    expect(() => validateCriticMarkupPerformanceMeasurements(
      repoRoot,
      staleManifest as CriticMarkupPerformanceMeasurementManifest
    )).toThrow(/schema is invalid/i)

    withSyntheticRuns((root, measured) => {
      const upstreamRef = measured.runs.find(
        run => run.implementation === 'upstream-baseline'
      )
      if (upstreamRef === undefined) throw new Error('Synthetic upstream run is missing')
      const raw = JSON.parse(
        readFileSync(resolve(root, upstreamRef.path), 'utf8')
      ) as unknown as { schema: string }
      raw.schema = 'marktext-criticmarkup-raw-performance-run-v9'
      const source = `${JSON.stringify(raw, null, 2)}\n`
      writeFileSync(resolve(root, upstreamRef.path), source)
      upstreamRef.sha256 = sha256(source)
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/schema is invalid/i)
    })

    withSyntheticRuns((root, measured) => {
      const coreRef = measured.runs.find(run => run.implementation === 'core-candidate')
      if (coreRef === undefined) throw new Error('Synthetic Core run is missing')
      const raw = JSON.parse(
        readFileSync(resolve(root, coreRef.path), 'utf8')
      ) as unknown as { schema: string }
      raw.schema = 'marktext-criticmarkup-raw-performance-run-v11'
      const source = `${JSON.stringify(raw, null, 2)}\n`
      writeFileSync(resolve(root, coreRef.path), source)
      coreRef.sha256 = sha256(source)
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/schema is invalid/i)
    })
  })

  it.each([
    ['upstream-baseline', 'marktext-criticmarkup-raw-performance-smoke-v10'],
    ['core-candidate', 'marktext-criticmarkup-raw-performance-smoke-v12']
  ] as const)('rejects current %s smoke output as ratification evidence', (
    implementation,
    smokeSchema
  ) => {
    withSyntheticRuns((root, measured) => {
      const ref = measured.runs.find(run => run.implementation === implementation)
      if (ref === undefined) throw new Error(`Synthetic ${implementation} run is missing`)
      const raw = JSON.parse(readFileSync(resolve(root, ref.path), 'utf8')) as {
        schema: string
        evidenceClass?: string
      }
      raw.schema = smokeSchema
      raw.evidenceClass = 'smoke-non-ratifying'
      const source = `${JSON.stringify(raw, null, 2)}\n`
      writeFileSync(resolve(root, ref.path), source)
      ref.sha256 = sha256(source)

      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/schema is invalid/i)
    })
  })

  it.each([
    [
      'sampleLifecycle',
      'one-application-profile-per-run',
      /sample lifecycle.*fresh application profile per observation/i
    ],
    ['applicationLaunchCount', 1099, /applicationLaunchCount must equal 1100/i],
    ['uniqueProfileCount', 1099, /uniqueProfileCount must equal 1100/i],
    ['applicationCloseCount', 1099, /applicationCloseCount must equal 1100/i],
    ['profileCleanupCount', 1099, /profileCleanupCount must equal 1100/i]
  ] as const)('rejects pooled or incomplete Core lifecycle provenance: %s', (
    field,
    value,
    message
  ) => {
    withSyntheticRuns((root, measured) => {
      const coreRef = measured.runs.find(run => run.implementation === 'core-candidate')
      if (coreRef === undefined) throw new Error('Synthetic Core run is missing')
      const raw = JSON.parse(
        readFileSync(resolve(root, coreRef.path), 'utf8')
      ) as unknown as { provenance: Record<string, unknown> }
      raw.provenance[field] = value
      const source = `${JSON.stringify(raw, null, 2)}\n`
      writeFileSync(resolve(root, coreRef.path), source)
      coreRef.sha256 = sha256(source)

      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(message)
    })
  })

  it('rejects pooled upstream lifecycle provenance through the same contract', () => {
    withSyntheticRuns((root, measured) => {
      const upstreamRef = measured.runs.find(
        run => run.implementation === 'upstream-baseline'
      )
      if (upstreamRef === undefined) throw new Error('Synthetic upstream run is missing')
      const raw = JSON.parse(
        readFileSync(resolve(root, upstreamRef.path), 'utf8')
      ) as unknown as { provenance: Record<string, unknown> }
      raw.provenance.sampleLifecycle = 'one-application-profile-per-run'
      const source = `${JSON.stringify(raw, null, 2)}\n`
      writeFileSync(resolve(root, upstreamRef.path), source)
      upstreamRef.sha256 = sha256(source)

      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/sample lifecycle.*fresh application profile per observation/i)
    })
  })

  it.each(scheduleFailureCases)('rejects $name', ({ mutate, message }) => {
    withSyntheticRuns((root, measured, upstreamPath) => {
      const upstreamRef = measured.runs.find(run => run.path === upstreamPath)
      if (upstreamRef === undefined) throw new Error('Synthetic upstream run is missing')
      const raw = JSON.parse(
        readFileSync(resolve(root, upstreamPath), 'utf8')
      ) as MutableScheduleRawRun
      mutate(raw)
      const source = `${JSON.stringify(raw, null, 2)}\n`
      writeFileSync(resolve(root, upstreamPath), source)
      upstreamRef.sha256 = sha256(source)

      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(message)
    })
  })

  it('validates complete synthetic raw runs but refuses uncalibrated ratification', () => {
    withSyntheticRuns((root, measured) => {
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .not.toThrow()
      expect(() => requireCriticMarkupPerformanceEvidenceForRatification(
        root,
        measured,
        {
          path: 'specs/baselines/runs/performance/absent-calibration.json',
          sha256: '0'.repeat(64)
        }
      )).toThrow(/t_present.*calibration/i)

      const calibratedTargets = JSON.parse(targetsSource) as {
        metrics: {
          t_present: { targetP95Ms: number | null, targetStatus: string }
        }
      }
      calibratedTargets.metrics.t_present.targetP95Ms = 50
      calibratedTargets.metrics.t_present.targetStatus = 'frozen'
      const calibratedSource = `${JSON.stringify(calibratedTargets, null, 2)}\n`
      writeFileSync(resolve(root, measured.targetManifest.path), calibratedSource)
      measured.targetManifest.sha256 = sha256(calibratedSource)
      const calibration = writeCriticMarkupPerformanceCalibrationReport(
        root,
        measured,
        'specs/baselines/runs/performance/synthetic-ratification-calibration.json'
      )

      const summary = requireCriticMarkupPerformanceEvidenceForRatification(
        root,
        measured,
        calibration.ref
      )
      expect(summary).toMatchObject({
        schema: 'marktext-criticmarkup-performance-ratification-evidence-v2',
        provenance: {
          baselineCommit: measured.baselineCommit,
          targetManifest: measured.targetManifest,
          representativeDocuments: measured.representativeDocuments,
          rawRuns: measured.runs,
          calibrationReport: calibration.ref,
          calibrationRowsSha256: expect.stringMatching(/^[0-9a-f]{64}$/u)
        },
        rowsSha256: expect.stringMatching(/^[0-9a-f]{64}$/u)
      })
      expect(summary.rows).toHaveLength(55)
      expect(first(summary.rows)).toMatchObject({
        runId: 'upstream-baseline-synthetic-validator-fixture',
        implementation: 'upstream-baseline',
        documentId: 'all-blocks',
        metric: 't_echo',
        targetP95Ms: 16.7,
        meetsTarget: true
      })
      expect(first(summary.rows).p95Ms).toBeCloseTo(1.189)
    })
  })

  it('rejects ratification evidence when any Core calibration row misses its target', () => {
    withSyntheticRuns((root, measured) => {
      const calibratedTargets = JSON.parse(targetsSource) as {
        metrics: {
          t_present: { targetP95Ms: number | null, targetStatus: string }
        }
      }
      calibratedTargets.metrics.t_present.targetP95Ms = 5
      calibratedTargets.metrics.t_present.targetStatus = 'frozen'
      const calibratedSource = `${JSON.stringify(calibratedTargets, null, 2)}\n`
      writeFileSync(resolve(root, measured.targetManifest.path), calibratedSource)
      measured.targetManifest.sha256 = sha256(calibratedSource)
      const calibration = writeCriticMarkupPerformanceCalibrationReport(
        root,
        measured,
        'specs/baselines/runs/performance/core-miss-calibration.json'
      )

      expect(() => requireCriticMarkupPerformanceEvidenceForRatification(
        root,
        measured,
        calibration.ref
      )).toThrow(/Core performance target misses.*t_present/i)
    })
  })

  it('rejects an authenticated calibration report that differs from raw evidence', () => {
    withSyntheticRuns((root, measured) => {
      const calibratedTargets = JSON.parse(targetsSource) as {
        metrics: {
          t_present: { targetP95Ms: number | null, targetStatus: string }
        }
      }
      calibratedTargets.metrics.t_present.targetP95Ms = 50
      calibratedTargets.metrics.t_present.targetStatus = 'frozen'
      const calibratedSource = `${JSON.stringify(calibratedTargets, null, 2)}\n`
      writeFileSync(resolve(root, measured.targetManifest.path), calibratedSource)
      measured.targetManifest.sha256 = sha256(calibratedSource)
      const calibration = writeCriticMarkupPerformanceCalibrationReport(
        root,
        measured,
        'specs/baselines/runs/performance/forged-calibration.json'
      )
      const forged = JSON.parse(JSON.stringify(calibration.report)) as {
        rows: Array<{ timeOrder: { firstMs: number } }>
      }
      const firstRow = first(forged.rows)
      firstRow.timeOrder.firstMs += 1
      const forgedSource = `${JSON.stringify(forged, null, 2)}\n`
      writeFileSync(resolve(root, calibration.ref.path), forgedSource)

      expect(() => requireCriticMarkupPerformanceEvidenceForRatification(
        root,
        measured,
        { path: calibration.ref.path, sha256: sha256(forgedSource) }
      )).toThrow(/calibration report differs from the validated raw evidence/i)
    })
  })

  it('requires a canonical performance-run path and full calibration digest', () => {
    withSyntheticRuns((root, measured) => {
      const calibratedTargets = JSON.parse(targetsSource) as {
        metrics: {
          t_present: { targetP95Ms: number | null, targetStatus: string }
        }
      }
      calibratedTargets.metrics.t_present.targetP95Ms = 50
      calibratedTargets.metrics.t_present.targetStatus = 'frozen'
      const calibratedSource = `${JSON.stringify(calibratedTargets, null, 2)}\n`
      writeFileSync(resolve(root, measured.targetManifest.path), calibratedSource)
      measured.targetManifest.sha256 = sha256(calibratedSource)
      const calibration = writeCriticMarkupPerformanceCalibrationReport(
        root,
        measured,
        'specs/baselines/runs/performance/canonical-calibration.json'
      )

      expect(() => requireCriticMarkupPerformanceEvidenceForRatification(
        root,
        measured,
        {
          ...calibration.ref,
          path: calibration.ref.path.replace(
            '/canonical-calibration.json',
            '/nested/../canonical-calibration.json'
          )
        }
      )).toThrow(/calibration report must be canonical/i)
      expect(() => requireCriticMarkupPerformanceEvidenceForRatification(
        root,
        measured,
        { path: calibration.ref.path, sha256: 'abc123' }
      )).toThrow(/calibration report digest must be a lowercase SHA-256 digest/i)
    })
  })

  it('rejects stale t_frame raw samples instead of silently admitting them', () => {
    withSyntheticRuns((root, measured) => {
      const upstreamRef = measured.runs.find(
        run => run.implementation === 'upstream-baseline'
      )
      if (upstreamRef === undefined) throw new Error('Synthetic upstream run is missing')
      const raw = JSON.parse(
        readFileSync(resolve(root, upstreamRef.path), 'utf8')
      ) as unknown as {
        documents: Array<{ measured: Record<string, number[]> }>
      }
      const measuredSamples = first(raw.documents).measured
      measuredSamples.t_frame = measuredSamples.t_present ?? []
      delete measuredSamples.t_present
      const source = `${JSON.stringify(raw, null, 2)}\n`
      writeFileSync(resolve(root, upstreamRef.path), source)
      upstreamRef.sha256 = sha256(source)

      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/metrics must be exactly.*t_present/i)
    })
  })

  it('requires the composite committed upstream launcher digest', () => {
    withGitAuthenticatedUpstreamRun((root, measured, upstream, update, launcherSource) => {
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .not.toThrow()

      upstream.provenance.launcherSha256 = sha256(launcherSource)
      update(upstream)
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/launcher digest differs from its harness commit/i)
    })
  })

  it('authenticates the upstream hidden policy as producer code', () => {
    withGitAuthenticatedUpstreamRun((
      root,
      measured,
      upstream,
      update,
      _launcherSource,
      producerSources
    ) => {
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .not.toThrow()

      upstream.provenance.producerSha256 = compositeSha256(
        producerSources.filter((_source, index) => index !== 4)
      )
      update(upstream)
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/producer digest differs from its harness commit/i)
    })
  })

  it('authenticates the shared Chromium scheduling policy as upstream producer code', () => {
    withGitAuthenticatedUpstreamRun((
      root,
      measured,
      upstream,
      update,
      _launcherSource,
      producerSources
    ) => {
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .not.toThrow()

      upstream.provenance.producerSha256 = compositeSha256(
        producerSources.filter((_source, index) => index !== 8)
      )
      update(upstream)
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/producer digest differs from its harness commit/i)
    })
  })

  it('authenticates the fresh-observation lifecycle as upstream producer code', () => {
    withGitAuthenticatedUpstreamRun((
      root,
      measured,
      upstream,
      update,
      _launcherSource,
      producerSources
    ) => {
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .not.toThrow()

      upstream.provenance.producerSha256 = compositeSha256(
        producerSources.filter((_source, index) => index !== 6)
      )
      update(upstream)
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/producer digest differs from its harness commit/i)
    })
  })

  it('authenticates the rotating observation schedule as upstream producer code', () => {
    withGitAuthenticatedUpstreamRun((
      root,
      measured,
      upstream,
      update,
      _launcherSource,
      producerSources
    ) => {
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .not.toThrow()

      upstream.provenance.producerSha256 = compositeSha256(
        producerSources.filter((_source, index) => index !== 7)
      )
      update(upstream)
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/producer digest differs from its harness commit/i)
    })
  })

  it('authenticates the shared compositor checkpoint as upstream producer code', () => {
    withGitAuthenticatedUpstreamRun((
      root,
      measured,
      upstream,
      update,
      _launcherSource,
      producerSources
    ) => {
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .not.toThrow()

      upstream.provenance.producerSha256 = compositeSha256(
        producerSources.slice(0, -1)
      )
      update(upstream)
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/producer digest differs from its harness commit/i)
    })
  })

  it('rejects upstream evidence without the authenticated Chromium scheduling policy', () => {
    withSyntheticRuns((root, measured) => {
      const upstreamRef = measured.runs.find(
        run => run.implementation === 'upstream-baseline'
      )
      if (upstreamRef === undefined) throw new Error('Synthetic upstream run is missing')
      const raw = JSON.parse(
        readFileSync(resolve(root, upstreamRef.path), 'utf8')
      ) as unknown as { provenance: Record<string, unknown> }
      raw.provenance.chromiumSchedulingPolicy = 'hidden-unthrottled-rendering-v1'
      const source = `${JSON.stringify(raw, null, 2)}\n`
      writeFileSync(resolve(root, upstreamRef.path), source)
      upstreamRef.sha256 = sha256(source)

      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/Chromium scheduling/i)
    })
  })

  it.each([
    [
      'launchBoundary',
      'external-inspector-transparent-render-active-v2',
      /launch boundary/i
    ],
    [
      'windowPresentationPolicy',
      'transparent-render-active-inactive-v4',
      /window presentation policy/i
    ],
    ['windowPresentationPlatform', 'linux', /window presentation platform/i]
  ] as const)('rejects upstream evidence with stale %s provenance', (
    field,
    value,
    message
  ) => {
    withSyntheticRuns((root, measured) => {
      const upstreamRef = measured.runs.find(
        run => run.implementation === 'upstream-baseline'
      )
      if (upstreamRef === undefined) throw new Error('Synthetic upstream run is missing')
      const raw = JSON.parse(
        readFileSync(resolve(root, upstreamRef.path), 'utf8')
      ) as unknown as { provenance: Record<string, unknown> }
      raw.provenance[field] = value
      const source = `${JSON.stringify(raw, null, 2)}\n`
      writeFileSync(resolve(root, upstreamRef.path), source)
      upstreamRef.sha256 = sha256(source)

      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(message)
    })
  })

  it('rejects Core v12 evidence without exact per-document authority metadata', () => {
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

  it('rejects Core v12 evidence without authenticated build provenance', () => {
    withSyntheticRuns((root, measured) => {
      const coreRef = measured.runs.find(run => run.implementation === 'core-candidate')
      if (coreRef === undefined) throw new Error('Synthetic Core run is missing')
      const raw = JSON.parse(
        readFileSync(resolve(root, coreRef.path), 'utf8')
      ) as unknown as { provenance?: unknown }
      delete raw.provenance
      const source = `${JSON.stringify(raw, null, 2)}\n`
      writeFileSync(resolve(root, coreRef.path), source)
      coreRef.sha256 = sha256(source)
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/provenance/i)
    })
  })

  it.each([
    ['checkoutClean', false, /clean checkout/i],
    ['checkoutHead', 'b'.repeat(40), /checkout head/i],
    ['packageArtifactSha256', 'not-a-digest', /lowercase SHA-256/i],
    ['measurementBoundary', 'legacy-core-timing', /measurement boundary/i],
    ['presentationBoundary', 'request-animation-frame', /presentation boundary/i],
    [
      'launchBoundary',
      'playwright-electron-packaged-transparent-v2',
      /launch boundary/i
    ],
    [
      'windowPresentationPolicy',
      'transparent-render-active-inactive-v4',
      /window presentation policy/i
    ],
    ['windowPresentationPlatform', 'linux', /window presentation platform/i],
    [
      'chromiumSchedulingPolicy',
      'default-background-scheduling',
      /Chromium scheduling/i
    ]
  ] as const)('rejects unauthenticated Core %s provenance', (
    field,
    value,
    message
  ) => {
    withSyntheticRuns((root, measured) => {
      const coreRef = measured.runs.find(run => run.implementation === 'core-candidate')
      if (coreRef === undefined) throw new Error('Synthetic Core run is missing')
      const raw = JSON.parse(
        readFileSync(resolve(root, coreRef.path), 'utf8')
      ) as unknown as { provenance: Record<string, unknown> }
      raw.provenance[field] = value
      const source = `${JSON.stringify(raw, null, 2)}\n`
      writeFileSync(resolve(root, coreRef.path), source)
      coreRef.sha256 = sha256(source)
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(message)
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
      first(raw.documents).measured.t_echo?.pop()
      const source = `${JSON.stringify(raw, null, 2)}\n`
      writeFileSync(resolve(root, rawPath), source)
      firstRun.sha256 = sha256(source)
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/t_echo .*measured sample count must be 200/)
    })
  })

  it('requires exactly one raw run for each implementation', () => {
    withSyntheticRuns((root, measured) => {
      const duplicate = structuredClone(first(measured.runs))
      duplicate.id = `${duplicate.id}-duplicate`
      measured.runs.push(duplicate)
      expect(() => validateCriticMarkupPerformanceMeasurements(root, measured))
        .toThrow(/exactly one run for upstream-baseline/i)
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
