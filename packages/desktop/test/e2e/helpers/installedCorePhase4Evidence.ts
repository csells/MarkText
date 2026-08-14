import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const INSTALLED_CORE_PHASE4_PROJECT = 'installed-core-phase4-consumers'
export const INSTALLED_CORE_PHASE4_MATRIX_PATH =
  'specs/baselines/criticmarkup-interaction-matrix.json'

export const INSTALLED_CORE_PHASE4_TEST_SOURCES = Object.freeze([
  'packages/desktop/test/e2e/installed-core-clipboard.spec.ts',
  'packages/desktop/test/e2e/installed-core-export-consumers.spec.ts',
  'packages/desktop/test/e2e/installed-core-review.spec.ts',
  'packages/desktop/test/e2e/installed-core-search.spec.ts'
] as const)

export const INSTALLED_CORE_PHASE4_HARNESS_SOURCES = Object.freeze([
  'packages/desktop/test/e2e/helpers/installedCorePhase4Evidence.ts',
  'packages/desktop/test/e2e/playwright.installed-core-phase4-consumers.config.ts',
  'packages/desktop/test/e2e/run-installed-core-phase4-consumers.sh',
  'scripts/installedCorePhase4Evidence.ts'
] as const)

export const INSTALLED_CORE_PHASE4_WORKFLOWS = Object.freeze([
  Object.freeze({
    id: 'phase4.review.bulk-accept-all',
    specPath: 'packages/desktop/test/e2e/installed-core-review.spec.ts',
    testTitle: 'bulk accept is one installed Review history unit'
  }),
  Object.freeze({
    id: 'phase4.review.bulk-reject-all',
    specPath: 'packages/desktop/test/e2e/installed-core-review.spec.ts',
    testTitle: 'bulk reject is one installed Review history unit'
  }),
  Object.freeze({
    id: 'phase4.review.track-comment-save-reopen',
    specPath: 'packages/desktop/test/e2e/installed-core-review.spec.ts',
    testTitle: 'tracks continuously, edits a Comment, saves, and reopens exact bytes'
  }),
  Object.freeze({
    id: 'phase4.clipboard.copy-revised',
    specPath: 'packages/desktop/test/e2e/installed-core-clipboard.spec.ts',
    testTitle: 'native Copy publishes the selected Revised rich and plain projections'
  }),
  Object.freeze({
    id: 'phase4.clipboard.cut-revised',
    specPath: 'packages/desktop/test/e2e/installed-core-clipboard.spec.ts',
    testTitle: 'native Cut writes its Revised payload before one actor history mutation'
  }),
  Object.freeze({
    id: 'phase4.clipboard.paste-revised',
    specPath: 'packages/desktop/test/e2e/installed-core-clipboard.spec.ts',
    testTitle: 'native Paste commits a copied Revised projection through actor history'
  }),
  Object.freeze({
    id: 'phase4.search.replace-all-revised',
    specPath: 'packages/desktop/test/e2e/installed-core-search.spec.ts',
    testTitle: 'visible Revised search and replace-all are one actor history unit'
  }),
  Object.freeze({
    id: 'phase4.export.revised-consumers',
    specPath: 'packages/desktop/test/e2e/installed-core-export-consumers.spec.ts',
    testTitle: 'styled HTML, PDF, and Print commands consume the same Revised projection'
  })
] as const)

type SourceDigest = Readonly<{ path: string, sha256: string }>

export type InstalledCorePhase4Evidence = Readonly<{
  schema: 'marktext-installed-core-phase4-evidence-v1'
  buildCommit: string
  harnessCommit: string
  recordedAt: string
  result: 'pass'
  platform: Readonly<{
    name: 'darwin'
    arch: 'arm64' | 'x64'
    release: string
  }>
  package: Readonly<{ name: string, sha256: string }>
  executable: Readonly<{ path: string, sha256: string }>
  cleanup: Readonly<{
    result: 'pass'
    applicationProcessCount: 0
    mountedImageDetached: true
    packageRemoved: true
    temporaryPathsRemoved: true
  }>
  interactionMatrix: SourceDigest
  executionArtifacts: Readonly<{
    playwrightReport: SourceDigest
    runnerLog: SourceDigest
  }>
  totalTests: number
  interactionMatrixRowIds: readonly string[]
  workflowIds: readonly string[]
  tests: ReadonlyArray<Readonly<{
    id: string
    kind: 'interaction-matrix' | 'phase4-workflow'
    specPath: string
    testTitle: string
    result: 'pass'
  }>>
  testSources: readonly SourceDigest[]
  harnessSources: readonly SourceDigest[]
}>

export type InstalledCorePhase4EvidenceMetadata = Readonly<{
  buildCommit: string
  harnessCommit: string
  recordedAt: string
  package: Readonly<{ name: string, sha256: string }>
  executable: Readonly<{ path: string, sha256: string }>
  platform: Readonly<{ name: string, arch: string, release: string }>
  cleanup: Readonly<{
    result: string
    applicationProcessCount: number
    mountedImageDetached: boolean
    packageRemoved: boolean
    temporaryPathsRemoved: boolean
  }>
  playwrightReportPath: string
  runnerLogPath: string
}>

export type InstalledCorePhase4CommittedSourceReader = (
  commit: string,
  sourcePath: string
) => Buffer

const FULL_COMMIT = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const INTERACTION_SUFFIX = ' follows the installed interaction matrix'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const exactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void => {
  const actual = Object.keys(value).sort()
  const keys = [...expected].sort()
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new Error(`Installed Core Phase 4 ${label} schema is invalid`)
  }
}

const requireIdentity = (value: string, pattern: RegExp, label: string): void => {
  if (!pattern.test(value)) throw new Error(`Installed Core Phase 4 ${label} is invalid`)
}

const sortedUnique = (values: readonly string[], label: string): string[] => {
  const sorted = [...values].sort()
  if (
    sorted.some(value => !value.trim()) ||
    sorted.some((value, index) => index > 0 && value === sorted[index - 1])
  ) {
    throw new Error(`Installed Core Phase 4 ${label} must be unique and nonempty`)
  }
  return sorted
}

const sourceDigests = (
  repoRoot: string,
  commit: string,
  sources: readonly string[],
  readCommittedSource: InstalledCorePhase4CommittedSourceReader
): SourceDigest[] => sources.map(sourcePath => ({
  path: sourcePath,
  sha256: createHash('sha256')
    .update(readCommittedSource(commit, sourcePath))
    .digest('hex')
}))

const defaultCommittedSourceReader = (
  repoRoot: string
): InstalledCorePhase4CommittedSourceReader => (commit, sourcePath) =>
  execFileSync('git', ['-C', repoRoot, 'show', `${commit}:${sourcePath}`], {
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024
  })

const repositoryArtifact = (
  repoRoot: string,
  artifactPath: string,
  label: string
): Readonly<{ path: string, bytes: Buffer, sha256: string }> => {
  if (!artifactPath.trim() || path.isAbsolute(artifactPath)) {
    throw new Error(`Installed Core Phase 4 ${label} path is invalid`)
  }
  const absolute = path.resolve(repoRoot, artifactPath)
  const relative = path.relative(repoRoot, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Installed Core Phase 4 ${label} must be inside the repository`)
  }
  const bytes = readFileSync(absolute)
  if (bytes.length === 0) throw new Error(`Installed Core Phase 4 ${label} is empty`)
  return {
    path: relative.replaceAll('\\', '/'),
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
}

const reportSpecs = (report: unknown): Array<Record<string, unknown>> => {
  if (!isRecord(report) || !Array.isArray(report.suites)) {
    throw new Error('Installed Core Phase 4 Playwright report is invalid')
  }
  if (
    !isRecord(report.config) ||
    report.config.workers !== 1 ||
    report.config.maxFailures !== 1 ||
    !Array.isArray(report.config.projects) ||
    report.config.projects.length !== 1 ||
    !isRecord(report.config.projects[0]) ||
    report.config.projects[0].name !== INSTALLED_CORE_PHASE4_PROJECT ||
    report.config.projects[0].retries !== 0 ||
    !Array.isArray(report.errors) ||
    report.errors.length !== 0
  ) {
    throw new Error('Installed Core Phase 4 Playwright execution policy is invalid')
  }
  const specs: Array<Record<string, unknown>> = []
  const visit = (candidate: unknown): void => {
    if (!isRecord(candidate)) {
      throw new Error('Installed Core Phase 4 Playwright suite is invalid')
    }
    if (candidate.specs !== undefined) {
      if (!Array.isArray(candidate.specs)) {
        throw new Error('Installed Core Phase 4 Playwright specs are invalid')
      }
      for (const spec of candidate.specs) {
        if (!isRecord(spec)) {
          throw new Error('Installed Core Phase 4 Playwright spec is invalid')
        }
        specs.push(spec)
      }
    }
    if (candidate.suites !== undefined) {
      if (!Array.isArray(candidate.suites)) {
        throw new Error('Installed Core Phase 4 Playwright suites are invalid')
      }
      candidate.suites.forEach(visit)
    }
  }
  report.suites.forEach(visit)
  return specs
}

const normalizedSpecPath = (reported: unknown): string => {
  if (typeof reported !== 'string') {
    throw new Error('Installed Core Phase 4 Playwright spec path is invalid')
  }
  const normalized = reported.replaceAll('\\', '/')
  const basename = path.posix.basename(normalized)
  const source = INSTALLED_CORE_PHASE4_TEST_SOURCES.find(candidate =>
    path.posix.basename(candidate) === basename
  )
  if (source === undefined || !normalized.endsWith(`test/e2e/${basename}`)) {
    throw new Error(`Installed Core Phase 4 Playwright spec is unexpected: ${reported}`)
  }
  return source
}

const passingPlaywrightSpec = (spec: Record<string, unknown>): void => {
  if (spec.ok !== true || !Array.isArray(spec.tests) || spec.tests.length !== 1) {
    throw new Error('Installed Core Phase 4 Playwright spec did not pass exactly once')
  }
  const [test] = spec.tests
  if (!isRecord(test)) {
    throw new Error('Installed Core Phase 4 Playwright test is invalid')
  }
  if (
    test.projectName !== INSTALLED_CORE_PHASE4_PROJECT ||
    test.expectedStatus !== 'passed' ||
    !Array.isArray(test.results) ||
    test.results.length !== 1
  ) {
    throw new Error('Installed Core Phase 4 Playwright test project or retry count is invalid')
  }
  const [result] = test.results
  if (
    !isRecord(result) ||
    result.status !== 'passed' ||
    (result.retry !== undefined && result.retry !== 0)
  ) {
    throw new Error('Installed Core Phase 4 Playwright test is not a first-attempt pass')
  }
}

const expectedTests = (interactionIds: readonly string[]): InstalledCorePhase4Evidence['tests'] => [
  ...interactionIds.map(id => ({
    id,
    kind: 'interaction-matrix' as const,
    specPath: 'packages/desktop/test/e2e/installed-core-review.spec.ts',
    testTitle: `${id}${INTERACTION_SUFFIX}`,
    result: 'pass' as const
  })),
  ...INSTALLED_CORE_PHASE4_WORKFLOWS.map(workflow => ({
    id: workflow.id,
    kind: 'phase4-workflow' as const,
    specPath: workflow.specPath,
    testTitle: workflow.testTitle,
    result: 'pass' as const
  }))
].sort((left, right) => left.id.localeCompare(right.id))

const observedTests = (
  report: unknown,
  interactionIds: readonly string[]
): InstalledCorePhase4Evidence['tests'] => {
  const expected = expectedTests(interactionIds)
  const expectedByBoundary = new Map(expected.map(test => [
    `${test.specPath}\0${test.testTitle}`,
    test
  ]))
  const observed = reportSpecs(report).map(spec => {
    passingPlaywrightSpec(spec)
    const specPath = normalizedSpecPath(spec.file)
    if (typeof spec.title !== 'string') {
      throw new Error('Installed Core Phase 4 Playwright title is invalid')
    }
    const test = expectedByBoundary.get(`${specPath}\0${spec.title}`)
    if (test === undefined) {
      throw new Error(`Installed Core Phase 4 Playwright test is unexpected: ${spec.title}`)
    }
    return test
  }).sort((left, right) => left.id.localeCompare(right.id))
  if (
    observed.length !== expected.length ||
    observed.some((test, index) => test.id !== expected[index]?.id)
  ) {
    throw new Error('Installed Core Phase 4 Playwright report is missing or duplicates tests')
  }
  return observed
}

const validateMetadata = (metadata: Omit<
  InstalledCorePhase4EvidenceMetadata,
  'playwrightReportPath' | 'runnerLogPath'
>): void => {
  requireIdentity(metadata.buildCommit, FULL_COMMIT, 'build commit')
  requireIdentity(metadata.harnessCommit, FULL_COMMIT, 'harness commit')
  if (metadata.buildCommit !== metadata.harnessCommit) {
    throw new Error('Installed Core Phase 4 build and harness commits differ')
  }
  if (
    !ISO_TIMESTAMP.test(metadata.recordedAt) ||
    new Date(metadata.recordedAt).toISOString() !== metadata.recordedAt
  ) {
    throw new Error('Installed Core Phase 4 timestamp is invalid')
  }
  if (
    path.basename(metadata.package.name) !== metadata.package.name ||
    !metadata.package.name.endsWith('.dmg')
  ) {
    throw new Error('Installed Core Phase 4 package name is invalid')
  }
  requireIdentity(metadata.package.sha256, SHA256, 'package digest')
  if (metadata.executable.path !== 'marktext.app/Contents/MacOS/marktext') {
    throw new Error('Installed Core Phase 4 executable path is invalid')
  }
  requireIdentity(metadata.executable.sha256, SHA256, 'executable digest')
  if (
    metadata.platform.name !== 'darwin' ||
    !(['arm64', 'x64'] as const).includes(metadata.platform.arch as 'arm64' | 'x64') ||
    !metadata.platform.release.trim()
  ) {
    throw new Error('Installed Core Phase 4 platform is invalid')
  }
  if (
    metadata.cleanup.result !== 'pass' ||
    metadata.cleanup.applicationProcessCount !== 0 ||
    metadata.cleanup.mountedImageDetached !== true ||
    metadata.cleanup.packageRemoved !== true ||
    metadata.cleanup.temporaryPathsRemoved !== true
  ) {
    throw new Error('Installed Core Phase 4 cleanup is incomplete')
  }
}

export const createInstalledCorePhase4Evidence = (input: Readonly<{
  repoRoot: string
  interactionIds: readonly string[]
  metadata: InstalledCorePhase4EvidenceMetadata
  readCommittedSource?: InstalledCorePhase4CommittedSourceReader
}>): InstalledCorePhase4Evidence => {
  const interactionIds = sortedUnique(input.interactionIds, 'interaction row IDs')
  if (interactionIds.length !== 25) {
    throw new Error('Installed Core Phase 4 requires exactly 25 interaction rows')
  }
  validateMetadata(input.metadata)
  const expected = expectedTests(interactionIds)
  const report = repositoryArtifact(
    input.repoRoot,
    input.metadata.playwrightReportPath,
    'Playwright report'
  )
  const runnerLog = repositoryArtifact(
    input.repoRoot,
    input.metadata.runnerLogPath,
    'runner log'
  )
  const interactionMatrix = repositoryArtifact(
    input.repoRoot,
    INSTALLED_CORE_PHASE4_MATRIX_PATH,
    'interaction matrix'
  )
  const observed = observedTests(JSON.parse(report.bytes.toString('utf8')) as unknown, interactionIds)
  const readCommittedSource = input.readCommittedSource ??
    defaultCommittedSourceReader(input.repoRoot)

  const record: InstalledCorePhase4Evidence = {
    schema: 'marktext-installed-core-phase4-evidence-v1',
    buildCommit: input.metadata.buildCommit,
    harnessCommit: input.metadata.harnessCommit,
    recordedAt: input.metadata.recordedAt,
    result: 'pass',
    platform: {
      name: 'darwin',
      arch: input.metadata.platform.arch as 'arm64' | 'x64',
      release: input.metadata.platform.release
    },
    package: { ...input.metadata.package },
    executable: { ...input.metadata.executable },
    cleanup: {
      result: 'pass',
      applicationProcessCount: 0,
      mountedImageDetached: true,
      packageRemoved: true,
      temporaryPathsRemoved: true
    },
    interactionMatrix: {
      path: interactionMatrix.path,
      sha256: interactionMatrix.sha256
    },
    executionArtifacts: {
      playwrightReport: { path: report.path, sha256: report.sha256 },
      runnerLog: { path: runnerLog.path, sha256: runnerLog.sha256 }
    },
    totalTests: expected.length,
    interactionMatrixRowIds: interactionIds,
    workflowIds: INSTALLED_CORE_PHASE4_WORKFLOWS.map(workflow => workflow.id).sort(),
    tests: observed,
    testSources: sourceDigests(
      input.repoRoot,
      input.metadata.harnessCommit,
      INSTALLED_CORE_PHASE4_TEST_SOURCES,
      readCommittedSource
    ),
    harnessSources: sourceDigests(
      input.repoRoot,
      input.metadata.harnessCommit,
      INSTALLED_CORE_PHASE4_HARNESS_SOURCES,
      readCommittedSource
    )
  }
  validateInstalledCorePhase4Evidence({
    repoRoot: input.repoRoot,
    interactionIds,
    record,
    readCommittedSource
  })
  return record
}

const equalJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const writeCreateOnly = (outputPath: string, contents: string | Buffer): string => {
  const temporaryPath = `${outputPath}.${process.pid}.tmp`
  let failure: unknown
  try {
    writeFileSync(temporaryPath, contents, { flag: 'wx' })
    linkSync(temporaryPath, outputPath)
  } catch (error) {
    if (isRecord(error) && error.code === 'EEXIST') {
      failure = new Error(`Installed Core Phase 4 evidence already exists: ${outputPath}`)
    } else {
      failure = error
    }
  }
  try {
    unlinkSync(temporaryPath)
  } catch (error) {
    if ((!isRecord(error) || error.code !== 'ENOENT') && failure === undefined) {
      failure = error
    }
  }
  if (failure !== undefined) throw failure
  return createHash('sha256').update(contents).digest('hex')
}

export const publishInstalledCorePhase4Artifact = (
  sourcePath: string,
  outputPath: string
): string => writeCreateOnly(outputPath, readFileSync(sourcePath))

export const validateInstalledCorePhase4Evidence = (input: Readonly<{
  repoRoot: string
  interactionIds: readonly string[]
  record: unknown
  readCommittedSource?: InstalledCorePhase4CommittedSourceReader
}>): void => {
  if (!isRecord(input.record)) {
    throw new Error('Installed Core Phase 4 record is invalid')
  }
  exactKeys(input.record, [
    'schema',
    'buildCommit',
    'harnessCommit',
    'recordedAt',
    'result',
    'platform',
    'package',
    'executable',
    'cleanup',
    'interactionMatrix',
    'executionArtifacts',
    'totalTests',
    'interactionMatrixRowIds',
    'workflowIds',
    'tests',
    'testSources',
    'harnessSources'
  ], 'record')
  if (!isRecord(input.record.interactionMatrix)) {
    throw new Error('Installed Core Phase 4 interaction-matrix schema is invalid')
  }
  exactKeys(input.record.interactionMatrix, ['path', 'sha256'], 'interaction matrix')
  if (
    input.record.interactionMatrix.path !== INSTALLED_CORE_PHASE4_MATRIX_PATH ||
    typeof input.record.interactionMatrix.sha256 !== 'string'
  ) {
    throw new Error('Installed Core Phase 4 interaction-matrix reference is invalid')
  }
  requireIdentity(
    input.record.interactionMatrix.sha256,
    SHA256,
    'interaction-matrix digest'
  )
  if (!isRecord(input.record.executionArtifacts)) {
    throw new Error('Installed Core Phase 4 execution-artifact schema is invalid')
  }
  exactKeys(
    input.record.executionArtifacts,
    ['playwrightReport', 'runnerLog'],
    'execution artifacts'
  )
  for (const [label, artifact] of Object.entries(input.record.executionArtifacts)) {
    if (!isRecord(artifact)) {
      throw new Error(`Installed Core Phase 4 ${label} artifact is invalid`)
    }
    exactKeys(artifact, ['path', 'sha256'], `${label} artifact`)
    if (typeof artifact.path !== 'string' || typeof artifact.sha256 !== 'string') {
      throw new Error(`Installed Core Phase 4 ${label} artifact is invalid`)
    }
    requireIdentity(artifact.sha256, SHA256, `${label} artifact digest`)
  }
  const record = input.record as unknown as InstalledCorePhase4Evidence
  if (record.schema !== 'marktext-installed-core-phase4-evidence-v1' || record.result !== 'pass') {
    throw new Error('Installed Core Phase 4 record result is invalid')
  }
  validateMetadata(record)
  const interactionIds = sortedUnique(input.interactionIds, 'interaction row IDs')
  const expected = expectedTests(interactionIds)
  const interactionMatrix = repositoryArtifact(
    input.repoRoot,
    INSTALLED_CORE_PHASE4_MATRIX_PATH,
    'interaction matrix'
  )
  if (interactionMatrix.sha256 !== record.interactionMatrix.sha256) {
    throw new Error('Installed Core Phase 4 interaction matrix digest is stale')
  }
  const report = repositoryArtifact(
    input.repoRoot,
    record.executionArtifacts.playwrightReport.path,
    'Playwright report'
  )
  const runnerLog = repositoryArtifact(
    input.repoRoot,
    record.executionArtifacts.runnerLog.path,
    'runner log'
  )
  if (report.sha256 !== record.executionArtifacts.playwrightReport.sha256) {
    throw new Error('Installed Core Phase 4 Playwright report digest is stale')
  }
  if (runnerLog.sha256 !== record.executionArtifacts.runnerLog.sha256) {
    throw new Error('Installed Core Phase 4 runner log digest is stale')
  }
  const reportTests = observedTests(
    JSON.parse(report.bytes.toString('utf8')) as unknown,
    interactionIds
  )
  const readCommittedSource = input.readCommittedSource ??
    defaultCommittedSourceReader(input.repoRoot)
  if (
    record.totalTests !== expected.length ||
    !equalJson(record.interactionMatrixRowIds, interactionIds) ||
    !equalJson(
      record.workflowIds,
      INSTALLED_CORE_PHASE4_WORKFLOWS.map(workflow => workflow.id).sort()
    ) ||
    !equalJson(record.tests, expected) ||
    !equalJson(record.tests, reportTests) ||
    !equalJson(record.testSources, sourceDigests(
      input.repoRoot,
      record.harnessCommit,
      INSTALLED_CORE_PHASE4_TEST_SOURCES,
      readCommittedSource
    )) ||
    !equalJson(record.harnessSources, sourceDigests(
      input.repoRoot,
      record.harnessCommit,
      INSTALLED_CORE_PHASE4_HARNESS_SOURCES,
      readCommittedSource
    ))
  ) {
    throw new Error('Installed Core Phase 4 record denominator or source digests are stale')
  }
}

export const writeInstalledCorePhase4Evidence = (input: Readonly<{
  repoRoot: string
  interactionIds: readonly string[]
  outputPath: string
  record: InstalledCorePhase4Evidence
  readCommittedSource?: InstalledCorePhase4CommittedSourceReader
}>): string => {
  validateInstalledCorePhase4Evidence(input)
  const contents = `${JSON.stringify(input.record, null, 2)}\n`
  return writeCreateOnly(input.outputPath, contents)
}
