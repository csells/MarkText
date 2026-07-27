import {
  BrowserWindow,
  webContents
} from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  stat
} from 'node:fs/promises'
import { move } from 'fs-extra'
import {
  decodeFileSnapshot,
  type FileEncodingV1
} from '@marktext/document-core'
import { presentationPolicy } from '../presentationPolicy'
import type {
  DocumentCoreFileMove,
  DocumentCoreFileSurface,
  DocumentCorePhysicalFileIdentity,
  DocumentCoreSavePathRequest
} from './documentFileHost'
import {
  decodeDocumentCoreFileCompareExchangeRequest,
  documentCoreFileByteHash,
  type DocumentCoreFileCompareExchangeRequest
} from './documentFileCompareExchange'
import { documentFileNativeFilesystem } from './documentFileNativeFilesystem'

function senderId(ownerId: string): number {
  const match = /^renderer:([1-9][0-9]*)$/.exec(ownerId)
  if (match === null) {
    throw new TypeError(`Invalid renderer owner ${ownerId}`)
  }
  return Number(match[1])
}

function saveDialogOptions(
  request: DocumentCoreSavePathRequest
): Electron.SaveDialogOptions {
  const startingPath = request.pathname ?? path.join(
    request.defaultDirectory,
    request.filename.toLowerCase().endsWith('.md')
      ? request.filename
      : `${request.filename}.md`
  )
  return {
    defaultPath: startingPath,
    filters: [{
      name: 'Markdown document',
      extensions: ['md', 'markdown', 'mdown', 'mkdn']
    }]
  }
}

export function resolveMarkdownSavePath(pathname: string): string {
  const resolved = path.resolve(pathname)
  return path.extname(resolved).length === 0 ? `${resolved}.md` : resolved
}

async function readExactBytes(pathname: string): Promise<Uint8Array | null> {
  try {
    return Uint8Array.from(await readFile(path.resolve(pathname)))
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null
    }
    throw error
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

function isIgnorableOwnershipError(error: unknown): boolean {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('code' in error)
  ) {
    return false
  }
  if (error.code === 'ENOSYS') return true
  return (
    typeof process.getuid === 'function' &&
    process.getuid() !== 0 &&
    (
      error.code === 'EINVAL' ||
      error.code === 'EPERM'
    )
  )
}

async function resolvedMutationTarget(pathname: string): Promise<string> {
  const resolved = path.resolve(pathname)
  try {
    return await realpath(resolved)
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
  try {
    return path.join(
      await realpath(path.dirname(resolved)),
      path.basename(resolved)
    )
  } catch (error) {
    if (!isMissingFile(error)) throw error
    return resolved
  }
}

function sameMutationTarget(first: string, second: string): boolean {
  return process.platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second
}

function mutationPathLockKey(pathname: string): string {
  const normalized = path
    .normalize(path.resolve(pathname))
    .normalize('NFC')
    .toLowerCase()
  return `path:${normalized}`
}

interface ResolvedMutationIdentity {
  readonly targetPathname: string
  readonly lockKeys: readonly string[]
}

async function resolvedMutationIdentity(
  pathname: string
): Promise<ResolvedMutationIdentity> {
  const targetPathname = await resolvedMutationTarget(pathname)
  const lockKeys = [mutationPathLockKey(targetPathname)]
  try {
    const targetStats = await stat(targetPathname, { bigint: true })
    if (targetStats.ino !== 0n) {
      lockKeys.push(`inode:${targetStats.dev}:${targetStats.ino}`)
    }
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
  return Object.freeze({
    targetPathname,
    lockKeys: Object.freeze(lockKeys)
  })
}

async function syncContainingDirectory(pathname: string): Promise<void> {
  try {
    const directoryHandle = await open(path.dirname(pathname), 'r')
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
  } catch (error) {
    if (
      process.platform !== 'win32' ||
      (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        !['EISDIR', 'EINVAL', 'EPERM'].includes(String(error.code))
      )
    ) {
      throw error
    }
  }
}

interface PreparedReplacement {
  readonly targetPathname: string
  readonly temporaryPathname: string
}

async function prepareReplacement(
  targetPathname: string,
  bytes: Uint8Array
): Promise<PreparedReplacement> {
  let targetStats: Awaited<ReturnType<typeof stat>> | null
  try {
    targetStats = await stat(targetPathname)
  } catch (error) {
    if (!isMissingFile(error)) throw error
    targetStats = null
  }
  const temporaryPathname = [
    targetPathname,
    String(process.pid),
    randomUUID(),
    'tmp'
  ].join('.')
  const handle = await open(
    temporaryPathname,
    'wx',
    targetStats?.mode ?? 0o666
  )
  try {
    await handle.writeFile(bytes)
    if (
      targetStats !== null &&
      typeof process.getuid === 'function'
    ) {
      try {
        await handle.chown(targetStats.uid, targetStats.gid)
      } catch (error) {
        if (!isIgnorableOwnershipError(error)) throw error
      }
    }
    if (targetStats !== null) {
      try {
        await handle.chmod(targetStats.mode)
      } catch (error) {
        if (!isIgnorableOwnershipError(error)) throw error
      }
    }
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => {})
    await rm(temporaryPathname, { force: true }).catch(() => {})
    throw error
  }
  try {
    await handle.close()
  } catch (error) {
    await rm(temporaryPathname, { force: true }).catch(() => {})
    throw error
  }
  return Object.freeze({
    targetPathname,
    temporaryPathname
  })
}

/**
 * Native file surface for the main-owned document transaction.
 *
 * Paths originate either in the retained main description or in this native
 * dialog. The renderer never contributes a path, source string, encoding
 * option, or claimed revision to a write.
 *
 * Compare-exchanges for one canonically resolved path are linearized in this
 * process. Existing hard-link aliases also share a portable device/inode lock
 * when the filesystem supplies a nonzero inode. Replacement bytes and retained
 * mode/owner metadata are prepared and synced first. The target byte identity
 * and symlink resolution are then checked immediately before rename. The
 * renamed entry's directory is synced on POSIX; Windows does not expose a
 * portable directory-fsync path here.
 *
 * Atomic rename replaces one directory entry, not every name in a hard-link
 * set. Consequently, two queued exchanges through distinct hard-link names can
 * both succeed sequentially after the first rename separates those names.
 *
 * Portable Node filesystems still do not expose a kernel primitive that
 * conditionally renames only when arbitrary file bytes match, so an
 * uncooperative external process can race in the final
 * read-to-mutation-syscall interval.
 */
export function createElectronDocumentCoreFileSurface():
DocumentCoreFileSurface {
  const mutationTails = new Map<string, Promise<void>>()
  const inMutationTurn = async<Result>(
    rawLockKeys: readonly string[],
    operation: () => Promise<Result>
  ): Promise<Result> => {
    const lockKeys = [...new Set(rawLockKeys)].sort()
    const predecessors = lockKeys
      .map(lockKey => mutationTails.get(lockKey))
      .filter((predecessor): predecessor is Promise<void> =>
        predecessor !== undefined
      )
    let releaseTurn: (() => void) | undefined
    const turn = new Promise<void>(resolve => {
      releaseTurn = resolve
    })
    for (const lockKey of lockKeys) {
      mutationTails.set(lockKey, turn)
    }
    await Promise.all(predecessors)
    try {
      return await operation()
    } finally {
      releaseTurn?.()
      for (const lockKey of lockKeys) {
        if (mutationTails.get(lockKey) === turn) {
          mutationTails.delete(lockKey)
        }
      }
    }
  }

  return Object.freeze({
    chooseSavePath: async(request: DocumentCoreSavePathRequest) => {
      const sender = webContents.fromId(senderId(request.ownerId))
      if (sender === undefined || sender.isDestroyed()) {
        throw new Error(`Renderer owner ${request.ownerId} is unavailable`)
      }
      const window = BrowserWindow.fromWebContents(sender)
      const options = saveDialogOptions(request)
      const response = window === null
        ? await presentationPolicy.showSaveDialog(options)
        : await presentationPolicy.showSaveDialog(window, options)
      if (response.canceled || response.filePath === undefined) {
        return null
      }
      return resolveMarkdownSavePath(response.filePath)
    },
    move: async(request: DocumentCoreFileMove) => {
      await move(
        path.resolve(request.sourcePathname),
        path.resolve(request.targetPathname),
        { overwrite: false }
      )
    },
    read: async(pathname: string, encoding: FileEncodingV1) => {
      try {
        return decodeFileSnapshot(
          await readFile(path.resolve(pathname)),
          encoding
        )
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return null
        }
        throw error
      }
    },
    readBytes: readExactBytes,
    identify: async(
      pathname: string
    ): Promise<DocumentCorePhysicalFileIdentity | null> => {
      let canonicalPathname: string
      try {
        canonicalPathname = await realpath(path.resolve(pathname))
      } catch (error) {
        if (isMissingFile(error)) return null
        throw error
      }
      const identity = await stat(canonicalPathname, { bigint: true })
      return Object.freeze({
        schema: 'document-core-physical-file-identity-1',
        canonicalPathname,
        device: String(identity.dev),
        inode: String(identity.ino)
      })
    },
    compareExchange: async(
      rawRequest: DocumentCoreFileCompareExchangeRequest
    ) => {
      const request = decodeDocumentCoreFileCompareExchangeRequest(rawRequest)
      const requestedPathname = path.resolve(request.pathname)
      if (request.bytes !== null) {
        await mkdir(path.dirname(requestedPathname), { recursive: true })
      }
      const admittedIdentity = await resolvedMutationIdentity(requestedPathname)
      return await inMutationTurn(admittedIdentity.lockKeys, async() => {
        if (request.bytes === null) {
          const finalIdentity = await resolvedMutationIdentity(
            requestedPathname
          )
          const currentBytes = await readExactBytes(
            finalIdentity.targetPathname
          )
          const actualByteHash = documentCoreFileByteHash(currentBytes)
          if (
            !sameMutationTarget(
              admittedIdentity.targetPathname,
              finalIdentity.targetPathname
            ) ||
            actualByteHash !== request.expectedByteHash
          ) {
            return Object.freeze({
              schema: 'document-core-file-compare-exchange-result-1' as const,
              kind: 'conflict' as const,
              actualByteHash
            })
          }
          if (currentBytes !== null) {
            await rm(finalIdentity.targetPathname)
            await syncContainingDirectory(finalIdentity.targetPathname)
          }
          return Object.freeze({
            schema: 'document-core-file-compare-exchange-result-1' as const,
            kind: 'exchanged' as const,
            previousByteHash: actualByteHash
          })
        }
        const prepared = await prepareReplacement(
          admittedIdentity.targetPathname,
          request.bytes
        )
        try {
          const finalIdentity = await resolvedMutationIdentity(
            requestedPathname
          )
          const currentBytes = await readExactBytes(
            finalIdentity.targetPathname
          )
          const actualByteHash = documentCoreFileByteHash(currentBytes)
          if (
            !sameMutationTarget(
              prepared.targetPathname,
              finalIdentity.targetPathname
            ) ||
            actualByteHash !== request.expectedByteHash
          ) {
            return Object.freeze({
              schema: 'document-core-file-compare-exchange-result-1' as const,
              kind: 'conflict' as const,
              actualByteHash
            })
          }
          await documentFileNativeFilesystem.rename(
            prepared.temporaryPathname,
            prepared.targetPathname
          )
          await syncContainingDirectory(prepared.targetPathname)
          return Object.freeze({
            schema: 'document-core-file-compare-exchange-result-1' as const,
            kind: 'exchanged' as const,
            previousByteHash: actualByteHash
          })
        } finally {
          await rm(prepared.temporaryPathname, { force: true }).catch(() => {})
        }
      })
    }
  })
}
