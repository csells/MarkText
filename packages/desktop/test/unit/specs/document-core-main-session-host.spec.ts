import {
  WireEnvelopeCodecV1,
  createSourceSnapshot,
  type DocumentSessionJournalCommit,
  type DocumentSessionJournalMutation,
  type DocumentSessionJournalStorage,
  type MarkupRenderNode,
  type NodeId,
  type ParseConfiguration
} from '@marktext/document-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { threadId } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFileDocumentSessionJournalStorage } from 'main_renderer/documentCore/durableSessionJournalStorage'
import type { DocumentCorePublication } from '@shared/types/documentCore'
import {
  consumeDocumentCoreHostHtml,
  decodeDocumentCorePublication,
  type DocumentCoreMainSessionHost
} from 'main_renderer/documentCore/mainSessionHost'
import {
  createTestDocumentCoreMainSessionHost as createDocumentCoreMainSessionHost
} from '../helpers/documentSessionHost'
import {
  decodeDocumentCoreMainDispatchRequest
} from 'main_renderer/ipc/documentCoreRuntimeCodec'
import type {
  IsolatedDocumentSession
} from 'main_renderer/documentCore/isolatedDocumentSession'

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

const staticStructure = Object.freeze({
  headingAnchors: 'github-slug-v1' as const,
  tableOfContents: Object.freeze({
    title: '',
    includeTopHeading: true
  })
})

const directories: string[] = []

afterEach(async() => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function temporaryStorage() {
  const directory = await mkdtemp(join(tmpdir(), 'marktext-session-host-'))
  directories.push(directory)
  return createFileDocumentSessionJournalStorage(directory)
}

async function openHost(
  host: DocumentCoreMainSessionHost,
  ownerId: string,
  request: {
    documentId: string
    durabilityKey: string
    source: ReturnType<typeof createSourceSnapshot>
    parseConfiguration: ParseConfiguration
  }
): Promise<DocumentCorePublication> {
  const ticket = await host.startOpen(ownerId, {
    documentId: request.documentId,
    durabilityKey: request.durabilityKey,
    sourceLength: request.source.text.length,
    parseConfiguration: request.parseConfiguration
  })
  if (ticket.requiresSource) {
    let ordinal = 0
    for (
      let offset = 0;
      offset < request.source.text.length;
      offset += ticket.chunkUnits
    ) {
      await host.appendOpenChunk(
        ownerId,
        request.documentId,
        ticket.ticketId,
        ordinal,
        request.source.text.slice(offset, offset + ticket.chunkUnits)
      )
      ordinal += 1
    }
  }
  const admission = await host.completeOpen(
    ownerId,
    request.documentId,
    ticket.ticketId
  )
  if ('envelope' in admission) {
    return admission
  }
  const attachTicket = await host.startOpen(ownerId, {
    documentId: request.documentId,
    durabilityKey: request.durabilityKey,
    sourceLength: 0,
    parseConfiguration: request.parseConfiguration
  })
  const publication = await host.completeOpen(
    ownerId,
    request.documentId,
    attachTicket.ticketId
  )
  if (!('envelope' in publication)) {
    throw new Error('Renderer attachment returned no publication')
  }
  return publication
}

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

function pauseAfterFirstDurableWrite(
  delegate: DocumentSessionJournalStorage
): Readonly<{
    storage: DocumentSessionJournalStorage
    written: Promise<void>
    release: () => void
  }> {
  let markWritten: (() => void) | undefined
  let releaseWrite: (() => void) | undefined
  let paused = false
  const written = new Promise<void>((resolve) => {
    markWritten = resolve
  })
  return Object.freeze({
    storage: Object.freeze({
      read: delegate.read,
      compareExchange: async(
        key: string,
        expectedRevision: number | null,
        mutation: DocumentSessionJournalMutation
      ): Promise<DocumentSessionJournalCommit | null> => {
        const stored = await delegate.compareExchange(
          key,
          expectedRevision,
          mutation
        )
        if (!paused) {
          paused = true
          markWritten?.()
          await new Promise<void>((resolve) => {
            releaseWrite = resolve
          })
        }
        return stored
      }
    }),
    written,
    release: () => releaseWrite?.()
  })
}

describe('main-owned document-core session host', () => {
  it('rejects a fabricated portable base without a verified source replica', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const codec = new WireEnvelopeCodecV1()
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'document-fabricated-base',
      durabilityKey: 'durable-fabricated-base',
      source: createSourceSnapshot('alpha'),
      parseConfiguration: configuration
    })
    const initial = decodeDocumentCorePublication(
      codec.publish(opened.envelope, opened.baseSnapshotId)
    )
    if (initial.kind !== 'complete') {
      throw new Error('Expected a complete fabricated-base fixture')
    }
    const edited = await host.dispatch('renderer:1', {
      documentId: 'document-fabricated-base',
      baseSnapshotId: initial.snapshotId,
      intent: {
        kind: 'insert-text',
        target: {
          ...initial.selection,
          anchor: { offset: 5, affinity: 'next' },
          focus: { offset: 5, affinity: 'next' }
        },
        text: '!'
      }
    })
    const published = codec.publish(edited.envelope, edited.baseSnapshotId)
    const fabricated = Object.freeze({ ...initial })

    expect(() => decodeDocumentCorePublication(published, fabricated))
      .toThrow(/unverified base/i)
    expect(decodeDocumentCorePublication(published, initial).source)
      .toBe('alpha!')

    await host.close('renderer:1', 'document-fabricated-base')
  })

  it('decodes clean projections with their retained Markup coordinate space', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const documentId = 'document-clean-projections'
    const source = '{~~old~>new~~}'
    const opened = await openHost(host, 'renderer:1', {
      documentId,
      durabilityKey: 'durable-clean-projections',
      source: createSourceSnapshot(source),
      parseConfiguration: configuration
    })
    const codec = new WireEnvelopeCodecV1()
    let mounted = decodeDocumentCorePublication(codec.publish(
      opened.envelope,
      opened.baseSnapshotId
    ))
    const publish = (publication: DocumentCorePublication) => {
      mounted = decodeDocumentCorePublication(codec.publish(
        publication.envelope,
        publication.baseSnapshotId
      ), mounted)
      return mounted
    }

    const marked = mounted
    if (marked.kind !== 'complete') {
      throw new Error('Expected a complete Markup snapshot')
    }
    expect(marked).toMatchObject({
      projection: 'marked',
      modelText: 'oldnew',
      markupModelLength: 6
    })
    expect(marked.markupCoordinateMap).toMatchObject({
      sourceLength: source.length,
      modelLength: 6
    })

    const original = publish(await host.dispatch('renderer:1', {
      documentId,
      baseSnapshotId: marked.snapshotId,
      intent: {
        kind: 'set-projection',
        projection: 'original'
      }
    }))
    if (original.kind !== 'complete') {
      throw new Error('Expected a complete Original snapshot')
    }
    expect(original).toMatchObject({
      projection: 'original',
      modelText: 'old',
      markupModelLength: 6
    })
    expect(original.markupCoordinateMap).toMatchObject({
      sourceLength: source.length,
      modelLength: 6
    })

    const revised = publish(await host.dispatch('renderer:1', {
      documentId,
      baseSnapshotId: original.snapshotId,
      intent: {
        kind: 'set-projection',
        projection: 'revised'
      }
    }))
    if (revised.kind !== 'complete') {
      throw new Error('Expected a complete Revised snapshot')
    }
    expect(revised).toMatchObject({
      projection: 'revised',
      modelText: 'new',
      markupModelLength: 6
    })
    expect(revised.markupCoordinateMap).toMatchObject({
      sourceLength: source.length,
      modelLength: 6
    })

    await host.close('renderer:1', documentId)
  })

  it('binds durable identities and renderer selections to exactly one document', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const codec = new WireEnvelopeCodecV1()
    const alphaPublication = await openHost(host, 'renderer:1', {
      documentId: 'document-alpha',
      durabilityKey: 'durable-alpha',
      source: createSourceSnapshot('alpha'),
      parseConfiguration: configuration
    })
    const bravoPublication = await openHost(host, 'renderer:1', {
      documentId: 'document-bravo',
      durabilityKey: 'durable-bravo',
      source: createSourceSnapshot('bravo'),
      parseConfiguration: configuration
    })
    expect(alphaPublication).toMatchObject({ documentId: 'document-alpha' })
    expect(bravoPublication).toMatchObject({ documentId: 'document-bravo' })
    const alpha = decodeDocumentCorePublication(
      codec.publish(alphaPublication.envelope, alphaPublication.baseSnapshotId)
    )
    const bravo = decodeDocumentCorePublication(
      codec.publish(bravoPublication.envelope, bravoPublication.baseSnapshotId)
    )
    if (alpha.kind !== 'complete' || bravo.kind !== 'complete') {
      throw new Error('Expected complete identity fixtures')
    }

    expect(alpha.selection.session).not.toBe(bravo.selection.session)
    expect(alpha.revisionId).not.toBe(bravo.revisionId)
    expect(alpha.snapshotId).not.toBe(bravo.snapshotId)

    const borrowed = decodeDocumentCoreMainDispatchRequest(structuredClone({
      documentId: 'document-bravo',
      baseSnapshotId: bravo.snapshotId,
      intent: {
        kind: 'insert-text',
        target: {
          ...alpha.selection,
          anchor: { offset: 0, affinity: 'next' },
          focus: { offset: 0, affinity: 'next' }
        },
        text: 'X'
      }
    }))
    const rejection = await host.dispatch('renderer:1', borrowed)
    const decodedRejection = codec.publish(
      rejection.envelope,
      rejection.baseSnapshotId
    )
    if (decodedRejection.kind !== 'published') {
      throw new Error('Expected authenticated rejection publication')
    }
    expect(JSON.parse(new TextDecoder().decode(
      decodedRejection.members.terminalOutcomeDelta
    ))).toMatchObject({
      kind: 'rejected',
      reason: 'stale-selection'
    })
    const bravoAfterRejection = decodeDocumentCorePublication(
      decodedRejection,
      bravo
    )
    expect(bravoAfterRejection.source).toBe('bravo')

    await host.terminate('document-alpha')
    await host.terminate('document-bravo')
  })

  it('authenticates an owned current revision without materializing a sink', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const codec = new WireEnvelopeCodecV1()
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'document-static-authorization',
      durabilityKey: 'durable-static-authorization',
      source: createSourceSnapshot('# Current'),
      parseConfiguration: configuration
    })
    const snapshot = decodeDocumentCorePublication(
      codec.publish(opened.envelope, opened.baseSnapshotId)
    )

    await expect(host.assertRevision(
      'renderer:1',
      'document-static-authorization',
      snapshot.revisionId
    )).resolves.toBeUndefined()
    await expect(host.assertRevision(
      'renderer:1',
      'document-static-authorization',
      'revision:stale'
    )).rejects.toThrow(/stale revision/i)
    await expect(host.assertRevision(
      'renderer:foreign',
      'document-static-authorization',
      snapshot.revisionId
    )).rejects.toThrow(/owned by/i)

    await host.close('renderer:1', 'document-static-authorization')
  })

  it('resolves a parser-owned link only in the owned immutable revision', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const codec = new WireEnvelopeCodecV1()
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'document-link-authority',
      durabilityKey: 'durable-link-authority',
      source: createSourceSnapshot('[destination](docs/File.md)'),
      parseConfiguration: configuration
    })
    const snapshot = decodeDocumentCorePublication(
      codec.publish(opened.envelope, opened.baseSnapshotId)
    )
    if (snapshot.kind !== 'complete') {
      throw new Error('Expected complete link fixture')
    }

    const visit = (node: MarkupRenderNode): MarkupRenderNode | null => {
      if (node.kind === 'link') return node
      for (const child of node.children) {
        const found = visit(child)
        if (found !== null) return found
      }
      return null
    }
    const link = snapshot.blocks
      .map(block => visit(block.tree))
      .find((node): node is MarkupRenderNode => node !== null)
    if (link === undefined) throw new Error('Expected parser-owned link node')

    await expect(host.resolveDocumentLink(
      'renderer:1',
      'document-link-authority',
      snapshot.revisionId,
      link.key as NodeId
    )).resolves.toEqual({
      kind: 'document-link-target',
      revisionId: snapshot.revisionId,
      targetNodeId: link.key,
      destination: 'docs/File.md'
    })

    await expect(host.resolveDocumentLink(
      'renderer:1',
      'document-link-authority',
      'revision:stale',
      link.key as NodeId
    )).rejects.toThrow(/stale revision/i)
    await expect(host.resolveDocumentLink(
      'renderer:foreign',
      'document-link-authority',
      snapshot.revisionId,
      link.key as NodeId
    )).rejects.toThrow(/owned by/i)
    await expect(host.resolveDocumentLink(
      'renderer:1',
      'document-link-authority',
      snapshot.revisionId,
      'node:foreign' as NodeId
    )).rejects.toThrow(/not a link/i)

    await host.close('renderer:1', 'document-link-authority')
  })

  it('reads live history state for main lifecycle decisions without a renderer cache', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const codec = new WireEnvelopeCodecV1()
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'document-lifecycle-history',
      durabilityKey: 'durable-lifecycle-history',
      source: createSourceSnapshot('A'),
      parseConfiguration: configuration
    })
    const initial = decodeDocumentCorePublication(
      codec.publish(opened.envelope, opened.baseSnapshotId)
    )
    if (initial.kind !== 'complete') {
      throw new Error('Expected complete lifecycle fixture')
    }
    expect(initial.parseConfiguration).toEqual(configuration)
    expect(Object.isFrozen(initial.parseConfiguration)).toBe(true)
    expect(Object.isFrozen(initial.parseConfiguration.markdownOptions))
      .toBe(true)

    expect(await host.readHistoryState(
      'renderer:1',
      'document-lifecycle-history'
    )).toEqual(initial.historyState)

    await host.dispatch('renderer:1', {
      documentId: 'document-lifecycle-history',
      baseSnapshotId: initial.snapshotId,
      intent: {
        kind: 'insert-text',
        target: {
          ...initial.selection,
          anchor: { offset: 1, affinity: 'next' },
          focus: { offset: 1, affinity: 'next' }
        },
        text: 'B'
      }
    })
    expect(await host.readHistoryState(
      'renderer:1',
      'document-lifecycle-history'
    )).toMatchObject({
      canUndo: true,
      canRedo: false,
      dirty: true,
      savedIdentity: initial.historyState.savedIdentity
    })

    await host.close('renderer:1', 'document-lifecycle-history')
  })

  it('re-homes nested cut HTML as a main-only clipboard capability', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'clipboard-cut',
      durabilityKey: 'durable-clipboard-cut',
      source: createSourceSnapshot('Hello'),
      parseConfiguration: configuration
    })
    const snapshot = decodeDocumentCorePublication(
      new WireEnvelopeCodecV1().publish(opened.envelope, opened.baseSnapshotId)
    )
    const result = await host.materializeClipboard(
      'renderer:1',
      'clipboard-cut',
      snapshot.revisionId,
      {
        view: 'markup',
        consumer: 'cut',
        selection: { start: 1, end: 4 }
      }
    )

    expect(result.kind).toBe('materialized')
    if (
      result.kind !== 'materialized' ||
      result.artifact.kind !== 'cut-preparation'
    ) {
      throw new Error('Expected a cut preparation')
    }
    expect(result.revision.id).toBe(snapshot.revisionId)
    expect(result.artifact.bundle.plainText).toBe('ell')
    expect(result.artifact.bundle.html).toBeDefined()
    if (result.artifact.bundle.html === undefined) return
    expect(consumeDocumentCoreHostHtml(
      result.artifact.bundle.html,
      'clipboard'
    )).toContain('ell')
    expect(result.artifact.ticketId).toMatch(/^cut:/)

    await expect(host.completeCut(
      'renderer:1',
      'clipboard-cut',
      result.artifact.ticketId,
      false
    )).resolves.toEqual({ kind: 'cancelled' })
    await expect(host.completeCut(
      'renderer:1',
      'clipboard-cut',
      result.artifact.ticketId,
      true
    )).rejects.toThrow(/already consumed/i)
    await host.close('renderer:1', 'clipboard-cut')
  })

  it('commits one exact cut transaction and one undo restores it', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const codec = new WireEnvelopeCodecV1()
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'clipboard-cut-commit',
      durabilityKey: 'durable-clipboard-cut-commit',
      source: createSourceSnapshot('Hello'),
      parseConfiguration: configuration
    })
    const openedSnapshot = decodeDocumentCorePublication(
      codec.publish(opened.envelope, opened.baseSnapshotId)
    )
    const prepared = await host.materializeClipboard(
      'renderer:1',
      'clipboard-cut-commit',
      openedSnapshot.revisionId,
      {
        view: 'markup',
        consumer: 'cut',
        selection: { start: 1, end: 4 }
      }
    )
    if (
      prepared.kind !== 'materialized' ||
      prepared.artifact.kind !== 'cut-preparation'
    ) {
      throw new Error('Expected a cut preparation')
    }

    const committed = await host.completeCut(
      'renderer:1',
      'clipboard-cut-commit',
      prepared.artifact.ticketId,
      true
    )
    if (!('envelope' in committed)) {
      throw new Error('Expected one cut publication')
    }
    const cutSnapshot = decodeDocumentCorePublication(
      codec.publish(committed.envelope, committed.baseSnapshotId),
      openedSnapshot
    )
    expect(cutSnapshot.source).toBe('Ho')
    expect(cutSnapshot.historyState).toMatchObject({
      canUndo: true,
      canRedo: false
    })

    const undone = await host.dispatch('renderer:1', {
      documentId: 'clipboard-cut-commit',
      baseSnapshotId: cutSnapshot.snapshotId,
      intent: { kind: 'undo' }
    })
    const undoneSnapshot = decodeDocumentCorePublication(
      codec.publish(undone.envelope, undone.baseSnapshotId),
      cutSnapshot
    )
    expect(undoneSnapshot.source).toBe('Hello')
    expect(undoneSnapshot.historyState).toMatchObject({
      canUndo: false,
      canRedo: true
    })
    expect(openedSnapshot.source).toBe(undoneSnapshot.source)

    await expect(host.completeCut(
      'renderer:1',
      'clipboard-cut-commit',
      prepared.artifact.ticketId,
      true
    )).rejects.toThrow(/already consumed/i)
    await host.close('renderer:1', 'clipboard-cut-commit')
  })

  it('commits Source mode cut as the same one-use transaction', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const codec = new WireEnvelopeCodecV1()
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'clipboard-source-cut',
      durabilityKey: 'durable-clipboard-source-cut',
      source: createSourceSnapshot('Hello'),
      parseConfiguration: configuration
    })
    const openedSnapshot = decodeDocumentCorePublication(
      codec.publish(opened.envelope, opened.baseSnapshotId)
    )
    const prepared = await host.materializeClipboard(
      'renderer:1',
      'clipboard-source-cut',
      openedSnapshot.revisionId,
      {
        view: 'source',
        consumer: 'cut',
        selection: { start: 1, end: 4 }
      }
    )
    if (
      prepared.kind !== 'materialized' ||
      prepared.artifact.kind !== 'cut-preparation'
    ) {
      throw new Error('Expected a Source cut preparation')
    }
    expect(prepared.artifact).toMatchObject({
      view: 'source',
      bundle: {
        plainText: 'ell',
        privateSource: {
          text: 'ell'
        }
      }
    })

    const committed = await host.completeCut(
      'renderer:1',
      'clipboard-source-cut',
      prepared.artifact.ticketId,
      true
    )
    if (!('envelope' in committed)) {
      throw new Error('Expected a Source cut publication')
    }
    const cutSnapshot = decodeDocumentCorePublication(
      codec.publish(committed.envelope, committed.baseSnapshotId),
      openedSnapshot
    )
    expect(cutSnapshot.source).toBe('Ho')
    const undone = await host.dispatch('renderer:1', {
      documentId: 'clipboard-source-cut',
      baseSnapshotId: cutSnapshot.snapshotId,
      intent: { kind: 'undo' }
    })
    const undoneSnapshot = decodeDocumentCorePublication(
      codec.publish(undone.envelope, undone.baseSnapshotId),
      cutSnapshot
    )
    expect(undoneSnapshot.source).toBe('Hello')
    await host.close('renderer:1', 'clipboard-source-cut')
  })

  it('commits a table rectangle cut as one transaction and undo entry', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const codec = new WireEnvelopeCodecV1()
    const source = [
      '| a | b | c |',
      '| --- | --- | --- |',
      '| one | two | three |',
      '| four | five | six |',
      ''
    ].join('\n')
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'clipboard-table-cut',
      durabilityKey: 'durable-clipboard-table-cut',
      source: createSourceSnapshot(source),
      parseConfiguration: configuration
    })
    const openedSnapshot = decodeDocumentCorePublication(
      codec.publish(opened.envelope, opened.baseSnapshotId)
    )
    const selection = {
      start: source.indexOf('two'),
      end: source.indexOf('six') + 'six'.length
    }
    const prepared = await host.materializeClipboard(
      'renderer:1',
      'clipboard-table-cut',
      openedSnapshot.revisionId,
      {
        view: 'markup',
        consumer: 'cut-table',
        selection
      }
    )
    if (
      prepared.kind !== 'materialized' ||
      prepared.artifact.kind !== 'cut-preparation'
    ) {
      throw new Error('Expected a table cut preparation')
    }
    expect(prepared.artifact.bundle.plainText)
      .toBe('two\tthree\nfive\tsix')

    const committed = await host.completeCut(
      'renderer:1',
      'clipboard-table-cut',
      prepared.artifact.ticketId,
      true
    )
    if (!('envelope' in committed)) {
      throw new Error('Expected a table cut publication')
    }
    const cutSnapshot = decodeDocumentCorePublication(
      codec.publish(committed.envelope, committed.baseSnapshotId),
      openedSnapshot
    )
    expect(cutSnapshot.source).toBe([
      '| a | b | c |',
      '| --- | --- | --- |',
      '| one |   |   |',
      '| four |   |   |',
      ''
    ].join('\n'))
    const undone = await host.dispatch('renderer:1', {
      documentId: 'clipboard-table-cut',
      baseSnapshotId: cutSnapshot.snapshotId,
      intent: { kind: 'undo' }
    })
    const undoneSnapshot = decodeDocumentCorePublication(
      codec.publish(undone.envelope, undone.baseSnapshotId),
      cutSnapshot
    )
    expect(undoneSnapshot.source).toBe(source)
    await host.close('renderer:1', 'clipboard-table-cut')
  })

  it('rejects non-mutating and hidden-comment cuts before clipboard admission', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const codec = new WireEnvelopeCodecV1()
    const hiddenSource = 'A{>>hidden<<}B'
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'clipboard-cut-preflight',
      durabilityKey: 'durable-clipboard-cut-preflight',
      source: createSourceSnapshot(hiddenSource),
      parseConfiguration: configuration
    })
    const snapshot = decodeDocumentCorePublication(
      codec.publish(opened.envelope, opened.baseSnapshotId)
    )
    if (snapshot.kind !== 'complete') {
      throw new Error('Expected a complete preflight fixture')
    }

    await expect(host.materializeClipboard(
      'renderer:1',
      'clipboard-cut-preflight',
      snapshot.revisionId,
      {
        view: 'markup',
        consumer: 'cut',
        selection: { start: 1, end: 1 }
      }
    )).rejects.toThrow(/collapsed/i)
    await expect(host.materializeClipboard(
      'renderer:1',
      'clipboard-cut-preflight',
      snapshot.revisionId,
      {
        view: 'markup',
        consumer: 'cut',
        selection: { start: 0, end: snapshot.markupModelLength }
      }
    )).rejects.toThrow(/hidden-comment-loss/i)
    await expect(host.materializeClipboard(
      'renderer:1',
      'clipboard-cut-preflight',
      'revision:stale',
      {
        view: 'markup',
        consumer: 'cut',
        selection: { start: 0, end: 1 }
      }
    )).rejects.toThrow(/stale revision/i)

    const lease = await host.preparePersistence(
      'renderer:1',
      'clipboard-cut-preflight',
      'save'
    )
    expect(lease.source).toBe(hiddenSource)

    const tableSource = [
      '| a | b |',
      '| --- | --- |',
      '| one{>>hidden<<} | two |',
      ''
    ].join('\n')
    const tableOpen = await openHost(host, 'renderer:1', {
      documentId: 'clipboard-table-cut-preflight',
      durabilityKey: 'durable-clipboard-table-cut-preflight',
      source: createSourceSnapshot(tableSource),
      parseConfiguration: configuration
    })
    const table = decodeDocumentCorePublication(
      codec.publish(tableOpen.envelope, tableOpen.baseSnapshotId)
    )
    if (table.kind !== 'complete') {
      throw new Error('Expected a complete table preflight fixture')
    }
    await expect(host.materializeClipboard(
      'renderer:1',
      'clipboard-table-cut-preflight',
      table.revisionId,
      {
        view: 'markup',
        consumer: 'cut-table',
        selection: {
          start: table.modelText.indexOf('one'),
          end: table.modelText.indexOf('two') + 'two'.length
        }
      }
    )).rejects.toThrow(/hidden-comment-loss/i)

    await host.close('renderer:1', 'clipboard-cut-preflight')
    await host.close('renderer:1', 'clipboard-table-cut-preflight')
  })

  it('keeps a cut ticket scoped to its owner/document and commits once', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const codec = new WireEnvelopeCodecV1()
    const firstOpen = await openHost(host, 'renderer:1', {
      documentId: 'clipboard-cut-scope',
      durabilityKey: 'durable-clipboard-cut-scope',
      source: createSourceSnapshot('Hello'),
      parseConfiguration: configuration
    })
    const first = decodeDocumentCorePublication(
      codec.publish(firstOpen.envelope, firstOpen.baseSnapshotId)
    )
    const secondOpen = await openHost(host, 'renderer:1', {
      documentId: 'clipboard-cut-other',
      durabilityKey: 'durable-clipboard-cut-other',
      source: createSourceSnapshot('Other'),
      parseConfiguration: configuration
    })
    codec.publish(secondOpen.envelope, secondOpen.baseSnapshotId)
    const prepared = await host.materializeClipboard(
      'renderer:1',
      'clipboard-cut-scope',
      first.revisionId,
      {
        view: 'markup',
        consumer: 'cut',
        selection: { start: 1, end: 4 }
      }
    )
    if (
      prepared.kind !== 'materialized' ||
      prepared.artifact.kind !== 'cut-preparation'
    ) {
      throw new Error('Expected a scoped cut preparation')
    }
    const ticketId = prepared.artifact.ticketId
    await expect(host.completeCut(
      'renderer:foreign',
      'clipboard-cut-scope',
      ticketId,
      true
    )).rejects.toThrow(/owned by/i)
    await expect(host.completeCut(
      'renderer:1',
      'clipboard-cut-other',
      ticketId,
      true
    )).rejects.toThrow(/unknown|consumed/i)

    const completions = await Promise.allSettled([
      host.completeCut(
        'renderer:1',
        'clipboard-cut-scope',
        ticketId,
        true
      ),
      host.completeCut(
        'renderer:1',
        'clipboard-cut-scope',
        ticketId,
        true
      )
    ])
    expect(completions.filter(result => result.status === 'fulfilled'))
      .toHaveLength(1)
    expect(completions.filter(result => result.status === 'rejected'))
      .toHaveLength(1)
    const lease = await host.preparePersistence(
      'renderer:1',
      'clipboard-cut-scope',
      'save'
    )
    expect(lease.source).toBe('Ho')
    await host.close('renderer:1', 'clipboard-cut-scope')
    await host.close('renderer:1', 'clipboard-cut-other')
  })

  it('revokes every retained cut when its renderer detaches', async() => {
    let execution: IsolatedDocumentSession | undefined
    const host = createDocumentCoreMainSessionHost(
      await temporaryStorage(),
      started => {
        execution = started
      }
    )
    const codec = new WireEnvelopeCodecV1()
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'clipboard-cut-detach',
      durabilityKey: 'durable-clipboard-cut-detach',
      source: createSourceSnapshot('Hello'),
      parseConfiguration: configuration
    })
    const snapshot = decodeDocumentCorePublication(
      codec.publish(opened.envelope, opened.baseSnapshotId)
    )
    const prepared = await host.materializeClipboard(
      'renderer:1',
      'clipboard-cut-detach',
      snapshot.revisionId,
      {
        view: 'markup',
        consumer: 'cut',
        selection: { start: 1, end: 4 }
      }
    )
    if (
      execution === undefined ||
      prepared.kind !== 'materialized' ||
      prepared.artifact.kind !== 'cut-preparation'
    ) {
      throw new Error('Expected an isolated retained cut')
    }
    const ticketId = prepared.artifact.ticketId
    const command = vi.spyOn(execution, 'command')
    host.detach('renderer:1')
    await vi.waitFor(() => {
      expect(command).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'complete-cut',
        ticketId,
        clipboardWritten: false
      }))
    })
    await expect(host.completeCut(
      'renderer:1',
      'clipboard-cut-detach',
      ticketId,
      true
    )).rejects.toThrow(/owned by no renderer/i)
    await host.terminate('clipboard-cut-detach')
  })

  it('cannot redirect a prepared cut after the owned snapshot changes', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const codec = new WireEnvelopeCodecV1()
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'clipboard-cut-stale',
      durabilityKey: 'durable-clipboard-cut-stale',
      source: createSourceSnapshot('Hello'),
      parseConfiguration: configuration
    })
    const snapshot = decodeDocumentCorePublication(
      codec.publish(opened.envelope, opened.baseSnapshotId)
    )
    const prepared = await host.materializeClipboard(
      'renderer:1',
      'clipboard-cut-stale',
      snapshot.revisionId,
      {
        view: 'markup',
        consumer: 'cut',
        selection: { start: 1, end: 4 }
      }
    )
    if (
      prepared.kind !== 'materialized' ||
      prepared.artifact.kind !== 'cut-preparation'
    ) {
      throw new Error('Expected a cut preparation')
    }

    await host.select('renderer:1', {
      documentId: 'clipboard-cut-stale',
      baseSnapshotId: snapshot.snapshotId,
      view: 'markup',
      selection: {
        anchor: { offset: 5, affinity: 'next' },
        focus: { offset: 5, affinity: 'next' }
      }
    })
    await expect(host.completeCut(
      'renderer:1',
      'clipboard-cut-stale',
      prepared.artifact.ticketId,
      true
    )).rejects.toThrow(/stale snapshot/i)

    const lease = await host.preparePersistence(
      'renderer:1',
      'clipboard-cut-stale',
      'save'
    )
    expect(lease.source).toBe('Hello')
    await expect(host.completeCut(
      'renderer:1',
      'clipboard-cut-stale',
      prepared.artifact.ticketId,
      true
    )).rejects.toThrow(/already consumed/i)
    await host.close('renderer:1', 'clipboard-cut-stale')
  })

  it('keeps renderer close owner-checked and terminally closes a detached session', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    await openHost(host, 'renderer:1', {
      documentId: 'terminal-close',
      durabilityKey: 'durable-terminal-close',
      source: createSourceSnapshot('owned'),
      parseConfiguration: configuration
    })
    expect(host.resourceCounts()).toEqual({
      sessionCount: 1,
      workerCount: 1
    })

    host.detach('renderer:1')
    await expect(
      host.close('renderer:1', 'terminal-close')
    ).rejects.toThrow(/owned by no renderer/)
    expect(host.resourceCounts()).toEqual({
      sessionCount: 1,
      workerCount: 1
    })

    await host.terminate('terminal-close')
    expect(host.resourceCounts()).toEqual({
      sessionCount: 0,
      workerCount: 0
    })
  })

  it('retains session ownership when isolated close rejects before completion', async() => {
    let execution: IsolatedDocumentSession | undefined
    const host = createDocumentCoreMainSessionHost(
      await temporaryStorage(),
      started => {
        execution = started
      }
    )
    await openHost(host, 'renderer:1', {
      documentId: 'retry-close',
      durabilityKey: 'durable-retry-close',
      source: createSourceSnapshot('owned'),
      parseConfiguration: configuration
    })
    if (execution === undefined) throw new Error('Missing isolated session')
    const close = vi.spyOn(execution, 'close')
      .mockRejectedValueOnce(new Error('isolated close failed'))

    await expect(
      host.close('renderer:1', 'retry-close')
    ).rejects.toThrow(/isolated close failed/)
    expect(host.resourceCounts()).toEqual({
      sessionCount: 1,
      workerCount: 1
    })

    close.mockRestore()
    await host.close('renderer:1', 'retry-close')
    expect(host.resourceCounts()).toEqual({
      sessionCount: 0,
      workerCount: 0
    })
  })

  it('admits an exact chunked open before one isolated session owner completes it', async() => {
    let execution: IsolatedDocumentSession | undefined
    const host = createDocumentCoreMainSessionHost(
      await temporaryStorage(),
      (started) => {
        execution = started
      }
    )
    const isolated = host as unknown as {
      startOpen: (
        ownerId: string,
        request: {
          documentId: string
          durabilityKey: string
          sourceLength: number
          parseConfiguration: ParseConfiguration
        }
      ) => Promise<{
        schema: 'document-core-open-ticket-1'
        ticketId: string
        chunkUnits: number
        executionThreadId: number
        requiresSource: boolean
      }>
      appendOpenChunk: (
        ownerId: string,
        documentId: string,
        ticketId: string,
        ordinal: number,
        text: string
      ) => Promise<void>
      completeOpen: (
        ownerId: string,
        documentId: string,
        ticketId: string
      ) => Promise<DocumentCorePublication>
    }
    const exactSource = 'left\uD800middle\uDC00right'
    const admittedAt = performance.now()
    const receipt = await isolated.startOpen('renderer:1', {
      documentId: 'isolated-open',
      durabilityKey: 'durable-isolated-open',
      sourceLength: exactSource.length,
      parseConfiguration: configuration
    })
    const admissionMs = performance.now() - admittedAt

    expect(admissionMs).toBeLessThanOrEqual(50)
    expect(receipt).toMatchObject({
      schema: 'document-core-open-ticket-1',
      chunkUnits: 262_144
    })
    expect(receipt.executionThreadId).toBeGreaterThan(0)
    expect(receipt.executionThreadId).not.toBe(threadId)

    await isolated.appendOpenChunk(
      'renderer:1',
      'isolated-open',
      receipt.ticketId,
      0,
      exactSource.slice(0, 5)
    )
    await isolated.appendOpenChunk(
      'renderer:1',
      'isolated-open',
      receipt.ticketId,
      1,
      exactSource.slice(5)
    )
    const opened = await isolated.completeOpen(
      'renderer:1',
      'isolated-open',
      receipt.ticketId
    )
    expect(opened).not.toHaveProperty('envelope')
    expect(opened).toMatchObject({
      schema: 'document-core-open-completion-1',
      snapshotId: expect.any(String)
    })
    expect(opened.execution).toMatchObject({
      operationKind: 'open',
      operationCheckpointCount: expect.any(Number),
      operationSourceUnits: expect.any(Number),
      operationLogicalNodes: expect.any(Number),
      operationMaximumSourceDelta: expect.any(Number),
      operationMaximumLogicalNodeDelta: expect.any(Number),
      operationElapsedMs: expect.any(Number),
      operationMaximumCheckpointGapMs: expect.any(Number),
      operationOwningThreadStallMs: expect.any(Number),
      operationIntrinsicSourceTraversals: expect.any(Number),
      operationIntrinsicSourceUnits: expect.any(Number),
      operationForkAstRegionEmissions: expect.any(Number),
      operationForkAstRegionUnits: expect.any(Number),
      operationForkAstRegionReuses: expect.any(Number)
    })
    expect(opened.execution.operationCheckpointCount).toBeGreaterThan(0)
    expect(opened.execution.operationElapsedMs).toBeGreaterThanOrEqual(0)
    expect(opened.execution.operationMaximumCheckpointGapMs)
      .toBeGreaterThanOrEqual(0)
    expect(opened.execution.operationOwningThreadStallMs)
      .toBeGreaterThanOrEqual(0)
    const attachTicket = await isolated.startOpen('renderer:1', {
      documentId: 'isolated-open',
      durabilityKey: 'durable-isolated-open',
      sourceLength: 0,
      parseConfiguration: configuration
    })
    expect(attachTicket.requiresSource).toBe(false)
    const attached = await isolated.completeOpen(
      'renderer:1',
      'isolated-open',
      attachTicket.ticketId
    )
    if (!('envelope' in attached)) {
      throw new Error('Expected verified renderer attachment publication')
    }
    const snapshot = decodeDocumentCorePublication(
      new WireEnvelopeCodecV1().publish(
        attached.envelope,
        attached.baseSnapshotId
      )
    )
    expect(snapshot.source).toBe(exactSource)
    expect(snapshot.source.length).toBe(exactSource.length)
    await host.close('renderer:1', 'isolated-open')
    expect(execution?.isAlive).toBe(false)
  })

  it('reports physical fragment reuse for the exact dispatch operation', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const codec = new WireEnvelopeCodecV1()
    const source = [
      'first paragraph',
      '',
      'second paragraph',
      '',
      'third paragraph',
      ''
    ].join('\n')
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'physical-reuse-report',
      durabilityKey: 'durable-physical-reuse-report',
      source: createSourceSnapshot(source),
      parseConfiguration: configuration
    })
    const initial = decodeDocumentCorePublication(
      codec.publish(opened.envelope, opened.baseSnapshotId)
    )
    if (initial.kind !== 'complete') {
      throw new Error('Expected complete reuse-report fixture')
    }

    const offset = source.indexOf('second') + 'second'.length
    const edited = await host.dispatch('renderer:1', {
      documentId: 'physical-reuse-report',
      baseSnapshotId: initial.snapshotId,
      intent: {
        kind: 'insert-text',
        target: {
          ...initial.selection,
          anchor: { offset, affinity: 'next' },
          focus: { offset, affinity: 'next' }
        },
        text: ' changed'
      }
    })

    expect(edited.execution.operationIntrinsicSourceTraversals)
      .toBeGreaterThan(0)
    expect(edited.execution.operationIntrinsicSourceUnits)
      .toBeGreaterThanOrEqual(source.length)
    expect(edited.execution.operationForkAstRegionEmissions)
      .toBeGreaterThan(0)
    expect(edited.execution.operationForkAstRegionUnits)
      .toBeGreaterThan(0)
    expect(edited.execution.operationForkAstRegionReuses)
      .toBeGreaterThan(0)

    await host.close('renderer:1', 'physical-reuse-report')
  })

  it('observes cooperative cancellation inside a long isolated parse', async() => {
    let execution: IsolatedDocumentSession | undefined
    const host = createDocumentCoreMainSessionHost(
      await temporaryStorage(),
      (started) => {
        execution = started
      }
    )
    const source = 'x'.repeat(4_000_000)
    const ticket = await host.startOpen('renderer:1', {
      documentId: 'cooperative-open-cancel',
      durabilityKey: 'durable-cooperative-open-cancel',
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
        'cooperative-open-cancel',
        ticket.ticketId,
        ordinal,
        source.slice(offset, offset + ticket.chunkUnits)
      )
      ordinal += 1
    }

    const terminal = host.completeOpen(
      'renderer:1',
      'cooperative-open-cancel',
      ticket.ticketId
    )
    const terminalStatus = terminal.then(
      () => 'resolved' as const,
      () => 'rejected' as const
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const cancellationStartedAt = performance.now()
    const cancellation = await host.cancelOpen(
      'renderer:1',
      'cooperative-open-cancel',
      ticket.ticketId
    )
    const cancellationMs = performance.now() - cancellationStartedAt

    expect(cancellation).toMatchObject({
      kind: 'cancelled',
      checkpointObserved: true
    })
    expect(cancellationMs).toBeLessThanOrEqual(100)
    expect(await terminalStatus).toBe('rejected')
    expect(execution?.isAlive).toBe(false)
  })

  it(
    'recovers a durable initial head when its worker dies before first publication',
    async() => {
      const paused = pauseAfterFirstDurableWrite(await temporaryStorage())
      let execution: IsolatedDocumentSession | undefined
      const host = createDocumentCoreMainSessionHost(
        paused.storage,
        (started) => {
          execution = started
        }
      )
      const source = '# durable before publication\n'
      const ticket = await host.startOpen('renderer:1', {
        documentId: 'initial-publication-crash',
        durabilityKey: 'durable-initial-publication-crash',
        sourceLength: source.length,
        parseConfiguration: configuration
      })
      await host.appendOpenChunk(
        'renderer:1',
        'initial-publication-crash',
        ticket.ticketId,
        0,
        source
      )
      const completing = host.completeOpen(
        'renderer:1',
        'initial-publication-crash',
        ticket.ticketId
      )
      const rejected = expect(completing).rejects.toThrow(/worker was terminated/)
      await paused.written
      await execution?.terminate()
      await rejected
      paused.release()

      host.detach('renderer:1')
      const recoveryTicket = await host.startOpen('renderer:2', {
        documentId: 'initial-publication-crash',
        durabilityKey: 'durable-initial-publication-crash',
        sourceLength: 'stale file baseline'.length,
        parseConfiguration: configuration
      })
      expect(recoveryTicket.requiresSource).toBe(false)
      const recoveredResult = await host.completeOpen(
        'renderer:2',
        'initial-publication-crash',
        recoveryTicket.ticketId
      )
      if (!('envelope' in recoveredResult)) {
        throw new Error('Recovery returned no renderer publication')
      }
      const recovered = decodeDocumentCorePublication(
        new WireEnvelopeCodecV1().publish(
          recoveredResult.envelope,
          recoveredResult.baseSnapshotId
        )
      )
      expect(recovered.source).toBe(source)
    },
    15_000
  )

  it(
    'interrupts a parsing dispatch through its scoped worker signal and accepts the next edit',
    async() => {
      let execution: IsolatedDocumentSession | undefined
      const host = createDocumentCoreMainSessionHost(
        await temporaryStorage(),
        (started) => {
          execution = started
        }
      )
      const source = 'x'.repeat(1_000_000)
      const opened = await openHost(host, 'renderer:1', {
        documentId: 'cooperative-dispatch-cancel',
        durabilityKey: 'durable-cooperative-dispatch-cancel',
        source: createSourceSnapshot(source),
        parseConfiguration: configuration
      })
      const snapshot = decodeDocumentCorePublication(
        new WireEnvelopeCodecV1().publish(
          opened.envelope,
          opened.baseSnapshotId
        )
      )
      const target = {
        ...snapshot.selection,
        anchor: { offset: source.length, affinity: 'next' as const },
        focus: { offset: source.length, affinity: 'next' as const }
      }
      const ticket = await host.startDispatch('renderer:1', {
        documentId: 'cooperative-dispatch-cancel',
        baseSnapshotId: snapshot.snapshotId,
        intent: { kind: 'insert-text', target, text: ' cancelled' }
      })
      if (execution === undefined) {
        throw new Error('Expected an isolated session execution')
      }
      const executionGeneration = execution.activeExecutionGeneration
      expect(executionGeneration).toBeGreaterThan(0)
      await expect(
        execution.waitForExecutionCheckpoint(executionGeneration, 5_000)
      ).resolves.toBe(true)
      const terminal = host.completeDispatch(
        'renderer:1',
        'cooperative-dispatch-cancel',
        ticket.ticketId
      )
      const cancellationStartedAt = performance.now()
      const cancellation = await host.cancelDispatch(
        'renderer:1',
        'cooperative-dispatch-cancel',
        ticket.ticketId
      )
      const cancellationMs = performance.now() - cancellationStartedAt

      expect(cancellation).toMatchObject({ kind: 'cancelled' })
      expect(cancellationMs).toBeLessThanOrEqual(100)
      const cancelledPublication = await terminal
      expect(cancelledPublication.envelope.nextSnapshotId)
        .toBe(snapshot.snapshotId)

      const committed = await host.dispatch('renderer:1', {
        documentId: 'cooperative-dispatch-cancel',
        baseSnapshotId: snapshot.snapshotId,
        intent: { kind: 'insert-text', target, text: '!' }
      })
      const verifiedCommit = new WireEnvelopeCodecV1().publish(
        committed.envelope,
        committed.baseSnapshotId
      )
      expect(verifiedCommit.kind).toBe('published')
      if (verifiedCommit.kind !== 'published') {
        throw new Error('Expected the next dispatch publication to verify')
      }
      const committedOutcome = JSON.parse(new TextDecoder().decode(
        verifiedCommit.members.terminalOutcomeDelta
      )) as { readonly kind?: unknown }
      expect(
        committedOutcome,
        JSON.stringify(committedOutcome)
      ).toMatchObject({ kind: 'committed' })
      const committedSnapshot = decodeDocumentCorePublication(
        verifiedCommit,
        snapshot
      )
      expect(committedSnapshot.source.length).toBe(source.length + 1)
      expect(committedSnapshot.source.endsWith('!')).toBe(true)
      expect(committed.execution.cancellationObserved).toBe(true)
    },
    30_000
  )

  it('publishes the authoritative clean history state with the opened document', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'document-history',
      durabilityKey: 'durable-document-history',
      source: createSourceSnapshot('alpha'),
      parseConfiguration: configuration
    })
    const snapshot = decodeDocumentCorePublication(
      new WireEnvelopeCodecV1().publish(opened.envelope, opened.baseSnapshotId)
    ) as unknown as {
      historyState?: {
        canUndo: boolean
        canRedo: boolean
        dirty: boolean
        headIdentity: string
        savedIdentity: string
      }
    }

    expect(snapshot.historyState).toMatchObject({
      canUndo: false,
      canRedo: false,
      dirty: false
    })
    expect(snapshot.historyState?.headIdentity).toBeTruthy()
    expect(snapshot.historyState?.savedIdentity).toBe(
      snapshot.historyState?.headIdentity
    )
  })

  it('keeps stable save identity through edit, undo, redo, and divergent edit', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const codec = new WireEnvelopeCodecV1()
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'document-history-cycle',
      durabilityKey: 'durable-document-history-cycle',
      source: createSourceSnapshot('A'),
      parseConfiguration: configuration
    })
    const initial = decodeDocumentCorePublication(
      codec.publish(opened.envelope, opened.baseSnapshotId)
    )
    if (initial.kind !== 'complete') throw new Error('Expected complete snapshot')
    const initialIdentity = initial.historyState.headIdentity

    const editedPublication = await host.dispatch('renderer:1', {
      documentId: 'document-history-cycle',
      baseSnapshotId: initial.snapshotId,
      intent: {
        kind: 'insert-text',
        target: {
          ...initial.selection,
          anchor: { offset: 1, affinity: 'next' },
          focus: { offset: 1, affinity: 'next' }
        },
        text: 'B'
      }
    })
    const edited = decodeDocumentCorePublication(
      codec.publish(
        editedPublication.envelope,
        editedPublication.baseSnapshotId
      ),
      initial
    )
    expect(edited.historyState).toMatchObject({
      canUndo: true,
      canRedo: false,
      dirty: true,
      savedIdentity: initialIdentity
    })
    const editedIdentity = edited.historyState.headIdentity
    expect(editedIdentity).not.toBe(initialIdentity)

    const persistence = await host.preparePersistence(
      'renderer:1',
      'document-history-cycle',
      'save'
    )
    const markedSaved = await host.markPersisted(
      'renderer:1',
      'document-history-cycle',
      persistence.leaseId
    )
    expect(markedSaved).toMatchObject({
      dirty: false,
      headIdentity: editedIdentity,
      savedIdentity: editedIdentity
    })

    const undonePublication = await host.dispatch('renderer:1', {
      documentId: 'document-history-cycle',
      baseSnapshotId: edited.snapshotId,
      intent: { kind: 'undo' }
    })
    const undone = decodeDocumentCorePublication(
      codec.publish(
        undonePublication.envelope,
        undonePublication.baseSnapshotId
      ),
      edited
    )
    expect(undone.source).toBe('A')
    expect(undone.historyState).toMatchObject({
      canUndo: false,
      canRedo: true,
      dirty: true,
      headIdentity: initialIdentity,
      savedIdentity: editedIdentity
    })

    const redonePublication = await host.dispatch('renderer:1', {
      documentId: 'document-history-cycle',
      baseSnapshotId: undone.snapshotId,
      intent: { kind: 'redo' }
    })
    const redone = decodeDocumentCorePublication(
      codec.publish(
        redonePublication.envelope,
        redonePublication.baseSnapshotId
      ),
      undone
    )
    expect(redone.source).toBe('AB')
    expect(redone.historyState).toMatchObject({
      canUndo: true,
      canRedo: false,
      dirty: false,
      headIdentity: editedIdentity,
      savedIdentity: editedIdentity
    })

    const secondUndoPublication = await host.dispatch('renderer:1', {
      documentId: 'document-history-cycle',
      baseSnapshotId: redone.snapshotId,
      intent: { kind: 'undo' }
    })
    const secondUndo = decodeDocumentCorePublication(
      codec.publish(
        secondUndoPublication.envelope,
        secondUndoPublication.baseSnapshotId
      ),
      redone
    )
    if (secondUndo.kind !== 'complete') {
      throw new Error('Expected complete snapshot')
    }
    const divergentPublication = await host.dispatch('renderer:1', {
      documentId: 'document-history-cycle',
      baseSnapshotId: secondUndo.snapshotId,
      intent: {
        kind: 'insert-text',
        target: {
          ...secondUndo.selection,
          anchor: { offset: 1, affinity: 'next' },
          focus: { offset: 1, affinity: 'next' }
        },
        text: 'C'
      }
    })
    const divergent = decodeDocumentCorePublication(
      codec.publish(
        divergentPublication.envelope,
        divergentPublication.baseSnapshotId
      ),
      secondUndo
    )
    expect(divergent.source).toBe('AC')
    expect(divergent.historyState).toMatchObject({
      canUndo: true,
      canRedo: false,
      dirty: true,
      savedIdentity: editedIdentity
    })
    expect(divergent.historyState.headIdentity).not.toBe(editedIdentity)
  })

  it('recovers a lost markPersisted acknowledgement and durably restores the prior saved identity', async() => {
    const delegate = await temporaryStorage()
    let activeExecution: IsolatedDocumentSession | undefined
    let terminateAfterCommit = false
    const storage: DocumentSessionJournalStorage = Object.freeze({
      read: delegate.read,
      compareExchange: async(
        key: string,
        expectedRevision: number | null,
        mutation: DocumentSessionJournalMutation
      ) => {
        const result = await delegate.compareExchange(
          key,
          expectedRevision,
          mutation
        )
        if (terminateAfterCommit) {
          terminateAfterCommit = false
          await activeExecution?.terminate()
        }
        return result
      }
    })
    const host = createDocumentCoreMainSessionHost(
      storage,
      execution => {
        activeExecution = execution
      }
    )
    const codec = new WireEnvelopeCodecV1()
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'document-mark-ack-loss',
      durabilityKey: 'durable-document-mark-ack-loss',
      source: createSourceSnapshot('A'),
      parseConfiguration: configuration
    })
    const initial = decodeDocumentCorePublication(
      codec.publish(opened.envelope, opened.baseSnapshotId)
    )
    if (initial.kind !== 'complete') throw new Error('Expected complete snapshot')
    const editedPublication = await host.dispatch('renderer:1', {
      documentId: 'document-mark-ack-loss',
      baseSnapshotId: initial.snapshotId,
      intent: {
        kind: 'insert-text',
        target: {
          ...initial.selection,
          anchor: { offset: 1, affinity: 'next' },
          focus: { offset: 1, affinity: 'next' }
        },
        text: 'B'
      }
    })
    const edited = decodeDocumentCorePublication(
      codec.publish(
        editedPublication.envelope,
        editedPublication.baseSnapshotId
      ),
      initial
    )
    const lease = await host.preparePersistence(
      'renderer:1',
      'document-mark-ack-loss',
      'save'
    )
    terminateAfterCommit = true

    await expect(host.markPersisted(
      'renderer:1',
      'document-mark-ack-loss',
      lease.leaseId
    )).rejects.toThrow(/terminated|worker/i)

    const restored = await host.restorePersisted(
      'renderer:1',
      'document-mark-ack-loss',
      initial.historyState.savedIdentity
    )
    expect(restored).toMatchObject({
      dirty: true,
      headIdentity: edited.historyState.headIdentity,
      savedIdentity: initial.historyState.savedIdentity
    })
    const afterRecovery = await host.preparePersistence(
      'renderer:1',
      'document-mark-ack-loss',
      'save'
    )
    expect(afterRecovery.historyState).toMatchObject({
      dirty: true,
      headIdentity: edited.historyState.headIdentity,
      savedIdentity: initial.historyState.savedIdentity
    })
  })

  it('reconfigures grammar in its worker without changing source or history identity', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'document-reconfigure',
      durabilityKey: 'durable-document-reconfigure',
      source: createSourceSnapshot('note[^n]\n\n[^n]: body\n'),
      parseConfiguration: {
        ...configuration,
        markdownOptions: {
          ...configuration.markdownOptions,
          footnotes: false
        }
      }
    })
    const codec = new WireEnvelopeCodecV1()
    const initial = decodeDocumentCorePublication(
      codec.publish(opened.envelope, opened.baseSnapshotId)
    )
    const before = await host.materializeStatic(
      'renderer:1',
      'document-reconfigure',
      {
        consumer: 'static-html',
        view: 'revised',
        structure: staticStructure
      }
    )
    if (before.kind !== 'materialized') {
      throw new Error('Expected materialized HTML')
    }
    expect(consumeDocumentCoreHostHtml(before.artifact.html, 'static'))
      .not.toContain('<section class="footnotes">')

    const enabledPublication = await host.reconfigureMarkdownOptions(
      'renderer:1',
      {
        documentId: 'document-reconfigure',
        baseSnapshotId: initial.snapshotId,
        patch: { footnotes: true }
      }
    )
    const enabled = decodeDocumentCorePublication(
      codec.publish(
        enabledPublication.envelope,
        enabledPublication.baseSnapshotId
      ),
      initial
    )
    expect(enabled.source).toBe(initial.source)
    expect(enabled.historyState).toEqual(initial.historyState)
    const after = await host.materializeStatic(
      'renderer:1',
      'document-reconfigure',
      {
        consumer: 'static-html',
        view: 'revised',
        structure: staticStructure
      }
    )
    if (after.kind !== 'materialized') {
      throw new Error('Expected materialized HTML')
    }
    expect(consumeDocumentCoreHostHtml(after.artifact.html, 'static'))
      .toContain('<section class="footnotes">')

    await expect(host.reconfigureMarkdownOptions('renderer:1', {
      documentId: 'document-reconfigure',
      baseSnapshotId: initial.snapshotId,
      patch: { footnotes: false }
    })).rejects.toThrow(/stale snapshot/)

    const disabledPublication = await host.reconfigureMarkdownOptions(
      'renderer:1',
      {
        documentId: 'document-reconfigure',
        baseSnapshotId: enabled.snapshotId,
        patch: { footnotes: false }
      }
    )
    const disabled = decodeDocumentCorePublication(
      codec.publish(
        disabledPublication.envelope,
        disabledPublication.baseSnapshotId
      ),
      enabled
    )
    expect(disabled.source).toBe(initial.source)
    expect(disabled.historyState).toEqual(initial.historyState)
    await host.close('renderer:1', 'document-reconfigure')
  })

  it('publishes one verified portable snapshot and leases its canonical source', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'document-a',
      durabilityKey: 'durable-document-a',
      source: createSourceSnapshot('# Title\n\nA {++change++}.\n'),
      parseConfiguration: configuration
    })

    const codec = new WireEnvelopeCodecV1()
    const published = codec.publish(opened.envelope, opened.baseSnapshotId)
    expect(published.kind).toBe('published')
    if (published.kind !== 'published') return

    const snapshot = decodeDocumentCorePublication(published)
    expect(snapshot.source).toBe('# Title\n\nA {++change++}.\n')
    expect(snapshot.modelText).toBe('# Title\n\nA change.\n')
    expect(snapshot.blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph'
    ])
    expect(published.members.reviewDelta).toBeInstanceOf(Uint8Array)
    if (snapshot.kind !== 'complete') {
      throw new Error('Expected a complete snapshot')
    }
    expect(snapshot.trackChanges).toBe(false)
    expect(snapshot.reviewIndex.items).toHaveLength(1)
    expect(Object.isFrozen(snapshot.reviewIndex.items)).toBe(true)
    expect(Object.isFrozen(snapshot.reviewIndex.items[0])).toBe(true)
    expect(snapshot.reviewIndex.items[0]).toMatchObject({
      kind: 'addition',
      depth: 0,
      parent: null,
      modelRange: { start: 11, end: 17 }
    })

    const trackedPublication = await host.dispatch('renderer:1', {
      documentId: 'document-a',
      baseSnapshotId: snapshot.snapshotId,
      intent: {
        kind: 'set-track-changes',
        enabled: true
      }
    })
    const tracked = decodeDocumentCorePublication(
      codec.publish(
        trackedPublication.envelope,
        trackedPublication.baseSnapshotId
      ),
      snapshot
    )
    if (tracked.kind !== 'complete') {
      throw new Error('Expected a complete tracked snapshot')
    }
    expect(tracked.trackChanges).toBe(true)
    expect(tracked.reviewIndex).toEqual(snapshot.reviewIndex)

    const lease = await host.preparePersistence('renderer:1', 'document-a', 'save')
    expect(lease.source).toBe(snapshot.source)
    expect(lease.revisionId).toBe(tracked.revisionId)
    expect(lease.sourceHash).toBe(snapshot.sourceHash)
  })

  it('keeps the durable head after renderer loss and recovers it in a new host', async() => {
    const storage = await temporaryStorage()
    const firstHost = createDocumentCoreMainSessionHost(storage)
    const opened = await openHost(firstHost, 'renderer:1', {
      documentId: 'document-b',
      durabilityKey: 'durable-document-b',
      source: createSourceSnapshot('alpha'),
      parseConfiguration: configuration
    })
    const openedSnapshot = decodeDocumentCorePublication(
      new WireEnvelopeCodecV1().publish(opened.envelope, opened.baseSnapshotId)
    )
    if (openedSnapshot.kind !== 'complete') {
      throw new Error('Expected a complete snapshot')
    }

    const changed = await firstHost.dispatch('renderer:1', {
      documentId: 'document-b',
      baseSnapshotId: openedSnapshot.snapshotId,
      intent: {
        kind: 'insert-text',
        target: {
          ...openedSnapshot.selection,
          anchor: { offset: 5, affinity: 'next' },
          focus: { offset: 5, affinity: 'next' }
        },
        text: ' beta'
      }
    })
    const changedSnapshot = decodeDocumentCorePublication(
      new WireEnvelopeCodecV1().publish(changed.envelope, changed.baseSnapshotId),
      openedSnapshot
    )
    expect(changedSnapshot.source).toBe('alpha beta')
    expect(changedSnapshot.historyState).toMatchObject({
      canUndo: true,
      canRedo: false,
      dirty: true
    })

    // Renderer death is not a session close. The main-owned head remains
    // durable, and a fresh main host can replay it without trusting stale
    // renderer source.
    firstHost.detach('renderer:1')
    const recoveredHost = createDocumentCoreMainSessionHost(storage)
    const recovered = await openHost(recoveredHost, 'renderer:2', {
      documentId: 'document-b',
      durabilityKey: 'durable-document-b',
      // Reopen starts from the same exact file snapshot. The newer unsaved
      // head comes from the main journal, not from this on-disk baseline.
      source: createSourceSnapshot('alpha'),
      parseConfiguration: configuration
    })
    const recoveredSnapshot = decodeDocumentCorePublication(
      new WireEnvelopeCodecV1().publish(recovered.envelope, recovered.baseSnapshotId)
    )
    expect(recoveredSnapshot.source).toBe('alpha beta')
    expect(recoveredSnapshot.sourceHash).toBe(changedSnapshot.sourceHash)
    expect(recoveredSnapshot.historyState).toEqual(
      changedSnapshot.historyState
    )
  })

  it('rejects a lost execution and replays its durable ingress once in a new worker', async() => {
    const controlled = controllableAdmissionStorage(await temporaryStorage())
    const executions: IsolatedDocumentSession[] = []
    const host = createDocumentCoreMainSessionHost(
      controlled.storage,
      (execution) => executions.push(execution)
    )
    const codec = new WireEnvelopeCodecV1()
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'document-worker-recovery',
      durabilityKey: 'durable-document-worker-recovery',
      source: createSourceSnapshot('alpha'),
      parseConfiguration: configuration
    })
    const initial = decodeDocumentCorePublication(
      codec.publish(opened.envelope, opened.baseSnapshotId)
    )
    if (initial.kind !== 'complete') {
      throw new Error('Expected a complete snapshot')
    }
    const committedPublication = await host.dispatch('renderer:1', {
      documentId: 'document-worker-recovery',
      baseSnapshotId: initial.snapshotId,
      intent: {
        kind: 'insert-text',
        target: {
          ...initial.selection,
          anchor: { offset: 5, affinity: 'next' },
          focus: { offset: 5, affinity: 'next' }
        },
        text: ' beta'
      }
    })
    const committed = decodeDocumentCorePublication(
      codec.publish(
        committedPublication.envelope,
        committedPublication.baseSnapshotId
      ),
      initial
    )
    if (committed.kind !== 'complete') {
      throw new Error('Expected a complete snapshot')
    }
    const firstThreadId = executions.at(-1)?.executionThreadId
    expect(firstThreadId).toBeGreaterThan(0)

    controlled.block()
    const admitted = await host.startDispatch('renderer:1', {
      documentId: 'document-worker-recovery',
      baseSnapshotId: committed.snapshotId,
      intent: {
        kind: 'insert-text',
        target: {
          ...committed.selection,
          anchor: { offset: 10, affinity: 'next' },
          focus: { offset: 10, affinity: 'next' }
        },
        text: ' uncommitted'
      }
    })
    const interrupted = host.completeDispatch(
      'renderer:1',
      'document-worker-recovery',
      admitted.ticketId
    )
    const interruptedExpectation =
      expect(interrupted).rejects.toThrow(/worker was terminated/)
    await executions.at(-1)?.terminate()
    await interruptedExpectation
    controlled.release()

    host.detach('renderer:1')
    const recoveryTicket = await host.startOpen('renderer:2', {
      documentId: 'document-worker-recovery',
      durabilityKey: 'durable-document-worker-recovery',
      sourceLength: 'stale renderer source'.length,
      parseConfiguration: configuration
    })
    expect(recoveryTicket.requiresSource).toBe(false)
    expect(recoveryTicket.executionThreadId).toBeGreaterThan(0)
    expect(recoveryTicket.executionThreadId).not.toBe(firstThreadId)
    const recoveredResult = await host.completeOpen(
      'renderer:2',
      'document-worker-recovery',
      recoveryTicket.ticketId
    )
    if (!('envelope' in recoveredResult)) {
      throw new Error('Worker recovery returned no renderer publication')
    }
    const recovered = decodeDocumentCorePublication(
      codec.publish(
        recoveredResult.envelope,
        recoveredResult.baseSnapshotId
      )
    )
    expect(recovered.source).toBe('alpha beta uncommitted')
    expect(recovered.source.match(/ uncommitted/g)).toHaveLength(1)
    expect(recovered.historyState).toMatchObject({
      canUndo: true,
      canRedo: false,
      dirty: true,
      savedIdentity: committed.historyState.savedIdentity
    })
    const undonePublication = await host.dispatch('renderer:2', {
      documentId: 'document-worker-recovery',
      baseSnapshotId: recovered.snapshotId,
      intent: { kind: 'undo' }
    })
    const undone = decodeDocumentCorePublication(
      codec.publish(
        undonePublication.envelope,
        undonePublication.baseSnapshotId
      ),
      recovered
    )
    expect(undone.source).toBe('alpha beta')
    await host.close('renderer:2', 'document-worker-recovery')
  })

  it('rejects a stale renderer before it can become a second writer', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'document-c',
      durabilityKey: 'durable-document-c',
      source: createSourceSnapshot('one'),
      parseConfiguration: configuration
    })
    const snapshot = decodeDocumentCorePublication(
      new WireEnvelopeCodecV1().publish(opened.envelope, opened.baseSnapshotId)
    )
    if (snapshot.kind !== 'complete') throw new Error('Expected a complete snapshot')

    await expect(host.dispatch('renderer:2', {
      documentId: 'document-c',
      baseSnapshotId: snapshot.snapshotId,
      intent: { kind: 'undo' }
    })).rejects.toThrow(/owned by renderer:1/)

    await expect(host.dispatch('renderer:1', {
      documentId: 'document-c',
      baseSnapshotId: 'editor-snapshot:stale',
      intent: { kind: 'undo' }
    })).rejects.toThrow(/stale snapshot/)
  })

  it('keeps branded static HTML inside the main-owned session boundary', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    await openHost(host, 'renderer:1', {
      documentId: 'document-static',
      durabilityKey: 'durable-document-static',
      source: createSourceSnapshot(
        'Safe {++new++} <script>globalThis.__hostile = true</script>'
      ),
      parseConfiguration: configuration
    })

    const result = await host.materializeStatic('renderer:1', 'document-static', {
      consumer: 'pdf',
      view: 'markup',
      structure: staticStructure
    })

    expect(result).toMatchObject({
      kind: 'materialized',
      artifact: {
        kind: 'pdf-render-input',
        view: 'markup',
        html: {
          kind: 'trusted-html',
          sink: 'pdf'
        }
      }
    })
    if (result.kind !== 'materialized') {
      throw new Error('Expected a main-owned static artifact')
    }
    const html = consumeDocumentCoreHostHtml(result.artifact.html, 'pdf')
    expect(html).toContain('<ins>new</ins>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>globalThis.__hostile')
  })

  it('exposes a cancellable ticket before terminal work and publishes it once', async() => {
    const controlled = controllableAdmissionStorage(await temporaryStorage())
    let execution: IsolatedDocumentSession | undefined
    const host = createDocumentCoreMainSessionHost(
      controlled.storage,
      (started) => {
        execution = started
      }
    )
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'document-cancel',
      durabilityKey: 'durable-document-cancel',
      source: createSourceSnapshot('kept'),
      parseConfiguration: configuration
    })
    const snapshot = decodeDocumentCorePublication(
      new WireEnvelopeCodecV1().publish(opened.envelope, opened.baseSnapshotId)
    )
    if (snapshot.kind !== 'complete') throw new Error('Expected complete snapshot')

    controlled.block()
    if (execution === undefined) {
      throw new Error('Expected an isolated session execution')
    }
    const cancellationSignal = vi.spyOn(
      execution,
      'requestExecutionCancellation'
    )
    const admitted = await host.startDispatch('renderer:1', {
      documentId: 'document-cancel',
      baseSnapshotId: snapshot.snapshotId,
      intent: {
        kind: 'insert-text',
        target: {
          ...snapshot.selection,
          anchor: { offset: 4, affinity: 'next' },
          focus: { offset: 4, affinity: 'next' }
        },
        text: ' lost'
      }
    })

    const cancellation = host.cancelDispatch(
      'renderer:1',
      'document-cancel',
      admitted.ticketId
    )
    controlled.release()
    await expect(cancellation).resolves.toMatchObject({ kind: 'cancelled' })
    expect(cancellationSignal).toHaveBeenCalledWith(
      expect.any(Number),
      50
    )

    const terminal = await host.completeDispatch(
      'renderer:1',
      'document-cancel',
      admitted.ticketId
    )
    const terminalPublication = new WireEnvelopeCodecV1().publish(
      terminal.envelope,
      terminal.baseSnapshotId
    )
    expect(terminalPublication).toMatchObject({
      kind: 'published',
      mountedSnapshotId: snapshot.snapshotId
    })
    const lease = await host.preparePersistence(
      'renderer:1',
      'document-cancel',
      'save'
    )
    expect(lease.source).toBe('kept')

    const committedAfterCancellation = await host.dispatch('renderer:1', {
      documentId: 'document-cancel',
      baseSnapshotId: snapshot.snapshotId,
      intent: {
        kind: 'insert-text',
        target: {
          ...snapshot.selection,
          anchor: { offset: 4, affinity: 'next' },
          focus: { offset: 4, affinity: 'next' }
        },
        text: ' alive'
      }
    })
    const committedSnapshot = decodeDocumentCorePublication(
      new WireEnvelopeCodecV1().publish(
        committedAfterCancellation.envelope,
        committedAfterCancellation.baseSnapshotId
      ),
      snapshot
    )
    expect(committedSnapshot.source).toBe('kept alive')
    expect(execution.isAlive).toBe(true)

    await expect(host.completeDispatch(
      'renderer:1',
      'document-cancel',
      admitted.ticketId
    )).rejects.toThrow(/already consumed/)
  })

  it('keeps repeated deep-document edits bounded and observes retained parser work', async() => {
    const host = createDocumentCoreMainSessionHost(await temporaryStorage())
    const codec = new WireEnvelopeCodecV1()
    const depth = 12_000
    const source = `${'{++'.repeat(depth)}x${'++}'.repeat(depth)}`
    const opened = await openHost(host, 'renderer:1', {
      documentId: 'deep-repeated-edit',
      durabilityKey: 'durable-deep-repeated-edit',
      source: createSourceSnapshot(source),
      parseConfiguration: configuration
    })
    let snapshot = decodeDocumentCorePublication(
      codec.publish(opened.envelope, opened.baseSnapshotId)
    )
    if (snapshot.kind !== 'complete') {
      throw new Error('Expected a complete deep-document snapshot')
    }
    const executions: DocumentCorePublication['execution'][] = []

    for (const text of ['a', 'b']) {
      const target = {
        ...snapshot.selection,
        anchor: {
          offset: snapshot.markupModelLength,
          affinity: 'next' as const
        },
        focus: {
          offset: snapshot.markupModelLength,
          affinity: 'next' as const
        }
      }
      const committed = await host.dispatch('renderer:1', {
        documentId: 'deep-repeated-edit',
        baseSnapshotId: snapshot.snapshotId,
        intent: { kind: 'insert-text', target, text }
      })
      executions.push(committed.execution)
      snapshot = decodeDocumentCorePublication(
        codec.publish(committed.envelope, committed.baseSnapshotId),
        snapshot
      )
      if (snapshot.kind !== 'complete') {
        throw new Error('Deep-document edit became SourceOnly')
      }
    }

    expect(snapshot.source).toContain('xab')
    expect(Math.max(...executions.map(
      execution => execution.operationElapsedMs
    ))).toBeLessThanOrEqual(500)
    expect(Math.min(...executions.map(
      execution => execution.operationForkAstRegionReuses
    ))).toBeGreaterThan(0)
    await host.close('renderer:1', 'deep-repeated-edit')
  }, 30_000)
})
