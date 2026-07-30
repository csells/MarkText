import {
  createDocumentSearchQuery,
  modelPositionAtMarkupCoordinateMap,
  WireEnvelopeCodecV1,
  type DocumentSessionJournalCommit,
  type DocumentSessionJournalMutation,
  type DocumentSessionJournalStorage,
  type EditorIntent,
  type MarkupCoordinateMapV1,
  type ParseConfiguration,
  type WireEnvelopeV1
} from '@marktext/document-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFileDocumentSessionJournalStorage } from 'main_renderer/documentCore/durableSessionJournalStorage'
import {
  decodeDocumentCorePublication,
  type DocumentCoreMainSessionHost
} from 'main_renderer/documentCore/mainSessionHost'
import {
  createTestDocumentCoreMainSessionHost as createDocumentCoreMainSessionHost
} from '../helpers/documentSessionHost'
import {
  createDocumentCoreRemoteSession,
  type DocumentCoreRemoteSession,
  type DocumentCoreRemoteSessionOptions
} from '@/components/editorWithTabs/documentCoreRemoteSession'
import type {
  DocumentCoreCancelDispatchRequest,
  DocumentCoreCompleteDispatchRequest,
  DocumentCoreClipboardWriteRequest,
  DocumentCoreExecutionReport,
  DocumentCoreMainDispatchRequest,
  DocumentCoreMainSelectRequest,
  DocumentCorePublication,
  DocumentCoreReconfigureMarkdownOptionsRequest
} from '@shared/types/documentCore'
import type { ImageAssetInsertRequest } from '@shared/types/imageAsset'
import type {
  DocumentClipboardPasteRequest
} from '@shared/types/clipboardTransactions'

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

afterEach(async() => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

function controllableAdmissionStorage(
  delegate: DocumentSessionJournalStorage
): Readonly<{
    storage: DocumentSessionJournalStorage
    block: () => void
    release: () => void
  }> {
  let blocked = false
  let release: (() => void) | undefined
  return Object.freeze({
    storage: Object.freeze({
      read: delegate.read,
      compareExchange: async(
        key: string,
        expectedRevision: number | null,
        mutation: DocumentSessionJournalMutation
      ): Promise<DocumentSessionJournalCommit | null> => {
        if (blocked) {
          await new Promise<void>((resolve) => {
            release = resolve
          })
        }
        return delegate.compareExchange(key, expectedRevision, mutation)
      }
    }),
    block: () => {
      blocked = true
    },
    release: () => {
      blocked = false
      release?.()
    }
  })
}

async function invokeHost(
  host: DocumentCoreMainSessionHost,
  channel: Parameters<DocumentCoreRemoteSessionOptions['invoke']>[0],
  rawRequest: unknown
): Promise<unknown> {
  if (channel === 'mt::document-core::attach') {
    const request = rawRequest as { readonly documentId: string }
    const durabilityKey = admittedDocuments
      .get(host)
      ?.get(request.documentId)
    if (durabilityKey === undefined) {
      throw new Error(`Unknown admitted document ${request.documentId}`)
    }
    const ticket = await host.startOpen('renderer:1', {
      documentId: request.documentId,
      durabilityKey,
      sourceLength: 0,
      parseConfiguration: configuration
    })
    if (ticket.requiresSource) {
      throw new Error('Renderer attachment unexpectedly requested source')
    }
    return await host.completeOpen(
      'renderer:1',
      request.documentId,
      ticket.ticketId
    )
  }
  if (channel === 'mt::document-core::dispatch-start') {
    return await host.startDispatch(
      'renderer:1',
      rawRequest as DocumentCoreMainDispatchRequest
    )
  }
  if (channel === 'mt::document-core::dispatch-complete') {
    const request = rawRequest as DocumentCoreCompleteDispatchRequest
    return await host.completeDispatch(
      'renderer:1',
      request.documentId,
      request.ticketId
    )
  }
  if (channel === 'mt::document-core::dispatch-cancel') {
    const request = rawRequest as DocumentCoreCancelDispatchRequest
    return await host.cancelDispatch(
      'renderer:1',
      request.documentId,
      request.ticketId
    )
  }
  if (channel === 'mt::document-core::select') {
    return await host.select(
      'renderer:1',
      rawRequest as DocumentCoreMainSelectRequest
    )
  }
  if (channel === 'mt::document-core::reconfigure-markdown-options') {
    return await host.reconfigureMarkdownOptions(
      'renderer:1',
      rawRequest as DocumentCoreReconfigureMarkdownOptionsRequest
    )
  }
  if (channel === 'mt::document-core::write-clipboard') {
    const request = rawRequest as DocumentCoreClipboardWriteRequest
    const materialized = await host.materializeClipboard(
      'renderer:1',
      request.documentId,
      request.revisionId,
      request.consumer === 'copy-heading-link'
        ? {
          view: request.view,
          consumer: request.consumer,
          targetNodeId: request.targetNodeId
        }
        : {
          view: request.view,
          consumer: request.consumer,
          selection: request.selection
        }
    )
    if (materialized.kind === 'unavailable') return materialized
    if (materialized.revision.id !== request.revisionId) {
      throw new Error('Clipboard requested stale revision')
    }
    if (materialized.artifact.kind === 'disabled') {
      return materialized.artifact
    }
    if (materialized.artifact.kind === 'cut-preparation') {
      const publication = await host.completeCut(
        'renderer:1',
        request.documentId,
        materialized.artifact.ticketId,
        true
      )
      if (!('envelope' in publication)) {
        throw new Error('Expected a cut publication')
      }
      return Object.freeze({
        kind: 'cut-committed' as const,
        consumer: request.consumer as 'cut' | 'cut-table',
        publication
      })
    }
    return Object.freeze({
      kind: 'written' as const,
      consumer: request.consumer
    })
  }
  if (channel === 'mt::document::paste-clipboard') {
    const request = rawRequest as DocumentClipboardPasteRequest
    return await host.dispatch('renderer:1', {
      documentId: request.documentId,
      baseSnapshotId: request.baseSnapshotId,
      intent: {
        kind: 'paste-text',
        target: request.target,
        text: ' main clipboard',
        source: 'external-text'
      }
    })
  }
  if (channel === 'mt::image-assets::activate-document') {
    const request = rawRequest as { readonly documentId: string }
    if (!admittedDocuments.get(host)?.has(request.documentId)) {
      throw new Error(`Unknown admitted document ${request.documentId}`)
    }
    return Object.freeze({
      schema: 'image-asset-activation-receipt-1',
      documentId: request.documentId,
      generation: 1
    })
  }
  if (channel === 'mt::image-assets::insert') {
    const request = rawRequest as ImageAssetInsertRequest
    const reference = 'assets/content-hash.png'
    const publication = await host.dispatch('renderer:1', {
      documentId: request.documentId,
      baseSnapshotId: request.baseSnapshotId,
      intent: {
        kind: 'insert-image',
        target: request.target,
        src: reference,
        alt: request.alt,
        ...(request.title === undefined ? {} : { title: request.title })
      }
    })
    return Object.freeze({
      schema: 'image-asset-insert-receipt-1',
      kind: 'published',
      documentId: request.documentId,
      asset: Object.freeze({
        schema: 'image-asset-receipt-1',
        kind: 'stored',
        documentId: request.documentId,
        reference,
        mediaType: 'image/png',
        byteLength: 8
      }),
      publication
    })
  }
  throw new Error(`Unhandled remote-session channel ${channel}`)
}

const admittedDocuments = new WeakMap<
  DocumentCoreMainSessionHost,
  Map<string, string>
>()

async function admitDocument(
  host: DocumentCoreMainSessionHost,
  documentId: string,
  durabilityKey: string,
  source: string
): Promise<void> {
  const ticket = await host.startOpen('renderer:1', {
    documentId,
    durabilityKey,
    sourceLength: source.length,
    parseConfiguration: configuration
  })
  let ordinal = 0
  for (
    let offset = 0;
    offset < source.length;
    offset += ticket.chunkUnits
  ) {
    await host.appendOpenChunk(
      'renderer:1',
      documentId,
      ticket.ticketId,
      ordinal,
      source.slice(offset, offset + ticket.chunkUnits)
    )
    ordinal += 1
  }
  await host.completeOpen('renderer:1', documentId, ticket.ticketId)
  let documents = admittedDocuments.get(host)
  if (documents === undefined) {
    documents = new Map()
    admittedDocuments.set(host, documents)
  }
  documents.set(documentId, durabilityKey)
}

function addUnknownParseConfigurationField(
  rawPublication: unknown
): unknown {
  if (
    rawPublication === null ||
    typeof rawPublication !== 'object' ||
    !('baseSnapshotId' in rawPublication) ||
    typeof rawPublication.baseSnapshotId !== 'string' ||
    !('envelope' in rawPublication)
  ) {
    throw new TypeError('Expected a document-core publication fixture')
  }
  const publication = rawPublication as {
    readonly baseSnapshotId: string
    readonly envelope: WireEnvelopeV1
  }
  const codec = new WireEnvelopeCodecV1()
  const decoded = codec.publish(
    publication.envelope,
    publication.baseSnapshotId
  )
  if (decoded.kind !== 'published') {
    throw new Error(`Could not decode publication: ${decoded.reason}`)
  }
  const sessionBytes = decoded.members.sessionDelta
  if (sessionBytes === undefined) {
    throw new TypeError('Publication fixture has no session delta')
  }
  const session = JSON.parse(new TextDecoder().decode(sessionBytes)) as {
    parseConfiguration: Record<string, unknown>
  }
  session.parseConfiguration = {
    ...session.parseConfiguration,
    rendererOverride: true
  }
  const envelope = codec.encode({
    publicationId: publication.envelope.publicationId,
    baseSnapshotId: publication.envelope.baseSnapshotId,
    nextSnapshotId: publication.envelope.nextSnapshotId,
    transitionId: publication.envelope.transitionId,
    members: {
      ...decoded.members,
      sessionDelta: Uint8Array.from(Buffer.from(JSON.stringify(session)))
    }
  })
  const verified = new WireEnvelopeCodecV1().publish(
    envelope,
    publication.baseSnapshotId
  )
  if (verified.kind !== 'published') {
    throw new Error(`Tampered publication is invalid: ${verified.reason}`)
  }
  return remeasurePublication(
    rawPublication as DocumentCorePublication,
    envelope
  )
}

type JsonPublicationMember =
  | 'sessionDelta'
  | 'reviewDelta'
  | 'terminalOutcomeDelta'

function remeasurePublication(
  publication: DocumentCorePublication,
  envelope: WireEnvelopeV1
): DocumentCorePublication {
  const serializedMemberBytes = Object.fromEntries(
    envelope.members.map(member => [member.name, member.byteLength])
  )
  return Object.freeze({
    ...publication,
    envelope,
    execution: Object.freeze({
      ...publication.execution,
      serializedPayloadBytes: envelope.members.reduce(
        (total, member) => total + member.byteLength,
        0
      ),
      serializedMemberBytes: Object.freeze(serializedMemberBytes)
    })
  })
}

function transformJsonPublicationMember(
  rawPublication: unknown,
  member: JsonPublicationMember,
  transform: (value: Record<string, unknown>) => Record<string, unknown>
): unknown {
  if (
    rawPublication === null ||
    typeof rawPublication !== 'object' ||
    !('baseSnapshotId' in rawPublication) ||
    typeof rawPublication.baseSnapshotId !== 'string' ||
    !('envelope' in rawPublication)
  ) {
    throw new TypeError('Expected a document-core publication fixture')
  }
  const publication = rawPublication as {
    readonly baseSnapshotId: string
    readonly envelope: WireEnvelopeV1
  }
  const codec = new WireEnvelopeCodecV1()
  const decoded = codec.publish(
    publication.envelope,
    publication.baseSnapshotId
  )
  if (decoded.kind !== 'published') {
    throw new Error(`Could not decode publication: ${decoded.reason}`)
  }
  const bytes = decoded.members[member]
  if (bytes === undefined) {
    throw new TypeError(`Publication fixture has no ${member}`)
  }
  const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Publication fixture ${member} is not a record`)
  }
  const envelope = codec.encode({
    publicationId: publication.envelope.publicationId,
    baseSnapshotId: publication.envelope.baseSnapshotId,
    nextSnapshotId: publication.envelope.nextSnapshotId,
    transitionId: publication.envelope.transitionId,
    members: {
      ...decoded.members,
      [member]: Uint8Array.from(Buffer.from(JSON.stringify(
        transform(value as Record<string, unknown>)
      )))
    }
  })
  const verified = new WireEnvelopeCodecV1().publish(
    envelope,
    publication.baseSnapshotId
  )
  if (verified.kind !== 'published') {
    throw new Error(`Tampered publication is invalid: ${verified.reason}`)
  }
  return remeasurePublication(
    rawPublication as DocumentCorePublication,
    envelope
  )
}

function removeTerminalOutcomeFromCutReceipt(rawReceipt: unknown): unknown {
  if (
    rawReceipt === null ||
    typeof rawReceipt !== 'object' ||
    !('kind' in rawReceipt) ||
    rawReceipt.kind !== 'cut-committed' ||
    !('publication' in rawReceipt) ||
    rawReceipt.publication === null ||
    typeof rawReceipt.publication !== 'object'
  ) {
    throw new TypeError('Expected a committed cut receipt fixture')
  }
  const publication = rawReceipt.publication as DocumentCorePublication
  const codec = new WireEnvelopeCodecV1()
  const decoded = codec.publish(
    publication.envelope,
    publication.baseSnapshotId
  )
  if (decoded.kind !== 'published') {
    throw new Error(`Could not decode cut publication: ${decoded.reason}`)
  }
  const {
    terminalOutcomeDelta: _removedTerminalOutcome,
    ...members
  } = decoded.members
  const envelope = codec.encode({
    publicationId: publication.envelope.publicationId,
    baseSnapshotId: publication.envelope.baseSnapshotId,
    nextSnapshotId: publication.envelope.nextSnapshotId,
    transitionId: publication.envelope.transitionId,
    members
  })
  return Object.freeze({
    ...rawReceipt,
    publication: remeasurePublication(publication, envelope)
  })
}

describe('renderer client for the main-owned document session', () => {
  it('publishes an authenticated compact source edit against the mounted base', async() => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-source-edit-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    const documentId = 'remote-source-edit'
    const source = 'x'.repeat(1_000_000)
    await admitDocument(host, documentId, `${documentId}-v1`, source)
    const reports: DocumentCoreExecutionReport[] = []
    const remote = await createDocumentCoreRemoteSession({
      documentId: () => documentId,
      onHistoryState: vi.fn(),
      onExecutionReport: (_reportedDocumentId, report) => {
        reports.push(report)
      },
      invoke: (channel, request) => invokeHost(host, channel, request)
    })

    const initial = remote.snapshot()
    if (initial.kind !== 'complete') {
      throw new Error('Expected a complete source-edit fixture')
    }
    const start = source.length - 1
    await expect(remote.dispatch({
      kind: 'replace-text',
      target: {
        ...initial.selection,
        anchor: { offset: start, affinity: 'next' },
        focus: { offset: source.length, affinity: 'previous' }
      },
      text: 'z'
    })).resolves.toEqual({
      kind: 'committed',
      sourceEdits: [{ start, end: source.length, insert: 'z' }]
    })

    expect(remote.snapshot().source).toBe(`${source.slice(0, -1)}z`)
    expect(reports.at(-1)?.operationKind).toBe('dispatch')
    expect(reports.at(-1)?.serializedMemberBytes.sessionDelta)
      .toBeLessThan(4_096)

    await remote.close()
    await host.close('renderer:1', documentId)
  }, 30_000)

  it('recovers the verified full head after rejecting a hostile source edit', async() => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-source-recovery-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    const documentId = 'remote-source-recovery'
    await admitDocument(host, documentId, `${documentId}-v1`, 'alpha')
    let corruptNextDispatch = true
    const remote = await createDocumentCoreRemoteSession({
      documentId: () => documentId,
      onHistoryState: vi.fn(),
      invoke: async(channel, request) => {
        const response = await invokeHost(host, channel, request)
        if (
          channel !== 'mt::document-core::dispatch-complete' ||
          !corruptNextDispatch
        ) {
          return response
        }
        corruptNextDispatch = false
        return transformJsonPublicationMember(
          response,
          'sessionDelta',
          value => ({
            ...value,
            sourceDelta: {
              ...(value.sourceDelta as Record<string, unknown>),
              baseRevisionId: 'hostile-revision'
            }
          })
        )
      }
    })

    const initial = remote.snapshot()
    if (initial.kind !== 'complete') {
      throw new Error('Expected a complete source-recovery fixture')
    }
    await expect(remote.dispatch({
      kind: 'insert-text',
      target: {
        ...initial.selection,
        anchor: { offset: 0, affinity: 'next' },
        focus: { offset: 0, affinity: 'next' }
      },
      text: 'X'
    })).rejects.toThrow(/exact base/i)

    expect(remote.snapshot().source).toBe('Xalpha')
    const recovered = remote.snapshot()
    if (recovered.kind !== 'complete') {
      throw new Error('Expected a recovered complete snapshot')
    }
    await expect(remote.dispatch({
      kind: 'insert-text',
      target: {
        ...recovered.selection,
        anchor: { offset: 1, affinity: 'next' },
        focus: { offset: 1, affinity: 'next' }
      },
      text: 'Y'
    })).resolves.toMatchObject({ kind: 'committed' })
    expect(remote.snapshot().source).toBe('XYalpha')

    await remote.close()
    await host.close('renderer:1', documentId)
  })

  it('applies a maximum-shaped sorted edit set in one exact publication', async() => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-many-source-edits-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    const documentId = 'remote-many-source-edits'
    const matchCount = 16_384
    const source = `${Array.from(
      { length: matchCount },
      () => 'one'
    ).join(' ')}\n`
    await admitDocument(host, documentId, `${documentId}-v1`, source)
    const remote = await createDocumentCoreRemoteSession({
      documentId: () => documentId,
      onHistoryState: vi.fn(),
      invoke: (channel, request) => invokeHost(host, channel, request)
    })
    const initial = remote.snapshot()
    if (initial.kind !== 'complete') {
      throw new Error('Expected a complete many-edit fixture')
    }

    const outcome = await remote.dispatch({
      kind: 'replace-current-matches',
      target: initial.selection,
      query: createDocumentSearchQuery('one'),
      replacement: 'two'
    })
    expect(outcome).toMatchObject({ kind: 'committed' })
    if (outcome.kind !== 'committed') {
      throw new Error('Expected a committed many-edit outcome')
    }
    expect(outcome.sourceEdits).toHaveLength(matchCount)
    expect(outcome.sourceEdits[0]).toEqual({
      start: 0,
      end: 3,
      insert: 'two'
    })
    expect(outcome.sourceEdits.at(-1)).toEqual({
      start: (matchCount - 1) * 4,
      end: (matchCount - 1) * 4 + 3,
      insert: 'two'
    })
    expect(remote.snapshot().source).toBe(`${Array.from(
      { length: matchCount },
      () => 'two'
    ).join(' ')}\n`)

    await remote.close()
    await host.close('renderer:1', documentId)
  }, 30_000)

  it('mounts clean projections with their retained Markup model length', async() => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-clean-projections-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    const documentId = 'remote-clean-projections'
    const source = '{~~old~>new~~}'
    await admitDocument(
      host,
      documentId,
      `${documentId}-v1`,
      source
    )
    const remote = await createDocumentCoreRemoteSession({
      documentId: () => documentId,
      onHistoryState: vi.fn(),
      invoke: (channel, request) => invokeHost(host, channel, request)
    })

    expect(await remote.dispatch({
      kind: 'set-projection',
      projection: 'original'
    })).toMatchObject({ kind: 'state-changed' })
    const original = remote.snapshot()
    if (original.kind !== 'complete') {
      throw new Error('Expected a complete Original snapshot')
    }
    expect(original).toMatchObject({
      projection: 'original',
      modelText: 'old',
      markupModelLength: 6
    })

    expect(await remote.dispatch({
      kind: 'set-projection',
      projection: 'revised'
    })).toMatchObject({ kind: 'state-changed' })
    const revised = remote.snapshot()
    if (revised.kind !== 'complete') {
      throw new Error('Expected a complete Revised snapshot')
    }
    expect(revised).toMatchObject({
      projection: 'revised',
      modelText: 'new',
      markupModelLength: 6
    })

    await remote.close()
    await host.close('renderer:1', documentId)
  })

  it('keeps the mounted snapshot atomic when a history observer throws', async() => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-atomic-observer-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    const documentId = 'remote-atomic-observer'
    await admitDocument(host, documentId, `${documentId}-v1`, 'alpha')
    let throwNextHistory = false
    const remote = await createDocumentCoreRemoteSession({
      documentId: () => documentId,
      onHistoryState: () => {
        if (!throwNextHistory) return
        throwNextHistory = false
        throw new Error('history observer failed')
      },
      invoke: (channel, request) => invokeHost(host, channel, request)
    })

    const initial = remote.snapshot()
    if (initial.kind !== 'complete') {
      throw new Error('Expected a complete observer fixture')
    }
    throwNextHistory = true
    await expect(remote.dispatch({
      kind: 'insert-text',
      target: {
        ...initial.selection,
        anchor: { offset: 0, affinity: 'next' },
        focus: { offset: 0, affinity: 'next' }
      },
      text: 'X'
    })).rejects.toThrow('history observer failed')
    expect(remote.snapshot().source).toBe('Xalpha')

    const afterObserverFailure = remote.snapshot()
    if (afterObserverFailure.kind !== 'complete') {
      throw new Error('Expected a complete mounted snapshot')
    }
    await expect(remote.dispatch({
      kind: 'insert-text',
      target: {
        ...afterObserverFailure.selection,
        anchor: { offset: 1, affinity: 'next' },
        focus: { offset: 1, affinity: 'next' }
      },
      text: 'Y'
    })).resolves.toMatchObject({ kind: 'committed' })
    expect(remote.snapshot().source).toBe('XYalpha')

    await remote.close()
    await host.close('renderer:1', documentId)
  })

  it('rejects a checksummed publication with an extended parse configuration', async() => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-configuration-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    await admitDocument(
      host,
      'remote-configuration',
      'remote-configuration-v1',
      'alpha'
    )

    await expect(createDocumentCoreRemoteSession({
      documentId: () => 'remote-configuration',
      onHistoryState: vi.fn(),
      invoke: async(channel, request) => {
        const response = await invokeHost(host, channel, request)
        return channel === 'mt::document-core::attach'
          ? addUnknownParseConfigurationField(response)
          : response
      }
    })).rejects.toThrow(/ParseConfiguration|closed|unknown/i)
  })

  it.each([
    {
      member: 'sessionDelta' as const,
      description: 'session delta with an unknown field',
      transform: (value: Record<string, unknown>) => ({
        ...value,
        rendererOverride: true
      })
    },
    {
      member: 'sessionDelta' as const,
      description: 'session delta with a false source hash',
      transform: (value: Record<string, unknown>) => ({
        ...value,
        sourceHash: '0'.repeat(64)
      })
    },
    {
      member: 'sessionDelta' as const,
      description: 'session delta with a false semantic hash',
      transform: (value: Record<string, unknown>) => ({
        ...value,
        semanticHash: '0'.repeat(64)
      })
    },
    {
      member: 'reviewDelta' as const,
      description: 'Review delta with an unknown field',
      transform: (value: Record<string, unknown>) => ({
        ...value,
        rendererOverride: true
      })
    }
  ])('rejects an authenticated $description', async({
    member,
    transform
  }) => {
    const directory = await mkdtemp(join(
      tmpdir(),
      `marktext-remote-${member}-`
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    await admitDocument(
      host,
      `remote-${member}`,
      `remote-${member}-v1`,
      'alpha'
    )
    let remote: DocumentCoreRemoteSession | undefined
    const creation = createDocumentCoreRemoteSession({
      documentId: () => `remote-${member}`,
      onHistoryState: vi.fn(),
      invoke: async(channel, request) => {
        const response = await invokeHost(host, channel, request)
        return channel === 'mt::document-core::attach'
          ? transformJsonPublicationMember(
            response,
            member,
            transform
          )
          : response
      }
    }).then((created) => {
      remote = created
      return created
    })

    try {
      await expect(creation).rejects.toThrow(/closed|unknown|invalid|hash/i)
    } finally {
      await remote?.close()
      await host.close('renderer:1', `remote-${member}`)
    }
  })

  it.each([
    {
      description: 'a different document identity',
      mutate: (value: DocumentCorePublication): unknown => ({
        ...value,
        documentId: 'another-document'
      })
    },
    {
      description: 'an unknown publication field',
      mutate: (value: DocumentCorePublication): unknown => ({
        ...value,
        rendererOverride: true
      })
    },
    {
      description: 'a missing execution report',
      mutate: (value: DocumentCorePublication): unknown => {
        const { execution: _execution, ...withoutExecution } = value
        return withoutExecution
      }
    },
    {
      description: 'an extended execution report',
      mutate: (value: DocumentCorePublication): unknown => ({
        ...value,
        execution: {
          ...value.execution,
          rendererOverride: true
        }
      })
    },
    {
      description: 'a fractional execution counter',
      mutate: (value: DocumentCorePublication): unknown => ({
        ...value,
        execution: {
          ...value.execution,
          checkpointCount: 1.5
        }
      })
    },
    {
      description: 'an execution operation from another request',
      mutate: (value: DocumentCorePublication): unknown => ({
        ...value,
        execution: {
          ...value.execution,
          operationKind: 'dispatch'
        }
      })
    },
    {
      description: 'an impossible operation checkpoint total',
      mutate: (value: DocumentCorePublication): unknown => ({
        ...value,
        execution: {
          ...value.execution,
          operationCheckpointCount: value.execution.checkpointCount + 1
        }
      })
    },
    {
      description: 'a false serialized payload total',
      mutate: (value: DocumentCorePublication): unknown => ({
        ...value,
        execution: {
          ...value.execution,
          serializedPayloadBytes:
            value.execution.serializedPayloadBytes + 1
        }
      })
    },
    {
      description: 'a false serialized member total',
      mutate: (value: DocumentCorePublication): unknown => {
        const serializedMemberBytes = {
          ...value.execution.serializedMemberBytes
        }
        const field = Reflect.ownKeys(serializedMemberBytes)[0]
        if (typeof field !== 'string') {
          throw new Error('Expected serialized member metrics')
        }
        serializedMemberBytes[
          field as keyof typeof serializedMemberBytes
        ] = Number(serializedMemberBytes[
          field as keyof typeof serializedMemberBytes
        ]) + 1
        return {
          ...value,
          execution: { ...value.execution, serializedMemberBytes }
        }
      }
    },
    {
      description: 'serialized member metrics with a hostile prototype',
      mutate: (value: DocumentCorePublication): unknown => ({
        ...value,
        execution: {
          ...value.execution,
          serializedMemberBytes: Object.assign(
            Object.create({ inheritedBytes: 1 }),
            value.execution.serializedMemberBytes
          )
        }
      })
    },
    {
      description: 'serialized member metrics with an accessor field',
      mutate: (value: DocumentCorePublication): unknown => {
        const serializedMemberBytes = {
          ...value.execution.serializedMemberBytes
        }
        const field = Reflect.ownKeys(serializedMemberBytes)[0]
        if (typeof field !== 'string') {
          throw new Error('Expected serialized member metrics')
        }
        Object.defineProperty(serializedMemberBytes, field, {
          enumerable: true,
          get: () => value.execution.serializedMemberBytes[
            field as keyof typeof value.execution.serializedMemberBytes
          ]
        })
        return {
          ...value,
          execution: { ...value.execution, serializedMemberBytes }
        }
      }
    },
    {
      description: 'an extended wire envelope',
      mutate: (value: DocumentCorePublication): unknown => ({
        ...value,
        envelope: {
          ...value.envelope,
          rendererOverride: true
        }
      })
    },
    {
      description: 'an extended wire member',
      mutate: (value: DocumentCorePublication): unknown => ({
        ...value,
        envelope: {
          ...value.envelope,
          members: value.envelope.members.map((member, index) =>
            index === 0
              ? { ...member, rendererOverride: true }
              : member)
        }
      })
    },
    {
      description: 'an extended wire chunk',
      mutate: (value: DocumentCorePublication): unknown => ({
        ...value,
        envelope: {
          ...value.envelope,
          members: value.envelope.members.map((member, memberIndex) =>
            memberIndex === 0
              ? {
                ...member,
                chunks: member.chunks.map((chunk, chunkIndex) =>
                  chunkIndex === 0
                    ? { ...chunk, rendererOverride: true }
                    : chunk)
              }
              : member)
        }
      })
    }
  ])('rejects an authenticated outer publication with $description', async({
    mutate
  }) => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-publication-receipt-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    const documentId = 'remote-publication-receipt'
    await admitDocument(host, documentId, `${documentId}-v1`, 'alpha')
    let remote: DocumentCoreRemoteSession | undefined
    const creation = createDocumentCoreRemoteSession({
      documentId: () => documentId,
      onHistoryState: vi.fn(),
      invoke: async(channel, request) => {
        const response = await invokeHost(host, channel, request)
        return channel === 'mt::document-core::attach'
          ? mutate(response as DocumentCorePublication)
          : response
      }
    }).then((created) => {
      remote = created
      return created
    })

    try {
      await expect(creation).rejects.toThrow(
        /publication|execution|serialized|member|unknown|missing|field/i
      )
    } finally {
      await remote?.close()
      await host.close('renderer:1', documentId)
    }
  })

  it.each([
    {
      description: 'an unknown field',
      mutate: (value: Record<string, unknown>): unknown => ({
        ...value,
        rendererOverride: true
      })
    },
    {
      description: 'a hostile prototype',
      mutate: (value: Record<string, unknown>): unknown => Object.assign(
        Object.create({ inheritedGeneration: 2 }),
        value
      )
    },
    {
      description: 'an accessor field',
      mutate: (value: Record<string, unknown>): unknown => {
        const receipt = { ...value }
        Object.defineProperty(receipt, 'generation', {
          enumerable: true,
          get: () => 1
        })
        return receipt
      }
    }
  ])('rejects an image activation receipt with $description', async({
    mutate
  }) => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-image-activation-receipt-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    const documentId = 'remote-image-activation-receipt'
    await admitDocument(host, documentId, `${documentId}-v1`, 'alpha')

    try {
      await expect(createDocumentCoreRemoteSession({
        documentId: () => documentId,
        onHistoryState: vi.fn(),
        invoke: async(channel, request) => {
          const response = await invokeHost(host, channel, request)
          return channel === 'mt::image-assets::activate-document'
            ? mutate(response as Record<string, unknown>)
            : response
        }
      })).rejects.toThrow(/image activation receipt|closed record|unknown/i)
    } finally {
      await host.close('renderer:1', documentId)
    }
  })

  it.each([
    {
      description: 'an unknown field',
      mutate: (value: Record<string, unknown>): unknown => ({
        ...value,
        rendererOverride: true
      })
    },
    {
      description: 'a mismatched document',
      mutate: (value: Record<string, unknown>): unknown => ({
        ...value,
        documentId: 'some-other-document'
      })
    },
    {
      description: 'a mismatched base snapshot',
      mutate: (value: Record<string, unknown>): unknown => ({
        ...value,
        baseSnapshotId: 'snapshot:some-other-base'
      })
    },
    {
      description: 'a fractional client sequence',
      mutate: (value: Record<string, unknown>): unknown => ({
        ...value,
        clientSequence: 1.5
      })
    }
  ])('rejects a dispatch ticket with $description', async({ mutate }) => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-dispatch-ticket-receipt-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    const documentId = 'remote-dispatch-ticket-receipt'
    await admitDocument(host, documentId, `${documentId}-v1`, 'alpha')
    const remote = await createDocumentCoreRemoteSession({
      documentId: () => documentId,
      onHistoryState: vi.fn(),
      invoke: async(channel, request) => {
        const response = await invokeHost(host, channel, request)
        return channel === 'mt::document-core::dispatch-start'
          ? mutate(response as Record<string, unknown>)
          : response
      }
    })

    try {
      await expect(remote.dispatch({ kind: 'undo' })).rejects.toThrow(
        /document-core dispatch ticket|closed record|unknown/i
      )
    } finally {
      await remote.close()
      await host.close('renderer:1', documentId)
    }
  })

  it.each([
    {
      description: 'unknown kind',
      intent: { kind: 'undo' } as const,
      transform: () => ({
        schema: 'document-core-terminal-outcome-1',
        kind: 'future-result',
        reason: 'future-reason'
      })
    },
    {
      description: 'unknown rejection reason',
      intent: { kind: 'undo' } as const,
      transform: (value: Record<string, unknown>) => ({
        ...value,
        reason: 'future-reason'
      })
    },
    {
      description: 'unknown field',
      intent: {
        kind: 'set-projection',
        projection: 'original'
      } as const,
      transform: (value: Record<string, unknown>) => ({
        ...value,
        rendererOverride: true
      })
    },
    {
      description: 'a transition identity different from its envelope',
      intent: {
        kind: 'insert-text',
        target: {
          session: 'placeholder',
          revision: 'placeholder',
          view: 'markup',
          anchor: { offset: 0, affinity: 'next' },
          focus: { offset: 0, affinity: 'next' }
        },
        text: 'X'
      } as const,
      transform: (value: Record<string, unknown>) => ({
        ...value,
        transitionId: 'transition:borrowed'
      })
    }
  ])('rejects an authenticated terminal outcome with an $description', async({
    intent,
    transform
  }) => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-terminal-outcome-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    const documentId = `remote-terminal-${intent.kind}`
    await admitDocument(host, documentId, `${documentId}-v1`, 'alpha')
    let tamperNextOutcome = false
    const remote = await createDocumentCoreRemoteSession({
      documentId: () => documentId,
      onHistoryState: vi.fn(),
      invoke: async(channel, request) => {
        const response = await invokeHost(host, channel, request)
        if (
          tamperNextOutcome &&
          channel === 'mt::document-core::dispatch-complete'
        ) {
          tamperNextOutcome = false
          return transformJsonPublicationMember(
            response,
            'terminalOutcomeDelta',
            transform
          )
        }
        return response
      }
    })

    try {
      tamperNextOutcome = true
      const actualIntent = intent.kind === 'insert-text'
        ? {
          ...intent,
          target: {
            ...remote.snapshot().selection,
            anchor: intent.target.anchor,
            focus: intent.target.focus
          }
        }
        : intent
      await expect(remote.dispatch(actualIntent as EditorIntent)).rejects.toThrow(
        /terminal outcome|transition|unknown|invalid|closed/i
      )
    } finally {
      await remote.close()
      await host.close('renderer:1', documentId)
    }
  })

  it('makes the main publication decoder close every authenticated member field', async() => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-main-publication-codec-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    const documentId = 'main-publication-codec'
    await admitDocument(
      host,
      documentId,
      `${documentId}-v1`,
      'alpha {++beta++}'
    )
    const publication = await invokeHost(
      host,
      'mt::document-core::attach',
      { documentId }
    )
    const mutations: ReadonlyArray<Readonly<{
      member: 'sessionDelta' | 'reviewDelta'
      transform: (
        value: Record<string, unknown>
      ) => Record<string, unknown>
    }>> = [
      {
        member: 'sessionDelta',
        transform: value => ({ ...value, rendererOverride: true })
      },
      {
        member: 'sessionDelta',
        transform: value => ({ ...value, sourceHash: 'not-a-source-hash' })
      },
      {
        member: 'sessionDelta',
        transform: value => ({ ...value, semanticHash: 'not-a-semantic-hash' })
      },
      {
        member: 'sessionDelta',
        transform: value => ({
          ...value,
          facts: {
            ...(value.facts as Record<string, unknown>),
            rendererOverride: true
          }
        })
      },
      {
        member: 'sessionDelta',
        transform: value => ({
          ...value,
          selection: {
            ...(value.selection as Record<string, unknown>),
            rendererOverride: true
          }
        })
      },
      {
        member: 'reviewDelta',
        transform: value => ({ ...value, rendererOverride: true })
      },
      {
        member: 'reviewDelta',
        transform: value => ({
          ...value,
          reviewIndex: {
            ...(value.reviewIndex as Record<string, unknown>),
            rendererOverride: true
          }
        })
      },
      {
        member: 'reviewDelta',
        transform: value => {
          const reviewIndex = value.reviewIndex as Record<string, unknown>
          const items = reviewIndex.items as Array<Record<string, unknown>>
          return {
            ...value,
            reviewIndex: {
              ...reviewIndex,
              items: items.map((item, index) => index === 0
                ? { ...item, rendererOverride: true }
                : item)
            }
          }
        }
      }
    ]

    try {
      for (const mutation of mutations) {
        const raw = transformJsonPublicationMember(
          publication,
          mutation.member,
          mutation.transform
        ) as DocumentCorePublication
        const verified = new WireEnvelopeCodecV1().publish(
          raw.envelope,
          raw.baseSnapshotId
        )
        expect(() => decodeDocumentCorePublication(verified)).toThrow(
          /closed|unknown|invalid|hash|field/i
        )
      }
    } finally {
      await host.close('renderer:1', documentId)
    }
  })

  it('mounts the one main-owned cut publication before reporting completion', async() => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-cut-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    await admitDocument(
      host,
      'remote-cut',
      'remote-cut-v1',
      'Hello'
    )
    const remote = await createDocumentCoreRemoteSession({
      documentId: () => 'remote-cut',
      onHistoryState: vi.fn(),
      invoke: (channel, request) => invokeHost(host, channel, request)
    })
    const before = remote.snapshot()
    if (before.kind !== 'complete') {
      throw new Error('Expected a complete cut fixture')
    }

    await expect(remote.writeClipboardMaterialization({
      revisionId: before.revisionId,
      view: 'markup',
      consumer: 'cut',
      selection: { start: 1, end: 4 }
    })).resolves.toEqual({ kind: 'cut-committed' })
    expect(remote.snapshot().source).toBe('Ho')

    await expect(remote.dispatch({ kind: 'undo' })).resolves.toMatchObject({
      kind: 'committed'
    })
    expect(remote.snapshot().source).toBe('Hello')
    await remote.close()
  })

  it('refuses a cut receipt without a committed terminal outcome', async() => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-cut-outcome-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    await admitDocument(
      host,
      'remote-cut-outcome',
      'remote-cut-outcome-v1',
      'Hello'
    )
    const remote = await createDocumentCoreRemoteSession({
      documentId: () => 'remote-cut-outcome',
      onHistoryState: vi.fn(),
      invoke: async(channel, request) => {
        const response = await invokeHost(host, channel, request)
        return channel === 'mt::document-core::write-clipboard'
          ? removeTerminalOutcomeFromCutReceipt(response)
          : response
      }
    })
    const before = remote.snapshot()
    if (before.kind !== 'complete') {
      throw new Error('Expected a complete cut-outcome fixture')
    }

    await expect(remote.writeClipboardMaterialization({
      revisionId: before.revisionId,
      view: 'markup',
      consumer: 'cut',
      selection: { start: 1, end: 4 }
    })).rejects.toThrow(/requires committed|missing-outcome/i)
    // Main committed the cut before its terminal member was damaged. Recovery
    // mounts that verified committed head before surfacing the protocol error.
    expect(remote.snapshot().source).toBe('Ho')
    await remote.close()
  })

  it('rejects a cut receipt with a hostile prototype before mounting it', async() => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-cut-hostile-receipt-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    const documentId = 'remote-cut-hostile-receipt'
    await admitDocument(host, documentId, `${documentId}-v1`, 'Hello')
    const remote = await createDocumentCoreRemoteSession({
      documentId: () => documentId,
      onHistoryState: vi.fn(),
      invoke: async(channel, request) => {
        const response = await invokeHost(host, channel, request)
        return channel === 'mt::document-core::write-clipboard'
          ? Object.assign(
            Object.create({ inheritedConsumer: 'cut' }),
            response
          )
          : response
      }
    })
    const before = remote.snapshot()
    if (before.kind !== 'complete') {
      throw new Error('Expected a complete hostile cut fixture')
    }

    try {
      await expect(remote.writeClipboardMaterialization({
        revisionId: before.revisionId,
        view: 'markup',
        consumer: 'cut',
        selection: { start: 1, end: 4 }
      })).rejects.toThrow(/invalid.*receipt|closed record/i)
      expect(remote.snapshot().source).toBe('Hello')
    } finally {
      await remote.close()
      await host.close('renderer:1', documentId)
    }
  })

  it('mounts a main-owned clipboard paste without receiving clipboard text', async() => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-paste-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    await admitDocument(
      host,
      'remote-paste',
      'remote-paste-v1',
      'Hello'
    )
    const remote = await createDocumentCoreRemoteSession({
      documentId: () => 'remote-paste',
      onHistoryState: vi.fn(),
      invoke: (channel, request) => invokeHost(host, channel, request)
    })
    const before = remote.snapshot()
    if (before.kind !== 'complete') {
      throw new Error('Expected a complete paste fixture')
    }
    const end = Object.freeze({ offset: 5, affinity: 'next' as const })
    const target = Object.freeze({
      ...before.selection,
      anchor: end,
      focus: end
    })

    await expect(remote.pasteClipboard(target)).resolves.toMatchObject({
      kind: 'committed'
    })
    expect(remote.snapshot().source).toBe('Hello main clipboard')

    await remote.dispatch({ kind: 'undo' })
    const sourceBefore = remote.snapshot()
    const sourceTarget = Object.freeze({
      ...sourceBefore.sourceSelection,
      anchor: Object.freeze({
        offset: 1,
        affinity: 'next' as const
      }),
      focus: Object.freeze({
        offset: 4,
        affinity: 'previous' as const
      })
    })
    await expect(remote.pasteClipboard(sourceTarget)).resolves.toMatchObject({
      kind: 'committed'
    })
    expect(remote.snapshot().source).toBe('H main clipboardo')
    await remote.close()
  })

  it('resolves a local image through one revision-bound opaque display receipt', async() => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-image-display-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    await admitDocument(
      host,
      'remote-image-display',
      'remote-image-display-v1',
      '![cat](assets/cat.png)\n'
    )
    const displayRequests: unknown[] = []
    const remote = await createDocumentCoreRemoteSession({
      documentId: () => 'remote-image-display',
      onHistoryState: vi.fn(),
      invoke: async(channel, request) => {
        if (channel === 'mt::image-assets::resolve-display') {
          displayRequests.push(request)
          const admitted = request as {
            documentId: string
            revisionId: string
            reference: string
          }
          return Object.freeze({
            schema: 'image-display-receipt-1',
            kind: 'resolved',
            documentId: admitted.documentId,
            revisionId: admitted.revisionId,
            reference: admitted.reference,
            src: 'marktext-image://asset/opaque-token'
          })
        }
        return await invokeHost(host, channel, request)
      }
    })
    const revisionId = remote.snapshot().revisionId

    await expect(remote.resolveImageSource({
      revisionId,
      reference: 'assets/cat.png'
    })).resolves.toEqual({
      kind: 'resolved',
      src: 'marktext-image://asset/opaque-token'
    })
    expect(displayRequests).toEqual([{
      schema: 'image-display-1',
      documentId: 'remote-image-display',
      revisionId,
      reference: 'assets/cat.png'
    }])
    await expect(remote.resolveImageSource({
      revisionId: 'revision:stale',
      reference: 'assets/cat.png'
    })).rejects.toThrow(/stale revision/i)
    expect(displayRequests).toHaveLength(1)
    await remote.close()
  })

  it('rejects a path-bearing or mismatched image display receipt', async() => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-image-display-hostile-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    await admitDocument(
      host,
      'remote-image-display-hostile',
      'remote-image-display-hostile-v1',
      '![cat](assets/cat.png)\n'
    )
    const remote = await createDocumentCoreRemoteSession({
      documentId: () => 'remote-image-display-hostile',
      onHistoryState: vi.fn(),
      invoke: async(channel, request) => {
        if (channel === 'mt::image-assets::resolve-display') {
          const admitted = request as {
            documentId: string
            revisionId: string
            reference: string
          }
          return {
            schema: 'image-display-receipt-1',
            kind: 'resolved',
            documentId: admitted.documentId,
            revisionId: admitted.revisionId,
            reference: admitted.reference,
            src: 'file:///private/main-only/cat.png',
            pathname: '/private/main-only/cat.png'
          }
        }
        return await invokeHost(host, channel, request)
      }
    })

    await expect(remote.resolveImageSource({
      revisionId: remote.snapshot().revisionId,
      reference: 'assets/cat.png'
    })).rejects.toThrow(/image display receipt|unknown/i)
    await remote.close()
  })

  it('verifies each publication before replacing its mounted snapshot', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-remote-session-'))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    await admitDocument(
      host,
      'remote-document',
      'remote-document-v1',
      'alpha'
    )
    let corruptNext = false
    let rejectNextSelect = false
    let rejectNextReconfigure = false
    const invokedChannels: string[] = []
    const observedExecution = vi.fn()
    const invoke: DocumentCoreRemoteSessionOptions['invoke'] = async(
      channel,
      rawRequest
    ): Promise<unknown> => {
      invokedChannels.push(channel)
      if (channel === 'mt::document-core::select' && rejectNextSelect) {
        rejectNextSelect = false
        throw new Error('injected select failure')
      }
      if (
        channel === 'mt::document-core::reconfigure-markdown-options' &&
        rejectNextReconfigure
      ) {
        rejectNextReconfigure = false
        throw new Error('injected reconfigure failure')
      }
      const publication = await invokeHost(host, channel, rawRequest)
      if (
        !corruptNext ||
        publication === undefined ||
        publication === null ||
        typeof publication !== 'object' ||
        !('envelope' in publication)
      ) return publication
      corruptNext = false
      const envelope = publication.envelope as WireEnvelopeV1
      return {
        ...publication,
        envelope: {
          ...envelope,
          rootHash: '0'.repeat(64)
        }
      }
    }

    const remote = await createDocumentCoreRemoteSession({
      documentId: () => 'remote-document',
      onHistoryState: vi.fn(),
      onExecutionReport: observedExecution,
      invoke
    })
    expect(observedExecution).toHaveBeenLastCalledWith(
      'remote-document',
      expect.objectContaining({ operationKind: 'attach' })
    )
    expect(remote.snapshot().source).toBe('alpha')
    expect(remote.snapshot().parseConfiguration).toEqual(configuration)
    expect(Object.isFrozen(remote.snapshot().parseConfiguration)).toBe(true)
    expect(Object.isFrozen(
      remote.snapshot().parseConfiguration.markdownOptions
    )).toBe(true)
    const reviewSnapshot = remote.snapshot()
    if (reviewSnapshot.kind !== 'complete') {
      throw new Error('Expected complete snapshot')
    }
    expect(reviewSnapshot.reviewIndex).toEqual({
      authoring: {
        canCreateAddition: false,
        canCreateDeletion: false,
        canCreateSubstitution: false,
        canCreateHighlight: false,
        // A collapsed caret authors the standalone Comment (G36).
        canCreateComment: true
      },
      items: [],
      commentedSpans: []
    })
    expect(reviewSnapshot.trackChanges).toBe(false)

    rejectNextSelect = true
    await expect(remote.select({
      anchor: { offset: 0, affinity: 'next' },
      focus: { offset: 5, affinity: 'previous' }
    })).rejects.toThrow('injected select failure')
    expect(remote.snapshot().selection).toEqual(reviewSnapshot.selection)

    await remote.select({
      anchor: { offset: 0, affinity: 'next' },
      focus: { offset: 5, affinity: 'previous' }
    })
    const selected = remote.snapshot()
    if (selected.kind !== 'complete') throw new Error('Expected selection')
    expect(selected.reviewIndex.authoring).toMatchObject({
      canCreateAddition: true,
      canCreateDeletion: true,
      canCreateSubstitution: true,
      canCreateHighlight: true,
      canCreateComment: true
    })

    const beforeFailedReconfigure = remote.snapshot()
    rejectNextReconfigure = true
    await expect(remote.reconfigureMarkdownOptions({
      footnotes: true
    })).rejects.toThrow('injected reconfigure failure')
    expect(remote.snapshot()).toEqual(beforeFailedReconfigure)
    await expect(remote.reconfigureMarkdownOptions({
      footnotes: true
    })).resolves.toMatchObject({ kind: 'state-changed' })
    expect(remote.snapshot().parseConfiguration.markdownOptions.footnotes)
      .toBe(true)

    expect(await remote.dispatch({
      kind: 'set-projection',
      projection: 'original'
    })).toMatchObject({ kind: 'state-changed' })
    expect(remote.snapshot()).toMatchObject({
      kind: 'complete',
      projection: 'original'
    })
    expect(await remote.dispatch({
      kind: 'set-projection',
      projection: 'marked'
    })).toMatchObject({ kind: 'state-changed' })

    const current = remote.snapshot()
    if (current.kind !== 'complete') throw new Error('Expected complete snapshot')
    const result = await remote.dispatch({
      kind: 'insert-text',
      target: {
        ...current.selection,
        anchor: { offset: 5, affinity: 'next' },
        focus: { offset: 5, affinity: 'next' }
      },
      text: ' beta'
    })
    expect(result.kind).toBe('committed')
    expect(invokedChannels).toContain('mt::document-core::dispatch-start')
    expect(invokedChannels).toContain('mt::document-core::dispatch-complete')
    expect(invokedChannels).not.toContain('mt::document-core::dispatch')
    expect(remote.snapshot().source).toBe('alpha beta')
    expect(observedExecution).toHaveBeenLastCalledWith(
      'remote-document',
      expect.objectContaining({
        operationKind: 'dispatch',
        operationCheckpointCount: expect.any(Number),
        operationOwningThreadStallMs: expect.any(Number)
      })
    )
    expect(remote.snapshot().source).toBe('alpha beta')

    corruptNext = true
    await expect(remote.dispatch({ kind: 'undo' })).rejects.toThrow(
      /checksum-failure/
    )
    // The damaged undo publication never mounts. Automatic recovery attaches
    // the verified main-owned head produced by that already-committed undo.
    expect(remote.snapshot().source).toBe('alpha')
  })

  it('cancels an exposed ticket without terminating the main-owned session', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-remote-cancel-'))
    directories.push(directory)
    const controlled = controllableAdmissionStorage(
      createFileDocumentSessionJournalStorage(directory)
    )
    const host = createDocumentCoreMainSessionHost(controlled.storage)
    await admitDocument(host, 'remote-cancel', 'remote-cancel-v1', 'kept')
    let completeStarted: (() => void) | undefined
    const completeStart = new Promise<void>((resolve) => {
      completeStarted = resolve
    })
    const invokedChannels: string[] = []
    const invoke: DocumentCoreRemoteSessionOptions['invoke'] = async(
      channel,
      rawRequest
    ): Promise<unknown> => {
      invokedChannels.push(channel)
      if (channel === 'mt::document-core::dispatch-start') {
        return await host.startDispatch(
          'renderer:1',
          rawRequest as DocumentCoreMainDispatchRequest
        )
      }
      if (channel === 'mt::document-core::dispatch-complete') {
        completeStarted?.()
        const request = rawRequest as DocumentCoreCompleteDispatchRequest
        return await host.completeDispatch(
          'renderer:1',
          request.documentId,
          request.ticketId
        )
      }
      if (channel === 'mt::document-core::dispatch-cancel') {
        const request = rawRequest as DocumentCoreCancelDispatchRequest
        return await host.cancelDispatch(
          'renderer:1',
          request.documentId,
          request.ticketId
        )
      }
      return await invokeHost(host, channel, rawRequest)
    }

    const remote = await createDocumentCoreRemoteSession({
      documentId: () => 'remote-cancel',
      onHistoryState: vi.fn(),
      invoke
    })
    const snapshot = remote.snapshot()
    if (snapshot.kind !== 'complete') throw new Error('Expected complete snapshot')

    controlled.block()
    const dispatch = remote.dispatch({
      kind: 'insert-text',
      target: {
        ...snapshot.selection,
        anchor: { offset: 4, affinity: 'next' },
        focus: { offset: 4, affinity: 'next' }
      },
      text: ' lost'
    })
    await completeStart
    const closing = remote.close()
    controlled.release()

    await expect(dispatch).resolves.toMatchObject({ kind: 'cancelled' })
    await closing
    expect(invokedChannels).toContain('mt::document-core::dispatch-cancel')
    expect(host.resourceCounts()).toEqual({
      sessionCount: 1,
      workerCount: 1
    })
    await host.close('renderer:1', 'remote-cancel')
  })

  it('answers hostile coordinate queries from the verified parser map', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-remote-map-'))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    const mappedSource =
      'before {==outer {++inner++} tail==}{>>hidden note<<} ' +
      '{~~old~>new~~} after'
    await admitDocument(host, 'remote-map', 'remote-map-v1', mappedSource)
    let publishedMap: MarkupCoordinateMapV1 | undefined
    const remote = await createDocumentCoreRemoteSession({
      documentId: () => 'remote-map',
      onHistoryState: vi.fn(),
      invoke: async(channel, request) => {
        const response = await invokeHost(host, channel, request)
        if (
          response !== null &&
          typeof response === 'object' &&
          'baseSnapshotId' in response &&
          'envelope' in response
        ) {
          const publication = response as DocumentCorePublication
          const verified = new WireEnvelopeCodecV1().publish(
            publication.envelope,
            publication.baseSnapshotId
          )
          const snapshot = decodeDocumentCorePublication(verified)
          if (snapshot.kind === 'complete') {
            publishedMap = snapshot.markupCoordinateMap
          }
        }
        return response
      }
    })

    const coordinateMap = publishedMap
    if (coordinateMap === undefined) {
      throw new Error('Expected a verified complete coordinate map')
    }
    for (const affinity of ['previous', 'next'] as const) {
      for (
        let offset = 0;
        offset <= coordinateMap.sourceLength;
        offset += 1
      ) {
        const position = { offset, affinity }
        expect(remote.modelPositionAt(position)).toEqual(
          modelPositionAtMarkupCoordinateMap(coordinateMap, position)
        )
      }
    }

    await remote.close()
    expect(host.resourceCounts()).toEqual({
      sessionCount: 1,
      workerCount: 1
    })
    await host.close('renderer:1', 'remote-map')
  })

  it('switches the mounted view while main retains isolated document histories', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'marktext-remote-tabs-'))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    await admitDocument(host, 'tab-a', 'tab-a-journal', 'alpha')
    await admitDocument(host, 'tab-b', 'tab-b-journal', 'bravo')
    let blockTabBOpen = false
    let releaseTabBOpen: (() => void) | undefined
    let reportTabBOpenStarted: (() => void) | undefined
    const tabBOpenStarted = new Promise<void>((resolve) => {
      reportTabBOpenStarted = resolve
    })
    const invoke: DocumentCoreRemoteSessionOptions['invoke'] = async(
      channel,
      rawRequest
    ): Promise<unknown> => {
      if (channel === 'mt::document-core::attach') {
        const request = rawRequest as { readonly documentId: string }
        if (blockTabBOpen && request.documentId === 'tab-b') {
          blockTabBOpen = false
          reportTabBOpenStarted?.()
          await new Promise<void>((resolve) => {
            releaseTabBOpen = resolve
          })
        }
        return await invokeHost(host, channel, rawRequest)
      }
      return await invokeHost(host, channel, rawRequest)
    }

    let activeDocumentId = 'tab-a'
    const historyByDocument = new Map<string, {
      canUndo: boolean
      canRedo: boolean
      dirty: boolean
      headIdentity: string
      savedIdentity: string
    }>()
    const remote = await createDocumentCoreRemoteSession({
      documentId: () => activeDocumentId,
      invoke,
      onHistoryState: (
        documentId: string,
        state: {
          canUndo: boolean
          canRedo: boolean
          dirty: boolean
          headIdentity: string
          savedIdentity: string
        }
      ) => {
        historyByDocument.set(documentId, state)
      }
    })
    expect(host.resourceCounts()).toEqual({
      sessionCount: 2,
      workerCount: 2
    })

    let snapshot = remote.snapshot()
    if (snapshot.kind !== 'complete') throw new Error('Expected complete snapshot')
    const tabAInitialIdentity =
      historyByDocument.get('tab-a')?.headIdentity
    expect(tabAInitialIdentity).toBeTruthy()
    await remote.dispatch({
      kind: 'insert-text',
      target: {
        ...snapshot.selection,
        anchor: { offset: 5, affinity: 'next' },
        focus: { offset: 5, affinity: 'next' }
      },
      text: ' A'
    })
    expect(remote.snapshot().source).toBe('alpha A')
    expect(historyByDocument.get('tab-a')).toMatchObject({
      canUndo: true,
      canRedo: false,
      dirty: true,
      savedIdentity: tabAInitialIdentity
    })

    activeDocumentId = 'tab-b'
    blockTabBOpen = true
    const switchToTabB = remote.attachDocument(activeDocumentId)
    await tabBOpenStarted
    // A valid verified snapshot remains readable throughout the asynchronous
    // handoff; main's B publication replaces it atomically when it arrives.
    expect(remote.snapshot().source).toBe('alpha A')
    releaseTabBOpen?.()
    await switchToTabB
    expect(host.resourceCounts()).toEqual({
      sessionCount: 2,
      workerCount: 2
    })
    snapshot = remote.snapshot()
    if (snapshot.kind !== 'complete') throw new Error('Expected complete snapshot')
    await remote.dispatch({
      kind: 'insert-text',
      target: {
        ...snapshot.selection,
        anchor: { offset: 5, affinity: 'next' },
        focus: { offset: 5, affinity: 'next' }
      },
      text: ' B'
    })
    expect(remote.snapshot().source).toBe('bravo B')

    activeDocumentId = 'tab-a'
    await remote.attachDocument(activeDocumentId)
    expect(remote.snapshot().source).toBe('alpha A')
    await remote.dispatch({ kind: 'undo' })
    expect(remote.snapshot().source).toBe('alpha')
    expect(historyByDocument.get('tab-a')).toMatchObject({
      canUndo: false,
      canRedo: true,
      dirty: false,
      headIdentity: tabAInitialIdentity,
      savedIdentity: tabAInitialIdentity
    })
    await remote.dispatch({ kind: 'redo' })
    expect(remote.snapshot().source).toBe('alpha A')

    activeDocumentId = 'tab-b'
    await remote.attachDocument(activeDocumentId)
    expect(remote.snapshot().source).toBe('bravo B')

    await remote.closeDocument('tab-a')
    expect(host.resourceCounts()).toEqual({
      sessionCount: 2,
      workerCount: 2
    })
    await remote.closeDocument('tab-a')

    await remote.close()
    expect(host.resourceCounts()).toEqual({
      sessionCount: 2,
      workerCount: 2
    })
    await host.close('renderer:1', 'tab-a')
    await host.close('renderer:1', 'tab-b')
    expect(host.resourceCounts()).toEqual({
      sessionCount: 0,
      workerCount: 0
    })
  })

  it('commits a registered image through one main transaction and one undo entry', async() => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-image-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    await admitDocument(
      host,
      'remote-image',
      'remote-image-v1',
      'alpha'
    )
    const channels: string[] = []
    const remote = await createDocumentCoreRemoteSession({
      documentId: () => 'remote-image',
      onHistoryState: vi.fn(),
      invoke: async(channel, rawRequest) => {
        channels.push(channel)
        return await invokeHost(host, channel, rawRequest)
      }
    })
    const registered = remote.registerImageAsset(
      'remote-image',
      Object.freeze({
        kind: 'binary',
        name: 'clipboard.png',
        mediaType: 'image/png',
        bytes: new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
        ])
      }),
      'document-relative'
    )

    await remote.dispatch({
      kind: 'insert-image',
      target: remote.snapshot().selection,
      src: registered.src,
      alt: 'cat'
    })

    expect(remote.snapshot().source).toContain(
      '![cat](assets/content-hash.png)'
    )
    expect(channels.filter(
      channel => channel === 'mt::image-assets::insert'
    )).toHaveLength(1)
    expect(channels.filter(
      channel => channel === 'mt::document-core::dispatch-start'
    )).toHaveLength(0)

    await remote.dispatch({ kind: 'undo' })

    expect(remote.snapshot().source).toBe('alpha')
    expect(channels.filter(
      channel => channel === 'mt::document-core::dispatch-start'
    )).toHaveLength(1)
    await remote.close()
    await host.close('renderer:1', 'remote-image')
  })

  it.each([
    {
      description: 'an unknown outer field',
      mutate: (value: Record<string, unknown>): unknown => ({
        ...value,
        rendererOverride: true
      })
    },
    {
      description: 'an unknown asset field',
      mutate: (value: Record<string, unknown>): unknown => ({
        ...value,
        asset: {
          ...(value.asset as Record<string, unknown>),
          rendererOverride: true
        }
      })
    },
    {
      description: 'an invalid asset media type',
      mutate: (value: Record<string, unknown>): unknown => ({
        ...value,
        asset: {
          ...(value.asset as Record<string, unknown>),
          mediaType: 'text/html'
        }
      })
    },
    {
      description: 'a mismatched asset document',
      mutate: (value: Record<string, unknown>): unknown => ({
        ...value,
        asset: {
          ...(value.asset as Record<string, unknown>),
          documentId: 'some-other-document'
        }
      })
    },
    {
      description: 'an extended cancelled union member',
      mutate: (value: Record<string, unknown>): unknown => ({
        schema: value.schema,
        kind: 'cancelled',
        documentId: value.documentId,
        reason: 'document-deactivated',
        rendererOverride: true
      })
    }
  ])('rejects an image insertion receipt with $description', async({
    mutate
  }) => {
    const directory = await mkdtemp(join(
      tmpdir(),
      'marktext-remote-image-receipt-'
    ))
    directories.push(directory)
    const host = createDocumentCoreMainSessionHost(
      createFileDocumentSessionJournalStorage(directory)
    )
    const documentId = 'remote-image-receipt'
    await admitDocument(host, documentId, `${documentId}-v1`, 'alpha')
    const remote = await createDocumentCoreRemoteSession({
      documentId: () => documentId,
      onHistoryState: vi.fn(),
      invoke: async(channel, request) => {
        const response = await invokeHost(host, channel, request)
        return channel === 'mt::image-assets::insert'
          ? mutate(response as Record<string, unknown>)
          : response
      }
    })
    const registered = remote.registerImageAsset(
      documentId,
      Object.freeze({
        kind: 'binary',
        name: 'clipboard.png',
        mediaType: 'image/png',
        bytes: new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
        ])
      }),
      'document-relative'
    )

    try {
      await expect(remote.dispatch({
        kind: 'insert-image',
        target: remote.snapshot().selection,
        src: registered.src,
        alt: 'cat'
      })).rejects.toThrow(/image.*receipt|unknown|closed/i)
      expect(remote.snapshot().source).toBe('alpha')
    } finally {
      await remote.close()
      await host.close('renderer:1', documentId)
    }
  })
})
