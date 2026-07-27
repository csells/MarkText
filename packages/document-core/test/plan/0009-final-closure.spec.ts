import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { arch, platform, tmpdir } from 'node:os'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  type EvidenceBundle,
  type EvidenceCommand,
  type EvidencePass,
  expectedEvidenceRequest,
  FIXED_CHECK_IDS,
  FIXED_SURFACE_COMMANDS,
  FIXED_TEST_IDS,
  PLATFORM_JOBS,
  REQUIRED_ARTIFACTS,
  REQUIRED_SURFACES,
  validateExpectedEvidenceTargets,
  validateGithubPlatformRun,
  validatePlaywrightReport,
  validateVitestReport
} from './0009-evidence-collector.js'

interface Target {
  readonly kind: 'test' | 'workflow'
  readonly path: string
  readonly title: string
}

interface AcceptanceManifest {
  readonly acceptance: readonly {
    readonly id: string
    readonly status: 'red' | 'green'
    readonly target: Target
    readonly auxiliaryTargets?: readonly Target[]
  }[]
}

interface ExitManifest {
  readonly phases: readonly {
    readonly id: string
    readonly status: 'red' | 'green'
  }[]
  readonly closure: readonly {
    readonly id: string
    readonly status: 'red' | 'green'
  }[]
}

interface GithubJob {
  readonly databaseId: number
  readonly name: string
  readonly conclusion: string
}

interface GithubReport {
  readonly databaseId: number
  readonly jobs: readonly GithubJob[]
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const MIGRATION_ROOT = resolve(REPO_ROOT, 'specs/migration')
const EVIDENCE_PATH = resolve(MIGRATION_ROOT, '0009-final-evidence.yml')

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function callName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) {
    const owner = callName(expression.expression)
    return owner === undefined ? undefined : `${owner}.${expression.name.text}`
  }
  return undefined
}

function collectedOrdinaryTest(target: Target): boolean {
  const absolute = resolve(REPO_ROOT, target.path)
  if (!existsSync(absolute)) return false
  const source = readFileSync(absolute, 'utf8')
  if (target.kind === 'workflow') {
    return source.includes(`name: ${target.title}`) &&
      !/\b(?:skip|xfail|fixme)\b/i.test(source)
  }
  const syntax = ts.createSourceFile(
    absolute,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  let ordinary = 0
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const title = node.arguments[0]
      const name = callName(node.expression)
      if (
        title !== undefined &&
        (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title)) &&
        title.text === target.title &&
        (name === 'it' || name === 'test')
      ) {
        ordinary += 1
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(syntax)
  return ordinary === 1
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function currentCommit(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  }).trim()
}

function worktreeDirtyState(cwd: string = REPO_ROOT): readonly string[] {
  return Object.freeze(
    execFileSync(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      { cwd, encoding: 'utf8' }
    )
      .split(/\r?\n/)
      .filter(Boolean)
  )
}

function evidence(): EvidenceBundle {
  expect(existsSync(EVIDENCE_PATH), 'final evidence bundle must exist').toBe(true)
  return readJson<EvidenceBundle>(EVIDENCE_PATH)
}

function expectRelativePath(path: string): void {
  expect(path).toMatch(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+/)
}

function instant(value: string): number {
  const parsed = Date.parse(value)
  expect(Number.isFinite(parsed), `${value} must be an ISO timestamp`).toBe(true)
  return parsed
}

function posixRelative(path: string): string {
  const value = relative(REPO_ROOT, path).split(sep).join('/')
  return value.length === 0 ? '.' : value
}

function committedSha256(commit: string, path: string): string {
  return createHash('sha256')
    .update(execFileSync('git', ['show', `${commit}:${path}`], {
      cwd: REPO_ROOT,
      maxBuffer: 64 * 1024 * 1024
    }))
    .digest('hex')
}

function expectIgnored(path: string): void {
  expect(() => execFileSync(
    'git',
    ['check-ignore', '--quiet', path],
    { cwd: REPO_ROOT }
  )).not.toThrow()
}

function packageVersion(path: string): string {
  const value = readJson<{ readonly version?: unknown }>(path).version
  expect(typeof value).toBe('string')
  expect((value as string).length).toBeGreaterThan(0)
  return value as string
}

function expectReportFresh(
  command: EvidenceCommand,
  startedAt: number,
  finishedAt: number
): string {
  expectRelativePath(command.report.path)
  expect(command.report.path).toMatch(/^specs\/migration\/0009-evidence\//)
  const reportPath = resolve(REPO_ROOT, command.report.path)
  expect(existsSync(reportPath), command.report.path).toBe(true)
  expectIgnored(command.report.path)
  const modifiedAt = statSync(reportPath).mtimeMs
  expect(modifiedAt).toBeGreaterThanOrEqual(startedAt - 2_000)
  expect(modifiedAt).toBeLessThanOrEqual(finishedAt + 2_000)
  expect(command.report.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(sha256(reportPath), command.report.path).toBe(command.report.sha256)
  return reportPath
}

function expectExactCommand(command: EvidenceCommand, reportPath: string): void {
  const githubReport = command.kind === 'github'
    ? readJson<GithubReport>(reportPath)
    : undefined
  const packagedApp = command.environment.MARKTEXT_PACKAGED_APP
  const installedArtifactSha256 =
    command.environment.MARKTEXT_EXPECTED_ARTIFACT_SHA256
  const installedExecutableSha256 =
    command.environment.MARKTEXT_EXPECTED_EXECUTABLE_SHA256
  const expected = expectedEvidenceRequest({
    id: command.id,
    repoRoot: REPO_ROOT,
    reportPath,
    ...(packagedApp === undefined ? {} : { packagedApp }),
    ...(installedArtifactSha256 === undefined
      ? {}
      : { installedArtifactSha256 }),
    ...(installedExecutableSha256 === undefined
      ? {}
      : { installedExecutableSha256 }),
    ...(githubReport === undefined
      ? {}
      : { githubRunId: String(githubReport.databaseId) })
  })
  expect(command.kind).toBe(expected.kind)
  expect(command.command).toEqual(expected.command)
  expect(command.cwd).toBe(posixRelative(expected.cwd))
  expect(command.environment).toEqual(expected.environment ?? {})
  expect(command.report.format).toBe(expected.reportFormat)
  expect(reportPath).toBe(expected.reportPath)
}

function expectCommandReport(
  command: EvidenceCommand,
  reportPath: string
): void {
  const report = readJson<Record<string, unknown>>(reportPath)
  expect(report).toMatchObject({
    schema: 'marktext-0009-command-report-v1',
    id: command.id,
    command: command.command,
    cwd: command.cwd,
    environment: command.environment,
    exitCode: 0,
    startedAt: command.startedAt,
    finishedAt: command.finishedAt
  })
  expect(report.stdout).toEqual(expect.any(String))
  expect(report.stderr).toEqual(expect.any(String))
  expect(command.runner).toEqual({
    name: 'pnpm',
    version: expect.stringMatching(/^\d+\.\d+\.\d+$/)
  })
  expect(command.counts).toEqual({
    unit: 'commands',
    total: 1,
    failures: 0,
    retries: 0,
    skips: 0
  })
}

function expectTestReport(command: EvidenceCommand, reportPath: string): void {
  const report = readJson<unknown>(reportPath)
  if (command.report.format === 'vitest-json') {
    expect(command.runner).toEqual({
      name: 'vitest',
      version: packageVersion(resolve(REPO_ROOT, 'node_modules/vitest/package.json'))
    })
    expect(command.counts).toEqual(validateVitestReport(report))
    validateExpectedEvidenceTargets(
      report,
      'vitest-json',
      REPO_ROOT,
      resolve(REPO_ROOT, command.cwd),
      command.id
    )
    expect(command.command).toContain('--retry=0')
    return
  }
  expect(command.report.format).toBe('playwright-json')
  expect(command.runner).toEqual({
    name: 'playwright',
    version: packageVersion(resolve(
      REPO_ROOT,
      'node_modules/@playwright/test/package.json'
    ))
  })
  expect(command.counts).toEqual(validatePlaywrightReport(report))
  const project = command.command
    .find(argument => argument.startsWith('--project='))
    ?.slice('--project='.length)
  validateExpectedEvidenceTargets(
    report,
    'playwright-json',
    REPO_ROOT,
    resolve(REPO_ROOT, command.cwd),
    command.id,
    project
  )
  expect(command.command).toContain('--retries=0')
}

function expectMatchingPlatformJob(
  report: GithubReport,
  surface: keyof typeof PLATFORM_JOBS
): void {
  const expectedName = PLATFORM_JOBS[surface]
  const matches = report.jobs.filter((job) => job.name === expectedName)
  expect(matches, `${surface} must map to ${expectedName}`).toHaveLength(1)
  expect(matches[0]).toMatchObject({
    databaseId: expect.any(Number),
    conclusion: 'success'
  })
}

function expectGithubReport(
  command: EvidenceCommand,
  reportPath: string,
  pass: EvidencePass
): void {
  const report = readJson<GithubReport>(reportPath)
  const validated = validateGithubPlatformRun(
    report,
    pass.commit,
    instant(command.startedAt)
  )
  expect(validated.databaseId).toBe(pass.githubRunDatabaseId)
  expect(command.runner).toEqual({
    name: 'github-actions',
    version: 'workflow-attempt-1'
  })
  expect(command.counts).toEqual({
    unit: 'jobs',
    total: 3,
    failures: 0,
    retries: 0,
    skips: 0
  })
  expect(command.platform).toMatchObject({
    os: 'github-matrix',
    arch: 'arm64+x64',
    node: expect.stringMatching(/^v\d+\.\d+\.\d+$/)
  })
  for (const surface of [
    'macos-arm64',
    'windows-x64',
    'linux-x64'
  ] as const) {
    expect(pass.surfaces[surface]).toEqual(['github-platforms'])
    expectMatchingPlatformJob(report, surface)
  }
}

function expectDistinctRemoteRuns(runs: readonly EvidencePass[]): void {
  expect(new Set(runs.map((run) => run.githubRunDatabaseId)).size).toBe(2)
  const remoteReports = runs.map((run) => {
    const command = run.commands.find((entry) => entry.id === 'github-platforms')
    expect(command).toBeDefined()
    return command!.report.path
  })
  expect(new Set(remoteReports).size).toBe(2)
}

function expectEvidencePass(
  pass: EvidencePass,
  commit: string,
  reportPaths: Set<string>
): void {
  expect(Object.keys(pass).sort()).toEqual([
    'commands',
    'commit',
    'finishedAt',
    'githubRunDatabaseId',
    'id',
    'ordinal',
    'startedAt',
    'surfaces'
  ])
  expect(pass.commit).toBe(commit)
  const started = instant(pass.startedAt)
  const finished = instant(pass.finishedAt)
  expect(finished).toBeGreaterThanOrEqual(started)
  expect(Date.now() - finished).toBeLessThanOrEqual(24 * 60 * 60 * 1000)

  const expectedIds = [
    ...FIXED_CHECK_IDS,
    ...FIXED_TEST_IDS,
    'github-platforms'
  ].sort()
  expect(pass.commands.map((command) => command.id).sort()).toEqual(expectedIds)
  expect(pass.surfaces).toEqual(FIXED_SURFACE_COMMANDS)
  expect(Object.keys(pass.surfaces).sort()).toEqual([...REQUIRED_SURFACES].sort())
  const referenced = new Set(Object.values(pass.surfaces).flat())
  expect([...referenced].sort()).toEqual([
    ...FIXED_TEST_IDS,
    'github-platforms'
  ].sort())

  for (const command of pass.commands) {
    expect(command.commit).toBe(commit)
    expect(command.exitCode).toBe(0)
    expectRelativePath(command.cwd)
    expect(existsSync(resolve(REPO_ROOT, command.cwd)), command.cwd).toBe(true)
    const commandStarted = instant(command.startedAt)
    const commandFinished = instant(command.finishedAt)
    expect(commandStarted).toBeGreaterThanOrEqual(started)
    expect(commandFinished).toBeGreaterThanOrEqual(commandStarted)
    expect(commandFinished).toBeLessThanOrEqual(finished)
    const reportPath = expectReportFresh(
      command,
      commandStarted,
      commandFinished
    )
    expect(reportPaths.has(command.report.path), command.report.path).toBe(false)
    reportPaths.add(command.report.path)
    expectExactCommand(command, reportPath)

    if (command.kind === 'check') {
      expect(command.platform).toEqual({
        os: platform(),
        arch: arch(),
        node: process.version
      })
      expectCommandReport(command, reportPath)
    } else if (command.kind === 'test') {
      expect(command.platform).toEqual({
        os: platform(),
        arch: arch(),
        node: process.version
      })
      expectTestReport(command, reportPath)
    } else {
      expectGithubReport(command, reportPath, pass)
    }
  }
}

function expectInstalledArtifact(
  bundle: EvidenceBundle,
  reportPaths: Set<string>
): void {
  const artifact = bundle.installedArtifact
  expect(Object.keys(artifact).sort()).toEqual([
    'build',
    'bytes',
    'commit',
    'executableBytes',
    'executableSha256',
    'format',
    'path',
    'sha256'
  ])
  expect(artifact.commit).toBe(bundle.commit)
  expect(artifact.format).toBe('dmg')
  expectRelativePath(artifact.path)
  expectIgnored(artifact.path)
  const artifactPath = resolve(REPO_ROOT, artifact.path)
  expect(existsSync(artifactPath), artifact.path).toBe(true)
  expect(statSync(artifactPath).isFile()).toBe(true)
  expect(statSync(artifactPath).size).toBe(artifact.bytes)
  expect(sha256(artifactPath)).toBe(artifact.sha256)
  expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(artifact.executableSha256).toMatch(/^[0-9a-f]{64}$/)
  expect(artifact.executableBytes).toBeGreaterThan(0)

  const build = artifact.build
  expect(build.id).toBe('installed-artifact-build')
  expect(build.kind).toBe('check')
  expect(build.commit).toBe(bundle.commit)
  expect(build.command.slice(-3)).toEqual([
    'pnpm',
    'run',
    `build:mac:${arch()}`
  ])
  expect(build.cwd).toBe('.')
  expect(build.environment).toEqual({
    MARKTEXT_EXPECTED_ARTIFACT_PATH: artifactPath
  })
  const buildStarted = instant(build.startedAt)
  const buildFinished = instant(build.finishedAt)
  expect(buildFinished).toBeGreaterThanOrEqual(buildStarted)
  const buildReport = expectReportFresh(build, buildStarted, buildFinished)
  expect(reportPaths.has(build.report.path)).toBe(false)
  reportPaths.add(build.report.path)
  expectCommandReport(build, buildReport)

  const installedCommands = bundle.runs.flatMap(run =>
    run.commands.filter(command => command.id === 'installed')
  )
  expect(installedCommands).toHaveLength(2)
  const executablePaths = new Set(
    installedCommands.map(command =>
      command.environment.MARKTEXT_PACKAGED_APP
    )
  )
  expect(executablePaths.size).toBe(1)
  const executablePath = [...executablePaths][0]
  expect(typeof executablePath).toBe('string')
  expect(isAbsolute(executablePath!)).toBe(true)
  expect(existsSync(executablePath!), executablePath).toBe(true)
  expect(statSync(executablePath!).isFile()).toBe(true)
  expect(statSync(executablePath!).size).toBe(artifact.executableBytes)
  expect(sha256(executablePath!)).toBe(artifact.executableSha256)
  for (const command of installedCommands) {
    expect(command.environment).toMatchObject({
      MARKTEXT_EXPECTED_COMMIT: bundle.commit,
      MARKTEXT_EXPECTED_ARTIFACT_SHA256: artifact.sha256,
      MARKTEXT_EXPECTED_EXECUTABLE_SHA256: artifact.executableSha256
    })
  }
  expect(buildFinished).toBeLessThanOrEqual(
    Math.min(...bundle.runs.map(run => instant(run.startedAt)))
  )
}

function expectCompleteEvidenceBundle(bundle: EvidenceBundle): void {
  expect(bundle.schema).toBe('marktext-0009-final-evidence-v5')
  expect(Object.keys(bundle).sort()).toEqual([
    'artifactHashes',
    'commit',
    'createdAt',
    'dirtyState',
    'installedArtifact',
    'runs',
    'schema'
  ])
  expect(bundle.commit).toMatch(/^[0-9a-f]{40}$/)
  expect(bundle.commit).toBe(currentCommit())
  expect(() => execFileSync(
    'git',
    ['cat-file', '-e', `${bundle.commit}^{commit}`],
    { cwd: REPO_ROOT }
  )).not.toThrow()
  const actualDirtyState = worktreeDirtyState()
  expect(bundle.dirtyState).toEqual(actualDirtyState)
  expect(actualDirtyState).toEqual([])
  expectIgnored(posixRelative(EVIDENCE_PATH))

  expect(Object.keys(bundle.artifactHashes).sort())
    .toEqual([...REQUIRED_ARTIFACTS].sort())
  for (const path of REQUIRED_ARTIFACTS) {
    expectRelativePath(path)
    const expected = bundle.artifactHashes[path]
    expect(expected, path).toMatch(/^[0-9a-f]{64}$/)
    expect(committedSha256(bundle.commit, path), path).toBe(expected)
  }

  expect(bundle.runs).toHaveLength(2)
  expect(bundle.runs.map((run) => run.ordinal)).toEqual([1, 2])
  expect(new Set(bundle.runs.map((run) => run.id)).size).toBe(2)
  expectDistinctRemoteRuns(bundle.runs)
  const reportPaths = new Set<string>()
  expectInstalledArtifact(bundle, reportPaths)
  for (const pass of bundle.runs) {
    expectEvidencePass(pass, bundle.commit, reportPaths)
  }
  expect(instant(bundle.runs[1].startedAt))
    .toBeGreaterThanOrEqual(instant(bundle.runs[0].finishedAt))
  const createdAt = instant(bundle.createdAt)
  expect(createdAt).toBeGreaterThanOrEqual(
    Math.max(...bundle.runs.map((run) => instant(run.finishedAt)))
  )
  expect(Date.now() - createdAt).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
}

describe('plan 0009 final closure', () => {
  it('proves every acceptance closure deletion and evidence claim', () => {
    const acceptance = readJson<AcceptanceManifest>(
      resolve(MIGRATION_ROOT, '0009-acceptance.yml')
    )
    const exits = readJson<ExitManifest>(
      resolve(MIGRATION_ROOT, '0009-exit-gates.yml')
    )
    expect(acceptance.acceptance.every((row) => row.status === 'green')).toBe(true)
    expect(exits.phases.every((row) => row.status === 'green')).toBe(true)
    expect(exits.closure.every((row) => row.status === 'green')).toBe(true)
    expect(evidence().schema).toBe('marktext-0009-final-evidence-v5')
  })

  it('collects every A01 through A32 primary and auxiliary target as an ordinary passing test', () => {
    const acceptance = readJson<AcceptanceManifest>(
      resolve(MIGRATION_ROOT, '0009-acceptance.yml')
    )
    expect(acceptance.acceptance.map((row) => row.id)).toEqual(
      Array.from({ length: 32 }, (_, index) =>
        `A${String(index + 1).padStart(2, '0')}`
      )
    )
    for (const row of acceptance.acceptance) {
      for (const target of [row.target, ...(row.auxiliaryTargets ?? [])]) {
        expect(collectedOrdinaryTest(target), `${row.id}: ${target.path}`)
          .toBe(true)
      }
    }
  })

  it('accepts a complete retry-free cross-surface evidence bundle', () => {
    expectCompleteEvidenceBundle(evidence())
  })

  it('rejects fabricated green metadata without result artifacts', () => {
    const fabricated = {
      schema: 'marktext-0009-final-evidence-v5',
      commit: 'not-a-commit',
      dirtyState: [],
      createdAt: new Date().toISOString(),
      artifactHashes: {},
      runs: []
    } as unknown as EvidenceBundle
    expect(() => expectCompleteEvidenceBundle(fabricated)).toThrow()
  })

  it('rejects evidence bound to a different valid commit', () => {
    const previous = execFileSync(
      'git',
      ['rev-parse', 'HEAD^'],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    ).trim()
    const fabricated = {
      schema: 'marktext-0009-final-evidence-v5',
      commit: previous,
      dirtyState: [],
      createdAt: new Date().toISOString(),
      artifactHashes: {},
      runs: []
    } as unknown as EvidenceBundle
    expect(() => expectCompleteEvidenceBundle(fabricated)).toThrow()
  })

  it('treats untracked source as dirty evidence state', () => {
    const repository = mkdtempSync(resolve(tmpdir(), 'marktext-evidence-git-'))
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: repository })
      execFileSync('git', ['config', 'user.email', 'evidence@example.invalid'], {
        cwd: repository
      })
      execFileSync('git', ['config', 'user.name', 'Evidence Test'], {
        cwd: repository
      })
      writeFileSync(resolve(repository, 'tracked.txt'), 'tracked\n')
      execFileSync('git', ['add', 'tracked.txt'], { cwd: repository })
      execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], {
        cwd: repository
      })

      expect(worktreeDirtyState(repository)).toEqual([])
      writeFileSync(resolve(repository, 'untracked.txt'), 'untracked\n')
      expect(worktreeDirtyState(repository)).toEqual(['?? untracked.txt'])
    } finally {
      rmSync(repository, { recursive: true, force: true })
    }
  })

  it('rejects reuse of one GitHub run across both fresh passes', () => {
    const runs = [
      {
        githubRunDatabaseId: 101,
        commands: [{
          id: 'github-platforms',
          report: { path: 'pass-1.json' }
        }]
      },
      {
        githubRunDatabaseId: 101,
        commands: [{
          id: 'github-platforms',
          report: { path: 'pass-2.json' }
        }]
      }
    ] as unknown as readonly EvidencePass[]
    expect(() => expectDistinctRemoteRuns(runs)).toThrow()
  })

  it('rejects a platform surface mapped to the wrong successful job', () => {
    const report = {
      databaseId: 101,
      jobs: [{
        databaseId: 11,
        name: PLATFORM_JOBS['windows-x64'],
        conclusion: 'success'
      }]
    }
    expect(() => expectMatchingPlatformJob(report, 'macos-arm64')).toThrow()
  })

  it('records two distinct timestamp-bound fixed-surface passes', () => {
    const bundle = evidence()
    expect(bundle.runs).toHaveLength(2)
    expect(new Set(bundle.runs.map((run) => run.id)).size).toBe(2)
    expectDistinctRemoteRuns(bundle.runs)
    expect(instant(bundle.runs[1].startedAt))
      .toBeGreaterThanOrEqual(instant(bundle.runs[0].finishedAt))
    expect(Object.keys(bundle.runs[0])).not.toContain('findings')
    expect(Object.keys(bundle.runs[1])).not.toContain('findings')
  })
})
