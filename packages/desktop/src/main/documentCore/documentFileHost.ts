import type {
  FileSnapshotV1,
  ParseConfiguration
} from '@marktext/document-core'
import {
  decodeFileSnapshot,
  encodeFileSnapshot
} from '@marktext/document-core'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type {
  DocumentCoreHistoryState,
  DocumentCoreOpenCompletion,
  DocumentCorePathReceipt,
  DocumentCorePublication,
  DocumentCoreSaveReceipt,
  DocumentCoreSaveRequest
} from '../../shared/types/documentCore'
import type { DocumentCoreMainSessionHost } from './mainSessionHost'
import {
  decodeDocumentCoreFileCompareExchangeResult,
  documentCoreFileByteHash,
  type DocumentCoreFileByteHash,
  type DocumentCoreFileCompareExchangeRequest,
  type DocumentCoreFileCompareExchangeResult
} from './documentFileCompareExchange'

export type {
  DocumentCoreSaveReceipt,
  DocumentCoreSaveRequest
} from '../../shared/types/documentCore'

export interface DocumentCoreFileMove {
  readonly sourcePathname: string
  readonly targetPathname: string
}

export interface DocumentCorePhysicalFileIdentity {
  readonly schema: 'document-core-physical-file-identity-1'
  readonly canonicalPathname: string
  readonly device: string
  readonly inode: string
}

export interface DocumentCoreSavePathRequest {
  readonly ownerId: string
  readonly documentId: string
  readonly filename: string
  readonly pathname: string | null
  readonly mode: 'save' | 'save-as'
  readonly defaultDirectory: string
}

export interface DocumentCoreFileSurface {
  readonly chooseSavePath: (
    request: DocumentCoreSavePathRequest
  ) => Promise<string | null>
  readonly read: (
    pathname: string,
    encoding: FileSnapshotV1['encoding']
  ) => Promise<FileSnapshotV1 | null>
  /** Read exact target bytes for transactional replacement/rollback. */
  readonly readBytes: (pathname: string) => Promise<Uint8Array | null>
  /**
   * Resolve an existing path to its native physical identity.
   *
   * Canonical path identity covers symlink/case/normalization aliases while
   * device/inode identity also joins distinct hard-link names.
   */
  readonly identify: (
    pathname: string
  ) => Promise<DocumentCorePhysicalFileIdentity | null>
  /**
   * Move one file without overwriting an existing target.
   *
   * The surface must reject a collision. FileHost may call this again with
   * reversed paths to roll a completed move back when durable metadata cannot
   * be committed.
   */
  readonly move: (request: DocumentCoreFileMove) => Promise<void>
  /**
   * The only document-file mutation boundary.
   *
   * The surface compares the expected byte identity immediately before an
   * atomic replacement/removal and rejects a mismatch without mutation.
   */
  readonly compareExchange: (
    request: DocumentCoreFileCompareExchangeRequest
  ) => Promise<DocumentCoreFileCompareExchangeResult>
}

export interface DocumentCoreFileMetadata {
  readonly schema: 'document-core-file-metadata-2'
  readonly documentId: string
  readonly durableWindowId: string
  readonly filename: string
  readonly pathname: string | null
  readonly defaultDirectory: string
  readonly encoding: FileSnapshotV1['encoding']
  readonly baseByteHash: string
  readonly physicalIdentity: DocumentCorePhysicalFileIdentity | null
}

export interface DocumentCoreFileMetadataStorage {
  readonly list: () => Promise<readonly DocumentCoreFileMetadata[]>
  readonly read: (
    documentId: string
  ) => Promise<DocumentCoreFileMetadata | null>
  readonly write: (metadata: DocumentCoreFileMetadata) => Promise<void>
  readonly remove: (documentId: string) => Promise<void>
}

export interface DocumentCoreOpenFileRequest {
  readonly fileSnapshot: FileSnapshotV1
  readonly parseConfiguration: ParseConfiguration
  readonly filename: string
  readonly pathname: string | null
  readonly defaultDirectory: string
}

export interface DocumentCoreOpenedFile {
  readonly schema: 'document-core-opened-file-1'
  readonly documentId: string
  readonly filename: string
  readonly pathname: string | null
  readonly admission: DocumentCoreOpenCompletion
}

export interface DocumentCoreFileAdmissionPerformance {
  readonly schema: 'document-core-file-admission-performance-1'
  readonly ticketAdmissionMs: number
  readonly maximumMainStageMs: number
}

export interface DocumentCoreRecoverFileRequest {
  readonly documentId: string
  readonly parseConfiguration: ParseConfiguration
}

export interface DocumentCoreRecoveredFile {
  readonly schema: 'document-core-recovered-file-1'
  readonly documentId: string
  readonly filename: string
  readonly pathname: string | null
  readonly externalConflict: boolean
}

export interface DocumentCoreRecoveryWindow {
  readonly schema: 'document-core-recovery-window-1'
  readonly durableWindowId: string
  readonly documentIds: readonly string[]
}

export interface DocumentCoreFileReloadRequest {
  readonly documentId: string
  readonly force: boolean
}

export type DocumentCoreFileReloadResult =
  | Readonly<{
    readonly schema: 'document-core-file-reload-1'
    readonly kind: 'reloaded' | 'unchanged' | 'conflict'
    readonly documentId: string
    readonly revisionId: string
    readonly historyState: DocumentCoreHistoryState
  }>
  | Readonly<{
    readonly schema: 'document-core-file-reload-1'
    readonly kind: 'removed'
    readonly documentId: string
  }>

export type DocumentCoreExternalChangeResolution =
  | 'reload'
  | 'keep'

export type DocumentCoreExternalChangeResolutionResult =
  | DocumentCoreFileReloadResult
  | Readonly<{
    readonly schema: 'document-core-file-reload-1'
    readonly kind: 'kept'
    readonly documentId: string
  }>

export interface DocumentCoreFileDescription {
  readonly documentId: string
  readonly filename: string
  readonly pathname: string | null
}

export interface DocumentCoreFileInspection
  extends DocumentCoreFileDescription {
  readonly historyState: DocumentCoreHistoryState
}

export interface DocumentCoreRelocatePathRequest {
  readonly documentId: string
  readonly targetPathname: string
}

export interface DocumentCoreFileHost {
  readonly open: (
    ownerId: string,
    durableWindowId: string,
    request: DocumentCoreOpenFileRequest
  ) => Promise<DocumentCoreOpenedFile>
  readonly recover: (
    ownerId: string,
    durableWindowId: string,
    request: DocumentCoreRecoverFileRequest
  ) => Promise<DocumentCoreRecoveredFile>
  readonly recoveryWindows: (
  ) => Promise<readonly DocumentCoreRecoveryWindow[]>
  readonly reload: (
    ownerId: string,
    request: DocumentCoreFileReloadRequest
  ) => Promise<DocumentCoreFileReloadResult>
  readonly resolveExternalChange: (
    ownerId: string,
    documentId: string,
    resolution: DocumentCoreExternalChangeResolution
  ) => Promise<DocumentCoreExternalChangeResolutionResult>
  readonly documentIdForPath: (
    ownerId: string,
    pathname: string
  ) => string | null
  readonly attach: (
    ownerId: string,
    documentId: string
  ) => Promise<DocumentCorePublication>
  readonly save: (
    ownerId: string,
    request: DocumentCoreSaveRequest
  ) => Promise<DocumentCoreSaveReceipt>
  readonly relocate: (
    ownerId: string,
    request: DocumentCoreRelocatePathRequest
  ) => Promise<DocumentCorePathReceipt>
  readonly describe: (
    ownerId: string,
    documentId: string
  ) => DocumentCoreFileDescription
  /** Main-only authenticated inventory with live session history. */
  readonly inspectOwned: (
    ownerId: string
  ) => Promise<readonly DocumentCoreFileInspection[]>
  readonly descriptionsUnderPath: (
    ownerId: string,
    directoryPathname: string
  ) => readonly DocumentCoreFileDescription[]
  /**
   * Main-only performance/lifecycle evidence for the admitted file.
   *
   * This is not exposed through renderer IPC. The renderer receives only the
   * opaque document id and obtains its first verified publication on attach.
   */
  readonly readAdmission: (
    documentId: string
  ) => DocumentCoreOpenCompletion
  readonly readAdmissionPerformance: (
    documentId: string
  ) => DocumentCoreFileAdmissionPerformance
  readonly close: (ownerId: string, documentId: string) => Promise<void>
  readonly dispose: () => Promise<void>
}

interface HostedFile {
  readonly documentId: string
  readonly durabilityKey: string
  readonly parseConfiguration: ParseConfiguration
  readonly durableWindowId: string
  ownerId: string
  filename: string
  pathname: string | null
  physicalIdentity: DocumentCorePhysicalFileIdentity | null
  readonly defaultDirectory: string
  fileSnapshot: FileSnapshotV1
  fileByteHash: DocumentCoreFileByteHash
  admission: DocumentCoreOpenCompletion | null
  admissionPerformance: DocumentCoreFileAdmissionPerformance | null
  externalConflict: boolean
  saveQueue: Promise<void>
  closeOperation: Promise<void> | null
}

export interface DocumentCoreFileOccupancy {
  readonly schema: 'document-core-file-occupancy-1'
  readonly documentId: string
  readonly ownerId: string
  readonly durableWindowId: string
  readonly pathname: string
}

export class DocumentCoreFileAlreadyOpenError extends Error {
  readonly occupancy: DocumentCoreFileOccupancy

  constructor(occupancy: DocumentCoreFileOccupancy) {
    super(`File is already open: ${occupancy.pathname}`)
    this.name = 'DocumentCoreFileAlreadyOpenError'
    this.occupancy = Object.freeze({ ...occupancy })
  }
}

function occupancyFor(hosted: HostedFile): DocumentCoreFileOccupancy {
  if (hosted.pathname === null) {
    throw new Error('Untitled documents have no physical occupancy')
  }
  return Object.freeze({
    schema: 'document-core-file-occupancy-1',
    documentId: hosted.documentId,
    ownerId: hosted.ownerId,
    durableWindowId: hosted.durableWindowId,
    pathname: hosted.pathname
  })
}

function nonemptyIdentifier(value: string, label: string): void {
  const containsControlCharacter = typeof value === 'string' &&
    [...value].some(character => {
      const codePoint = character.codePointAt(0) ?? 0
      return (
        codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f)
      )
    })
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1_024 ||
    containsControlCharacter
  ) {
    throw new TypeError(`${label} must be a nonempty bounded printable string`)
  }
}

function safeSuggestedFilename(
  parserTitle: string | null,
  fallback: string
): string {
  if (parserTitle === null) return fallback
  const safe = [...parserTitle]
    .map(character => {
      const codePoint = character.codePointAt(0) ?? 0
      if (
        codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        '<>:"/\\|?*'.includes(character)
      ) {
        return '-'
      }
      return character
    })
    .join('')
    .trim()
    .replace(/[. ]+$/u, '')
    .slice(0, 180)
  return safe.length === 0 || safe === '.' || safe === '..'
    ? fallback
    : safe
}

function validateFileSnapshot(snapshot: FileSnapshotV1): FileSnapshotV1 {
  if (
    snapshot === null ||
    typeof snapshot !== 'object' ||
    (
      snapshot.encoding !== 'utf-8' &&
      snapshot.encoding !== 'utf-16le' &&
      snapshot.encoding !== 'utf-16be'
    ) ||
    typeof snapshot.readOriginalBytes !== 'function' ||
    snapshot.source === null ||
    typeof snapshot.source !== 'object' ||
    typeof snapshot.source.text !== 'string'
  ) {
    throw new TypeError('Invalid main-owned file snapshot')
  }
  const stable = decodeFileSnapshot(
    snapshot.readOriginalBytes(),
    snapshot.encoding
  )
  if (stable.source.text !== snapshot.source.text) {
    throw new TypeError(
      'File snapshot source does not match its original bytes'
    )
  }
  return stable
}

function snapshotByteHash(snapshot: FileSnapshotV1): string {
  return createHash('sha256')
    .update(snapshot.readOriginalBytes())
    .digest('hex')
}

function validatePhysicalIdentity(
  value: DocumentCorePhysicalFileIdentity | null,
  pathname: string
): DocumentCorePhysicalFileIdentity {
  if (
    value === null ||
    typeof value !== 'object' ||
    Reflect.ownKeys(value).length !== 4 ||
    value.schema !== 'document-core-physical-file-identity-1' ||
    typeof value.canonicalPathname !== 'string' ||
    value.canonicalPathname.length === 0 ||
    typeof value.device !== 'string' ||
    !/^[0-9]+$/u.test(value.device) ||
    typeof value.inode !== 'string' ||
    !/^[0-9]+$/u.test(value.inode)
  ) {
    throw new TypeError(`Invalid physical file identity for ${pathname}`)
  }
  return Object.freeze({
    schema: value.schema,
    canonicalPathname: value.canonicalPathname,
    device: value.device,
    inode: value.inode
  })
}

function physicalIdentityKeys(
  identity: DocumentCorePhysicalFileIdentity
): readonly string[] {
  const canonical = path
    .normalize(path.resolve(identity.canonicalPathname))
    .normalize('NFC')
  const pathKey = process.platform === 'win32'
    ? canonical.toLowerCase()
    : canonical
  return Object.freeze([
    `path:${pathKey}`,
    ...(identity.inode === '0'
      ? []
      : [`inode:${identity.device}:${identity.inode}`])
  ])
}

function metadataFor(
  hosted: HostedFile,
  state: Readonly<{
    filename: string
    pathname: string | null
    fileSnapshot: FileSnapshotV1
    physicalIdentity: DocumentCorePhysicalFileIdentity | null
  }> = hosted
): DocumentCoreFileMetadata {
  return Object.freeze({
    schema: 'document-core-file-metadata-2',
    documentId: hosted.documentId,
    durableWindowId: hosted.durableWindowId,
    filename: state.filename,
    pathname: state.pathname,
    defaultDirectory: hosted.defaultDirectory,
    encoding: state.fileSnapshot.encoding,
    baseByteHash: snapshotByteHash(state.fileSnapshot),
    physicalIdentity: state.physicalIdentity
  })
}

function pathIdentity(pathname: string): string {
  const resolved = path.resolve(pathname)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function filenameForPathname(pathname: string): string {
  const separator = Math.max(
    pathname.lastIndexOf('/'),
    pathname.lastIndexOf('\\')
  )
  return pathname.slice(separator + 1)
}

function pathIsInside(
  directoryPathname: string,
  candidatePathname: string
): boolean {
  const relative = path.relative(
    path.resolve(directoryPathname),
    path.resolve(candidatePathname)
  )
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

function validateMetadata(
  value: DocumentCoreFileMetadata,
  documentId: string
): DocumentCoreFileMetadata {
  if (
    value === null ||
    typeof value !== 'object' ||
    Reflect.ownKeys(value).length !== 9 ||
    value.schema !== 'document-core-file-metadata-2' ||
    value.documentId !== documentId ||
    (
      value.encoding !== 'utf-8' &&
      value.encoding !== 'utf-16le' &&
      value.encoding !== 'utf-16be'
    ) ||
    !/^[0-9a-f]{64}$/u.test(value.baseByteHash) ||
    (
      value.pathname !== null &&
      typeof value.pathname !== 'string'
    ) ||
    (
      value.physicalIdentity !== null &&
      typeof value.physicalIdentity !== 'object'
    )
  ) {
    throw new TypeError('Invalid durable document file metadata')
  }
  nonemptyIdentifier(value.documentId, 'documentId')
  nonemptyIdentifier(value.durableWindowId, 'durableWindowId')
  nonemptyIdentifier(value.filename, 'filename')
  nonemptyIdentifier(value.defaultDirectory, 'defaultDirectory')
  return Object.freeze({
    ...value,
    physicalIdentity: value.physicalIdentity === null
      ? null
      : validatePhysicalIdentity(
        value.physicalIdentity,
        value.pathname ?? value.filename
      )
  })
}

/**
 * Main-process authority for document admission, attachment, persistence, and
 * terminal file/session lifecycle.
 *
 * A renderer never enters this seam with source, parser configuration,
 * durability identity, file policy, or a claimed revision. Those values are
 * admitted by the main caller and retained here; save obtains its bytes and
 * revision identity directly from the main-owned session.
 */
export function createDocumentCoreFileHost(
  sessions: DocumentCoreMainSessionHost,
  surface: DocumentCoreFileSurface,
  createDocumentId: () => string,
  createDurabilityKey: (documentId: string) => string,
  metadataStorage: DocumentCoreFileMetadataStorage
): DocumentCoreFileHost {
  const files = new Map<string, HostedFile>()
  const pathIndex = new Map<string, Set<string>>()
  const physicalIndex = new Map<string, HostedFile>()
  let disposed = false
  let disposeOperation: Promise<void> | null = null

  const assertUsable = (): void => {
    if (disposed) {
      throw new Error('Document-core file host is disposed')
    }
  }

  const indexPath = (hosted: HostedFile, pathname = hosted.pathname): void => {
    if (pathname === null) return
    const identity = pathIdentity(pathname)
    const indexed = pathIndex.get(identity) ?? new Set<string>()
    indexed.add(hosted.documentId)
    pathIndex.set(identity, indexed)
  }

  const unindexPath = (
    hosted: HostedFile,
    pathname = hosted.pathname
  ): void => {
    if (pathname === null) return
    const identity = pathIdentity(pathname)
    const indexed = pathIndex.get(identity)
    if (indexed === undefined) return
    indexed.delete(hosted.documentId)
    if (indexed.size === 0) pathIndex.delete(identity)
  }

  const assertPathAvailable = (
    hosted: HostedFile,
    pathname: string
  ): void => {
    const indexed = pathIndex.get(pathIdentity(pathname))
    if (
      indexed !== undefined &&
      [...indexed].some(documentId => documentId !== hosted.documentId)
    ) {
      throw new Error(`Target path is already open: ${pathname}`)
    }
  }

  const assertPhysicalIdentityAvailable = (
    hosted: HostedFile,
    identity: DocumentCorePhysicalFileIdentity
  ): void => {
    const keys = physicalIdentityKeys(identity)
    for (const key of keys) {
      const occupied = physicalIndex.get(key)
      if (
        occupied !== undefined &&
        occupied.documentId !== hosted.documentId
      ) {
        throw new DocumentCoreFileAlreadyOpenError(
          occupancyFor(occupied)
        )
      }
    }
  }

  const reservePhysicalIdentity = (hosted: HostedFile): void => {
    if (hosted.physicalIdentity === null) return
    const keys = physicalIdentityKeys(hosted.physicalIdentity)
    assertPhysicalIdentityAvailable(hosted, hosted.physicalIdentity)
    for (const key of keys) physicalIndex.set(key, hosted)
  }

  const releaseIdentity = (
    hosted: HostedFile,
    identity: DocumentCorePhysicalFileIdentity | null
  ): void => {
    if (identity === null) return
    for (const key of physicalIdentityKeys(identity)) {
      if (physicalIndex.get(key) === hosted) physicalIndex.delete(key)
    }
  }

  const releasePhysicalIdentity = (hosted: HostedFile): void => {
    releaseIdentity(hosted, hosted.physicalIdentity)
  }

  const hostedFor = (documentId: string): HostedFile => {
    const hosted = files.get(documentId)
    if (hosted === undefined) {
      throw new Error(`Unknown or closed document-core file ${documentId}`)
    }
    return hosted
  }

  const assertOwner = (hosted: HostedFile, ownerId: string): void => {
    nonemptyIdentifier(ownerId, 'ownerId')
    if (hosted.ownerId !== ownerId) {
      throw new Error(
        `${hosted.documentId} is owned by ${hosted.ownerId}, not ${ownerId}`
      )
    }
  }

  const open = async(
    ownerId: string,
    durableWindowId: string,
    request: DocumentCoreOpenFileRequest
  ): Promise<DocumentCoreOpenedFile> => {
    assertUsable()
    nonemptyIdentifier(ownerId, 'ownerId')
    nonemptyIdentifier(durableWindowId, 'durableWindowId')
    nonemptyIdentifier(request.filename, 'filename')
    const documentId = createDocumentId()
    const durabilityKey = createDurabilityKey(documentId)
    nonemptyIdentifier(documentId, 'documentId')
    nonemptyIdentifier(durabilityKey, 'durabilityKey')
    if (files.has(documentId)) {
      throw new Error(`Duplicate document id ${documentId}`)
    }
    const fileSnapshot = validateFileSnapshot(request.fileSnapshot)
    const physicalIdentity = request.pathname === null
      ? null
      : validatePhysicalIdentity(
        await surface.identify(request.pathname),
        request.pathname
      )
    const hosted: HostedFile = {
      documentId,
      durabilityKey,
      parseConfiguration: request.parseConfiguration,
      durableWindowId,
      ownerId,
      filename: request.filename,
      pathname: request.pathname,
      physicalIdentity,
      defaultDirectory: request.defaultDirectory,
      fileSnapshot,
      fileByteHash: request.pathname === null
        ? null
        : snapshotByteHash(fileSnapshot),
      admission: null,
      admissionPerformance: null,
      externalConflict: false,
      saveQueue: Promise.resolve(),
      closeOperation: null
    }
    reservePhysicalIdentity(hosted)
    files.set(documentId, hosted)
    indexPath(hosted)

    let ticketId: string | null = null
    let admitted = false
    try {
      const ticketStartedAt = performance.now()
      const ticket = await sessions.startOpen(ownerId, {
        documentId,
        durabilityKey,
        sourceLength: fileSnapshot.source.text.length,
        parseConfiguration: request.parseConfiguration
      })
      const ticketAdmissionMs = performance.now() - ticketStartedAt
      ticketId = ticket.ticketId
      if (!ticket.requiresSource) {
        throw new Error('A new main-owned file unexpectedly reused a session')
      }
      let ordinal = 0
      let maximumMainStageMs = 0
      for (
        let start = 0;
        start < fileSnapshot.source.text.length;
        start += ticket.chunkUnits
      ) {
        const callerStageStartedAt = performance.now()
        const staged = sessions.appendOpenChunk(
          ownerId,
          documentId,
          ticket.ticketId,
          ordinal,
          fileSnapshot.source.text.slice(start, start + ticket.chunkUnits)
        )
        const callerStageMs = performance.now() - callerStageStartedAt
        const receipt = await staged
        maximumMainStageMs = Math.max(
          maximumMainStageMs,
          callerStageMs,
          receipt.mainStageMs
        )
        ordinal += 1
      }
      const admission = await sessions.completeOpen(
        ownerId,
        documentId,
        ticket.ticketId
      )
      if ('envelope' in admission) {
        throw new Error('A new main-owned file returned a renderer publication')
      }
      hosted.admission = admission
      hosted.admissionPerformance = Object.freeze({
        schema: 'document-core-file-admission-performance-1',
        ticketAdmissionMs,
        maximumMainStageMs
      })
      admitted = true
      await metadataStorage.write(metadataFor(hosted))
      return Object.freeze({
        schema: 'document-core-opened-file-1' as const,
        documentId,
        filename: hosted.filename,
        pathname: hosted.pathname,
        admission
      })
    } catch (error) {
      releasePhysicalIdentity(hosted)
      unindexPath(hosted)
      files.delete(documentId)
      if (admitted) {
        await sessions.close(ownerId, documentId).catch(() => {})
      } else if (ticketId !== null) {
        await sessions.cancelOpen(
          ownerId,
          documentId,
          ticketId
        ).catch(() => {})
      }
      throw error
    }
  }

  const recover = async(
    ownerId: string,
    durableWindowId: string,
    request: DocumentCoreRecoverFileRequest
  ): Promise<DocumentCoreRecoveredFile> => {
    assertUsable()
    nonemptyIdentifier(ownerId, 'ownerId')
    nonemptyIdentifier(durableWindowId, 'durableWindowId')
    nonemptyIdentifier(request.documentId, 'documentId')
    if (files.has(request.documentId)) {
      throw new Error(`Duplicate document id ${request.documentId}`)
    }
    const rawMetadata = await metadataStorage.read(request.documentId)
    if (rawMetadata === null) {
      throw new Error(
        `No durable file metadata for document ${request.documentId}`
      )
    }
    const metadata = validateMetadata(rawMetadata, request.documentId)
    if (metadata.durableWindowId !== durableWindowId) {
      throw new Error(
        `Document ${request.documentId} belongs to durable window ` +
        metadata.durableWindowId
      )
    }
    const diskSnapshot = metadata.pathname === null
      ? null
      : await surface.read(metadata.pathname, metadata.encoding)
    const externalConflict =
      metadata.pathname !== null &&
      (
        diskSnapshot === null ||
        snapshotByteHash(diskSnapshot) !== metadata.baseByteHash
      )
    const fileSnapshot = diskSnapshot ?? decodeFileSnapshot(
      new Uint8Array(0),
      metadata.encoding
    )
    const currentPhysicalIdentity = metadata.pathname === null
      ? null
      : await surface.identify(metadata.pathname)
    // Keep the last durable native identity reserved while a recovered file is
    // missing. This closes the interval in which the same path (or a surviving
    // hard-link alias) reappears and could otherwise be admitted as a second
    // live document before the user resolves the external-file conflict.
    const recoveredPhysicalIdentity =
      currentPhysicalIdentity ?? metadata.physicalIdentity
    const durabilityKey = createDurabilityKey(request.documentId)
    nonemptyIdentifier(durabilityKey, 'durabilityKey')
    if (!(await sessions.hasDurableSession(durabilityKey))) {
      throw new Error(
        `No durable session journal for document ${request.documentId}`
      )
    }
    const hosted: HostedFile = {
      documentId: request.documentId,
      durabilityKey,
      parseConfiguration: request.parseConfiguration,
      durableWindowId,
      ownerId,
      filename: metadata.filename,
      pathname: metadata.pathname,
      physicalIdentity: recoveredPhysicalIdentity === null
        ? null
        : validatePhysicalIdentity(
          recoveredPhysicalIdentity,
          metadata.pathname ?? metadata.filename
        ),
      defaultDirectory: metadata.defaultDirectory,
      fileSnapshot,
      fileByteHash: diskSnapshot === null
        ? null
        : snapshotByteHash(diskSnapshot),
      admission: null,
      admissionPerformance: null,
      externalConflict,
      saveQueue: Promise.resolve(),
      closeOperation: null
    }
    reservePhysicalIdentity(hosted)
    files.set(request.documentId, hosted)
    indexPath(hosted)
    return Object.freeze({
      schema: 'document-core-recovered-file-1',
      documentId: request.documentId,
      filename: metadata.filename,
      pathname: metadata.pathname,
      externalConflict
    })
  }

  const recoveryWindows = async():
  Promise<readonly DocumentCoreRecoveryWindow[]> => {
    assertUsable()
    const grouped = new Map<string, string[]>()
    for (const rawMetadata of await metadataStorage.list()) {
      const metadata = validateMetadata(
        rawMetadata,
        rawMetadata.documentId
      )
      const durabilityKey = createDurabilityKey(metadata.documentId)
      if (!(await sessions.hasDurableSession(durabilityKey))) continue
      const documentIds = grouped.get(metadata.durableWindowId) ?? []
      documentIds.push(metadata.documentId)
      grouped.set(metadata.durableWindowId, documentIds)
    }
    return Object.freeze(
      [...grouped.entries()]
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([durableWindowId, documentIds]) => Object.freeze({
          schema: 'document-core-recovery-window-1' as const,
          durableWindowId,
          documentIds: Object.freeze([...documentIds].sort())
        }))
    )
  }

  const attach = async(
    ownerId: string,
    documentId: string
  ): Promise<DocumentCorePublication> => {
    assertUsable()
    nonemptyIdentifier(ownerId, 'ownerId')
    const hosted = hostedFor(documentId)
    const ticket = await sessions.startOpen(ownerId, {
      documentId,
      durabilityKey: hosted.durabilityKey,
      sourceLength: 0,
      parseConfiguration: hosted.parseConfiguration
    })
    if (ticket.requiresSource) {
      await sessions.cancelOpen(ownerId, documentId, ticket.ticketId)
      throw new Error(
        `Main-owned document ${documentId} cannot attach without its journal`
      )
    }
    const publication = await sessions.completeOpen(
      ownerId,
      documentId,
      ticket.ticketId
    )
    if (!('envelope' in publication)) {
      throw new Error(
        `Main-owned document ${documentId} returned no attach publication`
      )
    }
    hosted.ownerId = ownerId
    return publication
  }

  const executeReload = async(
    ownerId: string,
    hosted: HostedFile,
    force: boolean
  ): Promise<DocumentCoreFileReloadResult> => {
    assertOwner(hosted, ownerId)
    if (hosted.pathname === null) {
      throw new Error(`Untitled document ${hosted.documentId} has no file`)
    }
    const diskSnapshot = await surface.read(
      hosted.pathname,
      hosted.fileSnapshot.encoding
    )
    if (diskSnapshot === null) {
      hosted.externalConflict = true
      return Object.freeze({
        schema: 'document-core-file-reload-1',
        kind: 'removed',
        documentId: hosted.documentId
      })
    }
    const result = await sessions.reloadFromFile(
      ownerId,
      hosted.documentId,
      diskSnapshot.source.text,
      force
    )
    if (result.kind === 'conflict') {
      hosted.externalConflict = true
    } else {
      await metadataStorage.write(Object.freeze({
        ...metadataFor(hosted),
        encoding: diskSnapshot.encoding,
        baseByteHash: snapshotByteHash(diskSnapshot)
      }))
      hosted.fileSnapshot = diskSnapshot
      hosted.fileByteHash = snapshotByteHash(diskSnapshot)
      hosted.externalConflict = false
    }
    return Object.freeze({
      schema: 'document-core-file-reload-1',
      kind: result.kind,
      documentId: hosted.documentId,
      revisionId: result.revisionId,
      historyState: result.historyState
    })
  }

  const reload = (
    ownerId: string,
    request: DocumentCoreFileReloadRequest
  ): Promise<DocumentCoreFileReloadResult> => {
    assertUsable()
    const hosted = hostedFor(request.documentId)
    assertOwner(hosted, ownerId)
    if (typeof request.force !== 'boolean') {
      throw new TypeError('Document file reload force must be boolean')
    }
    const operation = hosted.saveQueue.then(
      () => executeReload(ownerId, hosted, request.force)
    )
    hosted.saveQueue = operation.then(
      () => {},
      () => {}
    )
    return operation
  }

  const resolveExternalChange = (
    ownerId: string,
    documentId: string,
    resolution: DocumentCoreExternalChangeResolution
  ): Promise<DocumentCoreExternalChangeResolutionResult> => {
    assertUsable()
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    if (resolution === 'reload') {
      return reload(ownerId, {
        documentId,
        force: true
      })
    }
    if (resolution !== 'keep') {
      throw new TypeError(
        `Unknown external file resolution ${String(resolution)}`
      )
    }
    const operation = hosted.saveQueue.then(async() => {
      if (hosted.pathname !== null) {
        const diskSnapshot = await surface.read(
          hosted.pathname,
          hosted.fileSnapshot.encoding
        )
        if (diskSnapshot !== null) {
          await metadataStorage.write(Object.freeze({
            ...metadataFor(hosted),
            encoding: diskSnapshot.encoding,
            baseByteHash: snapshotByteHash(diskSnapshot)
          }))
          hosted.fileSnapshot = diskSnapshot
        }
        hosted.fileByteHash = diskSnapshot === null
          ? null
          : snapshotByteHash(diskSnapshot)
      }
      hosted.externalConflict = false
      return Object.freeze({
        schema: 'document-core-file-reload-1' as const,
        kind: 'kept' as const,
        documentId
      })
    })
    hosted.saveQueue = operation.then(
      () => {},
      () => {}
    )
    return operation
  }

  const documentIdForPath = (
    ownerId: string,
    pathname: string
  ): string | null => {
    assertUsable()
    nonemptyIdentifier(ownerId, 'ownerId')
    nonemptyIdentifier(pathname, 'pathname')
    const indexed = pathIndex.get(pathIdentity(pathname))
    if (indexed === undefined) return null
    for (const documentId of indexed) {
      const hosted = files.get(documentId)
      if (
        hosted !== undefined &&
        hosted.ownerId === ownerId &&
        hosted.pathname !== null
      ) {
        return hosted.documentId
      }
    }
    return null
  }

  const executeSave = async(
    ownerId: string,
    hosted: HostedFile,
    mode: DocumentCoreSaveRequest['mode']
  ): Promise<DocumentCoreSaveReceipt> => {
    assertOwner(hosted, ownerId)
    if (hosted.externalConflict) {
      throw new Error(
        `Document ${hosted.documentId} conflicts with its file on disk`
      )
    }
    const lease = await sessions.preparePersistence(
      ownerId,
      hosted.documentId,
      mode === 'autosave' ? 'autosave' : 'save'
    )

    const persist = async(): Promise<DocumentCoreSaveReceipt> => {
      let pathname = hosted.pathname
      if (mode === 'autosave' && pathname === null) {
        return Object.freeze({
          schema: 'document-core-save-receipt-1' as const,
          kind: 'unavailable' as const,
          documentId: hosted.documentId,
          reason: 'autosave-needs-path' as const
        })
      }
      if (mode === 'save-as' || pathname === null) {
        pathname = await surface.chooseSavePath(Object.freeze({
          ownerId,
          documentId: hosted.documentId,
          filename: safeSuggestedFilename(
            lease.facts.recommendedTitle,
            hosted.filename
          ),
          pathname: hosted.pathname,
          mode: mode === 'save-as' ? 'save-as' : 'save',
          defaultDirectory: hosted.defaultDirectory
        }))
        if (pathname === null) {
          return Object.freeze({
            schema: 'document-core-save-receipt-1' as const,
            kind: 'cancelled' as const,
            documentId: hosted.documentId
          })
        }
      }

      nonemptyIdentifier(pathname, 'pathname')
      const nextFilename = filenameForPathname(pathname)
      nonemptyIdentifier(nextFilename, 'filename')
      assertPathAvailable(hosted, pathname)
      const targetPhysicalIdentity = await surface.identify(pathname)
      if (targetPhysicalIdentity !== null) {
        assertPhysicalIdentityAvailable(
          hosted,
          validatePhysicalIdentity(targetPhysicalIdentity, pathname)
        )
      }
      const writesRetainedPath =
        hosted.pathname !== null &&
        pathIdentity(hosted.pathname) === pathIdentity(pathname)
      const capturedTargetBytes = writesRetainedPath
        ? null
        : await surface.readBytes(pathname)
      const previousTargetBytes = writesRetainedPath
        ? (
          hosted.fileByteHash === null
            ? null
            : Uint8Array.from(hosted.fileSnapshot.readOriginalBytes())
        )
        : (
          capturedTargetBytes === null
            ? null
            : Uint8Array.from(capturedTargetBytes)
        )
      const expectedTargetByteHash = writesRetainedPath
        ? hosted.fileByteHash
        : documentCoreFileByteHash(previousTargetBytes)
      if (
        documentCoreFileByteHash(previousTargetBytes) !==
        expectedTargetByteHash
      ) {
        throw new TypeError(
          `Retained file identity drifted for ${hosted.documentId}`
        )
      }
      const rawPreviousMetadata =
      await metadataStorage.read(hosted.documentId)
      const previousMetadata = rawPreviousMetadata === null
        ? null
        : validateMetadata(rawPreviousMetadata, hosted.documentId)
      let pendingPhysicalIdentity:
      DocumentCorePhysicalFileIdentity | null = null
      const restorePhysicalReservation = (): void => {
        if (pendingPhysicalIdentity === null) return
        releaseIdentity(hosted, pendingPhysicalIdentity)
        reservePhysicalIdentity(hosted)
        pendingPhysicalIdentity = null
      }
      const rollbackDurableSave = async(
        originalError: unknown,
        restoreMetadata = true,
        restoreSession = false
      ): Promise<never> => {
        const rollbackErrors: unknown[] = []
        if (restoreSession) {
          try {
            await sessions.restorePersisted(
              ownerId,
              hosted.documentId,
              lease.historyState.savedIdentity
            )
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }
        if (restoreMetadata) {
          try {
            if (previousMetadata === null) {
              await metadataStorage.remove(hosted.documentId)
            } else {
              await metadataStorage.write(previousMetadata)
            }
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }
        try {
          const rollback = decodeDocumentCoreFileCompareExchangeResult(
            await surface.compareExchange(Object.freeze({
              schema: 'document-core-file-compare-exchange-1',
              pathname,
              expectedByteHash: writtenByteHash,
              bytes: previousTargetBytes
            }))
          )
          if (
            rollback.kind === 'conflict' &&
            rollback.actualByteHash !== expectedTargetByteHash
          ) {
            if (writesRetainedPath) {
              hosted.externalConflict = true
            }
            rollbackErrors.push(new Error(
              `File changed again before rollback for ${hosted.documentId}`
            ))
          } else if (
            rollback.kind === 'exchanged' &&
            rollback.previousByteHash !== writtenByteHash
          ) {
            rollbackErrors.push(new TypeError(
              'Filesystem rollback returned the wrong prior identity'
            ))
          }
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
        restorePhysicalReservation()
        if (rollbackErrors.length > 0) {
          throw new AggregateError(
            [originalError, ...rollbackErrors],
            `Save failed and rollback was incomplete for ${hosted.documentId}`
          )
        }
        throw originalError
      }
      const encoded = encodeFileSnapshot(hosted.fileSnapshot, lease.source)
      const writtenSnapshot = decodeFileSnapshot(
        encoded,
        hosted.fileSnapshot.encoding
      )
      const writtenByteHash = documentCoreFileByteHash(encoded)
      if (writtenByteHash === null) {
        throw new Error('Encoded document bytes have no file identity')
      }
      let exchange: DocumentCoreFileCompareExchangeResult
      try {
        exchange = decodeDocumentCoreFileCompareExchangeResult(
          await surface.compareExchange(Object.freeze({
            schema: 'document-core-file-compare-exchange-1',
            pathname,
            expectedByteHash: expectedTargetByteHash,
            bytes: Uint8Array.from(encoded)
          }))
        )
      } catch (error) {
        return await rollbackDurableSave(error, false)
      }
      if (exchange.kind === 'conflict') {
        if (writesRetainedPath) {
          hosted.externalConflict = true
        }
        throw new Error(
          `Document ${hosted.documentId} changed on disk before save`
        )
      }
      if (exchange.previousByteHash !== expectedTargetByteHash) {
        return await rollbackDurableSave(
          new TypeError(
            'Filesystem compare-exchange returned the wrong prior identity'
          ),
          false
        )
      }
      try {
        const rawWrittenPhysicalIdentity = await surface.identify(pathname)
        if (rawWrittenPhysicalIdentity === null) {
          return await rollbackDurableSave(
            new Error(
              `Written file identity disappeared for ${hosted.documentId}`
            ),
            false
          )
        }
        pendingPhysicalIdentity = validatePhysicalIdentity(
          rawWrittenPhysicalIdentity,
          pathname
        )
        assertPhysicalIdentityAvailable(hosted, pendingPhysicalIdentity)
        for (const key of physicalIdentityKeys(pendingPhysicalIdentity)) {
          physicalIndex.set(key, hosted)
        }
      } catch (error) {
        return await rollbackDurableSave(error, false)
      }
      const previousPathname = hosted.pathname
      try {
        await metadataStorage.write(metadataFor(hosted, {
          filename: nextFilename,
          pathname,
          fileSnapshot: writtenSnapshot,
          physicalIdentity: pendingPhysicalIdentity
        }))
      } catch (error) {
        return await rollbackDurableSave(error)
      }
      let historyState: DocumentCoreHistoryState
      try {
        historyState = await sessions.markPersisted(
          ownerId,
          hosted.documentId,
          lease.leaseId
        )
      } catch (error) {
        return await rollbackDurableSave(error, true, true)
      }
      const previousPhysicalIdentity = hosted.physicalIdentity
      releaseIdentity(hosted, previousPhysicalIdentity)
      hosted.physicalIdentity = pendingPhysicalIdentity
      reservePhysicalIdentity(hosted)
      pendingPhysicalIdentity = null
      hosted.fileSnapshot = writtenSnapshot
      hosted.fileByteHash = writtenByteHash
      hosted.pathname = pathname
      hosted.filename = nextFilename
      if (
        previousPathname === null ||
      pathIdentity(previousPathname) !== pathIdentity(pathname)
      ) {
        unindexPath(hosted, previousPathname)
        indexPath(hosted, pathname)
      }
      hosted.externalConflict = false
      return Object.freeze({
        schema: 'document-core-save-receipt-1' as const,
        kind: 'written' as const,
        documentId: hosted.documentId,
        pathname,
        revisionId: lease.revisionId,
        historyState
      })
    }
    let receipt: DocumentCoreSaveReceipt
    try {
      receipt = await persist()
    } catch (failure) {
      try {
        await sessions.releasePersistence(
          ownerId,
          hosted.documentId,
          lease.leaseId
        )
      } catch (releaseError) {
        throw new AggregateError(
          [failure, releaseError],
          'Save and persistence lease release failed for ' +
          hosted.documentId
        )
      }
      throw failure
    }
    await sessions.releasePersistence(
      ownerId,
      hosted.documentId,
      lease.leaseId
    )
    return receipt
  }

  const save = (
    ownerId: string,
    request: DocumentCoreSaveRequest
  ): Promise<DocumentCoreSaveReceipt> => {
    assertUsable()
    const hosted = hostedFor(request.documentId)
    assertOwner(hosted, ownerId)
    if (
      request.mode !== 'save' &&
      request.mode !== 'save-as' &&
      request.mode !== 'autosave'
    ) {
      throw new TypeError(`Unknown document save mode ${String(request.mode)}`)
    }
    const operation = hosted.saveQueue.then(
      () => executeSave(ownerId, hosted, request.mode)
    )
    hosted.saveQueue = operation.then(
      () => {},
      () => {}
    )
    return operation
  }

  const executeRelocate = async(
    ownerId: string,
    hosted: HostedFile,
    targetPathname: string
  ): Promise<DocumentCorePathReceipt> => {
    assertOwner(hosted, ownerId)
    nonemptyIdentifier(targetPathname, 'targetPathname')
    if (hosted.pathname === null) {
      throw new Error(
        `Untitled document ${hosted.documentId} has no file to relocate`
      )
    }
    const sourcePathname = hosted.pathname
    const resolvedTarget = path.resolve(targetPathname)
    const targetFilename = filenameForPathname(resolvedTarget)
    nonemptyIdentifier(targetFilename, 'target filename')

    if (pathIdentity(sourcePathname) === pathIdentity(resolvedTarget)) {
      return Object.freeze({
        schema: 'document-core-path-receipt-1',
        documentId: hosted.documentId,
        previousPathname: sourcePathname,
        pathname: sourcePathname,
        filename: hosted.filename
      })
    }
    assertPathAvailable(hosted, resolvedTarget)

    await surface.move(Object.freeze({
      sourcePathname,
      targetPathname: resolvedTarget
    }))

    let relocatedPhysicalIdentity: DocumentCorePhysicalFileIdentity
    try {
      const rawRelocatedIdentity = await surface.identify(resolvedTarget)
      if (rawRelocatedIdentity === null) {
        throw new Error(
          `Relocated file identity disappeared for ${hosted.documentId}`
        )
      }
      relocatedPhysicalIdentity = validatePhysicalIdentity(
        rawRelocatedIdentity,
        resolvedTarget
      )
      assertPhysicalIdentityAvailable(hosted, relocatedPhysicalIdentity)
      for (const key of physicalIdentityKeys(relocatedPhysicalIdentity)) {
        physicalIndex.set(key, hosted)
      }
    } catch (identityError) {
      try {
        await surface.move(Object.freeze({
          sourcePathname: resolvedTarget,
          targetPathname: sourcePathname
        }))
      } catch (rollbackError) {
        throw new AggregateError(
          [identityError, rollbackError],
          `Relocated ${hosted.documentId}, but identity admission and filesystem rollback both failed`
        )
      }
      throw identityError
    }

    const previousFilename = hosted.filename
    const previousPhysicalIdentity = hosted.physicalIdentity
    unindexPath(hosted, sourcePathname)
    hosted.pathname = resolvedTarget
    hosted.filename = targetFilename
    hosted.physicalIdentity = relocatedPhysicalIdentity
    indexPath(hosted, resolvedTarget)
    try {
      await metadataStorage.write(metadataFor(hosted))
    } catch (metadataError) {
      try {
        await surface.move(Object.freeze({
          sourcePathname: resolvedTarget,
          targetPathname: sourcePathname
        }))
      } catch (rollbackError) {
        throw new AggregateError(
          [metadataError, rollbackError],
          `Relocated ${hosted.documentId}, but metadata commit and filesystem rollback both failed`
        )
      }
      unindexPath(hosted, resolvedTarget)
      releaseIdentity(hosted, relocatedPhysicalIdentity)
      hosted.pathname = sourcePathname
      hosted.filename = previousFilename
      hosted.physicalIdentity = previousPhysicalIdentity
      reservePhysicalIdentity(hosted)
      indexPath(hosted, sourcePathname)
      throw metadataError
    }
    releaseIdentity(hosted, previousPhysicalIdentity)
    reservePhysicalIdentity(hosted)

    return Object.freeze({
      schema: 'document-core-path-receipt-1',
      documentId: hosted.documentId,
      previousPathname: sourcePathname,
      pathname: resolvedTarget,
      filename: targetFilename
    })
  }

  const relocate = (
    ownerId: string,
    request: DocumentCoreRelocatePathRequest
  ): Promise<DocumentCorePathReceipt> => {
    assertUsable()
    const hosted = hostedFor(request.documentId)
    assertOwner(hosted, ownerId)
    const operation = hosted.saveQueue.then(
      () => executeRelocate(ownerId, hosted, request.targetPathname)
    )
    hosted.saveQueue = operation.then(
      () => {},
      () => {}
    )
    return operation
  }

  const describe = (
    ownerId: string,
    documentId: string
  ): DocumentCoreFileDescription => {
    assertUsable()
    const hosted = hostedFor(documentId)
    assertOwner(hosted, ownerId)
    return Object.freeze({
      documentId,
      filename: hosted.filename,
      pathname: hosted.pathname
    })
  }

  const descriptionsUnderPath = (
    ownerId: string,
    directoryPathname: string
  ): readonly DocumentCoreFileDescription[] => {
    assertUsable()
    nonemptyIdentifier(ownerId, 'ownerId')
    nonemptyIdentifier(directoryPathname, 'directoryPathname')
    return Object.freeze(
      [...files.values()]
        .filter(hosted =>
          hosted.ownerId === ownerId &&
          hosted.pathname !== null &&
          pathIsInside(directoryPathname, hosted.pathname)
        )
        .map(hosted => Object.freeze({
          documentId: hosted.documentId,
          filename: hosted.filename,
          pathname: hosted.pathname
        }))
    )
  }

  const inspectOwned = async(
    ownerId: string
  ): Promise<readonly DocumentCoreFileInspection[]> => {
    assertUsable()
    nonemptyIdentifier(ownerId, 'ownerId')
    return Object.freeze(await Promise.all(
      [...files.values()]
        .filter(hosted => hosted.ownerId === ownerId)
        .map(async(hosted) => Object.freeze({
          documentId: hosted.documentId,
          filename: hosted.filename,
          pathname: hosted.pathname,
          historyState: await sessions.readHistoryState(
            ownerId,
            hosted.documentId
          )
        }))
    ))
  }

  const readAdmission = (
    documentId: string
  ): DocumentCoreOpenCompletion => {
    assertUsable()
    const admission = hostedFor(documentId).admission
    if (admission === null) {
      throw new Error(`Document ${documentId} has not completed admission`)
    }
    return admission
  }

  const readAdmissionPerformance = (
    documentId: string
  ): DocumentCoreFileAdmissionPerformance => {
    assertUsable()
    const admissionPerformance = hostedFor(documentId).admissionPerformance
    if (admissionPerformance === null) {
      throw new Error(
        `Document ${documentId} has no completed admission performance`
      )
    }
    return admissionPerformance
  }

  const closeHosted = (
    hosted: HostedFile,
    ownerId?: string,
    removeMetadata = false
  ): Promise<void> => {
    if (hosted.closeOperation !== null) {
      return hosted.closeOperation
    }
    if (ownerId !== undefined) {
      assertOwner(hosted, ownerId)
    }
    const operation = (async() => {
      await hosted.saveQueue
      if (ownerId === undefined) {
        try {
          await sessions.terminate(hosted.documentId)
        } finally {
          releasePhysicalIdentity(hosted)
          unindexPath(hosted)
          files.delete(hosted.documentId)
        }
        return
      }
      if (removeMetadata) {
        await metadataStorage.remove(hosted.documentId)
      }
      await sessions.close(ownerId, hosted.documentId)
      releasePhysicalIdentity(hosted)
      unindexPath(hosted)
      files.delete(hosted.documentId)
    })()
    hosted.closeOperation = operation
    operation.catch(() => {
      if (hosted.closeOperation === operation) {
        hosted.closeOperation = null
      }
    })
    return operation
  }

  const close = async(
    ownerId: string,
    documentId: string
  ): Promise<void> => {
    assertUsable()
    const hosted = files.get(documentId)
    if (hosted === undefined) {
      return
    }
    await closeHosted(hosted, ownerId, true)
  }

  const dispose = (): Promise<void> => {
    if (disposeOperation !== null) {
      return disposeOperation
    }
    disposed = true
    disposeOperation = Promise.allSettled(
      [...files.values()].map(hosted =>
        closeHosted(hosted)
      )
    ).then(results => {
      const rejected = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected'
      )
      if (rejected !== undefined) {
        throw rejected.reason
      }
    })
    return disposeOperation
  }

  return Object.freeze({
    open,
    recover,
    recoveryWindows,
    reload,
    resolveExternalChange,
    documentIdForPath,
    attach,
    save,
    relocate,
    describe,
    inspectOwned,
    descriptionsUnderPath,
    readAdmission,
    readAdmissionPerformance,
    close,
    dispose
  })
}
