import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  validateCriticMarkupPerformanceTargets
} from './criticmarkupPerformanceTargets'

const COMMON_METRICS = [
  't_echo',
  't_frame',
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
  't_frame',
  'open',
  'first_viewport'
] as const

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
  schema: 'marktext-criticmarkup-performance-measurements-v2'
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
  documents: Array<{
    id: string
    sourceSha256: string
    warmup: CriticMarkupPerformanceSamples
    measured: CriticMarkupPerformanceSamples
  }>
}

export interface CriticMarkupRawPerformanceRunV1
  extends CriticMarkupRawPerformanceRunBase {
  schema: 'marktext-criticmarkup-raw-performance-run-v1'
  provenance: CriticMarkupUpstreamPerformanceProvenance
  metricDefinitions: Record<CommonMetric, string>
}

export type CriticMarkupPerformanceSurface = 'wysiwyg' | 'source'

export interface CriticMarkupRawPerformanceRunV2
  extends Omit<CriticMarkupRawPerformanceRunBase, 'implementation' | 'documents'> {
  schema: 'marktext-criticmarkup-raw-performance-run-v3'
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
  measurementBoundary: 'core-authority-browser-external-v3'
  launchBoundary: 'playwright-electron-packaged-v1'
  windowVisibility: 'hidden-unfocused'
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
  measurementBoundary: 'external-browser-dom-v1'
  launchBoundary: 'external-inspector-hidden-cdp-v1'
  windowVisibility: 'hidden-unfocused'
}

export interface CriticMarkupPerformanceAuthoritySamples {
  pendingDepthMaximum: number[]
  correctionCount: number[]
}

export type CriticMarkupRawPerformanceRun =
  | CriticMarkupRawPerformanceRunV1
  | CriticMarkupRawPerformanceRunV2

interface PerformanceTargets {
  schema: 'marktext-criticmarkup-performance-targets-v1'
  status: 'proposed-unratified' | 'ratified'
  representativeDocuments: { schema: string, path: string }
  environment: Record<string, string>
  sampling: { warmupSamples: number, measuredSamples: number }
  metrics: Record<PerformanceMetric, { targetP95Ms: number }>
}

interface RepresentativeDocuments {
  schema: 'marktext-criticmarkup-representative-documents-v1'
  status: 'proposed-unratified'
  documents: Array<{ id: string, sha256: string }>
}

export interface CriticMarkupPerformanceP95Row {
  runId: string
  implementation: PerformanceImplementation
  documentId: string
  metric: PerformanceMetric
  p95Ms: number
  targetP95Ms: number
  meetsTarget: boolean
}

export interface CriticMarkupPerformanceRatificationEvidence {
  schema: 'marktext-criticmarkup-performance-ratification-evidence-v1'
  rows: CriticMarkupPerformanceP95Row[]
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
  const prefix = 'packages/desktop/test/e2e/'
  if (implementation === 'core-candidate') {
    requireHarnessDigest(
      provenance.lockfileSha256,
      sha256(gitBlob(repoRoot, buildCommit, 'pnpm-lock.yaml')),
      `${label} lockfile digest`
    )
    requireHarnessDigest(
      provenance.producerSha256,
      compositeGitDigest(repoRoot, harnessCommit, [
        `${prefix}installed-core-performance.spec.ts`,
        `${prefix}helpers/coreAuthorityPerformanceRawRun.ts`,
        `${prefix}helpers/coreAuthorityPerformanceReport.ts`,
        `${prefix}installedArtifactProvenance.ts`,
        `${prefix}playwright.installed-core-performance.config.ts`
      ]),
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
    compositeGitDigest(repoRoot, harnessCommit, [
      `${prefix}upstream-baseline-performance.spec.ts`,
      `${prefix}helpers/upstreamBaselinePerformanceRawRun.ts`,
      `${prefix}helpers/upstreamBaselineEnvironment.ts`,
      `${prefix}playwright.upstream-baseline-performance.config.ts`,
      `${prefix}helpers/upstreamBaselineHiddenPolicy.ts`
    ]),
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
    if ((typed.t_frame?.[index] ?? 0) < (typed.t_echo?.[index] ?? 0)) {
      throw new Error(`${label} sample ${index} frames before exact browser echo`)
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

const validateUpstreamProvenance = (
  value: unknown,
  buildCommit: string,
  label: string
): void => {
  const provenance = requireRecord(value, `${label} provenance`)
  exactList(Object.keys(provenance).sort(), [
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
    'probeSha256',
    'producerSha256',
    'windowVisibility'
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
  if (provenance.measurementBoundary !== 'external-browser-dom-v1') {
    throw new Error(`${label} provenance measurement boundary is invalid`)
  }
  if (provenance.launchBoundary !== 'external-inspector-hidden-cdp-v1') {
    throw new Error(`${label} provenance launch boundary is invalid`)
  }
  if (provenance.windowVisibility !== 'hidden-unfocused') {
    throw new Error(`${label} provenance window visibility is invalid`)
  }
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
  label: string
): void => {
  const provenance = requireRecord(value, `${label} provenance`)
  exactList(Object.keys(provenance).sort(), [
    'checkoutClean',
    'checkoutHead',
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
    'probeSha256',
    'producerSha256',
    'windowVisibility'
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
  if (provenance.measurementBoundary !== 'core-authority-browser-external-v3') {
    throw new Error(`${label} provenance measurement boundary is invalid`)
  }
  if (provenance.launchBoundary !== 'playwright-electron-packaged-v1') {
    throw new Error(`${label} provenance launch boundary is invalid`)
  }
  if (provenance.windowVisibility !== 'hidden-unfocused') {
    throw new Error(`${label} provenance window visibility is invalid`)
  }
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
    ? 'marktext-criticmarkup-raw-performance-run-v3'
    : 'marktext-criticmarkup-raw-performance-run-v1'
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
  const declaredSurfaces = new Set<CriticMarkupPerformanceSurface>()
  if (expectedSchema === 'marktext-criticmarkup-raw-performance-run-v3') {
    validateCoreProvenance(
      raw.provenance,
      raw.buildCommit as string,
      `Raw performance run ${ref.id}`
    )
    validateHarnessDigests(
      repoRoot,
      ref.implementation,
      raw.buildCommit as string,
      requireRecord(raw.provenance, `Raw performance run ${ref.id} provenance`),
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
      `Raw performance run ${ref.id}`
    )
    validateHarnessDigests(
      repoRoot,
      ref.implementation,
      raw.buildCommit as string,
      requireRecord(raw.provenance, `Raw performance run ${ref.id} provenance`),
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
    if (expectedSchema === 'marktext-criticmarkup-raw-performance-run-v3') {
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
  if (expectedSchema === 'marktext-criticmarkup-raw-performance-run-v3') {
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
  if (manifest.schema !== 'marktext-criticmarkup-performance-measurements-v2') {
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

export const requireCriticMarkupPerformanceEvidenceForRatification = (
  repoRoot: string,
  manifest: CriticMarkupPerformanceMeasurementManifest
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
  const rows: CriticMarkupPerformanceP95Row[] = []
  for (const ref of manifest.runs) {
    const raw = readPinnedJson<CriticMarkupRawPerformanceRun>(
      repoRoot,
      ref,
      'Raw performance evidence'
    )
    for (const document of raw.documents) {
      const metrics = raw.implementation === 'core-candidate'
        ? CORE_METRICS
        : COMMON_METRICS
      for (const metric of metrics) {
        const values = document.measured[metric]
        if (values === undefined) {
          throw new Error(`Raw performance run ${ref.id} has no ${metric} samples`)
        }
        const sorted = [...values].sort((left, right) => left - right)
        const rank = Math.ceil(sorted.length * 0.95) - 1
        const p95Ms = sorted[rank]
        if (p95Ms === undefined) {
          throw new Error(`Raw performance run ${ref.id} has no ${metric} samples`)
        }
        const targetP95Ms = targets.metrics[metric].targetP95Ms
        rows.push({
          runId: raw.runId,
          implementation: raw.implementation,
          documentId: document.id,
          metric,
          p95Ms,
          targetP95Ms,
          meetsTarget: p95Ms <= targetP95Ms
        })
      }
    }
  }
  return {
    schema: 'marktext-criticmarkup-performance-ratification-evidence-v1',
    rows
  }
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
  if (process.argv[2] === '--require-ratification-evidence') {
    requireCriticMarkupPerformanceEvidenceForRatification(repoRoot, manifest)
    return
  }
  throw new Error(
    'Usage: tsx scripts/criticmarkupPerformanceMeasurements.ts ' +
    '--validate | --require-ratification-evidence'
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli()
}
