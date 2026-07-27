import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  DocumentSessionJournalContent,
  DocumentSessionJournalMutation
} from '@marktext/document-core'
import { createFileDocumentSessionJournalStorage } from 'main_renderer/documentCore/durableSessionJournalStorage'

const directories: string[] = []

function mutation(
  data: string,
  contents: readonly DocumentSessionJournalContent[] = [],
  retainedContentIds: readonly string[] = contents.map(content => content.id)
): DocumentSessionJournalMutation {
  return Object.freeze({
    data,
    contents: Object.freeze([...contents]),
    retainedContentIds: Object.freeze([...retainedContentIds])
  })
}

afterEach(async() => {
  await Promise.all(directories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ))
})

describe('main-process durable DocumentSession journal storage', () => {
  it('linearizes CAS across owners and recovers only complete fsynced records', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-session-journal-'))
    directories.push(directory)
    const first = createFileDocumentSessionJournalStorage(directory)
    const second = createFileDocumentSessionJournalStorage(directory)

    await expect(first.read('document:one')).resolves.toBeNull()
    await expect(first.compareExchange(
      'document:one',
      null,
      mutation('checkpoint-one')
    )).resolves.toEqual({
      revision: 1
    })
    await expect(second.compareExchange(
      'document:one',
      null,
      mutation('stale')
    )).resolves.toBeNull()
    await expect(second.compareExchange(
      'document:one',
      1,
      mutation('checkpoint-two')
    )).resolves.toEqual({
      revision: 2
    })
    await expect(first.read('document:one')).resolves.toEqual({
      revision: 2,
      data: 'checkpoint-two',
      contents: []
    })

    const entries = await readdir(directory)
    expect(entries.filter(name => name.endsWith('.journal'))).toHaveLength(1)
    expect(entries.some(name =>
      name.endsWith('.tmp') || name.endsWith('.lock')
    )).toBe(false)
    const stored = await readFile(
      join(directory, entries.find(name => name.endsWith('.journal')) ?? ''),
      'utf8'
    )
    expect(stored).toContain('document:one')
    expect(stored).toContain('checkpoint-two')
  })

  it('publishes immutable content before its manifest and leaves stale CAS artifacts unreachable', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-session-journal-'))
    directories.push(directory)
    const first = createFileDocumentSessionJournalStorage(directory)
    const second = createFileDocumentSessionJournalStorage(directory)
    const original = 'a'.repeat(64 * 1024)
    const stale = 's'.repeat(64 * 1024)

    await expect(first.compareExchange(
      'document:content',
      null,
      mutation('manifest-one', [
        Object.freeze({ id: 'source:one', data: original })
      ])
    )).resolves.toEqual({ revision: 1 })

    await expect(second.compareExchange(
      'document:content',
      null,
      mutation('stale-manifest', [
        Object.freeze({ id: 'source:stale', data: stale })
      ])
    )).resolves.toBeNull()

    await expect(first.read('document:content')).resolves.toEqual({
      revision: 1,
      data: 'manifest-one',
      contents: [{ id: 'source:one', data: original }]
    })
    expect((await readdir(directory))
      .filter(name => name.endsWith('.content'))).toHaveLength(1)

    await expect(first.compareExchange(
      'document:content',
      1,
      mutation('manifest-two', [], ['source:one'])
    )).resolves.toEqual({ revision: 2 })
    await expect(second.read('document:content')).resolves.toEqual({
      revision: 2,
      data: 'manifest-two',
      contents: [{ id: 'source:one', data: original }]
    })
  })

  it('fails closed when a manifest references corrupt immutable content', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-session-journal-'))
    directories.push(directory)
    const storage = createFileDocumentSessionJournalStorage(directory)
    await storage.compareExchange(
      'document:content-corrupt',
      null,
      mutation('manifest', [
        Object.freeze({
          id: 'source:corrupt',
          data: 'a'.repeat(64 * 1024)
        })
      ])
    )
    const content = (await readdir(directory))
      .find(name => name.endsWith('.content'))
    if (content === undefined) {
      throw new Error('Expected one durable content artifact')
    }
    await writeFile(join(directory, content), 'corrupt')

    await expect(storage.read('document:content-corrupt')).rejects.toThrow(
      /content|corrupt|invalid|checksum/i
    )
  })

  it('rejects an attempt to change the data named by an immutable content id', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-session-journal-'))
    directories.push(directory)
    const storage = createFileDocumentSessionJournalStorage(directory)
    const original = 'a'.repeat(64 * 1024)
    await storage.compareExchange(
      'document:immutable-content',
      null,
      mutation('manifest-one', [
        Object.freeze({ id: 'source:fixed', data: original })
      ])
    )

    await expect(storage.compareExchange(
      'document:immutable-content',
      1,
      mutation('manifest-two', [
        Object.freeze({
          id: 'source:fixed',
          data: 'b'.repeat(64 * 1024)
        })
      ])
    )).rejects.toThrow(/content id changed data/i)
    await expect(storage.read('document:immutable-content')).resolves.toEqual({
      revision: 1,
      data: 'manifest-one',
      contents: [{ id: 'source:fixed', data: original }]
    })
  })

  it('rejects corruption and never turns an invalid record into absence', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-session-journal-'))
    directories.push(directory)
    const storage = createFileDocumentSessionJournalStorage(directory)
    await storage.compareExchange(
      'document:corrupt',
      null,
      mutation('valid')
    )
    const journal = (await readdir(directory))
      .find(name => name.endsWith('.journal'))
    if (journal === undefined) {
      throw new Error('Expected one durable journal')
    }
    await writeFile(join(directory, journal), '{"schema":"truncated"')

    await expect(storage.read('document:corrupt')).rejects.toThrow(
      /corrupt|invalid|checksum/i
    )
    await expect(storage.compareExchange(
      'document:corrupt',
      1,
      mutation('replacement')
    )).rejects.toThrow(/corrupt|invalid|checksum/i)
  })
})
