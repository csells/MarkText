import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { arch, platform, tmpdir } from 'node:os'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  canonicalEvidenceRequest,
  CRITICAL_EVIDENCE_CONTROL_FILES,
  type EvidenceBundle,
  type EvidenceCommand,
  type EvidencePass,
  expectedEvidenceRequest,
  FIXED_CHECK_IDS,
  FIXED_SURFACE_COMMANDS,
  FIXED_TEST_IDS,
  INSTALLED_EXECUTABLE_PATH,
  PLATFORM_JOBS,
  REQUIRED_SURFACES,
  validate0009CandidateEvidence,
  validateExpectedEvidenceTargets,
  validateGithubRunEvidence,
  validatePlaywrightReport,
  validateVitestReport,
  verify0009ClosureTransition
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

interface GithubRunEvidenceReport {
  readonly run: GithubReport
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const MIGRATION_ROOT = resolve(REPO_ROOT, 'specs/migration')
const EVIDENCE_PATH = resolve(MIGRATION_ROOT, '0009-candidate-evidence.yml')

function writeClosureFixture(root: string, path: string, content: string): void {
  const absolute = resolve(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
}

function setClosureFixtureState(root: string, state: 'candidate' | 'verified'): void {
  const acceptancePath = resolve(root, 'specs/migration/0009-acceptance.yml')
  const exitsPath = resolve(root, 'specs/migration/0009-exit-gates.yml')
  const planPath = resolve(root, 'specs/plans/0009-criticmarkup-document-engine-rebuild.md')
  const acceptance = readJson<{
    acceptance: { id: string; status: 'red' | 'green' }[]
  }>(acceptancePath)
  const exits = readJson<{
    phases: { id: string; status: 'red' | 'green' }[]
    closure: { id: string; status: 'red' | 'green' }[]
  }>(exitsPath)
  const pendingAcceptance = new Set(['A30', 'A31', 'A32'])
  const pendingClosure = new Set(['D07', 'D08', 'D10'])
  for (const row of acceptance.acceptance) {
    row.status = state === 'candidate' && pendingAcceptance.has(row.id) ? 'red' : 'green'
  }
  for (const row of exits.phases) {
    row.status = state === 'candidate' && row.id === 'P10' ? 'red' : 'green'
  }
  for (const row of exits.closure) {
    row.status = state === 'candidate' && pendingClosure.has(row.id) ? 'red' : 'green'
  }
  writeFileSync(acceptancePath, JSON.stringify(acceptance, null, 2) + '\n')
  writeFileSync(exitsPath, JSON.stringify(exits, null, 2) + '\n')
  const plan = readFileSync(planPath, 'utf8')
    .replace(
      /^- \*\*Status:\*\* [^\n]+$/mu,
      state === 'candidate'
        ? '- **Status:** RED — P10 candidate evidence pending'
        : '- **Status:** GREEN — verified closure'
    )
    .split('\n')
    .map((line) => {
      if (
        !line.startsWith('|') ||
        /^\|\s*-/u.test(line) ||
        (state === 'candidate' && line.includes('| P10 release proof |'))
      ) {
        return line
      }
      if (line.startsWith('| Area |')) return line
      return line.replace(/\|[^|]*\|\s*$/u, '| None. |')
    })
    .join('\n')
  writeFileSync(planPath, plan)
}

function initializeClosureFixture(): Readonly<{
  root: string
  candidateCommit: string
}> {
  const root = mkdtempSync(resolve(tmpdir(), 'marktext-0009-closure-'))
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'closure@example.invalid'], {
    cwd: root
  })
  execFileSync('git', ['config', 'user.name', 'Closure Test'], { cwd: root })
  for (const path of [
    'specs/migration/0009-acceptance.yml',
    'specs/migration/0009-exit-gates.yml',
    'specs/plans/0009-criticmarkup-document-engine-rebuild.md'
  ]) {
    writeClosureFixture(root, path, readFileSync(resolve(REPO_ROOT, path), 'utf8'))
  }
  writeClosureFixture(
    root,
    '.gitignore',
    [
      'specs/migration/0009-candidate-evidence.yml',
      'specs/migration/0009-closure-attestation.yml',
      'specs/migration/0009-evidence/'
    ].join('\n') + '\n'
  )
  writeClosureFixture(root, 'source.txt', 'candidate source\n')
  setClosureFixtureState(root, 'candidate')
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '--quiet', '-m', 'candidate'], { cwd: root })
  return Object.freeze({
    root,
    candidateCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
  })
}

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
    return source.includes(`name: ${target.title}`) && !/\b(?:skip|xfail|fixme)\b/i.test(source)
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
    execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd,
      encoding: 'utf8'
    })
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
    .update(
      execFileSync('git', ['show', `${commit}:${path}`], {
        cwd: REPO_ROOT,
        maxBuffer: 64 * 1024 * 1024
      })
    )
    .digest('hex')
}

function expectIgnored(path: string): void {
  expect(() =>
    execFileSync('git', ['check-ignore', '--quiet', path], { cwd: REPO_ROOT })
  ).not.toThrow()
}

function packageVersion(path: string): string {
  const value = readJson<{ readonly version?: unknown }>(path).version
  expect(typeof value).toBe('string')
  expect((value as string).length).toBeGreaterThan(0)
  return value as string
}

function expectReportFresh(command: EvidenceCommand): string {
  expectRelativePath(command.report.path)
  expect(command.report.path).toMatch(/^specs\/migration\/0009-evidence\//)
  const reportPath = resolve(REPO_ROOT, command.report.path)
  expect(existsSync(reportPath), command.report.path).toBe(true)
  expectIgnored(command.report.path)
  expect(command.report.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(sha256(reportPath), command.report.path).toBe(command.report.sha256)
  return reportPath
}

function expectExactCommand(command: EvidenceCommand, reportPath: string): void {
  const githubReport =
    command.kind === 'github' ? readJson<GithubRunEvidenceReport>(reportPath).run : undefined
  const packagedApp = command.environment.MARKTEXT_PACKAGED_APP
  const installedArtifactSha256 = command.environment.MARKTEXT_EXPECTED_ARTIFACT_SHA256
  const installedExecutableSha256 = command.environment.MARKTEXT_EXPECTED_EXECUTABLE_SHA256
  const expected = expectedEvidenceRequest({
    id: command.id,
    repoRoot: REPO_ROOT,
    reportPath,
    expectedCommit: command.commit,
    ...(packagedApp === undefined ? {} : { packagedApp }),
    ...(installedArtifactSha256 === undefined ? {} : { installedArtifactSha256 }),
    ...(installedExecutableSha256 === undefined ? {} : { installedExecutableSha256 }),
    ...(githubReport === undefined ? {} : { githubRunId: String(githubReport.databaseId) })
  })
  const canonical = canonicalEvidenceRequest(expected, REPO_ROOT, REPO_ROOT)
  expect(command.kind).toBe(expected.kind)
  expect(command.command).toEqual(canonical.command)
  expect(command.cwd).toBe(posixRelative(expected.cwd))
  expect(command.environment).toEqual(canonical.environment)
  expect(command.report.format).toBe(expected.reportFormat)
  expect(reportPath).toBe(expected.reportPath)
}

function expectCommandReport(command: EvidenceCommand, reportPath: string): void {
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
    version: packageVersion(resolve(REPO_ROOT, 'node_modules/@playwright/test/package.json'))
  })
  expect(command.counts).toEqual(validatePlaywrightReport(report))
  const project = command.command
    .find((argument) => argument.startsWith('--project='))
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

const REQUIRED_OUTPUT_ARTIFACT_NAMES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'hostile-sinks': Object.freeze(['hostile-pdf', 'hostile-print-proof']),
  pdf: Object.freeze(['critic-marked', 'critic-original'])
})

function expectOutputArtifacts(command: EvidenceCommand, occupiedPaths: Set<string>): void {
  expect(Array.isArray(command.artifacts)).toBe(true)
  expect(
    command.artifacts
      .map(({ name }) => name)
      .filter((name) => (REQUIRED_OUTPUT_ARTIFACT_NAMES[command.id] ?? []).includes(name))
  ).toEqual(REQUIRED_OUTPUT_ARTIFACT_NAMES[command.id] ?? [])
  for (const artifact of command.artifacts) {
    expect(Object.keys(artifact).sort()).toEqual(['bytes', 'contentType', 'name', 'path', 'sha256'])
    expect(artifact.name.length).toBeGreaterThan(0)
    expect(artifact.contentType.length).toBeGreaterThan(0)
    expectRelativePath(artifact.path)
    expect(artifact.path).toMatch(/^specs\/migration\/0009-evidence\//)
    expectIgnored(artifact.path)
    expect(occupiedPaths.has(artifact.path), artifact.path).toBe(false)
    occupiedPaths.add(artifact.path)
    const path = resolve(REPO_ROOT, artifact.path)
    expect(existsSync(path), artifact.path).toBe(true)
    expect(statSync(path).isFile()).toBe(true)
    expect(statSync(path).size).toBe(artifact.bytes)
    expect(artifact.bytes).toBeGreaterThan(0)
    expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(sha256(path)).toBe(artifact.sha256)
    if ((REQUIRED_OUTPUT_ARTIFACT_NAMES[command.id] ?? []).includes(artifact.name)) {
      expect(artifact.contentType).toBe('application/pdf')
      const data = readFileSync(path)
      expect(data.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      expect(data.subarray(-16).toString('latin1')).toContain('%%EOF')
    }
  }
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
  const envelope = readJson<GithubRunEvidenceReport>(reportPath)
  const report = envelope.run
  const validated = validateGithubRunEvidence(
    envelope,
    pass.commit,
    instant(command.startedAt)
  ).validated
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
  for (const surface of ['macos-arm64', 'windows-x64', 'linux-x64'] as const) {
    expect(pass.surfaces[surface]).toEqual(['github-platforms'])
    expectMatchingPlatformJob(report, surface)
  }
}

function expectDistinctRemoteRuns(runs: readonly EvidencePass[]): void {
  expect(new Set(runs.map((run) => run.githubRunDatabaseId)).size).toBe(2)
  const remoteReports = runs.map((run) => {
    const command = run.commands.find((entry) => entry.id === 'github-platforms')
    expect(command).toBeDefined()
    if (command === undefined) throw new Error('missing github-platforms command')
    return command.report.path
  })
  expect(new Set(remoteReports).size).toBe(2)
}

function expectEvidencePass(pass: EvidencePass, commit: string, reportPaths: Set<string>): void {
  expect(Object.keys(pass).sort()).toEqual([
    'commands',
    'commit',
    'finishedAt',
    'githubRunDatabaseId',
    'id',
    'installedArtifact',
    'ordinal',
    'preparation',
    'startedAt',
    'surfaces',
    'workspace'
  ])
  expect(pass.commit).toBe(commit)
  expect(pass.workspace).toEqual({
    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    commit,
    initialDirtyState: []
  })
  const started = instant(pass.startedAt)
  const finished = instant(pass.finishedAt)
  expect(finished).toBeGreaterThanOrEqual(started)
  expect(Date.now() - finished).toBeLessThanOrEqual(24 * 60 * 60 * 1000)

  const expectedIds = [...FIXED_CHECK_IDS, ...FIXED_TEST_IDS, 'github-platforms'].sort()
  expect(pass.commands.map((command) => command.id).sort()).toEqual(expectedIds)
  expect(pass.surfaces).toEqual(FIXED_SURFACE_COMMANDS)
  expect(Object.keys(pass.surfaces).sort()).toEqual([...REQUIRED_SURFACES].sort())
  const referenced = new Set(Object.values(pass.surfaces).flat())
  expect([...referenced].sort()).toEqual([...FIXED_TEST_IDS, 'github-platforms'].sort())

  const preparation = pass.preparation
  expect(preparation).toMatchObject({
    id: 'workspace-prepare',
    kind: 'check',
    commit,
    cwd: '.',
    environment: {},
    exitCode: 0
  })
  expect(preparation.command.slice(-3)).toEqual(['pnpm', 'install', '--frozen-lockfile'])
  const preparationStarted = instant(preparation.startedAt)
  const preparationFinished = instant(preparation.finishedAt)
  expect(preparationStarted).toBeGreaterThanOrEqual(started)
  expect(preparationFinished).toBeGreaterThanOrEqual(preparationStarted)
  expect(preparationFinished).toBeLessThanOrEqual(finished)
  const preparationReport = expectReportFresh(preparation)
  expect(reportPaths.has(preparation.report.path)).toBe(false)
  reportPaths.add(preparation.report.path)
  expectCommandReport(preparation, preparationReport)

  expectInstalledArtifact(pass, commit, reportPaths)

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
    const reportPath = expectReportFresh(command)
    expect(reportPaths.has(command.report.path), command.report.path).toBe(false)
    reportPaths.add(command.report.path)
    expectExactCommand(command, reportPath)
    expectOutputArtifacts(command, reportPaths)

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
  pass: EvidencePass,
  commit: string,
  reportPaths: Set<string>
): void {
  const artifact = pass.installedArtifact
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
  expect(artifact.commit).toBe(commit)
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
  expect(build.commit).toBe(commit)
  expect(build.command.slice(-3)).toEqual(['pnpm', 'run', `build:mac:${arch()}`])
  expect(build.cwd).toBe('.')
  expect(build.environment.MARKTEXT_EXPECTED_ARTIFACT_PATH).toMatch(
    /^\$CANDIDATE_CHECKOUT\/dist\/marktext-mac-/
  )
  const buildStarted = instant(build.startedAt)
  const buildFinished = instant(build.finishedAt)
  expect(buildFinished).toBeGreaterThanOrEqual(buildStarted)
  const buildReport = expectReportFresh(build)
  expect(reportPaths.has(build.report.path)).toBe(false)
  reportPaths.add(build.report.path)
  expectCommandReport(build, buildReport)

  const installedCommands = pass.commands.filter((command) => command.id === 'installed')
  expect(installedCommands).toHaveLength(1)
  const [installedCommand] = installedCommands
  if (installedCommand === undefined) throw new Error('missing installed command')
  const executablePath = installedCommand.environment.MARKTEXT_PACKAGED_APP
  expect(executablePath).toBe(INSTALLED_EXECUTABLE_PATH)
  for (const command of installedCommands) {
    expect(command.environment).toMatchObject({
      MARKTEXT_EXPECTED_COMMIT: commit,
      MARKTEXT_EXPECTED_ARTIFACT_SHA256: artifact.sha256,
      MARKTEXT_EXPECTED_EXECUTABLE_SHA256: artifact.executableSha256
    })
  }
  expect(buildStarted).toBeGreaterThanOrEqual(instant(pass.startedAt))
  expect(buildFinished).toBeLessThanOrEqual(instant(pass.finishedAt))
}

function expectCompleteEvidenceBundle(bundle: EvidenceBundle): void {
  expect(validate0009CandidateEvidence({ repoRoot: REPO_ROOT }).bundle).toEqual(bundle)
  expect(bundle.schema).toBe('marktext-0009-candidate-evidence-v8')
  expect(Object.keys(bundle).sort()).toEqual([
    'candidateCommit',
    'candidateTree',
    'createdAt',
    'criticalControlFileHashes',
    'dirtyState',
    'runs',
    'schema',
    'state'
  ])
  expect(bundle.state).toBe('candidate')
  expect(bundle.candidateCommit).toMatch(/^[0-9a-f]{40}$/)
  expect(bundle.candidateTree).toMatch(/^[0-9a-f]{40}$/)
  expect(bundle.candidateCommit).not.toBe(currentCommit())
  expect(() =>
    execFileSync('git', ['cat-file', '-e', `${bundle.candidateCommit}^{commit}`], {
      cwd: REPO_ROOT
    })
  ).not.toThrow()
  expect(
    execFileSync('git', ['rev-parse', `${bundle.candidateCommit}^{tree}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    }).trim()
  ).toBe(bundle.candidateTree)
  const actualDirtyState = worktreeDirtyState()
  expect(bundle.dirtyState).toEqual(actualDirtyState)
  expect(actualDirtyState).toEqual([])
  expectIgnored(posixRelative(EVIDENCE_PATH))

  expect(Object.keys(bundle.criticalControlFileHashes).sort()).toEqual(
    [...CRITICAL_EVIDENCE_CONTROL_FILES].sort()
  )
  for (const path of CRITICAL_EVIDENCE_CONTROL_FILES) {
    expectRelativePath(path)
    const expected = bundle.criticalControlFileHashes[path]
    expect(expected, path).toMatch(/^[0-9a-f]{64}$/)
    expect(committedSha256(bundle.candidateCommit, path), path).toBe(expected)
  }

  expect(bundle.runs).toHaveLength(2)
  expect(bundle.runs.map((run) => run.ordinal)).toEqual([1, 2])
  expect(new Set(bundle.runs.map((run) => run.id)).size).toBe(2)
  expectDistinctRemoteRuns(bundle.runs)
  expect(new Set(bundle.runs.map((run) => run.workspace.id)).size).toBe(2)
  expect(new Set(bundle.runs.map((run) => run.installedArtifact.path)).size).toBe(2)
  const reportPaths = new Set<string>()
  for (const pass of bundle.runs) {
    expectEvidencePass(pass, bundle.candidateCommit, reportPaths)
  }
  expect(instant(bundle.runs[1].startedAt)).toBeGreaterThanOrEqual(
    instant(bundle.runs[0].finishedAt)
  )
  const createdAt = instant(bundle.createdAt)
  expect(createdAt).toBeGreaterThanOrEqual(
    Math.max(...bundle.runs.map((run) => instant(run.finishedAt)))
  )
  expect(Date.now() - createdAt).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
  expect(
    verify0009ClosureTransition({
      repoRoot: REPO_ROOT,
      candidateCommit: bundle.candidateCommit,
      evidenceSha256: sha256(EVIDENCE_PATH)
    })
  ).toMatchObject({
    state: 'verified',
    candidateCommit: bundle.candidateCommit,
    closureCommit: currentCommit(),
    plan: { status: 'green', openGapCount: 0 }
  })
}

describe('plan 0009 final closure', () => {
  it('binds verified closure to its exact candidate-only transition', () => {
    const fixture = initializeClosureFixture()
    try {
      setClosureFixtureState(fixture.root, 'verified')
      execFileSync('git', ['add', '.'], { cwd: fixture.root })
      execFileSync('git', ['commit', '--quiet', '-m', 'verified closure'], {
        cwd: fixture.root
      })
      const closureCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: fixture.root,
        encoding: 'utf8'
      }).trim()

      expect(
        verify0009ClosureTransition({
          repoRoot: fixture.root,
          candidateCommit: fixture.candidateCommit,
          evidenceSha256: 'a'.repeat(64)
        })
      ).toMatchObject({
        schema: 'marktext-0009-closure-attestation-v1',
        state: 'verified',
        candidateCommit: fixture.candidateCommit,
        closureCommit,
        evidenceSha256: 'a'.repeat(64),
        transitionPaths: [
          'specs/migration/0009-acceptance.yml',
          'specs/migration/0009-exit-gates.yml',
          'specs/plans/0009-criticmarkup-document-engine-rebuild.md'
        ],
        plan: {
          status: 'green',
          openGapCount: 0
        }
      })
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects a closure commit with any parent besides its exact candidate', () => {
    const fixture = initializeClosureFixture()
    try {
      const candidateTree = execFileSync(
        'git',
        ['rev-parse', `${fixture.candidateCommit}^{tree}`],
        { cwd: fixture.root, encoding: 'utf8' }
      ).trim()
      const unrelatedParent = execFileSync(
        'git',
        ['commit-tree', candidateTree, '-m', 'unrelated parent'],
        { cwd: fixture.root, encoding: 'utf8' }
      ).trim()
      setClosureFixtureState(fixture.root, 'verified')
      execFileSync('git', ['add', '.'], { cwd: fixture.root })
      const verifiedTree = execFileSync('git', ['write-tree'], {
        cwd: fixture.root,
        encoding: 'utf8'
      }).trim()
      const mergeClosure = execFileSync(
        'git',
        [
          'commit-tree',
          verifiedTree,
          '-p',
          fixture.candidateCommit,
          '-p',
          unrelatedParent,
          '-m',
          'invalid merge closure'
        ],
        { cwd: fixture.root, encoding: 'utf8' }
      ).trim()
      execFileSync('git', ['update-ref', 'HEAD', mergeClosure, fixture.candidateCommit], {
        cwd: fixture.root
      })

      expect(() =>
        verify0009ClosureTransition({
          repoRoot: fixture.root,
          candidateCommit: fixture.candidateCommit,
          evidenceSha256: 'a'.repeat(64)
        })
      ).toThrow(/exactly one parent/i)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects a compact closure attestation backed only by a forged header', () => {
    const fixture = initializeClosureFixture()
    const evidencePath = resolve(fixture.root, 'specs/migration/0009-candidate-evidence.yml')
    const attestationPath = resolve(fixture.root, 'specs/migration/0009-closure-attestation.yml')
    try {
      setClosureFixtureState(fixture.root, 'verified')
      execFileSync('git', ['add', '.'], { cwd: fixture.root })
      execFileSync('git', ['commit', '--quiet', '-m', 'verified closure'], {
        cwd: fixture.root
      })
      writeFileSync(
        evidencePath,
        JSON.stringify({
          schema: 'marktext-0009-candidate-evidence-v8',
          state: 'candidate',
          candidateCommit: fixture.candidateCommit
        }) + '\n'
      )

      expect(() => validate0009CandidateEvidence({ repoRoot: fixture.root })).toThrow(
        /complete candidate evidence/i
      )
      expect(existsSync(attestationPath)).toBe(false)
      expect(worktreeDirtyState(fixture.root)).toEqual([])
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects non-closure prose edits hidden inside the Plan transition', () => {
    const fixture = initializeClosureFixture()
    const planPath = resolve(
      fixture.root,
      'specs/plans/0009-criticmarkup-document-engine-rebuild.md'
    )
    try {
      setClosureFixtureState(fixture.root, 'verified')
      writeFileSync(planPath, readFileSync(planPath, 'utf8') + '\nUnrelated closure rewrite.\n')
      execFileSync('git', ['add', '.'], { cwd: fixture.root })
      execFileSync('git', ['commit', '--quiet', '-m', 'invalid closure'], {
        cwd: fixture.root
      })

      expect(() =>
        verify0009ClosureTransition({
          repoRoot: fixture.root,
          candidateCommit: fixture.candidateCommit,
          evidenceSha256: 'a'.repeat(64)
        })
      ).toThrow(/Plan may change only closure status and ledger gaps/)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects rewrites of already-closed ledger claims', () => {
    const fixture = initializeClosureFixture()
    const planPath = resolve(
      fixture.root,
      'specs/plans/0009-criticmarkup-document-engine-rebuild.md'
    )
    try {
      setClosureFixtureState(fixture.root, 'verified')
      const plan = readFileSync(planPath, 'utf8')
        .split('\n')
        .map((line) => {
          if (!line.includes('| Document engine |')) return line
          return line.replace(/\| None\. \|$/u, '| — |')
        })
        .join('\n')
      writeFileSync(planPath, plan)
      execFileSync('git', ['add', '.'], { cwd: fixture.root })
      execFileSync('git', ['commit', '--quiet', '-m', 'rewritten closed claim'], {
        cwd: fixture.root
      })

      expect(() =>
        verify0009ClosureTransition({
          repoRoot: fixture.root,
          candidateCommit: fixture.candidateCommit,
          evidenceSha256: 'a'.repeat(64)
        })
      ).toThrow(/Plan may change only closure status and ledger gaps/)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects GREEN closure while any Plan ledger gap remains open', () => {
    const fixture = initializeClosureFixture()
    const planPath = resolve(
      fixture.root,
      'specs/plans/0009-criticmarkup-document-engine-rebuild.md'
    )
    try {
      setClosureFixtureState(fixture.root, 'verified')
      const plan = readFileSync(planPath, 'utf8')
        .split('\n')
        .map((line) => {
          if (!line.includes('| P10 release proof |')) return line
          const cells = line.split('|')
          cells[cells.length - 2] = ' Proof is still open. '
          return cells.join('|')
        })
        .join('\n')
      writeFileSync(planPath, plan)
      execFileSync('git', ['add', '.'], { cwd: fixture.root })
      execFileSync('git', ['commit', '--quiet', '-m', 'open-gap closure'], {
        cwd: fixture.root
      })

      expect(() =>
        verify0009ClosureTransition({
          repoRoot: fixture.root,
          candidateCommit: fixture.candidateCommit,
          evidenceSha256: 'a'.repeat(64)
        })
      ).toThrow(/GREEN status and zero open ledger gaps/)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('proves every acceptance closure deletion and evidence claim', () => {
    // Collection, not passing: this proves every named target is a real,
    // ordinarily collected, unskipped test. Whether it passes is proved by the
    // run reports the collector ingests, never by parsing the file.
    const acceptance = readJson<AcceptanceManifest>(resolve(MIGRATION_ROOT, '0009-acceptance.yml'))
    const exits = readJson<ExitManifest>(resolve(MIGRATION_ROOT, '0009-exit-gates.yml'))
    expect(acceptance.acceptance.every((row) => row.status === 'green')).toBe(true)
    expect(exits.phases.every((row) => row.status === 'green')).toBe(true)
    expect(exits.closure.every((row) => row.status === 'green')).toBe(true)
    expect(evidence().schema).toBe('marktext-0009-candidate-evidence-v8')
  })

  it('collects every acceptance primary and auxiliary target as one ordinary unskipped test', () => {
    const acceptance = readJson<AcceptanceManifest>(resolve(MIGRATION_ROOT, '0009-acceptance.yml'))
    // The manifest owns the roster; this target collects whatever it names,
    // so binding a new claim to a row cannot silently escape collection.
    const ids = acceptance.acceptance.map((row) => row.id)
    expect(ids).toEqual(
      Array.from({ length: ids.length }, (_, index) => `A${String(index + 1).padStart(2, '0')}`)
    )
    expect(ids.length).toBeGreaterThanOrEqual(32)
    for (const row of acceptance.acceptance) {
      for (const target of [row.target, ...(row.auxiliaryTargets ?? [])]) {
        expect(collectedOrdinaryTest(target), `${row.id}: ${target.path}`).toBe(true)
      }
    }
  })

  it('accepts a complete retry-free cross-surface evidence bundle', () => {
    expectCompleteEvidenceBundle(evidence())
  })

  it('rejects fabricated green metadata without result artifacts', () => {
    const fabricated = {
      schema: 'marktext-0009-candidate-evidence-v8',
      state: 'candidate',
      candidateCommit: 'not-a-commit',
      candidateTree: 'not-a-tree',
      dirtyState: [],
      createdAt: new Date().toISOString(),
      criticalControlFileHashes: {},
      runs: []
    } as unknown as EvidenceBundle
    expect(() => expectCompleteEvidenceBundle(fabricated)).toThrow()
  })

  it('rejects evidence bound to a different valid commit', () => {
    const previous = execFileSync('git', ['rev-parse', 'HEAD^'], {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    }).trim()
    const fabricated = {
      schema: 'marktext-0009-candidate-evidence-v8',
      state: 'candidate',
      candidateCommit: previous,
      candidateTree: execFileSync('git', ['rev-parse', `${previous}^{tree}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8'
      }).trim(),
      dirtyState: [],
      createdAt: new Date().toISOString(),
      criticalControlFileHashes: {},
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
        commands: [
          {
            id: 'github-platforms',
            report: { path: 'pass-1.json' }
          }
        ]
      },
      {
        githubRunDatabaseId: 101,
        commands: [
          {
            id: 'github-platforms',
            report: { path: 'pass-2.json' }
          }
        ]
      }
    ] as unknown as readonly EvidencePass[]
    expect(() => expectDistinctRemoteRuns(runs)).toThrow()
  })

  it('rejects a platform surface mapped to the wrong successful job', () => {
    const report = {
      databaseId: 101,
      jobs: [
        {
          databaseId: 11,
          name: PLATFORM_JOBS['windows-x64'],
          conclusion: 'success'
        }
      ]
    }
    expect(() => expectMatchingPlatformJob(report, 'macos-arm64')).toThrow()
  })

  it('records two distinct timestamp-bound fixed-surface passes', () => {
    const bundle = evidence()
    expect(bundle.runs).toHaveLength(2)
    expect(new Set(bundle.runs.map((run) => run.id)).size).toBe(2)
    expectDistinctRemoteRuns(bundle.runs)
    expect(instant(bundle.runs[1].startedAt)).toBeGreaterThanOrEqual(
      instant(bundle.runs[0].finishedAt)
    )
    expect(Object.keys(bundle.runs[0])).not.toContain('findings')
    expect(Object.keys(bundle.runs[1])).not.toContain('findings')
  })
})
