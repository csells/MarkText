import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createMemoryDocumentSessionJournalStorage,
  recoverDocumentSession,
  createSourceSnapshot,
  revisionSemanticHashV1,
  sourceHashV1,
  type DocumentSessionJournalStorage,
  type DocumentSessionJournalMutation,
  type DocumentSessionOpenOptions,
  type ParseConfiguration
} from '@marktext/document-core'

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: {
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

const DESKTOP_CONFIGURATION: ParseConfiguration = {
  ...TEST_CONFIGURATION,
  executionBudget: {
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

describe('DocumentSession durable coordinator restart', () => {
  it('recovers from the authenticated journal without a caller-supplied source', async() => {
    const storage = createMemoryDocumentSessionJournalStorage()
    const durability = {
      key: 'durable-worker-crash',
      storage
    }
    const first = await createDocumentSession({
      source: createSourceSnapshot('alpha'),
      parseConfiguration: TEST_CONFIGURATION,
      initialSelection: {
        anchor: { offset: 5, affinity: 'next' },
        focus: { offset: 5, affinity: 'next' }
      },
      durability
    })
    const selection = first.snapshot().revision.selection
    if (selection === null) throw new Error('Expected an initial selection')
    expect((await first.dispatch({
      kind: 'insert-text',
      target: selection,
      text: ' beta'
    }).completion).kind).toBe('committed')
    const beforeCrash = first.snapshot()

    const recovered = await recoverDocumentSession({ durability })

    expect(recovered.snapshot()).toMatchObject({
      kind: beforeCrash.kind,
      revision: beforeCrash.revision
    })
    expect(recovered.historyState()).toEqual(first.historyState())
  })

  it('recovers exact source, selection, history, ids, and terminal ticket outcomes', async() => {
    const storage = createMemoryDocumentSessionJournalStorage()
    const options: DocumentSessionOpenOptions = {
      source: createSourceSnapshot('ac'),
      parseConfiguration: TEST_CONFIGURATION,
      initialSelection: {
        anchor: { offset: 1, affinity: 'next' },
        focus: { offset: 1, affinity: 'next' }
      },
      durability: {
        key: 'durable-complete',
        storage
      }
    }

    const firstCoordinator = await createDocumentSession(options)
    const target = firstCoordinator.snapshot().revision.selection
    if (target === null) {
      throw new Error('Expected an initial selection')
    }
    const insertion = firstCoordinator.dispatch({
      kind: 'insert-text',
      target,
      text: 'b'
    })
    expect((await insertion.completion).kind).toBe('committed')
    const currentTarget = firstCoordinator.snapshot().revision.selection
    if (currentTarget === null) {
      throw new Error('Expected a selection after insertion')
    }
    const noOp = firstCoordinator.dispatch({
      kind: 'insert-text',
      target: currentTarget,
      text: ''
    })
    expect((await noOp.completion).kind).toBe('noop')
    const rejected = firstCoordinator.dispatch({ kind: 'redo' })
    expect((await rejected.completion).kind).toBe('rejected')

    const beforeRestart = firstCoordinator.snapshot()
    const expectedSourceHash = sourceHashV1('abc')
    const expectedSemanticHash = revisionSemanticHashV1(
      expectedSourceHash,
      beforeRestart.revision.configuration
    )
    expect(beforeRestart.revision).toMatchObject({
      sourceHash: expectedSourceHash,
      semanticHash: expectedSemanticHash
    })
    const lease = await firstCoordinator.preparePersistence('save').completion
    if (lease.kind !== 'flushed') {
      throw new Error('Expected a source lease')
    }
    expect(lease.source.sourceHash).toBe(expectedSourceHash)
    const insertionOutcome = firstCoordinator.ticketOutcome(insertion.id)
    const noOpOutcome = firstCoordinator.ticketOutcome(noOp.id)
    const rejectedOutcome = firstCoordinator.ticketOutcome(rejected.id)
    expect(insertionOutcome).toMatchObject({
      kind: 'committed',
      ticket: insertion.id,
      sequence: insertion.clientSequence,
      sourceHash: expectedSourceHash,
      semanticHash: expectedSemanticHash
    })
    expect(noOpOutcome).toMatchObject({
      kind: 'noop',
      ticket: noOp.id,
      sequence: noOp.clientSequence,
      reason: 'empty-insertion'
    })
    expect(rejectedOutcome).toMatchObject({
      kind: 'rejected',
      ticket: rejected.id,
      sequence: rejected.clientSequence,
      reason: 'nothing-to-redo'
    })

    // Keep only the injected storage object. A new call constructs a new
    // coordinator, worker, engine, mailbox, and public client.
    const secondCoordinator = await createDocumentSession(options)
    expect(secondCoordinator.snapshot()).toMatchObject({
      revision: {
        session: beforeRestart.revision.session,
        id: beforeRestart.revision.id,
        source: 'abc',
        sourceHash: expectedSourceHash,
        semanticHash: expectedSemanticHash,
        selection: beforeRestart.revision.selection
      }
    })
    expect(secondCoordinator.ticketOutcome(insertion.id)).toEqual(insertionOutcome)
    expect(secondCoordinator.ticketOutcome(noOp.id)).toEqual(noOpOutcome)
    expect(secondCoordinator.ticketOutcome(rejected.id)).toEqual(rejectedOutcome)

    const undo = secondCoordinator.dispatch({ kind: 'undo' })
    expect((await undo.completion).kind).toBe('committed')
    expect(secondCoordinator.snapshot().revision.source).toBe('ac')

    const thirdCoordinator = await createDocumentSession(options)
    expect(thirdCoordinator.snapshot().revision.source).toBe('ac')
    const redo = thirdCoordinator.dispatch({ kind: 'redo' })
    expect((await redo.completion).kind).toBe('committed')
    expect(thirdCoordinator.snapshot().revision.source).toBe('abc')
    expect(thirdCoordinator.ticketOutcome(undo.id)).toMatchObject({
      kind: 'committed',
      cause: 'undo'
    })
  })

  it('recovers a newer durable head when reopen starts from a pinned committed revision', async() => {
    const storage = createMemoryDocumentSessionJournalStorage()
    const options: DocumentSessionOpenOptions = {
      source: createSourceSnapshot('a'),
      parseConfiguration: TEST_CONFIGURATION,
      initialSelection: {
        anchor: { offset: 1, affinity: 'next' },
        focus: { offset: 1, affinity: 'next' }
      },
      durability: {
        key: 'durable-pinned-reopen',
        storage
      }
    }

    const original = await createDocumentSession(options)
    const firstTarget = original.snapshot().revision.selection
    if (firstTarget === null) throw new Error('Expected an initial selection')
    expect((await original.dispatch({
      kind: 'insert-text',
      target: firstTarget,
      text: 'b'
    }).completion).kind).toBe('committed')

    const pinned = await original.preparePersistence('save').completion
    if (pinned.kind !== 'flushed') throw new Error('Expected a pinned source lease')
    await pinned.source.release('consumer-finished').completion

    const secondTarget = original.snapshot().revision.selection
    if (secondTarget === null) throw new Error('Expected a committed selection')
    expect((await original.dispatch({
      kind: 'insert-text',
      target: secondTarget,
      text: 'c'
    }).completion).kind).toBe('committed')
    expect(original.snapshot().revision.source).toBe('abc')

    const recovered = await createDocumentSession({
      ...options,
      source: createSourceSnapshot('ab')
    })
    expect(recovered.snapshot().revision.source).toBe('abc')

    await expect(createDocumentSession({
      ...options,
      source: createSourceSnapshot('unrelated')
    })).rejects.toThrow('Session journal identity or shape mismatch')
  })

  it('keeps SourceOnly text and raw-coordinate undo byte-for-byte across restart', async() => {
    const storage = createMemoryDocumentSessionJournalStorage()
    const source = `${'> '.repeat(129)}text\r\n`
    const exactInsertion = 'Z\r\n𝄞{++x++}'
    const options: DocumentSessionOpenOptions = {
      source: createSourceSnapshot(source),
      parseConfiguration: DESKTOP_CONFIGURATION,
      initialSelection: {
        anchor: { offset: source.length, affinity: 'next' },
        focus: { offset: source.length, affinity: 'next' }
      },
      durability: {
        key: 'durable-source-only',
        storage
      }
    }

    const firstCoordinator = await createDocumentSession(options)
    const target = firstCoordinator.snapshot().revision.selection
    if (target === null || target.view !== 'source') {
      throw new Error('Expected a SourceOnly initial selection')
    }
    const insertion = firstCoordinator.dispatch({
      kind: 'insert-text',
      target,
      text: exactInsertion
    })
    expect((await insertion.completion).kind).toBe('committed')
    expect(firstCoordinator.snapshot().revision.source).toBe(source + exactInsertion)

    const secondCoordinator = await createDocumentSession(options)
    expect(secondCoordinator.snapshot()).toMatchObject({
      kind: 'source-only',
      view: 'source',
      revision: {
        source: source + exactInsertion,
        selection: {
          view: 'source',
          anchor: { offset: source.length + exactInsertion.length },
          focus: { offset: source.length + exactInsertion.length }
        }
      }
    })
    expect(secondCoordinator.ticketOutcome(insertion.id)).toEqual(
      firstCoordinator.ticketOutcome(insertion.id)
    )

    expect((await secondCoordinator.dispatch({ kind: 'undo' }).completion).kind)
      .toBe('committed')
    expect(secondCoordinator.snapshot()).toMatchObject({
      kind: 'source-only',
      revision: {
        source,
        selection: {
          view: 'source',
          anchor: { offset: source.length },
          focus: { offset: source.length }
        }
      }
    })
  })

  it('rejects a checksum-valid checkpoint whose source violates its committed hash', async() => {
    const storage = createMemoryDocumentSessionJournalStorage()
    const options: DocumentSessionOpenOptions = {
      source: createSourceSnapshot('exact'),
      parseConfiguration: TEST_CONFIGURATION,
      durability: {
        key: 'durable-corruption',
        storage
      }
    }
    await createDocumentSession(options)

    const stored = await storage.read('durable-corruption')
    if (stored === null) {
      throw new Error('Expected an initialized durable checkpoint')
    }
    const envelope = JSON.parse(stored.data) as {
      body: string
      checksum: string
    }
    const body = JSON.parse(envelope.body) as {
      checkpoint: {
        worker: {
          source: string
        }
      }
    }
    body.checkpoint.worker.source = 'silently changed'
    const changedBody = JSON.stringify(body)
    const changedEnvelope = JSON.stringify({
      body: changedBody,
      checksum: sourceHashV1(changedBody)
    })
    expect(
      await storage.compareExchange(
        'durable-corruption',
        stored.revision,
        Object.freeze({
          data: changedEnvelope,
          contents: Object.freeze([]),
          retainedContentIds: Object.freeze(
            stored.contents.map(content => content.id)
          )
        })
      )
    ).not.toBeNull()

    await expect(createDocumentSession(options)).rejects.toThrow(
      'checkpoint does not match its recovered revision'
    )
  })

  it('settles a durably admitted ticket exactly once when the original worker is lost', async() => {
    const retained = createMemoryDocumentSessionJournalStorage()
    let compareExchangeCalls = 0
    let releaseBlockedWrite: (() => void) | undefined
    const blockedWrite = new Promise<void>((resolve) => {
      releaseBlockedWrite = resolve
    })
    const storage: DocumentSessionJournalStorage = Object.freeze({
      read: retained.read,
      async compareExchange(
        key: string,
        expectedRevision: number | null,
        mutation: DocumentSessionJournalMutation
      ) {
        compareExchangeCalls += 1
        // 1 initializes, 2 admits ingress, and 3 is the original worker's
        // precommit barrier. Hold only that third write to simulate losing the
        // worker after durable admission and before publication.
        if (compareExchangeCalls === 3) {
          await blockedWrite
        }
        return retained.compareExchange(key, expectedRevision, mutation)
      }
    })
    const options: DocumentSessionOpenOptions = {
      source: createSourceSnapshot('a'),
      parseConfiguration: TEST_CONFIGURATION,
      initialSelection: {
        anchor: { offset: 1, affinity: 'next' },
        focus: { offset: 1, affinity: 'next' }
      },
      durability: {
        key: 'durable-admitted',
        storage
      }
    }

    const original = await createDocumentSession(options)
    const target = original.snapshot().revision.selection
    if (target === null) {
      throw new Error('Expected an initial selection')
    }
    const ticket = original.dispatch({
      kind: 'insert-text',
      target,
      text: 'b'
    })
    await ticket.admission
    const abandonedCompletion = ticket.completion.catch((error: unknown) => error)

    const recovered = await createDocumentSession(options)
    expect(recovered.snapshot().revision.source).toBe('ab')
    expect(recovered.ticketOutcome(ticket.id)).toMatchObject({
      kind: 'committed',
      ticket: ticket.id,
      sequence: ticket.clientSequence,
      sourceHash: sourceHashV1('ab')
    })

    releaseBlockedWrite?.()
    expect(await abandonedCompletion).toBeInstanceOf(Error)
    expect(recovered.ticketOutcome(ticket.id)?.kind).toBe('committed')
    const recoveredTarget = recovered.snapshot().revision.selection
    if (recoveredTarget === null) {
      throw new Error('Expected the recovered selection')
    }
    const afterRecovery = recovered.dispatch({
      kind: 'insert-text',
      target: recoveredTarget,
      text: ''
    })
    expect(afterRecovery.id).not.toBe(ticket.id)
    expect((await afterRecovery.completion).kind).toBe('noop')
  })
})
