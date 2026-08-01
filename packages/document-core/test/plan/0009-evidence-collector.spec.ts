import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  assertElectronArchiveChecksum,
  extractElectronArchive,
  findElectronArchive,
  sanitizeElectronEnvironment,
  stageAuthenticatedElectronArchive,
  UNTRUSTED_ELECTRON_ENVIRONMENT_KEYS
} from '../../../../scripts/electronIntegrity.mjs'
import {
  authenticateElectronHeaderArtifact,
  electronHeaderArtifactsFor,
  electronRebuildArguments,
  fetchBoundedElectronHeaderBytes,
  PINNED_ELECTRON_HEADER_ARTIFACTS,
  startAuthenticatedElectronHeaderProxyFromArtifacts
} from '../../../../scripts/runElectronRebuild.mjs'
import {
  collect0009Evidence,
  create0009VerifiedClosure,
  CRITICAL_EVIDENCE_CONTROL_FILES,
  download0009PublishedEvidence,
  type CommandRequest,
  expectedEvidenceRequest,
  expectedEvidenceTargets,
  FIXED_CHECK_IDS,
  FIXED_TEST_IDS,
  parse0009EvidenceArguments,
  PINNED_EVIDENCE_ACTIONS,
  PINNED_PNPM_PACKAGE_MANAGER,
  PLATFORM_REQUIRED_STEPS,
  REQUIRED_SURFACES,
  sanitizeEvidenceEnvironment,
  validate0009EvidenceSupplyChain,
  validate0009PinnedActions,
  validate0009CandidateEvidence,
  validateEvidenceCollectorPlatform,
  validateExpectedEvidenceTargets,
  validatePlaywrightReport,
  validateVitestReport,
  validateGithubPlatformRun,
  validateGithubRunEvidence,
  validateSequentialGithubRuns,
  write0009CiClosureAttestation
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

function replaceNamedYamlStepWithNoOp(source: string, name: string): string {
  const lines = source.replace(/\r\n/gu, '\n').split('\n')
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`)
  if (start === -1) throw new Error(`Missing YAML step fixture: ${name}`)
  const indentation = /^\s*/u.exec(lines[start] ?? '')?.[0] ?? ''
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim().length === 0) continue
    const nextIndentation = /^\s*/u.exec(line)?.[0].length ?? 0
    if (
      nextIndentation < indentation.length ||
      (nextIndentation === indentation.length && line.trimStart().startsWith('- '))
    ) {
      end = index
      break
    }
  }
  return [
    ...lines.slice(0, start),
    `${indentation}- name: ${name}`,
    `${indentation}  run: 'true'`,
    ...lines.slice(end)
  ].join('\n')
}

function writeCandidateClosureState(root: string): void {
  const acceptancePath = resolve(root, 'specs/migration/0009-acceptance.yml')
  const exitsPath = resolve(root, 'specs/migration/0009-exit-gates.yml')
  const planPath = resolve(root, 'specs/plans/0009-criticmarkup-document-engine-rebuild.md')
  const acceptance = JSON.parse(readFileSync(acceptancePath, 'utf8')) as {
    acceptance: { id: string; status: string }[]
  }
  const exits = JSON.parse(readFileSync(exitsPath, 'utf8')) as {
    phases: { id: string; status: string }[]
    closure: { id: string; status: string }[]
  }
  const pendingAcceptance = new Set(['A30', 'A31', 'A32'])
  const pendingClosure = new Set(['D07', 'D08', 'D10'])
  for (const row of acceptance.acceptance) {
    row.status = pendingAcceptance.has(row.id) ? 'red' : 'green'
  }
  for (const row of exits.phases) {
    row.status = row.id === 'P10' ? 'red' : 'green'
  }
  for (const row of exits.closure) {
    row.status = pendingClosure.has(row.id) ? 'red' : 'green'
  }
  writeFileSync(acceptancePath, JSON.stringify(acceptance, null, 2) + '\n')
  writeFileSync(exitsPath, JSON.stringify(exits, null, 2) + '\n')
  const plan = readFileSync(planPath, 'utf8')
    .replace(/^- \*\*Status:\*\* [^\n]+$/mu, '- **Status:** RED — P10 candidate evidence pending')
    .split('\n')
    .map((line) => {
      if (
        !line.startsWith('|') ||
        /^\|\s*-/u.test(line) ||
        line.includes('| P10 release proof |')
      ) {
        return line
      }
      if (line.startsWith('| Area |')) return line
      return line.replace(/\|[^|]*\|\s*$/u, '| None. |')
    })
    .join('\n')
  writeFileSync(planPath, plan)
}

function writeVerifiedClosureState(root: string): void {
  const acceptancePath = resolve(root, 'specs/migration/0009-acceptance.yml')
  const exitsPath = resolve(root, 'specs/migration/0009-exit-gates.yml')
  const planPath = resolve(root, 'specs/plans/0009-criticmarkup-document-engine-rebuild.md')
  const acceptance = JSON.parse(readFileSync(acceptancePath, 'utf8')) as {
    acceptance: { status: string }[]
  }
  const exits = JSON.parse(readFileSync(exitsPath, 'utf8')) as {
    phases: { status: string }[]
    closure: { status: string }[]
  }
  for (const row of acceptance.acceptance) row.status = 'green'
  for (const row of exits.phases) row.status = 'green'
  for (const row of exits.closure) row.status = 'green'
  writeFileSync(acceptancePath, JSON.stringify(acceptance, null, 2) + '\n')
  writeFileSync(exitsPath, JSON.stringify(exits, null, 2) + '\n')
  const plan = readFileSync(planPath, 'utf8')
    .replace(/^- \*\*Status:\*\* [^\n]+$/mu, '- **Status:** GREEN — verified closure')
    .split('\n')
    .map((line) => {
      if (!line.startsWith('|') || /^\|\s*-/u.test(line)) return line
      if (line.startsWith('| Area |')) return line
      return line.replace(/\|[^|]*\|\s*$/u, '| None. |')
    })
    .join('\n')
  writeFileSync(planPath, plan)
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
      'test-results/',
      'specs/migration/0009-candidate-evidence.yml',
      'specs/migration/0009-closure-attestation.yml',
      'specs/migration/0009-evidence/'
    ].join('\n') + '\n'
  )
  for (const path of CRITICAL_EVIDENCE_CONTROL_FILES) {
    if (path === '.gitignore') continue
    // Default to the candidate's own bytes. A placeholder here would make the
    // un-mutated fixture fail the validator, and every mutation row would then
    // pass for a reason it never states.
    const sourcePath = resolve(sourceRoot, path)
    let content = existsSync(sourcePath)
      ? readFileSync(sourcePath, 'utf8')
      : `fixture for ${path}\n`
    if (path === 'package.json') {
      content = JSON.stringify({
        packageManager: PINNED_PNPM_PACKAGE_MANAGER,
        scripts: { 'evidence:0009': 'tsx scripts/collect0009Evidence.ts' }
      })
    } else if (
      path === 'packages/desktop/package.json' ||
      path === 'packages/desktop/electron-builder.yml'
    ) {
      content = readFileSync(resolve(sourceRoot, path), 'utf8')
    } else if (path === '.github/actions/setup/action.yml') {
      content = readFileSync(resolve(sourceRoot, path), 'utf8').replace(
        /default: '[0-9]+\.[0-9]+\.[0-9]+'/u,
        `default: '${process.version.slice(1)}'`
      )
    } else if (
      path === '.github/workflows/document-core-platform.yml' ||
      path === 'packages/document-core/test/plan/0009-evidence-collector.ts' ||
      path === 'scripts/electronIntegrity.mts' ||
      path === 'scripts/postinstall.ts' ||
      path === 'scripts/runElectronRebuild.mts' ||
      path === 'scripts/runPinnedCorepack.mjs'
    ) {
      content = readFileSync(resolve(sourceRoot, path), 'utf8')
    } else if (path === 'pnpm-lock.yaml') {
      content = [
        "lockfileVersion: '9.0'",
        '',
        'packages:',
        "  '@playwright/test@1.61.0':",
        '    resolution: {}',
        '  vitest@4.1.9:',
        '    resolution: {}'
      ].join('\n') + '\n'
    } else if (
      path === 'specs/migration/0009-acceptance.yml' ||
      path === 'specs/migration/0009-exit-gates.yml' ||
      path === 'specs/plans/0009-criticmarkup-document-engine-rebuild.md'
    ) {
      content = readFileSync(resolve(sourceRoot, path), 'utf8')
    }
    writeFixture(root, path, content)
  }
  writeCandidateClosureState(root)
  writeFixture(root, 'node_modules/vitest/package.json', JSON.stringify({ version: '4.1.9' }))
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
      name: 'Prepare Electron runtime',
      conclusion: 'success'
    },
    {
      name: 'Verify runner architecture',
      conclusion: 'success'
    },
    {
      name: 'Build document-core and desktop',
      conclusion: 'success'
    },
    {
      name: 'Exercise Review through real Electron events',
      conclusion: 'success'
    },
    {
      name: 'Write compact platform attestation',
      conclusion: 'success'
    },
    {
      name: 'Upload compact platform attestation',
      conclusion: 'success'
    }
  ]
}

function candidateClosureProofSteps(): readonly object[] {
  return [
    {
      name: 'Classify Plan 0009 closure state',
      conclusion: 'success'
    },
    {
      name: 'Prove GREEN closure or admit RED candidate',
      conclusion: 'skipped'
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
    event: 'push',
    headBranch: `evidence/0009/pass-${runId}`,
    headSha: commit,
    status: 'completed',
    updatedAt: completedAt,
    url: `https://github.com/csells/MarkText/actions/runs/${runId}`,
    refType: 'tag',
    workflowDatabaseId: 9009,
    workflowName: 'builds and exercises Review on macOS Windows and Linux',
    workflowPath: '.github/workflows/document-core-platform.yml',
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
      },
      {
        databaseId: numeric * 10 + 4,
        name: 'document-core-closure-proof',
        conclusion: 'success',
        steps: candidateClosureProofSteps()
      }
    ]
  }
}

function githubRunEvidence(
  runId: string,
  commit: string,
  completedAt = new Date().toISOString(),
  // Direct validator unit tests pin against the collector's default
  // PINNED_NODE_VERSION; the collect0009Evidence flow passes the live host
  // version because initializeEvidenceRepository rewrites the fixture repo's
  // action.yml node pin to process.version so the runtime gate passes on any
  // dev machine — the attestation must attest the identity the fixture
  // candidate actually pins.
  node = 'v22.21.1'
): object {
  const platforms = [
    ['macos-arm64', 'arm64', 'darwin'],
    ['windows-x64', 'x64', 'win32'],
    ['linux-x64', 'x64', 'linux']
  ] as const
  return {
    schema: 'marktext-0009-github-run-evidence-v1',
    run: githubReport(runId, commit, completedAt),
    attestations: platforms.map(([platform, arch, os], index) => ({
      artifactId: Number(runId) * 100 + index + 1,
      artifactName: `document-core-platform-${platform}-${commit}`,
      artifactDigest: `sha256:${String(index + 1).repeat(64)}`,
      fileName: `${platform}.json`,
      contentBase64: Buffer.from(
        JSON.stringify({
          schema: 'marktext-0009-platform-attestation-v1',
          state: 'verified',
          candidateCommit: commit,
          refName: `evidence/0009/pass-${runId}`,
          refType: 'tag',
          workflow: 'builds and exercises Review on macOS Windows and Linux',
          workflowRef:
            'csells/MarkText/.github/workflows/document-core-platform.yml@refs/tags/' +
            `evidence/0009/pass-${runId}`,
          runId,
          runAttempt: '1',
          job: `document-core-review-${platform}`,
          platform,
          arch,
          os,
          node,
          runnerImageOs: `${os}-fixture`,
          runnerImageVersion: '20260726.1',
          verifiedAt: completedAt
        }) + '\n'
      ).toString('base64')
    }))
  }
}

describe('plan 0009 evidence collector', () => {
  it('rejects every mutable or unapproved action in the evidence control plane', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')
    expect(() => validate0009PinnedActions(repoRoot)).not.toThrow()

    const mutations = [
      ['.github/workflows/document-core-platform.yml', 'actions/checkout', 'v4'],
      ['.github/workflows/document-core-platform.yml', 'actions/upload-artifact', 'v4'],
      ['.github/actions/setup/action.yml', 'actions/setup-node', 'v4.4.0']
    ] as const
    for (const [path, action, mutableTag] of mutations) {
      const root = mkdtempSync(resolve(tmpdir(), 'marktext-0009-action-pin-'))
      try {
        for (const sourcePath of [
          '.github/actions/setup/action.yml',
          '.github/workflows/document-core-platform.yml'
        ]) {
          writeFixture(root, sourcePath, readFileSync(resolve(repoRoot, sourcePath), 'utf8'))
        }
        const source = readFileSync(resolve(root, path), 'utf8')
        const pinned = `${action}@${PINNED_EVIDENCE_ACTIONS[action]}`
        expect(source).toContain(pinned)
        writeFixture(root, path, source.replace(pinned, `${action}@${mutableTag}`))
        expect(() => validate0009PinnedActions(root)).toThrow(/pinned action references/i)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }

    const root = mkdtempSync(resolve(tmpdir(), 'marktext-0009-action-allowlist-'))
    try {
      for (const sourcePath of [
        '.github/actions/setup/action.yml',
        '.github/workflows/document-core-platform.yml'
      ]) {
        writeFixture(root, sourcePath, readFileSync(resolve(repoRoot, sourcePath), 'utf8'))
      }
      const workflowPath = '.github/workflows/document-core-platform.yml'
      const source = readFileSync(resolve(root, workflowPath), 'utf8')
      writeFixture(
        root,
        workflowPath,
        source.replace('actions/checkout@', 'unapproved/checkout@')
      )
      expect(() => validate0009PinnedActions(root)).toThrow(/pinned action references/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('content-addresses every pnpm bootstrap before executing pnpm', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')
    const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
      readonly packageManager?: unknown
    }
    expect(manifest.packageManager).toBe(PINNED_PNPM_PACKAGE_MANAGER)
    expect(PINNED_PNPM_PACKAGE_MANAGER).toMatch(
      /^pnpm@10\.33\.4\+sha512\.[0-9a-f]{128}$/u
    )

    const setup = readFileSync(resolve(repoRoot, '.github/actions/setup/action.yml'), 'utf8')
    expect(setup).not.toContain('pnpm/action-setup@')
    expect(setup).not.toMatch(/^\s*(?:corepack|pnpm)\b/mu)
    expect(setup).toContain('node scripts/runPinnedCorepack.mjs "$package_manager" --version')
    expect(setup).toContain(
      'node scripts/runPinnedCorepack.mjs "$package_manager" install --frozen-lockfile --ignore-scripts'
    )
    expect(setup).toContain(PINNED_PNPM_PACKAGE_MANAGER)

    const request = expectedEvidenceRequest({
      id: 'workspace-prepare',
      repoRoot,
      reportPath: resolve(repoRoot, 'test-results/content-addressed-pnpm.json')
    })
    expect(request.command.slice(0, 4)).toEqual([
      process.execPath,
      resolve(repoRoot, 'scripts/runPinnedCorepack.mjs'),
      PINNED_PNPM_PACKAGE_MANAGER,
      'install'
    ])
    expect(request.environment).toEqual({
      MARKTEXT_COREPACK_BUNDLE_SHA256:
        'bafd892df44cd70740e23e5d43eeea934b4f261a9eaff3637dac29bdea74d829',
      MARKTEXT_COREPACK_CLI_PATH: resolve(
        dirname(process.execPath),
        process.platform === 'win32'
          ? 'node_modules/corepack/dist/corepack.js'
          : '../lib/node_modules/corepack/dist/corepack.js'
      ),
      MARKTEXT_COREPACK_LAUNCHER_SHA256:
        '3655bc798f300951f2070fee411b337d626b0c3ae80c2d24c46ccac4595d4bf9',
      MARKTEXT_COREPACK_VERSION: '0.34.0'
    })
    expect(request.command).not.toContain('npm')

    const root = initializeEvidenceRepository()
    try {
      writeFileSync(
        resolve(root, 'package.json'),
        JSON.stringify({
          packageManager: 'pnpm@10.33.4',
          scripts: { 'evidence:0009': 'tsx scripts/collect0009Evidence.ts' }
        })
      )
      execFileSync('git', ['add', 'package.json'], { cwd: root })
      execFileSync('git', ['commit', '--quiet', '-m', 'remove pnpm content identity'], {
        cwd: root
      })
      const candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8'
      }).trim()
      expect(() =>
        expectedEvidenceRequest({
          id: 'workspace-prepare',
          repoRoot: root,
          reportPath: resolve(root, 'test-results/mutable-pnpm.json'),
          expectedCommit: candidateCommit
        })
      ).toThrow(/content-addressed/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('deletes inherited Electron checksum and binary-location bypasses', () => {
    const inherited = Object.freeze({
      PATH: '/usr/bin',
      SAFE_VALUE: 'preserved',
      electron_use_remote_checksums: '0',
      NPM_CONFIG_ELECTRON_USE_REMOTE_CHECKSUMS: 'true',
      ELECTRON_OVERRIDE_DIST_PATH: '/tmp/untrusted-electron',
      ELECTRON_MIRROR: 'https://untrusted.invalid/electron/',
      ELECTRON_CUSTOM_VERSION: '0.0.0',
      ELECTRON_INSTALL_PLATFORM: 'linux',
      ELECTRON_INSTALL_ARCH: 'x64',
      electron_config_cache: '/tmp/untrusted-cache',
      npm_config_platform: 'foreign-platform',
      npm_config_arch: 'foreign-arch'
    })
    const sanitized = sanitizeElectronEnvironment(inherited, {
      Electron_Override_Dist_Path: '/tmp/reintroduced',
      REQUEST_VALUE: 'preserved-too'
    })

    expect(sanitized).toMatchObject({
      PATH: '/usr/bin',
      SAFE_VALUE: 'preserved',
      REQUEST_VALUE: 'preserved-too'
    })
    for (const key of UNTRUSTED_ELECTRON_ENVIRONMENT_KEYS) {
      expect(
        Object.keys(sanitized).some((candidate) => candidate.toLowerCase() === key)
      ).toBe(false)
    }
    expect(inherited.ELECTRON_OVERRIDE_DIST_PATH).toBe('/tmp/untrusted-electron')

    const postinstall = readFileSync(
      resolve(import.meta.dirname, '../../../../scripts/postinstall.ts'),
      'utf8'
    )
    expect(postinstall).toContain('const plat = os.platform()')
    expect(postinstall).toContain('const arch = os.arch()')
    expect(postinstall).toContain(
      "const cacheRoot = path.join(os.homedir(), 'Library', 'Caches', 'electron')"
    )
    expect(postinstall).not.toMatch(
      /process\.env\.(?:ELECTRON_INSTALL_PLATFORM|ELECTRON_INSTALL_ARCH|ELECTRON_MIRROR|ELECTRON_OVERRIDE_DIST_PATH|electron_config_cache|electron_use_remote_checksums|npm_config_platform|npm_config_arch)/u
    )
    expect(postinstall).not.toContain('npmmirror.com')
  })

  it('admits only declared host primitives into evidence subprocesses', () => {
    const sanitized = sanitizeEvidenceEnvironment(
      {
        PATH: '/trusted/bin',
        HOME: '/trusted/home',
        GH_TOKEN: 'authorization-only',
        VITEST: 'true',
        NODE_OPTIONS: '--import=/tmp/hostile-loader.mjs',
        TSX_TSCONFIG_PATH: '/tmp/hostile-tsconfig.json',
        MARKTEXT_PACKAGED_APP: '/tmp/hostile-app',
        PLAYWRIGHT_JSON_OUTPUT_FILE: '/tmp/hostile-report.json',
        ELECTRON_OVERRIDE_DIST_PATH: '/tmp/hostile-electron'
      },
      {
        CI: '1',
        MARKTEXT_PACKAGED_APP: '/authenticated/app',
        PLAYWRIGHT_JSON_OUTPUT_FILE: '/authenticated/report.json'
      }
    )

    expect(sanitized).toEqual({
      PATH: '/trusted/bin',
      HOME: '/trusted/home',
      GH_TOKEN: 'authorization-only',
      CI: '1',
      MARKTEXT_PACKAGED_APP: '/authenticated/app',
      PLAYWRIGHT_JSON_OUTPUT_FILE: '/authenticated/report.json'
    })
    expect(sanitized).not.toHaveProperty('VITEST')
    expect(sanitized).not.toHaveProperty('NODE_OPTIONS')
    expect(sanitized).not.toHaveProperty('TSX_TSCONFIG_PATH')
    expect(sanitized).not.toHaveProperty('ELECTRON_OVERRIDE_DIST_PATH')
  })

  it('rejects an unverified Electron cache archive before system unzip', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'marktext-electron-cache-integrity-'))
    try {
      const archivePath = resolve(root, 'electron.zip')
      const archive = Buffer.from('authenticated archive fixture')
      writeFileSync(archivePath, archive)
      const checksum = createHash('sha256').update(archive).digest('hex')

      expect(() => assertElectronArchiveChecksum(archivePath, checksum)).not.toThrow()
      expect(() =>
        assertElectronArchiveChecksum(archivePath, '0'.repeat(64))
      ).toThrow(/checksum/i)

      const postinstall = readFileSync(
        resolve(import.meta.dirname, '../../../../scripts/postinstall.ts'),
        'utf8'
      )
      const checksumCheck = postinstall.indexOf(
        'stageAuthenticatedElectronArchive(zipPath, expectedChecksum)'
      )
      const unzip = postinstall.indexOf(
        'extractElectronArchive(stagedArchive.path, distDir)'
      )
      expect(checksumCheck).toBeGreaterThan(-1)
      expect(checksumCheck).toBeLessThan(unzip)
      expect(postinstall).not.toContain('isPnpm')
      expect(postinstall).not.toMatch(/\bnpm\s+install\b/u)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('passes hostile Electron cache paths to unzip as literal file arguments', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'marktext-electron-hostile-path-'))
    try {
      const archiveName = 'electron-v42.1.0-darwin-arm64.zip'
      const hostileDirectory = resolve(root, 'cache"; touch SHOULD_NOT_EXIST; #')
      const archivePath = resolve(hostileDirectory, archiveName)
      const destinationPath = resolve(root, 'dist"; touch ALSO_NOT_CREATED; #')
      writeFixture(root, `cache"; touch SHOULD_NOT_EXIST; #/${archiveName}`, 'archive')

      expect(findElectronArchive(root, archiveName)).toBe(archivePath)
      expect(existsSync(resolve(root, 'SHOULD_NOT_EXIST'))).toBe(false)

      const execute = vi.fn()
      extractElectronArchive(archivePath, destinationPath, execute)
      expect(execute).toHaveBeenCalledOnce()
      expect(execute).toHaveBeenCalledWith(
        'unzip',
        ['-q', archivePath, '-d', destinationPath],
        { stdio: 'inherit' }
      )

      const postinstall = readFileSync(
        resolve(import.meta.dirname, '../../../../scripts/postinstall.ts'),
        'utf8'
      )
      expect(postinstall).toContain('findElectronArchive(cacheRoot, zipName)')
      expect(postinstall).toContain('extractElectronArchive(stagedArchive.path, distDir)')
      expect(postinstall).not.toContain('execSync')
      expect(postinstall).not.toContain('run(`unzip')
      expect(postinstall).toContain("throw new Error('Required native-keymap source is missing")
      expect(postinstall).not.toContain('pnpm --filter marktext add native-keymap')
      expect(postinstall).toContain("throw new Error('electron/install.js not found")
      expect(postinstall).not.toContain('skipping Electron download')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('extracts verified staged bytes even when the untrusted cache path is swapped', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'marktext-electron-source-swap-'))
    let cleanupStagedArchive = (): void => {}
    try {
      const sourcePath = resolve(root, 'electron.zip')
      const trustedBytes = Buffer.from('trusted Electron archive')
      writeFileSync(sourcePath, trustedBytes)
      const expectedChecksum = createHash('sha256').update(trustedBytes).digest('hex')

      const stagedArchive = stageAuthenticatedElectronArchive(
        sourcePath,
        expectedChecksum
      )
      cleanupStagedArchive = stagedArchive.cleanup
      writeFileSync(sourcePath, 'swapped cache bytes')

      expect(() =>
        assertElectronArchiveChecksum(stagedArchive.path, expectedChecksum)
      ).not.toThrow()
      expect(() => assertElectronArchiveChecksum(sourcePath, expectedChecksum)).toThrow(
        /checksum/i
      )

      const execute = vi.fn()
      extractElectronArchive(stagedArchive.path, resolve(root, 'dist'), execute)
      expect(execute).toHaveBeenCalledWith(
        'unzip',
        ['-q', stagedArchive.path, '-d', resolve(root, 'dist')],
        { stdio: 'inherit' }
      )

      stagedArchive.cleanup()
      expect(existsSync(stagedArchive.path)).toBe(false)
    } finally {
      cleanupStagedArchive()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects mutable Electron header inputs before native compilation', () => {
    expect(PINNED_ELECTRON_HEADER_ARTIFACTS).toMatchObject({
      version: '42.1.0',
      headers: {
        path: 'node-v42.1.0-headers.tar.gz',
        sha256: '0cfc1d20f252d6c29bdd14b1f3caa30edc6477db93e5a6620674424b38dcddfd'
      },
      windows: {
        x64: {
          path: 'win-x64/node.lib',
          sha256: 'f2ba9d9c6211b723c9ccce54144e6cd5eaec00cacfe4cfb4df40247a4fedace1'
        }
      }
    })

    const bytes = Buffer.from('pinned header fixture')
    const artifact = {
      path: 'fixture.tar.gz',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      maximumBytes: bytes.length
    }
    expect(authenticateElectronHeaderArtifact(artifact, bytes)).toEqual(bytes)
    expect(() =>
      authenticateElectronHeaderArtifact(artifact, Buffer.from('mutable replacement'))
    ).toThrow(/checksum/i)
    expect(() =>
      authenticateElectronHeaderArtifact({ ...artifact, maximumBytes: 1 }, bytes)
    ).toThrow(/size/i)

    expect(electronRebuildArguments('http://127.0.0.1:43109/headers', 'x64')).toEqual([
      '-f',
      '--build-from-source',
      '--dist-url',
      'http://127.0.0.1:43109/headers',
      '--arch=x64'
    ])
    expect(() =>
      electronRebuildArguments('https://www.electronjs.org/headers', 'x64')
    ).toThrow(/loopback/i)
    expect(electronHeaderArtifactsFor('42.1.0', 'darwin', 'arm64')).toHaveLength(1)
    expect(electronHeaderArtifactsFor('42.1.0', 'win32', 'x64')).toHaveLength(2)
    expect(() => electronHeaderArtifactsFor('42.1.1', 'darwin', 'arm64')).toThrow(
      /identity/i
    )
    expect(() => electronHeaderArtifactsFor('42.1.0', 'darwin', 'ia32')).toThrow(
      /allowlist/i
    )
  })

  it('routes every production native rebuild through an authenticated target', () => {
    const desktopManifest = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, '../../../../packages/desktop/package.json'),
        'utf8'
      )
    ) as { readonly scripts?: Readonly<Record<string, string>> }
    const scripts = desktopManifest.scripts ?? {}
    expect(Object.values(scripts).join('\n')).not.toMatch(/\belectron-rebuild\b/u)
    expect(scripts['build:mac:x64']).toContain(
      'runElectronRebuild.mts --target-platform=darwin --target-arch=x64'
    )
    expect(scripts['build:mac:arm64']).toContain(
      'runElectronRebuild.mts --target-platform=darwin --target-arch=arm64'
    )
    expect(scripts['build:win:x64']).toContain(
      'runElectronRebuild.mts --target-platform=win32 --target-arch=x64'
    )
    expect(scripts['build:win:arm64']).toContain(
      'runElectronRebuild.mts --target-platform=win32 --target-arch=arm64'
    )
    expect(scripts['build:linux']).toContain(
      'runElectronRebuild.mts --target-platform=linux --target-arch=x64'
    )
  })

  it('prevents electron-builder from rebuilding or downloading Electron independently', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')
    const builder = readFileSync(
      resolve(repoRoot, 'packages/desktop/electron-builder.yml'),
      'utf8'
    )
    const manifest = readFileSync(resolve(repoRoot, 'packages/desktop/package.json'), 'utf8')

    expect(builder.match(/^npmRebuild:\s*false$/gmu)).toHaveLength(1)
    expect(builder).not.toMatch(/^nodeGypRebuild:/mu)
    expect(builder).not.toMatch(/^electronDownload:/mu)
    expect(builder).toContain(
      'electronDist: ../../node_modules/.cache/marktext-electron-dist'
    )
    expect(manifest.match(/stageElectronDist\.mts --target-platform=/gu)).toHaveLength(5)
  })

  it('serves only exact authenticated Electron header routes and proves consumption', async() => {
    const bytes = Buffer.from('authenticated proxy fixture')
    const artifact = {
      path: 'fixture-headers.tar.gz',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      maximumBytes: bytes.length
    }
    const requested: [string, number][] = []
    const proxy = await startAuthenticatedElectronHeaderProxyFromArtifacts(
      '1.2.3',
      [artifact],
      async(url, maximumBytes) => {
        requested.push([url, maximumBytes])
        return bytes
      }
    )
    try {
      expect(requested).toEqual([
        [
          'https://www.electronjs.org/headers/v1.2.3/fixture-headers.tar.gz',
          bytes.length
        ]
      ])
      expect(() => proxy.assertConsumed()).toThrow(/did not consume/i)

      const artifactResponse = await fetch(
        `${proxy.url}/v1.2.3/fixture-headers.tar.gz`
      )
      expect(artifactResponse.status).toBe(200)
      expect(Buffer.from(await artifactResponse.arrayBuffer())).toEqual(bytes)
      expect((await fetch(`${proxy.url}/v1.2.3/fixture-headers.tar.gz?swap=1`)).status)
        .toBe(404)
      expect((await fetch(`${proxy.url}/v1.2.4/fixture-headers.tar.gz`)).status)
        .toBe(404)
      expect((await fetch(`${proxy.url}/v1.2.3/fixture-headers.tar.gz`, {
        method: 'POST'
      })).status).toBe(405)

      const shasumsResponse = await fetch(`${proxy.url}/v1.2.3/SHASUMS256.txt`)
      expect(shasumsResponse.status).toBe(200)
      expect(await shasumsResponse.text()).toBe(
        `${artifact.sha256}  ${artifact.path}\n`
      )
      expect(() => proxy.assertConsumed()).not.toThrow()
    } finally {
      await proxy.close()
    }
  })

  it('rejects an Electron header download redirected away from HTTPS', async() => {
    const responseBody = new Response('x').body
    vi.stubGlobal('fetch', vi.fn(async() => ({
      ok: true,
      url: 'http://mutable.invalid/header.tar.gz',
      headers: new Headers({ 'content-length': '1' }),
      body: responseBody
    })))
    try {
      await expect(
        fetchBoundedElectronHeaderBytes('https://trusted.invalid/header.tar.gz', 10)
      ).rejects.toThrow(/download failed/i)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // Candidate publication is contract-bound to the owner platform
  // (darwin-arm64); on any other platform the collector refuses before
  // these behaviors are reachable, and that refusal is what a
  // non-publication platform asserts instead.
  const onPublicationPlatform =
    process.platform === 'darwin' && process.arch === 'arm64'

  it.skipIf(!onPublicationPlatform)('rejects executable supply-chain mutations from the committed candidate', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')
    expect(() => validate0009EvidenceSupplyChain(repoRoot)).not.toThrow()

    // A mutation row proves detection only if the fixture it mutates passes
    // its own baseline. Otherwise every row throws for a reason the row never
    // states, and the loop is green whether or not the exploit is caught.
    const baseline = initializeEvidenceRepository()
    try {
      const baselineCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: baseline,
        encoding: 'utf8'
      }).trim()
      expect(
        () => validate0009EvidenceSupplyChain(baseline, baselineCommit),
        'un-mutated evidence fixture must satisfy the production validator'
      ).not.toThrow()
    } finally {
      rmSync(baseline, { recursive: true, force: true })
    }

    const mutations = [
      ['dynamic apt', '.github/workflows/document-core-platform.yml', (source: string) => source.replace(
        'pnpm tsx scripts/postinstall.ts',
        'sudo apt-get update\n          pnpm tsx scripts/postinstall.ts'
      )],
      ['remote checksums', '.github/workflows/document-core-platform.yml', (source: string) => source.replace(
        "electron_use_remote_checksums: ''",
        "electron_use_remote_checksums: '0'"
      )],
      ['override dist', '.github/workflows/document-core-platform.yml', (source: string) => source.replace(
        "ELECTRON_OVERRIDE_DIST_PATH: ''",
        "ELECTRON_OVERRIDE_DIST_PATH: '/tmp/foreign-electron'"
      )],
      ['unchecked Electron cache', 'scripts/postinstall.ts', (source: string) => source.replace(
        'stageAuthenticatedElectronArchive(zipPath, expectedChecksum)',
        '{ path: zipPath, cleanup: () => {} }'
      )],
      ['cache source-path swap', 'scripts/postinstall.ts', (source: string) => source.replace(
        'extractElectronArchive(stagedArchive.path, distDir)',
        'extractElectronArchive(zipPath, distDir)'
      )],
      ['npm fallback', 'scripts/postinstall.ts', (source: string) => source.replace(
        "throw new Error('Required native-keymap source is missing from the frozen install')",
        "run('npm install native-keymap --ignore-scripts --no-save')"
      )],
      ['shell-interpolated unzip', 'scripts/electronIntegrity.mts', (source: string) => source.replace(
        "execFileSync('unzip', arguments_, { stdio: 'inherit' })",
        "execSync('unzip archive.zip')"
      )],
      ['missing installer skip', 'scripts/postinstall.ts', (source: string) => source.replace(
        "throw new Error('electron/install.js not found in the frozen install')",
        "console.error('electron/install.js not found — skipping Electron download')"
      )],
      ['mutable Electron headers', 'scripts/runElectronRebuild.mts', (source: string) => source.replace(
        '0cfc1d20f252d6c29bdd14b1f3caa30edc6477db93e5a6620674424b38dcddfd',
        '0'.repeat(64)
      )],
      ['header checksum bypass', 'scripts/runElectronRebuild.mts', (source: string) => source.replace(
        'bytes: authenticateElectronHeaderArtifact(artifact, bytes)',
        'bytes: Buffer.from(bytes)'
      )],
      ['remote node-gyp headers', 'scripts/runElectronRebuild.mts', (source: string) => source.replace(
        'electronRebuildArguments(headerServer.url, targetArch)',
        "['-f', '--dist-url', 'https://www.electronjs.org/headers']"
      )],
      ['unused header proxy', 'scripts/runElectronRebuild.mts', (source: string) => source.replace(
        'headerServer.assertConsumed()',
        '// authenticated inputs need not be consumed'
      )],
      ['insecure header redirect', 'scripts/runElectronRebuild.mts', (source: string) => source.replace(
        "new URL(response.url).protocol !== 'https:'",
        'false'
      )],
      ['query-bearing header route', 'scripts/runElectronRebuild.mts', (source: string) => source.replace(
        'const route = request.url',
        "const route = new URL(request.url, 'http://127.0.0.1').pathname"
      )],
      ['foreign rebuild architecture', 'scripts/runElectronRebuild.mts', (source: string) => source.replace(
        "darwin: Object.freeze(['arm64', 'x64'])",
        "darwin: Object.freeze(['x64'])"
      )],
      ['raw package rebuild', 'packages/desktop/package.json', (source: string) => source.replace(
        'tsx ../../scripts/runElectronRebuild.mts --target-platform=darwin --target-arch=arm64',
        'electron-rebuild'
      )],
      ['ambient Corepack path', 'packages/document-core/test/plan/0009-evidence-collector.ts', (source: string) => source.replace(
        "resolve(repoRoot, 'scripts/runPinnedCorepack.mjs')",
        "'corepack'"
      )],
      ['mutable Corepack bundle', 'scripts/runPinnedCorepack.mjs', (source: string) => source.replace(
        'bafd892df44cd70740e23e5d43eeea934b4f261a9eaff3637dac29bdea74d829',
        '0'.repeat(64)
      )],
      ['builder native rebuild', 'packages/desktop/electron-builder.yml', (source: string) => source.replace(
        'npmRebuild: false',
        'npmRebuild: true'
      )],
      ['builder implicit rebuild', 'packages/desktop/electron-builder.yml', (source: string) => source.replace(
        'npmRebuild: false\n',
        ''
      )],
      ...PLATFORM_REQUIRED_STEPS.map((name) => [
        `no-op platform step: ${name}`,
        '.github/workflows/document-core-platform.yml',
        (source: string): string => replaceNamedYamlStepWithNoOp(source, name)
      ] as const),
      ...['Enable content-addressed pnpm', 'Install Dependencies'].map((name) => [
        `no-op setup step: ${name}`,
        '.github/actions/setup/action.yml',
        (source: string): string => replaceNamedYamlStepWithNoOp(source, name)
      ] as const)
    ] as const
    for (const [label, controlPath, mutate] of mutations) {
      const root = initializeEvidenceRepository()
      try {
        const source = readFileSync(resolve(root, controlPath), 'utf8')
        const mutated = mutate(source)
        expect(mutated).not.toBe(source)
        writeFixture(root, controlPath, mutated)
        execFileSync('git', ['add', controlPath], { cwd: root })
        execFileSync('git', ['commit', '--quiet', '-m', 'mutate executable input'], {
          cwd: root
        })
        const candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8'
        }).trim()
        expect(() => validate0009EvidenceSupplyChain(root, candidateCommit), label).toThrow(
          /supply-chain/i
        )
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  }, 120_000)

  it('registers platform evidence for final pushes and relevant changes', () => {
    const workflow = readFileSync(
      resolve(import.meta.dirname, '../../../../.github/workflows/document-core-platform.yml'),
      'utf8'
    )
    const lines = workflow.split('\n')
    const eventBlock = (event: 'pull_request' | 'push'): string => {
      const start = lines.indexOf(`  ${event}:`)
      if (start === -1) return ''
      const endOffset = lines.slice(start + 1).findIndex((line) => /^(?: {2}\S|\S)/u.test(line))
      const end = endOffset === -1 ? lines.length : start + endOffset + 1
      return lines.slice(start + 1, end).join('\n')
    }

    expect(lines).toContain('  workflow_dispatch:')
    expect(workflow).toContain("      - '**'")
    expect(workflow).toContain("      - 'evidence/0009/**'")
    expect(eventBlock('pull_request')).not.toMatch(/^ {4}paths:/mu)
    expect(eventBlock('push')).not.toMatch(/^ {4}paths:/mu)
  })

  it('branches RED candidate collection from mandatory GREEN closure proof', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')
    const packageManifest = JSON.parse(
      readFileSync(resolve(repoRoot, 'packages/document-core/package.json'), 'utf8')
    ) as {
      readonly scripts?: Readonly<Record<string, unknown>>
    }
    const workflow = readFileSync(
      resolve(repoRoot, '.github/workflows/document-core-platform.yml'),
      'utf8'
    )

    // The platform suite runs the candidate battery without the serial
    // wall-clock phase: those suites hold multi-gigabyte maximum-document
    // revisions and their budgets presume the owner-stated hardware (the
    // G23 route (b) ruling), which 7 GB hosted runners cannot host. The
    // closure gate itself runs only through test:closure at freeze, and
    // wall-clock evidence comes from the owner-hardware runs.
    const platformScript = String(packageManifest.scripts?.['test:platform'])
    expect(platformScript).toContain('vitest run')
    expect(platformScript).toContain(
      '--exclude test/plan/0009-final-closure.spec.ts'
    )
    expect(platformScript).not.toContain('test:wall-clock')
    expect(String(packageManifest.scripts?.test)).toContain(
      '--exclude test/plan/0009-final-closure.spec.ts'
    )
    expect(packageManifest.scripts?.['test:closure']).toBe(
      'vitest run test/plan/0009-final-closure.spec.ts'
    )
    expect(packageManifest.scripts?.['check:platform']).toBe(
      'pnpm run lint && pnpm run typecheck && pnpm run test:platform && pnpm run build'
    )
    expect(workflow).toContain('pnpm -C packages/document-core check:platform')
    expect(workflow).toContain('name: Prove GREEN closure or admit RED candidate')
    expect(workflow).toContain('id: closure-state')
    expect(workflow).toContain('pnpm verify:0009:ci')
    expect(workflow).toContain('test/plan/0009-final-closure.spec.ts')
    expect(workflow).toContain("if: steps.closure-state.outputs.state == 'green'")
    expect(workflow).toContain('name: Upload compact closure attestation')
    expect(workflow).toContain('specs/migration/0009-closure-attestation.yml')
    expect(workflow).toContain('document-core-candidate-publication:')
    expect(workflow).toContain("startsWith(github.ref_name, 'evidence/0009/publish-')")
    expect(workflow).toContain('pnpm evidence:0009 --')
    expect(workflow).toContain('pnpm validate:0009:candidate')
    expect(workflow).toContain(
      'document-core-candidate-evidence-$' + '{GITHUB_SHA}-$' + '{evidence_sha}'
    )
    expect(workflow).toContain('specs/migration/0009-candidate-evidence.yml')
    expect(workflow).toContain('specs/migration/0009-evidence')
    expect(workflow).toContain('marktext-0009-publication-attestation-v1')
    expect(workflow).toContain('0009-publication-attestation.json')
    expect(workflow).toContain('refType: process.env.EVIDENCE_REF_TYPE')
    expect(workflow).toContain('workflowRef: process.env.EVIDENCE_WORKFLOW_REF')
    expect(workflow).toContain('compression-level: 0')
    expect(workflow).toContain('retention-days: 90')
    expect(workflow.match(/- name: Exercise Review through real Electron events/g)).toHaveLength(1)
    expect(workflow).toContain('--project=unpacked')
    expect(workflow).not.toContain('if: matrix.')
    const postinstall = workflow.indexOf('pnpm tsx scripts/postinstall.ts')
    const build = workflow.indexOf('pnpm -C packages/document-core check:platform')
    expect(postinstall).toBeGreaterThan(-1)
    expect(postinstall).toBeLessThan(build)
    expect(workflow).toContain('pkg-config --exists libsecret-1')
    expect(workflow).toContain('shell: bash')

    const downloader = readFileSync(
      resolve(import.meta.dirname, '../../../../scripts/download0009PublishedEvidence.ts'),
      'utf8'
    )
    expect(downloader).toContain('workflow_id')
    expect(downloader).toContain("'.github/workflows/document-core-platform.yml'")
    expect(downloader).toContain('0009-publication-attestation.json')
  })

  it('declares hosted runner images as the OS trust root without dynamic apt inputs', () => {
    const workflow = readFileSync(
      resolve(import.meta.dirname, '../../../../.github/workflows/document-core-platform.yml'),
      'utf8'
    )

    expect(workflow).toContain('os: macos-15')
    expect(workflow).toContain('os: windows-2025')
    expect(workflow).toContain('os: ubuntu-22.04')
    expect(workflow).not.toMatch(/\bapt-get\b|\bapt\s+install\b/u)
    expect(workflow).toContain('command -v xvfb-run')
    expect(workflow).toContain('/usr/include/X11/Xlib.h')
    expect(workflow).toContain('/usr/include/X11/XKBlib.h')
    expect(workflow).toContain('pkg-config --exists libsecret-1')
  })

  it('retains one compact attestation for every successful platform job', () => {
    const workflow = readFileSync(
      resolve(import.meta.dirname, '../../../../.github/workflows/document-core-platform.yml'),
      'utf8'
    )

    expect(workflow).toContain('name: Write compact platform attestation')
    expect(workflow).toContain('marktext-0009-platform-attestation-v1')
    expect(workflow).toContain('candidateCommit: process.env.EVIDENCE_COMMIT')
    expect(workflow).toContain('platform: process.env.EVIDENCE_PLATFORM')
    expect(workflow).toContain('refName: process.env.EVIDENCE_REF_NAME')
    expect(workflow).toContain('refType: process.env.EVIDENCE_REF_TYPE')
    expect(workflow).toContain('runAttempt: process.env.EVIDENCE_RUN_ATTEMPT')
    expect(workflow).toContain('workflowRef: process.env.EVIDENCE_WORKFLOW_REF')
    expect(workflow).toContain('arch: process.arch')
    expect(workflow).toContain('os: process.platform')
    expect(workflow).toContain('node: process.version')
    expect(workflow).toContain('runnerImageOs')
    expect(workflow).toContain('runnerImageVersion')
    expect(workflow).toContain('name: Upload compact platform attestation')
    expect(workflow).toContain(
      `uses: actions/upload-artifact@${PINNED_EVIDENCE_ACTIONS['actions/upload-artifact']}`
    )
    expect(workflow).toContain('path: test-results/0009-platform/$' + '{{ matrix.name }}.json')
    expect(workflow).toContain('if-no-files-found: error')
    expect(workflow).toContain('retention-days: 90')
    expect(workflow).not.toContain('path: test-results/**')

    const collector = readFileSync(
      resolve(import.meta.dirname, '../../../../scripts/collect0009PlatformRun.ts'),
      'utf8'
    )
    expect(collector).toContain('workflow_id')
    expect(collector).toContain('workflowPath')
    expect(collector).toContain("refType: 'tag'")
  })

  it('retains the compact candidate verification inside the three-path closure', () => {
    const source = readFileSync(resolve(import.meta.dirname, './0009-evidence-collector.ts'), 'utf8')

    expect(source).toContain('marktext-0009-candidate-verification-v1')
    expect(source).toContain('platformAttestationSha256')
    expect(source).toContain('candidateEvidenceSha256')
  })

  it('refuses a hand-authored compact verification before downloading evidence', async() => {
    const root = initializeEvidenceRepository()
    const exitsPath = resolve(root, 'specs/migration/0009-exit-gates.yml')
    const candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
    const execute = vi.fn(() => {
      throw new Error('must not download')
    })
    try {
      writeVerifiedClosureState(root)
      const exits = JSON.parse(readFileSync(exitsPath, 'utf8')) as Record<string, unknown>
      exits.verification = {
        schema: 'marktext-0009-candidate-verification-v1',
        state: 'verified',
        candidateCommit
      }
      writeFileSync(exitsPath, JSON.stringify(exits, null, 2) + '\n')

      await expect(
        create0009VerifiedClosure({ repoRoot: root, publicationRunId: 303, execute })
      ).rejects.toThrow(/hand-authored candidate verification/i)
      expect(execute).not.toHaveBeenCalled()
      expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()).toBe(
        candidateCommit
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses a dirty worktree before executing any evidence command', async() => {
    const root = initializeRepository()
    const execute = vi.fn(() => {
      throw new Error('must not execute')
    })
    try {
      writeFileSync(resolve(root, 'uncommitted.txt'), 'not committed\n')

      await expect(
        collect0009Evidence({
          repoRoot: root,
          githubRunIds: ['101', '202'],
          execute
        })
      ).rejects.toThrow(/clean committed worktree/)
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
      for (const githubRunIds of [['101'], ['101', '101'], ['101', 'not-a-run']]) {
        await expect(
          collect0009Evidence({
            repoRoot: root,
            githubRunIds,
            execute
          })
        ).rejects.toThrow(/two distinct numeric GitHub run ids/)
      }
      expect(execute).not.toHaveBeenCalled()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.skipIf(!onPublicationPlatform)('refuses to collect from a commit that already claims P10 closure', async() => {
    const root = initializeEvidenceRepository()
    const acceptancePath = resolve(root, 'specs/migration/0009-acceptance.yml')
    const exitsPath = resolve(root, 'specs/migration/0009-exit-gates.yml')
    const planPath = resolve(root, 'specs/plans/0009-criticmarkup-document-engine-rebuild.md')
    const acceptance = JSON.parse(readFileSync(acceptancePath, 'utf8')) as {
      acceptance: { status: string }[]
    }
    const exits = JSON.parse(readFileSync(exitsPath, 'utf8')) as {
      phases: { status: string }[]
      closure: { status: string }[]
    }
    for (const row of acceptance.acceptance) row.status = 'green'
    for (const row of [...exits.phases, ...exits.closure]) {
      row.status = 'green'
    }
    writeFileSync(acceptancePath, JSON.stringify(acceptance, null, 2) + '\n')
    writeFileSync(exitsPath, JSON.stringify(exits, null, 2) + '\n')
    writeFileSync(
      planPath,
      readFileSync(planPath, 'utf8').replace(
        /^- \*\*Status:\*\* RED[^\n]*$/mu,
        '- **Status:** GREEN — complete'
      )
    )
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['commit', '--quiet', '-m', 'false green'], {
      cwd: root
    })
    const execute = vi.fn(() => {
      throw new Error('must not execute')
    })

    try {
      await expect(
        collect0009Evidence({
          repoRoot: root,
          githubRunIds: ['101', '202'],
          execute
        })
      ).rejects.toThrow(/candidate.*incomplete/i)
      expect(execute).not.toHaveBeenCalled()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.skipIf(!onPublicationPlatform)('preserves prior candidate evidence and closure documents when collection fails', async() => {
    const root = initializeEvidenceRepository()
    const evidencePath = resolve(root, 'specs/migration/0009-candidate-evidence.yml')
    const closurePaths = [
      'specs/migration/0009-acceptance.yml',
      'specs/migration/0009-exit-gates.yml',
      'specs/plans/0009-criticmarkup-document-engine-rebuild.md'
    ]
    const priorEvidence = '{"state":"prior-candidate"}\n'
    const priorClosureDocuments = closurePaths.map((path) =>
      readFileSync(resolve(root, path), 'utf8')
    )
    writeFileSync(evidencePath, priorEvidence)
    const execute = vi.fn(() => ({
      exitCode: 1,
      stdout: '',
      stderr: 'preparation failed'
    }))

    try {
      await expect(
        collect0009Evidence({
          repoRoot: root,
          githubRunIds: ['101', '202'],
          execute
        })
      ).rejects.toThrow(/workspace-prepare failed/)

      expect(readFileSync(evidencePath, 'utf8')).toBe(priorEvidence)
      expect(closurePaths.map((path) => readFileSync(resolve(root, path), 'utf8'))).toEqual(
        priorClosureDocuments
      )
      expect(
        execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
          cwd: root,
          encoding: 'utf8'
        })
      ).toBe('')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects header-only candidate evidence in the production validator', () => {
    const root = initializeEvidenceRepository()
    const evidencePath = resolve(root, 'specs/migration/0009-candidate-evidence.yml')
    const candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
    writeFileSync(
      evidencePath,
      JSON.stringify({
        schema: 'marktext-0009-candidate-evidence-v8',
        state: 'candidate',
        candidateCommit
      }) + '\n'
    )

    try {
      expect(() => validate0009CandidateEvidence({ repoRoot: root })).toThrow(
        /complete candidate evidence/i
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts one first-attempt successful platform run with the exact jobs', () => {
    expect(PLATFORM_REQUIRED_STEPS).toEqual([
      'Prepare Electron runtime',
      'Verify runner architecture',
      'Build document-core and desktop',
      'Exercise Review through real Electron events',
      'Write compact platform attestation',
      'Upload compact platform attestation'
    ])
    const commit = 'a'.repeat(40)
    const observedAt = Date.parse('2026-07-26T18:00:00.000Z')
    const report = {
      attempt: 1,
      conclusion: 'success',
      createdAt: '2026-07-26T17:30:00.000Z',
      databaseId: 101,
      event: 'push',
      headBranch: 'evidence/0009/pass-first',
      headSha: commit,
      refType: 'tag',
      status: 'completed',
      updatedAt: '2026-07-26T17:45:00.000Z',
      url: 'https://github.com/csells/MarkText/actions/runs/101',
      workflowDatabaseId: 9009,
      workflowName: 'builds and exercises Review on macOS Windows and Linux',
      workflowPath: '.github/workflows/document-core-platform.yml',
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
        },
        {
          databaseId: 14,
          name: 'document-core-closure-proof',
          conclusion: 'success',
          steps: candidateClosureProofSteps()
        }
      ]
    }

    expect(validateGithubPlatformRun(report, commit, observedAt)).toEqual({
      databaseId: 101,
      workflowDatabaseId: 9009,
      jobs: {
        'linux-x64': 13,
        'macos-arm64': 11,
        'windows-x64': 12
      }
    })
  })

  it('validates collector platform identity against the pinned publication contract', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'marktext-0009-platform-contract-'))
    try {
      writeFixture(
        root,
        '.github/actions/setup/action.yml',
        "inputs:\n  node-version:\n    default: '22.21.1'\n"
      )
      expect(() =>
        validateEvidenceCollectorPlatform(root, {
          os: 'darwin',
          arch: 'arm64',
          node: 'v22.21.1'
        })
      ).not.toThrow()
      expect(() =>
        validateEvidenceCollectorPlatform(root, {
          os: 'darwin',
          arch: 'arm64',
          node: 'v99.99.99'
        })
      ).toThrow(/pinned publication contract/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('derives the collector runtime pin from the candidate commit, not the verifier worktree', () => {
    const root = initializeRepository()
    const actionPath = '.github/actions/setup/action.yml'
    try {
      writeFixture(
        root,
        actionPath,
        "inputs:\n  node-version:\n    default: '22.21.1'\n"
      )
      execFileSync('git', ['add', actionPath], { cwd: root })
      execFileSync('git', ['commit', '--quiet', '-m', 'pin candidate runtime'], { cwd: root })
      const candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8'
      }).trim()
      writeFixture(
        root,
        actionPath,
        "inputs:\n  node-version:\n    default: '99.99.99'\n"
      )
      expect(() =>
        validateEvidenceCollectorPlatform(
          root,
          { os: 'darwin', arch: 'arm64', node: 'v22.21.1' },
          'candidate platform',
          candidateCommit
        )
      ).not.toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('derives pnpm and installed-build authority from the candidate commit', () => {
    const root = initializeEvidenceRepository()
    try {
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8'
      }).trim()
      writeFileSync(
        resolve(root, 'package.json'),
        JSON.stringify({ packageManager: 'pnpm@99.99.99' })
      )
      writeFileSync(
        resolve(root, 'packages/desktop/package.json'),
        JSON.stringify({ version: '99.99.99' })
      )
      const preparation = expectedEvidenceRequest({
        id: 'workspace-prepare',
        repoRoot: root,
        reportPath: resolve(root, 'test-results/prepare.json'),
        expectedCommit: commit
      })
      const build = expectedEvidenceRequest({
        id: 'installed-artifact-build',
        repoRoot: root,
        reportPath: resolve(root, 'test-results/build.json'),
        expectedCommit: commit
      })
      expect(preparation.command).toContain(PINNED_PNPM_PACKAGE_MANAGER)
      expect(build.command).toContain(PINNED_PNPM_PACKAGE_MANAGER)
      // The installed-artifact build publishes the pinned Corepack identity
      // runPinnedCorepack.mjs verifies; the sha256 literals are the spec's own
      // two-sided pins, and the CLI path derives from the same process the
      // collector runs in.
      expect(build.environment).toEqual({
        MARKTEXT_COREPACK_BUNDLE_SHA256:
          'bafd892df44cd70740e23e5d43eeea934b4f261a9eaff3637dac29bdea74d829',
        MARKTEXT_COREPACK_CLI_PATH: resolve(
          dirname(process.execPath),
          process.platform === 'win32'
            ? 'node_modules/corepack/dist/corepack.js'
            : '../lib/node_modules/corepack/dist/corepack.js'
        ),
        MARKTEXT_COREPACK_LAUNCHER_SHA256:
          '3655bc798f300951f2070fee411b337d626b0c3ae80c2d24c46ccac4595d4bf9',
        MARKTEXT_COREPACK_VERSION: '0.34.0',
        MARKTEXT_EXPECTED_ARTIFACT_PATH: resolve(
          root,
          'dist/marktext-mac-arm64-0.20.0-dev.dmg'
        )
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects reruns, foreign commits, and incomplete platform job sets', () => {
    const commit = 'a'.repeat(40)
    const observedAt = Date.parse('2026-07-26T18:00:00.000Z')
    const base = {
      attempt: 1,
      conclusion: 'success',
      createdAt: '2026-07-26T17:30:00.000Z',
      databaseId: 101,
      event: 'push',
      headBranch: 'evidence/0009/pass-first',
      headSha: commit,
      refType: 'tag',
      status: 'completed',
      updatedAt: '2026-07-26T17:45:00.000Z',
      url: 'https://github.com/csells/MarkText/actions/runs/101',
      workflowDatabaseId: 9009,
      workflowName: 'builds and exercises Review on macOS Windows and Linux',
      workflowPath: '.github/workflows/document-core-platform.yml',
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
        },
        {
          databaseId: 14,
          name: 'document-core-closure-proof',
          conclusion: 'success',
          steps: candidateClosureProofSteps()
        }
      ]
    }

    expect(() => validateGithubPlatformRun({ ...base, attempt: 2 }, commit, observedAt)).toThrow(
      /first-attempt/
    )
    expect(() =>
      validateGithubPlatformRun({ ...base, headSha: 'b'.repeat(40) }, commit, observedAt)
    ).toThrow(/current commit/)
    expect(() =>
      validateGithubPlatformRun({ ...base, jobs: base.jobs.slice(0, 2) }, commit, observedAt)
    ).toThrow(/contain exactly/)
  })

  it('rejects missing stale future and inverted platform run timestamps', () => {
    const commit = 'a'.repeat(40)
    const observedAt = Date.parse('2026-07-26T18:00:00.000Z')
    const report = githubReport('101', commit, '2026-07-26T17:45:00.000Z') as Record<
      string,
      unknown
    >

    expect(() =>
      validateGithubPlatformRun({ ...report, createdAt: undefined }, commit, observedAt)
    ).toThrow(/timestamp/i)
    expect(() =>
      validateGithubPlatformRun(
        {
          ...report,
          createdAt: '2026-07-24T17:30:00.000Z',
          updatedAt: '2026-07-24T17:45:00.000Z'
        },
        commit,
        observedAt
      )
    ).toThrow(/fresh|24 hours/i)
    expect(() =>
      validateGithubPlatformRun(
        {
          ...report,
          createdAt: '2026-07-26T18:05:00.000Z',
          updatedAt: '2026-07-26T18:06:00.000Z'
        },
        commit,
        observedAt
      )
    ).toThrow(/future|timestamp/i)
    expect(() =>
      validateGithubPlatformRun(
        {
          ...report,
          createdAt: '2026-07-26T17:50:00.000Z',
          updatedAt: '2026-07-26T17:45:00.000Z'
        },
        commit,
        observedAt
      )
    ).toThrow(/order|timestamp/i)
  })

  it('requires the two authenticated source runs to be strictly sequential', () => {
    const commit = 'a'.repeat(40)
    const first = githubReport('101', commit, '2026-07-26T17:30:00.000Z')
    const second = githubReport('202', commit, '2026-07-26T17:45:00.000Z')
    expect(() => validateSequentialGithubRuns(first, second)).not.toThrow()
    expect(() => validateSequentialGithubRuns(second, first)).toThrow(/strictly sequential/i)
    expect(() =>
      validateSequentialGithubRuns(first, {
        ...second,
        headBranch: (first as { readonly headBranch: string }).headBranch
      })
    ).toThrow(/distinct source tags/i)
    expect(() =>
      validateSequentialGithubRuns(first, { ...second, workflowDatabaseId: 9010 })
    ).toThrow(/exact workflow id/i)
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

    expect(() => validateGithubPlatformRun({ ...report, jobs }, commit)).toThrow(
      /platform job step/
    )
    expect(() =>
      validateGithubPlatformRun(
        {
          ...report,
          jobs: jobs.map(({ steps: _steps, ...job }) => job)
        },
        commit
      )
    ).toThrow(/platform job steps/)
  })

  it('rejects a platform run that did not authenticate its runner architecture', () => {
    const commit = 'a'.repeat(40)
    const report = githubReport('101', commit) as {
      readonly jobs: readonly Record<string, unknown>[]
    }
    const jobs = report.jobs.map((job, index) =>
      index === 0
        ? {
          ...job,
          steps: (job.steps as readonly Record<string, unknown>[]).filter(
            (step) => step.name !== 'Verify runner architecture'
          )
        }
        : job)

    expect(() => validateGithubPlatformRun({ ...report, jobs }, commit)).toThrow(
      /platform job step/
    )
  })

  it('pins platform run lookup and provenance to the workflow repository', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')
    const request = expectedEvidenceRequest({
      id: 'github-platforms',
      repoRoot,
      reportPath: resolve(repoRoot, 'specs/migration/0009-evidence/github.json'),
      githubRunId: '101'
    })
    expect(request.command).toContain('--repo')
    expect(request.command).toContain('csells/MarkText')

    const commit = 'a'.repeat(40)
    const wrongRepository = {
      ...githubReport('101', commit),
      url: 'https://github.com/marktext/marktext/actions/runs/101'
    }
    expect(() => validateGithubPlatformRun(wrongRepository, commit)).toThrow(/repository/i)
    expect(() =>
      validateGithubPlatformRun(
        {
          ...wrongRepository,
          url: 'https://github.com/csells/MarkText/actions/runs/101'
        },
        commit
      )
    ).not.toThrow()
  })

  it('rejects a same-name platform run from another workflow or a branch ref', () => {
    const commit = 'a'.repeat(40)
    const report = githubReport('101', commit) as Record<string, unknown>

    expect(() =>
      validateGithubPlatformRun(
        { ...report, workflowPath: '.github/workflows/shadow-0009.yml' },
        commit
      )
    ).toThrow(/workflow path/i)
    expect(() =>
      validateGithubPlatformRun({ ...report, refType: 'branch' }, commit)
    ).toThrow(/tag ref/i)
  })

  it('ingests and hashes every authenticated platform attestation artifact', () => {
    const commit = 'a'.repeat(40)
    const completedAt = '2026-07-26T17:45:00.000Z'
    const evidence = githubRunEvidence('101', commit, completedAt) as {
      readonly attestations: readonly Record<string, unknown>[]
    }
    const validated = validateGithubRunEvidence(
      evidence,
      commit,
      Date.parse('2026-07-26T18:00:00.000Z')
    )

    expect(validated.attestations.map(({ platform }) => platform).sort()).toEqual([
      'linux-x64',
      'macos-arm64',
      'windows-x64'
    ])
    expect(validated.attestations.every(({ sha256 }) => /^[0-9a-f]{64}$/u.test(sha256))).toBe(
      true
    )
    expect(() =>
      validateGithubRunEvidence(
        { ...evidence, attestations: evidence.attestations.slice(0, 2) },
        commit,
        Date.parse('2026-07-26T18:00:00.000Z')
      )
    ).toThrow(/all three platform attestations/i)
    expect(() =>
      validateGithubRunEvidence(
        {
          ...evidence,
          attestations: evidence.attestations.map((artifact, index) =>
            index === 0 ? { ...artifact, artifactDigest: `sha256:${'0'.repeat(64)}` } : artifact
          )
        },
        commit,
        Date.parse('2026-07-26T18:00:00.000Z')
      )
    ).not.toThrow()
    expect(() =>
      validateGithubRunEvidence(
        {
          ...evidence,
          attestations: evidence.attestations.map((artifact, index) =>
            index === 0 ? { ...artifact, contentBase64: Buffer.from('{}').toString('base64') } : artifact
          )
        },
        commit,
        Date.parse('2026-07-26T18:00:00.000Z')
      )
    ).toThrow(/platform attestation/i)

    const forgedNode = {
      ...evidence,
      attestations: evidence.attestations.map((artifact, index) => {
        if (index !== 0) return artifact
        const attestation = JSON.parse(
          Buffer.from(String(artifact.contentBase64), 'base64').toString('utf8')
        ) as Record<string, unknown>
        return {
          ...artifact,
          contentBase64: Buffer.from(
            JSON.stringify({ ...attestation, node: 'v99.99.99' }) + '\n'
          ).toString('base64')
        }
      })
    }
    // The fixed observation timestamp keeps the 24-hour freshness check from
    // firing first once wall-clock time passes the fixture's completedAt, so
    // the forged-node rejection is what this actually exercises.
    expect(() =>
      validateGithubRunEvidence(
        forgedNode,
        commit,
        Date.parse('2026-07-26T18:00:00.000Z')
      )
    ).toThrow(/node/i)
  })

  it('rejects platform attestations from a branch or another workflow file', () => {
    const commit = 'a'.repeat(40)
    const evidence = githubRunEvidence('101', commit) as {
      readonly attestations: readonly Record<string, unknown>[]
    }
    const replaceFirstAttestation = (
      mutate: (attestation: Record<string, unknown>) => Record<string, unknown>
    ): object => ({
      ...evidence,
      attestations: evidence.attestations.map((artifact, index) => {
        if (index !== 0) return artifact
        const decoded = JSON.parse(
          Buffer.from(String(artifact.contentBase64), 'base64').toString('utf8')
        ) as Record<string, unknown>
        return {
          ...artifact,
          contentBase64: Buffer.from(JSON.stringify(mutate(decoded)) + '\n').toString('base64')
        }
      })
    })

    expect(() =>
      validateGithubRunEvidence(
        replaceFirstAttestation((attestation) => ({ ...attestation, refType: 'branch' })),
        commit
      )
    ).toThrow(/tag ref/i)
    expect(() =>
      validateGithubRunEvidence(
        replaceFirstAttestation((attestation) => ({
          ...attestation,
          workflowRef:
            'csells/MarkText/.github/workflows/shadow-0009.yml@refs/tags/' +
            'evidence/0009/pass-101'
        })),
        commit
      )
    ).toThrow(/workflow ref/i)
  })

  it('rejects a platform label whose attested operating system is different', () => {
    const commit = 'a'.repeat(40)
    const evidence = githubRunEvidence('101', commit) as {
      readonly attestations: readonly Record<string, unknown>[]
    }
    const relabeled = {
      ...evidence,
      attestations: evidence.attestations.map((artifact, index) => {
        if (index !== 0) return artifact
        const decoded = JSON.parse(
          Buffer.from(String(artifact.contentBase64), 'base64').toString('utf8')
        ) as Record<string, unknown>
        return {
          ...artifact,
          contentBase64: Buffer.from(
            JSON.stringify({ ...decoded, os: 'linux' }) + '\n'
          ).toString('base64')
        }
      })
    }

    expect(() => validateGithubRunEvidence(relabeled, commit)).toThrow(
      /operating system|exact run/i
    )
  })

  it('derives zero-skip test counts from a successful Vitest JSON report', () => {
    const report = {
      success: true,
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      testResults: [
        {
          name: '/repo/example.spec.ts',
          status: 'passed',
          assertionResults: [
            {
              title: 'runs one named behavior',
              status: 'passed',
              failureMessages: []
            }
          ]
        }
      ]
    }
    expect(validateVitestReport(report)).toEqual({
      unit: 'tests',
      total: 1,
      failures: 0,
      retries: 0,
      skips: 0
    })
    expect(() =>
      validateVitestReport({
        ...report,
        testResults: []
      })
    ).toThrow(/test entr/i)
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
      suites: [
        {
          title: 'example.spec.ts',
          file: '/repo/example.spec.ts',
          specs: [
            {
              title: 'runs one browser behavior',
              file: '/repo/example.spec.ts',
              tests: [
                {
                  projectName: 'chromium',
                  expectedStatus: 'passed',
                  results: [{ status: 'passed', retry: 0 }]
                }
              ]
            }
          ]
        }
      ]
    }
    expect(validatePlaywrightReport(report)).toEqual({
      unit: 'tests',
      total: 1,
      failures: 0,
      retries: 0,
      skips: 0
    })
    expect(() =>
      validatePlaywrightReport({
        ...report,
        suites: []
      })
    ).toThrow(/test entr/i)
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
      testResults: targets.map((target) => ({
        name: resolve(repoRoot, target.path),
        status: 'passed',
        assertionResults: [
          {
            title: target.title,
            status: 'passed',
            failureMessages: []
          }
        ]
      }))
    }

    expect(() =>
      validateExpectedEvidenceTargets(
        report,
        'vitest-json',
        repoRoot,
        resolve(repoRoot, 'packages/document-core'),
        'docs'
      )
    ).not.toThrow()
    expect(() =>
      validateExpectedEvidenceTargets(
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
      )
    ).toThrow(/exactly once/)
    expect(() =>
      validateExpectedEvidenceTargets(
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
      )
    ).toThrow(/exactly once/)
  })

  it('pins at least one exact named report target for every fixed test command', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')
    for (const id of FIXED_TEST_IDS) {
      expect(expectedEvidenceTargets(repoRoot, id), id).not.toHaveLength(0)
    }
  })

  it('partitions broad suites from specialist evidence commands', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')
    const reportPath = resolve(repoRoot, 'specs/migration/0009-evidence/request.json')
    const request = (id: string): CommandRequest =>
      expectedEvidenceRequest({
        id,
        repoRoot,
        reportPath
      })
    const propertyTargets = [
      'test/language-engine/recursive-matrix.spec.ts',
      'test/language-engine/resource-budgets.spec.ts',
      'test/language-engine/cross-consumer-resource-matrix.spec.ts',
      'test/language-engine/syntax-accounting-contract.spec.ts',
      'test/language-engine/projection-planning-linearity.spec.ts'
    ]
    const conformance = request('conformance')
    for (const target of propertyTargets) {
      expect(conformance.command).toContain(`--exclude=${target}`)
      expect(request('property').command).toContain(target)
    }

    const specialistTargets = [
      'test/e2e/document-core-hostile-sinks.spec.ts',
      'test/e2e/export-pdf.spec.ts',
      'test/e2e/xss.spec.ts',
      'test/e2e/context-isolation.spec.ts',
      'test/e2e/critic-markup-perf.spec.ts',
      'test/e2e/document-core-max-document-perf.spec.ts'
    ]
    const electron = request('electron')
    expect(electron.command).toContain('--project=evidence-unpacked')
    for (const target of specialistTargets) {
      expect(electron.command).not.toContain(target)
      expect(
        [
          request('hostile-sinks'),
          request('pdf'),
          request('security'),
          request('performance')
        ].filter((candidate) => candidate.command.includes(target))
      ).toHaveLength(1)
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
      suites: [
        {
          file: 'production-view.spec.ts',
          specs: [
            {
              file: 'production-view.spec.ts',
              title: target.title,
              tests: [
                {
                  projectName: 'chromium',
                  expectedStatus: 'passed',
                  results: [{ status: 'passed', retry: 0 }]
                }
              ]
            }
          ]
        }
      ]
    }

    expect(() =>
      validateExpectedEvidenceTargets(
        report,
        'playwright-json',
        repoRoot,
        resolve(repoRoot, 'packages/document-view'),
        'browser',
        'chromium'
      )
    ).not.toThrow()
  })

  it('configures every local Playwright runner with unconditional zero retries', async() => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')
    const [desktop, documentView] = (await Promise.all([
      import(
        pathToFileURL(resolve(repoRoot, 'packages/desktop/test/e2e/playwright.config.ts')).href
      ),
      import(
        pathToFileURL(resolve(repoRoot, 'packages/document-view/e2e/playwright.config.ts')).href
      )
    ])) as readonly [
      {
        readonly default: Readonly<{
          readonly retries?: number
          readonly projects?: readonly Readonly<{
            readonly name?: string
            readonly testIgnore?: string | readonly string[]
          }>[]
        }>
      },
      {
        readonly default: Readonly<{
          readonly retries?: number
          readonly webServer?: Readonly<{ readonly reuseExistingServer?: boolean }>
        }>
      }
    ]

    expect(desktop.default.retries).toBe(0)
    expect(documentView.default.retries).toBe(0)
    expect(documentView.default.webServer?.reuseExistingServer).toBe(false)
    expect(desktop.default.projects?.find(({ name }) => name === 'evidence-unpacked')).toEqual({
      name: 'evidence-unpacked',
      testIgnore: [
        '**/installed-document-core-comment.spec.ts',
        '**/installed-document-core-full-flow.spec.ts',
        '**/packaged-smoke.spec.ts',
        '**/document-core-hostile-sinks.spec.ts',
        '**/export-pdf.spec.ts',
        '**/xss.spec.ts',
        '**/context-isolation.spec.ts',
        '**/critic-markup-perf.spec.ts',
        '**/document-core-max-document-perf.spec.ts'
      ]
    })
  })

  it('forces browser evidence to own a fresh Vite server', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')
    const request = expectedEvidenceRequest({
      id: 'browser',
      repoRoot,
      reportPath: resolve(repoRoot, 'test-results/browser.playwright-json.json')
    })

    expect(request.environment).toMatchObject({
      CI: '1',
      PLAYWRIGHT_USE_BUNDLED_CHROMIUM: '1'
    })
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

  it('hashes the precisely scoped evidence control files beside the candidate Git tree', () => {
    expect(CRITICAL_EVIDENCE_CONTROL_FILES).toEqual([
      '.github/actions/setup/action.yml',
      '.github/workflows/document-core-platform.yml',
      '.gitignore',
      '.npmrc',
      'eslint.config.js',
      'package.json',
      'packages/desktop/electron-builder.yml',
      'packages/desktop/electron.vite.config.ts',
      'packages/desktop/package.json',
      'packages/desktop/patches/native-keymap+3.3.9.patch',
      'packages/desktop/test/e2e/playwright.config.ts',
      'packages/desktop/tsconfig.base.json',
      'packages/desktop/tsconfig.json',
      'packages/desktop/vitest.config.ts',
      'packages/document-core/package.json',
      'packages/document-core/test/plan/0009-evidence-collector.spec.ts',
      'packages/document-core/test/plan/0009-evidence-collector.ts',
      'packages/document-core/test/plan/0009-final-closure.spec.ts',
      'packages/document-core/tsconfig.build.json',
      'packages/document-core/tsconfig.json',
      'packages/document-core/tsconfig.test.json',
      'packages/document-core/vitest.config.ts',
      'packages/document-view/e2e/playwright.config.ts',
      'packages/document-view/e2e/tsconfig.json',
      'packages/document-view/e2e/vite.config.ts',
      'packages/document-view/package.json',
      'packages/document-view/tsconfig.json',
      'packages/document-view/vite.config.ts',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'scripts/collect0009Evidence.ts',
      'scripts/collect0009PlatformRun.ts',
      'scripts/download0009PublishedEvidence.ts',
      'scripts/electronIntegrity.mts',
      'scripts/minify-locales.ts',
      'scripts/minifyLocaleJson.ts',
      'scripts/postinstall.ts',
      'scripts/runElectronRebuild.mts',
      'scripts/runPinnedCorepack.mjs',
      'scripts/verify0009Closure.ts',
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

  it('runs production evidence validation and closure recording in one process', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')
    const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
      readonly scripts?: Readonly<Record<string, string>>
    }
    const verifierPath = resolve(repoRoot, 'scripts/verify0009Closure.ts')

    expect(manifest.scripts?.['verify:0009']).toBeUndefined()
    expect(manifest.scripts?.['validate:0009:candidate']).toBe(
      'tsx scripts/verify0009Closure.ts --validate-candidate'
    )
    expect(manifest.scripts?.['verify:0009:ci']).toBe('tsx scripts/verify0009Closure.ts --ci')
    expect(manifest.scripts?.['close:0009']).toBe('tsx scripts/verify0009Closure.ts --commit')
    expect(existsSync(verifierPath)).toBe(true)
    expect(readFileSync(verifierPath, 'utf8')).not.toContain('write0009ClosureAttestation')
    expect(readFileSync(verifierPath, 'utf8')).toContain('write0009CiClosureAttestation')
    expect(readFileSync(verifierPath, 'utf8')).toContain('create0009VerifiedClosure')
  })

  it('parses exactly two explicit GitHub runs for the CLI', () => {
    expect(parse0009EvidenceArguments(['--github-run', '101', '--github-run=202'])).toEqual([
      '101',
      '202'
    ])
    expect(
      parse0009EvidenceArguments(['--', '--github-run', '101', '--github-run', '202'])
    ).toEqual(['101', '202'])
    expect(() => parse0009EvidenceArguments(['--github-run', '101'])).toThrow(/exactly twice/)
    expect(() =>
      parse0009EvidenceArguments(['--github-run', '101', '--github-run', '202', '--unknown'])
    ).toThrow(/Unknown evidence collector argument/)
  })

  it('writes two independently prepared candidate passes without claiming closure', async() => {
    const root = initializeEvidenceRepository()
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
    const requests: CommandRequest[] = []
    const cleanupInstalledArtifact = vi.fn()
    const mountedArtifactPaths: string[] = []
    const mountedExecutablePaths: string[] = []
    const workspaceRoots: string[] = []
    const execute = vi.fn(async(request: CommandRequest) => {
      requests.push(request)
      if (request.id === 'workspace-prepare') {
        workspaceRoots.push(request.cwd)
        writeFixture(
          request.cwd,
          'node_modules/vitest/package.json',
          JSON.stringify({ version: '4.1.9' })
        )
        writeFixture(
          request.cwd,
          'node_modules/@playwright/test/package.json',
          JSON.stringify({ version: '1.61.0' })
        )
      }
      const workspaceRoot =
        workspaceRoots.find(
          (candidate) => request.cwd === candidate || request.cwd.startsWith(`${candidate}${sep}`)
        ) ?? root
      if (request.id === 'installed-artifact-build') {
        const artifactPath = request.environment?.MARKTEXT_EXPECTED_ARTIFACT_PATH
        if (artifactPath === undefined) throw new Error('missing artifact path')
        mkdirSync(dirname(artifactPath), { recursive: true })
        writeFileSync(artifactPath, `artifact for ${commit}\n`)
      }
      if (request.kind === 'github') {
        const runId = request.command.find((part) => /^\d+$/.test(part))
        if (runId === undefined) throw new Error('missing run id')
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            githubRunEvidence(
              runId,
              commit,
              new Date().toISOString(),
              process.version
            )
          ),
          stderr: ''
        }
      }
      if (request.reportPath !== undefined) {
        mkdirSync(dirname(request.reportPath), { recursive: true })
        const manifestTargets = expectedEvidenceTargets(root, request.id)
        const targets =
          manifestTargets.length === 0
            ? [
              {
                path: 'packages/document-core/test/plan/collector-fixture.spec.ts',
                title: `${request.id} fixture`
              }
            ]
            : manifestTargets
        const project =
          request.command
            .find((argument) => argument.startsWith('--project='))
            ?.slice('--project='.length) ?? 'chromium'
        const attachmentRoot = resolve(workspaceRoot, 'test-results')
        const outputAttachments: readonly Readonly<{
          readonly name: string
          readonly contentType: string
          readonly path?: string
          readonly body?: string
        }>[] =
          request.reportFormat !== 'playwright-json'
            ? []
            : (() => {
              rmSync(attachmentRoot, { recursive: true, force: true })
              mkdirSync(attachmentRoot, { recursive: true })
              const pathAttachment = (
                name: string
              ): Readonly<{
                readonly name: string
                readonly contentType: string
                readonly path: string
              }> => {
                const path = resolve(attachmentRoot, `${request.id}-${name}.pdf`)
                writeFileSync(path, `%PDF-1.7\n${request.id}:${name}\n%%EOF\n`)
                return Object.freeze({
                  name,
                  contentType: 'application/pdf',
                  path
                })
              }
              if (request.id === 'hostile-sinks') {
                return [pathAttachment('hostile-pdf'), pathAttachment('hostile-print-proof')]
              }
              if (request.id === 'pdf') {
                return [
                  Object.freeze({
                    name: 'critic-marked',
                    contentType: 'application/pdf',
                    body: Buffer.from('%PDF-1.7\ncritic-marked\n%%EOF\n').toString('base64')
                  }),
                  pathAttachment('critic-original')
                ]
              }
              if (request.id === 'performance') {
                return [
                  Object.freeze({
                    name: 'machine-record',
                    contentType: 'application/json',
                    body: Buffer.from('{"machine":"fixture"}\n').toString('base64')
                  })
                ]
              }
              return []
            })()
        const report =
          request.reportFormat === 'vitest-json'
            ? {
              success: true,
              numTotalTests: targets.length,
              numPassedTests: targets.length,
              numFailedTests: 0,
              numPendingTests: 0,
              testResults: targets.map((target) => ({
                name: resolve(workspaceRoot, target.path),
                status: 'passed',
                assertionResults: [
                  {
                    title: target.title,
                    status: 'passed',
                    failureMessages: []
                  }
                ]
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
              suites: targets.map((target, targetIndex) => ({
                title: target.path,
                file: resolve(workspaceRoot, target.path),
                specs: [
                  {
                    title: target.title,
                    file: resolve(workspaceRoot, target.path),
                    tests: [
                      {
                        projectName: project,
                        expectedStatus: 'passed',
                        results: [
                          {
                            status: 'passed',
                            retry: 0,
                            attachments: targetIndex === 0 ? outputAttachments : []
                          }
                        ]
                      }
                    ]
                  }
                ]
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
          mountedArtifactPaths.push(artifactPath)
          expect(readFileSync(artifactPath, 'utf8')).toContain(commit)
          const executablePath = resolve(dirname(artifactPath), 'marktext-app')
          writeFileSync(executablePath, `fixture app ${artifactPath}\n`)
          mountedExecutablePaths.push(executablePath)
          return {
            executablePath,
            cleanup: cleanupInstalledArtifact
          }
        }
      })
      expect(validate0009CandidateEvidence({ repoRoot: root }).bundle).toEqual(bundle)

      type MutablePreparation = {
        artifacts: unknown[]
        command: string[]
        counts: { total: number }
        environment: Record<string, string>
        platform: { node: string }
        report: { format: string; path: string; sha256: string }
        runner: { version: string }
      }
      type MutableBundle = {
        runs: Array<{
          commands: Array<{
            artifacts: Array<{
              bytes: number
              name: string
              path: string
              sha256: string
            }>
            command: string[]
            counts: {
              failures: number
              retries: number
              skips: number
              total: number
              unit: string
            }
            cwd: string
            id: string
            kind: string
            environment: Record<string, string>
            exitCode: number
            finishedAt: string
            report: { path: string; sha256: string }
            runner: { name: string; version: string }
            startedAt: string
          }>
          preparation: MutablePreparation
          installedArtifact: {
            build: MutablePreparation
            bytes: number
            path: string
            sha256: string
          }
        }>
      }
      const mutationEvidencePath = resolve(root, 'specs/migration/0009-candidate-evidence.yml')
      const originalEvidence = readFileSync(mutationEvidencePath)
      const rejectsCommandMutation = (
        mutate: (command: MutablePreparation, evidence: MutableBundle) => void
      ): void => {
        const evidence = JSON.parse(originalEvidence.toString('utf8')) as MutableBundle
        const preparation = evidence.runs[0]?.preparation
        if (preparation === undefined) throw new Error('fixture preparation is missing')
        mutate(preparation, evidence)
        writeFileSync(mutationEvidencePath, JSON.stringify(evidence, null, 2) + '\n')
        try {
          expect(() => validate0009CandidateEvidence({ repoRoot: root })).toThrow(
            /workspace-prepare/i
          )
        } finally {
          writeFileSync(mutationEvidencePath, originalEvidence)
        }
      }
      rejectsCommandMutation((preparation) => {
        preparation.command = ['forged-runner', ...preparation.command.slice(-3)]
      })
      rejectsCommandMutation((preparation) => {
        preparation.environment = { FORGED: 'true' }
      })
      rejectsCommandMutation((preparation) => {
        preparation.runner.version = '0.0.0-forged'
      })
      rejectsCommandMutation((preparation) => {
        preparation.platform.node = 'v0.0.0-forged'
      })
      rejectsCommandMutation((preparation) => {
        preparation.counts.total = 99
      })
      rejectsCommandMutation((preparation) => {
        preparation.report.format = 'vitest-json'
      })
      rejectsCommandMutation((preparation) => {
        preparation.artifacts = [{ forged: true }]
      })
      const hashEvidence = JSON.parse(originalEvidence.toString('utf8')) as MutableBundle
      const installedCommand = hashEvidence.runs[0]?.commands.find(
        ({ id }) => id === 'installed'
      )
      if (installedCommand === undefined) throw new Error('fixture installed command is missing')
      installedCommand.environment.MARKTEXT_EXPECTED_ARTIFACT_SHA256 = 'a'.repeat(64)
      installedCommand.environment.MARKTEXT_EXPECTED_EXECUTABLE_SHA256 = 'b'.repeat(64)
      writeFileSync(mutationEvidencePath, JSON.stringify(hashEvidence, null, 2) + '\n')
      try {
        expect(() => validate0009CandidateEvidence({ repoRoot: root })).toThrow(
          /installed.*artifact/i
        )
      } finally {
        writeFileSync(mutationEvidencePath, originalEvidence)
      }
      const aliasEvidence = JSON.parse(originalEvidence.toString('utf8')) as MutableBundle
      const aliasRun = aliasEvidence.runs[0]
      const aliasInstalledCommand = aliasRun?.commands.find(({ id }) => id === 'installed')
      if (aliasRun === undefined || aliasInstalledCommand === undefined) {
        throw new Error('fixture installed path linkage is missing')
      }
      const aliasedBytes = readFileSync(resolve(root, aliasRun.preparation.report.path))
      const aliasedSha256 = createHash('sha256').update(aliasedBytes).digest('hex')
      aliasRun.installedArtifact.path = aliasRun.preparation.report.path
      aliasRun.installedArtifact.bytes = aliasedBytes.length
      aliasRun.installedArtifact.sha256 = aliasedSha256
      aliasInstalledCommand.environment.MARKTEXT_EXPECTED_ARTIFACT_SHA256 = aliasedSha256
      writeFileSync(mutationEvidencePath, JSON.stringify(aliasEvidence, null, 2) + '\n')
      try {
        expect(() => validate0009CandidateEvidence({ repoRoot: root })).toThrow(
          /installed artifact path is reused/i
        )
      } finally {
        writeFileSync(mutationEvidencePath, originalEvidence)
      }
      const githubEvidenceMutation = JSON.parse(
        originalEvidence.toString('utf8')
      ) as MutableBundle
      const githubCommand = githubEvidenceMutation.runs[0]?.commands.find(
        ({ id }) => id === 'github-platforms'
      )
      if (githubCommand === undefined) throw new Error('fixture GitHub command is missing')
      const githubReportPath = resolve(root, githubCommand.report.path)
      const originalGithubReport = readFileSync(githubReportPath)
      const githubEnvelope = JSON.parse(originalGithubReport.toString('utf8')) as {
        attestations: Array<{ contentBase64: string }>
      }
      const firstAttestation = githubEnvelope.attestations[0]
      if (firstAttestation === undefined) throw new Error('fixture platform attestation is missing')
      const attestationBody = JSON.parse(
        Buffer.from(firstAttestation.contentBase64, 'base64').toString('utf8')
      ) as Record<string, unknown>
      if (typeof attestationBody.verifiedAt !== 'string') {
        throw new Error('fixture platform attestation timestamp is missing')
      }
      attestationBody.verifiedAt = new Date(
        Date.parse(attestationBody.verifiedAt) - 1_000
      ).toISOString()
      firstAttestation.contentBase64 = Buffer.from(JSON.stringify(attestationBody)).toString(
        'base64'
      )
      const forgedGithubReport = Buffer.from(JSON.stringify(githubEnvelope, null, 2) + '\n')
      githubCommand.report.sha256 = createHash('sha256')
        .update(forgedGithubReport)
        .digest('hex')
      writeFileSync(githubReportPath, forgedGithubReport)
      writeFileSync(
        mutationEvidencePath,
        JSON.stringify(githubEvidenceMutation, null, 2) + '\n'
      )
      try {
        expect(() => validate0009CandidateEvidence({ repoRoot: root })).toThrow(
          /platform.*attestation.*artifact.*bytes/i
        )
      } finally {
        writeFileSync(githubReportPath, originalGithubReport)
        writeFileSync(mutationEvidencePath, originalEvidence)
      }
      const attachmentEvidence = JSON.parse(originalEvidence.toString('utf8')) as MutableBundle
      const pdfCommand = attachmentEvidence.runs[0]?.commands.find(({ id }) => id === 'pdf')
      const markedPdf = pdfCommand?.artifacts.find(({ name }) => name === 'critic-marked')
      if (markedPdf === undefined) throw new Error('fixture PDF attachment is missing')
      const markedPdfPath = resolve(root, markedPdf.path)
      const originalMarkedPdf = readFileSync(markedPdfPath)
      const forgedMarkedPdf = Buffer.from('%PDF-1.7\nforged-but-valid-pdf\n%%EOF\n')
      markedPdf.bytes = forgedMarkedPdf.length
      markedPdf.sha256 = createHash('sha256').update(forgedMarkedPdf).digest('hex')
      writeFileSync(markedPdfPath, forgedMarkedPdf)
      writeFileSync(mutationEvidencePath, JSON.stringify(attachmentEvidence, null, 2) + '\n')
      try {
        expect(() => validate0009CandidateEvidence({ repoRoot: root })).toThrow(
          /attachment.*artifact.*bytes/i
        )
      } finally {
        writeFileSync(markedPdfPath, originalMarkedPdf)
        writeFileSync(mutationEvidencePath, originalEvidence)
      }
      const runnerEvidence = JSON.parse(originalEvidence.toString('utf8')) as MutableBundle
      for (const run of runnerEvidence.runs) {
        for (const command of run.commands) {
          if (command.runner.name === 'playwright') command.runner.version = '99.99.99'
        }
      }
      const playwrightManifestPath = resolve(
        root,
        'node_modules/@playwright/test/package.json'
      )
      const originalPlaywrightManifest = readFileSync(playwrightManifestPath)
      writeFileSync(playwrightManifestPath, JSON.stringify({ version: '99.99.99' }))
      writeFileSync(mutationEvidencePath, JSON.stringify(runnerEvidence, null, 2) + '\n')
      try {
        expect(() => validate0009CandidateEvidence({ repoRoot: root })).toThrow(
          /runner differs/i
        )
      } finally {
        writeFileSync(playwrightManifestPath, originalPlaywrightManifest)
        writeFileSync(mutationEvidencePath, originalEvidence)
      }
      const kindEvidence = JSON.parse(originalEvidence.toString('utf8')) as MutableBundle
      const kindCommand = kindEvidence.runs[0]?.commands.find(
        ({ id }) => id === 'conformance'
      )
      if (kindCommand === undefined) throw new Error('fixture conformance command is missing')
      const kindReportPath = resolve(root, kindCommand.report.path)
      const originalKindReport = readFileSync(kindReportPath)
      kindCommand.kind = 'check'
      kindCommand.runner = {
        name: 'pnpm',
        version: kindEvidence.runs[0]?.preparation.runner.version ?? ''
      }
      kindCommand.counts = {
        unit: 'commands',
        total: 1,
        failures: 0,
        retries: 0,
        skips: 0
      }
      const forgedKindReport = Buffer.from(
        JSON.stringify(
          {
            schema: 'marktext-0009-command-report-v1',
            id: kindCommand.id,
            command: kindCommand.command,
            cwd: kindCommand.cwd,
            environment: kindCommand.environment,
            exitCode: kindCommand.exitCode,
            startedAt: kindCommand.startedAt,
            finishedAt: kindCommand.finishedAt,
            stdout: 'forged generic command success\n',
            stderr: ''
          },
          null,
          2
        ) + '\n'
      )
      kindCommand.report.sha256 = createHash('sha256').update(forgedKindReport).digest('hex')
      writeFileSync(kindReportPath, forgedKindReport)
      writeFileSync(mutationEvidencePath, JSON.stringify(kindEvidence, null, 2) + '\n')
      try {
        expect(() => validate0009CandidateEvidence({ repoRoot: root })).toThrow(
          /conformance.*kind differs/i
        )
      } finally {
        writeFileSync(kindReportPath, originalKindReport)
        writeFileSync(mutationEvidencePath, originalEvidence)
      }
      const reportPath = resolve(root, bundle.runs[0].preparation.report.path)
      const originalReport = readFileSync(reportPath)
      const reportBody = JSON.parse(originalReport.toString('utf8')) as Record<string, unknown>
      reportBody.command = ['forged-command-report']
      const forgedReport = Buffer.from(JSON.stringify(reportBody, null, 2) + '\n')
      const reportEvidence = JSON.parse(originalEvidence.toString('utf8')) as MutableBundle
      const reportPreparation = reportEvidence.runs[0]?.preparation
      if (reportPreparation === undefined) throw new Error('fixture preparation is missing')
      reportPreparation.report.sha256 = createHash('sha256').update(forgedReport).digest('hex')
      writeFileSync(reportPath, forgedReport)
      writeFileSync(mutationEvidencePath, JSON.stringify(reportEvidence, null, 2) + '\n')
      try {
        expect(() => validate0009CandidateEvidence({ repoRoot: root })).toThrow(
          /workspace-prepare.*report body differs/i
        )
      } finally {
        writeFileSync(reportPath, originalReport)
        writeFileSync(mutationEvidencePath, originalEvidence)
      }

      expect(bundle).not.toHaveProperty('installedArtifact')
      expect(
        bundle.runs.every(
          (run) => Object.hasOwn(run, 'installedArtifact') && Object.hasOwn(run, 'preparation')
        )
      ).toBe(true)
      expect(mountedArtifactPaths).toHaveLength(2)
      expect(new Set(mountedArtifactPaths).size).toBe(2)
      const preparationRequests = requests.filter(({ id }) => id === 'workspace-prepare')
      expect(preparationRequests).toHaveLength(2)
      expect(new Set(preparationRequests.map(({ cwd }) => cwd)).size).toBe(2)
      expect(requests.some(({ kind }) => kind === 'verifier')).toBe(false)

      expect(bundle.schema).toBe('marktext-0009-candidate-evidence-v8')
      expect(bundle.state).toBe('candidate')
      expect(bundle.candidateCommit).toBe(commit)
      expect(bundle.candidateTree).toBe(
        execFileSync('git', ['rev-parse', `${commit}^{tree}`], {
          cwd: root,
          encoding: 'utf8'
        }).trim()
      )
      expect(bundle.dirtyState).toEqual([])
      expect(Object.keys(bundle.criticalControlFileHashes).sort()).toEqual(
        [...CRITICAL_EVIDENCE_CONTROL_FILES].sort()
      )
      expect(bundle.runs).toHaveLength(2)
      expect(bundle.runs.map((run) => run.ordinal)).toEqual([1, 2])
      expect(bundle.runs.map((run) => run.githubRunDatabaseId)).toEqual([101, 202])
      for (const run of bundle.runs) {
        expect(run.workspace).toEqual({
          id: expect.any(String),
          commit,
          initialDirtyState: []
        })
        expect(run.preparation).toMatchObject({
          id: 'workspace-prepare',
          kind: 'check',
          commit,
          exitCode: 0
        })
        expect(run.installedArtifact).toMatchObject({
          commit,
          path: expect.stringMatching(
            /^specs\/migration\/0009-evidence\/.+\/pass-[12]\/installed-artifact\//
          ),
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          executableSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          build: {
            id: 'installed-artifact-build',
            kind: 'check',
            exitCode: 0
          }
        })
        expect(run).not.toHaveProperty('fresh')
        expect(run).not.toHaveProperty('findings')
        expect(run.commands.map((command) => command.id).sort()).toEqual(
          [...FIXED_CHECK_IDS, ...FIXED_TEST_IDS, 'github-platforms'].sort()
        )
        expect(Object.keys(run.surfaces).sort()).toEqual([...REQUIRED_SURFACES].sort())
        for (const command of run.commands) {
          expect(command.exitCode).toBe(0)
          expect(command.report.sha256).toMatch(/^[0-9a-f]{64}$/)
          expect(existsSync(resolve(root, command.report.path))).toBe(true)
        }
        const artifactsFor = (
          id: string
        ): readonly Readonly<{
          readonly name: string
          readonly contentType: string
          readonly path: string
          readonly sha256: string
          readonly bytes: number
        }>[] => {
          const command = run.commands.find((candidate) => candidate.id === id)
          if (command === undefined) throw new Error(`missing ${id}`)
          return (
            (
              command as unknown as {
                readonly artifacts?: readonly Readonly<{
                  readonly name: string
                  readonly contentType: string
                  readonly path: string
                  readonly sha256: string
                  readonly bytes: number
                }>[]
              }
            ).artifacts ?? []
          )
        }
        expect(artifactsFor('hostile-sinks').map(({ name }) => name)).toEqual([
          'hostile-pdf',
          'hostile-print-proof'
        ])
        expect(artifactsFor('pdf').map(({ name }) => name)).toEqual([
          'critic-marked',
          'critic-original'
        ])
        expect(artifactsFor('performance').map(({ name }) => name)).toEqual(['machine-record'])
        for (const artifact of [
          ...artifactsFor('hostile-sinks'),
          ...artifactsFor('pdf'),
          ...artifactsFor('performance')
        ]) {
          const path = resolve(root, artifact.path)
          expect(existsSync(path), artifact.path).toBe(true)
          const bytes = readFileSync(path)
          expect(bytes).toHaveLength(artifact.bytes)
          expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256)
        }
      }

      const evidencePath = resolve(root, 'specs/migration/0009-candidate-evidence.yml')
      const serializedEvidence = readFileSync(evidencePath, 'utf8')
      expect(JSON.parse(serializedEvidence)).toEqual(bundle)
      for (const ephemeralPath of [...workspaceRoots, ...mountedExecutablePaths]) {
        expect(serializedEvidence).not.toContain(ephemeralPath)
        for (const run of bundle.runs) {
          for (const command of [run.preparation, run.installedArtifact.build, ...run.commands]) {
            expect(readFileSync(resolve(root, command.report.path), 'utf8')).not.toContain(
              ephemeralPath
            )
          }
        }
      }
      const installedRequests = requests.filter(({ id }) => id === 'installed')
      expect(installedRequests).toHaveLength(2)
      for (const [index, request] of installedRequests.entries()) {
        const pass = bundle.runs[index]
        if (pass === undefined) throw new Error(`missing pass ${String(index)}`)
        const artifact = pass.installedArtifact
        expect(request.environment).toMatchObject({
          MARKTEXT_PACKAGED_APP: expect.any(String),
          MARKTEXT_EXPECTED_COMMIT: commit,
          MARKTEXT_EXPECTED_ARTIFACT_SHA256: artifact.sha256,
          MARKTEXT_EXPECTED_EXECUTABLE_SHA256: artifact.executableSha256
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
        // Each pass runs from its own clean checkout of the candidate commit,
        // so the pinned-Corepack runner must come from that checkout — never
        // from the orchestrating repository's working tree.
        const [runtime, runner, ...rest] = request.command
        expect(runtime).toBe(process.execPath)
        expect(String(runner)).toMatch(
          /marktext-0009-pass-[^/\\]+[/\\]checkout[/\\]scripts[/\\]runPinnedCorepack\.mjs$/
        )
        expect(String(runner).startsWith(root + sep)).toBe(false)
        expect(rest).toEqual([
          PINNED_PNPM_PACKAGE_MANAGER,
          'exec',
          'eslint',
          '--no-cache',
          '.'
        ])
      }
      expect(execute).toHaveBeenCalledTimes(
        2 * (FIXED_CHECK_IDS.length + FIXED_TEST_IDS.length + 3)
      )
      expect(cleanupInstalledArtifact).toHaveBeenCalledTimes(2)

      writeVerifiedClosureState(root)
      const evidenceBytes = readFileSync(
        resolve(root, 'specs/migration/0009-candidate-evidence.yml')
      )
      const evidenceSha256 = createHash('sha256').update(evidenceBytes).digest('hex')
      const downloadPublishedEvidence = async(
        request: CommandRequest
      ): Promise<{ exitCode: 0; stdout: string; stderr: string }> => {
        expect(request.id).toBe('published-evidence-download')
        const outputIndex = request.command.indexOf('--output-root')
        const outputRoot = request.command[outputIndex + 1]
        if (outputRoot === undefined) throw new Error('missing publication output root')
        const normalizedRoot = resolve(outputRoot, 'normalized')
        mkdirSync(resolve(normalizedRoot, 'specs/migration'), { recursive: true })
        cpSync(
          resolve(root, 'specs/migration/0009-candidate-evidence.yml'),
          resolve(normalizedRoot, 'specs/migration/0009-candidate-evidence.yml')
        )
        cpSync(
          resolve(root, 'specs/migration/0009-evidence'),
          resolve(normalizedRoot, 'specs/migration/0009-evidence'),
          { recursive: true }
        )
        return {
          exitCode: 0,
          stdout:
            JSON.stringify({
              schema: 'marktext-0009-publication-v1',
              candidateCommit: commit,
              publicationRunId: 303,
              sourceRunIds: [101, 202],
              workflowDatabaseId: 9009,
              workflowPath: '.github/workflows/document-core-platform.yml',
              refName: `evidence/0009/publish-${commit}-101-202`,
              refType: 'tag',
              artifactId: 404,
              artifactName: `document-core-candidate-evidence-${commit}-${evidenceSha256}`,
              artifactDigest: `sha256:${'d'.repeat(64)}`,
              normalizedRoot
            }) + '\n',
          stderr: ''
        }
      }
      execute.mockImplementationOnce(async(request: CommandRequest) => {
        const execution = await downloadPublishedEvidence(request)
        const publication = JSON.parse(execution.stdout) as Record<string, unknown>
        publication.workflowDatabaseId = 9010
        return {
          ...execution,
          stdout: JSON.stringify(publication) + '\n'
        }
      })
      await expect(
        download0009PublishedEvidence({
          repoRoot: root,
          candidateCommit: commit,
          publicationRunId: 303,
          execute
        })
      ).rejects.toThrow(/publication workflow id differs/i)
      execute.mockImplementationOnce(downloadPublishedEvidence)
      const attestation = await create0009VerifiedClosure({
        repoRoot: root,
        publicationRunId: 303,
        execute
      })
      const closureCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8'
      }).trim()
      expect(closureCommit).not.toBe(commit)
      expect(
        execFileSync('git', ['rev-parse', 'HEAD^'], { cwd: root, encoding: 'utf8' }).trim()
      ).toBe(commit)
      expect(
        execFileSync('git', ['diff', '--name-only', 'HEAD^', 'HEAD'], {
          cwd: root,
          encoding: 'utf8'
        })
          .trim()
          .split('\n')
          .sort()
      ).toEqual([
        'specs/migration/0009-acceptance.yml',
        'specs/migration/0009-exit-gates.yml',
        'specs/plans/0009-criticmarkup-document-engine-rebuild.md'
      ])
      const verifiedExits = JSON.parse(
        readFileSync(resolve(root, 'specs/migration/0009-exit-gates.yml'), 'utf8')
      ) as { readonly verification?: Readonly<Record<string, unknown>> }
      expect(verifiedExits.verification).toMatchObject({
        schema: 'marktext-0009-candidate-verification-v1',
        state: 'verified',
        candidateCommit: commit,
        candidateEvidenceSha256: evidenceSha256,
        publication: {
          publicationRunId: 303,
          artifactId: 404
        }
      })
      expect(attestation).toMatchObject({
        state: 'verified',
        candidateCommit: commit,
        closureCommit,
        evidenceSha256,
        publication: {
          publicationRunId: 303,
          artifactId: 404
        }
      })
      execute.mockImplementationOnce(downloadPublishedEvidence)
      const ciAttestation = await write0009CiClosureAttestation({ repoRoot: root, execute })
      expect(ciAttestation).toMatchObject({
        state: 'verified',
        candidateCommit: commit,
        closureCommit,
        evidenceSha256,
        candidateVerificationSha256: attestation.candidateVerificationSha256,
        publication: attestation.publication
      })
      expect(
        execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
          cwd: root,
          encoding: 'utf8'
        })
      ).toBe('')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 120_000)
})
