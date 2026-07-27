import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { arch, platform, tmpdir } from 'node:os'
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep
} from 'node:path'

export interface CommandRequest {
  readonly id: string
  readonly kind: 'check' | 'github' | 'test' | 'verifier'
  readonly command: readonly string[]
  readonly cwd: string
  readonly environment?: Readonly<Record<string, string>>
  readonly reportPath?: string
  readonly reportFormat?:
    | 'command-json'
    | 'github-run-json'
    | 'playwright-json'
    | 'vitest-json'
}

export interface CommandExecution {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type EvidenceCommandExecutor = (
  request: CommandRequest
) => CommandExecution | Promise<CommandExecution>

export interface Collect0009EvidenceOptions {
  readonly repoRoot: string
  readonly githubRunIds: readonly [string, string] | readonly string[]
  readonly execute?: EvidenceCommandExecutor
  readonly mountInstalledArtifact?: InstalledArtifactMounter
}

export function parse0009EvidenceArguments(
  arguments_: readonly string[]
): readonly [string, string] {
  const runIds: string[] = []
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!
    if (argument === '--github-run') {
      const value = arguments_[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error('--github-run requires a numeric run id')
      }
      runIds.push(value)
      index += 1
      continue
    }
    if (argument.startsWith('--github-run=')) {
      runIds.push(argument.slice('--github-run='.length))
      continue
    }
    throw new Error(`Unknown evidence collector argument: ${argument}`)
  }
  if (runIds.length !== 2) {
    throw new Error('--github-run must be used exactly twice')
  }
  return Object.freeze([runIds[0]!, runIds[1]!])
}

type ReportFormat = NonNullable<CommandRequest['reportFormat']>

export interface EvidenceReport {
  readonly path: string
  readonly sha256: string
  readonly format: ReportFormat
}

export interface EvidenceCommand {
  readonly id: string
  readonly kind: 'check' | 'github' | 'test'
  readonly commit: string
  readonly command: readonly string[]
  readonly cwd: string
  readonly environment: Readonly<Record<string, string>>
  readonly exitCode: 0
  readonly startedAt: string
  readonly finishedAt: string
  readonly runner: Readonly<{
    readonly name: 'github-actions' | 'playwright' | 'pnpm' | 'vitest'
    readonly version: string
  }>
  readonly platform: Readonly<{
    readonly os: string
    readonly arch: string
    readonly node: string
  }>
  readonly counts: EvidenceCounts
  readonly report: EvidenceReport
}

export interface EvidencePass {
  readonly id: string
  readonly ordinal: 1 | 2
  readonly commit: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly githubRunDatabaseId: number
  readonly commands: readonly EvidenceCommand[]
  readonly surfaces: Readonly<Record<(typeof REQUIRED_SURFACES)[number], readonly string[]>>
}

export interface EvidenceBundle {
  readonly schema: 'marktext-0009-final-evidence-v5'
  readonly commit: string
  readonly dirtyState: readonly string[]
  readonly createdAt: string
  readonly artifactHashes: Readonly<Record<string, string>>
  readonly installedArtifact: InstalledArtifactEvidence
  readonly runs: readonly [EvidencePass, EvidencePass]
}

export interface InstalledArtifactMountRequest {
  readonly artifactPath: string
  readonly format: 'dmg'
}

export interface InstalledArtifactMount {
  readonly executablePath: string
  readonly cleanup: () => void
}

export type InstalledArtifactMounter = (
  request: InstalledArtifactMountRequest
) => InstalledArtifactMount | Promise<InstalledArtifactMount>

export interface InstalledArtifactEvidence {
  readonly commit: string
  readonly format: 'dmg'
  readonly path: string
  readonly sha256: string
  readonly bytes: number
  readonly executableSha256: string
  readonly executableBytes: number
  readonly build: EvidenceCommand
}

export const FIXED_CHECK_IDS = Object.freeze([
  'repo-lint',
  'core-typecheck',
  'core-build',
  'view-typecheck',
  'desktop-typecheck',
  'desktop-build'
] as const)

export const FIXED_TEST_IDS = Object.freeze([
  'conformance',
  'core-unit',
  'document-view-unit',
  'desktop-unit',
  'property',
  'browser',
  'electron',
  'installed',
  'hostile-sinks',
  'pdf',
  'security',
  'performance',
  'docs'
] as const)

export const REQUIRED_SURFACES = Object.freeze([
  'conformance',
  'unit',
  'property',
  'browser',
  'electron',
  'installed',
  'pdf',
  'print',
  'security',
  'performance',
  'docs',
  'macos-arm64',
  'windows-x64',
  'linux-x64'
] as const)

export const REQUIRED_ARTIFACTS = Object.freeze([
  '.github/actions/setup/action.yml',
  '.github/workflows/document-core-platform.yml',
  '.gitignore',
  'package.json',
  'packages/desktop/package.json',
  'packages/desktop/test/e2e/playwright.config.ts',
  'packages/desktop/vitest.config.ts',
  'packages/document-core/package.json',
  'packages/document-core/test/plan/0009-evidence-collector.spec.ts',
  'packages/document-core/test/plan/0009-evidence-collector.ts',
  'packages/document-core/test/plan/0009-final-closure.spec.ts',
  'packages/document-core/vitest.config.ts',
  'packages/document-view/e2e/playwright.config.ts',
  'packages/document-view/e2e/vite.config.ts',
  'packages/document-view/package.json',
  'packages/document-view/vite.config.ts',
  'pnpm-lock.yaml',
  'scripts/collect0009Evidence.ts',
  'specs/migration/0009-acceptance.yml',
  'specs/migration/0009-exit-gates.yml',
  'specs/migration/0009-test-disposition.tsv',
  'specs/migration/consumer-policy.yml',
  'specs/migration/criticmarkup-retired-authority-deletion.tsv',
  'specs/migration/performance-reuse-decision.yml',
  'specs/migration/profile1-corpora.yml',
  'specs/migration/syntax-accounting-1.yml',
  'specs/migration/track-changes-interactions.tsv',
  'specs/plans/0009-criticmarkup-document-engine-rebuild.md'
] as const)

export const FIXED_SURFACE_COMMANDS = Object.freeze({
  conformance: Object.freeze(['conformance']),
  unit: Object.freeze([
    'core-unit',
    'document-view-unit',
    'desktop-unit'
  ]),
  property: Object.freeze(['property']),
  browser: Object.freeze(['browser']),
  electron: Object.freeze(['electron']),
  installed: Object.freeze(['installed']),
  pdf: Object.freeze(['hostile-sinks', 'pdf']),
  print: Object.freeze(['hostile-sinks']),
  security: Object.freeze(['hostile-sinks', 'security']),
  performance: Object.freeze(['performance']),
  docs: Object.freeze(['docs']),
  'macos-arm64': Object.freeze(['github-platforms']),
  'windows-x64': Object.freeze(['github-platforms']),
  'linux-x64': Object.freeze(['github-platforms'])
} as const)

export const PLATFORM_WORKFLOW_NAME =
  'builds and exercises Review on macOS Windows and Linux'

export const PLATFORM_JOBS = Object.freeze({
  'macos-arm64': 'document-core-review-macos-arm64',
  'windows-x64': 'document-core-review-windows-x64',
  'linux-x64': 'document-core-review-linux-x64'
} as const)

const PLATFORM_REQUIRED_STEPS = Object.freeze([
  'Build document-core and desktop',
  'Exercise Review through real Electron events'
])

type PlatformName = keyof typeof PLATFORM_JOBS

interface ValidatedGithubRun {
  readonly databaseId: number
  readonly jobs: Readonly<Record<PlatformName, number>>
}

interface EvidenceTestEntry {
  readonly file: string
  readonly title: string
  readonly project: string | null
}

export interface EvidenceCounts {
  readonly unit: 'commands' | 'jobs' | 'tests'
  readonly total: number
  readonly failures: number
  readonly retries: number
  readonly skips: number
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Evidence report must be a JSON object')
  }
  return value as Record<string, unknown>
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a nonnegative integer`)
  }
  return Number(value)
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${label} must be a positive integer`)
  }
  return Number(value)
}

const GITHUB_RUN_FRESHNESS_MS = 24 * 60 * 60 * 1_000
const CLOCK_SKEW_TOLERANCE_MS = 2_000

function githubTimestamp(value: unknown, label: string): number {
  if (typeof value !== 'string') {
    throw new TypeError(`GitHub platform run ${label} timestamp is missing`)
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`GitHub platform run ${label} timestamp is invalid`)
  }
  return parsed
}

export function validateGithubPlatformRun(
  value: unknown,
  commit: string,
  observedAt: number = Date.now()
): ValidatedGithubRun {
  const report = object(value)
  if (!Number.isFinite(observedAt)) {
    throw new TypeError('GitHub platform observation timestamp is invalid')
  }
  const createdAt = githubTimestamp(report.createdAt, 'createdAt')
  const updatedAt = githubTimestamp(report.updatedAt, 'updatedAt')
  if (updatedAt < createdAt) {
    throw new Error('GitHub platform run timestamp order is invalid')
  }
  if (updatedAt > observedAt + CLOCK_SKEW_TOLERANCE_MS) {
    throw new Error('GitHub platform run timestamp is in the future')
  }
  if (observedAt - updatedAt > GITHUB_RUN_FRESHNESS_MS) {
    throw new Error(
      'GitHub platform run is not fresh within the required 24 hours'
    )
  }
  if (
    report.attempt !== 1 ||
    report.status !== 'completed' ||
    report.conclusion !== 'success' ||
    report.headSha !== commit ||
    report.workflowName !== PLATFORM_WORKFLOW_NAME
  ) {
    throw new Error(
      'GitHub platform run must be a first-attempt successful completed run for the current commit and exact workflow'
    )
  }
  if (
    typeof report.url !== 'string' ||
    !/^https:\/\/github\.com\/.+\/actions\/runs\/\d+$/.test(report.url)
  ) {
    throw new Error('GitHub platform run must have its canonical actions URL')
  }
  if (!Array.isArray(report.jobs)) {
    throw new TypeError('GitHub platform run jobs must be an array')
  }
  const expectedNames = Object.values(PLATFORM_JOBS)
  const jobsByName = new Map<string, number>()
  for (const rawJob of report.jobs) {
    const job = object(rawJob)
    if (job.conclusion !== 'success') {
      throw new Error('Every GitHub platform job must conclude successfully')
    }
    if (typeof job.name !== 'string' || jobsByName.has(job.name)) {
      throw new Error('GitHub platform job names must be unique strings')
    }
    jobsByName.set(
      job.name,
      positiveInteger(job.databaseId, `${job.name} databaseId`)
    )
    if (!Array.isArray(job.steps) || job.steps.length === 0) {
      throw new Error('Every GitHub platform job must report its platform job steps')
    }
    const stepNames = new Set<string>()
    for (const rawStep of job.steps) {
      const step = object(rawStep)
      if (
        typeof step.name !== 'string' ||
        stepNames.has(step.name) ||
        step.conclusion !== 'success'
      ) {
        throw new Error(
          'Every GitHub platform job step must be uniquely named and successful'
        )
      }
      stepNames.add(step.name)
    }
    if (PLATFORM_REQUIRED_STEPS.some((name) => !stepNames.has(name))) {
      throw new Error(
        'Every GitHub platform job must execute all required platform job steps'
      )
    }
  }
  if (
    jobsByName.size !== expectedNames.length ||
    expectedNames.some((name) => !jobsByName.has(name))
  ) {
    throw new Error(
      `GitHub platform run must contain exactly: ${expectedNames.join(', ')}`
    )
  }
  return Object.freeze({
    databaseId: positiveInteger(report.databaseId, 'run databaseId'),
    jobs: Object.freeze({
      'macos-arm64': jobsByName.get(PLATFORM_JOBS['macos-arm64'])!,
      'windows-x64': jobsByName.get(PLATFORM_JOBS['windows-x64'])!,
      'linux-x64': jobsByName.get(PLATFORM_JOBS['linux-x64'])!
    })
  })
}

function vitestTestEntries(
  report: Record<string, unknown>
): readonly EvidenceTestEntry[] {
  if (!Array.isArray(report.testResults)) {
    throw new TypeError('Vitest evidence must contain named test entries')
  }
  const entries: EvidenceTestEntry[] = []
  for (const rawSuite of report.testResults) {
    const suite = object(rawSuite)
    if (
      typeof suite.name !== 'string' ||
      suite.name.length === 0 ||
      suite.status !== 'passed' ||
      !Array.isArray(suite.assertionResults)
    ) {
      throw new Error('Vitest evidence has an invalid suite entry')
    }
    for (const rawAssertion of suite.assertionResults) {
      const assertion = object(rawAssertion)
      if (
        typeof assertion.title !== 'string' ||
        assertion.title.length === 0 ||
        assertion.status !== 'passed' ||
        !Array.isArray(assertion.failureMessages) ||
        assertion.failureMessages.length !== 0
      ) {
        throw new Error('Vitest evidence has a non-passing test entry')
      }
      entries.push(Object.freeze({
        file: suite.name,
        title: assertion.title,
        project: null
      }))
    }
  }
  return Object.freeze(entries)
}

function playwrightTestEntries(
  report: Record<string, unknown>
): readonly EvidenceTestEntry[] {
  if (!Array.isArray(report.suites)) {
    throw new TypeError('Playwright evidence must contain named test entries')
  }
  const entries: EvidenceTestEntry[] = []
  const visitSuites = (
    rawSuites: readonly unknown[],
    inheritedFile: string | null = null
  ): void => {
    for (const rawSuite of rawSuites) {
      const suite = object(rawSuite)
      const suiteFile = typeof suite.file === 'string'
        ? suite.file
        : inheritedFile
      if (suite.suites !== undefined) {
        if (!Array.isArray(suite.suites)) {
          throw new TypeError('Playwright evidence has invalid nested suites')
        }
        visitSuites(suite.suites, suiteFile)
      }
      if (suite.specs === undefined) continue
      if (!Array.isArray(suite.specs)) {
        throw new TypeError('Playwright evidence has invalid specs')
      }
      for (const rawSpec of suite.specs) {
        const spec = object(rawSpec)
        const specFile = typeof spec.file === 'string'
          ? spec.file
          : suiteFile
        if (
          typeof spec.title !== 'string' ||
          spec.title.length === 0 ||
          typeof specFile !== 'string' ||
          specFile.length === 0 ||
          !Array.isArray(spec.tests) ||
          spec.tests.length === 0
        ) {
          throw new Error('Playwright evidence has an invalid spec entry')
        }
        for (const rawTest of spec.tests) {
          const test = object(rawTest)
          if (
            typeof test.projectName !== 'string' ||
            test.projectName.length === 0 ||
            test.expectedStatus !== 'passed' ||
            !Array.isArray(test.results) ||
            test.results.length !== 1
          ) {
            throw new Error('Playwright evidence has an invalid test entry')
          }
          const result = object(test.results[0])
          if (result.status !== 'passed' || result.retry !== 0) {
            throw new Error('Playwright evidence has a non-passing test entry')
          }
          entries.push(Object.freeze({
            file: specFile,
            title: spec.title,
            project: test.projectName
          }))
        }
      }
    }
  }
  visitSuites(report.suites)
  return Object.freeze(entries)
}

export function validateVitestReport(value: unknown): EvidenceCounts {
  const report = object(value)
  const total = positiveInteger(report.numTotalTests, 'Vitest total tests')
  const passed = nonnegativeInteger(
    report.numPassedTests,
    'Vitest passed tests'
  )
  const failures = nonnegativeInteger(
    report.numFailedTests,
    'Vitest failed tests'
  )
  const skips = nonnegativeInteger(
    report.numPendingTests,
    'Vitest pending tests'
  )
  if (
    report.success !== true ||
    failures !== 0 ||
    skips !== 0 ||
    passed !== total
  ) {
    throw new Error(
      'Vitest evidence must be successful with positive tests and zero failures or skips'
    )
  }
  const entries = vitestTestEntries(report)
  if (entries.length !== total) {
    throw new Error(
      `Vitest test entries ${String(entries.length)} do not match total ${String(total)}`
    )
  }
  return Object.freeze({
    unit: 'tests',
    total,
    failures,
    retries: 0,
    skips
  })
}

export function validatePlaywrightReport(value: unknown): EvidenceCounts {
  const report = object(value)
  const config = object(report.config)
  if (
    !Array.isArray(config.projects) ||
    config.projects.length === 0 ||
    config.projects.some((project) => object(project).retries !== 0)
  ) {
    throw new Error('Every collected Playwright project must configure zero retries')
  }
  if (!Array.isArray(report.errors) || report.errors.length !== 0) {
    throw new Error('Playwright evidence must contain no runner errors')
  }
  const stats = object(report.stats)
  const total = positiveInteger(stats.expected, 'Playwright expected tests')
  const failures = nonnegativeInteger(
    stats.unexpected,
    'Playwright unexpected tests'
  )
  const retries = nonnegativeInteger(stats.flaky, 'Playwright flaky tests')
  const skips = nonnegativeInteger(stats.skipped, 'Playwright skipped tests')
  if (failures !== 0 || retries !== 0 || skips !== 0) {
    throw new Error(
      'Playwright evidence must have positive tests and zero failures, retries, or skips'
    )
  }
  const entries = playwrightTestEntries(report)
  if (entries.length !== total) {
    throw new Error(
      `Playwright test entries ${String(entries.length)} do not match total ${String(total)}`
    )
  }
  return Object.freeze({
    unit: 'tests',
    total,
    failures,
    retries,
    skips
  })
}

interface FixedCheck {
  readonly id: (typeof FIXED_CHECK_IDS)[number]
  readonly cwd: string
  readonly pnpmArguments: readonly string[]
}

interface FixedTest {
  readonly id: (typeof FIXED_TEST_IDS)[number]
  readonly runner: 'playwright' | 'vitest'
  readonly cwd: string
  readonly targets: readonly string[]
  readonly config: string
  readonly project?: 'chromium' | 'installed' | 'unpacked'
  readonly environment?: Readonly<Record<string, string>>
}

const PROPERTY_TEST_TARGETS = Object.freeze([
  'test/language-engine/recursive-matrix.spec.ts',
  'test/language-engine/resource-budgets.spec.ts',
  'test/language-engine/cross-consumer-resource-matrix.spec.ts',
  'test/language-engine/syntax-accounting-contract.spec.ts',
  'test/language-engine/projection-planning-linearity.spec.ts'
] as const)

const FIXED_CHECKS: readonly FixedCheck[] = Object.freeze([
  {
    id: 'repo-lint',
    cwd: '.',
    pnpmArguments: Object.freeze(['exec', 'eslint', '--no-cache', '.'])
  },
  {
    id: 'core-typecheck',
    cwd: '.',
    pnpmArguments: Object.freeze([
      '-C',
      'packages/document-core',
      'run',
      'typecheck'
    ])
  },
  {
    id: 'core-build',
    cwd: '.',
    pnpmArguments: Object.freeze([
      '-C',
      'packages/document-core',
      'run',
      'build'
    ])
  },
  {
    id: 'view-typecheck',
    cwd: '.',
    pnpmArguments: Object.freeze([
      '-C',
      'packages/document-view',
      'run',
      'typecheck'
    ])
  },
  {
    id: 'desktop-typecheck',
    cwd: '.',
    pnpmArguments: Object.freeze([
      '--filter',
      'marktext',
      'run',
      'typecheck'
    ])
  },
  {
    id: 'desktop-build',
    cwd: '.',
    pnpmArguments: Object.freeze([
      '--filter',
      'marktext',
      'run',
      'build'
    ])
  }
])

function fixedTests(
  installedArtifact: Readonly<{
    readonly executablePath: string
    readonly sha256: string
    readonly executableSha256: string
  }>,
  expectedCommit: string
): readonly FixedTest[] {
  return Object.freeze([
    {
      id: 'conformance',
      runner: 'vitest',
      cwd: 'packages/document-core',
      targets: Object.freeze(['test/language-engine']),
      config: 'vitest.config.ts'
    },
    {
      id: 'core-unit',
      runner: 'vitest',
      cwd: 'packages/document-core',
      targets: Object.freeze([
        'test/document-session',
        'test/materialize',
        'test/package-boundary',
        'test/view',
        'test/wire'
      ]),
      config: 'vitest.config.ts'
    },
    {
      id: 'document-view-unit',
      runner: 'vitest',
      cwd: 'packages/document-view',
      targets: Object.freeze([]),
      config: 'vite.config.ts'
    },
    {
      id: 'desktop-unit',
      runner: 'vitest',
      cwd: 'packages/desktop',
      targets: Object.freeze(['test/unit']),
      config: 'vitest.config.ts'
    },
    {
      id: 'property',
      runner: 'vitest',
      cwd: 'packages/document-core',
      targets: PROPERTY_TEST_TARGETS,
      config: 'vitest.config.ts'
    },
    {
      id: 'browser',
      runner: 'playwright',
      cwd: 'packages/document-view',
      targets: Object.freeze([]),
      config: 'e2e/playwright.config.ts',
      project: 'chromium'
    },
    {
      id: 'electron',
      runner: 'playwright',
      cwd: 'packages/desktop',
      targets: Object.freeze([]),
      config: 'test/e2e/playwright.config.ts',
      project: 'unpacked',
      environment: Object.freeze({ MARKTEXT_TEST_BACKGROUND: '1' })
    },
    {
      id: 'installed',
      runner: 'playwright',
      cwd: 'packages/desktop',
      targets: Object.freeze([]),
      config: 'test/e2e/playwright.config.ts',
      project: 'installed',
      environment: Object.freeze({
        MARKTEXT_PACKAGED_APP: installedArtifact.executablePath,
        MARKTEXT_EXPECTED_COMMIT: expectedCommit,
        MARKTEXT_EXPECTED_ARTIFACT_SHA256: installedArtifact.sha256,
        MARKTEXT_EXPECTED_EXECUTABLE_SHA256:
          installedArtifact.executableSha256,
        MARKTEXT_TEST_BACKGROUND: '1'
      })
    },
    {
      id: 'hostile-sinks',
      runner: 'playwright',
      cwd: 'packages/desktop',
      targets: Object.freeze([
        'test/e2e/document-core-hostile-sinks.spec.ts'
      ]),
      config: 'test/e2e/playwright.config.ts',
      project: 'unpacked',
      environment: Object.freeze({ MARKTEXT_TEST_BACKGROUND: '1' })
    },
    {
      id: 'pdf',
      runner: 'playwright',
      cwd: 'packages/desktop',
      targets: Object.freeze(['test/e2e/export-pdf.spec.ts']),
      config: 'test/e2e/playwright.config.ts',
      project: 'unpacked',
      environment: Object.freeze({ MARKTEXT_TEST_BACKGROUND: '1' })
    },
    {
      id: 'security',
      runner: 'playwright',
      cwd: 'packages/desktop',
      targets: Object.freeze([
        'test/e2e/xss.spec.ts',
        'test/e2e/context-isolation.spec.ts'
      ]),
      config: 'test/e2e/playwright.config.ts',
      project: 'unpacked',
      environment: Object.freeze({ MARKTEXT_TEST_BACKGROUND: '1' })
    },
    {
      id: 'performance',
      runner: 'playwright',
      cwd: 'packages/desktop',
      targets: Object.freeze([
        'test/e2e/critic-markup-perf.spec.ts',
        'test/e2e/document-core-max-document-perf.spec.ts'
      ]),
      config: 'test/e2e/playwright.config.ts',
      project: 'unpacked',
      environment: Object.freeze({ MARKTEXT_TEST_BACKGROUND: '1' })
    },
    {
      id: 'docs',
      runner: 'vitest',
      cwd: 'packages/document-core',
      targets: Object.freeze([
        'test/plan/0009-archive-absence.spec.ts',
        'test/plan/0009-control-plane.spec.ts',
        'test/plan/0009-doc-consistency.spec.ts',
        'test/plan/0009-evidence-collector.spec.ts',
        'test/plan/0009-retired-authority-absence.spec.ts'
      ]),
      config: 'vitest.config.ts'
    }
  ])
}

interface ManifestTarget {
  readonly kind: 'test' | 'workflow'
  readonly path: string
  readonly title: string
}

interface ManifestRow {
  readonly target: ManifestTarget
  readonly auxiliaryTargets?: readonly ManifestTarget[]
}

interface AcceptanceManifest {
  readonly acceptance: readonly ManifestRow[]
}

interface ExitManifest {
  readonly phases: readonly ManifestRow[]
  readonly closure: readonly ManifestRow[]
}

export interface ExpectedEvidenceTarget {
  readonly path: string
  readonly title: string
}

const FIXED_TEST_REPORT_TARGETS:
Readonly<Partial<Record<(typeof FIXED_TEST_IDS)[number],
readonly ExpectedEvidenceTarget[]>>> = Object.freeze({
  'document-view-unit': Object.freeze([Object.freeze({
    path:
      'packages/document-view/src/documentCore/__tests__/browser-input.spec.ts',
    title:
      'routes real copy, cut, and null-data paste gestures through host/core seams'
  })]),
  browser: Object.freeze([Object.freeze({
    path: 'packages/document-view/e2e/tests/production-view.spec.ts',
    title: 'renders engine blocks with CriticMarkup in a real browser'
  })]),
  pdf: Object.freeze([Object.freeze({
    path: 'packages/desktop/test/e2e/export-pdf.spec.ts',
    title:
      'prints all five Critic forms and the Original projection to distinct PDF artifacts'
  })]),
  security: Object.freeze([
    Object.freeze({
      path: 'packages/desktop/test/e2e/xss.spec.ts',
      title: 'Load malicious document'
    }),
    Object.freeze({
      path: 'packages/desktop/test/e2e/context-isolation.spec.ts',
      title:
        'contextBridge active, nodeIntegration disabled, no preload leakage'
    })
  ])
})

function evidenceCommandForTarget(target: ManifestTarget): string {
  if (target.kind === 'workflow') return 'github-platforms'
  if (
    target.path ===
      'packages/document-core/test/plan/0009-final-closure.spec.ts'
  ) {
    return 'final-verifier'
  }
  if (target.path.startsWith('packages/document-core/test/plan/')) {
    return 'docs'
  }
  if (target.path.startsWith('packages/document-core/test/language-engine/')) {
    const relative = target.path.slice('packages/document-core/'.length)
    return PROPERTY_TEST_TARGETS.some(path => path === relative)
      ? 'property'
      : 'conformance'
  }
  if (target.path.startsWith('packages/document-core/')) return 'core-unit'
  if (target.path.startsWith('packages/document-view/e2e/')) return 'browser'
  if (target.path.startsWith('packages/document-view/')) {
    return 'document-view-unit'
  }
  if (target.path.startsWith('packages/desktop/test/unit/')) {
    return 'desktop-unit'
  }
  if (target.path.includes('/installed-')) return 'installed'
  if (
    target.path ===
      'packages/desktop/test/e2e/document-core-hostile-sinks.spec.ts'
  ) {
    return 'hostile-sinks'
  }
  if (target.path === 'packages/desktop/test/e2e/export-pdf.spec.ts') {
    return 'pdf'
  }
  if (
    target.path === 'packages/desktop/test/e2e/xss.spec.ts' ||
    target.path === 'packages/desktop/test/e2e/context-isolation.spec.ts'
  ) {
    return 'security'
  }
  if (
    target.path ===
      'packages/desktop/test/e2e/critic-markup-perf.spec.ts' ||
    target.path ===
      'packages/desktop/test/e2e/document-core-max-document-perf.spec.ts'
  ) {
    return 'performance'
  }
  if (target.path.startsWith('packages/desktop/test/e2e/')) return 'electron'
  throw new Error(
    `Plan 0009 evidence has no fixed command for ${target.path}`
  )
}

export function expectedEvidenceTargets(
  repoRoot: string,
  commandId: string
): readonly ExpectedEvidenceTarget[] {
  const acceptance = readJson<AcceptanceManifest>(
    resolve(repoRoot, 'specs/migration/0009-acceptance.yml')
  )
  const exits = readJson<ExitManifest>(
    resolve(repoRoot, 'specs/migration/0009-exit-gates.yml')
  )
  const manifestTargets = [
    ...acceptance.acceptance.flatMap(row => [
      row.target,
      ...(row.auxiliaryTargets ?? [])
    ]),
    ...exits.phases.map(row => row.target),
    ...exits.closure.map(row => row.target)
  ].filter(target => (
    target.kind === 'test' &&
    evidenceCommandForTarget(target) === commandId
  ))
  const targets = [
    ...manifestTargets,
    ...(FIXED_TEST_REPORT_TARGETS[
      commandId as (typeof FIXED_TEST_IDS)[number]
    ] ?? [])
  ]
  const unique = new Map<string, ExpectedEvidenceTarget>()
  for (const target of targets) {
    const key = `${target.path}\0${target.title}`
    unique.set(key, Object.freeze({
      path: target.path,
      title: target.title
    }))
  }
  return Object.freeze([...unique.values()])
}

function reportedEvidencePaths(
  repoRoot: string,
  cwd: string,
  file: string,
  format: 'playwright-json' | 'vitest-json',
  commandId: string
): ReadonlySet<string> {
  const candidates = new Set<string>()
  const add = (absolute: string): void => {
    candidates.add(posixRelative(repoRoot, absolute))
  }
  if (isAbsolute(file)) {
    add(file)
  } else {
    add(resolve(cwd, file))
    add(resolve(repoRoot, file))
    if (format === 'playwright-json') {
      add(resolve(
        cwd,
        commandId === 'browser' ? 'e2e/tests' : 'test/e2e',
        file
      ))
    }
  }
  return candidates
}

export function validateExpectedEvidenceTargets(
  value: unknown,
  format: 'playwright-json' | 'vitest-json',
  repoRoot: string,
  cwd: string,
  commandId: string,
  project?: string
): void {
  const report = object(value)
  const entries = format === 'vitest-json'
    ? vitestTestEntries(report)
    : playwrightTestEntries(report)
  const expected = expectedEvidenceTargets(repoRoot, commandId)
  if (
    format === 'playwright-json' &&
    (project === undefined ||
      entries.some(entry => entry.project !== project))
  ) {
    throw new Error(
      `Playwright evidence for ${commandId} must contain only project ${String(project)}`
    )
  }
  for (const target of expected) {
    const matches = entries.filter(entry => (
      entry.title === target.title &&
      reportedEvidencePaths(
        repoRoot,
        cwd,
        entry.file,
        format,
        commandId
      ).has(target.path) &&
      (format === 'vitest-json' || entry.project === project)
    ))
    if (matches.length !== 1) {
      throw new Error(
        `Manifest target must appear exactly once in ${commandId} evidence: ` +
        `${target.path} :: ${target.title}; found ${String(matches.length)}`
      )
    }
  }
}

function sha256(data: string | NodeJS.ArrayBufferView): string {
  return createHash('sha256').update(data).digest('hex')
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function packageVersion(repoRoot: string, packagePath: string): string {
  const value = readJson<{ readonly version?: unknown }>(
    resolve(repoRoot, packagePath)
  ).version
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${packagePath} must declare a version`)
  }
  return value
}

function pnpmVersion(repoRoot: string): string {
  const value = readJson<{ readonly packageManager?: unknown }>(
    resolve(repoRoot, 'package.json')
  ).packageManager
  const match = typeof value === 'string'
    ? /^pnpm@(\d+\.\d+\.\d+)$/.exec(value)
    : null
  const version = match?.[1]
  if (version === undefined) {
    throw new TypeError('package.json packageManager must pin pnpm exactly')
  }
  return version
}

function githubNodeVersion(repoRoot: string): string {
  const action = readFileSync(
    resolve(repoRoot, '.github/actions/setup/action.yml'),
    'utf8'
  )
  const match = /default:\s*['"]?(\d+\.\d+\.\d+)['"]?/.exec(action)
  const version = match?.[1]
  if (version === undefined) {
    throw new TypeError('The GitHub setup action must pin its default Node version')
  }
  return `v${version}`
}

function posixRelative(repoRoot: string, path: string): string {
  const value = relative(repoRoot, path).split(sep).join('/')
  if (value.length === 0) return '.'
  if (value === '..' || value.startsWith('../')) {
    throw new Error(`Evidence path must stay inside the repository: ${path}`)
  }
  return value
}

async function defaultExecute(
  request: CommandRequest
): Promise<CommandExecution> {
  const [executable, ...arguments_] = request.command
  if (executable === undefined) {
    throw new TypeError(`${request.id} has no executable`)
  }
  return await new Promise<CommandExecution>((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      cwd: request.cwd,
      env: {
        ...process.env,
        ...request.environment
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk)
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk)
      process.stderr.write(chunk)
    })
    child.once('error', reject)
    child.once('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      })
    })
  })
}

function dirtyState(repoRoot: string): readonly string[] {
  return Object.freeze(
    execFileSync(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      { cwd: repoRoot, encoding: 'utf8' }
    )
      .split(/\r?\n/)
      .filter(Boolean)
  )
}

function currentCommit(repoRoot: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8'
  }).trim()
}

function assertIgnored(repoRoot: string, path: string): void {
  const relativePath = posixRelative(repoRoot, path)
  try {
    execFileSync('git', ['check-ignore', '--quiet', relativePath], {
      cwd: repoRoot
    })
  } catch {
    throw new Error(`Evidence output must be gitignored: ${relativePath}`)
  }
}

function assertRepositoryState(repoRoot: string, commit: string): void {
  if (currentCommit(repoRoot) !== commit) {
    throw new Error('Repository HEAD changed during plan 0009 evidence collection')
  }
  const dirty = dirtyState(repoRoot)
  if (dirty.length > 0) {
    throw new Error(
      `Plan 0009 evidence command dirtied the worktree:\n${dirty.join('\n')}`
    )
  }
}

function artifactHashes(
  repoRoot: string,
  commit: string
): Readonly<Record<string, string>> {
  const entries = REQUIRED_ARTIFACTS.map((path): readonly [string, string] => {
    let committed: Buffer
    try {
      committed = execFileSync('git', ['show', `${commit}:${path}`], {
        cwd: repoRoot,
        maxBuffer: 64 * 1024 * 1024
      })
    } catch {
      throw new Error(`Required evidence artifact is not committed: ${path}`)
    }
    return [path, sha256(committed)]
  })
  return Object.freeze(Object.fromEntries(entries))
}

function reportEvidence(
  repoRoot: string,
  path: string,
  format: ReportFormat
): EvidenceReport {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`Evidence command did not create its report: ${path}`)
  }
  assertIgnored(repoRoot, path)
  return Object.freeze({
    path: posixRelative(repoRoot, path),
    sha256: sha256(readFileSync(path)),
    format
  })
}

function localPlatform(): EvidenceCommand['platform'] {
  return Object.freeze({
    os: platform(),
    arch: arch(),
    node: process.version
  })
}

interface InstalledArtifactBuildPlan {
  readonly artifactPath: string
  readonly format: 'dmg'
  readonly pnpmArguments: readonly string[]
}

interface CollectedInstalledArtifact {
  readonly evidence: InstalledArtifactEvidence
  readonly executablePath: string
  readonly cleanup: () => void
}

function installedArtifactBuildPlan(
  repoRoot: string
): InstalledArtifactBuildPlan {
  if (platform() !== 'darwin' || (arch() !== 'arm64' && arch() !== 'x64')) {
    throw new Error(
      'Plan 0009 installed-artifact evidence must build and mount a macOS arm64 or x64 DMG'
    )
  }
  const version = packageVersion(repoRoot, 'packages/desktop/package.json')
  return Object.freeze({
    artifactPath: resolve(
      repoRoot,
      'dist',
      `marktext-mac-${arch()}-${version}.dmg`
    ),
    format: 'dmg',
    pnpmArguments: Object.freeze([
      'run',
      `build:mac:${arch()}`
    ])
  })
}

function installedArtifactBuildRequest(
  repoRoot: string,
  reportRoot: string,
  plan: InstalledArtifactBuildPlan,
  pnpm: string
): CommandRequest {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return Object.freeze({
    id: 'installed-artifact-build',
    kind: 'check',
    command: Object.freeze([
      npm,
      'exec',
      '--yes',
      `--package=pnpm@${pnpm}`,
      '--',
      'pnpm',
      ...plan.pnpmArguments
    ]),
    cwd: repoRoot,
    environment: Object.freeze({
      MARKTEXT_EXPECTED_ARTIFACT_PATH: plan.artifactPath
    }),
    reportPath: resolve(
      reportRoot,
      'installed-artifact-build.command.json'
    ),
    reportFormat: 'command-json'
  })
}

function mountMacDmg(
  request: InstalledArtifactMountRequest
): InstalledArtifactMount {
  const mountPoint = mkdtempSync(
    resolve(tmpdir(), 'marktext-0009-installed-')
  )
  let attached = false
  try {
    execFileSync('hdiutil', [
      'attach',
      request.artifactPath,
      '-nobrowse',
      '-readonly',
      '-mountpoint',
      mountPoint
    ])
    attached = true
    const executablePath = resolve(
      mountPoint,
      'marktext.app',
      'Contents',
      'MacOS',
      'marktext'
    )
    if (
      !existsSync(executablePath) ||
      !statSync(executablePath).isFile()
    ) {
      throw new Error(
        `Mounted plan 0009 DMG has no MarkText executable: ${executablePath}`
      )
    }
    return Object.freeze({
      executablePath,
      cleanup(): void {
        try {
          execFileSync('hdiutil', ['detach', mountPoint, '-quiet'])
        } finally {
          rmSync(mountPoint, { recursive: true, force: true })
        }
      }
    })
  } catch (error) {
    if (attached) {
      try {
        execFileSync('hdiutil', ['detach', mountPoint, '-quiet'])
      } catch {
        // Preserve the original mount/admission failure.
      }
    }
    rmSync(mountPoint, { recursive: true, force: true })
    throw error
  }
}

async function collectInstalledArtifact(
  options: Readonly<{
    readonly repoRoot: string
    readonly collectionRoot: string
    readonly commit: string
    readonly execute: EvidenceCommandExecutor
    readonly pnpmVersion: string
    readonly mount: InstalledArtifactMounter
  }>
): Promise<CollectedInstalledArtifact> {
  const plan = installedArtifactBuildPlan(options.repoRoot)
  if (existsSync(plan.artifactPath)) {
    renameSync(
      plan.artifactPath,
      resolve(
        options.collectionRoot,
        `preexisting-${randomUUID()}-${basename(plan.artifactPath)}`
      )
    )
  }
  const request = installedArtifactBuildRequest(
    options.repoRoot,
    options.collectionRoot,
    plan,
    options.pnpmVersion
  )
  const build = await runCheck(
    options.execute,
    request,
    options.repoRoot,
    options.commit,
    options.pnpmVersion
  )
  if (
    !existsSync(plan.artifactPath) ||
    !statSync(plan.artifactPath).isFile()
  ) {
    throw new Error(
      `Installed-artifact build did not create ${plan.artifactPath}`
    )
  }
  const artifactStat = statSync(plan.artifactPath)
  if (artifactStat.mtimeMs < Date.parse(build.startedAt) - 2_000) {
    throw new Error('Installed-artifact build output predates its build command')
  }
  const artifactSha256 = sha256(readFileSync(plan.artifactPath))
  const mounted = await options.mount(Object.freeze({
    artifactPath: plan.artifactPath,
    format: plan.format
  }))
  if (
    !isAbsolute(mounted.executablePath) ||
    !existsSync(mounted.executablePath) ||
    !statSync(mounted.executablePath).isFile()
  ) {
    mounted.cleanup()
    throw new Error(
      'Installed-artifact mount must expose one existing absolute executable'
    )
  }
  const executableStat = statSync(mounted.executablePath)
  return Object.freeze({
    executablePath: mounted.executablePath,
    cleanup: mounted.cleanup,
    evidence: Object.freeze({
      commit: options.commit,
      format: plan.format,
      path: posixRelative(options.repoRoot, plan.artifactPath),
      sha256: artifactSha256,
      bytes: artifactStat.size,
      executableSha256: sha256(readFileSync(mounted.executablePath)),
      executableBytes: executableStat.size,
      build
    })
  })
}

function assertInstalledArtifactUnchanged(
  repoRoot: string,
  artifact: CollectedInstalledArtifact
): void {
  const sourcePath = resolve(repoRoot, artifact.evidence.path)
  if (
    !existsSync(sourcePath) ||
    !statSync(sourcePath).isFile() ||
    statSync(sourcePath).size !== artifact.evidence.bytes ||
    sha256(readFileSync(sourcePath)) !== artifact.evidence.sha256
  ) {
    throw new Error('The collector-built installed artifact changed during evidence')
  }
  if (
    !existsSync(artifact.executablePath) ||
    !statSync(artifact.executablePath).isFile() ||
    statSync(artifact.executablePath).size !==
      artifact.evidence.executableBytes ||
    sha256(readFileSync(artifact.executablePath)) !==
      artifact.evidence.executableSha256
  ) {
    throw new Error(
      'The mounted installed executable changed during evidence'
    )
  }
}

function checkRequest(
  repoRoot: string,
  reportRoot: string,
  check: FixedCheck,
  pnpm: string
): CommandRequest {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return Object.freeze({
    id: check.id,
    kind: 'check',
    command: Object.freeze([
      npm,
      'exec',
      '--yes',
      `--package=pnpm@${pnpm}`,
      '--',
      'pnpm',
      ...check.pnpmArguments
    ]),
    cwd: resolve(repoRoot, check.cwd),
    environment: Object.freeze({}),
    reportPath: resolve(reportRoot, `${check.id}.command.json`),
    reportFormat: 'command-json'
  })
}

function testRequest(
  repoRoot: string,
  reportRoot: string,
  test: FixedTest
): CommandRequest {
  const reportFormat = test.runner === 'vitest'
    ? 'vitest-json'
    : 'playwright-json'
  const reportPath = resolve(reportRoot, `${test.id}.${reportFormat}.json`)
  if (test.runner === 'vitest') {
    return Object.freeze({
      id: test.id,
      kind: 'test',
      command: Object.freeze([
        process.execPath,
        resolve(repoRoot, 'node_modules/vitest/vitest.mjs'),
        'run',
        ...test.targets,
        '--config',
        test.config,
        '--reporter=json',
        `--outputFile=${reportPath}`,
        '--allowOnly=false',
        '--retry=0'
      ]),
      cwd: resolve(repoRoot, test.cwd),
      environment: Object.freeze({}),
      reportPath,
      reportFormat
    })
  }
  const environment = Object.freeze({
    ...(test.id === 'browser'
      ? { PLAYWRIGHT_USE_BUNDLED_CHROMIUM: '1' }
      : {}),
    ...test.environment,
    PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath
  })
  return Object.freeze({
    id: test.id,
    kind: 'test',
    command: Object.freeze([
      process.execPath,
      resolve(repoRoot, 'node_modules/@playwright/test/cli.js'),
      'test',
      ...test.targets,
      '--config',
      test.config,
      ...(test.project === undefined
        ? []
        : [`--project=${test.project}`]),
      '--workers=1',
      '--forbid-only',
      '--retries=0',
      '--reporter=json'
    ]),
    cwd: resolve(repoRoot, test.cwd),
    environment,
    reportPath,
    reportFormat
  })
}

function githubRequest(
  repoRoot: string,
  reportRoot: string,
  runId: string
): CommandRequest {
  return Object.freeze({
    id: 'github-platforms',
    kind: 'github',
    command: Object.freeze([
      'gh',
      'run',
      'view',
      runId,
      '--exit-status',
      '--json',
      [
        'attempt',
        'conclusion',
        'createdAt',
        'databaseId',
        'headSha',
        'jobs',
        'status',
        'updatedAt',
        'url',
        'workflowName'
      ].join(',')
    ]),
    cwd: repoRoot,
    environment: Object.freeze({}),
    reportPath: resolve(reportRoot, 'github-platforms.github-run.json'),
    reportFormat: 'github-run-json'
  })
}

export function expectedEvidenceRequest(options: Readonly<{
  readonly id: string
  readonly repoRoot: string
  readonly reportPath: string
  readonly packagedApp?: string
  readonly installedArtifactSha256?: string
  readonly installedExecutableSha256?: string
  readonly githubRunId?: string
}>): CommandRequest {
  const check = FIXED_CHECKS.find((candidate) => candidate.id === options.id)
  if (check !== undefined) {
    return checkRequest(
      options.repoRoot,
      dirname(options.reportPath),
      check,
      pnpmVersion(options.repoRoot)
    )
  }
  const test = fixedTests(
    {
      executablePath: options.packagedApp ?? '',
      sha256: options.installedArtifactSha256 ?? '',
      executableSha256: options.installedExecutableSha256 ?? ''
    },
    currentCommit(options.repoRoot)
  ).find(
    (candidate) => candidate.id === options.id
  )
  if (test !== undefined) {
    return testRequest(
      options.repoRoot,
      dirname(options.reportPath),
      test
    )
  }
  if (options.id === 'github-platforms') {
    if (options.githubRunId === undefined) {
      throw new Error('github-platforms evidence requires its GitHub run id')
    }
    return githubRequest(
      options.repoRoot,
      dirname(options.reportPath),
      options.githubRunId
    )
  }
  throw new Error(`Unknown plan 0009 evidence command id: ${options.id}`)
}

function commandFailure(request: CommandRequest, execution: CommandExecution): Error {
  const detail = execution.stderr.trim() || execution.stdout.trim()
  return new Error(
    `${request.id} failed with exit code ${String(execution.exitCode)}` +
      (detail.length === 0 ? '' : `:\n${detail.slice(-8_000)}`)
  )
}

async function runCheck(
  execute: EvidenceCommandExecutor,
  request: CommandRequest,
  repoRoot: string,
  commit: string,
  runnerVersion: string
): Promise<EvidenceCommand> {
  const startedAt = new Date().toISOString()
  const execution = await execute(request)
  const finishedAt = new Date().toISOString()
  if (execution.exitCode !== 0) throw commandFailure(request, execution)
  writeFileSync(request.reportPath!, JSON.stringify({
    schema: 'marktext-0009-command-report-v1',
    id: request.id,
    command: request.command,
    cwd: posixRelative(repoRoot, request.cwd),
    environment: request.environment ?? {},
    exitCode: execution.exitCode,
    startedAt,
    finishedAt,
    stdout: execution.stdout,
    stderr: execution.stderr
  }, null, 2) + '\n')
  assertRepositoryState(repoRoot, commit)
  return Object.freeze({
    id: request.id,
    kind: 'check',
    commit,
    command: request.command,
    cwd: posixRelative(repoRoot, request.cwd),
    environment: Object.freeze({ ...(request.environment ?? {}) }),
    exitCode: 0,
    startedAt,
    finishedAt,
    runner: Object.freeze({ name: 'pnpm', version: runnerVersion }),
    platform: localPlatform(),
    counts: Object.freeze({
      unit: 'commands',
      total: 1,
      failures: 0,
      retries: 0,
      skips: 0
    }),
    report: reportEvidence(
      repoRoot,
      request.reportPath!,
      'command-json'
    )
  })
}

async function runTest(
  execute: EvidenceCommandExecutor,
  request: CommandRequest,
  repoRoot: string,
  commit: string,
  runnerVersion: string
): Promise<EvidenceCommand> {
  const startedAt = new Date().toISOString()
  const execution = await execute(request)
  const finishedAt = new Date().toISOString()
  if (execution.exitCode !== 0) throw commandFailure(request, execution)
  const reportFormat = request.reportFormat
  if (
    reportFormat !== 'vitest-json' &&
    reportFormat !== 'playwright-json'
  ) {
    throw new Error(`${request.id} has no test report format`)
  }
  const reportValue = readJson<unknown>(request.reportPath!)
  const counts = reportFormat === 'vitest-json'
    ? validateVitestReport(reportValue)
    : validatePlaywrightReport(reportValue)
  const project = request.command
    .find(argument => argument.startsWith('--project='))
    ?.slice('--project='.length)
  validateExpectedEvidenceTargets(
    reportValue,
    reportFormat,
    repoRoot,
    request.cwd,
    request.id,
    project
  )
  assertRepositoryState(repoRoot, commit)
  const runnerName = reportFormat === 'vitest-json'
    ? 'vitest'
    : 'playwright'
  return Object.freeze({
    id: request.id,
    kind: 'test',
    commit,
    command: request.command,
    cwd: posixRelative(repoRoot, request.cwd),
    environment: Object.freeze({ ...(request.environment ?? {}) }),
    exitCode: 0,
    startedAt,
    finishedAt,
    runner: Object.freeze({ name: runnerName, version: runnerVersion }),
    platform: localPlatform(),
    counts,
    report: reportEvidence(
      repoRoot,
      request.reportPath!,
      reportFormat
    )
  })
}

async function runGithub(
  execute: EvidenceCommandExecutor,
  request: CommandRequest,
  repoRoot: string,
  commit: string,
  nodeVersion: string
): Promise<Readonly<{
    readonly command: EvidenceCommand
    readonly databaseId: number
  }>> {
  const startedAt = new Date().toISOString()
  const execution = await execute(request)
  const finishedAt = new Date().toISOString()
  if (execution.exitCode !== 0) throw commandFailure(request, execution)
  let reportValue: unknown
  try {
    reportValue = JSON.parse(execution.stdout) as unknown
  } catch {
    throw new Error('GitHub platform command did not emit one JSON run report')
  }
  const validated = validateGithubPlatformRun(
    reportValue,
    commit,
    Date.parse(startedAt)
  )
  writeFileSync(request.reportPath!, JSON.stringify(reportValue, null, 2) + '\n')
  assertRepositoryState(repoRoot, commit)
  return Object.freeze({
    databaseId: validated.databaseId,
    command: Object.freeze({
      id: request.id,
      kind: 'github',
      commit,
      command: request.command,
      cwd: posixRelative(repoRoot, request.cwd),
      environment: Object.freeze({}),
      exitCode: 0,
      startedAt,
      finishedAt,
      runner: Object.freeze({
        name: 'github-actions',
        version: 'workflow-attempt-1'
      }),
      platform: Object.freeze({
        os: 'github-matrix',
        arch: 'arm64+x64',
        node: nodeVersion
      }),
      counts: Object.freeze({
        unit: 'jobs',
        total: 3,
        failures: 0,
        retries: 0,
        skips: 0
      }),
      report: reportEvidence(
        repoRoot,
        request.reportPath!,
        'github-run-json'
      )
    })
  })
}

async function collectPass(
  options: Readonly<{
    readonly ordinal: 1 | 2
    readonly runId: string
    readonly repoRoot: string
    readonly reportRoot: string
    readonly installedArtifact: CollectedInstalledArtifact
    readonly commit: string
    readonly execute: EvidenceCommandExecutor
    readonly pnpmVersion: string
    readonly vitestVersion: string
    readonly playwrightVersion: string
    readonly githubNodeVersion: string
  }>
): Promise<EvidencePass> {
  const startedAt = new Date().toISOString()
  mkdirSync(options.reportRoot, { recursive: true })
  const commands: EvidenceCommand[] = []
  const total = FIXED_CHECKS.length + FIXED_TEST_IDS.length + 1
  let completed = 0
  const announce = (id: string): void => {
    console.log(
      `[0009 evidence] pass ${String(options.ordinal)} ` +
      `${String(completed + 1)}/${String(total)}: ${id}`
    )
  }

  const github = githubRequest(
    options.repoRoot,
    options.reportRoot,
    options.runId
  )
  announce(github.id)
  const githubEvidence = await runGithub(
    options.execute,
    github,
    options.repoRoot,
    options.commit,
    options.githubNodeVersion
  )
  commands.push(githubEvidence.command)
  completed += 1

  for (const check of FIXED_CHECKS) {
    const request = checkRequest(
      options.repoRoot,
      options.reportRoot,
      check,
      options.pnpmVersion
    )
    announce(request.id)
    commands.push(await runCheck(
      options.execute,
      request,
      options.repoRoot,
      options.commit,
      options.pnpmVersion
    ))
    completed += 1
  }

  for (const test of fixedTests({
    executablePath: options.installedArtifact.executablePath,
    sha256: options.installedArtifact.evidence.sha256,
    executableSha256:
      options.installedArtifact.evidence.executableSha256
  }, options.commit)) {
    const request = testRequest(options.repoRoot, options.reportRoot, test)
    announce(request.id)
    commands.push(await runTest(
      options.execute,
      request,
      options.repoRoot,
      options.commit,
      test.runner === 'vitest'
        ? options.vitestVersion
        : options.playwrightVersion
    ))
    if (test.id === 'installed') {
      assertInstalledArtifactUnchanged(
        options.repoRoot,
        options.installedArtifact
      )
    }
    completed += 1
  }
  const finishedAt = new Date().toISOString()
  return Object.freeze({
    id: randomUUID(),
    ordinal: options.ordinal,
    commit: options.commit,
    startedAt,
    finishedAt,
    githubRunDatabaseId: githubEvidence.databaseId,
    commands: Object.freeze(commands),
    surfaces: FIXED_SURFACE_COMMANDS
  })
}

export async function collect0009Evidence(
  options: Collect0009EvidenceOptions
): Promise<EvidenceBundle> {
  const repoRoot = resolve(options.repoRoot)
  const dirty = dirtyState(repoRoot)
  if (dirty.length > 0) {
    throw new Error(
      `Plan 0009 evidence requires a clean committed worktree; found:\n${dirty.join('\n')}`
    )
  }
  const runIds = options.githubRunIds
  if (
    runIds.length !== 2 ||
    runIds[0] === runIds[1] ||
    !runIds.every((id) => /^[1-9]\d*$/.test(id))
  ) {
    throw new Error(
      'Plan 0009 evidence requires exactly two distinct numeric GitHub run ids'
    )
  }
  const commit = currentCommit(repoRoot)
  const evidencePath = resolve(
    repoRoot,
    'specs/migration/0009-final-evidence.yml'
  )
  const collectionRoot = resolve(
    repoRoot,
    'specs/migration/0009-evidence',
    `${commit.slice(0, 12)}-${Date.now().toString()}-${randomUUID()}`
  )
  assertIgnored(repoRoot, evidencePath)
  assertIgnored(repoRoot, resolve(collectionRoot, 'probe.json'))
  mkdirSync(collectionRoot, { recursive: true })
  if (existsSync(evidencePath)) {
    renameSync(
      evidencePath,
      resolve(collectionRoot, 'previous-final-evidence.json')
    )
  }
  assertRepositoryState(repoRoot, commit)

  const execute = options.execute ?? defaultExecute
  const pinnedPnpmVersion = pnpmVersion(repoRoot)
  const installedArtifact = await collectInstalledArtifact({
    repoRoot,
    collectionRoot,
    commit,
    execute,
    pnpmVersion: pinnedPnpmVersion,
    mount: options.mountInstalledArtifact ?? mountMacDmg
  })
  try {
    const shared = {
      repoRoot,
      installedArtifact,
      commit,
      execute,
      pnpmVersion: pinnedPnpmVersion,
      vitestVersion: packageVersion(
        repoRoot,
        'node_modules/vitest/package.json'
      ),
      playwrightVersion: packageVersion(
        repoRoot,
        'node_modules/@playwright/test/package.json'
      ),
      githubNodeVersion: githubNodeVersion(repoRoot)
    }
    const first = await collectPass({
      ...shared,
      ordinal: 1,
      runId: runIds[0]!,
      reportRoot: resolve(collectionRoot, 'pass-1')
    })
    const second = await collectPass({
      ...shared,
      ordinal: 2,
      runId: runIds[1]!,
      reportRoot: resolve(collectionRoot, 'pass-2')
    })
    if (first.githubRunDatabaseId === second.githubRunDatabaseId) {
      throw new Error('The two evidence passes must ingest distinct GitHub runs')
    }
    assertInstalledArtifactUnchanged(repoRoot, installedArtifact)
    assertRepositoryState(repoRoot, commit)
    const bundle: EvidenceBundle = Object.freeze({
      schema: 'marktext-0009-final-evidence-v5',
      commit,
      dirtyState: Object.freeze([]),
      createdAt: new Date().toISOString(),
      artifactHashes: artifactHashes(repoRoot, commit),
      installedArtifact: installedArtifact.evidence,
      runs: Object.freeze(
        [first, second]
      ) as readonly [EvidencePass, EvidencePass]
    })
    mkdirSync(dirname(evidencePath), { recursive: true })
    writeFileSync(evidencePath, JSON.stringify(bundle, null, 2) + '\n')
    assertRepositoryState(repoRoot, commit)

    const verifierReportPath = resolve(
      collectionRoot,
      'final-verifier.vitest-json.json'
    )
    const verifier: CommandRequest = Object.freeze({
      id: 'final-verifier',
      kind: 'verifier',
      command: Object.freeze([
        process.execPath,
        resolve(repoRoot, 'node_modules/vitest/vitest.mjs'),
        'run',
        'test/plan/0009-final-closure.spec.ts',
        '--config',
        'vitest.config.ts',
        '--reporter=json',
        `--outputFile=${verifierReportPath}`,
        '--allowOnly=false',
        '--retry=0'
      ]),
      cwd: resolve(repoRoot, 'packages/document-core'),
      environment: Object.freeze({}),
      reportPath: verifierReportPath,
      reportFormat: 'vitest-json'
    })
    const verified = await execute(verifier)
    if (verified.exitCode !== 0) {
      unlinkSync(evidencePath)
      throw commandFailure(verifier, verified)
    }
    const verifierReport = readJson<unknown>(verifierReportPath)
    validateVitestReport(verifierReport)
    validateExpectedEvidenceTargets(
      verifierReport,
      'vitest-json',
      repoRoot,
      verifier.cwd,
      verifier.id
    )
    assertInstalledArtifactUnchanged(repoRoot, installedArtifact)
    assertRepositoryState(repoRoot, commit)
    return bundle
  } finally {
    installedArtifact.cleanup()
  }
}
