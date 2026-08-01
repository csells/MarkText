import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat
} from 'node:fs/promises'
import path from 'node:path'
import type {
  DocumentSessionJournalCommit,
  DocumentSessionJournalContent,
  DocumentSessionJournalMutation,
  DocumentSessionJournalStorage,
  DocumentSessionJournalValue
} from '@marktext/document-core'

const STORAGE_SCHEMA = 'marktext-file-session-journal-v1'
const CONTENT_SCHEMA = 'marktext-file-session-journal-content-v1'
const MAX_KEY_UNITS = 1024
const MAX_RECORD_UNITS = 4 * 1024 * 1024
const MAX_CONTENT_UNITS = 32_000_000
const LOCK_STALE_MS = 30_000
const LOCK_WAIT_MS = 5_000

interface StoredJournalRecord {
  readonly schema: typeof STORAGE_SCHEMA
  readonly key: string
  readonly revision: number
  readonly data: string
  readonly contentIds: readonly string[]
  readonly checksum: string
}

interface StoredContentHeader {
  readonly schema: typeof CONTENT_SCHEMA
  readonly key: string
  readonly id: string
  readonly units: number
  readonly checksum: string
}

function validateKey(key: string): void {
  if (key.length === 0 || key.length > MAX_KEY_UNITS) {
    throw new TypeError('Document session journal key is empty or too large')
  }
}

function filenameFor(key: string): string {
  return `${createHash('sha256').update(key, 'utf8').digest('hex')}.journal`
}

function contentFilenameFor(key: string, id: string): string {
  const keyHash = createHash('sha256').update(key, 'utf8').digest('hex')
  const idHash = createHash('sha256').update(id, 'utf8').digest('hex')
  return `${keyHash}.${idHash}.content`
}

function validateContentId(id: string): void {
  if (
    id.length === 0 ||
    id.length > 160 ||
    !/^[A-Za-z0-9._:-]+$/.test(id)
  ) {
    throw new TypeError('Document session journal content id is invalid')
  }
}

function checksumOf(
  key: string,
  revision: number,
  data: string,
  contentIds: readonly string[]
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([STORAGE_SCHEMA, key, revision, data, contentIds]),
      'utf8'
    )
    .digest('hex')
}

function contentChecksumOf(key: string, id: string, data: string): string {
  return createHash('sha256')
    .update(CONTENT_SCHEMA, 'utf8')
    .update('\0', 'utf8')
    .update(key, 'utf8')
    .update('\0', 'utf8')
    .update(id, 'utf8')
    .update('\0', 'utf8')
    .update(data, 'utf8')
    .digest('hex')
}

function encodeRecord(
  key: string,
  revision: number,
  data: string,
  contentIds: readonly string[]
): string {
  const traceStall = process.env.MARKTEXT_STALL_TRACE
  const startedAt = traceStall ? performance.now() : 0
  const encoded = JSON.stringify({
    schema: STORAGE_SCHEMA,
    key,
    revision,
    data,
    contentIds,
    checksum: checksumOf(key, revision, data, contentIds)
  } satisfies StoredJournalRecord)
  if (traceStall) {
    const elapsed = performance.now() - startedAt
    if (elapsed > 20) {
      appendFileSync(
        traceStall,
        JSON.stringify({
          span: `main:journalEncode:${key}`,
          ms: elapsed,
          at: performance.now(),
          bytes: data.length
        }) + '\n'
      )
    }
  }
  return encoded
}

function decodeRecord(source: string, key: string): StoredJournalRecord {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new Error('Document session journal is corrupt JSON', { cause: error })
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schema' in value) ||
    value.schema !== STORAGE_SCHEMA ||
    !('key' in value) ||
    value.key !== key ||
    !('revision' in value) ||
    !Number.isInteger(value.revision) ||
    Number(value.revision) <= 0 ||
    !('data' in value) ||
    typeof value.data !== 'string' ||
    !('contentIds' in value) ||
    !Array.isArray(value.contentIds) ||
    value.contentIds.some(
      id => typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(id)
    ) ||
    new Set(value.contentIds).size !== value.contentIds.length ||
    !('checksum' in value) ||
    typeof value.checksum !== 'string' ||
    value.checksum !== checksumOf(
      key,
      Number(value.revision),
      value.data,
      value.contentIds as string[]
    )
  ) {
    throw new Error('Document session journal has an invalid shape or checksum')
  }
  return Object.freeze({
    schema: STORAGE_SCHEMA,
    key,
    revision: Number(value.revision),
    data: value.data,
    contentIds: Object.freeze([...(value.contentIds as string[])]),
    checksum: value.checksum
  })
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

async function readStoredRecord(
  pathname: string,
  key: string
): Promise<StoredJournalRecord | null> {
  let source: string
  try {
    source = await readFile(pathname, 'utf8')
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
  return decodeRecord(source, key)
}

function encodeContentHeader(
  key: string,
  content: DocumentSessionJournalContent
): string {
  return JSON.stringify({
    schema: CONTENT_SCHEMA,
    key,
    id: content.id,
    units: content.data.length,
    checksum: contentChecksumOf(key, content.id, content.data)
  } satisfies StoredContentHeader) + '\n'
}

function decodeContent(
  source: string,
  key: string,
  id: string
): DocumentSessionJournalContent {
  const separator = source.indexOf('\n')
  if (separator <= 0 || separator > 4_096) {
    throw new Error('Document session journal content has an invalid header')
  }
  let header: unknown
  try {
    header = JSON.parse(source.slice(0, separator)) as unknown
  } catch (error) {
    throw new Error('Document session journal content header is corrupt', {
      cause: error
    })
  }
  const data = source.slice(separator + 1)
  if (
    typeof header !== 'object' ||
    header === null ||
    !('schema' in header) ||
    header.schema !== CONTENT_SCHEMA ||
    !('key' in header) ||
    header.key !== key ||
    !('id' in header) ||
    header.id !== id ||
    !('units' in header) ||
    header.units !== data.length ||
    data.length > MAX_CONTENT_UNITS ||
    !('checksum' in header) ||
    typeof header.checksum !== 'string' ||
    header.checksum !== contentChecksumOf(key, id, data)
  ) {
    throw new Error(
      'Document session journal content has an invalid shape or checksum'
    )
  }
  return Object.freeze({ id, data })
}

async function readContent(
  directory: string,
  key: string,
  id: string
): Promise<DocumentSessionJournalContent> {
  const pathname = path.join(directory, contentFilenameFor(key, id))
  let source: string
  try {
    source = await readFile(pathname, 'utf8')
  } catch (error) {
    if (isMissing(error)) {
      throw new Error('Document session journal content is missing', {
        cause: error
      })
    }
    throw error
  }
  return decodeContent(source, key, id)
}

async function durableReplace(
  pathname: string,
  sources: readonly string[]
): Promise<void> {
  const directory = path.dirname(pathname)
  const temporary = `${pathname}.${String(process.pid)}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    for (const source of sources) {
      await handle.writeFile(source, 'utf8')
    }
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, pathname)
    // Renaming a synced file is not power-loss durable until its directory
    // entry is synced as well. POSIX supports this directly. Windows rejects
    // directory handles; its rename path supplies the platform's atomic
    // replacement guarantee, while corruption is still fail-closed on reopen.
    try {
      const directoryHandle = await open(directory, 'r')
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
  } finally {
    await rm(temporary, { force: true })
  }
}

async function readStored(
  directory: string,
  key: string
): Promise<DocumentSessionJournalValue | null> {
  const record = await readStoredRecord(
    path.join(directory, filenameFor(key)),
    key
  )
  if (record === null) return null
  const contents = await Promise.all(
    record.contentIds.map(id => readContent(directory, key, id))
  )
  return Object.freeze({
    revision: record.revision,
    data: record.data,
    contents: Object.freeze(contents)
  })
}

async function processIsAlive(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EPERM'
    )
  }
}

async function staleLock(lockPath: string): Promise<boolean> {
  let lockStat
  try {
    lockStat = await stat(lockPath)
  } catch (error) {
    return isMissing(error)
  }
  if (Date.now() - lockStat.mtimeMs <= LOCK_STALE_MS) return false
  try {
    const owner = JSON.parse(
      await readFile(path.join(lockPath, 'owner.json'), 'utf8')
    ) as { pid?: unknown }
    return !(await processIsAlive(Number(owner.pid)))
  } catch {
    return true
  }
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      await mkdir(lockPath)
      const owner = await open(path.join(lockPath, 'owner.json'), 'wx', 0o600)
      try {
        await owner.writeFile(JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString()
        }), 'utf8')
        await owner.sync()
      } finally {
        await owner.close()
      }
      return async() => rm(lockPath, { recursive: true, force: true })
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      ) {
        throw error
      }
      if (await staleLock(lockPath)) {
        await rm(lockPath, { recursive: true, force: true })
        continue
      }
      if (Date.now() >= deadline) {
        throw new Error('Timed out acquiring the document session journal lock')
      }
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }
}

/**
 * Main-process, crash-safe storage for one or more durable DocumentSessions.
 *
 * A hashed filename prevents a document identity from escaping the owned
 * directory. Each CAS is linearized by an inter-process lock; a synced temp
 * file is atomically renamed and corruption is never interpreted as absence.
 */
export function createFileDocumentSessionJournalStorage(
  directory: string
): DocumentSessionJournalStorage {
  if (!path.isAbsolute(directory)) {
    throw new TypeError('Document session journal directory must be absolute')
  }
  return Object.freeze({
    async read(key: string): Promise<DocumentSessionJournalValue | null> {
      validateKey(key)
      await mkdir(directory, { recursive: true })
      return readStored(directory, key)
    },

    async compareExchange(
      key: string,
      expectedRevision: number | null,
      mutation: DocumentSessionJournalMutation
    ): Promise<DocumentSessionJournalCommit | null> {
      validateKey(key)
      if (
        expectedRevision !== null &&
        (!Number.isInteger(expectedRevision) || expectedRevision <= 0)
      ) {
        throw new TypeError('Expected journal revision is invalid')
      }
      if (mutation.data.length > MAX_RECORD_UNITS) {
        throw new RangeError('Document session journal record is too large')
      }
      const retainedContentIds = [...mutation.retainedContentIds]
      const retained = new Set(retainedContentIds)
      if (retained.size !== retainedContentIds.length) {
        throw new TypeError(
          'Document session journal retained duplicate content ids'
        )
      }
      for (const id of retained) validateContentId(id)
      const writes = new Map<string, string>()
      for (const content of mutation.contents) {
        validateContentId(content.id)
        if (
          content.data.length < 64 * 1024 ||
          content.data.length > MAX_CONTENT_UNITS
        ) {
          throw new RangeError('Document session journal content is too large')
        }
        const existing = writes.get(content.id)
        if (existing !== undefined && existing !== content.data) {
          throw new Error('Document session journal content id changed data')
        }
        writes.set(content.id, content.data)
      }
      if ([...writes.keys()].some(id => !retained.has(id))) {
        throw new Error('Document session journal wrote unreachable content')
      }
      await mkdir(directory, { recursive: true })
      const pathname = path.join(directory, filenameFor(key))
      const release = await acquireLock(`${pathname}.lock`)
      try {
        const current = await readStoredRecord(pathname, key)
        if ((current?.revision ?? null) !== expectedRevision) return null
        const currentIds = new Set(current?.contentIds ?? [])
        for (const id of retained) {
          const data = writes.get(id)
          if (data !== undefined) {
            const contentPath = path.join(
              directory,
              contentFilenameFor(key, id)
            )
            if (currentIds.has(id)) {
              const currentContent = await readContent(directory, key, id)
              if (currentContent.data !== data) {
                throw new Error(
                  'Document session journal content id changed data'
                )
              }
            } else {
              await durableReplace(contentPath, [
                encodeContentHeader(key, Object.freeze({ id, data })),
                data
              ])
            }
          } else if (!currentIds.has(id)) {
            throw new Error(
              'Document session journal retained missing content'
            )
          }
        }
        const next = Object.freeze({
          revision: (current?.revision ?? 0) + 1
        })
        await durableReplace(
          pathname,
          [
            encodeRecord(
              key,
              next.revision,
              mutation.data,
              retainedContentIds
            )
          ]
        )
        const keyPrefix =
          `${createHash('sha256').update(key, 'utf8').digest('hex')}.`
        const retainedFiles = new Set(
          retainedContentIds.map(id => contentFilenameFor(key, id))
        )
        const entries = await readdir(directory)
        await Promise.all(
          entries
            .filter(
              name =>
                name.startsWith(keyPrefix) &&
                name.endsWith('.content') &&
                !retainedFiles.has(name)
            )
            .map(name => rm(path.join(directory, name), { force: true }))
        )
        return next
      } finally {
        await release()
      }
    }
  })
}
