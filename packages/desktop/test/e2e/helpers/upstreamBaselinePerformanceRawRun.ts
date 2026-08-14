import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, normalize, sep } from 'node:path'

import {
  PERFORMANCE_CHROMIUM_SCHEDULING_POLICY,
  PERFORMANCE_WINDOW_PRESENTATION_POLICY
} from './performanceChromiumLaunchPolicy'
import {
  PERFORMANCE_PRESENTATION_BOUNDARY
} from './performancePresentationCheckpoint'
import {
  PERFORMANCE_SAMPLE_LIFECYCLE
} from './performanceSampleLifecycle'
import {
  createPerformanceObservationSchedule,
  PERFORMANCE_OBSERVATION_SCHEDULE,
  performanceObservationScheduleSha256,
  type PerformanceObservationScheduleEntry
} from './performanceObservationSchedule'

const PINNED_UPSTREAM_BASELINE =
  '43bd8b77795fb27b1a9512737c000f7362031ea0'
const RATIFICATION_SAMPLING = Object.freeze({
  warmupSamples: 20,
  measuredSamples: 200
})

export type UpstreamBaselineEvidenceClass =
  | 'ratification'
  | 'smoke-non-ratifying'

export interface UpstreamBaselinePerformanceReport {
  readonly t_echo: number
  readonly t_present: number
  readonly open: number
  readonly first_viewport: number
}

export interface UpstreamBaselinePerformanceRawSample
  extends PerformanceObservationScheduleEntry {
  readonly report: UpstreamBaselinePerformanceReport
}

export interface UpstreamBaselineBuildProvenance {
  readonly detachedWorktreeHead: string
  readonly detachedWorktreeClean: boolean
  readonly harnessCommit: string
  readonly packageArtifactSha256: string
  readonly executableSha256: string
  readonly packageVersion: string
  readonly packageManager: string
  readonly nodeVersion: string
  readonly playwrightVersion: string
  readonly lockfileSha256: string
  readonly producerSha256: string
  readonly probeSha256: string
  readonly launcherSha256: string
  readonly measurementBoundary: 'external-browser-compositor-v4'
  readonly presentationBoundary: typeof PERFORMANCE_PRESENTATION_BOUNDARY
  readonly launchBoundary: 'external-inspector-transparent-render-active-v3'
  readonly windowPresentationPolicy: typeof PERFORMANCE_WINDOW_PRESENTATION_POLICY
  readonly windowPresentationPlatform: 'darwin'
  readonly chromiumSchedulingPolicy: 'hidden-unthrottled-rendering-v2'
  readonly sampleLifecycle: typeof PERFORMANCE_SAMPLE_LIFECYCLE
  readonly applicationLaunchCount: number
  readonly uniqueProfileCount: number
  readonly applicationCloseCount: number
  readonly profileCleanupCount: number
  readonly observationSchedule: typeof PERFORMANCE_OBSERVATION_SCHEDULE
  readonly observationScheduleSha256: string
}

export interface UpstreamBaselinePerformanceRawRunInput {
  readonly evidenceClass: UpstreamBaselineEvidenceClass
  readonly runId: string
  readonly baselineCommit: string
  readonly buildCommit: string
  readonly measuredAt: string
  readonly environment: Readonly<Record<string, string>>
  readonly sampling: Readonly<{
    readonly warmupSamples: number
    readonly measuredSamples: number
  }>
  readonly documents: readonly Readonly<{
    readonly id: string
    readonly sourceSha256: string
  }>[]
  readonly provenance: UpstreamBaselineBuildProvenance
  readonly samples: readonly UpstreamBaselinePerformanceRawSample[]
}

type Metric = keyof UpstreamBaselinePerformanceReport
type Distribution = Readonly<Record<Metric, readonly number[]>>

interface UpstreamBaselinePerformanceDocumentRun {
  readonly id: string
  readonly sourceSha256: string
  readonly warmup: Distribution
  readonly measured: Distribution
}

interface UpstreamBaselinePerformanceRawRunBase {
  readonly runId: string
  readonly implementation: 'upstream-baseline'
  readonly baselineCommit: string
  readonly buildCommit: string
  readonly measuredAt: string
  readonly environment: Readonly<Record<string, string>>
  readonly sampling: Readonly<{
    readonly warmupSamples: number
    readonly measuredSamples: number
  }>
  readonly provenance: Readonly<UpstreamBaselineBuildProvenance>
  readonly metricDefinitions: Readonly<Record<Metric, string>>
  readonly observationOrder: readonly Readonly<PerformanceObservationScheduleEntry>[]
  readonly documents: readonly UpstreamBaselinePerformanceDocumentRun[]
}

export interface UpstreamBaselinePerformanceRatificationRun
  extends UpstreamBaselinePerformanceRawRunBase {
  readonly schema: 'marktext-criticmarkup-raw-performance-run-v11'
}

export interface UpstreamBaselinePerformanceSmokeRun
  extends UpstreamBaselinePerformanceRawRunBase {
  readonly schema: 'marktext-criticmarkup-raw-performance-smoke-v11'
  readonly evidenceClass: 'smoke-non-ratifying'
}

export type UpstreamBaselinePerformanceRawRun =
  | UpstreamBaselinePerformanceRatificationRun
  | UpstreamBaselinePerformanceSmokeRun

const METRIC_DEFINITIONS = Object.freeze({
  t_echo: 'Elapsed time from beforeinput to the exact matching Muya DOM state.',
  t_present: 'Elapsed time from beforeinput through Electron WebContents.capturePage with stayHidden and stayAwake after the exact matching Muya DOM state in the transparent, render-active, inactive measurement window, followed by immediate retained-state validation; a captured compositor-surface upper bound, not pixel equality, physical display, vsync, or next-frame evidence.',
  open: 'External elapsed time from file-open request until its tab is active.',
  first_viewport: 'External elapsed time from file-open request until its editor is editable.'
}) satisfies Readonly<Record<Metric, string>>

const requireIdentity = (value: string, units: number, label: string): void => {
  if (!new RegExp(`^[0-9a-f]{${String(units)}}$`, 'u').test(value)) {
    throw new Error(`${label} is invalid`)
  }
}

const requireNonEmpty = (value: string, label: string): void => {
  if (!value.trim()) throw new Error(`${label} is required`)
}

const emptyDistribution = (): Record<Metric, number[]> => ({
  t_echo: [],
  t_present: [],
  open: [],
  first_viewport: []
})

const freezeDistribution = (
  distribution: Record<Metric, number[]>
): Distribution => Object.freeze({
  t_echo: Object.freeze([...distribution.t_echo]),
  t_present: Object.freeze([...distribution.t_present]),
  open: Object.freeze([...distribution.open]),
  first_viewport: Object.freeze([...distribution.first_viewport])
})

const validateReport = (
  report: UpstreamBaselinePerformanceReport,
  label: string
): void => {
  const metricNames = Object.keys(report).sort()
  const expectedNames = Object.keys(METRIC_DEFINITIONS).sort()
  if (JSON.stringify(metricNames) !== JSON.stringify(expectedNames)) {
    throw new Error(`${label} metrics must be exactly: ${expectedNames.join(', ')}`)
  }
  const values = Object.values(report)
  if (values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error(`${label} contains an invalid timing`)
  }
  if (
    report.t_present < report.t_echo ||
    report.first_viewport < report.open
  ) {
    throw new Error(`${label} timing order is invalid`)
  }
}

const validateProvenance = (
  input: UpstreamBaselinePerformanceRawRunInput
): void => {
  if (input.baselineCommit !== PINNED_UPSTREAM_BASELINE) {
    throw new Error('Raw performance baseline commit is not the pinned upstream baseline')
  }
  if (input.buildCommit !== input.baselineCommit) {
    throw new Error('Raw performance build commit must equal the pinned baseline')
  }
  if (input.provenance.detachedWorktreeHead !== input.baselineCommit) {
    throw new Error('Detached worktree head must equal the pinned baseline')
  }
  if (!input.provenance.detachedWorktreeClean) {
    throw new Error('Detached upstream worktree must be clean')
  }
  requireIdentity(input.provenance.harnessCommit, 40, 'Harness commit')
  requireIdentity(
    input.provenance.packageArtifactSha256,
    64,
    'Package artifact digest'
  )
  requireIdentity(input.provenance.executableSha256, 64, 'Executable digest')
  requireNonEmpty(input.provenance.packageVersion, 'Package version')
  requireNonEmpty(input.provenance.packageManager, 'Package manager')
  requireNonEmpty(input.provenance.nodeVersion, 'Node version')
  requireNonEmpty(input.provenance.playwrightVersion, 'Playwright version')
  requireIdentity(input.provenance.lockfileSha256, 64, 'Lockfile digest')
  requireIdentity(input.provenance.producerSha256, 64, 'Producer digest')
  requireIdentity(input.provenance.probeSha256, 64, 'Probe digest')
  requireIdentity(input.provenance.launcherSha256, 64, 'Launcher digest')
  if (
    input.provenance.measurementBoundary !==
      'external-browser-compositor-v4'
  ) {
    throw new Error('Upstream measurement boundary is invalid')
  }
  if (input.provenance.presentationBoundary !== PERFORMANCE_PRESENTATION_BOUNDARY) {
    throw new Error('Upstream presentation boundary is invalid')
  }
  if (
    input.provenance.launchBoundary !==
      'external-inspector-transparent-render-active-v3'
  ) {
    throw new Error('Upstream launch boundary is invalid')
  }
  if (
    input.provenance.windowPresentationPolicy !==
      PERFORMANCE_WINDOW_PRESENTATION_POLICY
  ) {
    throw new Error('Upstream window presentation evidence is invalid')
  }
  if (input.provenance.windowPresentationPlatform !== 'darwin') {
    throw new Error('Upstream window presentation platform is invalid')
  }
  if (
    input.provenance.chromiumSchedulingPolicy !==
      PERFORMANCE_CHROMIUM_SCHEDULING_POLICY
  ) {
    throw new Error('Upstream Chromium scheduling provenance is invalid')
  }
  if (input.provenance.sampleLifecycle !== PERFORMANCE_SAMPLE_LIFECYCLE) {
    throw new Error('Upstream sample lifecycle provenance is invalid')
  }
  if (input.provenance.observationSchedule !== PERFORMANCE_OBSERVATION_SCHEDULE) {
    throw new Error('Upstream observation schedule policy is invalid')
  }
  requireIdentity(
    input.provenance.observationScheduleSha256,
    64,
    'Upstream observation schedule digest'
  )
  const expectedObservationCount = input.documents.length * (
    input.sampling.warmupSamples + input.sampling.measuredSamples
  )
  const lifecycleCounts = [
    [
      input.provenance.applicationLaunchCount,
      'application launch count'
    ],
    [input.provenance.uniqueProfileCount, 'unique profile count'],
    [input.provenance.applicationCloseCount, 'application close count'],
    [input.provenance.profileCleanupCount, 'profile cleanup count']
  ] as const
  for (const [actual, label] of lifecycleCounts) {
    if (!Number.isSafeInteger(actual) || actual !== expectedObservationCount) {
      throw new Error(
        `Upstream ${label} must equal ${String(expectedObservationCount)}`
      )
    }
  }
}

export const createUpstreamBaselinePerformanceRawRun = (
  input: UpstreamBaselinePerformanceRawRunInput
): UpstreamBaselinePerformanceRawRun => {
  requireNonEmpty(input.runId, 'Raw performance run ID')
  requireIdentity(input.baselineCommit, 40, 'Raw performance baseline commit')
  requireIdentity(input.buildCommit, 40, 'Raw performance build commit')
  if (Number.isNaN(Date.parse(input.measuredAt))) {
    throw new Error('Raw performance timestamp is invalid')
  }
  if (
    !Number.isSafeInteger(input.sampling.warmupSamples) ||
    input.sampling.warmupSamples < 1 ||
    !Number.isSafeInteger(input.sampling.measuredSamples) ||
    input.sampling.measuredSamples < 1
  ) {
    throw new Error('Raw performance sample counts must be positive integers')
  }
  if (
    input.evidenceClass === 'ratification' &&
    (input.sampling.warmupSamples !== RATIFICATION_SAMPLING.warmupSamples ||
      input.sampling.measuredSamples !== RATIFICATION_SAMPLING.measuredSamples)
  ) {
    throw new Error(
      'Ratification evidence requires exactly 20 warmup and 200 measured samples'
    )
  }
  validateProvenance(input)

  const documentsById = new Map(input.documents.map(document => [
    document.id,
    document
  ]))
  if (documentsById.size !== input.documents.length || documentsById.size === 0) {
    throw new Error('Raw performance documents must be non-empty and unique')
  }
  for (const document of input.documents) {
    requireNonEmpty(document.id, 'Raw performance document ID')
    requireIdentity(document.sourceSha256, 64, `${document.id} source digest`)
  }
  const expectedObservationOrder = createPerformanceObservationSchedule({
    documentIds: input.documents.map(document => document.id),
    ...input.sampling
  })
  if (input.samples.length !== expectedObservationOrder.length) {
    throw new Error(
      'Raw performance observation schedule expected ' +
      `${String(expectedObservationOrder.length)} entries but received ` +
      String(input.samples.length)
    )
  }
  const scheduleKeys = [
    'ordinal',
    'phase',
    'phaseRound',
    'roundPosition',
    'documentId'
  ] as const
  for (const [index, expected] of expectedObservationOrder.entries()) {
    const actual = input.samples[index]
    if (
      actual === undefined ||
      scheduleKeys.some(key => actual[key] !== expected[key])
    ) {
      throw new Error(
        `Raw performance observation schedule mismatch at ordinal ${String(expected.ordinal)}`
      )
    }
  }
  const expectedScheduleSha256 = performanceObservationScheduleSha256(
    expectedObservationOrder
  )
  if (input.provenance.observationScheduleSha256 !== expectedScheduleSha256) {
    throw new Error(
      'Upstream observation schedule digest does not match documents and sampling'
    )
  }
  const samplesByDocument = new Map<string, UpstreamBaselinePerformanceRawSample[]>()
  for (const candidate of input.samples) {
    if (!documentsById.has(candidate.documentId)) {
      throw new Error(
        `Raw performance sample names an unknown document: ${candidate.documentId}`
      )
    }
    const samples = samplesByDocument.get(candidate.documentId) ?? []
    samples.push(candidate)
    samplesByDocument.set(candidate.documentId, samples)
  }

  const documents = input.documents.map(document => {
    const warmup = emptyDistribution()
    const measured = emptyDistribution()
    for (const candidate of samplesByDocument.get(document.id) ?? []) {
      validateReport(candidate.report, `${document.id} ${candidate.phase} sample`)
      const distribution = candidate.phase === 'warmup' ? warmup : measured
      for (const metric of Object.keys(distribution) as Metric[]) {
        distribution[metric].push(candidate.report[metric])
      }
    }
    if (warmup.open.length !== input.sampling.warmupSamples) {
      throw new Error(
        `${document.id} warmup sample count must be ` +
        String(input.sampling.warmupSamples)
      )
    }
    if (measured.open.length !== input.sampling.measuredSamples) {
      throw new Error(
        `${document.id} measured sample count must be ` +
        String(input.sampling.measuredSamples)
      )
    }
    return Object.freeze({
      id: document.id,
      sourceSha256: document.sourceSha256,
      warmup: freezeDistribution(warmup),
      measured: freezeDistribution(measured)
    })
  })

  const base: UpstreamBaselinePerformanceRawRunBase = Object.freeze({
    runId: input.runId,
    implementation: 'upstream-baseline',
    baselineCommit: input.baselineCommit,
    buildCommit: input.buildCommit,
    measuredAt: input.measuredAt,
    environment: Object.freeze({ ...input.environment }),
    sampling: Object.freeze({ ...input.sampling }),
    provenance: Object.freeze({ ...input.provenance }),
    metricDefinitions: METRIC_DEFINITIONS,
    observationOrder: expectedObservationOrder,
    documents: Object.freeze(documents)
  })
  return input.evidenceClass === 'ratification'
    ? Object.freeze({
      schema: 'marktext-criticmarkup-raw-performance-run-v11' as const,
      ...base
    })
    : Object.freeze({
      schema: 'marktext-criticmarkup-raw-performance-smoke-v11' as const,
      evidenceClass: 'smoke-non-ratifying' as const,
      ...base
    })
}

const isRatificationDirectory = (outputPath: string): boolean => {
  const marker = [
    'specs',
    'baselines',
    'runs',
    'performance'
  ].join(sep)
  return normalize(outputPath).split(sep).join(sep).includes(`${marker}${sep}`)
}

export const writeUpstreamBaselinePerformanceRawRun = (
  outputPath: string,
  run: UpstreamBaselinePerformanceRawRun
): void => {
  if (
    run.schema === 'marktext-criticmarkup-raw-performance-smoke-v11' &&
    isRatificationDirectory(outputPath)
  ) {
    throw new Error('Smoke output cannot be written to the ratification directory')
  }
  if (existsSync(outputPath)) {
    throw new Error(`Refusing to replace existing performance evidence: ${outputPath}`)
  }
  mkdirSync(dirname(outputPath), { recursive: true })
  try {
    writeFileSync(outputPath, `${JSON.stringify(run, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    })
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'EEXIST'
    ) {
      throw new Error(
        `Refusing to replace existing performance evidence: ${outputPath}`
      )
    }
    throw error
  }
}
