import { createHash } from 'node:crypto'
import {
  mkdir,
  open,
  readFile,
  readdir,
  rm
} from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import type {
  DocumentCoreFileMetadata,
  DocumentCoreFileMetadataStorage
} from './documentFileHost'

const STORAGE_SCHEMA = 'document-core-file-metadata-storage-2'

interface StoredMetadataEnvelope {
  readonly schema: typeof STORAGE_SCHEMA
  readonly body: string
  readonly checksum: string
}

function metadataPath(directory: string, documentId: string): string {
  const name = createHash('sha256')
    .update(documentId, 'utf8')
    .digest('hex')
  return path.join(directory, `${name}.metadata`)
}

function checksum(body: string): string {
  return createHash('sha256')
    .update(JSON.stringify([STORAGE_SCHEMA, body]), 'utf8')
    .digest('hex')
}

function encode(metadata: DocumentCoreFileMetadata): string {
  const body = JSON.stringify(metadata)
  return JSON.stringify({
    schema: STORAGE_SCHEMA,
    body,
    checksum: checksum(body)
  } satisfies StoredMetadataEnvelope)
}

function decode(
  source: string,
  expectedDocumentId: string | null
): DocumentCoreFileMetadata {
  let envelope: unknown
  try {
    envelope = JSON.parse(source)
  } catch (error) {
    throw new Error('Document file metadata is corrupt JSON', { cause: error })
  }
  if (
    envelope === null ||
    typeof envelope !== 'object' ||
    Reflect.ownKeys(envelope).length !== 3 ||
    !('schema' in envelope) ||
    envelope.schema !== STORAGE_SCHEMA ||
    !('body' in envelope) ||
    typeof envelope.body !== 'string' ||
    !('checksum' in envelope) ||
    typeof envelope.checksum !== 'string' ||
    envelope.checksum !== checksum(envelope.body)
  ) {
    throw new Error('Document file metadata envelope is invalid')
  }
  let metadata: unknown
  try {
    metadata = JSON.parse(envelope.body)
  } catch (error) {
    throw new Error('Document file metadata body is corrupt JSON', {
      cause: error
    })
  }
  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    Reflect.ownKeys(metadata).length !== 9 ||
    !('schema' in metadata) ||
    metadata.schema !== 'document-core-file-metadata-2' ||
    !('documentId' in metadata) ||
    typeof metadata.documentId !== 'string' ||
    (
      expectedDocumentId !== null &&
      metadata.documentId !== expectedDocumentId
    ) ||
    !('durableWindowId' in metadata) ||
    typeof metadata.durableWindowId !== 'string' ||
    !('filename' in metadata) ||
    typeof metadata.filename !== 'string' ||
    !('pathname' in metadata) ||
    (
      metadata.pathname !== null &&
      typeof metadata.pathname !== 'string'
    ) ||
    !('defaultDirectory' in metadata) ||
    typeof metadata.defaultDirectory !== 'string' ||
    !('encoding' in metadata) ||
    (
      metadata.encoding !== 'utf-8' &&
      metadata.encoding !== 'utf-16le' &&
      metadata.encoding !== 'utf-16be'
    ) ||
    !('baseByteHash' in metadata) ||
    typeof metadata.baseByteHash !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(metadata.baseByteHash) ||
    !('physicalIdentity' in metadata) ||
    (
      metadata.physicalIdentity !== null &&
      (
        typeof metadata.physicalIdentity !== 'object' ||
        Reflect.ownKeys(metadata.physicalIdentity).length !== 4 ||
        !('schema' in metadata.physicalIdentity) ||
        metadata.physicalIdentity.schema !==
          'document-core-physical-file-identity-1' ||
        !('canonicalPathname' in metadata.physicalIdentity) ||
        typeof metadata.physicalIdentity.canonicalPathname !== 'string' ||
        metadata.physicalIdentity.canonicalPathname.length === 0 ||
        !('device' in metadata.physicalIdentity) ||
        typeof metadata.physicalIdentity.device !== 'string' ||
        !/^[0-9]+$/u.test(metadata.physicalIdentity.device) ||
        !('inode' in metadata.physicalIdentity) ||
        typeof metadata.physicalIdentity.inode !== 'string' ||
        !/^[0-9]+$/u.test(metadata.physicalIdentity.inode)
      )
    )
  ) {
    throw new Error('Document file metadata body is invalid')
  }
  const physicalIdentity = metadata.physicalIdentity as null | {
    schema: 'document-core-physical-file-identity-1'
    canonicalPathname: string
    device: string
    inode: string
  }
  return Object.freeze({
    schema: metadata.schema,
    documentId: metadata.documentId,
    durableWindowId: metadata.durableWindowId,
    filename: metadata.filename,
    pathname: metadata.pathname,
    defaultDirectory: metadata.defaultDirectory,
    encoding: metadata.encoding,
    baseByteHash: metadata.baseByteHash,
    physicalIdentity: physicalIdentity === null
      ? null
      : Object.freeze({
        schema: physicalIdentity.schema,
        canonicalPathname: physicalIdentity.canonicalPathname,
        device: physicalIdentity.device,
        inode: physicalIdentity.inode
      })
  })
}

function missing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (
      process.platform === 'win32' &&
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      ['EISDIR', 'EINVAL', 'EPERM'].includes(String(error.code))
    ) {
      return
    }
    throw error
  }
}

export function createDurableDocumentFileMetadataStorage(
  directory: string
): DocumentCoreFileMetadataStorage {
  if (!path.isAbsolute(directory)) {
    throw new TypeError('Document file metadata directory must be absolute')
  }
  return Object.freeze({
    async list(): Promise<readonly DocumentCoreFileMetadata[]> {
      let entries: string[]
      try {
        entries = await readdir(directory)
      } catch (error) {
        if (missing(error)) return Object.freeze([])
        throw error
      }
      const records = []
      for (const entry of entries.sort()) {
        if (!entry.endsWith('.metadata')) continue
        const source = await readFile(path.join(directory, entry), 'utf8')
        const metadata = decode(source, null)
        if (path.basename(metadataPath(directory, metadata.documentId)) !== entry) {
          throw new Error('Document file metadata identity is swapped')
        }
        records.push(metadata)
      }
      return Object.freeze(records)
    },
    async read(
      documentId: string
    ): Promise<DocumentCoreFileMetadata | null> {
      let source: string
      try {
        source = await readFile(
          metadataPath(directory, documentId),
          'utf8'
        )
      } catch (error) {
        if (missing(error)) return null
        throw error
      }
      return decode(source, documentId)
    },
    async write(metadata: DocumentCoreFileMetadata): Promise<void> {
      const validated = decode(encode(metadata), null)
      await mkdir(directory, { recursive: true })
      await writeFileAtomic(
        metadataPath(directory, validated.documentId),
        encode(validated),
        {
          encoding: 'utf8',
          mode: 0o600
        }
      )
      await syncDirectory(directory)
    },
    async remove(documentId: string): Promise<void> {
      await rm(metadataPath(directory, documentId), { force: true })
      try {
        await syncDirectory(directory)
      } catch (error) {
        if (!missing(error)) throw error
      }
    }
  })
}
