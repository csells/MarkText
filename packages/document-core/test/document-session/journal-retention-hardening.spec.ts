import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createMemoryDocumentSessionJournalStorage,
  createSourceSnapshot,
  DOCUMENT_RESOURCE_POLICY_V1,
  recoverDocumentSession,
  sourceHashV1,
  type DocumentSessionJournalStorage,
  type DocumentSessionOpenOptions,
  type IntentId,
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
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

interface MutableJournalBody {
  checkpoint: {
    worker: {
      history: Array<{
        forward: unknown
        inverse: unknown
      }>
    }
  }
  outcomes: unknown[]
  [field: string]: unknown
}

async function journalBody(
  storage: DocumentSessionJournalStorage,
  key: string
): Promise<MutableJournalBody> {
  const stored = await storage.read(key)
  if (stored === null) throw new Error('Expected a durable journal')
  const envelope = JSON.parse(stored.data) as { body: string }
  return JSON.parse(envelope.body) as MutableJournalBody
}

async function replaceJournalBody(
  storage: DocumentSessionJournalStorage,
  key: string,
  mutate: (body: MutableJournalBody) => void
): Promise<void> {
  const stored = await storage.read(key)
  if (stored === null) throw new Error('Expected a durable journal')
  const envelope = JSON.parse(stored.data) as { body: string }
  const body = JSON.parse(envelope.body) as MutableJournalBody
  mutate(body)
  const encodedBody = JSON.stringify(body)
  const changed = await storage.compareExchange(
    key,
    stored.revision,
    Object.freeze({
      data: JSON.stringify({
        body: encodedBody,
        checksum: sourceHashV1(encodedBody)
      }),
      contents: Object.freeze([]),
      retainedContentIds: Object.freeze(
        stored.contents.map(content => content.id)
      )
    })
  )
  if (changed === null) throw new Error('Expected journal tampering to commit')
}

function options(
  storage: DocumentSessionJournalStorage,
  key: string,
  source = ''
): DocumentSessionOpenOptions {
  return {
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION,
    initialSelection: {
      anchor: { offset: source.length, affinity: 'next' },
      focus: { offset: source.length, affinity: 'next' }
    },
    durability: { key, storage }
  }
}

describe('DocumentSession durable journal retention', () => {
  it('retains terminal outcomes below and at the limit and compacts first-above', async() => {
    const storage = createMemoryDocumentSessionJournalStorage()
    const key = 'bounded-terminal-outcomes'
    const session = await createDocumentSession(options(storage, key))
    const target = session.snapshot().revision.selection
    if (target === null) throw new Error('Expected an initial selection')
    const limit = DOCUMENT_RESOURCE_POLICY_V1.maximumJournalOutcomes
    let firstTicket: IntentId | undefined
    let lastTicket: IntentId | undefined

    for (let index = 0; index <= limit; index += 1) {
      const ticket = session.dispatch({
        kind: 'insert-text',
        target,
        text: ''
      })
      firstTicket ??= ticket.id
      lastTicket = ticket.id
      expect((await ticket.completion).kind).toBe('noop')
      if (index === limit - 2) {
        expect((await journalBody(storage, key)).outcomes).toHaveLength(limit - 1)
      }
      if (index === limit - 1) {
        expect((await journalBody(storage, key)).outcomes).toHaveLength(limit)
      }
    }

    expect((await journalBody(storage, key)).outcomes).toHaveLength(limit)
    if (firstTicket === undefined || lastTicket === undefined) {
      throw new Error('Expected terminal tickets')
    }
    expect(session.ticketOutcome(firstTicket)).toBeNull()
    expect(session.ticketOutcome(lastTicket)).toMatchObject({ kind: 'noop' })

    const recovered = await recoverDocumentSession({
      durability: { key, storage }
    })
    expect(recovered.ticketOutcome(firstTicket)).toBeNull()
    expect(recovered.ticketOutcome(lastTicket)).toEqual(
      session.ticketOutcome(lastTicket)
    )
  })

  it('retains undo entries below and at the limit and compacts first-above across restart', async() => {
    const storage = createMemoryDocumentSessionJournalStorage()
    const key = 'bounded-undo-history'
    const session = await createDocumentSession(options(storage, key))
    const limit = DOCUMENT_RESOURCE_POLICY_V1.maximumHistoryEntries
    let pinnedSource = ''

    for (let index = 0; index <= limit; index += 1) {
      const target = session.snapshot().revision.selection
      if (target === null) throw new Error('Expected an insertion target')
      expect((await session.dispatch({
        kind: 'insert-text',
        target,
        text: 'x'
      }).completion).kind).toBe('committed')
      if (index === 0) {
        const persistence = await session.preparePersistence('save').completion
        if (persistence.kind !== 'flushed') {
          throw new Error('Expected a persistence lease')
        }
        for await (const chunk of persistence.source.readChunks()) {
          pinnedSource += chunk.text
        }
        await persistence.source.release('consumer-finished').completion
      }
      if (index === limit - 2) {
        expect((await journalBody(storage, key)).checkpoint.worker.history)
          .toHaveLength(limit - 1)
      }
      if (index === limit - 1) {
        expect((await journalBody(storage, key)).checkpoint.worker.history)
          .toHaveLength(limit)
      }
    }

    expect((await journalBody(storage, key)).checkpoint.worker.history)
      .toHaveLength(limit)
    const recovered = await createDocumentSession({
      ...options(storage, key, pinnedSource),
      source: createSourceSnapshot(pinnedSource)
    })
    expect(recovered.snapshot().revision.source).toBe('x'.repeat(limit + 1))

    for (let index = 0; index < limit; index += 1) {
      expect((await recovered.dispatch({ kind: 'undo' }).completion).kind)
        .toBe('committed')
    }
    expect(recovered.snapshot().revision.source).toBe('x')
    expect(recovered.historyState().canUndo).toBe(false)
    await expect(recovered.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({
        kind: 'rejected',
        reason: 'nothing-to-undo'
      })
  }, 20_000)

  it('accepts bounded source-edit arrays and rejects the first oversized checkpoint', async() => {
    const limit =
      DOCUMENT_RESOURCE_POLICY_V1.maximumSourceEditsPerTransaction
    const edit = Object.freeze({ start: 0, end: 0, insert: '' })

    for (const size of [limit - 1, limit, limit + 1]) {
      const storage = createMemoryDocumentSessionJournalStorage()
      const key = `bounded-source-edits-${String(size)}`
      const session = await createDocumentSession(options(storage, key, 'a'))
      const target = session.snapshot().revision.selection
      if (target === null) throw new Error('Expected an insertion target')
      expect((await session.dispatch({
        kind: 'insert-text',
        target,
        text: 'b'
      }).completion).kind).toBe('committed')

      await replaceJournalBody(storage, key, (body) => {
        const entry = body.checkpoint.worker.history[0]
        if (entry === undefined) throw new Error('Expected one history entry')
        entry.forward = Array.from({ length: size }, () => edit)
      })

      const recovery = recoverDocumentSession({
        durability: { key, storage }
      })
      if (size <= limit) {
        await expect(recovery).resolves.toMatchObject({
          snapshot: expect.any(Function)
        })
      } else {
        await expect(recovery).rejects.toThrow('journal')
      }
    }
  })

  it('rejects checksum-valid nested null and extra source-edit fields', async() => {
    for (const [suffix, replacement] of [
      ['null', null],
      ['extra', [{ start: 0, end: 0, insert: '', unexpected: true }]]
    ] as const) {
      const storage = createMemoryDocumentSessionJournalStorage()
      const key = `closed-source-edit-${suffix}`
      const session = await createDocumentSession(options(storage, key, 'a'))
      const target = session.snapshot().revision.selection
      if (target === null) throw new Error('Expected an insertion target')
      expect((await session.dispatch({
        kind: 'insert-text',
        target,
        text: 'b'
      }).completion).kind).toBe('committed')
      await replaceJournalBody(storage, key, (body) => {
        const entry = body.checkpoint.worker.history[0]
        if (entry === undefined) throw new Error('Expected one history entry')
        entry.forward = replacement
      })

      await expect(recoverDocumentSession({
        durability: { key, storage }
      })).rejects.toThrow('journal')
    }
  })
})
