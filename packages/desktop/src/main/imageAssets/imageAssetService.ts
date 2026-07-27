import path from 'node:path'
import { createHash, timingSafeEqual } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  stat
} from 'node:fs/promises'
import type {
  ImageAssetMaterializationReceipt,
  ImageAssetInsertRequest,
  ImageAssetMediaType
} from '@shared/types/imageAsset'
import { MAX_IMAGE_ASSET_BYTES } from '@shared/types/imageAsset'

export interface ImageAssetDocumentDescription {
  readonly documentId: string
  readonly filename: string
  readonly pathname: string | null
  readonly projectRoot?: string | null
}

export interface ImageAssetSettings {
  readonly configuredFolderPath: string
  readonly relativeDirectoryName: string
  readonly relativeDirectoryBase?: 'document' | 'project'
}

export interface ImageAssetServiceOptions {
  /**
   * Must authenticate ownership as well as resolve the opaque id. It runs
   * before settings reads or filesystem effects.
   */
  readonly describeDocument: (
    documentId: string
  ) => ImageAssetDocumentDescription
  readonly readSettings: () => ImageAssetSettings
  /**
   * Consume a main-minted, sender-bound source capability. Renderer input can
   * never reach this seam as a pathname.
   */
  readonly resolveNativeSource?: (token: string) => string
  readonly hashBytes?: (bytes: Uint8Array) => Promise<string>
}

export interface ImageAssetService {
  readonly prepare: (
    request: ImageAssetMaterializationRequest
  ) => Promise<PreparedImageAsset>
}

export type ImageAssetMaterializationRequest = Pick<
  ImageAssetInsertRequest,
  'documentId' | 'source' | 'storage'
>

export interface PreparedImageAsset {
  readonly receipt: ImageAssetMaterializationReceipt
  readonly commit: () => void
  readonly rollback: () => Promise<void>
}

export interface VerifiedImage {
  readonly bytes: Uint8Array
  readonly mediaType: ImageAssetMediaType
  readonly extension: string
  readonly originalReference: string | null
}

interface ResolvedDestinationRoot {
  /** Canonical directory used for the exclusive filesystem effect. */
  readonly writeRoot: string
  /** Main-configured lexical directory used in the Markdown reference. */
  readonly referenceRoot: string
}

const EXTENSION_MEDIA_TYPES: Readonly<Record<string, ImageAssetMediaType>> =
  Object.freeze({
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml'
  })
const FILENAME_TOKEN = '$' + '{filename}'

function imageMediaType(bytes: Uint8Array): ImageAssetMediaType | null {
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg'
  }
  if (bytes.byteLength >= 6) {
    const signature = String.fromCharCode(...bytes.subarray(0, 6))
    if (signature === 'GIF87a' || signature === 'GIF89a') {
      return 'image/gif'
    }
  }
  if (
    bytes.byteLength >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (bytes.byteLength >= 5) {
    const prefix = new TextDecoder('utf-8', { fatal: false })
      .decode(bytes.subarray(0, Math.min(bytes.byteLength, 4096)))
      .replace(/^\uFEFF/, '')
      .trimStart()
      .replace(/^<\?xml\b[^>]*>\s*/i, '')
    if (/^<svg(?:\s|>)/i.test(prefix)) return 'image/svg+xml'
  }
  return null
}

function assertSupportedExtension(
  filename: string,
  detected: ImageAssetMediaType
): string {
  const extension = path.extname(filename).toLowerCase()
  const expected = EXTENSION_MEDIA_TYPES[extension]
  if (expected === undefined) {
    throw new TypeError('Image asset has an unsupported extension')
  }
  if (expected !== detected) {
    throw new TypeError('Image asset extension does not match its content')
  }
  return extension
}

function assertBoundedBytes(bytes: Uint8Array): void {
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_IMAGE_ASSET_BYTES
  ) {
    throw new RangeError('Image asset size is outside the supported boundary')
  }
}

export async function readVerifiedImageFile(
  pathname: string
): Promise<VerifiedImage> {
  if (
    pathname.length === 0 ||
    pathname.includes('\0') ||
    !path.isAbsolute(pathname)
  ) {
    throw new TypeError('Image asset source pathname is invalid')
  }
  const absolute = path.resolve(pathname)
  const sourceStats = await stat(absolute)
  if (!sourceStats.isFile()) {
    throw new TypeError('Image asset source is not a regular file')
  }
  if (sourceStats.size === 0 || sourceStats.size > MAX_IMAGE_ASSET_BYTES) {
    throw new RangeError('Image asset size is outside the supported boundary')
  }
  const bytes = new Uint8Array(await readFile(absolute))
  assertBoundedBytes(bytes)
  const detected = imageMediaType(bytes)
  if (detected === null) {
    throw new TypeError('Image asset source content is not a supported image')
  }
  const extension = assertSupportedExtension(absolute, detected)
  return Object.freeze({
    bytes,
    mediaType: detected,
    extension,
    originalReference: absolute
  })
}

function verifyBinaryImage(
  request: Extract<ImageAssetInsertRequest['source'], { kind: 'binary' }>
): VerifiedImage {
  const bytes = new Uint8Array(request.bytes)
  assertBoundedBytes(bytes)
  const detected = imageMediaType(bytes)
  if (detected === null) {
    throw new TypeError('Image asset binary content is not a supported image')
  }
  if (request.mediaType !== detected) {
    throw new TypeError('Image asset declared media type does not match its content')
  }
  const extension = assertSupportedExtension(request.name, detected)
  return Object.freeze({
    bytes,
    mediaType: detected,
    extension,
    originalReference: null
  })
}

function filenameStem(filename: string): string {
  const base = path.basename(filename)
  const extension = path.extname(base)
  const stem = base.slice(0, Math.max(0, base.length - extension.length))
  if (
    stem.length === 0 ||
    stem === '.' ||
    stem === '..' ||
    stem.includes('\0') ||
    stem.includes('/') ||
    stem.includes('\\')
  ) {
    throw new TypeError('Document filename cannot configure an image directory')
  }
  return stem
}

function safeRelativeDirectory(
  configured: string,
  document: ImageAssetDocumentDescription
): readonly string[] {
  if (
    typeof configured !== 'string' ||
    configured.length === 0 ||
    configured.includes('\0') ||
    path.isAbsolute(configured) ||
    /^[a-zA-Z]:[\\/]/.test(configured)
  ) {
    throw new TypeError(
      'Image asset relative directory must be a non-empty relative path'
    )
  }
  const expanded = configured.replaceAll(
    FILENAME_TOKEN,
    filenameStem(document.filename)
  )
  const segments = expanded.split(/[\\/]/)
  if (
    segments.some(segment =>
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('\0')
    )
  ) {
    throw new TypeError(
      'Image asset relative directory contains an unsafe segment'
    )
  }
  return Object.freeze(segments)
}

function pathIsWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (
      !path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`)
    )
  )
}

async function createContainedDirectory(
  retainedBase: string,
  segments: readonly string[]
): Promise<string> {
  const canonicalBase = await realpath(retainedBase)
  const baseStats = await lstat(canonicalBase)
  if (baseStats.isSymbolicLink() || !baseStats.isDirectory()) {
    throw new Error(
      'Document-relative image asset base is not a canonical directory'
    )
  }

  let canonicalParent = canonicalBase
  for (const segment of segments) {
    const parentStats = await lstat(canonicalParent)
    const verifiedParent = await realpath(canonicalParent)
    if (
      parentStats.isSymbolicLink() ||
      !parentStats.isDirectory() ||
      verifiedParent !== canonicalParent ||
      !pathIsWithin(canonicalBase, verifiedParent)
    ) {
      throw new Error(
        'Document-relative image asset directory escapes the document tree'
      )
    }

    const candidate = path.join(canonicalParent, segment)
    try {
      await mkdir(candidate)
    } catch (error) {
      if (
        error === null ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      ) {
        throw error
      }
    }

    const candidateStats = await lstat(candidate)
    if (
      candidateStats.isSymbolicLink() ||
      !candidateStats.isDirectory()
    ) {
      throw new Error(
        'Document-relative image asset directory escapes the document tree'
      )
    }
    const canonicalCandidate = await realpath(candidate)
    if (
      canonicalCandidate === canonicalBase ||
      !pathIsWithin(canonicalBase, canonicalCandidate)
    ) {
      throw new Error(
        'Document-relative image asset directory escapes the document tree'
      )
    }
    canonicalParent = canonicalCandidate
  }
  return canonicalParent
}

async function resolveDestinationRoot(
  document: ImageAssetDocumentDescription,
  request: ImageAssetMaterializationRequest,
  settings: ImageAssetSettings
): Promise<ResolvedDestinationRoot> {
  if (request.storage === 'configured-folder') {
    if (
      typeof settings.configuredFolderPath !== 'string' ||
      settings.configuredFolderPath.length === 0 ||
      settings.configuredFolderPath.includes('\0') ||
      !path.isAbsolute(settings.configuredFolderPath)
    ) {
      throw new TypeError(
        'The configured image asset folder must be an absolute path'
      )
    }
    const configuredRoot = path.resolve(
      settings.configuredFolderPath.replaceAll(
        FILENAME_TOKEN,
        filenameStem(document.filename)
      )
    )
    await mkdir(configuredRoot, { recursive: true })
    return Object.freeze({
      writeRoot: await realpath(configuredRoot),
      referenceRoot: configuredRoot
    })
  }

  if (document.pathname === null) {
    throw new Error(
      'Document-relative image storage requires a persisted document path'
    )
  }
  const documentDirectory = path.dirname(path.resolve(document.pathname))
  let retainedBase = documentDirectory
  if (
    settings.relativeDirectoryBase === 'project' &&
    document.projectRoot !== null &&
    document.projectRoot !== undefined
  ) {
    if (
      document.projectRoot.length === 0 ||
      document.projectRoot.includes('\0') ||
      !path.isAbsolute(document.projectRoot)
    ) {
      throw new TypeError('Image asset project root must be an absolute path')
    }
    const projectRoot = path.resolve(document.projectRoot)
    const [canonicalProjectRoot, canonicalDocumentDirectory] =
      await Promise.all([
        realpath(projectRoot),
        realpath(documentDirectory)
      ])
    if (pathIsWithin(canonicalProjectRoot, canonicalDocumentDirectory)) {
      retainedBase = projectRoot
    }
  }
  const segments = safeRelativeDirectory(
    settings.relativeDirectoryName,
    document
  )
  const requestedRoot = path.join(retainedBase, ...segments)
  const canonicalRoot = await createContainedDirectory(
    retainedBase,
    segments
  )
  return Object.freeze({
    writeRoot: canonicalRoot,
    referenceRoot: requestedRoot
  })
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  )
}

function collisionError(pathname: string): Error & { code: string } {
  const error = new Error(
    `Image asset content-address collision at ${pathname}`
  ) as Error & { code: string }
  error.code = 'IMAGE_ASSET_COLLISION'
  return error
}

async function writeExclusiveOrReuse(
  pathname: string,
  bytes: Uint8Array
): Promise<'stored' | 'reused'> {
  let handle
  try {
    handle = await open(pathname, 'wx')
  } catch (error) {
    if (
      error === null ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'EEXIST'
    ) {
      throw error
    }
    const existingStats = await lstat(pathname)
    if (
      !existingStats.isFile() ||
      existingStats.isSymbolicLink() ||
      existingStats.size !== bytes.byteLength
    ) {
      throw collisionError(pathname)
    }
    const existing = new Uint8Array(await readFile(pathname))
    if (!equalBytes(existing, bytes)) throw collisionError(pathname)
    return 'reused'
  }

  try {
    await handle.writeFile(bytes)
    await handle.sync()
    return 'stored'
  } catch (error) {
    try {
      await handle.close()
    } finally {
      await rm(pathname, { force: true })
    }
    throw error
  } finally {
    await handle.close().catch(() => {})
  }
}

function defaultHashBytes(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(
    createHash('sha256').update(bytes).digest('hex')
  )
}

interface DestinationLease {
  leases: number
  committed: boolean
}

const destinationOperations = new Map<string, Promise<void>>()
const destinationLeases = new Map<string, DestinationLease>()

async function serializeDestination<T>(
  pathname: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = destinationOperations.get(pathname) ?? Promise.resolve()
  let release = (): void => {}
  const pending = new Promise<void>(resolve => {
    release = resolve
  })
  const queued = previous.then(() => pending)
  destinationOperations.set(pathname, queued)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (destinationOperations.get(pathname) === queued) {
      destinationOperations.delete(pathname)
    }
  }
}

function acquireDestinationLease(
  pathname: string,
  kind: 'stored' | 'reused'
): DestinationLease | null {
  const existing = destinationLeases.get(pathname)
  if (kind === 'stored') {
    if (existing !== undefined) {
      throw new Error('Stored image destination already has a lease')
    }
    const created: DestinationLease = {
      leases: 1,
      committed: false
    }
    destinationLeases.set(pathname, created)
    return created
  }
  if (existing === undefined) return null
  existing.leases += 1
  return existing
}

function releaseDestinationLease(
  pathname: string,
  lease: DestinationLease | null,
  committed: boolean
): boolean {
  if (lease === null) return false
  if (committed) lease.committed = true
  lease.leases -= 1
  if (lease.leases < 0) {
    throw new Error('Image destination lease was released more than once')
  }
  if (lease.leases > 0) return false
  if (destinationLeases.get(pathname) !== lease) {
    throw new Error('Image destination lease identity changed')
  }
  destinationLeases.delete(pathname)
  return !lease.committed
}

function safeContentId(value: string): string {
  if (
    value.length === 0 ||
    value.length > 128 ||
    !/^[a-zA-Z0-9_-]+$/.test(value)
  ) {
    throw new TypeError('Image asset content id is not a safe filename')
  }
  return value
}

export function createImageAssetService({
  describeDocument,
  readSettings,
  resolveNativeSource = () => {
    throw new Error('No native image source capability authority is installed')
  },
  hashBytes = defaultHashBytes
}: ImageAssetServiceOptions): ImageAssetService {
  const prepare = async(
    request: ImageAssetMaterializationRequest
  ): Promise<PreparedImageAsset> => {
    // Ownership/authenticity is the first observable operation.
    const document = describeDocument(request.documentId)
    if (document.documentId !== request.documentId) {
      throw new Error('Image asset document resolver returned another identity')
    }

    const verified = request.source.kind === 'native-capability'
      ? await readVerifiedImageFile(resolveNativeSource(request.source.token))
      : verifyBinaryImage(request.source)

    if (request.storage === 'reference') {
      if (verified.originalReference === null) {
        throw new TypeError('Binary image assets cannot use reference storage')
      }
      const receipt = Object.freeze({
        schema: 'image-asset-receipt-1',
        kind: 'referenced',
        documentId: document.documentId,
        reference: verified.originalReference,
        mediaType: verified.mediaType,
        byteLength: verified.bytes.byteLength
      })
      return Object.freeze({
        receipt,
        commit: () => {},
        rollback: () => Promise.resolve()
      })
    }

    const settings = readSettings()
    const destinationRoot = await resolveDestinationRoot(
      document,
      request,
      settings
    )
    const contentId = safeContentId(await hashBytes(verified.bytes))
    const destination = path.join(
      destinationRoot.writeRoot,
      `${contentId}${verified.extension}`
    )
    const { kind, lease } = await serializeDestination(
      destination,
      async() => {
        const kind = await writeExclusiveOrReuse(
          destination,
          verified.bytes
        )
        return Object.freeze({
          kind,
          lease: acquireDestinationLease(destination, kind)
        })
      }
    )
    const referencePath = path.join(
      destinationRoot.referenceRoot,
      `${contentId}${verified.extension}`
    )
    let reference = referencePath
    if (request.storage === 'document-relative') {
      if (document.pathname === null) {
        throw new Error(
          'Document-relative image receipt requires a persisted document path'
        )
      }
      reference = path.relative(
        path.dirname(path.resolve(document.pathname)),
        referencePath
      ).split(path.sep).join('/')
    }

    const receipt = Object.freeze({
      schema: 'image-asset-receipt-1',
      kind,
      documentId: document.documentId,
      reference,
      mediaType: verified.mediaType,
      byteLength: verified.bytes.byteLength
    })
    let terminal = false
    return Object.freeze({
      receipt,
      commit: () => {
        if (terminal) return
        terminal = true
        releaseDestinationLease(destination, lease, true)
      },
      rollback: async() => {
        if (terminal) return
        terminal = true
        await serializeDestination(destination, async() => {
          if (releaseDestinationLease(destination, lease, false)) {
            await rm(destination, { force: true })
          }
        })
      }
    })
  }

  return Object.freeze({ prepare })
}
