import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDurableDocumentFileMetadataStorage } from 'main_renderer/documentCore/durableDocumentFileMetadataStorage'
import type { DocumentCoreFileMetadata } from 'main_renderer/documentCore/documentFileHost'

const directories: string[] = []

afterEach(async() => {
  await Promise.all(directories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'marktext-file-metadata-'))
  directories.push(root)
  return {
    root,
    storage: createDurableDocumentFileMetadataStorage(root)
  }
}

const metadata = Object.freeze({
  schema: 'document-core-file-metadata-2',
  documentId: 'document:1',
  durableWindowId: 'window-buffer:1',
  filename: 'note.md',
  pathname: '/tmp/note.md',
  defaultDirectory: '/tmp',
  encoding: 'utf-8',
  baseByteHash: 'a'.repeat(64),
  physicalIdentity: Object.freeze({
    schema: 'document-core-physical-file-identity-1',
    canonicalPathname: '/tmp/note.md',
    device: '1',
    inode: '2'
  })
}) satisfies DocumentCoreFileMetadata

describe('durable document file metadata storage', () => {
  it('round-trips a closed main-owned record and removes it explicitly', async() => {
    const { storage } = await harness()

    await storage.write(metadata)
    expect(await storage.read(metadata.documentId)).toEqual(metadata)
    expect(await storage.list()).toEqual([metadata])
    await storage.remove(metadata.documentId)
    expect(await storage.read(metadata.documentId)).toBeNull()
  })

  it('fails closed on a corrupt or identity-swapped record', async() => {
    const { root, storage } = await harness()
    await storage.write(metadata)
    const [pathname] = await readdir(root)
    if (pathname === undefined) throw new Error('metadata file missing')
    const absolute = join(root, pathname)
    const stored = await readFile(absolute, 'utf8')
    const envelope = JSON.parse(stored) as {
      schema: string
      body: string
      checksum: string
    }
    envelope.body = envelope.body.replace('document:1', 'document:2')
    await writeFile(absolute, JSON.stringify(envelope))

    await expect(storage.read(metadata.documentId)).rejects.toThrow(
      /invalid|corrupt/i
    )
  })

  it('rejects open-ended registry records before durable publication', async() => {
    const { storage } = await harness()

    await expect(storage.write({
      ...metadata,
      ignored: true
    } as never)).rejects.toThrow(/invalid|closed/i)
    await expect(storage.write({
      ...metadata,
      physicalIdentity: {
        ...metadata.physicalIdentity,
        alias: '/tmp/other.md'
      }
    } as never)).rejects.toThrow(/invalid|closed/i)
    await expect(storage.list()).resolves.toEqual([])
  })

  it('rejects a relative storage directory', () => {
    expect(() => createDurableDocumentFileMetadataStorage('relative'))
      .toThrow(/absolute/i)
  })
})
