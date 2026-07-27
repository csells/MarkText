import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export interface BackgroundSourceFile {
  path: string
  contents: string | Uint8Array
}

export interface BackgroundOutputFile {
  path: string
  contents: Uint8Array
}

export interface BackgroundBuildManifest {
  version: 2
  sourceFingerprint: string
  outputFingerprint: string
}

export interface BackgroundBuildFreshness {
  currentSourceFingerprint: string
  currentOutputFingerprint: string
  manifest: BackgroundBuildManifest
  outputPath: string
}

export const BACKGROUND_BUILD_MANIFEST = 'background-source-fingerprint.json'

const REQUIRED_OUTPUT_FILES = [
  'main/index.js',
  'main/documentSessionWorker.js',
  'preload/index.js',
  'renderer/index.html'
] as const

const normalizedPath = (filePath: string): string => filePath.replaceAll('\\', '/')

const updateFingerprint = (
  hash: ReturnType<typeof createHash>,
  filePath: string,
  contents: string | Uint8Array
): void => {
  const normalized = normalizedPath(filePath)
  hash.update(String(Buffer.byteLength(normalized)))
  hash.update(':')
  hash.update(normalized)
  hash.update(':')
  hash.update(String(typeof contents === 'string'
    ? Buffer.byteLength(contents)
    : contents.byteLength))
  hash.update(':')
  hash.update(contents)
  hash.update('\n')
}

export const computeBackgroundSourceFingerprint = (
  files: readonly BackgroundSourceFile[]
): string => {
  const hash = createHash('sha256')
  const ordered = files
    .map((file) => ({ ...file, path: normalizedPath(file.path) }))
    .sort((left, right) => left.path.localeCompare(right.path))

  for (const file of ordered) updateFingerprint(hash, file.path, file.contents)
  return hash.digest('hex')
}

export const computeBackgroundOutputFingerprint = (
  files: readonly BackgroundOutputFile[]
): string => {
  const hash = createHash('sha256')
  const ordered = files
    .map((file) => ({ ...file, path: normalizedPath(file.path) }))
    .sort((left, right) => left.path.localeCompare(right.path))

  for (const file of ordered) updateFingerprint(hash, file.path, file.contents)
  return hash.digest('hex')
}

export const assertBackgroundBuildFresh = ({
  currentSourceFingerprint,
  currentOutputFingerprint,
  manifest,
  outputPath
}: BackgroundBuildFreshness): void => {
  if (currentSourceFingerprint !== manifest.sourceFingerprint) {
    throw new Error(
      `Stale background-test sources for ${outputPath}; build the desktop app after ` +
      'changing desktop or editor source.'
    )
  }
  if (currentOutputFingerprint !== manifest.outputFingerprint) {
    throw new Error(
      `Modified or incomplete background-test output at ${outputPath}; build the desktop app again.`
    )
  }
}

const collectBuildInputFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : collectBuildInputFiles(fullPath)
    }
    if (/\.(?:spec|test)\.[^.]+$/.test(entry.name)) return []
    return entry.isFile() ? [fullPath] : []
  })

export const readBackgroundSourceFiles = (
  projectRoot: string
): BackgroundSourceFile[] => {
  const sourcePaths = [
    ...collectBuildInputFiles(path.join(projectRoot, 'src')),
    ...collectBuildInputFiles(path.resolve(projectRoot, '../document-core/src')),
    ...collectBuildInputFiles(path.resolve(projectRoot, '../document-view/src')),
    path.join(projectRoot, 'build/backgroundBuild.ts'),
    path.join(projectRoot, 'build/buildDesktop.ts'),
    path.join(projectRoot, 'electron.vite.config.ts'),
    path.join(projectRoot, 'package.json'),
    path.join(projectRoot, 'tsconfig.json'),
    path.join(projectRoot, 'tsconfig.base.json'),
    path.resolve(projectRoot, '../document-core/package.json'),
    path.resolve(projectRoot, '../document-core/tsconfig.json'),
    path.resolve(projectRoot, '../document-core/tsconfig.build.json'),
    path.resolve(projectRoot, '../document-view/package.json'),
    path.resolve(projectRoot, '../document-view/tsconfig.json'),
    path.resolve(projectRoot, '../../package.json'),
    path.resolve(projectRoot, '../../pnpm-workspace.yaml'),
    path.resolve(projectRoot, '../../.npmrc'),
    path.resolve(projectRoot, '../../pnpm-lock.yaml')
  ]
  return sourcePaths.map((filePath) => ({
    path: path.relative(projectRoot, filePath),
    contents: fs.readFileSync(filePath)
  }))
}

export const currentBackgroundSourceFingerprint = (
  projectRoot: string
): string => computeBackgroundSourceFingerprint(readBackgroundSourceFiles(projectRoot))

const collectOutputFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectOutputFiles(fullPath)
    return entry.isFile() ? [fullPath] : []
  })

export const readBackgroundOutputFiles = (
  projectRoot: string
): BackgroundOutputFile[] => {
  const outputRoot = path.join(projectRoot, 'out')
  const manifestRelativePath = normalizedPath(path.join('main', BACKGROUND_BUILD_MANIFEST))
  const outputFiles = fs.existsSync(outputRoot)
    ? collectOutputFiles(outputRoot)
      .map((filePath) => ({
        path: normalizedPath(path.relative(outputRoot, filePath)),
        contents: fs.readFileSync(filePath)
      }))
      .filter((file) => file.path !== manifestRelativePath)
    : []
  const available = new Set(outputFiles.map((file) => file.path))

  for (const requiredPath of REQUIRED_OUTPUT_FILES) {
    if (!available.has(requiredPath)) {
      throw new Error(
        `Background build output is missing ${path.join(outputRoot, requiredPath)}; ` +
        'build the desktop app.'
      )
    }
  }
  return outputFiles
}

export const currentBackgroundOutputFingerprint = (
  projectRoot: string
): string => computeBackgroundOutputFingerprint(readBackgroundOutputFiles(projectRoot))

const manifestPath = (projectRoot: string): string =>
  path.join(projectRoot, 'out/main', BACKGROUND_BUILD_MANIFEST)

export const writeBackgroundBuildManifest = (
  projectRoot: string,
  expectedSourceFingerprint: string
): void => {
  const currentSourceFingerprint = currentBackgroundSourceFingerprint(projectRoot)
  if (currentSourceFingerprint !== expectedSourceFingerprint) {
    throw new Error(
      'Desktop or editor source changed while the desktop app was building; rebuild before testing.'
    )
  }

  const manifest: BackgroundBuildManifest = {
    version: 2,
    sourceFingerprint: expectedSourceFingerprint,
    outputFingerprint: currentBackgroundOutputFingerprint(projectRoot)
  }
  const outputPath = manifestPath(projectRoot)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export const readBackgroundBuildManifest = (
  projectRoot: string
): BackgroundBuildManifest => {
  const outputPath = manifestPath(projectRoot)
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
  } catch (error) {
    throw new Error(
      `Background build manifest is missing or invalid at ${outputPath}; build the desktop app.`,
      { cause: error }
    )
  }

  const candidate = parsed as Partial<BackgroundBuildManifest> | null
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    candidate.version !== 2 ||
    typeof candidate.sourceFingerprint !== 'string' ||
    candidate.sourceFingerprint.length === 0 ||
    typeof candidate.outputFingerprint !== 'string' ||
    candidate.outputFingerprint.length === 0
  ) {
    throw new Error(
      `Background build manifest has an unsupported shape at ${outputPath}; build the desktop app.`
    )
  }
  return candidate as BackgroundBuildManifest
}

export const assertCurrentBackgroundBuildFresh = (projectRoot: string): void => {
  assertBackgroundBuildFresh({
    currentSourceFingerprint: currentBackgroundSourceFingerprint(projectRoot),
    currentOutputFingerprint: currentBackgroundOutputFingerprint(projectRoot),
    manifest: readBackgroundBuildManifest(projectRoot),
    outputPath: path.join(projectRoot, 'out')
  })
}
