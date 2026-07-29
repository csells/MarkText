import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { arch, platform, tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { sanitizeElectronEnvironment } from '../../../../scripts/electronIntegrity.mjs'

export interface CommandRequest {
  readonly id: string
  readonly kind: 'check' | 'github' | 'test' | 'verifier'
  readonly command: readonly string[]
  readonly cwd: string
  readonly environment?: Readonly<Record<string, string>>
  readonly reportPath?: string
  readonly reportFormat?: 'command-json' | 'github-run-json' | 'playwright-json' | 'vitest-json'
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
    const argument = arguments_[index]
    if (argument === undefined) {
      throw new Error('Plan 0009 evidence argument index is invalid')
    }
    if (argument === '--' && index === 0) continue
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
  const [first, second] = runIds
  if (first === undefined || second === undefined) {
    throw new Error('--github-run must be used exactly twice')
  }
  return Object.freeze([first, second])
}

type ReportFormat = NonNullable<CommandRequest['reportFormat']>

export interface EvidenceReport {
  readonly path: string
  readonly sha256: string
  readonly format: ReportFormat
}

export interface EvidenceOutputArtifact {
  readonly name: string
  readonly contentType: string
  readonly path: string
  readonly sha256: string
  readonly bytes: number
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
  readonly artifacts: readonly EvidenceOutputArtifact[]
}

export const CANDIDATE_CHECKOUT_PATH = '$CANDIDATE_CHECKOUT'
export const EVIDENCE_REPOSITORY_PATH = '$EVIDENCE_REPOSITORY'
export const INSTALLED_EXECUTABLE_PATH = '$INSTALLED_EXECUTABLE'

export interface EvidencePass {
  readonly id: string
  readonly ordinal: 1 | 2
  readonly commit: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly githubRunDatabaseId: number
  readonly workspace: Readonly<{
    readonly id: string
    readonly commit: string
    readonly initialDirtyState: readonly []
  }>
  readonly preparation: EvidenceCommand
  readonly installedArtifact: InstalledArtifactEvidence
  readonly commands: readonly EvidenceCommand[]
  readonly surfaces: Readonly<Record<(typeof REQUIRED_SURFACES)[number], readonly string[]>>
}

export interface EvidenceBundle {
  readonly schema: 'marktext-0009-candidate-evidence-v8'
  readonly state: 'candidate'
  readonly candidateCommit: string
  readonly candidateTree: string
  readonly dirtyState: readonly string[]
  readonly createdAt: string
  readonly criticalControlFileHashes: Readonly<Record<string, string>>
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

/**
 * Files that directly define or execute the evidence control plane. This list is deliberately
 * narrower than the candidate source tree: `candidateCommit` and `candidateTree` bind every
 * committed byte, while these hashes make the security-critical proof inputs easy to audit.
 */
export const CRITICAL_EVIDENCE_CONTROL_FILES = Object.freeze([
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
] as const)

export const PINNED_EVIDENCE_ACTIONS = Object.freeze({
  'actions/checkout': '11d5960a326750d5838078e36cf38b85af677262',
  'actions/setup-node': '49933ea5288caeca8642d1e84afbd3f7d6820020',
  'actions/upload-artifact': 'ea165f8d65b6e75b540449e92b4886f43607fa02'
} as const)

export const PINNED_PNPM_PACKAGE_MANAGER =
  'pnpm@10.33.4+sha512.1c67b3b359b2d408119ba1ed289f34b8fc3c6873412bec6fd264fbdc82489e510fcbecb9ce9d22dae7f3b76269d8441046014bdca53b9979cd7a561ad631b800'

export const PINNED_COREPACK_RUNTIME = Object.freeze({
  version: '0.34.0',
  launcherSha256: '3655bc798f300951f2070fee411b337d626b0c3ae80c2d24c46ccac4595d4bf9',
  bundleSha256: 'bafd892df44cd70740e23e5d43eeea934b4f261a9eaff3637dac29bdea74d829'
} as const)

const PINNED_NODE_VERSION = 'v22.21.1'

function pinnedCorepackCliPath(): string {
  return resolve(
    dirname(process.execPath),
    process.platform === 'win32'
      ? 'node_modules/corepack/dist/corepack.js'
      : '../lib/node_modules/corepack/dist/corepack.js'
  )
}

function pinnedCorepackEnvironment(
  additions: Readonly<Record<string, string>> = {}
): Readonly<Record<string, string>> {
  return Object.freeze({
    MARKTEXT_COREPACK_BUNDLE_SHA256: PINNED_COREPACK_RUNTIME.bundleSha256,
    MARKTEXT_COREPACK_CLI_PATH: pinnedCorepackCliPath(),
    MARKTEXT_COREPACK_LAUNCHER_SHA256: PINNED_COREPACK_RUNTIME.launcherSha256,
    MARKTEXT_COREPACK_VERSION: PINNED_COREPACK_RUNTIME.version,
    ...additions
  })
}

function pinnedPnpmCommand(
  repoRoot: string,
  pnpm: string,
  arguments_: readonly string[]
): readonly string[] {
  return Object.freeze([
    process.execPath,
    resolve(repoRoot, 'scripts/runPinnedCorepack.mjs'),
    contentAddressedPnpm(pnpm),
    ...arguments_
  ])
}

const PINNED_EVIDENCE_ACTION_REFERENCES = Object.freeze({
  '.github/actions/setup/action.yml': Object.freeze([
    `actions/setup-node@${PINNED_EVIDENCE_ACTIONS['actions/setup-node']}`
  ]),
  '.github/workflows/document-core-platform.yml': Object.freeze([
    `actions/checkout@${PINNED_EVIDENCE_ACTIONS['actions/checkout']}`,
    './.github/actions/setup',
    `actions/upload-artifact@${PINNED_EVIDENCE_ACTIONS['actions/upload-artifact']}`,
    `actions/checkout@${PINNED_EVIDENCE_ACTIONS['actions/checkout']}`,
    './.github/actions/setup',
    `actions/upload-artifact@${PINNED_EVIDENCE_ACTIONS['actions/upload-artifact']}`,
    `actions/checkout@${PINNED_EVIDENCE_ACTIONS['actions/checkout']}`,
    './.github/actions/setup',
    `actions/upload-artifact@${PINNED_EVIDENCE_ACTIONS['actions/upload-artifact']}`
  ])
} as const)

const PINNED_PLATFORM_STEP_SHA256 = Object.freeze({
  'Prepare Electron runtime':
    'aad908691916aba5d5fe5bbe1e870710fca744d394757d31f8abf7342dff8943',
  'Verify runner architecture':
    'd496663373511ed9c7e4218d9503a41535e085176a1b3ea9c93dd5e4bb1db0df',
  'Build document-core and desktop':
    'c80540ac81d9f42cc3a5861a2b81b707f460dcaf3cd348d6f69b50b409be8ffe',
  'Exercise Review through real Electron events':
    'e57a03085ff79282ca23922299f235895ff81f404e30dbfa7bc262dcf52b1f58',
  'Write compact platform attestation':
    '7dab0ca0ea0a01e126ce10a265b99005151e0d050858021f5e37bb7df65a3d60',
  'Upload compact platform attestation':
    '201bd63ac2f14437e839e7e6a21fbc6b63fc06139f2af60dba0da0ffb5d76290'
} as const)

const PINNED_SETUP_STEP_SHA256 = Object.freeze({
  'Enable content-addressed pnpm':
    '319bcfbe20648a8506be898df81de6aa1cba15b15c581209b8c49e61c012cc25',
  'Install Dependencies':
    '4bb94bbbcd6767c3421de0562697591afe07cda9ebf18a314816a22304b4276a'
} as const)

function yamlSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Plan 0009 executable supply-chain YAML structure is incomplete')
  }
  return source.slice(start, end)
}

function namedYamlStep(source: string, name: string): string {
  const lines = source.replace(/\r\n/gu, '\n').split('\n')
  const starts = lines.flatMap((line, index) =>
    line.trim() === `- name: ${name}` ? [index] : []
  )
  const start = starts[0]
  if (starts.length !== 1 || start === undefined) {
    throw new Error(`Plan 0009 executable supply-chain step identity changed: ${name}`)
  }
  const indentation = /^\s*/u.exec(lines[start] ?? '')?.[0].length ?? 0
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim().length === 0) continue
    const nextIndentation = /^\s*/u.exec(line)?.[0].length ?? 0
    if (
      nextIndentation < indentation ||
      (nextIndentation === indentation && line.trimStart().startsWith('- '))
    ) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n').trimEnd()
}

function validatePinnedYamlSteps(
  source: string,
  expected: Readonly<Record<string, string>>
): void {
  for (const [name, expectedSha256] of Object.entries(expected)) {
    if (sha256(namedYamlStep(source, name)) !== expectedSha256) {
      throw new Error(`Plan 0009 executable supply-chain step body changed: ${name}`)
    }
  }
}

function evidenceControlText(
  repoRoot: string,
  path: string,
  candidateCommit?: string
): string {
  try {
    return candidateCommit === undefined
      ? readFileSync(resolve(repoRoot, path), 'utf8')
      : execFileSync('git', ['show', `${candidateCommit}:${path}`], {
        cwd: repoRoot,
        encoding: 'utf8'
      })
  } catch {
    throw new Error(`Required pinned-action control file is unavailable: ${path}`)
  }
}

function actionReferences(source: string, path: string): readonly string[] {
  return Object.freeze(
    source
      .split(/\r?\n/u)
      .filter((line) => /^\s*(?:-\s*)?uses\s*:/u.test(line))
      .map((line) => {
        const match = /^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/u.exec(line)
        if (match?.[1] === undefined) {
          throw new Error(`Evidence control plane has an ambiguous action reference in ${path}`)
        }
        return match[1]
      })
  )
}

export function validate0009PinnedActions(repoRoot: string, candidateCommit?: string): void {
  for (const [path, expectedReferences] of Object.entries(
    PINNED_EVIDENCE_ACTION_REFERENCES
  )) {
    const actualReferences = actionReferences(
      evidenceControlText(repoRoot, path, candidateCommit),
      path
    )
    if (!jsonSame([...actualReferences].sort(), [...expectedReferences].sort())) {
      throw new Error(
        `Plan 0009 executable supply-chain must use the exact pinned action references in ${path}`
      )
    }
  }
}

export function validate0009EvidenceSupplyChain(
  repoRoot: string,
  candidateCommit?: string
): void {
  validate0009PinnedActions(repoRoot, candidateCommit)
  pnpmVersion(repoRoot, candidateCommit)

  const workflow = evidenceControlText(repoRoot, PLATFORM_WORKFLOW_PATH, candidateCommit)
  const setup = evidenceControlText(repoRoot, '.github/actions/setup/action.yml', candidateCommit)
  const postinstall = evidenceControlText(repoRoot, 'scripts/postinstall.ts', candidateCommit)
  const electronIntegrity = evidenceControlText(
    repoRoot,
    'scripts/electronIntegrity.mts',
    candidateCommit
  )
  const electronRebuild = evidenceControlText(
    repoRoot,
    'scripts/runElectronRebuild.mts',
    candidateCommit
  )
  const collector = evidenceControlText(
    repoRoot,
    'packages/document-core/test/plan/0009-evidence-collector.ts',
    candidateCommit
  )
  const pinnedCorepack = evidenceControlText(
    repoRoot,
    'scripts/runPinnedCorepack.mjs',
    candidateCommit
  )
  const documentViewPlaywright = evidenceControlText(
    repoRoot,
    'packages/document-view/e2e/playwright.config.ts',
    candidateCommit
  )
  const desktopManifest = JSON.parse(
    evidenceControlText(repoRoot, 'packages/desktop/package.json', candidateCommit)
  ) as { readonly scripts?: Readonly<Record<string, unknown>> }
  const shellControlPlane = `${workflow}\n${setup}`
  const platformJob = yamlSection(
    workflow,
    '  document-core-review:\n',
    '\n  document-core-closure-proof:'
  )
  validatePinnedYamlSteps(platformJob, PINNED_PLATFORM_STEP_SHA256)
  validatePinnedYamlSteps(setup, PINNED_SETUP_STEP_SHA256)
  if (
    /\b(?:apt-get|apt\s+install|brew\s+install|choco\s+install|winget\s+install|curl|wget|npm\s+exec|npx|pnpm\s+dlx|Invoke-WebRequest)\b|docker:\/\/|^\s*container\s*:/imu.test(
      shellControlPlane
    )
  ) {
    throw new Error('Plan 0009 executable supply-chain must not download mutable tools or OS packages')
  }
  const requiredWorkflowFragments = [
    'os: macos-15',
    'os: windows-2025',
    'os: ubuntu-22.04',
    'command -v xvfb-run',
    'arch: process.arch',
    'os: process.platform',
    'node: process.version'
  ] as const
  if (
    requiredWorkflowFragments.some((fragment) => !workflow.includes(fragment)) ||
    /(?:ubuntu|windows|macos)-latest/u.test(workflow) ||
    !/^ {2}electron_use_remote_checksums: ''$/mu.test(workflow) ||
    !/^ {2}npm_config_electron_use_remote_checksums: ''$/mu.test(workflow) ||
    !/^ {2}ELECTRON_OVERRIDE_DIST_PATH: ''$/mu.test(workflow)
  ) {
    throw new Error('Plan 0009 executable supply-chain must declare its hosted runner trust roots')
  }
  if (
    !setup.includes(PINNED_PNPM_PACKAGE_MANAGER) ||
    !setup.includes('node scripts/runPinnedCorepack.mjs "$package_manager" --version') ||
    !setup.includes(
      'node scripts/runPinnedCorepack.mjs "$package_manager" install --frozen-lockfile --ignore-scripts'
    ) ||
    !setup.includes(PINNED_COREPACK_RUNTIME.launcherSha256) ||
    !setup.includes(PINNED_COREPACK_RUNTIME.bundleSha256) ||
    /^\s*(?:corepack|pnpm)\b/mu.test(setup)
  ) {
    throw new Error('Plan 0009 executable supply-chain must use the content-addressed pnpm bootstrap')
  }
  if (
    !postinstall.includes("from './electronIntegrity.mjs'") ||
    !postinstall.includes('sanitizeElectronEnvironment(process.env, env)') ||
    !postinstall.includes('stageAuthenticatedElectronArchive(zipPath, expectedChecksum)') ||
    !postinstall.includes('findElectronArchive(cacheRoot, zipName)') ||
    !postinstall.includes('extractElectronArchive(stagedArchive.path, distDir)') ||
    !postinstall.includes("'runElectronRebuild.mts'") ||
    !postinstall.includes("throw new Error('Required native-keymap source is missing") ||
    !postinstall.includes("throw new Error('electron/install.js not found") ||
    !postinstall.includes("'electron', 'checksums.json'") ||
    postinstall.includes('isPnpm') ||
    /\bnpm\s+install\b/u.test(postinstall) ||
    /pnpm[^\n]*\badd\s+native-keymap\b/u.test(postinstall) ||
    /\bexecSync\b|run\(`unzip|skipping Electron download/u.test(postinstall) ||
    postinstall.includes('extractElectronArchive(zipPath, distDir)') ||
    postinstall.indexOf('stageAuthenticatedElectronArchive(zipPath, expectedChecksum)') >
      postinstall.indexOf('extractElectronArchive(stagedArchive.path, distDir)') ||
    /process\.env\.(?:ELECTRON_|electron_|npm_config_(?:electron_|platform|arch))/u.test(
      postinstall
    )
  ) {
    throw new Error('Plan 0009 executable supply-chain must sanitize Electron installation')
  }
  if (
    !electronIntegrity.includes('MAX_ELECTRON_CACHE_ENTRIES') ||
    !electronIntegrity.includes('assertElectronArchiveChecksum(stagedPath, expectedSha256)') ||
    !electronIntegrity.includes("execFileSync('unzip', arguments_, { stdio: 'inherit' })") ||
    /\bexecSync\b/u.test(electronIntegrity)
  ) {
    throw new Error(
      'Plan 0009 executable supply-chain must pass bounded Electron archive paths without a shell'
    )
  }
  const pinnedHeaderFragments = [
    "version: '42.1.0'",
    "sha256: '0cfc1d20f252d6c29bdd14b1f3caa30edc6477db93e5a6620674424b38dcddfd'",
    "sha256: 'f2ba9d9c6211b723c9ccce54144e6cd5eaec00cacfe4cfb4df40247a4fedace1'",
    "sha256: '565449702d7afd974faddf6da9387897c8fc7a87d890ccd4c9a6c641fa65b59a'",
    'authenticateElectronHeaderArtifact(artifact, bytes)',
    "new URL(response.url).protocol !== 'https:'",
    "parsed.hostname !== '127.0.0.1'",
    "server.listen(0, '127.0.0.1'",
    "request.method !== 'GET'",
    'const route = request.url',
    "darwin: Object.freeze(['arm64', 'x64'])",
    "linux: Object.freeze(['x64'])",
    "win32: Object.freeze(['arm64', 'x64'])",
    "'--build-from-source'",
    "'--dist-url'",
    'electronRebuildArguments(headerServer.url, targetArch)',
    // A source fragment this collector searches for verbatim, not a template
    // literal that lost its backticks.
    // eslint-disable-next-line no-template-curly-in-string
    '`--arch=${targetArch}`',
    'headerServer.assertConsumed()',
    "mkdtempSync(join(tmpdir(), 'marktext-native-build-'))",
    'environment.HOME = nativeBuildHome',
    'environment.USERPROFILE = nativeBuildHome'
  ] as const
  if (
    pinnedHeaderFragments.some((fragment) => !electronRebuild.includes(fragment)) ||
    /electronRebuildArguments\(['"]https?:/u.test(electronRebuild)
  ) {
    throw new Error(
      'Plan 0009 executable supply-chain must authenticate native headers before local rebuild'
    )
  }
  // Authenticating only its own install leaves every later `pnpm` in the
  // workflow resolving from the runner image. The setup action must publish
  // the pinned launcher on PATH so an ambient binary cannot be reached.
  if (
    !setup.includes('MARKTEXT_PINNED_PNPM_BIN') ||
    !setup.includes('>> "$GITHUB_PATH"') ||
    !setup.includes('exec node') ||
    !setup.includes('chmod +x "$bin_dir/pnpm"')
  ) {
    throw new Error(
      'Plan 0009 executable supply-chain must publish the pinned package manager on PATH'
    )
  }

  // electron-builder runs its own native rebuild unless told not to, which
  // would reach the network outside the authenticated header path above.
  // Requiring the setting semantically — not merely that the file mentions it —
  // is what makes deleting or flipping the line detectable.
  const builderConfiguration = evidenceControlText(
    repoRoot,
    'packages/desktop/electron-builder.yml',
    candidateCommit
  )
  const npmRebuildSettings = [
    ...builderConfiguration.matchAll(/^\s*npmRebuild\s*:\s*(\S+)\s*$/gmu)
  ].map((match) => match[1])
  if (npmRebuildSettings.length !== 1 || npmRebuildSettings[0] !== 'false') {
    throw new Error(
      'Plan 0009 executable supply-chain must forbid an electron-builder native rebuild'
    )
  }

  const desktopScripts = desktopManifest.scripts ?? {}
  const nativeBuildScriptTargets = Object.freeze({
    'build:mac:x64': 'runElectronRebuild.mts --target-platform=darwin --target-arch=x64',
    'build:mac:arm64':
      'runElectronRebuild.mts --target-platform=darwin --target-arch=arm64',
    'build:win:x64': 'runElectronRebuild.mts --target-platform=win32 --target-arch=x64',
    'build:win:arm64':
      'runElectronRebuild.mts --target-platform=win32 --target-arch=arm64',
    'build:linux': 'runElectronRebuild.mts --target-platform=linux --target-arch=x64'
  } as const)
  if (
    Object.values(desktopScripts).some(
      (script) => typeof script === 'string' && /\belectron-rebuild\b/u.test(script)
    ) ||
    Object.entries(nativeBuildScriptTargets).some(
      ([name, target]) =>
        typeof desktopScripts[name] !== 'string' || !desktopScripts[name].includes(target)
    )
  ) {
    throw new Error(
      'Plan 0009 executable supply-chain must route package builds through authenticated native inputs'
    )
  }
  const pinnedCorepackFragments = [
    "const PINNED_NODE_VERSION = 'v22.21.1'",
    "const PINNED_COREPACK_VERSION = '0.34.0'",
    '3655bc798f300951f2070fee411b337d626b0c3ae80c2d24c46ccac4595d4bf9',
    'bafd892df44cd70740e23e5d43eeea934b4f261a9eaff3637dac29bdea74d829',
    'sha256(corepackCliPath) !== PINNED_COREPACK_LAUNCHER_SHA256',
    'sha256(corepackBundlePath) !== PINNED_COREPACK_BUNDLE_SHA256',
    "requireIdentityEnvironment('MARKTEXT_COREPACK_CLI_PATH', corepackCliPath)",
    "COREPACK_DEFAULT_TO_LATEST: '0'",
    "COREPACK_ENABLE_PROJECT_SPEC: '1'",
    "COREPACK_ENABLE_STRICT: '1'",
    'spawn(process.execPath, [corepackCliPath, ...arguments_]'
  ] as const
  // The collector names the pinned launcher twice: once as the executed
  // argument and once in this guard. Substring presence alone is satisfied by
  // the guard's own copy, so a mutation of the call site would pass unseen.
  // Bind the executed argument by its exact construction instead.
  const pinnedCorepackInvocation = [
    '    process.execPath,',
    "    resolve(repoRoot, 'scripts/runPinnedCorepack.mjs'),",
    '    contentAddressedPnpm(pnpm),'
  ].join('\n')
  if (
    pinnedCorepackFragments.some((fragment) => !pinnedCorepack.includes(fragment)) ||
    !collector.includes(pinnedCorepackInvocation) ||
    collector.includes("'corepack',\n      contentAddressedPnpm")
  ) {
    throw new Error(
      'Plan 0009 executable supply-chain must bind evidence commands to pinned Corepack bytes'
    )
  }
  if (
    !collector.includes('sanitizeEvidenceEnvironment(process.env, request.environment)') ||
    !collector.includes("{ CI: '1', PLAYWRIGHT_USE_BUNDLED_CHROMIUM: '1' }") ||
    !documentViewPlaywright.includes('reuseExistingServer: false')
  ) {
    throw new Error(
      'Plan 0009 executable supply-chain must isolate evidence environments and browser servers'
    )
  }
  for (const key of [
    'electron_use_remote_checksums',
    'npm_config_electron_use_remote_checksums',
    'electron_override_dist_path',
    'electron_mirror',
    'electron_custom_version',
    'npm_config_platform',
    'npm_config_arch',
    'nodejs_org_mirror',
    'npm_config_disturl',
    'npm_config_tarball',
    'npm_config_nodedir',
    'npm_config_devdir'
  ]) {
    if (!electronIntegrity.includes(`'${key}'`)) {
      throw new Error(`Plan 0009 executable supply-chain sanitizer omits ${key}`)
    }
  }
  if (!electronIntegrity.includes("startsWith('npm_package_config_node_gyp_')")) {
    throw new Error(
      'Plan 0009 executable supply-chain sanitizer omits node-gyp package overrides'
    )
  }
}

export const FIXED_SURFACE_COMMANDS = Object.freeze({
  conformance: Object.freeze(['conformance']),
  unit: Object.freeze(['core-unit', 'document-view-unit', 'desktop-unit']),
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

export const PLATFORM_WORKFLOW_NAME = 'builds and exercises Review on macOS Windows and Linux'

export const PLATFORM_GITHUB_REPOSITORY = 'csells/MarkText'

export const PLATFORM_WORKFLOW_PATH = '.github/workflows/document-core-platform.yml'

export const PLATFORM_JOBS = Object.freeze({
  'macos-arm64': 'document-core-review-macos-arm64',
  'windows-x64': 'document-core-review-windows-x64',
  'linux-x64': 'document-core-review-linux-x64'
} as const)

export const PLATFORM_REQUIRED_STEPS = Object.freeze([
  'Prepare Electron runtime',
  'Verify runner architecture',
  'Build document-core and desktop',
  'Exercise Review through real Electron events',
  'Write compact platform attestation',
  'Upload compact platform attestation'
])

const CLOSURE_PROOF_JOB = 'document-core-closure-proof'
const CANDIDATE_PUBLICATION_JOB = 'document-core-candidate-publication'

type PlatformName = keyof typeof PLATFORM_JOBS

export interface ValidatedGithubRun {
  readonly databaseId: number
  readonly workflowDatabaseId: number
  readonly jobs: Readonly<Record<PlatformName, number>>
}

export interface ValidatedGithubRunEvidence {
  readonly run: Record<string, unknown>
  readonly validated: ValidatedGithubRun
  readonly attestations: readonly Readonly<{
    readonly artifactId: number
    readonly artifactName: string
    readonly artifactDigest: string
    readonly platform: PlatformName
    readonly content: Buffer
    readonly sha256: string
  }>[]
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
    throw new Error('GitHub platform run is not fresh within the required 24 hours')
  }
  if (
    report.attempt !== 1 ||
    report.status !== 'completed' ||
    report.conclusion !== 'success' ||
    report.event !== 'push' ||
    typeof report.headBranch !== 'string' ||
    !/^evidence\/0009\/pass-[A-Za-z0-9._-]+$/u.test(report.headBranch) ||
    report.headSha !== commit ||
    report.workflowName !== PLATFORM_WORKFLOW_NAME
  ) {
    throw new Error(
      'GitHub platform run must be a first-attempt successful completed run for the current commit and exact workflow'
    )
  }
  const databaseId = positiveInteger(report.databaseId, 'run databaseId')
  const workflowDatabaseId = positiveInteger(
    report.workflowDatabaseId,
    'workflow databaseId'
  )
  if (
    report.url !==
    `https://github.com/${PLATFORM_GITHUB_REPOSITORY}/actions/runs/` + String(databaseId)
  ) {
    throw new Error('GitHub platform run must have its canonical workflow repository URL')
  }
  if (report.workflowPath !== PLATFORM_WORKFLOW_PATH) {
    throw new Error(`GitHub platform run must use workflow path ${PLATFORM_WORKFLOW_PATH}`)
  }
  if (report.refType !== 'tag') {
    throw new Error('GitHub platform run must originate from an authenticated tag ref')
  }
  if (!Array.isArray(report.jobs)) {
    throw new TypeError('GitHub platform run jobs must be an array')
  }
  const expectedNames: readonly string[] = Object.values(PLATFORM_JOBS)
  const jobsByName = new Map<string, number>()
  const allJobNames = new Set<string>()
  let sawClosureProof = false
  for (const rawJob of report.jobs) {
    const job = object(rawJob)
    if (typeof job.name !== 'string' || allJobNames.has(job.name)) {
      throw new Error('GitHub evidence job names must be unique strings')
    }
    allJobNames.add(job.name)
    const databaseId = positiveInteger(job.databaseId, `${job.name} databaseId`)
    if (job.name === CANDIDATE_PUBLICATION_JOB) {
      if (job.conclusion !== 'skipped') {
        throw new Error('Candidate source runs must not execute the publication job')
      }
      continue
    }
    if (!Array.isArray(job.steps) || job.steps.length === 0) {
      throw new Error('Every executed GitHub job must report its platform job steps')
    }
    const stepConclusions = new Map<string, unknown>()
    for (const rawStep of job.steps) {
      const step = object(rawStep)
      if (typeof step.name !== 'string' || stepConclusions.has(step.name)) {
        throw new Error('Every GitHub evidence job step must be uniquely named')
      }
      stepConclusions.set(step.name, step.conclusion)
    }
    if (job.name === CLOSURE_PROOF_JOB) {
      if (
        job.conclusion !== 'success' ||
        stepConclusions.get('Classify Plan 0009 closure state') !== 'success' ||
        stepConclusions.get('Prove GREEN closure or admit RED candidate') !== 'skipped'
      ) {
        throw new Error('Candidate source run did not explicitly admit its RED closure state')
      }
      sawClosureProof = true
      continue
    }
    if (!expectedNames.includes(job.name)) {
      throw new Error(`GitHub platform run contains an unknown job: ${job.name}`)
    }
    if (job.conclusion !== 'success') {
      throw new Error('Every GitHub platform job must conclude successfully')
    }
    jobsByName.set(job.name, databaseId)
    if (
      PLATFORM_REQUIRED_STEPS.some((name) => stepConclusions.get(name) !== 'success')
    ) {
      throw new Error('Every GitHub platform job must execute all required platform job steps')
    }
  }
  if (
    !sawClosureProof ||
    jobsByName.size !== expectedNames.length ||
    expectedNames.some((name) => !jobsByName.has(name))
  ) {
    throw new Error(`GitHub platform run must contain exactly: ${expectedNames.join(', ')}`)
  }
  const macos = jobsByName.get(PLATFORM_JOBS['macos-arm64'])
  const windows = jobsByName.get(PLATFORM_JOBS['windows-x64'])
  const linux = jobsByName.get(PLATFORM_JOBS['linux-x64'])
  if (macos === undefined || windows === undefined || linux === undefined) {
    throw new Error('GitHub platform run has no complete platform job map')
  }
  return Object.freeze({
    databaseId,
    workflowDatabaseId,
    jobs: Object.freeze({
      'macos-arm64': macos,
      'windows-x64': windows,
      'linux-x64': linux
    })
  })
}

function canonicalBase64(value: unknown, label: string): Buffer {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    throw new TypeError(`${label} must be canonical base64`)
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) {
    throw new TypeError(`${label} must be canonical base64`)
  }
  return bytes
}

export function validateGithubRunEvidence(
  value: unknown,
  commit: string,
  observedAt: number = Date.now(),
  expectedNodeVersion: string = PINNED_NODE_VERSION
): ValidatedGithubRunEvidence {
  const envelope = object(value)
  if (
    envelope.schema !== 'marktext-0009-github-run-evidence-v1' ||
    !Array.isArray(envelope.attestations)
  ) {
    throw new Error('GitHub run evidence envelope is invalid')
  }
  const run = object(envelope.run)
  const validated = validateGithubPlatformRun(run, commit, observedAt)
  const runCreatedAt = githubTimestamp(run.createdAt, 'createdAt')
  const runUpdatedAt = githubTimestamp(run.updatedAt, 'updatedAt')
  const expectedPlatforms = Object.keys(PLATFORM_JOBS) as PlatformName[]
  const seen = new Set<PlatformName>()
  const attestations = envelope.attestations.map((raw): ValidatedGithubRunEvidence['attestations'][number] => {
    const artifact = object(raw)
    const artifactId = positiveInteger(artifact.artifactId, 'platform artifact id')
    if (
      typeof artifact.artifactName !== 'string' ||
      typeof artifact.artifactDigest !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/u.test(artifact.artifactDigest) ||
      typeof artifact.fileName !== 'string'
    ) {
      throw new Error('GitHub platform artifact metadata is invalid')
    }
    const content = canonicalBase64(
      artifact.contentBase64,
      `GitHub platform artifact ${artifact.artifactName}`
    )
    let attestation: Record<string, unknown>
    try {
      attestation = object(JSON.parse(content.toString('utf8')))
    } catch {
      throw new Error(`GitHub platform artifact is not JSON: ${artifact.artifactName}`)
    }
    const platformName = attestation.platform
    if (
      typeof platformName !== 'string' ||
      !expectedPlatforms.includes(platformName as PlatformName)
    ) {
      throw new Error('GitHub platform attestation names an unknown platform')
    }
    const platform = platformName as PlatformName
    if (seen.has(platform)) {
      throw new Error(`GitHub platform attestation is duplicated: ${platform}`)
    }
    seen.add(platform)
    const expectedArch = platform === 'macos-arm64' ? 'arm64' : 'x64'
    const expectedOs =
      platform === 'macos-arm64' ? 'darwin' : platform === 'windows-x64' ? 'win32' : 'linux'
    exactObjectKeys(
      attestation,
      [
        'arch',
        'candidateCommit',
        'job',
        'node',
        'os',
        'platform',
        'refName',
        'refType',
        'runAttempt',
        'runId',
        'runnerImageOs',
        'runnerImageVersion',
        'schema',
        'state',
        'verifiedAt',
        'workflow',
        'workflowRef'
      ],
      `${platform} attestation`
    )
    const verifiedAt = githubTimestamp(attestation.verifiedAt, `${platform} verifiedAt`)
    if (attestation.refType !== 'tag' || attestation.refName !== run.headBranch) {
      throw new Error(`GitHub platform attestation is not bound to its exact tag ref: ${platform}`)
    }
    const expectedWorkflowRef =
      `${PLATFORM_GITHUB_REPOSITORY}/${PLATFORM_WORKFLOW_PATH}@refs/tags/` +
      String(run.headBranch)
    if (attestation.workflowRef !== expectedWorkflowRef) {
      throw new Error(`GitHub platform attestation has the wrong workflow ref: ${platform}`)
    }
    if (attestation.os !== expectedOs) {
      throw new Error(`GitHub platform attestation has the wrong operating system: ${platform}`)
    }
    if (attestation.node !== expectedNodeVersion) {
      throw new Error(`GitHub platform attestation has the wrong Node identity: ${platform}`)
    }
    if (
      attestation.schema !== 'marktext-0009-platform-attestation-v1' ||
      attestation.state !== 'verified' ||
      attestation.candidateCommit !== commit ||
      attestation.workflow !== PLATFORM_WORKFLOW_NAME ||
      attestation.runId !== String(validated.databaseId) ||
      attestation.runAttempt !== '1' ||
      attestation.job !== PLATFORM_JOBS[platform] ||
      attestation.arch !== expectedArch ||
      typeof attestation.runnerImageOs !== 'string' ||
      !/^[A-Za-z0-9._-]+$/u.test(attestation.runnerImageOs) ||
      typeof attestation.runnerImageVersion !== 'string' ||
      !/^[A-Za-z0-9._-]+$/u.test(attestation.runnerImageVersion) ||
      artifact.artifactName !== `document-core-platform-${platform}-${commit}` ||
      artifact.fileName !== `${platform}.json` ||
      verifiedAt < runCreatedAt - CLOCK_SKEW_TOLERANCE_MS ||
      verifiedAt > runUpdatedAt + CLOCK_SKEW_TOLERANCE_MS
    ) {
      throw new Error(`GitHub platform attestation is not bound to its exact run: ${platform}`)
    }
    return Object.freeze({
      artifactId,
      artifactName: artifact.artifactName,
      artifactDigest: artifact.artifactDigest,
      platform,
      content,
      sha256: sha256(content)
    })
  })
  if (
    attestations.length !== expectedPlatforms.length ||
    expectedPlatforms.some((platform) => !seen.has(platform))
  ) {
    throw new Error('GitHub run evidence must contain all three platform attestations exactly once')
  }
  return Object.freeze({
    run,
    validated,
    attestations: Object.freeze(attestations)
  })
}

export function validateSequentialGithubRuns(firstValue: unknown, secondValue: unknown): void {
  const first = object(firstValue)
  const second = object(secondValue)
  if (
    typeof first.headBranch !== 'string' ||
    typeof second.headBranch !== 'string' ||
    first.headBranch === second.headBranch
  ) {
    throw new Error('Plan 0009 evidence requires two distinct source tags')
  }
  const firstId = positiveInteger(first.databaseId, 'first source run databaseId')
  const secondId = positiveInteger(second.databaseId, 'second source run databaseId')
  const firstWorkflowId = positiveInteger(
    first.workflowDatabaseId,
    'first source run workflow databaseId'
  )
  const secondWorkflowId = positiveInteger(
    second.workflowDatabaseId,
    'second source run workflow databaseId'
  )
  if (firstWorkflowId !== secondWorkflowId) {
    throw new Error('Plan 0009 evidence source runs must use one exact workflow id')
  }
  const firstUpdatedAt = githubTimestamp(first.updatedAt, 'first source run updatedAt')
  const secondCreatedAt = githubTimestamp(second.createdAt, 'second source run createdAt')
  if (firstId >= secondId || firstUpdatedAt > secondCreatedAt) {
    throw new Error(
      'Plan 0009 evidence source runs must be strictly sequential and supplied oldest first'
    )
  }
}

function vitestTestEntries(report: Record<string, unknown>): readonly EvidenceTestEntry[] {
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
      entries.push(
        Object.freeze({
          file: suite.name,
          title: assertion.title,
          project: null
        })
      )
    }
  }
  return Object.freeze(entries)
}

function playwrightTestEntries(report: Record<string, unknown>): readonly EvidenceTestEntry[] {
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
      const suiteFile = typeof suite.file === 'string' ? suite.file : inheritedFile
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
        const specFile = typeof spec.file === 'string' ? spec.file : suiteFile
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
          entries.push(
            Object.freeze({
              file: specFile,
              title: spec.title,
              project: test.projectName
            })
          )
        }
      }
    }
  }
  visitSuites(report.suites)
  return Object.freeze(entries)
}

interface PlaywrightAttachment {
  readonly name: string
  readonly contentType: string
  readonly path?: string
  readonly body?: string
  readonly evidenceSha256?: string
  readonly evidenceBytes?: number
}

function playwrightAttachmentRecords(
  report: Record<string, unknown>
): readonly Record<string, unknown>[] {
  if (!Array.isArray(report.suites)) {
    throw new TypeError('Playwright evidence must contain named test entries')
  }
  const attachments: Record<string, unknown>[] = []
  const visitSuites = (rawSuites: readonly unknown[]): void => {
    for (const rawSuite of rawSuites) {
      const suite = object(rawSuite)
      if (suite.suites !== undefined) {
        if (!Array.isArray(suite.suites)) {
          throw new TypeError('Playwright evidence has invalid nested suites')
        }
        visitSuites(suite.suites)
      }
      if (suite.specs === undefined) continue
      if (!Array.isArray(suite.specs)) {
        throw new TypeError('Playwright evidence has invalid specs')
      }
      for (const rawSpec of suite.specs) {
        const spec = object(rawSpec)
        if (!Array.isArray(spec.tests)) {
          throw new TypeError('Playwright evidence has invalid test entries')
        }
        for (const rawTest of spec.tests) {
          const test = object(rawTest)
          if (!Array.isArray(test.results)) {
            throw new TypeError('Playwright evidence has invalid test results')
          }
          for (const rawResult of test.results) {
            const result = object(rawResult)
            if (result.attachments === undefined) continue
            if (!Array.isArray(result.attachments)) {
              throw new TypeError('Playwright result attachments must be an array')
            }
            for (const rawAttachment of result.attachments) {
              const attachment = object(rawAttachment)
              if (
                typeof attachment.name !== 'string' ||
                attachment.name.length === 0 ||
                typeof attachment.contentType !== 'string' ||
                attachment.contentType.length === 0
              ) {
                throw new TypeError('Playwright attachment needs a name and content type')
              }
              const hasPath = typeof attachment.path === 'string'
              const hasBody = typeof attachment.body === 'string'
              if (hasPath === hasBody) {
                throw new TypeError('Playwright attachment needs exactly one path or body')
              }
              attachments.push(attachment)
            }
          }
        }
      }
    }
  }
  visitSuites(report.suites)
  return Object.freeze(attachments)
}

function playwrightAttachments(report: Record<string, unknown>): readonly PlaywrightAttachment[] {
  return Object.freeze(
    playwrightAttachmentRecords(report).map((attachment) =>
      Object.freeze({
        name: attachment.name as string,
        contentType: attachment.contentType as string,
        ...(typeof attachment.path === 'string' ? { path: attachment.path } : {}),
        ...(typeof attachment.body === 'string' ? { body: attachment.body } : {}),
        ...(typeof attachment.evidenceSha256 === 'string'
          ? { evidenceSha256: attachment.evidenceSha256 }
          : {}),
        ...(typeof attachment.evidenceBytes === 'number'
          ? { evidenceBytes: attachment.evidenceBytes }
          : {})
      })
    )
  )
}

export function validateVitestReport(value: unknown): EvidenceCounts {
  const report = object(value)
  const total = positiveInteger(report.numTotalTests, 'Vitest total tests')
  const passed = nonnegativeInteger(report.numPassedTests, 'Vitest passed tests')
  const failures = nonnegativeInteger(report.numFailedTests, 'Vitest failed tests')
  const skips = nonnegativeInteger(report.numPendingTests, 'Vitest pending tests')
  if (report.success !== true || failures !== 0 || skips !== 0 || passed !== total) {
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
  const failures = nonnegativeInteger(stats.unexpected, 'Playwright unexpected tests')
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
  readonly excludeTargets?: readonly string[]
  readonly config: string
  readonly project?: 'chromium' | 'evidence-unpacked' | 'installed' | 'unpacked'
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
    pnpmArguments: Object.freeze(['-C', 'packages/document-core', 'run', 'typecheck'])
  },
  {
    id: 'core-build',
    cwd: '.',
    pnpmArguments: Object.freeze(['-C', 'packages/document-core', 'run', 'build'])
  },
  {
    id: 'view-typecheck',
    cwd: '.',
    pnpmArguments: Object.freeze(['-C', 'packages/document-view', 'run', 'typecheck'])
  },
  {
    id: 'desktop-typecheck',
    cwd: '.',
    pnpmArguments: Object.freeze(['--filter', 'marktext', 'run', 'typecheck'])
  },
  {
    id: 'desktop-build',
    cwd: '.',
    pnpmArguments: Object.freeze(['--filter', 'marktext', 'run', 'build'])
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
      excludeTargets: PROPERTY_TEST_TARGETS,
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
      project: 'evidence-unpacked',
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
        MARKTEXT_EXPECTED_EXECUTABLE_SHA256: installedArtifact.executableSha256,
        MARKTEXT_TEST_BACKGROUND: '1'
      })
    },
    {
      id: 'hostile-sinks',
      runner: 'playwright',
      cwd: 'packages/desktop',
      targets: Object.freeze(['test/e2e/document-core-hostile-sinks.spec.ts']),
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
      targets: Object.freeze(['test/e2e/xss.spec.ts', 'test/e2e/context-isolation.spec.ts']),
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

interface ClosureStatusRow {
  readonly id: string
  readonly status: 'red' | 'green'
}

interface ClosureAcceptanceManifest {
  readonly acceptance: readonly ClosureStatusRow[]
}

interface ClosureExitManifest {
  readonly phases: readonly ClosureStatusRow[]
  readonly closure: readonly ClosureStatusRow[]
  readonly verification?: CandidateVerificationRecord
}

export const CANDIDATE_PENDING_ACCEPTANCE_IDS = Object.freeze(['A30', 'A31', 'A32'] as const)

export const CANDIDATE_PENDING_PHASE_IDS = Object.freeze(['P10'] as const)

export const CANDIDATE_PENDING_CLOSURE_IDS = Object.freeze(['D07', 'D08', 'D10'] as const)

export interface PlanClosureState {
  readonly status: 'green' | 'red'
  readonly openGapAreas: readonly string[]
}

export interface ClosureTransitionProof {
  readonly schema: 'marktext-0009-closure-attestation-v1'
  readonly state: 'verified'
  readonly candidateCommit: string
  readonly closureCommit: string
  readonly evidenceSha256: string
  readonly transitionSha256: string
  readonly transitionPaths: readonly string[]
  readonly verifiedAt: string
  readonly plan: Readonly<{
    readonly status: 'green'
    readonly openGapCount: 0
  }>
}

export interface ClosureAttestation extends ClosureTransitionProof {
  readonly publication: CandidateEvidencePublication
  readonly candidateVerificationSha256: string
}

export interface CandidateVerificationRecord {
  readonly schema: 'marktext-0009-candidate-verification-v1'
  readonly state: 'verified'
  readonly candidateCommit: string
  readonly candidateEvidenceSha256: string
  readonly publication: CandidateEvidencePublication
  readonly runs: readonly Readonly<{
    readonly ordinal: 1 | 2
    readonly githubRunDatabaseId: number
    readonly workspaceId: string
    readonly installedArtifactSha256: string
    readonly platformAttestationSha256: Readonly<Record<PlatformName, string>>
  }>[]
  readonly verifiedAt: string
}

export function readPlanClosureState(source: string): PlanClosureState {
  const status = /^- \*\*Status:\*\* (GREEN|RED)\b/mu.exec(source)?.[1]
  if (status !== 'GREEN' && status !== 'RED') {
    throw new Error('Plan 0009 must declare an exact GREEN or RED status')
  }
  const ledger = /^## 4\. Current gap ledger\s*$([\s\S]*?)(?=^## )/mu.exec(source)?.[1]
  if (ledger === undefined) {
    throw new Error('Plan 0009 must contain its current gap ledger')
  }
  const rows = ledger
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('|') && !/^\|\s*-/u.test(line))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())
    )
  const header = rows[0]
  if (header?.[0] !== 'Area' || header[header.length - 1] !== 'Open before closure') {
    throw new Error('Plan 0009 gap ledger has no open-gap column')
  }
  const openGapAreas = rows.slice(1).flatMap((row) => {
    const area = row[0]
    const gap = row[row.length - 1]
    if (area === undefined || gap === undefined) {
      throw new Error('Plan 0009 gap ledger row is malformed')
    }
    return /^(?:None\.?|—)$/u.test(gap) ? [] : [area]
  })
  return Object.freeze({
    status: status.toLowerCase() as PlanClosureState['status'],
    openGapAreas: Object.freeze(openGapAreas)
  })
}

function expectStatusPartition(
  rows: readonly ClosureStatusRow[],
  pendingIds: readonly string[],
  label: string
): void {
  const pending = new Set(pendingIds)
  for (const row of rows) {
    const expected = pending.has(row.id) ? 'red' : 'green'
    if (row.status !== expected) {
      throw new Error(`Plan 0009 candidate ${label} ${row.id} must be ${expected}`)
    }
  }
  for (const id of pending) {
    if (!rows.some((row) => row.id === id)) {
      throw new Error(`Plan 0009 candidate ${label} is missing ${id}`)
    }
  }
}

function assertCandidateDocuments(
  acceptance: ClosureAcceptanceManifest,
  exits: ClosureExitManifest,
  planSource: string
): void {
  if (exits.verification !== undefined) {
    throw new Error('Plan 0009 candidate must not pre-claim verified evidence')
  }
  const plan = readPlanClosureState(planSource)
  if (
    plan.status !== 'red' ||
    plan.openGapAreas.length !== 1 ||
    plan.openGapAreas[0] !== 'P10 release proof'
  ) {
    throw new Error('Plan 0009 candidate must remain incomplete with only P10 release proof open')
  }
  expectStatusPartition(acceptance.acceptance, CANDIDATE_PENDING_ACCEPTANCE_IDS, 'acceptance')
  expectStatusPartition(exits.phases, CANDIDATE_PENDING_PHASE_IDS, 'phase')
  expectStatusPartition(exits.closure, CANDIDATE_PENDING_CLOSURE_IDS, 'closure')
}

export function assert0009CandidateState(repoRoot: string): void {
  const acceptance = readJson<ClosureAcceptanceManifest>(
    resolve(repoRoot, 'specs/migration/0009-acceptance.yml')
  )
  const exits = readJson<ClosureExitManifest>(
    resolve(repoRoot, 'specs/migration/0009-exit-gates.yml')
  )
  const planSource = readFileSync(
    resolve(repoRoot, 'specs/plans/0009-criticmarkup-document-engine-rebuild.md'),
    'utf8'
  )
  assertCandidateDocuments(acceptance, exits, planSource)
}

const CLOSURE_TRANSITION_PATHS = Object.freeze([
  'specs/migration/0009-acceptance.yml',
  'specs/migration/0009-exit-gates.yml',
  'specs/plans/0009-criticmarkup-document-engine-rebuild.md'
] as const)

function committedText(repoRoot: string, commit: string, path: string): string {
  return execFileSync('git', ['show', `${commit}:${path}`], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
}

function statusNeutral(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(statusNeutral)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === 'status' && (entry === 'red' || entry === 'green')
        ? '<closure-status>'
        : statusNeutral(entry)
    ])
  )
}

function closureNeutralExits(value: ClosureExitManifest): unknown {
  const { verification: _verification, ...withoutVerification } = value
  return statusNeutral(withoutVerification)
}

function closureNeutralPlan(source: string): string {
  const statusNeutralSource = source.replace(
    /^- \*\*Status:\*\* (?:GREEN|RED)\b[^\n]*$/mu,
    '- **Status:** <closure-status>'
  )
  return statusNeutralSource.replace(
    /(^## 4\. Current gap ledger\s*$[\s\S]*?)(?=^## )/mu,
    (ledger) =>
      ledger
        .split(/\r?\n/u)
        .map((line) => {
          if (!line.startsWith('|') || /^\|\s*-/u.test(line)) {
            return line
          }
          const cells = line.split('|')
          if (
            cells.length < 4 ||
            cells[1]?.trim() !== 'P10 release proof'
          ) {
            return line
          }
          cells[cells.length - 2] = ' <closure-gap> '
          return cells.join('|')
        })
        .join('\n')
  )
}

function assertEveryStatusGreen(rows: readonly ClosureStatusRow[], label: string): void {
  const nonGreen = rows.filter((row) => row.status !== 'green')
  if (nonGreen.length > 0) {
    throw new Error(
      `Plan 0009 verified ${label} rows are not green: ` + nonGreen.map((row) => row.id).join(', ')
    )
  }
}

export function verify0009ClosureTransition(
  options: Readonly<{
    readonly repoRoot: string
    readonly candidateCommit: string
    readonly evidenceSha256: string
    readonly closureCommit?: string
    readonly permitDirtyWorktree?: boolean
  }>
): ClosureTransitionProof {
  const repoRoot = resolve(options.repoRoot)
  if (!/^[0-9a-f]{40}$/u.test(options.candidateCommit)) {
    throw new Error('Plan 0009 closure needs an exact candidate commit')
  }
  if (!/^[0-9a-f]{64}$/u.test(options.evidenceSha256)) {
    throw new Error('Plan 0009 closure needs the candidate evidence SHA-256')
  }
  if (options.permitDirtyWorktree !== true && dirtyState(repoRoot).length > 0) {
    throw new Error('Plan 0009 closure verification requires a clean worktree')
  }
  const closureCommit = options.closureCommit ?? currentCommit(repoRoot)
  const ancestry = execFileSync('git', ['rev-list', '--parents', '-n', '1', closureCommit], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
    .trim()
    .split(/\s+/u)
  if (
    ancestry.length !== 2 ||
    ancestry[0] !== closureCommit ||
    ancestry[1] !== options.candidateCommit
  ) {
    throw new Error(
      'Plan 0009 closure commit must have exactly one parent: its exact candidate'
    )
  }
  const transitionPaths = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACDMRTUXB', options.candidateCommit, closureCommit],
    { cwd: repoRoot, encoding: 'utf8' }
  )
    .split(/\r?\n/u)
    .filter(Boolean)
    .sort()
  if (
    transitionPaths.length !== CLOSURE_TRANSITION_PATHS.length ||
    transitionPaths.some((path, index) => path !== [...CLOSURE_TRANSITION_PATHS].sort()[index])
  ) {
    throw new Error('Plan 0009 closure may change only its status manifests and Plan')
  }

  const acceptancePath = CLOSURE_TRANSITION_PATHS[0]
  const exitsPath = CLOSURE_TRANSITION_PATHS[1]
  const planPath = CLOSURE_TRANSITION_PATHS[2]
  const candidateAcceptance = JSON.parse(
    committedText(repoRoot, options.candidateCommit, acceptancePath)
  ) as ClosureAcceptanceManifest
  const candidateExits = JSON.parse(
    committedText(repoRoot, options.candidateCommit, exitsPath)
  ) as ClosureExitManifest
  const candidatePlan = committedText(repoRoot, options.candidateCommit, planPath)
  assertCandidateDocuments(candidateAcceptance, candidateExits, candidatePlan)

  const verifiedAcceptance = JSON.parse(
    committedText(repoRoot, closureCommit, acceptancePath)
  ) as ClosureAcceptanceManifest
  const verifiedExits = JSON.parse(
    committedText(repoRoot, closureCommit, exitsPath)
  ) as ClosureExitManifest
  if (
    JSON.stringify(statusNeutral(candidateAcceptance)) !==
      JSON.stringify(statusNeutral(verifiedAcceptance)) ||
    JSON.stringify(closureNeutralExits(candidateExits)) !==
      JSON.stringify(closureNeutralExits(verifiedExits))
  ) {
    throw new Error('Plan 0009 closure manifests may change only closure statuses')
  }
  assertEveryStatusGreen(verifiedAcceptance.acceptance, 'acceptance')
  assertEveryStatusGreen(verifiedExits.phases, 'phase')
  assertEveryStatusGreen(verifiedExits.closure, 'closure')
  const verifiedPlanSource = committedText(repoRoot, closureCommit, planPath)
  if (closureNeutralPlan(candidatePlan) !== closureNeutralPlan(verifiedPlanSource)) {
    throw new Error('Plan 0009 Plan may change only closure status and ledger gaps')
  }
  const verifiedPlan = readPlanClosureState(verifiedPlanSource)
  if (verifiedPlan.status !== 'green' || verifiedPlan.openGapAreas.length !== 0) {
    throw new Error('Plan 0009 verified closure requires GREEN status and zero open ledger gaps')
  }
  const transition = execFileSync(
    'git',
    ['diff', '--binary', options.candidateCommit, closureCommit],
    { cwd: repoRoot }
  )
  return Object.freeze({
    schema: 'marktext-0009-closure-attestation-v1',
    state: 'verified',
    candidateCommit: options.candidateCommit,
    closureCommit,
    evidenceSha256: options.evidenceSha256,
    transitionSha256: sha256(transition),
    transitionPaths: Object.freeze(transitionPaths),
    verifiedAt: new Date().toISOString(),
    plan: Object.freeze({
      status: 'green',
      openGapCount: 0
    })
  })
}

export interface Validated0009CandidateEvidence {
  readonly bundle: EvidenceBundle
  readonly evidencePath: string
  readonly evidenceSha256: string
}

export interface CandidateEvidencePublication {
  readonly schema: 'marktext-0009-publication-v1'
  readonly candidateCommit: string
  readonly publicationRunId: number
  readonly sourceRunIds: readonly [number, number]
  readonly workflowDatabaseId: number
  readonly workflowPath: typeof PLATFORM_WORKFLOW_PATH
  readonly refName: string
  readonly refType: 'tag'
  readonly artifactId: number
  readonly artifactName: string
  readonly artifactDigest: string
}

export interface Downloaded0009CandidateEvidence {
  readonly publication: CandidateEvidencePublication
  readonly validated: Validated0009CandidateEvidence
  readonly cleanup: () => void
}

function evidenceAssertion(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Plan 0009 complete candidate evidence ${message}`)
}

function exactObjectKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  evidenceAssertion(
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()),
    `${label} has unexpected fields`
  )
}

function evidenceInstant(value: unknown, label: string): number {
  evidenceAssertion(typeof value === 'string', `${label} timestamp is missing`)
  const instant = Date.parse(value)
  evidenceAssertion(Number.isFinite(instant), `${label} timestamp is invalid`)
  return instant
}

function evidencePath(repoRoot: string, value: unknown, label: string): string {
  evidenceAssertion(
    typeof value === 'string' &&
      value.length > 0 &&
      !isAbsolute(value) &&
      value !== '..' &&
      !value.startsWith('../') &&
      !value.includes('/../'),
    `${label} path is not repository-relative`
  )
  const absolute = resolve(repoRoot, value)
  posixRelative(repoRoot, absolute)
  return absolute
}

function evidenceFile(
  repoRoot: string,
  pathValue: unknown,
  expectedSha256: unknown,
  label: string,
  expectedBytes?: unknown
): Buffer {
  const path = evidencePath(repoRoot, pathValue, label)
  evidenceAssertion(existsSync(path) && statSync(path).isFile(), `${label} file is missing`)
  const bytes = readFileSync(path)
  evidenceAssertion(
    typeof expectedSha256 === 'string' && /^[0-9a-f]{64}$/u.test(expectedSha256),
    `${label} SHA-256 is invalid`
  )
  evidenceAssertion(sha256(bytes) === expectedSha256, `${label} SHA-256 does not match`)
  if (expectedBytes !== undefined) {
    evidenceAssertion(
      Number.isSafeInteger(expectedBytes) && Number(expectedBytes) === bytes.length,
      `${label} byte count does not match`
    )
  }
  return bytes
}

function githubRunForPass(evidenceRoot: string, pass: EvidencePass): Record<string, unknown> {
  const command = pass.commands.find(({ id }) => id === 'github-platforms')
  evidenceAssertion(command !== undefined, `pass ${String(pass.ordinal)} GitHub command is missing`)
  const report = evidenceFile(
    evidenceRoot,
    command.report.path,
    command.report.sha256,
    `pass ${String(pass.ordinal)} GitHub report`
  )
  try {
    return object(object(JSON.parse(report.toString('utf8')) as unknown).run)
  } catch {
    throw new Error(
      `Plan 0009 complete candidate evidence pass ${String(pass.ordinal)} GitHub report is invalid`
    )
  }
}

function jsonSame(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function validateCommandArtifact(
  evidenceRoot: string,
  raw: unknown,
  occupiedPaths: Set<string>,
  label: string
): EvidenceOutputArtifact {
  const artifact = object(raw)
  exactObjectKeys(artifact, ['bytes', 'contentType', 'name', 'path', 'sha256'], label)
  evidenceAssertion(
    typeof artifact.name === 'string' && artifact.name.length > 0,
    `${label} name is invalid`
  )
  evidenceAssertion(
    typeof artifact.contentType === 'string' && artifact.contentType.length > 0,
    `${label} content type is invalid`
  )
  evidenceAssertion(typeof artifact.path === 'string', `${label} path is invalid`)
  evidenceAssertion(!occupiedPaths.has(artifact.path), `${label} path is reused`)
  occupiedPaths.add(artifact.path)
  const bytes = evidenceFile(evidenceRoot, artifact.path, artifact.sha256, label, artifact.bytes)
  if (
    artifact.name === 'hostile-pdf' ||
    artifact.name === 'hostile-print-proof' ||
    artifact.name === 'critic-marked' ||
    artifact.name === 'critic-original'
  ) {
    evidenceAssertion(artifact.contentType === 'application/pdf', `${label} is not a PDF`)
    evidenceAssertion(
      bytes.subarray(0, 5).toString('latin1') === '%PDF-' &&
        bytes.subarray(-16).toString('latin1').includes('%%EOF'),
      `${label} PDF bytes are invalid`
    )
  }
  return raw as EvidenceOutputArtifact
}

function validateEvidenceCommand(
  repoRoot: string,
  evidenceRoot: string,
  raw: unknown,
  pass: EvidencePass,
  passStarted: number,
  passFinished: number,
  occupiedPaths: Set<string>
): EvidenceCommand {
  const command = object(raw)
  exactObjectKeys(
    command,
    [
      'artifacts',
      'command',
      'commit',
      'counts',
      'cwd',
      'environment',
      'exitCode',
      'finishedAt',
      'id',
      'kind',
      'platform',
      'report',
      'runner',
      'startedAt'
    ],
    `command ${String(command.id)}`
  )
  evidenceAssertion(command.commit === pass.commit, `command ${String(command.id)} commit differs`)
  evidenceAssertion(command.exitCode === 0, `command ${String(command.id)} did not pass`)
  evidenceAssertion(
    command.kind === 'check' || command.kind === 'test' || command.kind === 'github',
    `command ${String(command.id)} kind is invalid`
  )
  evidenceAssertion(typeof command.id === 'string', 'command id is invalid')
  evidenceAssertion(Array.isArray(command.command), `command ${command.id} argv is invalid`)
  evidenceAssertion(
    command.environment !== null &&
      typeof command.environment === 'object' &&
      !Array.isArray(command.environment),
    `command ${command.id} environment is invalid`
  )
  evidenceAssertion(typeof command.cwd === 'string', `command ${command.id} cwd is invalid`)
  evidencePath(repoRoot, command.cwd, `command ${command.id} cwd`)
  const started = evidenceInstant(command.startedAt, `${command.id} startedAt`)
  const finished = evidenceInstant(command.finishedAt, `${command.id} finishedAt`)
  evidenceAssertion(
    started >= passStarted && finished >= started && finished <= passFinished,
    `command ${command.id} timestamps escape their pass`
  )
  const report = object(command.report)
  exactObjectKeys(report, ['format', 'path', 'sha256'], `command ${command.id} report`)
  evidenceAssertion(typeof report.path === 'string', `command ${command.id} report path is invalid`)
  evidenceAssertion(!occupiedPaths.has(report.path), `command ${command.id} report path is reused`)
  occupiedPaths.add(report.path)
  const reportBytes = evidenceFile(
    evidenceRoot,
    report.path,
    report.sha256,
    `command ${command.id} report`
  )
  let reportValue: unknown
  try {
    reportValue = JSON.parse(reportBytes.toString('utf8')) as unknown
  } catch {
    throw new Error(`Plan 0009 complete candidate evidence command ${command.id} report is not JSON`)
  }
  const environment = command.environment as Readonly<Record<string, string>>
  const githubEnvelope = command.kind === 'github' ? object(reportValue) : undefined
  const githubRun = githubEnvelope === undefined ? undefined : object(githubEnvelope.run)
  const expected = expectedEvidenceRequest({
    id: command.id,
    repoRoot,
    reportPath: resolve(evidenceRoot, report.path),
    expectedCommit: pass.commit,
    ...(typeof environment.MARKTEXT_PACKAGED_APP === 'string'
      ? { packagedApp: environment.MARKTEXT_PACKAGED_APP }
      : {}),
    ...(typeof environment.MARKTEXT_EXPECTED_ARTIFACT_SHA256 === 'string'
      ? { installedArtifactSha256: environment.MARKTEXT_EXPECTED_ARTIFACT_SHA256 }
      : {}),
    ...(typeof environment.MARKTEXT_EXPECTED_EXECUTABLE_SHA256 === 'string'
      ? { installedExecutableSha256: environment.MARKTEXT_EXPECTED_EXECUTABLE_SHA256 }
      : {}),
    ...(typeof githubRun?.databaseId === 'number'
      ? { githubRunId: String(githubRun.databaseId) }
      : {})
  })
  evidenceAssertion(command.kind === expected.kind, `command ${command.id} kind differs`)
  const canonical = canonicalEvidenceRequest(expected, evidenceRoot, repoRoot)
  evidenceAssertion(jsonSame(command.command, canonical.command), `command ${command.id} argv differs`)
  evidenceAssertion(
    command.cwd === posixRelative(repoRoot, expected.cwd),
    `command ${command.id} cwd differs`
  )
  evidenceAssertion(
    jsonSame(environment, canonical.environment),
    `command ${command.id} environment differs`
  )
  evidenceAssertion(report.format === expected.reportFormat, `command ${command.id} format differs`)

  const runner = object(command.runner)
  exactObjectKeys(runner, ['name', 'version'], `command ${command.id} runner`)
  const expectedRunner =
    command.kind === 'github'
      ? Object.freeze({ name: 'github-actions', version: 'workflow-attempt-1' })
      : command.kind === 'check'
        ? Object.freeze({ name: 'pnpm', version: pnpmVersion(repoRoot, pass.commit) })
        : report.format === 'vitest-json'
          ? Object.freeze({
            name: 'vitest',
            version: lockedPackageVersion(repoRoot, pass.commit, 'vitest')
          })
          : Object.freeze({
            name: 'playwright',
            version: lockedPackageVersion(repoRoot, pass.commit, '@playwright/test')
          })
  evidenceAssertion(jsonSame(runner, expectedRunner), `command ${command.id} runner differs`)

  const commandPlatform = object(command.platform)
  exactObjectKeys(commandPlatform, ['arch', 'node', 'os'], `command ${command.id} platform`)
  if (command.kind === 'github') {
    const expectedPlatform = Object.freeze({
      os: 'github-matrix',
      arch: 'arm64+x64',
      node: githubNodeVersion(repoRoot, pass.commit)
    })
    evidenceAssertion(
      jsonSame(commandPlatform, expectedPlatform),
      `command ${command.id} platform differs`
    )
  } else {
    validateEvidenceCollectorPlatform(
      repoRoot,
      commandPlatform,
      `command ${command.id} platform`,
      pass.commit
    )
  }

  const counts = object(command.counts)
  let expectedCounts: EvidenceCounts
  let validatedGithubEvidence: ValidatedGithubRunEvidence | undefined
  if (command.kind === 'test') {
    if (report.format === 'vitest-json') {
      expectedCounts = validateVitestReport(reportValue)
      validateExpectedEvidenceTargets(
        reportValue,
        'vitest-json',
        repoRoot,
        resolve(repoRoot, command.cwd),
        command.id
      )
    } else {
      evidenceAssertion(report.format === 'playwright-json', `command ${command.id} format is invalid`)
      expectedCounts = validatePlaywrightReport(reportValue)
      const project = (command.command as readonly string[])
        .find((argument) => argument.startsWith('--project='))
        ?.slice('--project='.length)
      validateExpectedEvidenceTargets(
        reportValue,
        'playwright-json',
        repoRoot,
        resolve(repoRoot, command.cwd),
        command.id,
        project
      )
    }
  } else if (command.kind === 'github') {
    const github = validateGithubRunEvidence(
      reportValue,
      pass.commit,
      started,
      githubNodeVersion(repoRoot, pass.commit)
    )
    validatedGithubEvidence = github
    evidenceAssertion(
      github.validated.databaseId === pass.githubRunDatabaseId,
      `command ${command.id} run id differs`
    )
    expectedCounts = Object.freeze({
      unit: 'jobs',
      total: 3,
      failures: 0,
      retries: 0,
      skips: 0
    })
  } else {
    const commandReport = object(reportValue)
    exactObjectKeys(
      commandReport,
      [
        'command',
        'cwd',
        'environment',
        'exitCode',
        'finishedAt',
        'id',
        'schema',
        'startedAt',
        'stderr',
        'stdout'
      ],
      `command ${command.id} report body`
    )
    evidenceAssertion(
      commandReport.schema === 'marktext-0009-command-report-v1' &&
        commandReport.id === command.id &&
        jsonSame(commandReport.command, command.command) &&
        commandReport.cwd === command.cwd &&
        jsonSame(commandReport.environment, command.environment) &&
        commandReport.exitCode === 0 &&
        commandReport.startedAt === command.startedAt &&
        commandReport.finishedAt === command.finishedAt &&
        typeof commandReport.stdout === 'string' &&
        typeof commandReport.stderr === 'string',
      `command ${command.id} report body differs`
    )
    expectedCounts = Object.freeze({
      unit: 'commands',
      total: 1,
      failures: 0,
      retries: 0,
      skips: 0
    })
  }
  evidenceAssertion(jsonSame(counts, expectedCounts), `command ${command.id} counts differ`)
  evidenceAssertion(Array.isArray(command.artifacts), `command ${command.id} artifacts are invalid`)
  const artifacts = command.artifacts.map((artifact, index) =>
    validateCommandArtifact(
      evidenceRoot,
      artifact,
      occupiedPaths,
      `${command.id} artifact ${String(index)}`
    )
  )
  if (command.kind === 'check' || report.format === 'vitest-json') {
    evidenceAssertion(artifacts.length === 0, `command ${command.id} has unexpected artifacts`)
  }
  if (report.format === 'playwright-json') {
    const attachments = playwrightAttachments(object(reportValue))
    evidenceAssertion(
      attachments.length === artifacts.length,
      `command ${command.id} attachment artifact count differs`
    )
    for (const [index, attachment] of attachments.entries()) {
      const artifact = artifacts[index]
      evidenceAssertion(artifact !== undefined, `command ${command.id} attachment is missing`)
      evidenceAssertion(
        attachment.name === artifact.name &&
          attachment.contentType === artifact.contentType &&
          attachment.path === artifact.path &&
          attachment.body === undefined &&
          attachment.evidenceSha256 === artifact.sha256 &&
          attachment.evidenceBytes === artifact.bytes &&
          attachmentBytes(evidenceRoot, evidenceRoot, attachment).equals(
            evidenceFile(
              evidenceRoot,
              artifact.path,
              artifact.sha256,
              `${command.id} attachment artifact ${String(index)}`,
              artifact.bytes
            )
          ),
        `command ${command.id} attachment artifact bytes differ at ${String(index)}`
      )
    }
  }
  for (const requiredName of REQUIRED_PLAYWRIGHT_ARTIFACTS[command.id] ?? []) {
    evidenceAssertion(
      artifacts.filter(({ name }) => name === requiredName).length === 1,
      `command ${command.id} lacks exact ${requiredName} artifact`
    )
  }
  if (command.kind === 'github') {
    evidenceAssertion(artifacts.length === 3, `command ${command.id} artifact count differs`)
    for (const platform of Object.keys(PLATFORM_JOBS) as PlatformName[]) {
      const matches = artifacts.filter(({ name }) => name === `platform-${platform}`)
      evidenceAssertion(
        matches.length === 1 && matches[0] !== undefined,
        `command ${command.id} lacks exact ${platform} attestation artifact`
      )
      const authenticated = validatedGithubEvidence?.attestations.find(
        (attestation) => attestation.platform === platform
      )
      evidenceAssertion(
        authenticated !== undefined &&
          matches[0].sha256 === authenticated.sha256 &&
          matches[0].bytes === authenticated.content.length &&
          evidenceFile(
            evidenceRoot,
            matches[0].path,
            matches[0].sha256,
            `${command.id} ${platform} retained attestation`,
            matches[0].bytes
          ).equals(authenticated.content),
        `command ${command.id} platform ${platform} attestation artifact bytes differ`
      )
    }
  }
  return raw as EvidenceCommand
}

function validatePreparationOrBuild(
  repoRoot: string,
  evidenceRoot: string,
  raw: unknown,
  pass: EvidencePass,
  passStarted: number,
  passFinished: number,
  occupiedPaths: Set<string>,
  id: 'installed-artifact-build' | 'workspace-prepare'
): EvidenceCommand {
  const command = object(raw)
  evidenceAssertion(command.id === id, `${id} identity is invalid`)
  return validateEvidenceCommand(
    repoRoot,
    evidenceRoot,
    raw,
    pass,
    passStarted,
    passFinished,
    occupiedPaths
  )
}

function validateEvidencePass(
  repoRoot: string,
  evidenceRoot: string,
  raw: unknown,
  candidateCommit: string,
  occupiedPaths: Set<string>
): EvidencePass {
  const passObject = object(raw)
  exactObjectKeys(
    passObject,
    [
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
    ],
    `pass ${String(passObject.ordinal)}`
  )
  evidenceAssertion(passObject.commit === candidateCommit, `pass ${String(passObject.ordinal)} commit differs`)
  evidenceAssertion(
    passObject.ordinal === 1 || passObject.ordinal === 2,
    'pass ordinal is invalid'
  )
  evidenceAssertion(
    typeof passObject.id === 'string' && /^[0-9a-f-]{36}$/u.test(passObject.id),
    `pass ${String(passObject.ordinal)} id is invalid`
  )
  evidenceAssertion(
    Number.isSafeInteger(passObject.githubRunDatabaseId) && Number(passObject.githubRunDatabaseId) > 0,
    `pass ${String(passObject.ordinal)} GitHub run id is invalid`
  )
  const started = evidenceInstant(passObject.startedAt, `pass ${String(passObject.ordinal)} startedAt`)
  const finished = evidenceInstant(passObject.finishedAt, `pass ${String(passObject.ordinal)} finishedAt`)
  evidenceAssertion(finished >= started, `pass ${String(passObject.ordinal)} timestamp order is invalid`)
  const workspace = object(passObject.workspace)
  evidenceAssertion(
    typeof workspace.id === 'string' &&
      /^[0-9a-f-]{36}$/u.test(workspace.id) &&
      workspace.commit === candidateCommit &&
      Array.isArray(workspace.initialDirtyState) &&
      workspace.initialDirtyState.length === 0,
    `pass ${String(passObject.ordinal)} workspace is not fresh and clean`
  )
  evidenceAssertion(
    jsonSame(passObject.surfaces, FIXED_SURFACE_COMMANDS),
    `pass ${String(passObject.ordinal)} surfaces differ`
  )
  const pass = raw as EvidencePass
  validatePreparationOrBuild(
    repoRoot,
    evidenceRoot,
    passObject.preparation,
    pass,
    started,
    finished,
    occupiedPaths,
    'workspace-prepare'
  )
  const installed = object(passObject.installedArtifact)
  exactObjectKeys(
    installed,
    ['build', 'bytes', 'commit', 'executableBytes', 'executableSha256', 'format', 'path', 'sha256'],
    `pass ${String(pass.ordinal)} installed artifact`
  )
  evidenceAssertion(
    installed.commit === candidateCommit && installed.format === 'dmg',
    `pass ${String(pass.ordinal)} installed artifact identity differs`
  )
  evidenceAssertion(
    typeof installed.path === 'string' && !occupiedPaths.has(installed.path),
    `pass ${String(pass.ordinal)} installed artifact path is reused`
  )
  occupiedPaths.add(installed.path)
  evidenceFile(
    evidenceRoot,
    installed.path,
    installed.sha256,
    `pass ${String(pass.ordinal)} installed artifact`,
    installed.bytes
  )
  evidenceAssertion(
    typeof installed.executableSha256 === 'string' &&
      /^[0-9a-f]{64}$/u.test(installed.executableSha256) &&
      Number.isSafeInteger(installed.executableBytes) &&
      Number(installed.executableBytes) > 0,
    `pass ${String(pass.ordinal)} installed executable identity is invalid`
  )
  validatePreparationOrBuild(
    repoRoot,
    evidenceRoot,
    installed.build,
    pass,
    started,
    finished,
    occupiedPaths,
    'installed-artifact-build'
  )
  evidenceAssertion(Array.isArray(passObject.commands), `pass ${String(pass.ordinal)} commands are invalid`)
  const commands = passObject.commands.map((command) =>
    validateEvidenceCommand(
      repoRoot,
      evidenceRoot,
      command,
      pass,
      started,
      finished,
      occupiedPaths
    )
  )
  const installedCommands = commands.filter(({ id }) => id === 'installed')
  evidenceAssertion(
    installedCommands.length === 1 && installedCommands[0] !== undefined,
    `pass ${String(pass.ordinal)} installed command is not unique`
  )
  const installedEnvironment = installedCommands[0].environment
  evidenceAssertion(
    installedEnvironment.MARKTEXT_PACKAGED_APP === INSTALLED_EXECUTABLE_PATH &&
      installedEnvironment.MARKTEXT_EXPECTED_COMMIT === candidateCommit &&
      installedEnvironment.MARKTEXT_EXPECTED_ARTIFACT_SHA256 === installed.sha256 &&
      installedEnvironment.MARKTEXT_EXPECTED_EXECUTABLE_SHA256 ===
        installed.executableSha256 &&
      installedEnvironment.MARKTEXT_TEST_BACKGROUND === '1',
    `pass ${String(pass.ordinal)} installed command does not bind its exact installed artifact`
  )
  evidenceAssertion(
    jsonSame(
      commands.map(({ id }) => id).sort(),
      [...FIXED_CHECK_IDS, ...FIXED_TEST_IDS, 'github-platforms'].sort()
    ),
    `pass ${String(pass.ordinal)} fixed command set differs`
  )
  return pass
}

export function validate0009CandidateEvidence(
  options: Readonly<{
    readonly repoRoot: string
    readonly evidenceRoot?: string
    readonly evidencePath?: string
  }>
): Validated0009CandidateEvidence {
  const repoRoot = resolve(options.repoRoot)
  const evidenceRoot = resolve(options.evidenceRoot ?? repoRoot)
  const evidencePath = resolve(
    options.evidencePath ?? resolve(evidenceRoot, 'specs/migration/0009-candidate-evidence.yml')
  )
  if (!existsSync(evidencePath) || !statSync(evidencePath).isFile()) {
    throw new Error('Plan 0009 complete candidate evidence does not exist')
  }
  const evidenceBytes = readFileSync(evidencePath)
  let value: unknown
  try {
    value = JSON.parse(evidenceBytes.toString('utf8')) as unknown
  } catch {
    throw new Error('Plan 0009 complete candidate evidence is not JSON')
  }
  const candidate = object(value)
  if (
    candidate.schema !== 'marktext-0009-candidate-evidence-v8' ||
    candidate.state !== 'candidate' ||
    typeof candidate.candidateCommit !== 'string' ||
    typeof candidate.candidateTree !== 'string' ||
    !Array.isArray(candidate.dirtyState) ||
    typeof candidate.createdAt !== 'string' ||
    candidate.criticalControlFileHashes === null ||
    typeof candidate.criticalControlFileHashes !== 'object' ||
    Array.isArray(candidate.criticalControlFileHashes) ||
    !Array.isArray(candidate.runs) ||
    candidate.runs.length !== 2
  ) {
    throw new Error('Plan 0009 complete candidate evidence header or body is invalid')
  }
  exactObjectKeys(
    candidate,
    [
      'candidateCommit',
      'candidateTree',
      'createdAt',
      'criticalControlFileHashes',
      'dirtyState',
      'runs',
      'schema',
      'state'
    ],
    'bundle'
  )
  evidenceAssertion(
    /^[0-9a-f]{40}$/u.test(candidate.candidateCommit),
    'candidate commit is invalid'
  )
  try {
    execFileSync('git', ['cat-file', '-e', `${candidate.candidateCommit}^{commit}`], {
      cwd: repoRoot
    })
  } catch {
    throw new Error('Plan 0009 complete candidate evidence commit does not exist')
  }
  validate0009EvidenceSupplyChain(repoRoot, candidate.candidateCommit)
  const committedTree = execFileSync(
    'git',
    ['rev-parse', `${candidate.candidateCommit}^{tree}`],
    { cwd: repoRoot, encoding: 'utf8' }
  ).trim()
  evidenceAssertion(
    /^[0-9a-f]{40}$/u.test(candidate.candidateTree) && candidate.candidateTree === committedTree,
    'candidate tree does not match its commit Merkle identity'
  )
  evidenceAssertion(candidate.dirtyState.length === 0, 'candidate dirty state is not empty')
  const createdAt = evidenceInstant(candidate.createdAt, 'bundle createdAt')
  evidenceAssertion(
    createdAt <= Date.now() + CLOCK_SKEW_TOLERANCE_MS &&
      Date.now() - createdAt <= GITHUB_RUN_FRESHNESS_MS,
    'bundle is not fresh within the required 24 hours'
  )
  const hashes = object(candidate.criticalControlFileHashes)
  evidenceAssertion(
    jsonSame(Object.keys(hashes).sort(), [...CRITICAL_EVIDENCE_CONTROL_FILES].sort()),
    'candidate critical control file hash set differs'
  )
  for (const path of CRITICAL_EVIDENCE_CONTROL_FILES) {
    const expected = hashes[path]
    evidenceAssertion(
      typeof expected === 'string' && /^[0-9a-f]{64}$/u.test(expected),
      `candidate artifact ${path} hash is invalid`
    )
    let committed: Buffer
    try {
      committed = execFileSync('git', ['show', `${candidate.candidateCommit}:${path}`], {
        cwd: repoRoot,
        maxBuffer: 64 * 1024 * 1024
      })
    } catch {
      throw new Error(`Plan 0009 complete candidate evidence artifact is not committed: ${path}`)
    }
    evidenceAssertion(sha256(committed) === expected, `candidate artifact ${path} hash differs`)
  }
  const occupiedPaths = new Set<string>()
  const passes = candidate.runs.map((pass) =>
    validateEvidencePass(
      repoRoot,
      evidenceRoot,
      pass,
      candidate.candidateCommit as string,
      occupiedPaths
    )
  )
  evidenceAssertion(
    passes[0]?.ordinal === 1 && passes[1]?.ordinal === 2,
    'pass order is invalid'
  )
  const firstPass = passes[0]
  const secondPass = passes[1]
  evidenceAssertion(firstPass !== undefined && secondPass !== undefined, 'two passes are required')
  validateSequentialGithubRuns(
    githubRunForPass(evidenceRoot, firstPass),
    githubRunForPass(evidenceRoot, secondPass)
  )
  evidenceAssertion(
    firstPass.id !== secondPass.id &&
      firstPass.workspace.id !== secondPass.workspace.id &&
      firstPass.githubRunDatabaseId !== secondPass.githubRunDatabaseId &&
      firstPass.installedArtifact.path !== secondPass.installedArtifact.path,
    'passes do not have distinct workspaces runs and installed artifacts'
  )
  evidenceAssertion(
    evidenceInstant(passes[1]?.startedAt, 'second pass startedAt') >=
      evidenceInstant(passes[0]?.finishedAt, 'first pass finishedAt'),
    'passes overlap or are out of order'
  )
  evidenceAssertion(
    createdAt >= Math.max(...passes.map((pass) => evidenceInstant(pass.finishedAt, 'pass finishedAt'))),
    'bundle predates a pass'
  )
  return Object.freeze({
    bundle: value as EvidenceBundle,
    evidencePath,
    evidenceSha256: sha256(evidenceBytes)
  })
}

export async function download0009PublishedEvidence(
  options: Readonly<{
    readonly repoRoot: string
    readonly candidateCommit: string
    readonly publicationRunId: string | number
    readonly execute?: EvidenceCommandExecutor
  }>
): Promise<Downloaded0009CandidateEvidence> {
  const repoRoot = resolve(options.repoRoot)
  const candidateCommit = options.candidateCommit
  const publicationRunId = String(options.publicationRunId)
  if (!/^[0-9a-f]{40}$/u.test(candidateCommit) || !/^[1-9]\d*$/u.test(publicationRunId)) {
    throw new Error('Plan 0009 published evidence needs an exact candidate and numeric run id')
  }
  const container = mkdtempSync(resolve(tmpdir(), 'marktext-0009-publication-'))
  const request: CommandRequest = Object.freeze({
    id: 'published-evidence-download',
    kind: 'verifier',
    command: Object.freeze([
      process.execPath,
      resolve(repoRoot, 'node_modules/tsx/dist/cli.mjs'),
      resolve(repoRoot, 'scripts/download0009PublishedEvidence.ts'),
      '--candidate',
      candidateCommit,
      '--publication-run',
      publicationRunId,
      '--output-root',
      container
    ]),
    cwd: repoRoot,
    environment: Object.freeze({})
  })
  try {
    const execution = await (options.execute ?? defaultExecute)(request)
    if (execution.exitCode !== 0) throw commandFailure(request, execution)
    let raw: unknown
    try {
      raw = JSON.parse(execution.stdout) as unknown
    } catch {
      throw new Error('Plan 0009 published evidence downloader returned invalid JSON')
    }
    const publication = object(raw)
    exactObjectKeys(
      publication,
      [
        'artifactDigest',
        'artifactId',
        'artifactName',
        'candidateCommit',
        'normalizedRoot',
        'publicationRunId',
        'refName',
        'refType',
        'schema',
        'sourceRunIds',
        'workflowDatabaseId',
        'workflowPath'
      ],
      'publication'
    )
    evidenceAssertion(
      Array.isArray(publication.sourceRunIds) &&
        publication.sourceRunIds.length === 2 &&
        publication.sourceRunIds.every(
          (id) => Number.isSafeInteger(id) && Number(id) > 0
        ) &&
        publication.sourceRunIds[0] !== publication.sourceRunIds[1] &&
        !publication.sourceRunIds.includes(Number(publication.publicationRunId)),
      'publication source run identity is invalid'
    )
    evidenceAssertion(
      publication.schema === 'marktext-0009-publication-v1' &&
        publication.candidateCommit === candidateCommit &&
        publication.publicationRunId === Number(publicationRunId) &&
        Number.isSafeInteger(publication.workflowDatabaseId) &&
        Number(publication.workflowDatabaseId) > 0 &&
        publication.workflowPath === PLATFORM_WORKFLOW_PATH &&
        typeof publication.refName === 'string' &&
        publication.refName ===
          `evidence/0009/publish-${candidateCommit}-${publication.sourceRunIds.join('-')}` &&
        publication.refType === 'tag' &&
        Number.isSafeInteger(publication.artifactId) &&
        Number(publication.artifactId) > 0 &&
        typeof publication.artifactName === 'string' &&
        typeof publication.artifactDigest === 'string' &&
        /^sha256:[0-9a-f]{64}$/u.test(publication.artifactDigest) &&
        typeof publication.normalizedRoot === 'string',
      'publication identity is invalid'
    )
    const normalizedRoot = resolve(publication.normalizedRoot)
    evidenceAssertion(
      normalizedRoot === resolve(container, 'normalized'),
      'publication normalized root escaped its staging directory'
    )
    const validated = validate0009CandidateEvidence({
      repoRoot,
      evidenceRoot: normalizedRoot
    })
    evidenceAssertion(
      validated.bundle.candidateCommit === candidateCommit,
      'publication candidate differs from its bundle'
    )
    const sourceWorkflowDatabaseId = positiveInteger(
      githubRunForPass(normalizedRoot, validated.bundle.runs[0]).workflowDatabaseId,
      'candidate source workflow databaseId'
    )
    evidenceAssertion(
      publication.workflowDatabaseId === sourceWorkflowDatabaseId,
      'publication workflow id differs from its source runs'
    )
    const sourceRunIds = publication.sourceRunIds as unknown as readonly [number, number]
    evidenceAssertion(
      jsonSame(
        sourceRunIds,
        validated.bundle.runs.map((pass) => pass.githubRunDatabaseId)
      ),
      'publication tag run ids differ from its bundle'
    )
    evidenceAssertion(
      publication.artifactName ===
        `document-core-candidate-evidence-${candidateCommit}-${validated.evidenceSha256}`,
      'publication artifact name is not content-addressed to its bundle'
    )
    return Object.freeze({
      publication: Object.freeze({
        schema: 'marktext-0009-publication-v1',
        candidateCommit,
        publicationRunId: Number(publicationRunId),
        sourceRunIds,
        workflowDatabaseId: Number(publication.workflowDatabaseId),
        workflowPath: PLATFORM_WORKFLOW_PATH,
        refName: publication.refName,
        refType: 'tag',
        artifactId: Number(publication.artifactId),
        artifactName: publication.artifactName,
        artifactDigest: publication.artifactDigest
      }),
      validated,
      cleanup: () => rmSync(container, { recursive: true, force: true })
    })
  } catch (error) {
    rmSync(container, { recursive: true, force: true })
    throw error
  }
}

function candidateVerificationRecord(
  downloaded: Downloaded0009CandidateEvidence,
  verifiedAt: string = new Date().toISOString()
): CandidateVerificationRecord {
  const bundle = downloaded.validated.bundle
  const runs = bundle.runs.map((pass) => {
    const github = pass.commands.find((command) => command.id === 'github-platforms')
    evidenceAssertion(github !== undefined, `pass ${String(pass.ordinal)} has no GitHub evidence`)
    const platformAttestationSha256 = Object.fromEntries(
      (Object.keys(PLATFORM_JOBS) as PlatformName[]).map((platform) => {
        const matches = github.artifacts.filter(
          (artifact) => artifact.name === `platform-${platform}`
        )
        evidenceAssertion(
          matches.length === 1 && matches[0] !== undefined,
          `pass ${String(pass.ordinal)} has no exact ${platform} artifact`
        )
        return [platform, matches[0].sha256]
      })
    ) as Readonly<Record<PlatformName, string>>
    return Object.freeze({
      ordinal: pass.ordinal,
      githubRunDatabaseId: pass.githubRunDatabaseId,
      workspaceId: pass.workspace.id,
      installedArtifactSha256: pass.installedArtifact.sha256,
      platformAttestationSha256: Object.freeze(platformAttestationSha256)
    })
  })
  return Object.freeze({
    schema: 'marktext-0009-candidate-verification-v1',
    state: 'verified',
    candidateCommit: bundle.candidateCommit,
    candidateEvidenceSha256: downloaded.validated.evidenceSha256,
    publication: downloaded.publication,
    runs: Object.freeze(runs),
    verifiedAt
  })
}

function validateCandidateVerificationRecord(
  value: unknown,
  downloaded: Downloaded0009CandidateEvidence
): CandidateVerificationRecord {
  const record = object(value)
  exactObjectKeys(
    record,
    [
      'candidateCommit',
      'candidateEvidenceSha256',
      'publication',
      'runs',
      'schema',
      'state',
      'verifiedAt'
    ],
    'candidate verification record'
  )
  const verifiedAt = evidenceInstant(record.verifiedAt, 'candidate verification verifiedAt')
  evidenceAssertion(
    verifiedAt >= evidenceInstant(downloaded.validated.bundle.createdAt, 'bundle createdAt') &&
      verifiedAt <= Date.now() + CLOCK_SKEW_TOLERANCE_MS,
    'candidate verification timestamp predates its evidence or is in the future'
  )
  const expected = candidateVerificationRecord(downloaded, record.verifiedAt as string)
  evidenceAssertion(
    jsonSame(record, expected),
    'candidate verification record differs from the downloaded complete evidence'
  )
  return value as CandidateVerificationRecord
}

function candidateVerificationSha256(record: CandidateVerificationRecord): string {
  return sha256(JSON.stringify(record, null, 2) + '\n')
}

function publicationFromRecord(value: unknown): CandidateEvidencePublication {
  const publication = object(value)
  exactObjectKeys(
    publication,
    [
      'artifactDigest',
      'artifactId',
      'artifactName',
      'candidateCommit',
      'publicationRunId',
      'refName',
      'refType',
      'schema',
      'sourceRunIds',
      'workflowDatabaseId',
      'workflowPath'
    ],
    'candidate evidence publication'
  )
  evidenceAssertion(
    Array.isArray(publication.sourceRunIds) &&
      publication.sourceRunIds.length === 2 &&
      publication.sourceRunIds.every((id) => Number.isSafeInteger(id) && Number(id) > 0) &&
      publication.sourceRunIds[0] !== publication.sourceRunIds[1] &&
      !publication.sourceRunIds.includes(publication.publicationRunId),
    'candidate evidence publication source runs are invalid'
  )
  evidenceAssertion(
    publication.schema === 'marktext-0009-publication-v1' &&
      typeof publication.candidateCommit === 'string' &&
      /^[0-9a-f]{40}$/u.test(publication.candidateCommit) &&
      Number.isSafeInteger(publication.publicationRunId) &&
      Number(publication.publicationRunId) > 0 &&
      Number.isSafeInteger(publication.workflowDatabaseId) &&
      Number(publication.workflowDatabaseId) > 0 &&
      publication.workflowPath === PLATFORM_WORKFLOW_PATH &&
      typeof publication.refName === 'string' &&
      publication.refName ===
        `evidence/0009/publish-${String(publication.candidateCommit)}-${publication.sourceRunIds.join('-')}` &&
      publication.refType === 'tag' &&
      Number.isSafeInteger(publication.artifactId) &&
      Number(publication.artifactId) > 0 &&
      typeof publication.artifactName === 'string' &&
      typeof publication.artifactDigest === 'string' &&
      /^sha256:[0-9a-f]{64}$/u.test(publication.artifactDigest),
    'candidate evidence publication identity is invalid'
  )
  return value as CandidateEvidencePublication
}

function candidateVerificationAt(
  repoRoot: string,
  closureCommit: string
): CandidateVerificationRecord {
  const exits = JSON.parse(
    committedText(repoRoot, closureCommit, CLOSURE_TRANSITION_PATHS[1])
  ) as ClosureExitManifest
  if (exits.verification === undefined) {
    throw new Error('Plan 0009 closure has no embedded candidate verification')
  }
  return exits.verification
}

function closureAttestation(
  repoRoot: string,
  downloaded: Downloaded0009CandidateEvidence,
  options: Readonly<{
    readonly closureCommit?: string
    readonly permitDirtyWorktree?: boolean
  }> = {}
): ClosureAttestation {
  const closureCommit = options.closureCommit ?? currentCommit(repoRoot)
  const record = validateCandidateVerificationRecord(
    candidateVerificationAt(repoRoot, closureCommit),
    downloaded
  )
  const proof = verify0009ClosureTransition({
    repoRoot,
    candidateCommit: downloaded.validated.bundle.candidateCommit,
    evidenceSha256: downloaded.validated.evidenceSha256,
    closureCommit,
    ...(options.permitDirtyWorktree === undefined
      ? {}
      : { permitDirtyWorktree: options.permitDirtyWorktree })
  })
  return Object.freeze({
    ...proof,
    publication: downloaded.publication,
    candidateVerificationSha256: candidateVerificationSha256(record)
  })
}

function writeClosureAttestationFile(
  repoRoot: string,
  attestation: ClosureAttestation
): void {
  const attestationPath = resolve(repoRoot, 'specs/migration/0009-closure-attestation.yml')
  assertIgnored(repoRoot, attestationPath)
  const stagingRoot = resolve(repoRoot, 'specs/migration/0009-evidence', `closure-${randomUUID()}`)
  const pendingPath = resolve(stagingRoot, 'closure-attestation.pending.json')
  assertIgnored(repoRoot, pendingPath)
  mkdirSync(stagingRoot, { recursive: true })
  try {
    writeFileSync(pendingPath, JSON.stringify(attestation, null, 2) + '\n')
    renameSync(pendingPath, attestationPath)
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
  }
}

function retainPublishedEvidence(
  repoRoot: string,
  downloaded: Downloaded0009CandidateEvidence
): void {
  const sourceMigrationRoot = dirname(downloaded.validated.evidencePath)
  const sourceTree = resolve(sourceMigrationRoot, '0009-evidence')
  const destinationMigrationRoot = resolve(repoRoot, 'specs/migration')
  const destinationEvidence = resolve(destinationMigrationRoot, '0009-candidate-evidence.yml')
  const destinationTree = resolve(destinationMigrationRoot, '0009-evidence')
  assertIgnored(repoRoot, destinationEvidence)
  assertIgnored(repoRoot, resolve(destinationTree, 'probe'))
  rmSync(destinationEvidence, { force: true })
  rmSync(destinationTree, { recursive: true, force: true })
  mkdirSync(destinationMigrationRoot, { recursive: true })
  cpSync(downloaded.validated.evidencePath, destinationEvidence, { preserveTimestamps: true })
  cpSync(sourceTree, destinationTree, { recursive: true, preserveTimestamps: true })
  const retained = validate0009CandidateEvidence({ repoRoot })
  if (retained.evidenceSha256 !== downloaded.validated.evidenceSha256) {
    throw new Error('Plan 0009 retained CI evidence differs from its authenticated publication')
  }
}

export async function write0009CiClosureAttestation(
  options: Readonly<{
    readonly repoRoot: string
    readonly execute?: EvidenceCommandExecutor
  }>
): Promise<ClosureAttestation> {
  const repoRoot = resolve(options.repoRoot)
  if (dirtyState(repoRoot).length > 0) {
    throw new Error('Plan 0009 CI closure verification requires a clean worktree')
  }
  const record = candidateVerificationAt(repoRoot, currentCommit(repoRoot))
  const publication = publicationFromRecord(record.publication)
  const downloaded = await download0009PublishedEvidence({
    repoRoot,
    candidateCommit: publication.candidateCommit,
    publicationRunId: publication.publicationRunId,
    ...(options.execute === undefined ? {} : { execute: options.execute })
  })
  try {
    const attestation = closureAttestation(repoRoot, downloaded)
    retainPublishedEvidence(repoRoot, downloaded)
    writeClosureAttestationFile(repoRoot, attestation)
    if (dirtyState(repoRoot).length > 0) {
      throw new Error('Plan 0009 CI closure attestation dirtied the worktree')
    }
    return attestation
  } finally {
    downloaded.cleanup()
  }
}

function changedClosurePaths(repoRoot: string, candidateCommit: string): readonly string[] {
  const tracked = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACDMRTUXB', candidateCommit, '--'],
    { cwd: repoRoot, encoding: 'utf8' }
  )
    .split(/\r?\n/u)
    .filter(Boolean)
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
    .split(/\r?\n/u)
    .filter(Boolean)
  return Object.freeze([...new Set([...tracked, ...untracked])].sort())
}

function assertExactClosureWorktree(repoRoot: string, candidateCommit: string): void {
  const paths = changedClosurePaths(repoRoot, candidateCommit)
  const expected = [...CLOSURE_TRANSITION_PATHS].sort()
  if (paths.length !== expected.length || paths.some((path, index) => path !== expected[index])) {
    throw new Error('Plan 0009 close requires exactly the three prepared closure documents')
  }
}

export async function create0009VerifiedClosure(
  options: Readonly<{
    readonly repoRoot: string
    readonly publicationRunId: string | number
    readonly execute?: EvidenceCommandExecutor
    readonly message?: string
  }>
): Promise<ClosureAttestation> {
  const repoRoot = resolve(options.repoRoot)
  const candidateCommit = currentCommit(repoRoot)
  assertExactClosureWorktree(repoRoot, candidateCommit)
  const proposedSources = new Map(
    CLOSURE_TRANSITION_PATHS.map((path) => [path, readFileSync(resolve(repoRoot, path), 'utf8')])
  )
  const exitsPath = resolve(repoRoot, CLOSURE_TRANSITION_PATHS[1])
  const originalExitsSource = proposedSources.get(CLOSURE_TRANSITION_PATHS[1])
  if (originalExitsSource === undefined) throw new Error('Plan 0009 exit manifest is missing')
  const proposedExits = JSON.parse(originalExitsSource) as ClosureExitManifest
  if (proposedExits.verification !== undefined) {
    throw new Error('Plan 0009 close refuses a hand-authored candidate verification')
  }
  const attestationPath = resolve(repoRoot, 'specs/migration/0009-closure-attestation.yml')
  const priorAttestation = existsSync(attestationPath) ? readFileSync(attestationPath) : undefined
  const downloaded = await download0009PublishedEvidence({
    repoRoot,
    candidateCommit,
    publicationRunId: options.publicationRunId,
    ...(options.execute === undefined ? {} : { execute: options.execute })
  })
  const indexRoot = mkdtempSync(resolve(tmpdir(), 'marktext-0009-close-'))
  const indexPath = resolve(indexRoot, 'index')
  let refMoved = false
  let createdClosureCommit: string | undefined
  try {
    if (currentCommit(repoRoot) !== candidateCommit) {
      throw new Error('Plan 0009 candidate HEAD changed while evidence was downloaded')
    }
    assertExactClosureWorktree(repoRoot, candidateCommit)
    for (const [path, source] of proposedSources) {
      if (readFileSync(resolve(repoRoot, path), 'utf8') !== source) {
        throw new Error(`Plan 0009 closure document changed while evidence was downloaded: ${path}`)
      }
    }
    const record = candidateVerificationRecord(downloaded)
    writeFileSync(
      exitsPath,
      JSON.stringify({ ...proposedExits, verification: record }, null, 2) + '\n'
    )
    const indexEnvironment = { ...process.env, GIT_INDEX_FILE: indexPath }
    execFileSync('git', ['read-tree', candidateCommit], {
      cwd: repoRoot,
      env: indexEnvironment
    })
    execFileSync('git', ['add', '--', ...CLOSURE_TRANSITION_PATHS], {
      cwd: repoRoot,
      env: indexEnvironment
    })
    const tree = execFileSync('git', ['write-tree'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: indexEnvironment
    }).trim()
    const closureCommit = execFileSync(
      'git',
      [
        'commit-tree',
        tree,
        '-p',
        candidateCommit,
        '-m',
        options.message ?? 'chore: close Plan 0009 from verified evidence'
      ],
      { cwd: repoRoot, encoding: 'utf8' }
    ).trim()
    createdClosureCommit = closureCommit
    const attestation = closureAttestation(repoRoot, downloaded, {
      closureCommit,
      permitDirtyWorktree: true
    })
    writeClosureAttestationFile(repoRoot, attestation)
    execFileSync('git', ['update-ref', 'HEAD', closureCommit, candidateCommit], { cwd: repoRoot })
    refMoved = true
    try {
      execFileSync('git', ['read-tree', closureCommit], { cwd: repoRoot })
    } catch (error) {
      execFileSync('git', ['update-ref', 'HEAD', candidateCommit, closureCommit], { cwd: repoRoot })
      refMoved = false
      throw error
    }
    if (dirtyState(repoRoot).length > 0) {
      throw new Error('Plan 0009 atomic closure did not leave a clean worktree')
    }
    return attestation
  } catch (error) {
    if (refMoved && createdClosureCommit !== undefined) {
      execFileSync('git', ['update-ref', 'HEAD', candidateCommit, createdClosureCommit], {
        cwd: repoRoot
      })
      execFileSync('git', ['read-tree', candidateCommit], { cwd: repoRoot })
    }
    writeFileSync(exitsPath, originalExitsSource)
    if (priorAttestation === undefined) rmSync(attestationPath, { force: true })
    else writeFileSync(attestationPath, priorAttestation)
    throw error
  } finally {
    downloaded.cleanup()
    rmSync(indexRoot, { recursive: true, force: true })
  }
}

export interface ExpectedEvidenceTarget {
  readonly path: string
  readonly title: string
}

const FIXED_TEST_REPORT_TARGETS: Readonly<
  Partial<Record<(typeof FIXED_TEST_IDS)[number], readonly ExpectedEvidenceTarget[]>>
> = Object.freeze({
  'document-view-unit': Object.freeze([
    Object.freeze({
      path: 'packages/document-view/src/documentCore/__tests__/browser-input.spec.ts',
      title: 'routes real copy, cut, and null-data paste gestures through host/core seams'
    })
  ]),
  browser: Object.freeze([
    Object.freeze({
      path: 'packages/document-view/e2e/tests/production-view.spec.ts',
      title: 'renders engine blocks with CriticMarkup in a real browser'
    })
  ]),
  pdf: Object.freeze([
    Object.freeze({
      path: 'packages/desktop/test/e2e/export-pdf.spec.ts',
      title: 'prints all five Critic forms and the Original projection to distinct PDF artifacts'
    })
  ]),
  security: Object.freeze([
    Object.freeze({
      path: 'packages/desktop/test/e2e/xss.spec.ts',
      title: 'Load malicious document'
    }),
    Object.freeze({
      path: 'packages/desktop/test/e2e/context-isolation.spec.ts',
      title: 'contextBridge active, nodeIntegration disabled, no preload leakage'
    })
  ])
})

function evidenceCommandForTarget(target: ManifestTarget): string {
  if (target.kind === 'workflow') return 'github-platforms'
  if (target.path === 'packages/document-core/test/plan/0009-final-closure.spec.ts') {
    return 'final-verifier'
  }
  if (target.path.startsWith('packages/document-core/test/plan/')) {
    return 'docs'
  }
  if (target.path.startsWith('packages/document-core/test/language-engine/')) {
    const relative = target.path.slice('packages/document-core/'.length)
    return PROPERTY_TEST_TARGETS.some((path) => path === relative) ? 'property' : 'conformance'
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
  if (target.path === 'packages/desktop/test/e2e/document-core-hostile-sinks.spec.ts') {
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
    target.path === 'packages/desktop/test/e2e/critic-markup-perf.spec.ts' ||
    target.path === 'packages/desktop/test/e2e/document-core-max-document-perf.spec.ts'
  ) {
    return 'performance'
  }
  if (target.path.startsWith('packages/desktop/test/e2e/')) return 'electron'
  throw new Error(`Plan 0009 evidence has no fixed command for ${target.path}`)
}

export function expectedEvidenceTargets(
  repoRoot: string,
  commandId: string
): readonly ExpectedEvidenceTarget[] {
  const acceptance = readJson<AcceptanceManifest>(
    resolve(repoRoot, 'specs/migration/0009-acceptance.yml')
  )
  const exits = readJson<ExitManifest>(resolve(repoRoot, 'specs/migration/0009-exit-gates.yml'))
  const manifestTargets = [
    ...acceptance.acceptance.flatMap((row) => [row.target, ...(row.auxiliaryTargets ?? [])]),
    ...exits.phases.map((row) => row.target),
    ...exits.closure.map((row) => row.target)
  ].filter((target) => target.kind === 'test' && evidenceCommandForTarget(target) === commandId)
  const targets = [
    ...manifestTargets,
    ...(FIXED_TEST_REPORT_TARGETS[commandId as (typeof FIXED_TEST_IDS)[number]] ?? [])
  ]
  const unique = new Map<string, ExpectedEvidenceTarget>()
  for (const target of targets) {
    const key = `${target.path}\0${target.title}`
    unique.set(
      key,
      Object.freeze({
        path: target.path,
        title: target.title
      })
    )
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
      add(resolve(cwd, commandId === 'browser' ? 'e2e/tests' : 'test/e2e', file))
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
  const entries =
    format === 'vitest-json' ? vitestTestEntries(report) : playwrightTestEntries(report)
  const expected = expectedEvidenceTargets(repoRoot, commandId)
  if (
    format === 'playwright-json' &&
    (project === undefined || entries.some((entry) => entry.project !== project))
  ) {
    throw new Error(
      `Playwright evidence for ${commandId} must contain only project ${String(project)}`
    )
  }
  for (const target of expected) {
    const matches = entries.filter(
      (entry) =>
        entry.title === target.title &&
        reportedEvidencePaths(repoRoot, cwd, entry.file, format, commandId).has(target.path) &&
        (format === 'vitest-json' || entry.project === project)
    )
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

function packageVersion(repoRoot: string, packagePath: string, candidateCommit?: string): string {
  const manifest =
    candidateCommit === undefined
      ? readJson<{ readonly version?: unknown }>(resolve(repoRoot, packagePath))
      : JSON.parse(
        execFileSync('git', ['show', `${candidateCommit}:${packagePath}`], {
          cwd: repoRoot,
          encoding: 'utf8'
        })
      ) as { readonly version?: unknown }
  const value = manifest.version
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${packagePath} must declare a version`)
  }
  return value
}

function lockedPackageVersion(
  repoRoot: string,
  candidateCommit: string,
  packageName: 'vitest' | '@playwright/test'
): string {
  const lock = execFileSync('git', ['show', `${candidateCommit}:pnpm-lock.yaml`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const pattern = packageName.startsWith('@')
    ? new RegExp(`^  '${escapedName}@([^']+)':\\s*$`, 'gmu')
    : new RegExp(`^  ${escapedName}@([^:()]+):\\s*$`, 'gmu')
  const versions = new Set([...lock.matchAll(pattern)].map((match) => match[1]))
  const [version] = versions
  if (versions.size !== 1 || version === undefined || !/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new TypeError(`candidate pnpm lock must pin exactly one ${packageName} version`)
  }
  return version
}

function pnpmVersion(repoRoot: string, candidateCommit?: string): string {
  const manifest =
    candidateCommit === undefined
      ? readJson<{ readonly packageManager?: unknown }>(resolve(repoRoot, 'package.json'))
      : JSON.parse(
        execFileSync('git', ['show', `${candidateCommit}:package.json`], {
          cwd: repoRoot,
          encoding: 'utf8'
        })
      ) as { readonly packageManager?: unknown }
  const value = manifest.packageManager
  const match =
    typeof value === 'string'
      ? /^pnpm@(\d+\.\d+\.\d+)\+sha512\.[0-9a-f]{128}$/u.exec(value)
      : null
  const version = match?.[1]
  if (version === undefined || value !== PINNED_PNPM_PACKAGE_MANAGER) {
    throw new TypeError(
      'package.json packageManager must use content-addressed pinned pnpm bytes'
    )
  }
  return version
}

function contentAddressedPnpm(version: string): string {
  if (!PINNED_PNPM_PACKAGE_MANAGER.startsWith(`pnpm@${version}+sha512.`)) {
    throw new TypeError('pnpm command version differs from its content-addressed package pin')
  }
  return PINNED_PNPM_PACKAGE_MANAGER
}

function githubNodeVersion(repoRoot: string, candidateCommit?: string): string {
  const action =
    candidateCommit === undefined
      ? readFileSync(resolve(repoRoot, '.github/actions/setup/action.yml'), 'utf8')
      : execFileSync(
        'git',
        ['show', `${candidateCommit}:.github/actions/setup/action.yml`],
        { cwd: repoRoot, encoding: 'utf8' }
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

const EVIDENCE_INHERITED_ENVIRONMENT_KEYS = new Set([
  'comspec',
  'gh_token',
  'github_token',
  'home',
  'lang',
  'lc_all',
  'lc_ctype',
  'logname',
  'path',
  'pathext',
  'shell',
  'systemroot',
  'temp',
  'tmp',
  'tmpdir',
  'tz',
  'user',
  'userprofile',
  'windir'
])

export function sanitizeEvidenceEnvironment(
  inherited: Readonly<NodeJS.ProcessEnv>,
  overrides: Readonly<NodeJS.ProcessEnv> = {}
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(inherited)) {
    if (value !== undefined && EVIDENCE_INHERITED_ENVIRONMENT_KEYS.has(key.toLowerCase())) {
      environment[key] = value
    }
  }
  return sanitizeElectronEnvironment(environment, overrides)
}

async function defaultExecute(request: CommandRequest): Promise<CommandExecution> {
  const [executable, ...arguments_] = request.command
  if (executable === undefined) {
    throw new TypeError(`${request.id} has no executable`)
  }
  return await new Promise<CommandExecution>((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      cwd: request.cwd,
      env: sanitizeEvidenceEnvironment(process.env, request.environment),
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
    execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: repoRoot,
      encoding: 'utf8'
    })
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
    throw new Error(`Plan 0009 evidence command dirtied the worktree:\n${dirty.join('\n')}`)
  }
}

interface PassWorkspace {
  readonly root: string
  readonly evidence: EvidencePass['workspace']
  readonly cleanup: () => void
}

function createPassWorkspace(repoRoot: string, commit: string): PassWorkspace {
  const container = mkdtempSync(resolve(tmpdir(), 'marktext-0009-pass-'))
  const root = resolve(container, 'checkout')
  try {
    execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', repoRoot, root], {
      cwd: repoRoot
    })
    execFileSync('git', ['checkout', '--quiet', '--detach', commit], {
      cwd: root
    })
    assertRepositoryState(root, commit)
    return Object.freeze({
      root,
      evidence: Object.freeze({
        id: randomUUID(),
        commit,
        initialDirtyState: Object.freeze([]) as readonly []
      }),
      cleanup: () => rmSync(container, { recursive: true, force: true })
    })
  } catch (error) {
    rmSync(container, { recursive: true, force: true })
    throw error
  }
}

function criticalControlFileHashes(
  repoRoot: string,
  commit: string
): Readonly<Record<string, string>> {
  const entries = CRITICAL_EVIDENCE_CONTROL_FILES.map((path): readonly [string, string] => {
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

function requiredReportPath(request: CommandRequest): string {
  if (request.reportPath === undefined) {
    throw new Error(`${request.id} has no evidence report path`)
  }
  return request.reportPath
}

function reportEvidence(repoRoot: string, path: string, format: ReportFormat): EvidenceReport {
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

const REQUIRED_PLAYWRIGHT_ARTIFACTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'hostile-sinks': Object.freeze(['hostile-pdf', 'hostile-print-proof']),
  pdf: Object.freeze(['critic-marked', 'critic-original'])
})

function attachmentExtension(attachment: PlaywrightAttachment): string {
  if (attachment.path !== undefined) {
    const extension = extname(attachment.path)
    if (/^\.[a-z0-9]{1,10}$/i.test(extension)) return extension.toLowerCase()
  }
  if (attachment.contentType === 'application/pdf') return '.pdf'
  if (attachment.contentType === 'application/json') return '.json'
  if (attachment.contentType === 'text/html') return '.html'
  if (attachment.contentType.startsWith('text/')) return '.txt'
  return '.bin'
}

function attachmentBytes(repoRoot: string, cwd: string, attachment: PlaywrightAttachment): Buffer {
  if (attachment.path !== undefined) {
    const sourcePath = isAbsolute(attachment.path)
      ? resolve(attachment.path)
      : resolve(cwd, attachment.path)
    posixRelative(repoRoot, sourcePath)
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      throw new Error(`Playwright attachment path does not name a file: ${attachment.path}`)
    }
    return readFileSync(sourcePath)
  }
  const body = attachment.body
  if (body === undefined) {
    throw new TypeError('Playwright attachment body is missing')
  }
  if (
    body.length === 0 ||
    body.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body)
  ) {
    throw new TypeError('Playwright attachment body must be canonical base64')
  }
  const data = Buffer.from(body, 'base64')
  if (data.toString('base64') !== body) {
    throw new TypeError('Playwright attachment body must be canonical base64')
  }
  return data
}

function collectPlaywrightArtifacts(
  report: Record<string, unknown>,
  request: CommandRequest,
  evidenceRoot: string,
  workspaceRoot: string
): readonly EvidenceOutputArtifact[] {
  const attachments = playwrightAttachments(report)
  const artifactRoot = resolve(
    dirname(requiredReportPath(request)),
    `${request.id}-artifacts`
  )
  const artifacts = attachments.map((attachment, index) => {
    if (
      attachment.name.length > 200 ||
      attachment.contentType.length > 200 ||
      [...`${attachment.name}${attachment.contentType}`].some((character) => {
        const code = character.charCodeAt(0)
        return code <= 0x1f || code === 0x7f
      })
    ) {
      throw new TypeError('Playwright attachment metadata is invalid')
    }
    const data = attachmentBytes(workspaceRoot, request.cwd, attachment)
    if (data.length === 0) {
      throw new Error('Playwright evidence attachment must not be empty')
    }
    const safeName =
      attachment.name.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'attachment'
    const artifactPath = resolve(
      artifactRoot,
      `${String(index + 1).padStart(3, '0')}-${safeName}` + attachmentExtension(attachment)
    )
    mkdirSync(dirname(artifactPath), { recursive: true })
    writeFileSync(artifactPath, data)
    assertIgnored(evidenceRoot, artifactPath)
    return Object.freeze({
      name: attachment.name,
      contentType: attachment.contentType,
      path: posixRelative(evidenceRoot, artifactPath),
      sha256: sha256(data),
      bytes: data.length
    })
  })

  for (const name of REQUIRED_PLAYWRIGHT_ARTIFACTS[request.id] ?? []) {
    const matches = artifacts.filter((artifact) => artifact.name === name)
    if (matches.length !== 1) {
      throw new Error(`${request.id} evidence must attach ${name} exactly once`)
    }
    const artifact = matches[0]
    if (artifact === undefined) {
      throw new Error(`${request.id} evidence attachment ${name} is missing`)
    }
    if (artifact.contentType !== 'application/pdf') {
      throw new Error(`${request.id} attachment ${name} must be a PDF`)
    }
    const data = readFileSync(resolve(evidenceRoot, artifact.path))
    if (
      data.subarray(0, 5).toString('latin1') !== '%PDF-' ||
      !data.subarray(-16).toString('latin1').includes('%%EOF')
    ) {
      throw new Error(`${request.id} attachment ${name} is not a PDF artifact`)
    }
  }
  return Object.freeze(artifacts)
}

function bindPlaywrightAttachmentsToArtifacts(
  report: Record<string, unknown>,
  artifacts: readonly EvidenceOutputArtifact[]
): void {
  const attachments = playwrightAttachmentRecords(report)
  if (attachments.length !== artifacts.length) {
    throw new Error('Playwright evidence attachment artifact count changed during collection')
  }
  for (const [index, attachment] of attachments.entries()) {
    const artifact = artifacts[index]
    if (
      artifact === undefined ||
      attachment.name !== artifact.name ||
      attachment.contentType !== artifact.contentType
    ) {
      throw new Error(`Playwright evidence attachment artifact ${String(index)} changed identity`)
    }
    delete attachment.body
    attachment.path = artifact.path
    attachment.evidenceSha256 = artifact.sha256
    attachment.evidenceBytes = artifact.bytes
  }
}

function localPlatform(): EvidenceCommand['platform'] {
  return Object.freeze({
    os: platform(),
    arch: arch(),
    node: process.version
  })
}

export function validateEvidenceCollectorPlatform(
  repoRoot: string,
  value: unknown,
  label = 'evidence collector platform',
  candidateCommit?: string
): void {
  const commandPlatform = object(value)
  exactObjectKeys(commandPlatform, ['arch', 'node', 'os'], label)
  const expected = Object.freeze({
    os: 'darwin',
    arch: 'arm64',
    node: githubNodeVersion(repoRoot, candidateCommit)
  })
  evidenceAssertion(
    jsonSame(commandPlatform, expected),
    `${label} differs from the pinned publication contract`
  )
}

export function assert0009EvidenceCollectorRuntime(repoRoot: string): void {
  validate0009EvidenceSupplyChain(repoRoot, currentCommit(repoRoot))
  validateEvidenceCollectorPlatform(
    repoRoot,
    localPlatform(),
    'active evidence collector runtime',
    currentCommit(repoRoot)
  )
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
  repoRoot: string,
  candidateCommit?: string
): InstalledArtifactBuildPlan {
  const version = packageVersion(
    repoRoot,
    'packages/desktop/package.json',
    candidateCommit
  )
  return Object.freeze({
    artifactPath: resolve(repoRoot, 'dist', `marktext-mac-arm64-${version}.dmg`),
    format: 'dmg',
    pnpmArguments: Object.freeze(['run', 'build:mac:arm64'])
  })
}

function installedArtifactBuildRequest(
  repoRoot: string,
  reportRoot: string,
  plan: InstalledArtifactBuildPlan,
  pnpm: string
): CommandRequest {
  return Object.freeze({
    id: 'installed-artifact-build',
    kind: 'check',
    command: pinnedPnpmCommand(repoRoot, pnpm, plan.pnpmArguments),
    cwd: repoRoot,
    environment: pinnedCorepackEnvironment({
      MARKTEXT_EXPECTED_ARTIFACT_PATH: plan.artifactPath
    }),
    reportPath: resolve(reportRoot, 'installed-artifact-build.command.json'),
    reportFormat: 'command-json'
  })
}

function mountMacDmg(request: InstalledArtifactMountRequest): InstalledArtifactMount {
  const mountPoint = mkdtempSync(resolve(tmpdir(), 'marktext-0009-installed-'))
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
    const executablePath = resolve(mountPoint, 'marktext.app', 'Contents', 'MacOS', 'marktext')
    if (!existsSync(executablePath) || !statSync(executablePath).isFile()) {
      throw new Error(`Mounted plan 0009 DMG has no MarkText executable: ${executablePath}`)
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
    readonly evidenceRoot: string
    readonly workspaceRoot: string
    readonly reportRoot: string
    readonly commit: string
    readonly execute: EvidenceCommandExecutor
    readonly pnpmVersion: string
    readonly mount: InstalledArtifactMounter
  }>
): Promise<CollectedInstalledArtifact> {
  const plan = installedArtifactBuildPlan(options.workspaceRoot)
  const request = installedArtifactBuildRequest(
    options.workspaceRoot,
    options.reportRoot,
    plan,
    options.pnpmVersion
  )
  const build = await runCheck(
    options.execute,
    request,
    options.evidenceRoot,
    options.workspaceRoot,
    options.commit,
    options.pnpmVersion
  )
  if (!existsSync(plan.artifactPath) || !statSync(plan.artifactPath).isFile()) {
    throw new Error(`Installed-artifact build did not create ${plan.artifactPath}`)
  }
  const artifactStat = statSync(plan.artifactPath)
  if (artifactStat.mtimeMs < Date.parse(build.startedAt) - 2_000) {
    throw new Error('Installed-artifact build output predates its build command')
  }
  const retainedArtifactPath = resolve(
    options.reportRoot,
    'installed-artifact',
    basename(plan.artifactPath)
  )
  mkdirSync(dirname(retainedArtifactPath), { recursive: true })
  copyFileSync(plan.artifactPath, retainedArtifactPath)
  assertIgnored(options.evidenceRoot, retainedArtifactPath)
  const retainedArtifactStat = statSync(retainedArtifactPath)
  const artifactSha256 = sha256(readFileSync(retainedArtifactPath))
  const mounted = await options.mount(
    Object.freeze({
      artifactPath: retainedArtifactPath,
      format: plan.format
    })
  )
  if (
    !isAbsolute(mounted.executablePath) ||
    !existsSync(mounted.executablePath) ||
    !statSync(mounted.executablePath).isFile()
  ) {
    mounted.cleanup()
    throw new Error('Installed-artifact mount must expose one existing absolute executable')
  }
  const executableStat = statSync(mounted.executablePath)
  return Object.freeze({
    executablePath: mounted.executablePath,
    cleanup: mounted.cleanup,
    evidence: Object.freeze({
      commit: options.commit,
      format: plan.format,
      path: posixRelative(options.evidenceRoot, retainedArtifactPath),
      sha256: artifactSha256,
      bytes: retainedArtifactStat.size,
      executableSha256: sha256(readFileSync(mounted.executablePath)),
      executableBytes: executableStat.size,
      build
    })
  })
}

function assertInstalledArtifactUnchanged(
  evidenceRoot: string,
  artifact: CollectedInstalledArtifact
): void {
  const sourcePath = resolve(evidenceRoot, artifact.evidence.path)
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
    statSync(artifact.executablePath).size !== artifact.evidence.executableBytes ||
    sha256(readFileSync(artifact.executablePath)) !== artifact.evidence.executableSha256
  ) {
    throw new Error('The mounted installed executable changed during evidence')
  }
}

function checkRequest(
  repoRoot: string,
  reportRoot: string,
  check: FixedCheck,
  pnpm: string
): CommandRequest {
  return Object.freeze({
    id: check.id,
    kind: 'check',
    command: pinnedPnpmCommand(repoRoot, pnpm, check.pnpmArguments),
    cwd: resolve(repoRoot, check.cwd),
    environment: pinnedCorepackEnvironment(),
    reportPath: resolve(reportRoot, `${check.id}.command.json`),
    reportFormat: 'command-json'
  })
}

function workspacePreparationRequest(
  repoRoot: string,
  reportRoot: string,
  pnpm: string
): CommandRequest {
  return Object.freeze({
    id: 'workspace-prepare',
    kind: 'check',
    command: pinnedPnpmCommand(repoRoot, pnpm, ['install', '--frozen-lockfile']),
    cwd: repoRoot,
    environment: pinnedCorepackEnvironment(),
    reportPath: resolve(reportRoot, 'workspace-prepare.command.json'),
    reportFormat: 'command-json'
  })
}

function testRequest(repoRoot: string, reportRoot: string, test: FixedTest): CommandRequest {
  const reportFormat = test.runner === 'vitest' ? 'vitest-json' : 'playwright-json'
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
        ...(test.excludeTargets ?? []).map((target) => `--exclude=${target}`),
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
      ? { CI: '1', PLAYWRIGHT_USE_BUNDLED_CHROMIUM: '1' }
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
      ...(test.project === undefined ? [] : [`--project=${test.project}`]),
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

function githubRequest(repoRoot: string, reportRoot: string, runId: string): CommandRequest {
  return Object.freeze({
    id: 'github-platforms',
    kind: 'github',
    command: Object.freeze([
      process.execPath,
      resolve(repoRoot, 'node_modules/tsx/dist/cli.mjs'),
      resolve(repoRoot, 'scripts/collect0009PlatformRun.ts'),
      '--github-run',
      runId,
      '--repo',
      PLATFORM_GITHUB_REPOSITORY
    ]),
    cwd: repoRoot,
    environment: Object.freeze({}),
    reportPath: resolve(reportRoot, 'github-platforms.github-run.json'),
    reportFormat: 'github-run-json'
  })
}

export function expectedEvidenceRequest(
  options: Readonly<{
    readonly id: string
    readonly repoRoot: string
    readonly reportPath: string
    readonly expectedCommit?: string
    readonly packagedApp?: string
    readonly installedArtifactSha256?: string
    readonly installedExecutableSha256?: string
    readonly githubRunId?: string
  }>
): CommandRequest {
  const reportRoot = dirname(options.reportPath)
  if (options.id === 'workspace-prepare') {
    return workspacePreparationRequest(
      options.repoRoot,
      reportRoot,
      pnpmVersion(options.repoRoot, options.expectedCommit)
    )
  }
  if (options.id === 'installed-artifact-build') {
    return installedArtifactBuildRequest(
      options.repoRoot,
      reportRoot,
      installedArtifactBuildPlan(options.repoRoot, options.expectedCommit),
      pnpmVersion(options.repoRoot, options.expectedCommit)
    )
  }
  const check = FIXED_CHECKS.find((candidate) => candidate.id === options.id)
  if (check !== undefined) {
    return checkRequest(
      options.repoRoot,
      reportRoot,
      check,
      pnpmVersion(options.repoRoot, options.expectedCommit)
    )
  }
  const test = fixedTests(
    {
      executablePath: options.packagedApp ?? '',
      sha256: options.installedArtifactSha256 ?? '',
      executableSha256: options.installedExecutableSha256 ?? ''
    },
    options.expectedCommit ?? currentCommit(options.repoRoot)
  ).find((candidate) => candidate.id === options.id)
  if (test !== undefined) {
    return testRequest(options.repoRoot, dirname(options.reportPath), test)
  }
  if (options.id === 'github-platforms') {
    if (options.githubRunId === undefined) {
      throw new Error('github-platforms evidence requires its GitHub run id')
    }
    return githubRequest(options.repoRoot, reportRoot, options.githubRunId)
  }
  throw new Error(`Unknown plan 0009 evidence command id: ${options.id}`)
}

function canonicalPathValue(value: string, root: string, token: string): string {
  const absoluteRoot = resolve(root)
  const index = value.indexOf(absoluteRoot)
  if (index === -1) return value
  const afterRoot = index + absoluteRoot.length
  if (afterRoot < value.length && value[afterRoot] !== '/' && value[afterRoot] !== '\\') {
    return value
  }
  return value.slice(0, index) + token + value.slice(afterRoot).split(sep).join('/')
}

export function canonicalEvidenceRequest(
  request: CommandRequest,
  evidenceRoot: string,
  workspaceRoot: string
): Readonly<{
    readonly command: readonly string[]
    readonly environment: Readonly<Record<string, string>>
  }> {
  const command = request.command.map((argument) => {
    if (argument.startsWith('--outputFile=')) {
      return canonicalPathValue(argument, evidenceRoot, EVIDENCE_REPOSITORY_PATH)
    }
    return canonicalPathValue(
      canonicalPathValue(argument, workspaceRoot, CANDIDATE_CHECKOUT_PATH),
      evidenceRoot,
      EVIDENCE_REPOSITORY_PATH
    )
  })
  const environment = Object.fromEntries(
    Object.entries(request.environment ?? {}).map(([key, value]) => {
      if (key === 'MARKTEXT_PACKAGED_APP') {
        return [key, INSTALLED_EXECUTABLE_PATH]
      }
      if (key === 'PLAYWRIGHT_JSON_OUTPUT_FILE') {
        return [key, canonicalPathValue(value, evidenceRoot, EVIDENCE_REPOSITORY_PATH)]
      }
      return [
        key,
        canonicalPathValue(
          canonicalPathValue(value, workspaceRoot, CANDIDATE_CHECKOUT_PATH),
          evidenceRoot,
          EVIDENCE_REPOSITORY_PATH
        )
      ]
    })
  )
  return Object.freeze({
    command: Object.freeze(command),
    environment: Object.freeze(environment)
  })
}

function portableReportValue(value: unknown, workspaceRoot: string): unknown {
  if (typeof value === 'string' && isAbsolute(value)) {
    const path = relative(workspaceRoot, value)
    if (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)) {
      return path.length === 0 ? '.' : path.split(sep).join('/')
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => portableReportValue(entry, workspaceRoot))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, portableReportValue(entry, workspaceRoot)])
    )
  }
  return value
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
  evidenceRoot: string,
  workspaceRoot: string,
  commit: string,
  runnerVersion: string
): Promise<EvidenceCommand> {
  const startedAt = new Date().toISOString()
  const execution = await execute(request)
  const finishedAt = new Date().toISOString()
  if (execution.exitCode !== 0) throw commandFailure(request, execution)
  const reportPath = requiredReportPath(request)
  const canonical = canonicalEvidenceRequest(request, evidenceRoot, workspaceRoot)
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        schema: 'marktext-0009-command-report-v1',
        id: request.id,
        command: canonical.command,
        cwd: posixRelative(workspaceRoot, request.cwd),
        environment: canonical.environment,
        exitCode: execution.exitCode,
        startedAt,
        finishedAt,
        stdout: execution.stdout,
        stderr: execution.stderr
      },
      null,
      2
    ) + '\n'
  )
  assertRepositoryState(workspaceRoot, commit)
  return Object.freeze({
    id: request.id,
    kind: 'check',
    commit,
    command: canonical.command,
    cwd: posixRelative(workspaceRoot, request.cwd),
    environment: canonical.environment,
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
    report: reportEvidence(evidenceRoot, reportPath, 'command-json'),
    artifacts: Object.freeze([])
  })
}

async function runTest(
  execute: EvidenceCommandExecutor,
  request: CommandRequest,
  evidenceRoot: string,
  workspaceRoot: string,
  commit: string,
  runnerVersion: string
): Promise<EvidenceCommand> {
  const startedAt = new Date().toISOString()
  const execution = await execute(request)
  const finishedAt = new Date().toISOString()
  if (execution.exitCode !== 0) throw commandFailure(request, execution)
  const reportFormat = request.reportFormat
  if (reportFormat !== 'vitest-json' && reportFormat !== 'playwright-json') {
    throw new Error(`${request.id} has no test report format`)
  }
  const reportPath = requiredReportPath(request)
  const reportValue = readJson<unknown>(reportPath)
  const counts =
    reportFormat === 'vitest-json'
      ? validateVitestReport(reportValue)
      : validatePlaywrightReport(reportValue)
  const project = request.command
    .find((argument) => argument.startsWith('--project='))
    ?.slice('--project='.length)
  validateExpectedEvidenceTargets(
    reportValue,
    reportFormat,
    workspaceRoot,
    request.cwd,
    request.id,
    project
  )
  const artifacts =
    reportFormat === 'playwright-json'
      ? collectPlaywrightArtifacts(object(reportValue), request, evidenceRoot, workspaceRoot)
      : Object.freeze([])
  if (reportFormat === 'playwright-json') {
    bindPlaywrightAttachmentsToArtifacts(object(reportValue), artifacts)
  }
  writeFileSync(
    reportPath,
    JSON.stringify(portableReportValue(reportValue, workspaceRoot), null, 2) + '\n'
  )
  assertRepositoryState(workspaceRoot, commit)
  const runnerName = reportFormat === 'vitest-json' ? 'vitest' : 'playwright'
  const canonical = canonicalEvidenceRequest(request, evidenceRoot, workspaceRoot)
  return Object.freeze({
    id: request.id,
    kind: 'test',
    commit,
    command: canonical.command,
    cwd: posixRelative(workspaceRoot, request.cwd),
    environment: canonical.environment,
    exitCode: 0,
    startedAt,
    finishedAt,
    runner: Object.freeze({ name: runnerName, version: runnerVersion }),
    platform: localPlatform(),
    counts,
    report: reportEvidence(evidenceRoot, reportPath, reportFormat),
    artifacts
  })
}

async function runGithub(
  execute: EvidenceCommandExecutor,
  request: CommandRequest,
  evidenceRoot: string,
  workspaceRoot: string,
  commit: string,
  nodeVersion: string
): Promise<
    Readonly<{
      readonly command: EvidenceCommand
      readonly databaseId: number
    }>
  > {
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
  const githubEvidence = validateGithubRunEvidence(
    reportValue,
    commit,
    Date.parse(startedAt),
    nodeVersion
  )
  const reportPath = requiredReportPath(request)
  writeFileSync(reportPath, JSON.stringify(reportValue, null, 2) + '\n')
  const attestationRoot = resolve(dirname(reportPath), 'github-platform-attestations')
  const artifacts = githubEvidence.attestations.map((attestation) => {
    const path = resolve(attestationRoot, `${attestation.platform}.json`)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, attestation.content)
    assertIgnored(evidenceRoot, path)
    return Object.freeze({
      name: `platform-${attestation.platform}`,
      contentType: 'application/json',
      path: posixRelative(evidenceRoot, path),
      sha256: attestation.sha256,
      bytes: attestation.content.length
    })
  })
  assertRepositoryState(workspaceRoot, commit)
  const canonical = canonicalEvidenceRequest(request, evidenceRoot, workspaceRoot)
  return Object.freeze({
    databaseId: githubEvidence.validated.databaseId,
    command: Object.freeze({
      id: request.id,
      kind: 'github',
      commit,
      command: canonical.command,
      cwd: posixRelative(workspaceRoot, request.cwd),
      environment: canonical.environment,
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
      report: reportEvidence(evidenceRoot, reportPath, 'github-run-json'),
      artifacts: Object.freeze(artifacts)
    })
  })
}

async function collectPass(
  options: Readonly<{
    readonly ordinal: 1 | 2
    readonly runId: string
    readonly evidenceRoot: string
    readonly reportRoot: string
    readonly commit: string
    readonly execute: EvidenceCommandExecutor
    readonly pnpmVersion: string
    readonly githubNodeVersion: string
    readonly mount: InstalledArtifactMounter
  }>
): Promise<EvidencePass> {
  const startedAt = new Date().toISOString()
  mkdirSync(options.reportRoot, { recursive: true })
  const workspace = createPassWorkspace(options.evidenceRoot, options.commit)
  const commands: EvidenceCommand[] = []
  const total = FIXED_CHECKS.length + FIXED_TEST_IDS.length + 3
  let completed = 0
  const announce = (id: string): void => {
    console.log(
      `[0009 evidence] pass ${String(options.ordinal)} ` +
        `${String(completed + 1)}/${String(total)}: ${id}`
    )
  }
  let installedArtifact: CollectedInstalledArtifact | undefined
  try {
    const preparationRequest = workspacePreparationRequest(
      workspace.root,
      options.reportRoot,
      options.pnpmVersion
    )
    announce(preparationRequest.id)
    const preparation = await runCheck(
      options.execute,
      preparationRequest,
      options.evidenceRoot,
      workspace.root,
      options.commit,
      options.pnpmVersion
    )
    completed += 1

    announce('installed-artifact-build')
    installedArtifact = await collectInstalledArtifact({
      evidenceRoot: options.evidenceRoot,
      workspaceRoot: workspace.root,
      reportRoot: options.reportRoot,
      commit: options.commit,
      execute: options.execute,
      pnpmVersion: options.pnpmVersion,
      mount: options.mount
    })
    completed += 1

    const github = githubRequest(workspace.root, options.reportRoot, options.runId)
    announce(github.id)
    const githubEvidence = await runGithub(
      options.execute,
      github,
      options.evidenceRoot,
      workspace.root,
      options.commit,
      options.githubNodeVersion
    )
    commands.push(githubEvidence.command)
    completed += 1

    for (const check of FIXED_CHECKS) {
      const request = checkRequest(workspace.root, options.reportRoot, check, options.pnpmVersion)
      announce(request.id)
      commands.push(
        await runCheck(
          options.execute,
          request,
          options.evidenceRoot,
          workspace.root,
          options.commit,
          options.pnpmVersion
        )
      )
      completed += 1
    }

    const vitestVersion = packageVersion(workspace.root, 'node_modules/vitest/package.json')
    const playwrightVersion = packageVersion(
      workspace.root,
      'node_modules/@playwright/test/package.json'
    )
    for (const test of fixedTests(
      {
        executablePath: installedArtifact.executablePath,
        sha256: installedArtifact.evidence.sha256,
        executableSha256: installedArtifact.evidence.executableSha256
      },
      options.commit
    )) {
      const request = testRequest(workspace.root, options.reportRoot, test)
      announce(request.id)
      commands.push(
        await runTest(
          options.execute,
          request,
          options.evidenceRoot,
          workspace.root,
          options.commit,
          test.runner === 'vitest' ? vitestVersion : playwrightVersion
        )
      )
      if (test.id === 'installed') {
        assertInstalledArtifactUnchanged(options.evidenceRoot, installedArtifact)
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
      workspace: workspace.evidence,
      preparation,
      installedArtifact: installedArtifact.evidence,
      commands: Object.freeze(commands),
      surfaces: FIXED_SURFACE_COMMANDS
    })
  } finally {
    installedArtifact?.cleanup()
    workspace.cleanup()
  }
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
  const [firstRunId, secondRunId] = runIds
  if (
    runIds.length !== 2 ||
    firstRunId === undefined ||
    secondRunId === undefined ||
    firstRunId === secondRunId ||
    !runIds.every((id) => /^[1-9]\d*$/.test(id))
  ) {
    throw new Error('Plan 0009 evidence requires exactly two distinct numeric GitHub run ids')
  }
  assert0009EvidenceCollectorRuntime(repoRoot)
  assert0009CandidateState(repoRoot)
  const commit = currentCommit(repoRoot)
  const evidencePath = resolve(repoRoot, 'specs/migration/0009-candidate-evidence.yml')
  const collectionRoot = resolve(
    repoRoot,
    'specs/migration/0009-evidence',
    `${commit.slice(0, 12)}-${Date.now().toString()}-${randomUUID()}`
  )
  assertIgnored(repoRoot, evidencePath)
  assertIgnored(repoRoot, resolve(collectionRoot, 'probe.json'))
  mkdirSync(collectionRoot, { recursive: true })
  assertRepositoryState(repoRoot, commit)

  const execute = options.execute ?? defaultExecute
  const pinnedPnpmVersion = pnpmVersion(repoRoot, commit)
  const shared = {
    evidenceRoot: repoRoot,
    commit,
    execute,
    pnpmVersion: pinnedPnpmVersion,
    githubNodeVersion: githubNodeVersion(repoRoot, commit),
    mount: options.mountInstalledArtifact ?? mountMacDmg
  }
  const first = await collectPass({
    ...shared,
    ordinal: 1,
    runId: firstRunId,
    reportRoot: resolve(collectionRoot, 'pass-1')
  })
  const second = await collectPass({
    ...shared,
    ordinal: 2,
    runId: secondRunId,
    reportRoot: resolve(collectionRoot, 'pass-2')
  })
  validateSequentialGithubRuns(
    githubRunForPass(repoRoot, first),
    githubRunForPass(repoRoot, second)
  )
  if (first.githubRunDatabaseId === second.githubRunDatabaseId) {
    throw new Error('The two evidence passes must ingest distinct GitHub runs')
  }
  if (
    first.workspace.id === second.workspace.id ||
    first.installedArtifact.path === second.installedArtifact.path
  ) {
    throw new Error('The two evidence passes must use distinct workspaces and installed artifacts')
  }
  assertRepositoryState(repoRoot, commit)
  const bundle: EvidenceBundle = Object.freeze({
    schema: 'marktext-0009-candidate-evidence-v8',
    state: 'candidate',
    candidateCommit: commit,
    candidateTree: execFileSync('git', ['rev-parse', `${commit}^{tree}`], {
      cwd: repoRoot,
      encoding: 'utf8'
    }).trim(),
    dirtyState: Object.freeze([]),
    createdAt: new Date().toISOString(),
    criticalControlFileHashes: criticalControlFileHashes(repoRoot, commit),
    runs: Object.freeze([first, second]) as readonly [EvidencePass, EvidencePass]
  })
  mkdirSync(dirname(evidencePath), { recursive: true })
  const pendingEvidencePath = resolve(collectionRoot, 'candidate-evidence.pending.json')
  writeFileSync(pendingEvidencePath, JSON.stringify(bundle, null, 2) + '\n')
  renameSync(pendingEvidencePath, evidencePath)
  assertRepositoryState(repoRoot, commit)
  return bundle
}
