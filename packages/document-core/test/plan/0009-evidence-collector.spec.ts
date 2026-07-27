import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  collect0009Evidence,
  type CommandRequest,
  expectedEvidenceTargets,
  FIXED_CHECK_IDS,
  FIXED_TEST_IDS,
  parse0009EvidenceArguments,
  REQUIRED_ARTIFACTS,
  REQUIRED_SURFACES,
  validateExpectedEvidenceTargets,
  validatePlaywrightReport,
  validateVitestReport,
  validateGithubPlatformRun
} from './0009-evidence-collector.js'

function initializeRepository(): string {
  const root = mkdtempSync(resolve(tmpdir(), 'marktext-0009-collector-'))
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'evidence@example.invalid'], {
    cwd: root
  })
  execFileSync('git', ['config', 'user.name', 'Evidence Test'], {
    cwd: root
  })
  writeFileSync(resolve(root, '.gitignore'), 'evidence-app\n')
  writeFileSync(resolve(root, 'tracked.txt'), 'tracked\n')
  execFileSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: root })
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root })
  return root
}

function writeFixture(root: string, path: string, content: string): void {
  const absolute = resolve(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
}

function initializeEvidenceRepository(): string {
  const root = initializeRepository()
  const sourceRoot = resolve(import.meta.dirname, '../../../..')
  writeFixture(
    root,
    '.gitignore',
    [
      'evidence-app',
      'dist/',
      'node_modules/',
      'specs/migration/0009-final-evidence.yml',
      'specs/migration/0009-evidence/'
    ].join('\n') + '\n'
  )
  for (const path of REQUIRED_ARTIFACTS) {
    if (path === '.gitignore') continue
    let content = `fixture for ${path}\n`
    if (path === 'package.json') {
      content = JSON.stringify({
        packageManager: 'pnpm@10.33.4',
        scripts: { 'evidence:0009': 'tsx scripts/collect0009Evidence.ts' }
      })
    } else if (path === 'packages/desktop/package.json') {
      content = JSON.stringify({ version: '0.20.0-dev' })
    } else if (path === '.github/actions/setup/action.yml') {
      content = "inputs:\n  node-version:\n    default: '22.21.1'\n"
    } else if (
      path === 'specs/migration/0009-acceptance.yml' ||
      path === 'specs/migration/0009-exit-gates.yml'
    ) {
      content = readFileSync(resolve(sourceRoot, path), 'utf8')
    }
    writeFixture(root, path, content)
  }
  writeFixture(
    root,
    'node_modules/vitest/package.json',
    JSON.stringify({ version: '4.1.9' })
  )
  writeFixture(
    root,
    'node_modules/@playwright/test/package.json',
    JSON.stringify({ version: '1.61.0' })
  )
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '--quiet', '-m', 'evidence fixtures'], {
    cwd: root
  })
  return root
}

function platformSteps(): readonly object[] {
  return [
    {
      name: 'Build document-core and desktop',
      conclusion: 'success'
    },
    {
      name: 'Exercise Review through real Electron events',
      conclusion: 'success'
    }
  ]
}

function githubReport(
  runId: string,
  commit: string,
  completedAt = new Date().toISOString()
): object {
  const numeric = Number(runId)
  return {
    attempt: 1,
    conclusion: 'success',
    createdAt: completedAt,
    databaseId: numeric,
    headSha: commit,
    status: 'completed',
    updatedAt: completedAt,
    url: `https://github.com/marktext/marktext/actions/runs/${runId}`,
    workflowName: 'builds and exercises Review on macOS Windows and Linux',
    jobs: [
      {
        databaseId: numeric * 10 + 1,
        name: 'document-core-review-macos-arm64',
        conclusion: 'success',
        steps: platformSteps()
      },
      {
        databaseId: numeric * 10 + 2,
        name: 'document-core-review-windows-x64',
        conclusion: 'success',
        steps: platformSteps()
      },
      {
        databaseId: numeric * 10 + 3,
        name: 'document-core-review-linux-x64',
        conclusion: 'success',
        steps: platformSteps()
      }
    ]
  }
}

describe('plan 0009 evidence collector', () => {
  it('lets platform evidence run before the evidence-dependent final verifier', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')
    const packageManifest = JSON.parse(
      readFileSync(
        resolve(repoRoot, 'packages/document-core/package.json'),
        'utf8'
      )
    ) as {
      readonly scripts?: Readonly<Record<string, unknown>>
    }
    const workflow = readFileSync(
      resolve(repoRoot, '.github/workflows/document-core-platform.yml'),
      'utf8'
    )

    expect(packageManifest.scripts?.['test:platform']).toBe(
      'vitest run --exclude test/plan/0009-final-closure.spec.ts'
    )
    expect(packageManifest.scripts?.['check:platform']).toBe(
      'pnpm run lint && pnpm run typecheck && pnpm run test:platform && pnpm run build'
    )
    expect(workflow).toContain(
      'pnpm -C packages/document-core check:platform'
    )
    expect(workflow).not.toContain(
      'pnpm -C packages/document-core check\n'
    )
    expect(
      workflow.match(
        /- name: Exercise Review through real Electron events/g
      )
    ).toHaveLength(1)
    expect(workflow).not.toContain('if: matrix.')
    const postinstall = workflow.indexOf('pnpm tsx scripts/postinstall.ts')
    const build = workflow.indexOf(
      'pnpm -C packages/document-core check:platform'
    )
    expect(postinstall).toBeGreaterThan(-1)
    expect(postinstall).toBeLessThan(build)
    expect(workflow).toContain('libgtk-3-0')
    expect(workflow).toContain('shell: bash')
  })

  it('refuses a dirty worktree before executing any evidence command', async() => {
    const root = initializeRepository()
    const execute = vi.fn(() => {
      throw new Error('must not execute')
    })
    try {
      writeFileSync(resolve(root, 'uncommitted.txt'), 'not committed\n')

      await expect(collect0009Evidence({
        repoRoot: root,
        githubRunIds: ['101', '202'],
        execute
      })).rejects.toThrow(/clean committed worktree/)
      expect(execute).not.toHaveBeenCalled()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('requires exactly two distinct numeric GitHub run ids', async() => {
    const root = initializeRepository()
    const execute = vi.fn(() => {
      throw new Error('must not execute')
    })
    try {
      for (const githubRunIds of [
        ['101'],
        ['101', '101'],
        ['101', 'not-a-run']
      ]) {
        await expect(collect0009Evidence({
          repoRoot: root,
          githubRunIds,
          execute
        })).rejects.toThrow(/two distinct numeric GitHub run ids/)
      }
      expect(execute).not.toHaveBeenCalled()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts one first-attempt successful platform run with the exact jobs', () => {
    const commit = 'a'.repeat(40)
    const observedAt = Date.parse('2026-07-26T18:00:00.000Z')
    const report = {
      attempt: 1,
      conclusion: 'success',
      createdAt: '2026-07-26T17:30:00.000Z',
      databaseId: 101,
      headSha: commit,
      status: 'completed',
      updatedAt: '2026-07-26T17:45:00.000Z',
      url: 'https://github.com/marktext/marktext/actions/runs/101',
      workflowName: 'builds and exercises Review on macOS Windows and Linux',
      jobs: [
        {
          databaseId: 11,
          name: 'document-core-review-macos-arm64',
          conclusion: 'success',
          steps: platformSteps()
        },
        {
          databaseId: 12,
          name: 'document-core-review-windows-x64',
          conclusion: 'success',
          steps: platformSteps()
        },
        {
          databaseId: 13,
          name: 'document-core-review-linux-x64',
          conclusion: 'success',
          steps: platformSteps()
        }
      ]
    }

    expect(validateGithubPlatformRun(report, commit, observedAt)).toEqual({
      databaseId: 101,
      jobs: {
        'linux-x64': 13,
        'macos-arm64': 11,
        'windows-x64': 12
      }
    })
  })

  it('rejects reruns, foreign commits, and incomplete platform job sets', () => {
    const commit = 'a'.repeat(40)
    const observedAt = Date.parse('2026-07-26T18:00:00.000Z')
    const base = {
      attempt: 1,
      conclusion: 'success',
      createdAt: '2026-07-26T17:30:00.000Z',
      databaseId: 101,
      headSha: commit,
      status: 'completed',
      updatedAt: '2026-07-26T17:45:00.000Z',
      url: 'https://github.com/marktext/marktext/actions/runs/101',
      workflowName: 'builds and exercises Review on macOS Windows and Linux',
      jobs: [
        {
          databaseId: 11,
          name: 'document-core-review-macos-arm64',
          conclusion: 'success',
          steps: platformSteps()
        },
        {
          databaseId: 12,
          name: 'document-core-review-windows-x64',
          conclusion: 'success',
          steps: platformSteps()
        },
        {
          databaseId: 13,
          name: 'document-core-review-linux-x64',
          conclusion: 'success',
          steps: platformSteps()
        }
      ]
    }

    expect(() => validateGithubPlatformRun(
      { ...base, attempt: 2 },
      commit,
      observedAt
    )).toThrow(/first-attempt/)
    expect(() => validateGithubPlatformRun(
      { ...base, headSha: 'b'.repeat(40) },
      commit,
      observedAt
    )).toThrow(/current commit/)
    expect(() => validateGithubPlatformRun(
      { ...base, jobs: base.jobs.slice(0, 2) },
      commit,
      observedAt
    )).toThrow(/contain exactly/)
  })

  it('rejects missing stale future and inverted platform run timestamps', () => {
    const commit = 'a'.repeat(40)
    const observedAt = Date.parse('2026-07-26T18:00:00.000Z')
    const report = githubReport(
      '101',
      commit,
      '2026-07-26T17:45:00.000Z'
    ) as Record<string, unknown>

    expect(() => validateGithubPlatformRun(
      { ...report, createdAt: undefined },
      commit,
      observedAt
    )).toThrow(/timestamp/i)
    expect(() => validateGithubPlatformRun(
      {
        ...report,
        createdAt: '2026-07-24T17:30:00.000Z',
        updatedAt: '2026-07-24T17:45:00.000Z'
      },
      commit,
      observedAt
    )).toThrow(/fresh|24 hours/i)
    expect(() => validateGithubPlatformRun(
      {
        ...report,
        createdAt: '2026-07-26T18:05:00.000Z',
        updatedAt: '2026-07-26T18:06:00.000Z'
      },
      commit,
      observedAt
    )).toThrow(/future|timestamp/i)
    expect(() => validateGithubPlatformRun(
      {
        ...report,
        createdAt: '2026-07-26T17:50:00.000Z',
        updatedAt: '2026-07-26T17:45:00.000Z'
      },
      commit,
      observedAt
    )).toThrow(/order|timestamp/i)
  })

  it('rejects a platform run with an omitted or skipped job step', () => {
    const commit = 'a'.repeat(40)
    const report = githubReport('101', commit) as {
      readonly jobs: readonly Record<string, unknown>[]
    }
    const jobs = report.jobs.map((job, index) => ({
      ...job,
      steps: [
        {
          name: 'Build document-core and desktop',
          conclusion: 'success'
        },
        {
          name: 'Exercise Review through real Electron events',
          conclusion: index === 1 ? 'skipped' : 'success'
        }
      ]
    }))

    expect(() =>
      validateGithubPlatformRun({ ...report, jobs }, commit)
    ).toThrow(/platform job step/)
    expect(() =>
      validateGithubPlatformRun({
        ...report,
        jobs: jobs.map(({ steps: _steps, ...job }) => job)
      }, commit)
    ).toThrow(/platform job steps/)
  })

  it('derives zero-skip test counts from a successful Vitest JSON report', () => {
    const report = {
      success: true,
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      testResults: [{
        name: '/repo/example.spec.ts',
        status: 'passed',
        assertionResults: [{
          title: 'runs one named behavior',
          status: 'passed',
          failureMessages: []
        }]
      }]
    }
    expect(validateVitestReport(report)).toEqual({
      unit: 'tests',
      total: 1,
      failures: 0,
      retries: 0,
      skips: 0
    })
    expect(() => validateVitestReport({
      ...report,
      testResults: []
    })).toThrow(/test entr/i)
  })

  it('derives zero-retry counts from a successful Playwright JSON report', () => {
    const report = {
      config: {
        projects: [{ name: 'chromium', retries: 0 }]
      },
      errors: [],
      stats: {
        expected: 1,
        unexpected: 0,
        flaky: 0,
        skipped: 0
      },
      suites: [{
        title: 'example.spec.ts',
        file: '/repo/example.spec.ts',
        specs: [{
          title: 'runs one browser behavior',
          file: '/repo/example.spec.ts',
          tests: [{
            projectName: 'chromium',
            expectedStatus: 'passed',
            results: [{ status: 'passed', retry: 0 }]
          }]
        }]
      }]
    }
    expect(validatePlaywrightReport(report)).toEqual({
      unit: 'tests',
      total: 1,
      failures: 0,
      retries: 0,
      skips: 0
    })
    expect(() => validatePlaywrightReport({
      ...report,
      suites: []
    })).toThrow(/test entr/i)
  })

  it('requires every manifest test target exactly once in its fixed report', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')
    const targets = expectedEvidenceTargets(repoRoot, 'docs')
    const report = {
      success: true,
      numTotalTests: targets.length,
      numPassedTests: targets.length,
      numFailedTests: 0,
      numPendingTests: 0,
      testResults: targets.map(target => ({
        name: resolve(repoRoot, target.path),
        status: 'passed',
        assertionResults: [{
          title: target.title,
          status: 'passed',
          failureMessages: []
        }]
      }))
    }

    expect(() => validateExpectedEvidenceTargets(
      report,
      'vitest-json',
      repoRoot,
      resolve(repoRoot, 'packages/document-core'),
      'docs'
    )).not.toThrow()
    expect(() => validateExpectedEvidenceTargets(
      {
        ...report,
        numTotalTests: targets.length - 1,
        numPassedTests: targets.length - 1,
        testResults: report.testResults.slice(1)
      },
      'vitest-json',
      repoRoot,
      resolve(repoRoot, 'packages/document-core'),
      'docs'
    )).toThrow(/exactly once/)
    expect(() => validateExpectedEvidenceTargets(
      {
        ...report,
        numTotalTests: targets.length + 1,
        numPassedTests: targets.length + 1,
        testResults: [...report.testResults, report.testResults[0]]
      },
      'vitest-json',
      repoRoot,
      resolve(repoRoot, 'packages/document-core'),
      'docs'
    )).toThrow(/exactly once/)
  })

  it('pins at least one exact named report target for every fixed test command', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')
    for (const id of FIXED_TEST_IDS) {
      expect(expectedEvidenceTargets(repoRoot, id), id).not.toHaveLength(0)
    }
  })

  it('resolves Playwright file names from the pinned test directory', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')
    const [target] = expectedEvidenceTargets(repoRoot, 'browser')
    expect(target).toBeDefined()
    if (target === undefined) throw new Error('missing browser target')
    const report = {
      config: {
        projects: [{ name: 'chromium', retries: 0 }]
      },
      errors: [],
      stats: {
        expected: 1,
        unexpected: 0,
        flaky: 0,
        skipped: 0
      },
      suites: [{
        file: 'production-view.spec.ts',
        specs: [{
          file: 'production-view.spec.ts',
          title: target.title,
          tests: [{
            projectName: 'chromium',
            expectedStatus: 'passed',
            results: [{ status: 'passed', retry: 0 }]
          }]
        }]
      }]
    }

    expect(() => validateExpectedEvidenceTargets(
      report,
      'playwright-json',
      repoRoot,
      resolve(repoRoot, 'packages/document-view'),
      'browser',
      'chromium'
    )).not.toThrow()
  })

  it('configures every local Playwright runner with unconditional zero retries', async() => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')
    const [desktop, documentView] = await Promise.all([
      import(pathToFileURL(resolve(
        repoRoot,
        'packages/desktop/test/e2e/playwright.config.ts'
      )).href),
      import(pathToFileURL(resolve(
        repoRoot,
        'packages/document-view/e2e/playwright.config.ts'
      )).href)
    ]) as readonly [
      { readonly default: Readonly<{ readonly retries?: number }> },
      { readonly default: Readonly<{ readonly retries?: number }> }
    ]

    expect(desktop.default.retries).toBe(0)
    expect(documentView.default.retries).toBe(0)
  })

  it('freezes every required check and evidence surface in the collector', () => {
    expect(FIXED_CHECK_IDS).toEqual([
      'repo-lint',
      'core-typecheck',
      'core-build',
      'view-typecheck',
      'desktop-typecheck',
      'desktop-build'
    ])
    expect(FIXED_TEST_IDS).toEqual([
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
    ])
    expect(REQUIRED_SURFACES).toEqual([
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
    ])
  })

  it('hashes the collector, CLI, runner configs, workflow, and contract artifacts', () => {
    expect(REQUIRED_ARTIFACTS).toEqual([
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
    ])
  })

  it('parses exactly two explicit GitHub runs for the CLI', () => {
    expect(parse0009EvidenceArguments([
      '--github-run',
      '101',
      '--github-run=202'
    ])).toEqual(['101', '202'])
    expect(() => parse0009EvidenceArguments([
      '--github-run',
      '101'
    ])).toThrow(/exactly twice/)
    expect(() => parse0009EvidenceArguments([
      '--github-run',
      '101',
      '--github-run',
      '202',
      '--unknown'
    ])).toThrow(/Unknown evidence collector argument/)
  })

  it('writes two independently timestamped fixed passes and invokes the final verifier last', async() => {
    const root = initializeEvidenceRepository()
    const packagedApp = resolve(root, 'evidence-app')
    writeFileSync(packagedApp, 'fixture app\n')
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
    const requests: CommandRequest[] = []
    const cleanupInstalledArtifact = vi.fn()
    const execute = vi.fn(async(request: CommandRequest) => {
      requests.push(request)
      if (request.id === 'installed-artifact-build') {
        const artifactPath =
          request.environment?.MARKTEXT_EXPECTED_ARTIFACT_PATH
        if (artifactPath === undefined) throw new Error('missing artifact path')
        mkdirSync(dirname(artifactPath), { recursive: true })
        writeFileSync(artifactPath, `artifact for ${commit}\n`)
      }
      if (request.kind === 'github') {
        const runId = request.command.find((part) => /^\d+$/.test(part))
        if (runId === undefined) throw new Error('missing run id')
        return {
          exitCode: 0,
          stdout: JSON.stringify(githubReport(runId, commit)),
          stderr: ''
        }
      }
      if (request.reportPath !== undefined) {
        mkdirSync(dirname(request.reportPath), { recursive: true })
        const manifestTargets = expectedEvidenceTargets(root, request.id)
        const targets = manifestTargets.length === 0
          ? [{
            path: 'packages/document-core/test/plan/collector-fixture.spec.ts',
            title: `${request.id} fixture`
          }]
          : manifestTargets
        const project = request.command
          .find(argument => argument.startsWith('--project='))
          ?.slice('--project='.length) ?? 'chromium'
        const report = request.reportFormat === 'vitest-json'
          ? {
            success: true,
            numTotalTests: targets.length,
            numPassedTests: targets.length,
            numFailedTests: 0,
            numPendingTests: 0,
            testResults: targets.map(target => ({
              name: resolve(root, target.path),
              status: 'passed',
              assertionResults: [{
                title: target.title,
                status: 'passed',
                failureMessages: []
              }]
            }))
          }
          : {
            config: { projects: [{ name: project, retries: 0 }] },
            errors: [],
            stats: {
              expected: targets.length,
              unexpected: 0,
              flaky: 0,
              skipped: 0
            },
            suites: targets.map(target => ({
              title: target.path,
              file: resolve(root, target.path),
              specs: [{
                title: target.title,
                file: resolve(root, target.path),
                tests: [{
                  projectName: project,
                  expectedStatus: 'passed',
                  results: [{ status: 'passed', retry: 0 }]
                }]
              }]
            }))
          }
        writeFileSync(request.reportPath, JSON.stringify(report))
      }
      return { exitCode: 0, stdout: `${request.id} passed\n`, stderr: '' }
    })

    try {
      const bundle = await collect0009Evidence({
        repoRoot: root,
        githubRunIds: ['101', '202'],
        execute,
        mountInstalledArtifact: ({ artifactPath }) => {
          expect(readFileSync(artifactPath, 'utf8')).toContain(commit)
          return {
            executablePath: packagedApp,
            cleanup: cleanupInstalledArtifact
          }
        }
      })

      expect(bundle.schema).toBe('marktext-0009-final-evidence-v5')
      expect(bundle.commit).toBe(commit)
      expect(bundle.dirtyState).toEqual([])
      expect(bundle.installedArtifact).toMatchObject({
        commit,
        path: expect.stringMatching(/^dist\//),
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        executableSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        build: {
          id: 'installed-artifact-build',
          kind: 'check',
          exitCode: 0
        }
      })
      expect(Object.keys(bundle.artifactHashes).sort())
        .toEqual([...REQUIRED_ARTIFACTS].sort())
      expect(bundle.runs).toHaveLength(2)
      expect(bundle.runs.map((run) => run.ordinal)).toEqual([1, 2])
      expect(bundle.runs.map((run) => run.githubRunDatabaseId))
        .toEqual([101, 202])
      for (const run of bundle.runs) {
        expect(run).not.toHaveProperty('fresh')
        expect(run).not.toHaveProperty('findings')
        expect(run.commands.map((command) => command.id).sort()).toEqual([
          ...FIXED_CHECK_IDS,
          ...FIXED_TEST_IDS,
          'github-platforms'
        ].sort())
        expect(Object.keys(run.surfaces).sort())
          .toEqual([...REQUIRED_SURFACES].sort())
        for (const command of run.commands) {
          expect(command.exitCode).toBe(0)
          expect(command.report.sha256).toMatch(/^[0-9a-f]{64}$/)
          expect(existsSync(resolve(root, command.report.path))).toBe(true)
        }
      }

      const evidencePath = resolve(
        root,
        'specs/migration/0009-final-evidence.yml'
      )
      expect(JSON.parse(readFileSync(evidencePath, 'utf8'))).toEqual(bundle)
      expect(requests.at(-1)?.kind).toBe('verifier')
      expect(requests.at(-1)?.id).toBe('final-verifier')
      const installedRequests = requests.filter(({ id }) => id === 'installed')
      expect(installedRequests).toHaveLength(2)
      for (const request of installedRequests) {
        expect(request.environment).toMatchObject({
          MARKTEXT_PACKAGED_APP: packagedApp,
          MARKTEXT_EXPECTED_COMMIT: commit,
          MARKTEXT_EXPECTED_ARTIFACT_SHA256:
            bundle.installedArtifact.sha256,
          MARKTEXT_EXPECTED_EXECUTABLE_SHA256:
            bundle.installedArtifact.executableSha256
        })
      }
      for (const request of requests.filter(({ kind }) => kind === 'test')) {
        if (request.reportFormat === 'vitest-json') {
          expect(request.command).toContain('--allowOnly=false')
        } else {
          expect(request.command).toContain('--forbid-only')
        }
      }
      for (const request of requests.filter(({ id }) => id === 'repo-lint')) {
        expect(request.command).toEqual([
          process.platform === 'win32' ? 'npm.cmd' : 'npm',
          'exec',
          '--yes',
          '--package=pnpm@10.33.4',
          '--',
          'pnpm',
          'exec',
          'eslint',
          '--no-cache',
          '.'
        ])
      }
      expect(execute).toHaveBeenCalledTimes(
        2 * (FIXED_CHECK_IDS.length + FIXED_TEST_IDS.length + 1) + 2
      )
      expect(cleanupInstalledArtifact).toHaveBeenCalledOnce()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
