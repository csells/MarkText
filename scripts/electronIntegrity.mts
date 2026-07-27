import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

export const UNTRUSTED_ELECTRON_ENVIRONMENT_KEYS = Object.freeze([
  'electron_install_platform',
  'electron_install_arch',
  'npm_config_platform',
  'npm_config_arch',
  'force_no_cache',
  'electron_config_cache',
  'electron_use_remote_checksums',
  'npm_config_electron_use_remote_checksums',
  'electron_override_dist_path',
  'electron_custom_dir',
  'electron_custom_filename',
  'electron_mirror',
  'electron_nightly_mirror',
  'electron_custom_version',
  'npm_config_electron_custom_dir',
  'npm_config_electron_custom_filename',
  'npm_config_electron_mirror',
  'npm_config_electron_nightly_mirror',
  'npm_config_electron_custom_version',
  'nodejs_org_mirror',
  'npm_config_disturl',
  'npm_config_dist_url',
  'npm_config_tarball',
  'npm_config_nodedir',
  'npm_config_devdir',
  'npm_config_target',
  'npm_config_runtime',
  'npm_config_ensure',
  'npm_package_config_electron_custom_dir',
  'npm_package_config_electron_custom_filename',
  'npm_package_config_electron_mirror',
  'npm_package_config_electron_nightly_mirror',
  'npm_package_config_electron_custom_version'
] as const)

const UNTRUSTED_ELECTRON_ENVIRONMENT_KEY_SET = new Set<string>(
  UNTRUSTED_ELECTRON_ENVIRONMENT_KEYS
)

export function sanitizeElectronEnvironment(
  inherited: Readonly<NodeJS.ProcessEnv>,
  overrides: Readonly<NodeJS.ProcessEnv> = {}
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...inherited, ...overrides }
  for (const key of Object.keys(environment)) {
    const normalizedKey = key.toLowerCase()
    if (
      UNTRUSTED_ELECTRON_ENVIRONMENT_KEY_SET.has(normalizedKey) ||
      normalizedKey.startsWith('npm_package_config_node_gyp_')
    ) {
      delete environment[key]
    }
  }
  return environment
}

export function assertElectronArchiveChecksum(
  archivePath: string,
  expectedSha256: string
): void {
  if (!/^[0-9a-f]{64}$/u.test(expectedSha256)) {
    throw new Error('Electron archive checksum metadata is invalid')
  }

  const hash = createHash('sha256')
  const descriptor = openSync(archivePath, 'r')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  try {
    let bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
    while (bytesRead > 0) {
      hash.update(buffer.subarray(0, bytesRead))
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
    }
  } finally {
    closeSync(descriptor)
  }
  const actualSha256 = hash.digest('hex')
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      'Electron cache archive checksum differs from the committed package identity'
    )
  }
}

export interface StagedElectronArchive {
  readonly path: string
  readonly cleanup: () => void
}

export function stageAuthenticatedElectronArchive(
  sourcePath: string,
  expectedSha256: string
): StagedElectronArchive {
  const stagingRoot = mkdtempSync(join(tmpdir(), 'marktext-electron-'))
  chmodSync(stagingRoot, 0o700)
  const stagedPath = join(stagingRoot, 'electron.zip')
  try {
    copyFileSync(sourcePath, stagedPath, constants.COPYFILE_EXCL)
    chmodSync(stagedPath, 0o600)
    assertElectronArchiveChecksum(stagedPath, expectedSha256)
  } catch (error) {
    rmSync(stagingRoot, { recursive: true, force: true })
    throw error
  }

  let removed = false
  return Object.freeze({
    path: stagedPath,
    cleanup: (): void => {
      if (removed) return
      removed = true
      rmSync(stagingRoot, { recursive: true, force: true })
    }
  })
}

const MAX_ELECTRON_CACHE_ENTRIES = 4096
const MAX_ELECTRON_CACHE_DEPTH = 3

export function findElectronArchive(
  cacheRoot: string,
  archiveName: string
): string | undefined {
  if (basename(archiveName) !== archiveName || archiveName.length === 0) {
    throw new Error('Electron archive name must be one exact file name')
  }
  if (!existsSync(cacheRoot)) return undefined

  const pending: { readonly directory: string; readonly depth: number }[] = [
    { directory: cacheRoot, depth: 0 }
  ]
  let inspectedEntries = 0
  while (pending.length > 0) {
    const current = pending.shift()
    if (current === undefined) break
    const entries = readdirSync(current.directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name)
    )
    inspectedEntries += entries.length
    if (inspectedEntries > MAX_ELECTRON_CACHE_ENTRIES) {
      throw new Error('Electron cache exceeds the bounded archive search budget')
    }

    for (const entry of entries) {
      const candidate = join(current.directory, entry.name)
      if (entry.isFile() && entry.name === archiveName) return candidate
      if (entry.isDirectory() && current.depth < MAX_ELECTRON_CACHE_DEPTH) {
        pending.push({ directory: candidate, depth: current.depth + 1 })
      }
    }
  }
  return undefined
}

export type ElectronArchiveExecutor = (
  executable: string,
  arguments_: readonly string[],
  options: Readonly<{ stdio: 'inherit' }>
) => unknown

export function extractElectronArchive(
  archivePath: string,
  destinationPath: string,
  execute?: ElectronArchiveExecutor
): void {
  const arguments_ = ['-q', archivePath, '-d', destinationPath]
  if (execute !== undefined) {
    execute('unzip', arguments_, { stdio: 'inherit' })
    return
  }
  execFileSync('unzip', arguments_, { stdio: 'inherit' })
}
