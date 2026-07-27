import path from 'node:path'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import {
  access,
  mkdtemp,
  realpath,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import {
  MAX_IMAGE_ASSET_BYTES,
  type ImageAssetMediaType
} from '../../shared/types/imageAsset'
import type {
  UploaderAvailabilityReceipt,
  UploaderAvailabilityRequest,
  UploaderUploadReceipt,
  UploaderUploadRequest
} from '../../shared/types/uploader'
import type {
  UploaderDeletionClipboardCapability
} from '../../shared/types/clipboardTransactions'

export interface UploaderDocumentDescription {
  readonly documentId: string
  readonly pathname: string | null
}

export type UploaderSettings =
  | Readonly<{ readonly kind: 'picgo' }>
  | Readonly<{
    readonly kind: 'custom-cli'
    readonly executablePath: string
  }>

export interface UploaderExecutionResult {
  readonly stdout: string
  readonly stderr: string
}

export interface UploaderServiceOptions {
  readonly describeDocument: (
    documentId: string
  ) => UploaderDocumentDescription
  readonly readSettings: () => UploaderSettings
  readonly resolvePicgoExecutable?: () => Promise<string | null>
  readonly executeFile?: (
    executablePath: string,
    args: readonly string[]
  ) => Promise<UploaderExecutionResult>
  readonly retainDeletionUrl?: (
    deletionUrl: string
  ) => UploaderDeletionClipboardCapability
  readonly temporaryRoot?: string
}

export interface UploaderService {
  readonly upload: (
    request: UploaderUploadRequest
  ) => Promise<UploaderUploadReceipt>
}

const ANSI_SGR_RE = /\x1b\[[0-9;]*m/g // eslint-disable-line no-control-regex
const EXTENSION_MEDIA_TYPES: Readonly<Record<string, ImageAssetMediaType>> =
  Object.freeze({
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml'
  })

function uploaderExecutionEnvironment(): NodeJS.ProcessEnv {
  const pathEntries = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(entry => entry.length > 0)
  const requiredEntries = process.platform === 'darwin'
    ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
    : process.platform === 'linux'
      ? ['/usr/local/bin', '/usr/bin', '/bin']
      : []
  return {
    ...process.env,
    PATH: [...new Set([...pathEntries, ...requiredEntries])]
      .join(path.delimiter)
  }
}

function defaultExecuteFile(
  executablePath: string,
  args: readonly string[]
): Promise<UploaderExecutionResult> {
  return new Promise((resolve, reject) => {
    execFile(
      executablePath,
      [...args],
      {
        env: uploaderExecutionEnvironment(),
        maxBuffer: 1024 * 1024,
        timeout: 120_000
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(error)
          return
        }
        resolve(Object.freeze({
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? '')
        }))
      }
    )
  })
}

export async function verifyUploaderExecutable(
  pathname: string
): Promise<string> {
  if (
    pathname.length === 0 ||
    pathname.includes('\0') ||
    !path.isAbsolute(pathname)
  ) {
    throw new TypeError('Uploader executable path must be absolute')
  }
  const canonical = await realpath(pathname)
  const metadata = await stat(canonical)
  if (!metadata.isFile()) {
    throw new TypeError('Uploader executable must be a regular file')
  }
  if (
    process.platform === 'win32' &&
    !['.com', '.exe'].includes(path.extname(canonical).toLowerCase())
  ) {
    throw new TypeError(
      'Uploader executable must be a directly executable Windows file'
    )
  }
  await access(canonical, constants.X_OK)
  return canonical
}

export interface PicgoExecutableResolutionOptions {
  readonly pathEnvironment?: string
  readonly includeStandardLocations?: boolean
  readonly homeDirectory?: string
}

export async function resolveMainPicgoExecutable({
  pathEnvironment = process.env.PATH ?? '',
  includeStandardLocations = true,
  homeDirectory = homedir()
}: PicgoExecutableResolutionOptions = {}): Promise<string | null> {
  const executableNames = process.platform === 'win32'
    ? ['picgo.exe', 'picgo']
    : ['picgo']
  const candidates: string[] = []
  for (const directory of pathEnvironment.split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue
    for (const name of executableNames) {
      candidates.push(path.join(directory, name))
    }
  }
  if (includeStandardLocations && process.platform !== 'win32') {
    candidates.push(
      '/opt/homebrew/bin/picgo',
      '/usr/local/bin/picgo',
      '/usr/bin/picgo',
      path.join(homeDirectory, '.npm-global', 'bin', 'picgo'),
      path.join(homeDirectory, '.npm', 'bin', 'picgo'),
      '/usr/local/lib/node_modules/.bin/picgo'
    )
  }

  for (const candidate of new Set(candidates)) {
    try {
      return await verifyUploaderExecutable(candidate)
    } catch {
      // Continue through the finite, main-owned candidate list.
    }
  }
  return null
}

export async function inspectUploaderAvailability(
  request: UploaderAvailabilityRequest,
  readSettings: () => UploaderSettings,
  resolvePicgoExecutable: () => Promise<string | null> =
  resolveMainPicgoExecutable
): Promise<UploaderAvailabilityReceipt> {
  const configured = verifiedSettings(readSettings())
  const configuredPath = request.kind !== configured.kind
    ? null
    : configured.kind === 'picgo'
      ? await resolvePicgoExecutable()
      : configured.executablePath
  let available = false
  if (configuredPath !== null) {
    try {
      await verifyUploaderExecutable(configuredPath)
      available = true
    } catch {
      available = false
    }
  }
  return Object.freeze({
    schema: 'uploader-availability-receipt-1',
    kind: request.kind,
    available
  })
}

function detectedImageMediaType(
  bytes: Uint8Array
): ImageAssetMediaType | null {
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

function verifyImage(
  bytes: Uint8Array,
  name: string,
  declaredMediaType?: ImageAssetMediaType
): Readonly<{
    readonly extension: string
    readonly mediaType: ImageAssetMediaType
  }> {
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_IMAGE_ASSET_BYTES
  ) {
    throw new RangeError('Uploader image is outside the size boundary')
  }
  const mediaType = detectedImageMediaType(bytes)
  if (mediaType === null) {
    throw new TypeError('Uploader source is not a supported image')
  }
  if (declaredMediaType !== undefined && declaredMediaType !== mediaType) {
    throw new TypeError('Uploader media type does not match image content')
  }
  const extension = path.extname(name).toLowerCase()
  if (EXTENSION_MEDIA_TYPES[extension] !== mediaType) {
    throw new TypeError('Uploader image extension does not match its content')
  }
  return Object.freeze({ extension, mediaType })
}

function verifiedSettings(value: unknown): UploaderSettings {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Uploader settings must be a closed record')
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (record.kind === 'picgo') {
    if (keys.length !== 1 || keys[0] !== 'kind') {
      throw new TypeError('PicGo uploader settings fields are not closed')
    }
    return Object.freeze({ kind: 'picgo' })
  }
  if (record.kind === 'custom-cli') {
    if (
      keys.length !== 2 ||
      !keys.includes('kind') ||
      !keys.includes('executablePath') ||
      typeof record.executablePath !== 'string' ||
      record.executablePath.length === 0 ||
      record.executablePath.includes('\0')
    ) {
      throw new TypeError('Custom uploader settings fields are invalid')
    }
    return Object.freeze({
      kind: 'custom-cli',
      executablePath: record.executablePath
    })
  }
  throw new TypeError('Unknown main-owned uploader setting')
}

function verifiedHttpUrl(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    /\s/.test(value)
  ) {
    return null
  }
  try {
    const parsed = new URL(value)
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.hostname.length === 0 ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      return null
    }
    return value
  } catch {
    return null
  }
}

interface ParsedUploaderOutput {
  readonly url: string
  readonly deletionUrl: string | null
}

function optionalDeletionUrl(
  record: Record<string, unknown>
): string | null {
  if (!Object.prototype.hasOwnProperty.call(record, 'deletionUrl')) {
    return null
  }
  const deletionUrl = verifiedHttpUrl(record.deletionUrl)
  if (deletionUrl === null) {
    throw new TypeError('Uploader deletion URL is invalid')
  }
  return deletionUrl
}

function picgoJsonOutput(value: unknown): ParsedUploaderOutput | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as { success?: unknown }).success !== true
  ) {
    return null
  }
  const record = value as Record<string, unknown>
  const direct = verifiedHttpUrl(record.imgUrl) ??
    verifiedHttpUrl(record.url)
  if (direct !== null) {
    return Object.freeze({
      url: direct,
      deletionUrl: optionalDeletionUrl(record)
    })
  }
  if (!Array.isArray(record.result) || record.result.length === 0) return null
  const resultUrl = verifiedHttpUrl(
    record.result[record.result.length - 1]
  )
  if (resultUrl === null) return null
  return Object.freeze({
    url: resultUrl,
    deletionUrl: optionalDeletionUrl(record)
  })
}

function parsePicgoOutput(output: string): ParsedUploaderOutput {
  const cleaned = output.replace(ANSI_SGR_RE, '')
  const lines = cleaned
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
  for (const line of lines) {
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const candidate = picgoJsonOutput(JSON.parse(line))
        if (candidate !== null) return candidate
      } catch {
        // PicGo also emits non-JSON status lines.
      }
    }
    const status = line.match(
      /(?:success|succeeded|uploaded)\s*:?\s*(https?:\/\/\S+)/i
    )
    const statusUrl = verifiedHttpUrl(status?.[1])
    if (statusUrl !== null) {
      return Object.freeze({ url: statusUrl, deletionUrl: null })
    }

    const marker = line.match(/\[PicGo SUCCESS\]:\s*(https?:\/\/\S+)/i)
    const markerUrl = verifiedHttpUrl(marker?.[1])
    if (markerUrl !== null) {
      return Object.freeze({ url: markerUrl, deletionUrl: null })
    }
  }
  throw new Error('PicGo upload output contains no successful URL')
}

function parseCustomOutput(output: string): ParsedUploaderOutput {
  const cleaned = output.trim()
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    let value: unknown
    try {
      value = JSON.parse(cleaned)
    } catch {
      throw new TypeError('Custom uploader JSON output is invalid')
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Custom uploader output must be a record')
    }
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    if (
      !keys.includes('url') ||
      keys.some(key => key !== 'url' && key !== 'deletionUrl')
    ) {
      throw new TypeError('Custom uploader output fields are not closed')
    }
    const url = verifiedHttpUrl(record.url)
    if (url === null) throw new TypeError('Custom uploader URL is invalid')
    return Object.freeze({
      url,
      deletionUrl: optionalDeletionUrl(record)
    })
  }
  const url = verifiedHttpUrl(cleaned)
  if (url === null) throw new Error('Uploader output contains no URL')
  return Object.freeze({ url, deletionUrl: null })
}

export function createUploaderService({
  describeDocument,
  readSettings,
  resolvePicgoExecutable = async() => null,
  executeFile = defaultExecuteFile,
  retainDeletionUrl,
  temporaryRoot = tmpdir()
}: UploaderServiceOptions): UploaderService {
  const upload = async(
    request: UploaderUploadRequest
  ): Promise<UploaderUploadReceipt> => {
    const document = describeDocument(request.documentId)
    if (document.documentId !== request.documentId) {
      throw new Error('Uploader document resolver returned another identity')
    }
    const settings = verifiedSettings(readSettings())
    const verified = verifyImage(
      request.source.bytes,
      request.source.name,
      request.source.mediaType
    )
    const material = Object.freeze({
      bytes: request.source.bytes,
      extension: verified.extension
    })
    const configuredExecutable = settings.kind === 'picgo'
      ? await resolvePicgoExecutable()
      : settings.executablePath
    if (configuredExecutable === null) {
      throw new Error('PicGo command not found')
    }
    const executablePath = await verifyUploaderExecutable(
      configuredExecutable
    )
    const directory = await mkdtemp(path.join(
      temporaryRoot,
      'marktext-upload-'
    ))
    const temporaryPath = path.join(
      directory,
      `upload${material.extension}`
    )
    try {
      await writeFile(temporaryPath, material.bytes, {
        flag: 'wx',
        mode: 0o600
      })
      const result = await executeFile(
        executablePath,
        settings.kind === 'picgo'
          ? Object.freeze(['u', temporaryPath])
          : Object.freeze([temporaryPath])
      )
      const output = settings.kind === 'picgo'
        ? parsePicgoOutput(`${result.stdout}\n${result.stderr}`)
        : parseCustomOutput(result.stdout)
      let deletionClipboard: UploaderDeletionClipboardCapability | null = null
      if (output.deletionUrl !== null) {
        if (retainDeletionUrl === undefined) {
          throw new Error(
            'Uploader deletion URL has no main retention authority'
          )
        }
        deletionClipboard = retainDeletionUrl(output.deletionUrl)
      }
      return Object.freeze({
        schema: 'uploader-upload-receipt-1',
        documentId: document.documentId,
        url: output.url,
        deletionClipboard
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  return Object.freeze({ upload: Object.freeze(upload) })
}
