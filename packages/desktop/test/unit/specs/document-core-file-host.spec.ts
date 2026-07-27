import {
  decodeFileSnapshot,
  WireEnvelopeCodecV1,
  type FileEncodingV1,
  type ParseConfiguration
} from '@marktext/document-core'
import {
  link,
  mkdtemp,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFileDocumentSessionJournalStorage } from 'main_renderer/documentCore/durableSessionJournalStorage'
import {
  createDurableDocumentFileMetadataStorage
} from 'main_renderer/documentCore/durableDocumentFileMetadataStorage'
import {
  createDocumentCoreFileHost,
  DocumentCoreFileAlreadyOpenError,
  type DocumentCoreFileHost,
  type DocumentCoreFileMetadata,
  type DocumentCoreFileMetadataStorage,
  type DocumentCoreFileSurface
} from 'main_renderer/documentCore/documentFileHost'
import {
  documentCoreFileByteHash,
  type DocumentCoreFileCompareExchangeRequest,
  type DocumentCoreFileCompareExchangeResult
} from 'main_renderer/documentCore/documentFileCompareExchange'
import {
  createDocumentCorePerformanceSurface
} from 'main_renderer/documentCore/documentCorePerformanceSurface'
import {
  createDocumentCoreMainSessionHost,
  decodeDocumentCorePublication,
  type DocumentCoreMainSessionHost
} from 'main_renderer/documentCore/mainSessionHost'

const configuration: ParseConfiguration = Object.freeze({
  markdownProfile: 'markdown-profile-1',
  criticMarkupProfile: 'marktext-profile-1',
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  markdownOptions: Object.freeze({
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  }),
  executionBudget: Object.freeze({
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  })
})

const directories: string[] = []
const sessionHosts: DocumentCoreMainSessionHost[] = []
const fileHosts: DocumentCoreFileHost[] = []

function exchanged(
  request: DocumentCoreFileCompareExchangeRequest
): DocumentCoreFileCompareExchangeResult {
  return Object.freeze({
    schema: 'document-core-file-compare-exchange-result-1',
    kind: 'exchanged',
    previousByteHash: request.expectedByteHash
  })
}

function conflicted(
  bytes: Uint8Array | null
): DocumentCoreFileCompareExchangeResult {
  return Object.freeze({
    schema: 'document-core-file-compare-exchange-result-1',
    kind: 'conflict',
    actualByteHash: documentCoreFileByteHash(bytes)
  })
}

afterEach(async() => {
  await Promise.allSettled(fileHosts.splice(0).map(host => host.dispose()))
  sessionHosts.splice(0)
  await Promise.all(directories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function createHarness(
  surface?: Partial<DocumentCoreFileSurface>,
  metadata?: Partial<DocumentCoreFileMetadataStorage>,
  durableMetadata = false
) {
  const directory = await mkdtemp(join(tmpdir(), 'marktext-file-host-'))
  directories.push(directory)
  const sessionHost = createDocumentCoreMainSessionHost(
    createFileDocumentSessionJournalStorage(directory)
  )
  sessionHosts.push(sessionHost)
  const stableSurface: DocumentCoreFileSurface = {
    chooseSavePath: vi.fn(async() => '/tmp/note.md'),
    move: vi.fn(async() => {}),
    read: vi.fn(async() => null),
    readBytes: vi.fn(async() => null),
    identify: vi.fn(async pathname => {
      try {
        const canonicalPathname = await realpath(pathname)
        const identity = await stat(canonicalPathname, { bigint: true })
        return {
          schema: 'document-core-physical-file-identity-1' as const,
          canonicalPathname,
          device: String(identity.dev),
          inode: String(identity.ino)
        }
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return {
            schema: 'document-core-physical-file-identity-1' as const,
            canonicalPathname: resolve(pathname),
            device: '0',
            inode: '0'
          }
        }
        throw error
      }
    }),
    compareExchange: vi.fn(async request => exchanged(request)),
    ...surface
  }
  const metadataRecords = new Map<string, DocumentCoreFileMetadata>()
  const inMemoryMetadataStorage: DocumentCoreFileMetadataStorage = {
    list: vi.fn(async() => [...metadataRecords.values()]),
    read: vi.fn(async documentId => metadataRecords.get(documentId) ?? null),
    write: vi.fn(async record => {
      metadataRecords.set(record.documentId, record)
    }),
    remove: vi.fn(async documentId => {
      metadataRecords.delete(documentId)
    }),
    ...metadata
  }
  const metadataDirectory = join(directory, 'file-metadata')
  const metadataStorage = durableMetadata
    ? createDurableDocumentFileMetadataStorage(metadataDirectory)
    : inMemoryMetadataStorage
  const markPersisted = vi.fn(sessionHost.markPersisted)
  const restorePersisted = vi.fn(sessionHost.restorePersisted)
  const releasePersistence = vi.fn(async(
    ownerId: string,
    documentId: string,
    leaseId: string
  ) => {
    const release = (
      sessionHost as unknown as {
        releasePersistence?: (
          ownerId: string,
          documentId: string,
          leaseId: string
        ) => Promise<void>
      }
    ).releasePersistence
    if (release === undefined) {
      throw new Error('Main session host has no persistence release authority')
    }
    await release(ownerId, documentId, leaseId)
  })
  const instrumentedSessionHost = {
    ...sessionHost,
    markPersisted,
    restorePersisted,
    releasePersistence
  } as DocumentCoreMainSessionHost
  let nextId = 0
  const fileHost = createDocumentCoreFileHost(
    instrumentedSessionHost,
    stableSurface,
    () => `document:${String(++nextId)}`,
    id => `journal:${id}`,
    metadataStorage
  )
  fileHosts.push(fileHost)
  return {
    directory,
    fileHost,
    sessionHost,
    markPersisted,
    metadataDirectory,
    restorePersisted,
    releasePersistence,
    metadataRecords,
    metadataStorage,
    surface: stableSurface
  }
}

async function open(
  fileHost: DocumentCoreFileHost,
  source = '# Heading\n\nBody.\n',
  pathname: string | null = '/tmp/note.md',
  encoding: FileEncodingV1 = 'utf-8',
  ownerId = 'renderer:1'
) {
  return await fileHost.open(ownerId, `window:${ownerId}`, {
    fileSnapshot: decodeFileSnapshot(
      encoding === 'utf-8'
        ? new TextEncoder().encode(source)
        : Uint8Array.from(
          [...source].flatMap(character => {
            const unit = character.charCodeAt(0)
            return encoding === 'utf-16le'
              ? [unit & 0xff, unit >>> 8]
              : [unit >>> 8, unit & 0xff]
          })
        ),
      encoding
    ),
    parseConfiguration: configuration,
    filename: pathname === null ? 'Untitled-1' : 'note.md',
    pathname,
    defaultDirectory: '/tmp'
  })
}

function decode(
  publication: Awaited<ReturnType<DocumentCoreMainSessionHost['dispatch']>>,
  codec = new WireEnvelopeCodecV1()
) {
  return {
    codec,
    snapshot: decodeDocumentCorePublication(
      codec.publish(publication.envelope, publication.baseSnapshotId)
    )
  }
}

describe('main-owned document-core file host', () => {
  it.each([
    ['symbolic-link', async(
      target: string,
      alias: string
    ) => await symlink(target, alias)],
    ['hard-link', async(
      target: string,
      alias: string
    ) => await link(target, alias)]
  ])('admits one live document across concurrent %s aliases', async(
    _kind,
    createAlias
  ) => {
    const { directory, fileHost } = await createHarness()
    const target = join(directory, 'target.md')
    const alias = join(directory, 'alias.md')
    await writeFile(target, 'same physical file', 'utf8')
    await createAlias(target, alias)

    const results = await Promise.allSettled([
      open(
        fileHost,
        'same physical file',
        target,
        'utf-8',
        'renderer:1'
      ),
      open(
        fileHost,
        'same physical file',
        alias,
        'utf-8',
        'renderer:2'
      )
    ])

    expect(results.map(result => result.status).sort()).toEqual([
      'fulfilled',
      'rejected'
    ])
    const rejected = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected'
    )
    const fulfilled = results.find(
      (result): result is PromiseFulfilledResult<
        Awaited<ReturnType<DocumentCoreFileHost['open']>>
      > => result.status === 'fulfilled'
    )
    expect(rejected?.reason).toBeInstanceOf(
      DocumentCoreFileAlreadyOpenError
    )
    const occupancy = (
      rejected?.reason as DocumentCoreFileAlreadyOpenError
    ).occupancy
    expect(Reflect.ownKeys(occupancy)).toEqual([
      'schema',
      'documentId',
      'ownerId',
      'durableWindowId',
      'pathname'
    ])
    expect(occupancy).toEqual(expect.objectContaining({
      schema: 'document-core-file-occupancy-1',
      documentId: fulfilled?.value.documentId,
      pathname: fulfilled?.value.pathname
    }))
  })

  it.each([
    ['case', '/notes/Release.md', '/notes/release.md'],
    ['Unicode normalization', '/notes/Café.md', '/notes/Cafe\u0301.md']
  ])('uses native identity for concurrent %s aliases', async(
    _kind,
    firstPathname,
    secondPathname
  ) => {
    const { fileHost } = await createHarness({
      identify: vi.fn(async() => ({
        schema: 'document-core-physical-file-identity-1' as const,
        canonicalPathname: '/notes/Release.md',
        device: '9',
        inode: '41'
      }))
    })

    const results = await Promise.allSettled([
      open(fileHost, 'same', firstPathname, 'utf-8', 'renderer:1'),
      open(fileHost, 'same', secondPathname, 'utf-8', 'renderer:2')
    ])

    expect(results.map(result => result.status).sort()).toEqual([
      'fulfilled',
      'rejected'
    ])
  })

  it('inspects every owned file with live history, including never-attached files', async() => {
    const { fileHost, sessionHost } = await createHarness()
    const editedFile = await open(fileHost, 'A', '/tmp/a.md')
    const neverAttached = await open(fileHost, 'B', '/tmp/b.md')
    const attached = await fileHost.attach(
      'renderer:1',
      editedFile.documentId
    )
    const { snapshot } = decode(attached)
    if (snapshot.kind !== 'complete') {
      throw new Error('Expected complete file-host inspection fixture')
    }
    await sessionHost.dispatch('renderer:1', {
      documentId: editedFile.documentId,
      baseSnapshotId: snapshot.snapshotId,
      intent: {
        kind: 'insert-text',
        target: {
          ...snapshot.selection,
          anchor: { offset: 1, affinity: 'next' },
          focus: { offset: 1, affinity: 'next' }
        },
        text: ' changed'
      }
    })

    await expect(fileHost.inspectOwned('renderer:1')).resolves.toEqual([
      expect.objectContaining({
        documentId: editedFile.documentId,
        filename: 'note.md',
        pathname: '/tmp/a.md',
        historyState: expect.objectContaining({ dirty: true })
      }),
      expect.objectContaining({
        documentId: neverAttached.documentId,
        filename: 'note.md',
        pathname: '/tmp/b.md',
        historyState: expect.objectContaining({ dirty: false })
      })
    ])
    await expect(fileHost.inspectOwned('renderer:2')).resolves.toEqual([])
  })

  it('admits source in main without building a discarded publication before attach', async() => {
    const { fileHost } = await createHarness()
    const opened = await open(fileHost)

    expect(opened).toMatchObject({
      schema: 'document-core-opened-file-1',
      documentId: 'document:1',
      filename: 'note.md',
      pathname: '/tmp/note.md'
    })
    expect(opened).not.toHaveProperty('durabilityKey')
    expect(opened).not.toHaveProperty('parseConfiguration')
    expect(opened).not.toHaveProperty('publication')
    expect(opened.admission).toMatchObject({
      schema: 'document-core-open-completion-1',
      snapshotId: expect.any(String),
      execution: {
        operationKind: 'open',
        serializedPayloadBytes: 0
      }
    })
    expect(fileHost.readAdmission(opened.documentId))
      .toBe(opened.admission)
    const publication = await fileHost.attach(
      'renderer:1',
      opened.documentId
    )
    const { snapshot } = decode(publication)
    expect(snapshot.source).toBe('# Heading\n\nBody.\n')
  })

  it('exposes path-only main performance admission with no renderer payload', async() => {
    const { directory, fileHost, sessionHost } = await createHarness()
    const pathname = join(directory, 'performance.md')
    await writeFile(pathname, 'performance source', 'utf8')
    const performanceSurface = createDocumentCorePerformanceSurface(
      sessionHost,
      fileHost
    )

    const result = await performanceSurface.runFileAdmission(pathname)

    expect(result).toMatchObject({
      sourceLength: 'performance source'.length,
      executionThreadId: expect.any(Number),
      ticketAdmissionMs: expect.any(Number),
      maximumMainStageMs: expect.any(Number),
      terminalMs: expect.any(Number),
      admission: {
        schema: 'document-core-open-completion-1',
        execution: {
          operationKind: 'open',
          serializedPayloadBytes: 0
        }
      },
      resourcesAfterClose: {
        sessionCount: 0,
        workerCount: 0
      }
    })
    expect(Object.keys(performanceSurface)).toEqual([
      'readAdmission',
      'runFileAdmission',
      'cancelFileAdmission',
      'cancelDispatchAndRecoverFile'
    ])
  })

  it('saves one main-owned lease and marks exactly that revision persisted after the write', async() => {
    const compareExchange = vi.fn<
      DocumentCoreFileSurface['compareExchange']
    >(async request => exchanged(request))
    const { fileHost } = await createHarness({ compareExchange })
    const opened = await open(fileHost)
    const { snapshot } = decode(
      await fileHost.attach('renderer:1', opened.documentId)
    )

    const receipt = await fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save'
    })

    expect(compareExchange).toHaveBeenCalledOnce()
    const written = compareExchange.mock.calls[0]?.[0]
    expect(written?.pathname).toBe('/tmp/note.md')
    expect(Array.from(written?.bytes ?? []))
      .toEqual(Array.from(new TextEncoder().encode('# Heading\n\nBody.\n')))
    expect(receipt).toMatchObject({
      schema: 'document-core-save-receipt-1',
      kind: 'written',
      documentId: opened.documentId,
      pathname: '/tmp/note.md',
      revisionId: snapshot.revisionId,
      historyState: { dirty: false }
    })
  })

  it('keeps a newer edit dirty when it lands while an older save lease is being written', async() => {
    let releaseWrite: (() => void) | undefined
    let writing: (() => void) | undefined
    const writeStarted = new Promise<void>(resolve => {
      writing = resolve
    })
    const writeGate = new Promise<void>(resolve => {
      releaseWrite = resolve
    })
    const compareExchange = vi.fn<
      DocumentCoreFileSurface['compareExchange']
    >(async request => {
      writing?.()
      await writeGate
      return exchanged(request)
    })
    const {
      fileHost,
      sessionHost,
      releasePersistence
    } = await createHarness({ compareExchange })
    const opened = await open(fileHost, 'old')
    const decoded = decode(
      await fileHost.attach('renderer:1', opened.documentId)
    )
    const before = decoded.snapshot

    const saving = fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save'
    })
    await writeStarted
    expect(releasePersistence).not.toHaveBeenCalled()
    const edited = await sessionHost.dispatch('renderer:1', {
      documentId: opened.documentId,
      baseSnapshotId: before.snapshotId,
      intent: {
        kind: 'reload-source-from-file',
        source: 'new'
      }
    })
    releaseWrite?.()

    const receipt = await saving
    const written = compareExchange.mock.calls[0]?.[0]
    expect(new TextDecoder().decode(written?.bytes ?? undefined)).toBe('old')
    expect(receipt).toMatchObject({
      kind: 'written',
      historyState: { dirty: true }
    })
    expect(releasePersistence).toHaveBeenCalledOnce()
    expect(releasePersistence).toHaveBeenCalledWith(
      'renderer:1',
      opened.documentId,
      expect.any(String)
    )
    expect(decode(edited, decoded.codec).snapshot.source).toBe('new')
  })

  it('rejects a hostile disk replacement before write and recovers only after explicit keep', async() => {
    const originalBytes = new TextEncoder().encode('base')
    const externalBytes = new TextEncoder().encode('external')
    let diskBytes = Uint8Array.from(originalBytes)
    const compareExchange = vi.fn<
      DocumentCoreFileSurface['compareExchange']
    >(async request => {
      if (
        documentCoreFileByteHash(diskBytes) !== request.expectedByteHash
      ) {
        return conflicted(diskBytes)
      }
      diskBytes = request.bytes === null
        ? new Uint8Array()
        : Uint8Array.from(request.bytes)
      return exchanged(request)
    })
    const {
      fileHost,
      sessionHost,
      markPersisted,
      releasePersistence,
      metadataRecords,
      metadataStorage
    } = await createHarness({
      read: vi.fn(async() => decodeFileSnapshot(diskBytes, 'utf-8')),
      readBytes: vi.fn(async() => Uint8Array.from(diskBytes)),
      compareExchange
    })
    const opened = await fileHost.open('renderer:1', 'window:renderer:1', {
      fileSnapshot: decodeFileSnapshot(originalBytes, 'utf-8'),
      parseConfiguration: configuration,
      filename: 'note.md',
      pathname: '/tmp/note.md',
      defaultDirectory: '/tmp'
    })
    const attached = decode(
      await fileHost.attach('renderer:1', opened.documentId)
    )
    await sessionHost.dispatch('renderer:1', {
      documentId: opened.documentId,
      baseSnapshotId: attached.snapshot.snapshotId,
      intent: {
        kind: 'reload-source-from-file',
        source: 'local'
      }
    })
    vi.mocked(metadataStorage.read).mockImplementationOnce(async documentId => {
      const metadata = metadataRecords.get(documentId) ?? null
      diskBytes = Uint8Array.from(externalBytes)
      return metadata
    })

    await expect(fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save'
    })).rejects.toThrow(/changed|conflict/i)

    expect(Array.from(diskBytes)).toEqual(Array.from(externalBytes))
    expect(markPersisted).not.toHaveBeenCalled()
    expect(releasePersistence).toHaveBeenCalledOnce()
    await expect(sessionHost.readHistoryState(
      'renderer:1',
      opened.documentId
    )).resolves.toMatchObject({ dirty: true })

    await expect(fileHost.resolveExternalChange(
      'renderer:1',
      opened.documentId,
      'keep'
    )).resolves.toMatchObject({ kind: 'kept' })
    await expect(fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save'
    })).resolves.toMatchObject({
      kind: 'written',
      historyState: { dirty: false }
    })
    expect(new TextDecoder().decode(diskBytes)).toBe('local')
  })

  it('rejects a Save As target created after expected absence without removing it', async() => {
    const attackerBytes = new TextEncoder().encode('attacker')
    let targetBytes: Uint8Array | null = null
    const compareExchange = vi.fn<
      DocumentCoreFileSurface['compareExchange']
    >(async request => {
      if (
        documentCoreFileByteHash(targetBytes) !== request.expectedByteHash
      ) {
        return conflicted(targetBytes)
      }
      targetBytes = request.bytes === null
        ? null
        : Uint8Array.from(request.bytes)
      return exchanged(request)
    })
    const {
      fileHost,
      markPersisted,
      releasePersistence,
      metadataRecords,
      metadataStorage
    } = await createHarness({
      chooseSavePath: vi.fn(async() => '/tmp/new-target.md'),
      readBytes: vi.fn(async() => targetBytes === null
        ? null
        : Uint8Array.from(targetBytes)),
      compareExchange
    })
    const opened = await open(fileHost, 'local')
    vi.mocked(metadataStorage.read).mockImplementationOnce(async documentId => {
      const metadata = metadataRecords.get(documentId) ?? null
      targetBytes = Uint8Array.from(attackerBytes)
      return metadata
    })

    await expect(fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save-as'
    })).rejects.toThrow(/changed|conflict/i)

    expect(Array.from(targetBytes ?? [])).toEqual(Array.from(attackerBytes))
    expect(markPersisted).not.toHaveBeenCalled()
    expect(releasePersistence).toHaveBeenCalledOnce()
    expect(fileHost.describe('renderer:1', opened.documentId).pathname)
      .toBe('/tmp/note.md')

    await expect(fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save-as'
    })).resolves.toMatchObject({
      kind: 'written',
      pathname: '/tmp/new-target.md'
    })
    expect(new TextDecoder().decode(targetBytes ?? undefined)).toBe('local')
  })

  it('does not roll back over a newer external replacement', async() => {
    const originalBytes = new TextEncoder().encode('before')
    const externalBytes = new TextEncoder().encode('newer external')
    let diskBytes = Uint8Array.from(originalBytes)
    const compareExchange = vi.fn<
      DocumentCoreFileSurface['compareExchange']
    >(async request => {
      if (
        documentCoreFileByteHash(diskBytes) !== request.expectedByteHash
      ) {
        return conflicted(diskBytes)
      }
      if (request.bytes === null) {
        throw new Error('Retained file rollback unexpectedly removed it')
      }
      diskBytes = Uint8Array.from(request.bytes)
      return exchanged(request)
    })
    const {
      fileHost,
      sessionHost,
      markPersisted,
      releasePersistence,
      metadataStorage
    } = await createHarness({
      read: vi.fn(async() => decodeFileSnapshot(diskBytes, 'utf-8')),
      readBytes: vi.fn(async() => Uint8Array.from(diskBytes)),
      compareExchange
    })
    const opened = await fileHost.open('renderer:1', 'window:renderer:1', {
      fileSnapshot: decodeFileSnapshot(originalBytes, 'utf-8'),
      parseConfiguration: configuration,
      filename: 'note.md',
      pathname: '/tmp/note.md',
      defaultDirectory: '/tmp'
    })
    const attached = decode(
      await fileHost.attach('renderer:1', opened.documentId)
    )
    await sessionHost.dispatch('renderer:1', {
      documentId: opened.documentId,
      baseSnapshotId: attached.snapshot.snapshotId,
      intent: {
        kind: 'reload-source-from-file',
        source: 'local'
      }
    })
    vi.mocked(metadataStorage.write).mockImplementationOnce(async() => {
      diskBytes = Uint8Array.from(externalBytes)
      throw new Error('metadata unavailable')
    })

    await expect(fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save'
    })).rejects.toThrow(/rollback was incomplete/i)

    expect(Array.from(diskBytes)).toEqual(Array.from(externalBytes))
    expect(markPersisted).not.toHaveBeenCalled()
    expect(releasePersistence).toHaveBeenCalledOnce()
    expect(compareExchange).toHaveBeenCalledTimes(2)
    await expect(sessionHost.readHistoryState(
      'renderer:1',
      opened.documentId
    )).resolves.toMatchObject({ dirty: true })

    await expect(fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save'
    })).rejects.toThrow(/conflict/i)
    expect(compareExchange).toHaveBeenCalledTimes(2)
    await fileHost.resolveExternalChange(
      'renderer:1',
      opened.documentId,
      'keep'
    )
    await expect(fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save'
    })).resolves.toMatchObject({ kind: 'written' })
    expect(new TextDecoder().decode(diskBytes)).toBe('local')
  })

  it('does not write or mark clean when a save dialog is cancelled', async() => {
    const chooseSavePath = vi.fn(async() => null)
    const compareExchange = vi.fn<
      DocumentCoreFileSurface['compareExchange']
    >(async request => exchanged(request))
    const {
      fileHost,
      sessionHost,
      markPersisted,
      releasePersistence
    } = await createHarness({ chooseSavePath, compareExchange })
    const opened = await open(fileHost, 'dirty', null)
    const before = decode(
      await fileHost.attach('renderer:1', opened.documentId)
    ).snapshot
    await sessionHost.dispatch('renderer:1', {
      documentId: opened.documentId,
      baseSnapshotId: before.snapshotId,
      intent: { kind: 'reload-source-from-file', source: 'dirtier' }
    })

    const receipt = await fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save'
    })

    expect(receipt).toEqual({
      schema: 'document-core-save-receipt-1',
      kind: 'cancelled',
      documentId: opened.documentId
    })
    expect(compareExchange).not.toHaveBeenCalled()
    expect(releasePersistence).toHaveBeenCalledOnce()
    const lease = await sessionHost.preparePersistence(
      'renderer:1',
      opened.documentId,
      'save'
    )
    expect(lease.source).toBe('dirtier')
    expect(lease.facts).toEqual({
      kind: 'document-facts',
      recommendedTitle: null,
      statistics: {
        word: 1,
        paragraph: 1,
        character: 7,
        all: 7
      }
    })
    expect(markPersisted).not.toHaveBeenCalled()
  })

  it('uses the exact leased parser title for an untitled native save suggestion', async() => {
    const chooseSavePath = vi.fn<DocumentCoreFileSurface['chooseSavePath']>(
      async() => null
    )
    const { fileHost } = await createHarness({ chooseSavePath })
    const opened = await open(
      fileHost,
      '```md\n# Not the title\n```\n\n# Revised {~~old~>title~~}\n',
      null
    )

    await fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save'
    })

    expect(chooseSavePath).toHaveBeenCalledWith(expect.objectContaining({
      documentId: opened.documentId,
      filename: 'Revised title'
    }))
  })

  it('does not mark persisted or change pathname after a failed save-as write', async() => {
    const compareExchange = vi.fn<
      DocumentCoreFileSurface['compareExchange']
    >(async() => conflicted(null))
    compareExchange.mockRejectedValueOnce(new Error('disk full'))
    const { fileHost, sessionHost, markPersisted } = await createHarness({
      chooseSavePath: vi.fn(async() => '/tmp/renamed.md'),
      compareExchange
    })
    const opened = await open(fileHost, 'dirty')
    const before = decode(
      await fileHost.attach('renderer:1', opened.documentId)
    ).snapshot
    await sessionHost.dispatch('renderer:1', {
      documentId: opened.documentId,
      baseSnapshotId: before.snapshotId,
      intent: { kind: 'reload-source-from-file', source: 'changed' }
    })

    await expect(fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save-as'
    })).rejects.toThrow('disk full')
    expect(fileHost.describe('renderer:1', opened.documentId).pathname)
      .toBe('/tmp/note.md')
    expect(markPersisted).not.toHaveBeenCalled()
  })

  it('rejects Save As through a physical alias of another live document', async() => {
    const identify = vi.fn(async(pathname: string) => {
      const isFirst = pathname === '/tmp/first.md'
      const isSecond =
        pathname === '/tmp/second.md' ||
        pathname === '/tmp/second-alias.md'
      if (!isFirst && !isSecond) return null
      return {
        schema: 'document-core-physical-file-identity-1' as const,
        canonicalPathname: isFirst
          ? '/tmp/first.md'
          : '/tmp/second.md',
        device: '5',
        inode: isFirst ? '1' : '2'
      }
    })
    const compareExchange = vi.fn(async(
      request: DocumentCoreFileCompareExchangeRequest
    ) => exchanged(request))
    const { fileHost } = await createHarness({
      chooseSavePath: vi.fn(async() => '/tmp/second-alias.md'),
      identify,
      compareExchange
    })
    const first = await open(fileHost, 'first', '/tmp/first.md')
    await open(fileHost, 'second', '/tmp/second.md')

    await expect(fileHost.save('renderer:1', {
      documentId: first.documentId,
      mode: 'save-as'
    })).rejects.toBeInstanceOf(DocumentCoreFileAlreadyOpenError)
    expect(compareExchange).not.toHaveBeenCalled()
  })

  it('retargets physical occupancy after Save As publishes a new file', async() => {
    let targetExists = false
    const identify = vi.fn(async(pathname: string) => {
      if (pathname === '/tmp/original.md') {
        return {
          schema: 'document-core-physical-file-identity-1' as const,
          canonicalPathname: pathname,
          device: '7',
          inode: '1'
        }
      }
      if (
        targetExists &&
        (
          pathname === '/tmp/new.md' ||
          pathname === '/tmp/new-alias.md'
        )
      ) {
        return {
          schema: 'document-core-physical-file-identity-1' as const,
          canonicalPathname: '/tmp/new.md',
          device: '7',
          inode: '2'
        }
      }
      return null
    })
    const { fileHost } = await createHarness({
      chooseSavePath: vi.fn(async() => '/tmp/new.md'),
      identify,
      compareExchange: vi.fn(async request => {
        targetExists = true
        return exchanged(request)
      })
    })
    const opened = await open(
      fileHost,
      'source',
      '/tmp/original.md'
    )

    await expect(fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save-as'
    })).resolves.toMatchObject({
      kind: 'written',
      pathname: '/tmp/new.md'
    })
    await expect(open(
      fileHost,
      'source',
      '/tmp/new-alias.md',
      'utf-8',
      'renderer:2'
    )).rejects.toBeInstanceOf(DocumentCoreFileAlreadyOpenError)
  })

  it('restores the exact same-path file and durable metadata when metadata commit fails, then permits a clean retry', async() => {
    const originalBytes = Uint8Array.from([
      0xef, 0xbb, 0xbf,
      0x6f, 0x6c, 0x64,
      0x0d, 0x0a
    ])
    let diskBytes = Uint8Array.from(originalBytes)
    const compareExchange = vi.fn<
      DocumentCoreFileSurface['compareExchange']
    >(async request => {
      if (
        documentCoreFileByteHash(diskBytes) !== request.expectedByteHash
      ) {
        return conflicted(diskBytes)
      }
      diskBytes = request.bytes === null
        ? new Uint8Array()
        : Uint8Array.from(request.bytes)
      return exchanged(request)
    })
    const {
      fileHost,
      sessionHost,
      markPersisted,
      metadataRecords,
      metadataStorage
    } = await createHarness({
      read: vi.fn(async() => decodeFileSnapshot(diskBytes, 'utf-8')),
      readBytes: vi.fn(async() => Uint8Array.from(diskBytes)),
      compareExchange
    })
    const opened = await fileHost.open('renderer:1', 'window:renderer:1', {
      fileSnapshot: decodeFileSnapshot(originalBytes, 'utf-8'),
      parseConfiguration: configuration,
      filename: 'note.md',
      pathname: '/tmp/note.md',
      defaultDirectory: '/tmp'
    })
    const attached = decode(
      await fileHost.attach('renderer:1', opened.documentId)
    )
    await sessionHost.dispatch('renderer:1', {
      documentId: opened.documentId,
      baseSnapshotId: attached.snapshot.snapshotId,
      intent: {
        kind: 'reload-source-from-file',
        source: 'new\n'
      }
    })
    const originalMetadata = metadataRecords.get(opened.documentId)
    vi.mocked(metadataStorage.write)
      .mockRejectedValueOnce(new Error('metadata unavailable'))

    await expect(fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save'
    })).rejects.toThrow('metadata unavailable')

    expect(diskBytes).toEqual(originalBytes)
    expect(metadataRecords.get(opened.documentId)).toEqual(originalMetadata)
    expect(markPersisted).not.toHaveBeenCalled()
    expect((await sessionHost.preparePersistence(
      'renderer:1',
      opened.documentId,
      'save'
    )).historyState.dirty).toBe(true)

    const retry = await fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save'
    })
    expect(diskBytes).toEqual(Uint8Array.from([
      0x6e, 0x65, 0x77, 0x0a
    ]))
    expect(retry).toMatchObject({
      kind: 'written',
      historyState: { dirty: false }
    })
  })

  it('removes a newly created save-as target when metadata commit fails', async() => {
    let targetBytes: Uint8Array | null = null
    const compareExchange = vi.fn<
      DocumentCoreFileSurface['compareExchange']
    >(async request => {
      if (
        documentCoreFileByteHash(targetBytes) !== request.expectedByteHash
      ) {
        return conflicted(targetBytes)
      }
      targetBytes = request.bytes === null
        ? null
        : Uint8Array.from(request.bytes)
      return exchanged(request)
    })
    const {
      fileHost,
      metadataStorage
    } = await createHarness({
      chooseSavePath: vi.fn(async() => '/tmp/new-target.md'),
      read: vi.fn(async pathname =>
        pathname === '/tmp/new-target.md' && targetBytes !== null
          ? decodeFileSnapshot(targetBytes, 'utf-8')
          : null
      ),
      compareExchange
    })
    const opened = await open(fileHost, 'new source')
    vi.mocked(metadataStorage.write)
      .mockRejectedValueOnce(new Error('metadata unavailable'))

    await expect(fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save-as'
    })).rejects.toThrow('metadata unavailable')

    expect(targetBytes).toBeNull()
    expect(fileHost.describe('renderer:1', opened.documentId)).toMatchObject({
      filename: 'note.md',
      pathname: '/tmp/note.md'
    })
  })

  it('restores an existing save-as target byte-for-byte without decoding it', async() => {
    const priorTargetBytes = Uint8Array.from([
      0x00, 0xff, 0x80, 0x0d, 0x0a
    ])
    let targetBytes = Uint8Array.from(priorTargetBytes)
    const compareExchange = vi.fn<
      DocumentCoreFileSurface['compareExchange']
    >(async request => {
      if (
        documentCoreFileByteHash(targetBytes) !== request.expectedByteHash
      ) {
        return conflicted(targetBytes)
      }
      if (request.bytes === null) {
        throw new Error('Existing target rollback unexpectedly removed it')
      }
      targetBytes = Uint8Array.from(request.bytes)
      return exchanged(request)
    })
    const {
      fileHost,
      metadataStorage
    } = await createHarness({
      chooseSavePath: vi.fn(async() => '/tmp/existing-target.md'),
      read: vi.fn(async pathname => {
        if (pathname === '/tmp/existing-target.md') {
          throw new Error('save rollback target must not be decoded')
        }
        return null
      }),
      readBytes: vi.fn(async pathname =>
        pathname === '/tmp/existing-target.md'
          ? Uint8Array.from(targetBytes)
          : null
      ),
      compareExchange
    })
    const opened = await open(fileHost, 'replacement')
    vi.mocked(metadataStorage.write)
      .mockRejectedValueOnce(new Error('metadata unavailable'))

    await expect(fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save-as'
    })).rejects.toThrow('metadata unavailable')

    expect(targetBytes).toEqual(priorTargetBytes)
  })

  it('rejects save-as to another retained document path before reading or writing the target', async() => {
    const readBytes = vi.fn<DocumentCoreFileSurface['readBytes']>(
      async() => Uint8Array.from([0x74, 0x61, 0x6b, 0x65, 0x6e])
    )
    const compareExchange = vi.fn<
      DocumentCoreFileSurface['compareExchange']
    >(async request => exchanged(request))
    const {
      fileHost,
      markPersisted
    } = await createHarness({
      chooseSavePath: vi.fn(async() => '/tmp/taken.md'),
      readBytes,
      compareExchange
    })
    const first = await open(fileHost, 'first', '/tmp/first.md')
    await open(fileHost, 'second', '/tmp/taken.md')

    await expect(fileHost.save('renderer:1', {
      documentId: first.documentId,
      mode: 'save-as'
    })).rejects.toThrow(/already.*open|collision/i)

    expect(readBytes).not.toHaveBeenCalled()
    expect(compareExchange).not.toHaveBeenCalled()
    expect(markPersisted).not.toHaveBeenCalled()
    expect(fileHost.describe('renderer:1', first.documentId).pathname)
      .toBe('/tmp/first.md')
  })

  it('publishes no in-memory path or index change before every durable save-as step commits', async() => {
    const {
      fileHost,
      metadataStorage
    } = await createHarness({
      chooseSavePath: vi.fn(async() => '/tmp/pending.md')
    })
    const opened = await open(fileHost, 'source')
    let releaseMetadata: (() => void) | undefined
    let metadataStarted: (() => void) | undefined
    const metadataGate = new Promise<void>(resolve => {
      releaseMetadata = resolve
    })
    const observedMetadata = new Promise<void>(resolve => {
      metadataStarted = resolve
    })
    vi.mocked(metadataStorage.write).mockImplementationOnce(async() => {
      metadataStarted?.()
      await metadataGate
    })

    const saving = fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save-as'
    })
    await observedMetadata

    const descriptionDuringCommit = fileHost.describe(
      'renderer:1',
      opened.documentId
    )
    const originalPathDuringCommit = fileHost.documentIdForPath(
      'renderer:1',
      '/tmp/note.md'
    )
    const targetPathDuringCommit = fileHost.documentIdForPath(
      'renderer:1',
      '/tmp/pending.md'
    )
    releaseMetadata?.()
    await saving

    expect(descriptionDuringCommit).toMatchObject({
      filename: 'note.md',
      pathname: '/tmp/note.md'
    })
    expect(originalPathDuringCommit).toBe(opened.documentId)
    expect(targetPathDuringCommit).toBeNull()
    expect(fileHost.describe('renderer:1', opened.documentId)).toMatchObject({
      filename: 'pending.md',
      pathname: '/tmp/pending.md'
    })
  })

  it('rolls back a save-as file and metadata when marking the leased revision persisted fails, then permits retry', async() => {
    let targetBytes: Uint8Array | null = null
    const compareExchange = vi.fn<
      DocumentCoreFileSurface['compareExchange']
    >(async request => {
      if (
        documentCoreFileByteHash(targetBytes) !== request.expectedByteHash
      ) {
        return conflicted(targetBytes)
      }
      targetBytes = request.bytes === null
        ? null
        : Uint8Array.from(request.bytes)
      return exchanged(request)
    })
    const {
      fileHost,
      sessionHost,
      markPersisted,
      metadataRecords
    } = await createHarness({
      chooseSavePath: vi.fn(async() => '/tmp/retry.md'),
      readBytes: vi.fn(async pathname =>
        pathname === '/tmp/retry.md' && targetBytes !== null
          ? Uint8Array.from(targetBytes)
          : null
      ),
      compareExchange
    })
    const opened = await open(fileHost, 'before')
    const attached = decode(
      await fileHost.attach('renderer:1', opened.documentId)
    )
    await sessionHost.dispatch('renderer:1', {
      documentId: opened.documentId,
      baseSnapshotId: attached.snapshot.snapshotId,
      intent: {
        kind: 'reload-source-from-file',
        source: 'after'
      }
    })
    const originalMetadata = metadataRecords.get(opened.documentId)
    markPersisted.mockRejectedValueOnce(new Error('journal unavailable'))

    await expect(fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save-as'
    })).rejects.toThrow('journal unavailable')

    expect(targetBytes).toBeNull()
    expect(metadataRecords.get(opened.documentId)).toEqual(originalMetadata)
    expect(fileHost.describe('renderer:1', opened.documentId)).toMatchObject({
      filename: 'note.md',
      pathname: '/tmp/note.md'
    })
    expect((await sessionHost.preparePersistence(
      'renderer:1',
      opened.documentId,
      'save'
    )).historyState.dirty).toBe(true)

    const retry = await fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save-as'
    })
    expect(new TextDecoder().decode(targetBytes ?? new Uint8Array())).toBe(
      'after'
    )
    expect(retry).toMatchObject({
      pathname: '/tmp/retry.md',
      historyState: { dirty: false }
    })
  })

  it('restores the prior target when an atomic write commits and then reports failure', async() => {
    const priorBytes = new TextEncoder().encode('prior target')
    let targetBytes = Uint8Array.from(priorBytes)
    const compareExchange = vi.fn<
      DocumentCoreFileSurface['compareExchange']
    >(async request => {
      if (
        documentCoreFileByteHash(targetBytes) !== request.expectedByteHash
      ) {
        return conflicted(targetBytes)
      }
      if (request.bytes === null) {
        throw new Error('Existing target rollback unexpectedly removed it')
      }
      targetBytes = Uint8Array.from(request.bytes)
      if (compareExchange.mock.calls.length === 1) {
        throw new Error('write acknowledgement lost')
      }
      return exchanged(request)
    })
    const {
      fileHost,
      markPersisted,
      metadataStorage
    } = await createHarness({
      chooseSavePath: vi.fn(async() => '/tmp/uncertain.md'),
      readBytes: vi.fn(async() => Uint8Array.from(targetBytes)),
      compareExchange
    })
    const opened = await open(fileHost, 'replacement')
    vi.mocked(metadataStorage.write).mockClear()

    await expect(fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save-as'
    })).rejects.toThrow('write acknowledgement lost')

    expect(Array.from(targetBytes)).toEqual(Array.from(priorBytes))
    expect(compareExchange).toHaveBeenCalledTimes(2)
    expect(metadataStorage.write).not.toHaveBeenCalled()
    expect(markPersisted).not.toHaveBeenCalled()
  })

  it('restores the prior saved identity when markPersisted commits and then reports failure', async() => {
    const originalBytes = new TextEncoder().encode('before')
    let diskBytes = Uint8Array.from(originalBytes)
    const {
      fileHost,
      sessionHost,
      markPersisted,
      metadataRecords
    } = await createHarness({
      readBytes: vi.fn(async() => Uint8Array.from(diskBytes)),
      compareExchange: vi.fn(async request => {
        if (
          documentCoreFileByteHash(diskBytes) !== request.expectedByteHash
        ) {
          return conflicted(diskBytes)
        }
        if (request.bytes === null) {
          throw new Error('Retained file rollback unexpectedly removed it')
        }
        diskBytes = Uint8Array.from(request.bytes)
        return exchanged(request)
      })
    })
    const opened = await open(fileHost, 'before')
    const attached = decode(
      await fileHost.attach('renderer:1', opened.documentId)
    )
    await sessionHost.dispatch('renderer:1', {
      documentId: opened.documentId,
      baseSnapshotId: attached.snapshot.snapshotId,
      intent: {
        kind: 'reload-source-from-file',
        source: 'after'
      }
    })
    const originalMetadata = metadataRecords.get(opened.documentId)
    markPersisted.mockImplementationOnce(async(
      ownerId,
      documentId,
      leaseId
    ) => {
      await sessionHost.markPersisted(ownerId, documentId, leaseId)
      throw new Error('mark acknowledgement lost')
    })

    await expect(fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save'
    })).rejects.toThrow('mark acknowledgement lost')

    expect(Array.from(diskBytes)).toEqual(Array.from(originalBytes))
    expect(metadataRecords.get(opened.documentId)).toEqual(originalMetadata)
    expect((await sessionHost.preparePersistence(
      'renderer:1',
      opened.documentId,
      'save'
    )).historyState).toMatchObject({
      dirty: true,
      savedIdentity: attached.snapshot.historyState.savedIdentity
    })
  })

  it('reports the original save error and every rollback failure after attempting all compensations', async() => {
    let targetBytes = new TextEncoder().encode('prior')
    const compareExchange = vi.fn<
      DocumentCoreFileSurface['compareExchange']
    >(async request => {
      if (compareExchange.mock.calls.length === 2) {
        throw new Error('disk rollback failed')
      }
      if (request.bytes === null) {
        throw new Error('Existing target rollback unexpectedly removed it')
      }
      targetBytes = Uint8Array.from(request.bytes)
      return exchanged(request)
    })
    const {
      fileHost,
      markPersisted,
      metadataRecords,
      metadataStorage,
      restorePersisted
    } = await createHarness({
      chooseSavePath: vi.fn(async() => '/tmp/aggregate.md'),
      readBytes: vi.fn(async() => Uint8Array.from(targetBytes)),
      compareExchange
    })
    const opened = await open(fileHost, 'replacement')
    const originalMetadata = metadataRecords.get(opened.documentId)
    vi.mocked(metadataStorage.write)
      .mockImplementationOnce(async record => {
        metadataRecords.set(record.documentId, record)
      })
      .mockRejectedValueOnce(new Error('metadata rollback failed'))
    markPersisted.mockRejectedValueOnce(new Error('mark failed'))
    restorePersisted.mockRejectedValueOnce(
      new Error('session rollback failed')
    )

    const error = await fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save-as'
    }).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors.map(item =>
      item instanceof Error ? item.message : String(item)
    )).toEqual([
      'mark failed',
      'session rollback failed',
      'metadata rollback failed',
      'disk rollback failed'
    ])
    expect(compareExchange).toHaveBeenCalledTimes(2)
    expect(metadataStorage.write).toHaveBeenCalledTimes(3)
    expect(metadataRecords.get(opened.documentId)).not.toEqual(
      originalMetadata
    )
  })

  it('reattaches a renderer without accepting source, durability, or configuration from it', async() => {
    const { fileHost, sessionHost } = await createHarness()
    const opened = await open(fileHost, 'owned')
    sessionHost.detach('renderer:1')

    const publication = await fileHost.attach(
      'renderer:2',
      opened.documentId
    )

    expect(decode(publication).snapshot.source).toBe('owned')
  })

  it('recovers a durable document by opaque identity without renderer source or file policy', async() => {
    const first = await createHarness()
    const opened = await open(first.fileHost, 'journal-owned source')
    const metadata = first.metadataRecords.get(opened.documentId)
    expect(metadata).toMatchObject({
      schema: 'document-core-file-metadata-2',
      documentId: opened.documentId,
      filename: 'note.md',
      pathname: '/tmp/note.md',
      encoding: 'utf-8'
    })

    // The first host remains alive only as a stand-in for a process that
    // disappeared without performing graceful session close. Recovery must
    // select the already-durable journal, not ask a renderer to replay source.
    first.sessionHost.detach('renderer:1')
    const recoveredSessionHost = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(first.directory)
    )
    sessionHosts.push(recoveredSessionHost)
    const recoveredSurface: DocumentCoreFileSurface = {
      chooseSavePath: vi.fn(async() => null),
      move: vi.fn(async() => {}),
      read: vi.fn(async() => decodeFileSnapshot(
        new TextEncoder().encode('journal-owned source'),
        'utf-8'
      )),
      readBytes: vi.fn(async() => null),
      identify: vi.fn(async() => ({
        schema: 'document-core-physical-file-identity-1' as const,
        canonicalPathname: '/tmp/note.md',
        device: '1',
        inode: '1'
      })),
      compareExchange: vi.fn(async request => exchanged(request))
    }
    const recoveredFileHost = createDocumentCoreFileHost(
      recoveredSessionHost,
      recoveredSurface,
      () => 'must-not-allocate',
      id => `journal:${id}`,
      first.metadataStorage
    )
    fileHosts.push(recoveredFileHost)

    const recovered = await recoveredFileHost.recover(
      'renderer:2',
      'window:renderer:1',
      {
        documentId: opened.documentId,
        parseConfiguration: configuration
      }
    )
    const publication = await recoveredFileHost.attach(
      'renderer:2',
      recovered.documentId
    )

    expect(recovered).toEqual({
      schema: 'document-core-recovered-file-1',
      documentId: opened.documentId,
      filename: 'note.md',
      pathname: '/tmp/note.md',
      externalConflict: false
    })
    expect(decode(publication).snapshot.source).toBe('journal-owned source')
    await first.fileHost.dispose()
  })

  it('discovers a completed admission after process death from its durable window registry', async() => {
    const first = await createHarness(undefined, undefined, true)
    const admissionRequest = {
      fileSnapshot: decodeFileSnapshot(
        new TextEncoder().encode('crash durable source'),
        'utf-8'
      ),
      parseConfiguration: configuration,
      filename: 'crash.md',
      pathname: '/tmp/crash.md',
      defaultDirectory: '/tmp'
    }
    const openWithDurableWindow = first.fileHost.open as unknown as (
      ownerId: string,
      durableWindowId: string,
      request: typeof admissionRequest
    ) => ReturnType<DocumentCoreFileHost['open']>
    const opened = await openWithDurableWindow(
      'renderer:41',
      'window-buffer:alpha',
      admissionRequest
    )

    first.sessionHost.detach('renderer:41')
    const recoveredSessionHost = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(first.directory)
    )
    sessionHosts.push(recoveredSessionHost)
    const recoveredFileHost = createDocumentCoreFileHost(
      recoveredSessionHost,
      {
        ...first.surface,
        read: vi.fn(async() => decodeFileSnapshot(
          new TextEncoder().encode('crash durable source'),
          'utf-8'
        ))
      },
      () => 'must-not-allocate',
      id => `journal:${id}`,
      createDurableDocumentFileMetadataStorage(first.metadataDirectory)
    )
    fileHosts.push(recoveredFileHost)
    const recoveryWindows = (
      recoveredFileHost as unknown as {
        recoveryWindows(): Promise<readonly unknown[]>
      }
    ).recoveryWindows

    await expect(recoveryWindows.call(recoveredFileHost)).resolves.toEqual([
      {
        schema: 'document-core-recovery-window-1',
        durableWindowId: 'window-buffer:alpha',
        documentIds: [opened.documentId]
      }
    ])
    const recoverWithDurableWindow = recoveredFileHost.recover as unknown as (
      ownerId: string,
      durableWindowId: string,
      request: { documentId: string; parseConfiguration: ParseConfiguration }
    ) => ReturnType<DocumentCoreFileHost['recover']>
    await expect(recoverWithDurableWindow(
      'renderer:42',
      'window-buffer:other',
      {
        documentId: opened.documentId,
        parseConfiguration: configuration
      }
    )).rejects.toThrow(/window/i)
    await expect(recoverWithDurableWindow(
      'renderer:42',
      'window-buffer:alpha',
      {
        documentId: opened.documentId,
        parseConfiguration: configuration
      }
    )).resolves.toMatchObject({
      documentId: opened.documentId,
      pathname: '/tmp/crash.md'
    })
  })

  it('keeps a recovered missing path occupied when the file reappears', async() => {
    const first = await createHarness()
    const opened = await open(first.fileHost, 'durable source')
    first.sessionHost.detach('renderer:1')

    const recoveredSessionHost = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(first.directory)
    )
    sessionHosts.push(recoveredSessionHost)
    const identify = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        schema: 'document-core-physical-file-identity-1' as const,
        canonicalPathname: '/tmp/note.md',
        device: '7',
        inode: '8'
      })
    let nextDocumentId = 1
    const recoveredFileHost = createDocumentCoreFileHost(
      recoveredSessionHost,
      {
        ...first.surface,
        read: vi.fn(async() => null),
        identify
      },
      () => `document:reappeared:${String(++nextDocumentId)}`,
      id => `journal:${id}`,
      first.metadataStorage
    )
    fileHosts.push(recoveredFileHost)
    await recoveredFileHost.recover(
      'renderer:2',
      'window:renderer:1',
      {
        documentId: opened.documentId,
        parseConfiguration: configuration
      }
    )

    await expect(open(
      recoveredFileHost,
      'reappeared bytes',
      '/tmp/note.md',
      'utf-8',
      'renderer:2'
    )).rejects.toMatchObject({
      name: 'DocumentCoreFileAlreadyOpenError',
      occupancy: {
        schema: 'document-core-file-occupancy-1',
        documentId: opened.documentId,
        durableWindowId: 'window:renderer:1',
        pathname: '/tmp/note.md'
      }
    })
    expect(identify).toHaveBeenCalledTimes(2)
  })

  it('removes durable recovery metadata only for an explicit tab close', async() => {
    const { fileHost, metadataRecords } = await createHarness()
    const opened = await open(fileHost, 'owned')

    await fileHost.close('renderer:1', opened.documentId)

    expect(metadataRecords.has(opened.documentId)).toBe(false)
  })

  it('reloads a clean file in main as one saved, undoable transaction', async() => {
    const { fileHost, sessionHost, surface } = await createHarness()
    const opened = await open(fileHost, 'before')
    const initial = decode(
      await fileHost.attach('renderer:1', opened.documentId)
    )
    vi.mocked(surface.read).mockResolvedValue(
      decodeFileSnapshot(new TextEncoder().encode('after'), 'utf-8')
    )

    const result = await fileHost.reload('renderer:1', {
      documentId: opened.documentId,
      force: false
    })
    const attached = decode(
      await fileHost.attach('renderer:1', opened.documentId)
    )

    expect(result).toMatchObject({
      schema: 'document-core-file-reload-1',
      kind: 'reloaded',
      documentId: opened.documentId,
      historyState: {
        canUndo: true,
        canRedo: false,
        dirty: false
      }
    })
    expect(attached.snapshot.source).toBe('after')
    const undoPublication = await sessionHost.dispatch('renderer:1', {
      documentId: opened.documentId,
      baseSnapshotId: attached.snapshot.snapshotId,
      intent: { kind: 'undo' }
    })
    const undone = decode(undoPublication, attached.codec).snapshot
    expect(undone.source).toBe('before')
    expect(undone.historyState.dirty).toBe(true)
    expect(initial.snapshot.source).toBe('before')
  })

  it('reports a dirty conflict without replacing either source', async() => {
    const { fileHost, sessionHost, surface } = await createHarness()
    const opened = await open(fileHost, 'base')
    const attached = decode(
      await fileHost.attach('renderer:1', opened.documentId)
    )
    await sessionHost.dispatch('renderer:1', {
      documentId: opened.documentId,
      baseSnapshotId: attached.snapshot.snapshotId,
      intent: {
        kind: 'edit-source',
        target: attached.snapshot.sourceSelection,
        text: 'local',
        selection: {
          anchor: { offset: 5, affinity: 'next' },
          focus: { offset: 5, affinity: 'next' }
        }
      }
    })
    vi.mocked(surface.read).mockResolvedValue(
      decodeFileSnapshot(new TextEncoder().encode('external'), 'utf-8')
    )

    const conflict = await fileHost.reload('renderer:1', {
      documentId: opened.documentId,
      force: false
    })

    expect(conflict).toMatchObject({
      kind: 'conflict',
      documentId: opened.documentId,
      historyState: { dirty: true }
    })
    const current = decode(
      await fileHost.attach('renderer:1', opened.documentId)
    ).snapshot
    expect(current.source).toBe('localbase')

    const resolved = await fileHost.resolveExternalChange(
      'renderer:1',
      opened.documentId,
      'reload'
    )
    expect(resolved).toMatchObject({
      kind: 'reloaded',
      historyState: { dirty: false }
    })
    const external = decode(
      await fileHost.attach('renderer:1', opened.documentId)
    ).snapshot
    expect(external.source).toBe('external')
  })

  it('keeps a dirty local head only after an explicit decision', async() => {
    const compareExchange = vi.fn<
      DocumentCoreFileSurface['compareExchange']
    >(async request => exchanged(request))
    const { fileHost, sessionHost, surface } = await createHarness({
      compareExchange
    })
    const opened = await open(fileHost, 'base')
    const attached = decode(
      await fileHost.attach('renderer:1', opened.documentId)
    )
    await sessionHost.dispatch('renderer:1', {
      documentId: opened.documentId,
      baseSnapshotId: attached.snapshot.snapshotId,
      intent: {
        kind: 'reload-source-from-file',
        source: 'local'
      }
    })
    vi.mocked(surface.read).mockResolvedValue(
      decodeFileSnapshot(new TextEncoder().encode('external'), 'utf-8')
    )
    expect(await fileHost.reload('renderer:1', {
      documentId: opened.documentId,
      force: false
    })).toMatchObject({ kind: 'conflict' })

    expect(await fileHost.resolveExternalChange(
      'renderer:1',
      opened.documentId,
      'keep'
    )).toEqual({
      schema: 'document-core-file-reload-1',
      kind: 'kept',
      documentId: opened.documentId
    })
    await fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save'
    })

    expect(new TextDecoder().decode(
      compareExchange.mock.calls.at(-1)?.[0].bytes ?? undefined
    )).toBe('local')
  })

  it('writes the exact original BOM, mixed-EOL, and missing-final-EOL bytes for a no-op lease', async() => {
    const original = Uint8Array.from([
      0xef, 0xbb, 0xbf,
      0x61, 0x0d, 0x0a,
      0x62, 0x0a,
      0x63, 0x0d
    ])
    const compareExchange = vi.fn<
      DocumentCoreFileSurface['compareExchange']
    >(async request => exchanged(request))
    const { fileHost } = await createHarness({ compareExchange })
    const opened = await fileHost.open('renderer:1', 'window:renderer:1', {
      fileSnapshot: decodeFileSnapshot(original, 'utf-8'),
      parseConfiguration: configuration,
      filename: 'mixed.md',
      pathname: '/tmp/mixed.md',
      defaultDirectory: '/tmp'
    })

    await fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save'
    })

    expect(compareExchange).toHaveBeenCalledWith({
      schema: 'document-core-file-compare-exchange-1',
      pathname: '/tmp/mixed.md',
      expectedByteHash: documentCoreFileByteHash(original),
      bytes: original
    })
  })

  it('serializes relocation, updates the path index, and saves only to the new path', async() => {
    let releaseFirstWrite: (() => void) | undefined
    let firstWriteStarted: (() => void) | undefined
    const firstWriteGate = new Promise<void>(resolve => {
      releaseFirstWrite = resolve
    })
    const firstWriteObserved = new Promise<void>(resolve => {
      firstWriteStarted = resolve
    })
    const compareExchange = vi.fn<
      DocumentCoreFileSurface['compareExchange']
    >(async request => {
      if (compareExchange.mock.calls.length === 1) {
        firstWriteStarted?.()
        await firstWriteGate
      }
      return exchanged(request)
    })
    const move = vi.fn<DocumentCoreFileSurface['move']>(async() => {})
    const { fileHost } = await createHarness({ move, compareExchange })
    const opened = await open(fileHost)

    const firstSave = fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save'
    })
    await firstWriteObserved
    const relocating = fileHost.relocate('renderer:1', {
      documentId: opened.documentId,
      targetPathname: '/tmp/renamed.md'
    })
    expect(move).not.toHaveBeenCalled()

    releaseFirstWrite?.()
    await firstSave
    const receipt = await relocating

    expect(receipt).toEqual({
      schema: 'document-core-path-receipt-1',
      documentId: opened.documentId,
      previousPathname: '/tmp/note.md',
      pathname: '/tmp/renamed.md',
      filename: 'renamed.md'
    })
    expect(move).toHaveBeenCalledWith({
      sourcePathname: '/tmp/note.md',
      targetPathname: '/tmp/renamed.md'
    })
    expect(fileHost.documentIdForPath('renderer:1', '/tmp/note.md')).toBeNull()
    expect(fileHost.documentIdForPath('renderer:1', '/tmp/renamed.md'))
      .toBe(opened.documentId)

    await fileHost.save('renderer:1', {
      documentId: opened.documentId,
      mode: 'save'
    })
    expect(compareExchange.mock.calls.at(-1)?.[0].pathname)
      .toBe('/tmp/renamed.md')
    expect(compareExchange).toHaveBeenCalledTimes(2)
  })

  it('retargets physical occupancy when relocation changes native identity', async() => {
    let moved = false
    const identify = vi.fn(async(pathname: string) => {
      if (pathname === '/tmp/original.md') {
        return {
          schema: 'document-core-physical-file-identity-1' as const,
          canonicalPathname: pathname,
          device: '8',
          inode: '1'
        }
      }
      if (
        moved &&
        (
          pathname === '/tmp/moved.md' ||
          pathname === '/tmp/moved-alias.md'
        )
      ) {
        return {
          schema: 'document-core-physical-file-identity-1' as const,
          canonicalPathname: '/tmp/moved.md',
          device: '9',
          inode: '2'
        }
      }
      return null
    })
    const { fileHost } = await createHarness({
      identify,
      move: vi.fn(async() => {
        moved = true
      })
    })
    const opened = await open(
      fileHost,
      'source',
      '/tmp/original.md'
    )

    await fileHost.relocate('renderer:1', {
      documentId: opened.documentId,
      targetPathname: '/tmp/moved.md'
    })
    await expect(open(
      fileHost,
      'source',
      '/tmp/moved-alias.md',
      'utf-8',
      'renderer:2'
    )).rejects.toBeInstanceOf(DocumentCoreFileAlreadyOpenError)
  })

  it('rejects a retained-path collision before touching the filesystem', async() => {
    const move = vi.fn<DocumentCoreFileSurface['move']>(async() => {})
    const { fileHost } = await createHarness({ move })
    const first = await open(fileHost, 'first', '/tmp/first.md')
    await open(fileHost, 'second', '/tmp/taken.md')

    await expect(fileHost.relocate('renderer:1', {
      documentId: first.documentId,
      targetPathname: '/tmp/taken.md'
    })).rejects.toThrow(/already.*open|collision/i)
    expect(move).not.toHaveBeenCalled()
    expect(fileHost.describe('renderer:1', first.documentId).pathname)
      .toBe('/tmp/first.md')
  })

  it('preserves retained metadata when the no-overwrite filesystem move reports a collision', async() => {
    const move = vi.fn<DocumentCoreFileSurface['move']>(async() => {
      throw Object.assign(new Error('target exists'), { code: 'EEXIST' })
    })
    const { fileHost, metadataRecords } = await createHarness({ move })
    const opened = await open(fileHost)

    await expect(fileHost.relocate('renderer:1', {
      documentId: opened.documentId,
      targetPathname: '/tmp/taken.md'
    })).rejects.toMatchObject({ code: 'EEXIST' })

    expect(fileHost.describe('renderer:1', opened.documentId)).toMatchObject({
      filename: 'note.md',
      pathname: '/tmp/note.md'
    })
    expect(metadataRecords.get(opened.documentId)).toMatchObject({
      filename: 'note.md',
      pathname: '/tmp/note.md'
    })
    expect(fileHost.documentIdForPath('renderer:1', '/tmp/note.md'))
      .toBe(opened.documentId)
    expect(fileHost.documentIdForPath('renderer:1', '/tmp/taken.md')).toBeNull()
  })

  it('rolls the filesystem, path index, and in-memory description back when durable metadata fails', async() => {
    const moves: Array<{
      readonly sourcePathname: string
      readonly targetPathname: string
    }> = []
    const move = vi.fn<DocumentCoreFileSurface['move']>(async request => {
      moves.push(request)
    })
    const {
      fileHost,
      metadataStorage
    } = await createHarness({ move })
    const opened = await open(fileHost)
    vi.mocked(metadataStorage.write)
      .mockRejectedValueOnce(new Error('metadata unavailable'))

    await expect(fileHost.relocate('renderer:1', {
      documentId: opened.documentId,
      targetPathname: '/tmp/renamed.md'
    })).rejects.toThrow('metadata unavailable')

    expect(moves).toEqual([
      {
        sourcePathname: '/tmp/note.md',
        targetPathname: '/tmp/renamed.md'
      },
      {
        sourcePathname: '/tmp/renamed.md',
        targetPathname: '/tmp/note.md'
      }
    ])
    expect(fileHost.describe('renderer:1', opened.documentId)).toMatchObject({
      filename: 'note.md',
      pathname: '/tmp/note.md'
    })
    expect(fileHost.documentIdForPath('renderer:1', '/tmp/note.md'))
      .toBe(opened.documentId)
    expect(fileHost.documentIdForPath('renderer:1', '/tmp/renamed.md'))
      .toBeNull()
  })

  it('closes each document and terminal disposal idempotently', async() => {
    const { fileHost } = await createHarness()
    const first = await open(fileHost, 'one', '/tmp/one.md')
    const second = await open(fileHost, 'two', '/tmp/two.md')

    await fileHost.close('renderer:1', first.documentId)
    await fileHost.close('renderer:1', first.documentId)
    expect(() => fileHost.describe('renderer:1', first.documentId))
      .toThrow(/unknown|closed/i)

    await fileHost.dispose()
    await fileHost.dispose()
    expect(() => fileHost.describe('renderer:1', second.documentId))
      .toThrow(/disposed|closed/i)
  })

  it('keeps a document live when terminal metadata cleanup rejects', async() => {
    let rejectRemoval = true
    const remove = vi.fn(async() => {
      if (rejectRemoval) throw new Error('metadata cleanup failed')
    })
    const { fileHost, sessionHost } = await createHarness(
      undefined,
      { remove }
    )
    const opened = await open(fileHost, 'still owned')

    await expect(
      fileHost.close('renderer:1', opened.documentId)
    ).rejects.toThrow(/metadata cleanup failed/)
    expect(fileHost.describe('renderer:1', opened.documentId).documentId)
      .toBe(opened.documentId)
    expect(sessionHost.resourceCounts()).toEqual({
      sessionCount: 1,
      workerCount: 1
    })

    rejectRemoval = false
    await fileHost.close('renderer:1', opened.documentId)
    expect(() => fileHost.describe('renderer:1', opened.documentId))
      .toThrow(/unknown|closed/i)
    expect(sessionHost.resourceCounts()).toEqual({
      sessionCount: 0,
      workerCount: 0
    })
  })

  it('terminally disposes a detached document without impersonating its renderer', async() => {
    const { fileHost, sessionHost } = await createHarness()
    await open(fileHost, 'detached')
    expect(sessionHost.resourceCounts()).toEqual({
      sessionCount: 1,
      workerCount: 1
    })

    sessionHost.detach('renderer:1')
    await fileHost.dispose()

    expect(sessionHost.resourceCounts()).toEqual({
      sessionCount: 0,
      workerCount: 0
    })
  })
})
