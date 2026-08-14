import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  PERFORMANCE_OBSERVATION_SCHEDULE,
  PERFORMANCE_SAMPLE_LIFECYCLE,
  validateCriticMarkupPerformanceTargets
} from './criticmarkupPerformanceTargets'
import {
  createPerformanceObservationSchedule,
  performanceObservationScheduleSha256,
  type PerformanceObservationScheduleEntry
} from '../packages/desktop/test/e2e/helpers/performanceObservationSchedule'

const COMMON_METRICS = [
  't_echo',
  't_present',
  'open',
  'first_viewport'
] as const

const CORE_AUTHORITY_METRICS = [
  't_dispatch',
  't_ack',
  't_reconcile'
] as const

const CORE_METRICS = [
  't_echo',
  ...CORE_AUTHORITY_METRICS,
  't_present',
  'open',
  'first_viewport'
] as const

const PERFORMANCE_E2E_PREFIX = 'packages/desktop/test/e2e/'

export const CORE_PERFORMANCE_PRODUCER_PATHS = Object.freeze([
  `${PERFORMANCE_E2E_PREFIX}installed-core-performance.spec.ts`,
  `${PERFORMANCE_E2E_PREFIX}helpers/coreAuthorityPerformanceRawRun.ts`,
  `${PERFORMANCE_E2E_PREFIX}helpers/coreAuthorityPerformanceReport.ts`,
  `${PERFORMANCE_E2E_PREFIX}helpers/performanceSampleLifecycle.ts`,
  `${PERFORMANCE_E2E_PREFIX}helpers/performanceObservationSchedule.ts`,
  `${PERFORMANCE_E2E_PREFIX}installedArtifactProvenance.ts`,
  `${PERFORMANCE_E2E_PREFIX}playwright.installed-core-performance.config.ts`,
  `${PERFORMANCE_E2E_PREFIX}helpers/performanceChromiumLaunchPolicy.ts`,
  `${PERFORMANCE_E2E_PREFIX}helpers/performancePresentationCheckpoint.ts`
] as const)

export const UPSTREAM_PERFORMANCE_PRODUCER_PATHS = Object.freeze([
  `${PERFORMANCE_E2E_PREFIX}upstream-baseline-performance.spec.ts`,
  `${PERFORMANCE_E2E_PREFIX}helpers/upstreamBaselinePerformanceRawRun.ts`,
  `${PERFORMANCE_E2E_PREFIX}helpers/upstreamBaselineEnvironment.ts`,
  `${PERFORMANCE_E2E_PREFIX}playwright.upstream-baseline-performance.config.ts`,
  `${PERFORMANCE_E2E_PREFIX}helpers/upstreamBaselineHiddenPolicy.ts`,
  `${PERFORMANCE_E2E_PREFIX}helpers/upstreamBaselineLifecycleCleanup.ts`,
  `${PERFORMANCE_E2E_PREFIX}helpers/performanceSampleLifecycle.ts`,
  `${PERFORMANCE_E2E_PREFIX}helpers/performanceObservationSchedule.ts`,
  `${PERFORMANCE_E2E_PREFIX}helpers/performanceChromiumLaunchPolicy.ts`,
  `${PERFORMANCE_E2E_PREFIX}helpers/performancePresentationCheckpoint.ts`
] as const)

type CommonMetric = typeof COMMON_METRICS[number]
type CoreAuthorityMetric = typeof CORE_AUTHORITY_METRICS[number]
type PerformanceMetric = CommonMetric | CoreAuthorityMetric
type PerformanceImplementation = 'upstream-baseline' | 'core-candidate'

const REQUIRED_IMPLEMENTATIONS: readonly PerformanceImplementation[] = [
  'upstream-baseline',
  'core-candidate'
]

export interface CriticMarkupPerformanceArtifactRef {
  path: string
  sha256: string
}

export interface CriticMarkupRawPerformanceRunRef
  extends CriticMarkupPerformanceArtifactRef {
  id: string
  implementation: PerformanceImplementation
}

export interface CriticMarkupPerformanceMeasurementManifest {
  schema: 'marktext-criticmarkup-performance-measurements-v12'
  status: 'awaiting-raw-runs' | 'measured-unratified'
  baselineCommit: string
  targetManifest: CriticMarkupPerformanceArtifactRef
  representativeDocuments: CriticMarkupPerformanceArtifactRef
  requiredMetrics: Record<PerformanceImplementation, PerformanceMetric[]>
  requiredImplementations: PerformanceImplementation[]
  runs: CriticMarkupRawPerformanceRunRef[]
}

export type CriticMarkupPerformanceSamples = Partial<Record<PerformanceMetric, number[]>>

interface CriticMarkupRawPerformanceRunBase {
  runId: string
  implementation: PerformanceImplementation
  baselineCommit: string
  buildCommit: string
  measuredAt: string
  environment: Record<string, string>
  sampling: {
    warmupSamples: number
    measuredSamples: number
  }
  observationOrder: readonly Readonly<PerformanceObservationScheduleEntry>[]
  documents: Array<{
    id: string
    sourceSha256: string
    warmup: CriticMarkupPerformanceSamples
    measured: CriticMarkupPerformanceSamples
  }>
}

export interface CriticMarkupUpstreamRawPerformanceRunV11
  extends CriticMarkupRawPerformanceRunBase {
  schema: 'marktext-criticmarkup-raw-performance-run-v11'
  provenance: CriticMarkupUpstreamPerformanceProvenance
  metricDefinitions: Record<CommonMetric, string>
}

export type CriticMarkupPerformanceSurface = 'wysiwyg' | 'source'

export interface CriticMarkupCoreRawPerformanceRunV13
  extends Omit<CriticMarkupRawPerformanceRunBase, 'implementation' | 'documents'> {
  schema: 'marktext-criticmarkup-raw-performance-run-v13'
  implementation: 'core-candidate'
  surfaces: CriticMarkupPerformanceSurface[]
  provenance: CriticMarkupCorePerformanceProvenance
  documents: Array<{
    id: string
    sourceSha256: string
    surface: CriticMarkupPerformanceSurface
    warmup: CriticMarkupPerformanceSamples
    measured: CriticMarkupPerformanceSamples
    authorityEvidence: {
      warmup: CriticMarkupPerformanceAuthoritySamples
      measured: CriticMarkupPerformanceAuthoritySamples
    }
  }>
}

export interface CriticMarkupCorePerformanceProvenance {
  checkoutHead: string
  checkoutClean: boolean
  harnessCommit: string
  packageArtifactSha256: string
  executableSha256: string
  packageVersion: string
  packageManager: string
  nodeVersion: string
  playwrightVersion: string
  lockfileSha256: string
  producerSha256: string
  probeSha256: string
  launcherSha256: string
  measurementBoundary: 'core-authority-browser-compositor-v6'
  presentationBoundary: 'electron-webcontents-capture-page-transparent-v2'
  launchBoundary: 'playwright-electron-packaged-transparent-v3'
  windowPresentationPolicy: 'transparent-render-active-inactive-v6'
  windowPresentationPlatform: 'darwin'
  chromiumSchedulingPolicy: 'hidden-unthrottled-rendering-v2'
  sampleLifecycle: typeof PERFORMANCE_SAMPLE_LIFECYCLE
  applicationLaunchCount: number
  uniqueProfileCount: number
  applicationCloseCount: number
  profileCleanupCount: number
  observationSchedule: typeof PERFORMANCE_OBSERVATION_SCHEDULE
  observationScheduleSha256: string
}

export interface CriticMarkupUpstreamPerformanceProvenance {
  detachedWorktreeHead: string
  detachedWorktreeClean: boolean
  harnessCommit: string
  packageArtifactSha256: string
  executableSha256: string
  packageVersion: string
  packageManager: string
  nodeVersion: string
  playwrightVersion: string
  lockfileSha256: string
  producerSha256: string
  probeSha256: string
  launcherSha256: string
  measurementBoundary: 'external-browser-compositor-v4'
  presentationBoundary: 'electron-webcontents-capture-page-transparent-v2'
  launchBoundary: 'external-inspector-transparent-render-active-v3'
  windowPresentationPolicy: 'transparent-render-active-inactive-v6'
  windowPresentationPlatform: 'darwin'
  chromiumSchedulingPolicy: 'hidden-unthrottled-rendering-v2'
  sampleLifecycle: typeof PERFORMANCE_SAMPLE_LIFECYCLE
  applicationLaunchCount: number
  uniqueProfileCount: number
  applicationCloseCount: number
  profileCleanupCount: number
  observationSchedule: typeof PERFORMANCE_OBSERVATION_SCHEDULE
  observationScheduleSha256: string
}

export interface CriticMarkupPerformanceAuthoritySamples {
  pendingDepthMaximum: number[]
  correctionCount: number[]
}

export type CriticMarkupRawPerformanceRun =
  | CriticMarkupUpstreamRawPerformanceRunV11
  | CriticMarkupCoreRawPerformanceRunV13

interface PerformanceTargets {
  schema: 'marktext-criticmarkup-performance-targets-v9'
  status: 'proposed-unratified' | 'ratified'
  representativeDocuments: { schema: string, path: string }
  environment: Record<string, string>
  sampling: {
    warmupSamples: number
    measuredSamples: number
    sampleLifecycle: typeof PERFORMANCE_SAMPLE_LIFECYCLE
    observationSchedule: typeof PERFORMANCE_OBSERVATION_SCHEDULE
    percentiles: number[]
  }
  metrics: Record<PerformanceMetric, {
    targetP95Ms: number | null
    targetStatus?: 'baseline-calibration-required' | 'frozen'
  }>
}

interface RepresentativeDocuments {
  schema: 'marktext-criticmarkup-representative-documents-v1'
  status: 'proposed-unratified'
  documents: Array<{ id: string, sha256: string }>
}

export interface CriticMarkupPerformanceP95Row {
  readonly runId: string
  readonly implementation: PerformanceImplementation
  readonly documentId: string
  readonly metric: PerformanceMetric
  readonly p95Ms: number
  readonly targetP95Ms: number
  readonly meetsTarget: boolean
}

export interface CriticMarkupPerformanceRatificationEvidence {
  readonly schema: 'marktext-criticmarkup-performance-ratification-evidence-v2'
  readonly provenance: {
    readonly baselineCommit: string
    readonly targetManifest: Readonly<CriticMarkupPerformanceArtifactRef>
    readonly representativeDocuments: Readonly<CriticMarkupPerformanceArtifactRef>
    readonly rawRuns: readonly Readonly<CriticMarkupRawPerformanceRunRef>[]
    readonly calibrationReport: Readonly<CriticMarkupPerformanceArtifactRef>
    readonly calibrationRowsSha256: string
  }
  readonly rowsSha256: string
  readonly rows: readonly CriticMarkupPerformanceP95Row[]
}

export interface CriticMarkupPerformanceCalibrationRow {
  readonly runId: string
  readonly implementation: PerformanceImplementation
  readonly documentId: string
  readonly metric: PerformanceMetric
  readonly sampleCount: number
  readonly percentiles: {
    readonly p50Ms: number
    readonly p95Ms: number
    readonly p99Ms: number
  }
  readonly timeOrder: {
    readonly firstMs: number
    readonly lastMs: number
    readonly firstHalfMeanMs: number
    readonly secondHalfMeanMs: number
    readonly halfMeanDeltaMs: number
  }
}

export interface CriticMarkupPerformanceCalibrationReport {
  readonly schema: 'marktext-criticmarkup-performance-calibration-v1'
  readonly status: 'measured-unratified'
  readonly provenance: {
    readonly baselineCommit: string
    readonly targetManifest: Readonly<CriticMarkupPerformanceArtifactRef>
    readonly representativeDocuments: Readonly<CriticMarkupPerformanceArtifactRef>
    readonly rawRuns: readonly Readonly<CriticMarkupRawPerformanceRunRef>[]
  }
  readonly percentiles: readonly [50, 95, 99]
  readonly rowsSha256: string
  readonly rows: readonly CriticMarkupPerformanceCalibrationRow[]
}

export interface CriticMarkupPerformanceCalibrationMaterialization {
  readonly ref: Readonly<CriticMarkupPerformanceArtifactRef>
  readonly report: CriticMarkupPerformanceCalibrationReport
}

const sha256 = (source: Buffer): string => createHash('sha256')
  .update(source)
  .digest('hex')

const gitBlob = (repoRoot: string, commit: string, path: string): Buffer =>
  execFileSync('git', ['-C', repoRoot, 'show', `${commit}:${path}`], {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024
  })

const compositeGitDigest = (
  repoRoot: string,
  commit: string,
  paths: readonly string[]
): string => sha256(Buffer.from(paths
  .map(path => `${sha256(gitBlob(repoRoot, commit, path))}\n`)
  .join('')))

const canAuthenticateGitEvidence = (repoRoot: string): boolean => {
  try {
    return execFileSync(
      'git',
      ['-C', repoRoot, 'rev-parse', '--is-inside-work-tree'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim() === 'true'
  } catch {
    return false
  }
}

const requireHarnessDigest = (
  actual: unknown,
  expected: string,
  label: string
): void => {
  if (actual !== expected) throw new Error(`${label} differs from its harness commit`)
}

const validateHarnessDigests = (
  repoRoot: string,
  implementation: PerformanceImplementation,
  buildCommit: string,
  provenance: Record<string, unknown>,
  label: string
): void => {
  if (!canAuthenticateGitEvidence(repoRoot)) return
  const harnessCommit = requireNonEmpty(
    provenance.harnessCommit,
    `${label} harness commit`
  )
  const prefix = PERFORMANCE_E2E_PREFIX
  if (implementation === 'core-candidate') {
    requireHarnessDigest(
      provenance.lockfileSha256,
      sha256(gitBlob(repoRoot, buildCommit, 'pnpm-lock.yaml')),
      `${label} lockfile digest`
    )
    requireHarnessDigest(
      provenance.producerSha256,
      compositeGitDigest(repoRoot, harnessCommit, CORE_PERFORMANCE_PRODUCER_PATHS),
      `${label} producer digest`
    )
    requireHarnessDigest(
      provenance.probeSha256,
      compositeGitDigest(repoRoot, harnessCommit, [
        `${prefix}helpers/browserInputEventTrace.ts`,
        `${prefix}helpers/inputLatencyTrace.ts`
      ]),
      `${label} probe digest`
    )
    requireHarnessDigest(
      provenance.launcherSha256,
      sha256(gitBlob(
        repoRoot,
        harnessCommit,
        `${prefix}run-installed-core-performance.sh`
      )),
      `${label} launcher digest`
    )
    return
  }
  requireHarnessDigest(
    provenance.lockfileSha256,
    sha256(gitBlob(repoRoot, buildCommit, 'pnpm-lock.yaml')),
    `${label} lockfile digest`
  )
  requireHarnessDigest(
    provenance.producerSha256,
    compositeGitDigest(repoRoot, harnessCommit, UPSTREAM_PERFORMANCE_PRODUCER_PATHS),
    `${label} producer digest`
  )
  requireHarnessDigest(
    provenance.probeSha256,
    sha256(gitBlob(
      repoRoot,
      harnessCommit,
      `${prefix}helpers/upstreamBaselineInputProbe.ts`
    )),
    `${label} probe digest`
  )
  requireHarnessDigest(
    provenance.launcherSha256,
    compositeGitDigest(repoRoot, harnessCommit, [
      `${prefix}run-upstream-baseline-performance.sh`,
      `${prefix}helpers/upstreamBaselinePerformanceRunner.sh`
    ]),
    `${label} launcher digest`
  )
}

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

const requireNonEmpty = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value
}

const requireDigest = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`)
  }
  return value
}

const resolveRepositoryPath = (
  repoRoot: string,
  path: string,
  label: string
): string => {
  if (isAbsolute(path)) throw new Error(`${label} must be repository-relative`)
  const absolutePath = resolve(repoRoot, path)
  const withinRepository = relative(repoRoot, absolutePath)
  if (withinRepository.startsWith('..') || isAbsolute(withinRepository)) {
    throw new Error(`${label} leaves the repository`)
  }
  return absolutePath
}

const readPinnedJson = <Artifact>(
  repoRoot: string,
  ref: CriticMarkupPerformanceArtifactRef,
  label: string
): Artifact => {
  const path = requireNonEmpty(ref.path, `${label} path`)
  const absolutePath = resolveRepositoryPath(repoRoot, path, `${label} path`)
  if (!existsSync(absolutePath)) throw new Error(`${label} is absent: ${path}`)
  const source = readFileSync(absolutePath)
  if (sha256(source) !== requireDigest(ref.sha256, `${label} digest`)) {
    throw new Error(`${label} digest is stale: ${path}`)
  }
  return JSON.parse(source.toString('utf8')) as Artifact
}

const exactList = (
  actual: unknown,
  expected: readonly string[],
  label: string
): void => {
  if (!Array.isArray(actual) || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} must be exactly: ${expected.join(', ')}`)
  }
}

const validateSampleSet = (
  value: unknown,
  expectedCount: number,
  expectedMetrics: readonly PerformanceMetric[],
  label: string
): CriticMarkupPerformanceSamples => {
  const samples = requireRecord(value, label)
  exactList(Object.keys(samples).sort(), [...expectedMetrics].sort(), `${label} metrics`)
  for (const metric of expectedMetrics) {
    const values = samples[metric]
    if (!Array.isArray(values) || values.length !== expectedCount) {
      throw new Error(`${metric} ${label} sample count must be ${expectedCount}`)
    }
    if (values.some(sample => (
      typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0
    ))) {
      throw new Error(`${metric} ${label} samples must be finite non-negative numbers`)
    }
  }
  const typed = samples as CriticMarkupPerformanceSamples
  for (let index = 0; index < expectedCount; index += 1) {
    if ((typed.t_present?.[index] ?? 0) < (typed.t_echo?.[index] ?? 0)) {
      throw new Error(
        `${label} sample ${index} presents before exact browser echo`
      )
    }
    if (
      expectedMetrics.includes('t_dispatch') &&
      (typed.t_ack?.[index] ?? 0) < (typed.t_dispatch?.[index] ?? 0)
    ) {
      throw new Error(`${label} sample ${index} acknowledges before dispatch`)
    }
    if (
      expectedMetrics.includes('t_reconcile') &&
      (typed.t_reconcile?.[index] ?? 0) < (typed.t_ack?.[index] ?? 0)
    ) {
      throw new Error(`${label} sample ${index} reconciles before acknowledgement`)
    }
    if ((typed.first_viewport?.[index] ?? 0) < (typed.open?.[index] ?? 0)) {
      throw new Error(`${label} sample ${index} makes the viewport editable before open`)
    }
  }
  return typed
}

const validateObservationLifecycle = (
  provenance: Record<string, unknown>,
  expectedObservationCount: number,
  label: string
): void => {
  if (provenance.sampleLifecycle !== PERFORMANCE_SAMPLE_LIFECYCLE) {
    throw new Error(
      `${label} provenance sample lifecycle must use a fresh application profile per observation`
    )
  }
  for (const field of [
    'applicationLaunchCount',
    'uniqueProfileCount',
    'applicationCloseCount',
    'profileCleanupCount'
  ] as const) {
    if (
      !Number.isSafeInteger(provenance[field]) ||
      provenance[field] !== expectedObservationCount
    ) {
      throw new Error(
        `${label} provenance ${field} must equal ${expectedObservationCount} observations`
      )
    }
  }
}

const validateObservationSchedule = (
  raw: Record<string, unknown>,
  provenance: Record<string, unknown>,
  expected: readonly Readonly<PerformanceObservationScheduleEntry>[],
  label: string
): void => {
  if (provenance.observationSchedule !== PERFORMANCE_OBSERVATION_SCHEDULE) {
    throw new Error(
      `${label} provenance observation schedule must use warmup then measured rotating round robin`
    )
  }
  const expectedDigest = performanceObservationScheduleSha256(expected)
  const actualDigest = requireDigest(
    provenance.observationScheduleSha256,
    `${label} provenance observation schedule digest`
  )
  if (actualDigest !== expectedDigest) {
    throw new Error(`${label} provenance observation schedule digest is stale`)
  }
  if (!Array.isArray(raw.observationOrder)) {
    throw new Error(`${label} observation order must be an array`)
  }
  if (raw.observationOrder.length !== expected.length) {
    throw new Error(
      `${label} observation order must contain exactly ${String(expected.length)} entries`
    )
  }
  const keys = [
    'documentId',
    'ordinal',
    'phase',
    'phaseRound',
    'roundPosition'
  ] as const
  const comparisonKeys = [
    'ordinal',
    'phase',
    'phaseRound',
    'roundPosition',
    'documentId'
  ] as const
  const ordinals = new Set<number>()
  for (let index = 0; index < expected.length; index += 1) {
    const actual = requireRecord(
      raw.observationOrder[index],
      `${label} observation order entry ${String(index + 1)}`
    )
    exactList(
      Object.keys(actual).sort(),
      [...keys],
      `${label} observation order entry ${String(index + 1)} fields`
    )
    if (!Number.isSafeInteger(actual.ordinal)) {
      throw new Error(`${label} observation order ordinal must be an integer`)
    }
    if (ordinals.has(actual.ordinal as number)) {
      throw new Error(`${label} observation order contains a duplicate ordinal`)
    }
    ordinals.add(actual.ordinal as number)
    if (actual.phase !== 'warmup' && actual.phase !== 'measured') {
      throw new Error(`${label} observation order phase is invalid`)
    }
    const expectedEntry = expected[index]
    if (expectedEntry === undefined) {
      throw new Error(`${label} expected observation order entry is missing`)
    }
    for (const key of comparisonKeys) {
      if (actual[key] !== expectedEntry[key]) {
        throw new Error(
          `${label} observation order ${key} differs at ordinal ` +
          String(expectedEntry.ordinal)
        )
      }
    }
  }
}

const validateUpstreamProvenance = (
  value: unknown,
  buildCommit: string,
  expectedObservationCount: number,
  label: string
): void => {
  const provenance = requireRecord(value, `${label} provenance`)
  exactList(Object.keys(provenance).sort(), [
    'chromiumSchedulingPolicy',
    'applicationCloseCount',
    'applicationLaunchCount',
    'detachedWorktreeClean',
    'detachedWorktreeHead',
    'executableSha256',
    'harnessCommit',
    'launchBoundary',
    'launcherSha256',
    'lockfileSha256',
    'measurementBoundary',
    'nodeVersion',
    'packageArtifactSha256',
    'packageManager',
    'packageVersion',
    'playwrightVersion',
    'presentationBoundary',
    'probeSha256',
    'producerSha256',
    'profileCleanupCount',
    'observationSchedule',
    'observationScheduleSha256',
    'sampleLifecycle',
    'uniqueProfileCount',
    'windowPresentationPlatform',
    'windowPresentationPolicy'
  ].sort(), `${label} provenance fields`)
  if (provenance.detachedWorktreeHead !== buildCommit) {
    throw new Error(`${label} provenance detached worktree head differs from build commit`)
  }
  if (provenance.detachedWorktreeClean !== true) {
    throw new Error(`${label} provenance requires a clean detached worktree`)
  }
  for (const field of [
    'packageArtifactSha256',
    'executableSha256',
    'lockfileSha256',
    'producerSha256',
    'probeSha256',
    'launcherSha256'
  ] as const) requireDigest(provenance[field], `${label} provenance ${field}`)
  if (
    typeof provenance.harnessCommit !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(provenance.harnessCommit)
  ) throw new Error(`${label} provenance harness commit is invalid`)
  for (const field of [
    'packageVersion',
    'packageManager',
    'nodeVersion',
    'playwrightVersion'
  ] as const) requireNonEmpty(provenance[field], `${label} provenance ${field}`)
  if (provenance.measurementBoundary !== 'external-browser-compositor-v4') {
    throw new Error(`${label} provenance measurement boundary is invalid`)
  }
  if (
    provenance.presentationBoundary !==
      'electron-webcontents-capture-page-transparent-v2'
  ) {
    throw new Error(`${label} provenance presentation boundary is invalid`)
  }
  if (
    provenance.launchBoundary !==
      'external-inspector-transparent-render-active-v3'
  ) {
    throw new Error(`${label} provenance launch boundary is invalid`)
  }
  if (
    provenance.windowPresentationPolicy !==
      'transparent-render-active-inactive-v6'
  ) {
    throw new Error(`${label} provenance window presentation policy is invalid`)
  }
  if (provenance.windowPresentationPlatform !== 'darwin') {
    throw new Error(`${label} provenance window presentation platform is invalid`)
  }
  if (provenance.chromiumSchedulingPolicy !== 'hidden-unthrottled-rendering-v2') {
    throw new Error(`${label} provenance Chromium scheduling policy is invalid`)
  }
  validateObservationLifecycle(provenance, expectedObservationCount, label)
}

const validateAuthoritySamples = (
  value: unknown,
  expectedCount: number,
  label: string
): void => {
  const evidence = requireRecord(value, `${label} authority evidence`)
  exactList(
    Object.keys(evidence).sort(),
    ['correctionCount', 'pendingDepthMaximum'],
    `${label} authority evidence fields`
  )
  const pendingDepth = evidence.pendingDepthMaximum
  const corrections = evidence.correctionCount
  if (!Array.isArray(pendingDepth) || pendingDepth.length !== expectedCount) {
    throw new Error(`${label} authority evidence pending-depth count must be ${expectedCount}`)
  }
  if (pendingDepth.some(value => !Number.isSafeInteger(value) || value < 1)) {
    throw new Error(`${label} authority evidence pending depth must be a positive integer`)
  }
  if (!Array.isArray(corrections) || corrections.length !== expectedCount) {
    throw new Error(`${label} authority evidence correction count must be ${expectedCount}`)
  }
  if (corrections.some(value => (
    !Number.isSafeInteger(value) || value < 0 || value > 1
  ))) {
    throw new Error(`${label} authority evidence correction count must be zero or one`)
  }
}

const validateCoreProvenance = (
  value: unknown,
  buildCommit: string,
  expectedObservationCount: number,
  label: string
): void => {
  const provenance = requireRecord(value, `${label} provenance`)
  exactList(Object.keys(provenance).sort(), [
    'checkoutClean',
    'checkoutHead',
    'chromiumSchedulingPolicy',
    'applicationCloseCount',
    'applicationLaunchCount',
    'executableSha256',
    'harnessCommit',
    'launchBoundary',
    'launcherSha256',
    'lockfileSha256',
    'measurementBoundary',
    'nodeVersion',
    'packageArtifactSha256',
    'packageManager',
    'packageVersion',
    'playwrightVersion',
    'presentationBoundary',
    'probeSha256',
    'producerSha256',
    'profileCleanupCount',
    'observationSchedule',
    'observationScheduleSha256',
    'sampleLifecycle',
    'uniqueProfileCount',
    'windowPresentationPlatform',
    'windowPresentationPolicy'
  ].sort(), `${label} provenance fields`)
  if (provenance.checkoutHead !== buildCommit) {
    throw new Error(`${label} provenance checkout head differs from its build commit`)
  }
  if (provenance.harnessCommit !== buildCommit) {
    throw new Error(`${label} provenance harness commit differs from build commit`)
  }
  if (
    typeof provenance.harnessCommit !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(provenance.harnessCommit)
  ) throw new Error(`${label} provenance harness commit is invalid`)
  if (provenance.checkoutClean !== true) {
    throw new Error(`${label} provenance requires a clean checkout`)
  }
  for (const field of [
    'packageArtifactSha256',
    'executableSha256',
    'lockfileSha256',
    'producerSha256',
    'probeSha256',
    'launcherSha256'
  ] as const) {
    requireDigest(provenance[field], `${label} provenance ${field}`)
  }
  for (const field of [
    'packageVersion',
    'packageManager',
    'nodeVersion',
    'playwrightVersion'
  ] as const) {
    requireNonEmpty(provenance[field], `${label} provenance ${field}`)
  }
  if (
    provenance.measurementBoundary !==
      'core-authority-browser-compositor-v6'
  ) {
    throw new Error(`${label} provenance measurement boundary is invalid`)
  }
  if (
    provenance.presentationBoundary !==
      'electron-webcontents-capture-page-transparent-v2'
  ) {
    throw new Error(`${label} provenance presentation boundary is invalid`)
  }
  if (provenance.launchBoundary !== 'playwright-electron-packaged-transparent-v3') {
    throw new Error(`${label} provenance launch boundary is invalid`)
  }
  if (
    provenance.windowPresentationPolicy !==
      'transparent-render-active-inactive-v6'
  ) {
    throw new Error(`${label} provenance window presentation policy is invalid`)
  }
  if (provenance.windowPresentationPlatform !== 'darwin') {
    throw new Error(`${label} provenance window presentation platform is invalid`)
  }
  if (provenance.chromiumSchedulingPolicy !== 'hidden-unthrottled-rendering-v2') {
    throw new Error(`${label} provenance Chromium scheduling policy is invalid`)
  }
  validateObservationLifecycle(provenance, expectedObservationCount, label)
}

const validateRawRun = (
  repoRoot: string,
  value: unknown,
  ref: CriticMarkupRawPerformanceRunRef,
  manifest: CriticMarkupPerformanceMeasurementManifest,
  targets: PerformanceTargets,
  representativeDocuments: RepresentativeDocuments
): void => {
  const raw = requireRecord(value, `Raw performance run ${ref.id}`)
  const expectedSchema = ref.implementation === 'core-candidate'
    ? 'marktext-criticmarkup-raw-performance-run-v13'
    : 'marktext-criticmarkup-raw-performance-run-v11'
  if (raw.schema !== expectedSchema) {
    throw new Error(`Raw performance run ${ref.id} schema is invalid`)
  }
  if (raw.runId !== ref.id || raw.implementation !== ref.implementation) {
    throw new Error(`Raw performance run reference does not match its payload: ${ref.id}`)
  }
  if (raw.baselineCommit !== manifest.baselineCommit) {
    throw new Error(`Raw performance run targets a different baseline: ${ref.id}`)
  }
  if (typeof raw.buildCommit !== 'string' || !/^[0-9a-f]{40}$/u.test(raw.buildCommit)) {
    throw new Error(`Raw performance run ${ref.id} build commit is invalid`)
  }
  if (
    raw.implementation === 'upstream-baseline' &&
    raw.buildCommit !== manifest.baselineCommit
  ) {
    throw new Error(`Upstream performance run ${ref.id} does not measure the baseline commit`)
  }
  const measuredAt = requireNonEmpty(raw.measuredAt, `Raw performance run ${ref.id} timestamp`)
  if (Number.isNaN(Date.parse(measuredAt))) {
    throw new Error(`Raw performance run ${ref.id} timestamp is invalid`)
  }
  if (JSON.stringify(raw.environment) !== JSON.stringify(targets.environment)) {
    throw new Error(`Raw performance run ${ref.id} environment differs from the target protocol`)
  }
  const sampling = requireRecord(raw.sampling, `Raw performance run ${ref.id} sampling`)
  if (
    sampling.warmupSamples !== targets.sampling.warmupSamples ||
    sampling.measuredSamples !== targets.sampling.measuredSamples
  ) {
    throw new Error(`Raw performance run ${ref.id} sampling differs from the target protocol`)
  }
  if (!Array.isArray(raw.documents)) {
    throw new Error(`Raw performance run ${ref.id} documents must be an array`)
  }
  const expectedObservationCount = representativeDocuments.documents.length * (
    targets.sampling.warmupSamples + targets.sampling.measuredSamples
  )
  if (expectedObservationCount !== 1100) {
    throw new Error('Performance target protocol must declare exactly 1100 observations per run')
  }
  const expectedObservationOrder = createPerformanceObservationSchedule({
    documentIds: representativeDocuments.documents.map(document => document.id),
    warmupSamples: targets.sampling.warmupSamples,
    measuredSamples: targets.sampling.measuredSamples
  })
  const provenance = requireRecord(
    raw.provenance,
    `Raw performance run ${ref.id} provenance`
  )
  validateObservationSchedule(
    raw,
    provenance,
    expectedObservationOrder,
    `Raw performance run ${ref.id}`
  )
  const declaredSurfaces = new Set<CriticMarkupPerformanceSurface>()
  if (expectedSchema === 'marktext-criticmarkup-raw-performance-run-v13') {
    validateCoreProvenance(
      raw.provenance,
      raw.buildCommit as string,
      expectedObservationCount,
      `Raw performance run ${ref.id}`
    )
    validateHarnessDigests(
      repoRoot,
      ref.implementation,
      raw.buildCommit as string,
      provenance,
      `Raw performance run ${ref.id}`
    )
    if (!Array.isArray(raw.surfaces) || raw.surfaces.length === 0) {
      throw new Error(`Raw performance run ${ref.id} editor surfaces are invalid`)
    }
    for (const surface of raw.surfaces) {
      if (surface !== 'wysiwyg' && surface !== 'source') {
        throw new Error(`Raw performance run ${ref.id} editor surface is invalid`)
      }
      if (declaredSurfaces.has(surface)) {
        throw new Error(`Raw performance run ${ref.id} editor surface is duplicated`)
      }
      declaredSurfaces.add(surface)
    }
  } else {
    validateUpstreamProvenance(
      raw.provenance,
      raw.buildCommit as string,
      expectedObservationCount,
      `Raw performance run ${ref.id}`
    )
    validateHarnessDigests(
      repoRoot,
      ref.implementation,
      raw.buildCommit as string,
      provenance,
      `Raw performance run ${ref.id}`
    )
    const definitions = requireRecord(
      raw.metricDefinitions,
      `Raw performance run ${ref.id} metric definitions`
    )
    exactList(
      Object.keys(definitions).sort(),
      [...COMMON_METRICS].sort(),
      `Raw performance run ${ref.id} metric definitions`
    )
    for (const metric of COMMON_METRICS) {
      requireNonEmpty(definitions[metric], `Raw performance run ${ref.id} ${metric} definition`)
    }
  }
  const expectedMetrics = ref.implementation === 'core-candidate'
    ? CORE_METRICS
    : COMMON_METRICS
  const expectedDocuments = new Map(
    representativeDocuments.documents.map(document => [document.id, document])
  )
  const seenDocuments = new Set<string>()
  for (const candidate of raw.documents) {
    const document = requireRecord(candidate, `Raw performance run ${ref.id} document`)
    const id = requireNonEmpty(document.id, `Raw performance run ${ref.id} document ID`)
    const expected = expectedDocuments.get(id)
    if (!expected || seenDocuments.has(id)) {
      throw new Error(`Raw performance run ${ref.id} document is stale or duplicated: ${id}`)
    }
    seenDocuments.add(id)
    if (document.sourceSha256 !== expected.sha256) {
      throw new Error(`Raw performance run ${ref.id} document digest is stale: ${id}`)
    }
    if (expectedSchema === 'marktext-criticmarkup-raw-performance-run-v13') {
      const surface = document.surface
      if (
        (surface !== 'wysiwyg' && surface !== 'source') ||
        !declaredSurfaces.has(surface)
      ) {
        throw new Error(`Raw performance run ${ref.id} document surface is invalid: ${id}`)
      }
      const authority = requireRecord(
        document.authorityEvidence,
        `${id} authority evidence`
      )
      exactList(
        Object.keys(authority).sort(),
        ['measured', 'warmup'],
        `${id} authority evidence phases`
      )
      validateAuthoritySamples(
        authority.warmup,
        targets.sampling.warmupSamples,
        `${id} warmup`
      )
      validateAuthoritySamples(
        authority.measured,
        targets.sampling.measuredSamples,
        `${id} measured`
      )
    }
    validateSampleSet(
      document.warmup,
      targets.sampling.warmupSamples,
      expectedMetrics,
      `${id} warmup`
    )
    validateSampleSet(
      document.measured,
      targets.sampling.measuredSamples,
      expectedMetrics,
      `${id} measured`
    )
  }
  const missing = [...expectedDocuments.keys()].filter(id => !seenDocuments.has(id))
  if (missing.length > 0) {
    throw new Error(`Raw performance run ${ref.id} is missing documents: ${missing.join(', ')}`)
  }
  if (expectedSchema === 'marktext-criticmarkup-raw-performance-run-v13') {
    const usedSurfaces = new Set(raw.documents.map(document => (
      requireRecord(document, `Raw performance run ${ref.id} document`).surface
    )))
    if (
      usedSurfaces.size !== declaredSurfaces.size ||
      [...declaredSurfaces].some(surface => !usedSurfaces.has(surface))
    ) {
      throw new Error(`Raw performance run ${ref.id} declares an unused editor surface`)
    }
  }
}

export const validateCriticMarkupPerformanceMeasurements = (
  repoRoot: string,
  manifest: CriticMarkupPerformanceMeasurementManifest
): void => {
  if (manifest.schema !== 'marktext-criticmarkup-performance-measurements-v12') {
    throw new Error('Performance measurement manifest schema is invalid')
  }
  if (
    manifest.status !== 'awaiting-raw-runs' &&
    manifest.status !== 'measured-unratified'
  ) {
    throw new Error('Performance measurement manifest status is invalid')
  }
  if (!/^[0-9a-f]{40}$/u.test(manifest.baselineCommit)) {
    throw new Error('Performance measurement baseline commit is invalid')
  }
  exactList(
    Object.keys(manifest.requiredMetrics),
    REQUIRED_IMPLEMENTATIONS,
    'Required performance metric implementations'
  )
  exactList(
    manifest.requiredMetrics['upstream-baseline'],
    COMMON_METRICS,
    'Required upstream performance metrics'
  )
  exactList(
    manifest.requiredMetrics['core-candidate'],
    CORE_METRICS,
    'Required Core performance metrics'
  )
  exactList(
    manifest.requiredImplementations,
    REQUIRED_IMPLEMENTATIONS,
    'Required performance implementations'
  )

  const targets = readPinnedJson<PerformanceTargets>(
    repoRoot,
    manifest.targetManifest,
    'Performance target manifest'
  )
  validateCriticMarkupPerformanceTargets(targets)
  const representativeDocuments = readPinnedJson<RepresentativeDocuments>(
    repoRoot,
    manifest.representativeDocuments,
    'Representative document manifest'
  )
  if (
    representativeDocuments.schema !== 'marktext-criticmarkup-representative-documents-v1' ||
    representativeDocuments.status !== 'proposed-unratified' ||
    !Array.isArray(representativeDocuments.documents) ||
    representativeDocuments.documents.length === 0
  ) {
    throw new Error('Representative document manifest is invalid for performance measurement')
  }
  if (
    targets.representativeDocuments.schema !== representativeDocuments.schema ||
    targets.representativeDocuments.path !== manifest.representativeDocuments.path
  ) {
    throw new Error('Performance target and measurement document manifests differ')
  }
  if (manifest.status === 'awaiting-raw-runs' && manifest.runs.length !== 0) {
    throw new Error('Awaiting performance measurement manifest cannot reference raw runs')
  }
  if (manifest.status === 'measured-unratified' && manifest.runs.length === 0) {
    throw new Error('Measured performance manifest requires raw runs')
  }

  const ids = new Set<string>()
  const implementations = new Set<PerformanceImplementation>()
  for (const ref of manifest.runs) {
    if (!ref.id.trim() || ids.has(ref.id)) {
      throw new Error(`Raw performance run ID is missing or duplicated: ${ref.id}`)
    }
    ids.add(ref.id)
    if (!REQUIRED_IMPLEMENTATIONS.includes(ref.implementation)) {
      throw new Error(`Raw performance run ${ref.id} implementation is invalid`)
    }
    if (implementations.has(ref.implementation)) {
      throw new Error(
        `Performance evidence must contain exactly one run for ${ref.implementation}`
      )
    }
    implementations.add(ref.implementation)
    if (!ref.path.startsWith('specs/baselines/runs/performance/')) {
      throw new Error('Raw performance evidence must be checked in under the performance run directory')
    }
    const raw = readPinnedJson<unknown>(repoRoot, ref, 'Raw performance evidence')
    validateRawRun(repoRoot, raw, ref, manifest, targets, representativeDocuments)
  }
}

export const materializeCriticMarkupMeasuredPerformanceManifest = (
  repoRoot: string,
  manifest: CriticMarkupPerformanceMeasurementManifest,
  rawPaths: readonly string[]
): CriticMarkupPerformanceMeasurementManifest => {
  if (manifest.status !== 'awaiting-raw-runs' || manifest.runs.length !== 0) {
    throw new Error(
      'Performance measurement materialization requires an empty awaiting manifest'
    )
  }
  if (rawPaths.length !== REQUIRED_IMPLEMENTATIONS.length) {
    throw new Error(
      'Performance measurement materialization requires exactly two raw runs'
    )
  }

  const refsByImplementation = new Map<
    PerformanceImplementation,
    CriticMarkupRawPerformanceRunRef
  >()
  for (const rawPath of rawPaths) {
    const absolutePath = resolveRepositoryPath(
      repoRoot,
      rawPath,
      'Raw performance evidence path'
    )
    const canonicalPath = relative(repoRoot, absolutePath).split(sep).join('/')
    if (
      rawPath !== canonicalPath ||
      !canonicalPath.startsWith('specs/baselines/runs/performance/')
    ) {
      throw new Error(
        'Raw performance evidence path must be canonical and under the performance run directory'
      )
    }
    if (!existsSync(absolutePath)) {
      throw new Error(`Raw performance evidence is absent: ${rawPath}`)
    }
    const source = readFileSync(absolutePath)
    const raw = requireRecord(
      JSON.parse(source.toString('utf8')),
      `Raw performance evidence ${rawPath}`
    )
    const implementation = raw.implementation
    if (!REQUIRED_IMPLEMENTATIONS.includes(
      implementation as PerformanceImplementation
    )) {
      throw new Error(`Raw performance implementation is invalid: ${rawPath}`)
    }
    const typedImplementation = implementation as PerformanceImplementation
    const expectedSchema = typedImplementation === 'upstream-baseline'
      ? 'marktext-criticmarkup-raw-performance-run-v11'
      : 'marktext-criticmarkup-raw-performance-run-v13'
    if (raw.schema !== expectedSchema) {
      throw new Error(`Raw performance evidence schema is invalid: ${rawPath}`)
    }
    if (refsByImplementation.has(typedImplementation)) {
      throw new Error(
        `Performance measurement materialization duplicates ${typedImplementation}`
      )
    }
    refsByImplementation.set(typedImplementation, {
      id: requireNonEmpty(raw.runId, `Raw performance run ${rawPath} ID`),
      implementation: typedImplementation,
      path: canonicalPath,
      sha256: sha256(source)
    })
  }

  const runs = REQUIRED_IMPLEMENTATIONS.map(implementation => {
    const ref = refsByImplementation.get(implementation)
    if (ref === undefined) {
      throw new Error(
        `Performance measurement materialization is missing ${implementation}`
      )
    }
    return Object.freeze({ ...ref })
  })
  const measured = {
    ...manifest,
    status: 'measured-unratified' as const,
    runs
  }
  validateCriticMarkupPerformanceMeasurements(repoRoot, measured)
  return Object.freeze({
    ...measured,
    runs
  })
}

const roundedMilliseconds = (value: number): number =>
  Number(value.toFixed(6))

const meanMilliseconds = (values: readonly number[]): number => {
  if (values.length === 0) {
    throw new Error('Performance calibration mean requires at least one sample')
  }
  return roundedMilliseconds(
    values.reduce((sum, value) => sum + value, 0) / values.length
  )
}

const nearestRankMilliseconds = (
  sorted: readonly number[],
  percentile: 50 | 95 | 99
): number => {
  const value = sorted[Math.ceil(sorted.length * percentile / 100) - 1]
  if (value === undefined) {
    throw new Error('Performance calibration percentile requires samples')
  }
  return roundedMilliseconds(value)
}

const calibrationRow = (
  run: CriticMarkupRawPerformanceRun,
  document: CriticMarkupRawPerformanceRun['documents'][number],
  metric: PerformanceMetric
): CriticMarkupPerformanceCalibrationRow => {
  const values = document.measured[metric]
  if (values === undefined || values.length === 0) {
    throw new Error(
      `Raw performance run ${run.runId} has no measured ${metric} samples`
    )
  }
  const midpoint = Math.floor(values.length / 2)
  const firstHalf = values.slice(0, midpoint)
  const secondHalf = values.slice(midpoint)
  if (firstHalf.length === 0 || secondHalf.length === 0) {
    throw new Error(
      `Raw performance run ${run.runId} needs two halves for ${metric} drift`
    )
  }
  const firstHalfMeanMs = meanMilliseconds(firstHalf)
  const secondHalfMeanMs = meanMilliseconds(secondHalf)
  const sorted = [...values].sort((left, right) => left - right)
  return {
    runId: run.runId,
    implementation: run.implementation,
    documentId: document.id,
    metric,
    sampleCount: values.length,
    percentiles: {
      p50Ms: nearestRankMilliseconds(sorted, 50),
      p95Ms: nearestRankMilliseconds(sorted, 95),
      p99Ms: nearestRankMilliseconds(sorted, 99)
    },
    timeOrder: {
      firstMs: roundedMilliseconds(values[0] as number),
      lastMs: roundedMilliseconds(values[values.length - 1] as number),
      firstHalfMeanMs,
      secondHalfMeanMs,
      halfMeanDeltaMs: roundedMilliseconds(
        secondHalfMeanMs - firstHalfMeanMs
      )
    }
  }
}

const createCriticMarkupPerformanceCalibrationReport = (
  repoRoot: string,
  manifest: CriticMarkupPerformanceMeasurementManifest
): CriticMarkupPerformanceCalibrationReport => {
  validateCriticMarkupPerformanceMeasurements(repoRoot, manifest)
  if (manifest.status !== 'measured-unratified') {
    throw new Error(
      'Performance calibration requires measured-unratified evidence'
    )
  }
  const targets = readPinnedJson<PerformanceTargets>(
    repoRoot,
    manifest.targetManifest,
    'Performance target manifest'
  )
  if (JSON.stringify(targets.sampling.percentiles) !== '[50,95,99]') {
    throw new Error('Performance calibration requires exact p50, p95, and p99')
  }
  const rows: CriticMarkupPerformanceCalibrationRow[] = []
  for (const implementation of REQUIRED_IMPLEMENTATIONS) {
    const ref = manifest.runs.find(run => run.implementation === implementation)
    if (ref === undefined) {
      throw new Error(`Performance calibration is missing ${implementation}`)
    }
    const raw = readPinnedJson<CriticMarkupRawPerformanceRun>(
      repoRoot,
      ref,
      'Raw performance evidence'
    )
    const metrics = raw.implementation === 'core-candidate'
      ? CORE_METRICS
      : COMMON_METRICS
    for (const document of raw.documents) {
      for (const metric of metrics) rows.push(calibrationRow(raw, document, metric))
    }
  }
  const frozenRows: readonly CriticMarkupPerformanceCalibrationRow[] =
    Object.freeze(rows.map(row => Object.freeze({
      ...row,
      percentiles: Object.freeze({ ...row.percentiles }),
      timeOrder: Object.freeze({ ...row.timeOrder })
    })))
  const provenance: CriticMarkupPerformanceCalibrationReport['provenance'] =
    Object.freeze({
      baselineCommit: manifest.baselineCommit,
      targetManifest: Object.freeze({ ...manifest.targetManifest }),
      representativeDocuments: Object.freeze({
        ...manifest.representativeDocuments
      }),
      rawRuns: Object.freeze(manifest.runs.map(run => Object.freeze({ ...run })))
    })
  const percentiles: readonly [50, 95, 99] = Object.freeze([50, 95, 99])
  return Object.freeze({
    schema: 'marktext-criticmarkup-performance-calibration-v1',
    status: 'measured-unratified',
    provenance,
    percentiles,
    rowsSha256: sha256(Buffer.from(JSON.stringify(frozenRows), 'utf8')),
    rows: frozenRows
  })
}

export const writeCriticMarkupPerformanceCalibrationReport = (
  repoRoot: string,
  manifest: CriticMarkupPerformanceMeasurementManifest,
  outputPath: string
): CriticMarkupPerformanceCalibrationMaterialization => {
  const absolutePath = resolveRepositoryPath(
    repoRoot,
    outputPath,
    'Performance calibration report path'
  )
  const canonicalPath = relative(repoRoot, absolutePath).split(sep).join('/')
  if (
    outputPath !== canonicalPath ||
    !canonicalPath.startsWith('specs/baselines/runs/performance/')
  ) {
    throw new Error(
      'Performance calibration report must be canonical and under the performance run directory'
    )
  }
  const report = createCriticMarkupPerformanceCalibrationReport(
    repoRoot,
    manifest
  )
  const source = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8')
  writeFileSync(absolutePath, source, { flag: 'wx' })
  return Object.freeze({
    ref: Object.freeze({
      path: canonicalPath,
      sha256: sha256(source)
    }),
    report
  })
}

export const requireCriticMarkupPerformanceEvidenceForRatification = (
  repoRoot: string,
  manifest: CriticMarkupPerformanceMeasurementManifest,
  calibrationRef: CriticMarkupPerformanceArtifactRef
): CriticMarkupPerformanceRatificationEvidence => {
  validateCriticMarkupPerformanceMeasurements(repoRoot, manifest)
  const measured = new Set(manifest.runs.map(run => run.implementation))
  const missing = REQUIRED_IMPLEMENTATIONS.filter(role => !measured.has(role))
  if (missing.length > 0) {
    throw new Error(
      `Performance target ratification requires checked-in raw runs for: ${missing.join(', ')}`
    )
  }
  if (manifest.status !== 'measured-unratified') {
    throw new Error('Performance target ratification requires measured-unratified evidence')
  }
  const targets = readPinnedJson<PerformanceTargets>(
    repoRoot,
    manifest.targetManifest,
    'Performance target manifest'
  )
  const presentationTarget = targets.metrics.t_present
  if (
    presentationTarget.targetStatus !== 'frozen' ||
    typeof presentationTarget.targetP95Ms !== 'number' ||
    !Number.isFinite(presentationTarget.targetP95Ms) ||
    presentationTarget.targetP95Ms <= 0
  ) {
    throw new Error(
      'Performance ratification requires t_present baseline calibration and a frozen positive target'
    )
  }
  const calibration = createCriticMarkupPerformanceCalibrationReport(
    repoRoot,
    manifest
  )
  const calibrationPath = requireNonEmpty(
    calibrationRef.path,
    'Performance calibration report path'
  )
  const calibrationAbsolutePath = resolveRepositoryPath(
    repoRoot,
    calibrationPath,
    'Performance calibration report path'
  )
  const canonicalCalibrationPath = relative(repoRoot, calibrationAbsolutePath)
    .split(sep)
    .join('/')
  if (
    calibrationPath !== canonicalCalibrationPath ||
    !canonicalCalibrationPath.startsWith('specs/baselines/runs/performance/')
  ) {
    throw new Error(
      'Performance calibration report must be canonical and under the performance run directory'
    )
  }
  if (!existsSync(calibrationAbsolutePath)) {
    throw new Error(`Performance calibration report is absent: ${calibrationPath}`)
  }
  const calibrationSource = readFileSync(calibrationAbsolutePath)
  if (
    sha256(calibrationSource) !== requireDigest(
      calibrationRef.sha256,
      'Performance calibration report digest'
    )
  ) {
    throw new Error(`Performance calibration report digest is stale: ${calibrationPath}`)
  }
  const expectedCalibrationSource = Buffer.from(
    `${JSON.stringify(calibration, null, 2)}\n`,
    'utf8'
  )
  if (!calibrationSource.equals(expectedCalibrationSource)) {
    throw new Error(
      'Performance calibration report differs from the validated raw evidence'
    )
  }
  const rows: CriticMarkupPerformanceP95Row[] = calibration.rows.map(row => {
    const targetP95Ms = targets.metrics[row.metric].targetP95Ms
    if (targetP95Ms === null) {
      throw new Error(`Performance target ${row.metric} requires calibration`)
    }
    return {
      runId: row.runId,
      implementation: row.implementation,
      documentId: row.documentId,
      metric: row.metric,
      p95Ms: row.percentiles.p95Ms,
      targetP95Ms,
      meetsTarget: row.percentiles.p95Ms <= targetP95Ms
    }
  })
  const coreMisses = rows.filter(row =>
    row.implementation === 'core-candidate' && !row.meetsTarget
  )
  if (coreMisses.length > 0) {
    throw new Error(
      'Core performance target misses: ' + coreMisses.map(row =>
        `${row.documentId} ${row.metric} p95 ${String(row.p95Ms)}ms > ` +
        `${String(row.targetP95Ms)}ms`
      ).join('; ')
    )
  }
  const provenance: CriticMarkupPerformanceRatificationEvidence['provenance'] =
    Object.freeze({
      baselineCommit: manifest.baselineCommit,
      targetManifest: Object.freeze({ ...manifest.targetManifest }),
      representativeDocuments: Object.freeze({
        ...manifest.representativeDocuments
      }),
      rawRuns: Object.freeze(manifest.runs.map(run => Object.freeze({ ...run }))),
      calibrationReport: Object.freeze({
        path: canonicalCalibrationPath,
        sha256: calibrationRef.sha256
      }),
      calibrationRowsSha256: calibration.rowsSha256
    })
  return Object.freeze({
    schema: 'marktext-criticmarkup-performance-ratification-evidence-v2',
    provenance,
    rowsSha256: sha256(Buffer.from(JSON.stringify(rows), 'utf8')),
    rows: Object.freeze(rows.map(row => Object.freeze({ ...row })))
  })
}

const runCli = (): void => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = JSON.parse(readFileSync(resolve(
    repoRoot,
    'specs/baselines/criticmarkup-performance-measurements.json'
  ), 'utf8')) as CriticMarkupPerformanceMeasurementManifest
  if (process.argv[2] === '--validate') {
    validateCriticMarkupPerformanceMeasurements(repoRoot, manifest)
    return
  }
  if (process.argv[2] === '--materialize-measurements') {
    const rawPaths = process.argv.slice(3)
    if (rawPaths.length !== REQUIRED_IMPLEMENTATIONS.length) {
      throw new Error(
        'Performance measurement materialization requires exactly two raw paths'
      )
    }
    const measured = materializeCriticMarkupMeasuredPerformanceManifest(
      repoRoot,
      manifest,
      rawPaths
    )
    process.stdout.write(`${JSON.stringify(measured, null, 2)}\n`)
    return
  }
  if (process.argv[2] === '--write-calibration') {
    const outputPath = process.argv[3]
    if (outputPath === undefined || process.argv.length !== 4) {
      throw new Error('Performance calibration writing requires one output path')
    }
    const materialized = writeCriticMarkupPerformanceCalibrationReport(
      repoRoot,
      manifest,
      outputPath
    )
    process.stdout.write(`${JSON.stringify(materialized.ref, null, 2)}\n`)
    return
  }
  if (process.argv[2] === '--require-ratification-evidence') {
    const calibrationPath = process.argv[3]
    const calibrationSha256 = process.argv[4]
    if (
      calibrationPath === undefined ||
      calibrationSha256 === undefined ||
      process.argv.length !== 5
    ) {
      throw new Error(
        'Performance ratification requires a calibration path and full SHA-256'
      )
    }
    const evidence = requireCriticMarkupPerformanceEvidenceForRatification(
      repoRoot,
      manifest,
      { path: calibrationPath, sha256: calibrationSha256 }
    )
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
    return
  }
  throw new Error(
    'Usage: tsx scripts/criticmarkupPerformanceMeasurements.ts ' +
    '--validate | --materialize-measurements <upstream-raw> <core-raw> | ' +
    '--write-calibration <output> | ' +
    '--require-ratification-evidence <calibration-path> <calibration-sha256>'
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli()
}
