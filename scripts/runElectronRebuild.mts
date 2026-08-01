import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sanitizeElectronEnvironment } from './electronIntegrity.mjs'

export interface PinnedElectronHeaderArtifact {
  readonly path: string
  readonly sha256: string
  readonly maximumBytes: number
}

export const PINNED_ELECTRON_HEADER_ARTIFACTS = Object.freeze({
  version: '42.1.0',
  headers: Object.freeze({
    path: 'node-v42.1.0-headers.tar.gz',
    sha256: '0cfc1d20f252d6c29bdd14b1f3caa30edc6477db93e5a6620674424b38dcddfd',
    maximumBytes: 2_000_000
  }),
  windows: Object.freeze({
    x64: Object.freeze({
      path: 'win-x64/node.lib',
      sha256: 'f2ba9d9c6211b723c9ccce54144e6cd5eaec00cacfe4cfb4df40247a4fedace1',
      maximumBytes: 4_000_000
    }),
    arm64: Object.freeze({
      path: 'win-arm64/node.lib',
      sha256: '565449702d7afd974faddf6da9387897c8fc7a87d890ccd4c9a6c641fa65b59a',
      maximumBytes: 4_000_000
    })
  })
} as const)

export function authenticateElectronHeaderArtifact(
  artifact: PinnedElectronHeaderArtifact,
  bytes: Uint8Array
): Buffer {
  if (bytes.byteLength > artifact.maximumBytes) {
    throw new Error(`Electron header artifact exceeds its pinned size budget: ${artifact.path}`)
  }
  if (!/^[0-9a-f]{64}$/u.test(artifact.sha256)) {
    throw new Error(`Electron header artifact has invalid checksum metadata: ${artifact.path}`)
  }
  const authenticated = Buffer.from(bytes)
  const actualSha256 = createHash('sha256').update(authenticated).digest('hex')
  if (actualSha256 !== artifact.sha256) {
    throw new Error(`Electron header artifact checksum mismatch: ${artifact.path}`)
  }
  return authenticated
}

export function electronRebuildArguments(
  headerBaseUrl: string,
  targetArch: string
): readonly string[] {
  const parsed = new URL(headerBaseUrl)
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.port.length === 0 ||
    parsed.pathname !== '/headers' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new Error('Electron rebuild headers must come from the authenticated loopback proxy')
  }
  if (!['arm64', 'x64'].includes(targetArch)) {
    throw new Error(`Electron rebuild rejects unsupported architecture: ${targetArch}`)
  }
  return Object.freeze([
    '-f',
    '--build-from-source',
    '--dist-url',
    parsed.href,
    `--arch=${targetArch}`
  ])
}

export type HeaderArtifactFetcher = (
  url: string,
  maximumBytes: number
) => Promise<Uint8Array>

export async function fetchBoundedElectronHeaderBytes(
  url: string,
  maximumBytes: number
): Promise<Uint8Array> {
  // Hosted-runner downloads drop transiently mid-body; one bounded retry
  // absorbs the flake while the checksum pins still authenticate the bytes.
  // Policy rejections (non-HTTPS, size budget) throw plain Errors and must
  // fail immediately; transient network failures surface as TypeError or
  // an abort/timeout name.
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetchBoundedElectronHeaderBytesOnce(url, maximumBytes)
    } catch (error) {
      const transient = error instanceof TypeError ||
        (error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError'))
      if (!transient || attempt >= 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 5_000))
    }
  }
}

async function fetchBoundedElectronHeaderBytesOnce(
  url: string,
  maximumBytes: number
): Promise<Uint8Array> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000)
  })
  if (!response.ok || new URL(response.url).protocol !== 'https:') {
    throw new Error(`Electron header artifact download failed: ${url}`)
  }
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`Electron header artifact exceeds its pinned size budget: ${url}`)
  }
  if (response.body === null) {
    throw new Error(`Electron header artifact download returned no body: ${url}`)
  }

  const chunks: Buffer[] = []
  let receivedBytes = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      receivedBytes += result.value.byteLength
      if (receivedBytes > maximumBytes) {
        throw new Error(`Electron header artifact exceeds its pinned size budget: ${url}`)
      }
      chunks.push(Buffer.from(result.value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, receivedBytes)
}

const SUPPORTED_ELECTRON_REBUILD_TARGETS: Readonly<
  Partial<Record<NodeJS.Platform, readonly string[]>>
> = Object.freeze({
  darwin: Object.freeze(['arm64', 'x64']),
  linux: Object.freeze(['x64']),
  win32: Object.freeze(['arm64', 'x64'])
})

export function electronHeaderArtifactsFor(
  version: string,
  targetPlatform: NodeJS.Platform,
  targetArch: string
): readonly PinnedElectronHeaderArtifact[] {
  if (version !== PINNED_ELECTRON_HEADER_ARTIFACTS.version) {
    throw new Error(`Electron ${version} has no committed native-header identity`)
  }
  if (!SUPPORTED_ELECTRON_REBUILD_TARGETS[targetPlatform]?.includes(targetArch)) {
    throw new Error(
      `${targetPlatform} ${targetArch} is outside the Electron native-build allowlist`
    )
  }
  const artifacts: PinnedElectronHeaderArtifact[] = [PINNED_ELECTRON_HEADER_ARTIFACTS.headers]
  if (targetPlatform === 'win32') {
    artifacts.push(
      PINNED_ELECTRON_HEADER_ARTIFACTS.windows[
        targetArch as keyof typeof PINNED_ELECTRON_HEADER_ARTIFACTS.windows
      ]
    )
  }
  return Object.freeze(artifacts)
}

export interface AuthenticatedElectronHeaderProxy {
  readonly url: string
  readonly assertConsumed: () => void
  readonly close: () => Promise<void>
}

export async function startAuthenticatedElectronHeaderProxyFromArtifacts(
  version: string,
  artifacts: readonly PinnedElectronHeaderArtifact[],
  fetchArtifact: HeaderArtifactFetcher
): Promise<AuthenticatedElectronHeaderProxy> {
  if (!/^\d+\.\d+\.\d+$/u.test(version) || artifacts.length === 0) {
    throw new Error('Electron header proxy requires one exact semantic version and artifact set')
  }
  for (const artifact of artifacts) {
    if (
      !/^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/u.test(artifact.path) ||
      artifact.path.split('/').includes('..')
    ) {
      throw new Error(`Electron header proxy rejects an unsafe route: ${artifact.path}`)
    }
  }
  const authenticated = await Promise.all(
    artifacts.map(async artifact => {
      const url =
        `https://www.electronjs.org/headers/v${version}/` + artifact.path
      const bytes = await fetchArtifact(url, artifact.maximumBytes)
      return Object.freeze({
        artifact,
        bytes: authenticateElectronHeaderArtifact(artifact, bytes)
      })
    })
  )
  const prefix = `/headers/v${version}/`
  const routes = new Map<string, Buffer>()
  for (const item of authenticated) {
    routes.set(prefix + item.artifact.path, item.bytes)
  }
  routes.set(
    `${prefix}SHASUMS256.txt`,
    Buffer.from(
      authenticated
        .map((item) => `${item.artifact.sha256}  ${item.artifact.path}`)
        .join('\n') + '\n'
    )
  )
  const servedRoutes = new Set<string>()

  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url === undefined) {
      response.writeHead(405).end()
      return
    }
    const route = request.url
    const body = routes.get(route)
    if (body === undefined) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, {
      'content-length': body.byteLength,
      'content-type': 'application/octet-stream'
    })
    servedRoutes.add(route)
    response.end(body)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('Authenticated Electron header proxy has no loopback address')
  }

  return Object.freeze({
    url: `http://127.0.0.1:${address.port}/headers`,
    assertConsumed: (): void => {
      for (const route of routes.keys()) {
        if (!servedRoutes.has(route)) {
          throw new Error(`Electron rebuild did not consume authenticated input: ${route}`)
        }
      }
    },
    close: (): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
  })
}

async function startAuthenticatedElectronHeaderProxy(
  version: string,
  targetPlatform: NodeJS.Platform,
  targetArch: string
): Promise<AuthenticatedElectronHeaderProxy> {
  return startAuthenticatedElectronHeaderProxyFromArtifacts(
    version,
    electronHeaderArtifactsFor(version, targetPlatform, targetArch),
    fetchBoundedElectronHeaderBytes
  )
}

async function spawnChecked(
  executable: string,
  arguments_: readonly string[],
  options: Readonly<{
    cwd: string
    env: NodeJS.ProcessEnv
  }>
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) resolve()
      else reject(new Error(`Electron rebuild failed with code ${String(code)}`))
    })
  })
}

export async function runElectronRebuild(
  targetPlatform: NodeJS.Platform = process.platform,
  targetArch: string = process.arch
): Promise<void> {
  const repoRoot = resolve(import.meta.dirname, '..')
  const desktopRoot = resolve(repoRoot, 'packages/desktop')
  const electronManifest = JSON.parse(
    readFileSync(resolve(desktopRoot, 'node_modules/electron/package.json'), 'utf8')
  ) as { readonly version?: unknown }
  if (typeof electronManifest.version !== 'string') {
    throw new Error('Installed Electron package has no version identity')
  }
  if (targetPlatform !== process.platform) {
    throw new Error(
      `Electron native rebuild cannot target ${targetPlatform} from ${process.platform}`
    )
  }

  const headerServer = await startAuthenticatedElectronHeaderProxy(
    electronManifest.version,
    targetPlatform,
    targetArch
  )
  const nativeBuildHome = mkdtempSync(join(tmpdir(), 'marktext-native-build-'))
  chmodSync(nativeBuildHome, 0o700)
  try {
    const rebuildCli = resolve(
      desktopRoot,
      'node_modules/@electron/rebuild/lib/cli.js'
    )
    const environment = sanitizeElectronEnvironment(process.env)
    environment.HOME = nativeBuildHome
    environment.USERPROFILE = nativeBuildHome
    // Hosted runners lose the node-gyp fetch transiently (undici's range
    // resumption against a CDN that rejects it); one bounded retry absorbs
    // that flake without masking a persistent rebuild failure.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await spawnChecked(
          process.execPath,
          [rebuildCli, ...electronRebuildArguments(headerServer.url, targetArch)],
          { cwd: desktopRoot, env: environment }
        )
        headerServer.assertConsumed()
        break
      } catch (error) {
        if (attempt >= 2) throw error
        await new Promise((resolve) => setTimeout(resolve, 5_000))
      }
    }
  } finally {
    try {
      await headerServer.close()
    } finally {
      rmSync(nativeBuildHome, { recursive: true, force: true, maxRetries: 3 })
    }
  }
}

const entryPath = process.argv[1]
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  const targetPlatformArgument = process.argv
    .slice(2)
    .find(argument => argument.startsWith('--target-platform='))
  const targetArchArgument = process.argv
    .slice(2)
    .find(argument => argument.startsWith('--target-arch='))
  const targetPlatform = targetPlatformArgument?.slice('--target-platform='.length)
  const targetArch = targetArchArgument?.slice('--target-arch='.length)
  const argumentsAreComplete =
    process.argv.length === 2 ||
    (process.argv.length === 4 && targetPlatform !== undefined && targetArch !== undefined)
  if (!argumentsAreComplete) {
    throw new Error(
      'Electron rebuild accepts only one explicit --target-platform/--target-arch pair'
    )
  }
  runElectronRebuild(targetPlatform as NodeJS.Platform | undefined, targetArch).catch(
    (error: unknown) => {
      console.error(error)
      process.exitCode = 1
    }
  )
}
