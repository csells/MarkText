import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  extractElectronArchive,
  findElectronArchive,
  sanitizeElectronEnvironment,
  stageAuthenticatedElectronArchive
} from './electronIntegrity.mjs'

/**
 * Stage the packaging target's Electron dist under a script-owned cache so
 * electron-builder never resolves Electron itself. Every byte that lands in
 * the staged dist is authenticated against the committed package identity
 * (electron/checksums.json at the pinned version): a cached archive is
 * re-hashed before extraction, and a cache miss downloads through
 * @electron/get with the committed checksums object, so no remote SHASUMS
 * authority is ever consulted.
 */

const SUPPORTED_TARGETS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    darwin: Object.freeze(['arm64', 'x64']),
    win32: Object.freeze(['arm64', 'x64']),
    linux: Object.freeze(['x64'])
  })

const repoRoot = resolve(import.meta.dirname, '..')
const desktopRoot = resolve(repoRoot, 'packages/desktop')
const stagedDistRoot = resolve(
  repoRoot,
  'node_modules/.cache/marktext-electron-dist'
)

const require = createRequire(join(desktopRoot, 'package.json'))

function electronCacheRoot(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'electron')
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData === undefined || localAppData.length === 0) {
      throw new Error('LOCALAPPDATA is required to locate the Electron cache')
    }
    return join(localAppData, 'electron', 'Cache')
  }
  const xdgCache = process.env.XDG_CACHE_HOME
  const cacheHome = xdgCache !== undefined && xdgCache.length > 0
    ? xdgCache
    : join(homedir(), '.cache')
  return join(cacheHome, 'electron')
}

export async function stageElectronDist(
  targetPlatform: string,
  targetArch: string
): Promise<void> {
  const supportedArches = SUPPORTED_TARGETS[targetPlatform]
  if (supportedArches === undefined || !supportedArches.includes(targetArch)) {
    throw new Error(
      `Unsupported Electron staging target: ${targetPlatform}/${targetArch}`
    )
  }

  process.env = sanitizeElectronEnvironment(process.env)

  const { version } = require('electron/package.json') as {
    readonly version: string
  }
  const checksums = require('electron/checksums.json') as
    Readonly<Record<string, string>>
  const archiveName = `electron-v${version}-${targetPlatform}-${targetArch}.zip`
  const expectedSha256 = checksums[archiveName]
  if (expectedSha256 === undefined) {
    throw new Error(
      `The committed package identity carries no checksum for ${archiveName}`
    )
  }

  let archivePath = findElectronArchive(electronCacheRoot(), archiveName)
  if (archivePath === undefined) {
    // Cache miss: download through @electron/get with the COMMITTED checksums
    // object, the same contract electron/install.js uses — the remote
    // SHASUMS256.txt is never an authority.
    const { downloadArtifact } = require('@electron/get') as {
      downloadArtifact: (options: {
        version: string
        artifactName: string
        platform: string
        arch: string
        checksums: Readonly<Record<string, string>>
      }) => Promise<string>
    }
    archivePath = await downloadArtifact({
      version,
      artifactName: 'electron',
      platform: targetPlatform,
      arch: targetArch,
      checksums
    })
  }

  // Independent byte-level re-verification of whatever the cache or the
  // download produced, staged in a private location so nothing can swap the
  // archive between the hash and the extraction.
  const staged = stageAuthenticatedElectronArchive(archivePath, expectedSha256)
  try {
    // A script-owned build cache, never user data.
    rmSync(stagedDistRoot, { recursive: true, force: true })
    mkdirSync(stagedDistRoot, { recursive: true })
    extractElectronArchive(staged.path, stagedDistRoot)
    writeFileSync(join(stagedDistRoot, 'version'), `v${version}`)
  } finally {
    staged.cleanup()
  }
  console.log(
    `Staged authenticated Electron v${version} ` +
    `(${targetPlatform}/${targetArch}) at ${stagedDistRoot}`
  )
}

const entryPath = process.argv[1]
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  const targetPlatformArgument = process.argv
    .slice(2)
    .find(argument => argument.startsWith('--target-platform='))
  const targetArchArgument = process.argv
    .slice(2)
    .find(argument => argument.startsWith('--target-arch='))
  const targetPlatform = targetPlatformArgument?.slice('--target-platform='.length)
  const targetArch = targetArchArgument?.slice('--target-arch='.length)
  if (
    process.argv.length !== 4 ||
    targetPlatform === undefined ||
    targetArch === undefined
  ) {
    throw new Error(
      'Electron staging requires exactly one --target-platform/--target-arch pair'
    )
  }
  stageElectronDist(targetPlatform, targetArch).catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
