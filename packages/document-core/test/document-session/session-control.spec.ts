import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createMemoryDocumentSessionJournalStorage,
  createSourceSnapshot,
  type DocumentSessionJournalStorage,
  type DocumentSessionJournalMutation,
  type DocumentSessionOpenOptions,
  type ParseConfiguration,
  type SessionTransition
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

function durableOptions(
  key: string,
  storage: DocumentSessionJournalStorage
): DocumentSessionOpenOptions {
  return {
    source: createSourceSnapshot('ac'),
    parseConfiguration: TEST_CONFIGURATION,
    initialSelection: {
      anchor: { offset: 1, affinity: 'next' },
      focus: { offset: 1, affinity: 'next' }
    },
    durability: { key, storage }
  }
}

describe('DocumentSession control state machines', () => {
  it('mints a fresh capability even for repeated document namespaces', async() => {
    const first = await createDocumentSession({
      ...durableOptions(
        'repeated-namespace-first',
        createMemoryDocumentSessionJournalStorage()
      ),
      identityNamespace: 'same-document'
    })
    const second = await createDocumentSession({
      ...durableOptions(
        'repeated-namespace-second',
        createMemoryDocumentSessionJournalStorage()
      ),
      identityNamespace: 'same-document'
    })

    expect(first.snapshot().revision.session)
      .not.toBe(second.snapshot().revision.session)
    expect(first.snapshot().revision.id)
      .not.toBe(second.snapshot().revision.id)
    expect(first.snapshot().id).not.toBe(second.snapshot().id)
  })

  it('serializes concurrent admissions without dropping either durable ticket', async() => {
    const storage = createMemoryDocumentSessionJournalStorage()
    const session = await createDocumentSession(
      durableOptions('concurrent-admission', storage)
    )
    const target = session.snapshot().revision.selection
    if (target === null) {
      throw new Error('Expected an initial selection')
    }

    const first = session.dispatch({
      kind: 'insert-text',
      target,
      text: 'b'
    })
    const second = session.dispatch({
      kind: 'insert-text',
      target,
      text: 'x'
    })

    await expect(first.admission).resolves.toMatchObject({ kind: 'admitted' })
    await expect(second.admission).resolves.toMatchObject({ kind: 'admitted' })
    await expect(first.completion).resolves.toMatchObject({ kind: 'committed' })
    await expect(second.completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'stale-selection'
    })
    expect(session.ticketOutcome(first.id)?.kind).toBe('committed')
    expect(session.ticketOutcome(second.id)).toMatchObject({
      kind: 'rejected',
      reason: 'stale-selection'
    })
  })

  it('acknowledges cancellation once and suppresses every late terminal outcome', async() => {
    const storage = createMemoryDocumentSessionJournalStorage()
    const options = durableOptions('cancel-once', storage)
    const session = await createDocumentSession(options)
    const before = session.snapshot()
    const target = before.revision.selection
    if (target === null) {
      throw new Error('Expected an initial selection')
    }
    const transitions: SessionTransition[] = []
    session.subscribe((transition) => {
      transitions.push(transition)
    })

    const ticket = session.dispatch({
      kind: 'insert-text',
      target,
      text: 'b'
    })
    const cancel = session.cancel(ticket.id)
    const [dispatchResult, cancelResult] = await Promise.all([
      ticket.completion,
      cancel.completion
    ])

    expect(dispatchResult).toMatchObject({
      kind: 'cancelled',
      reason: 'cancelled',
      snapshot: before
    })
    expect(cancelResult).toEqual({
      kind: 'cancelled',
      ticket: ticket.id
    })
    expect(session.snapshot()).toBe(before)
    expect(transitions).toEqual([])
    expect(session.ticketOutcome(ticket.id)).toMatchObject({
      kind: 'cancelled',
      ticket: ticket.id,
      sequence: ticket.clientSequence,
      revision: before.revision.id
    })

    const recovered = await createDocumentSession(options)
    const late = await recovered.cancel(ticket.id).completion
    expect(late).toEqual({
      kind: 'already-terminal',
      ticket: ticket.id,
      outcome: 'cancelled'
    })
    expect(recovered.ticketOutcome(ticket.id)?.kind).toBe('cancelled')
    expect(recovered.snapshot().revision.source).toBe('ac')
  })

  it('recovers a durable cancel request and suppresses the abandoned worker write', async() => {
    const retained = createMemoryDocumentSessionJournalStorage()
    let writes = 0
    let releaseAbandonedWrite: (() => void) | undefined
    let signalAbandonedWrite: (() => void) | undefined
    const abandonedWriteEntered = new Promise<void>((resolve) => {
      signalAbandonedWrite = resolve
    })
    const holdAbandonedWrite = new Promise<void>((resolve) => {
      releaseAbandonedWrite = resolve
    })
    const storage: DocumentSessionJournalStorage = Object.freeze({
      read: retained.read,
      async compareExchange(
        key: string,
        expectedRevision: number | null,
        mutation: DocumentSessionJournalMutation
      ) {
        writes += 1
        if (writes === 4) {
          signalAbandonedWrite?.()
          await holdAbandonedWrite
        }
        return retained.compareExchange(key, expectedRevision, mutation)
      }
    })
    const options = durableOptions('cancel-recovery', storage)
    const original = await createDocumentSession(options)
    const before = original.snapshot()
    const target = before.revision.selection
    if (target === null) {
      throw new Error('Expected an initial selection')
    }
    const transitions: SessionTransition[] = []
    original.subscribe((transition) => {
      transitions.push(transition)
    })
    const ticket = original.dispatch({
      kind: 'insert-text',
      target,
      text: 'b'
    })
    const cancel = original.cancel(ticket.id)
    const abandonedDispatch = ticket.completion.catch((error: unknown) => error)
    const abandonedCancel = cancel.completion.catch((error: unknown) => error)
    await abandonedWriteEntered

    const recovered = await createDocumentSession(options)
    expect(recovered.snapshot().revision.source).toBe('ac')
    expect(recovered.ticketOutcome(ticket.id)).toMatchObject({
      kind: 'cancelled',
      ticket: ticket.id
    })

    releaseAbandonedWrite?.()
    expect(await abandonedDispatch).toBeInstanceOf(Error)
    expect(await abandonedCancel).toBeInstanceOf(Error)
    expect(original.snapshot()).toBe(before)
    expect(transitions).toEqual([])
    expect(recovered.ticketOutcome(ticket.id)?.kind).toBe('cancelled')
  })

  it('closes once, cancels admitted work, and remains closed after restart', async() => {
    const storage = createMemoryDocumentSessionJournalStorage()
    const options = durableOptions('close-once', storage)
    const session = await createDocumentSession(options)
    const before = session.snapshot()
    const target = before.revision.selection
    if (target === null) {
      throw new Error('Expected an initial selection')
    }
    const transitions: SessionTransition[] = []
    session.subscribe((transition) => {
      transitions.push(transition)
    })

    const ticket = session.dispatch({
      kind: 'insert-text',
      target,
      text: 'b'
    })
    const close = session.close()
    const duplicateClose = session.close()
    expect(session.status()).toBe('closing')
    expect(await duplicateClose.completion).toEqual({
      kind: 'already-closing'
    })
    expect(await ticket.completion).toMatchObject({ kind: 'cancelled' })
    expect(await close.completion).toEqual({ kind: 'closed' })
    expect(session.status()).toBe('closed')
    expect(session.snapshot()).toBe(before)
    expect(transitions).toEqual([])
    expect(await session.close().completion).toEqual({
      kind: 'already-closed'
    })
    expect(() =>
      session.dispatch({
        kind: 'insert-text',
        target,
        text: 'late'
      })
    ).toThrow('Document session is closed')
    expect(() =>
      session.select({
        anchor: { offset: 0, affinity: 'next' },
        focus: { offset: 0, affinity: 'next' }
      })
    ).toThrow('Document session is closed')
    expect(() => session.flush('materialize')).toThrow(
      'Document session is closed'
    )

    const recovered = await createDocumentSession(options)
    expect(recovered.status()).toBe('closed')
    expect(await recovered.close().completion).toEqual({
      kind: 'already-closed'
    })
    expect(recovered.snapshot().revision.source).toBe('ac')
  })

  it('acknowledges durable effects idempotently across restart', async() => {
    const retained = createMemoryDocumentSessionJournalStorage()
    let writes = 0
    const storage: DocumentSessionJournalStorage = Object.freeze({
      read: retained.read,
      async compareExchange(
        key: string,
        expectedRevision: number | null,
        mutation: DocumentSessionJournalMutation
      ) {
        writes += 1
        if (writes === 3) {
          return null
        }
        return retained.compareExchange(key, expectedRevision, mutation)
      }
    })
    const options = durableOptions('effect-ack', storage)
    const session = await createDocumentSession(options)
    const target = session.snapshot().revision.selection
    if (target === null) {
      throw new Error('Expected an initial selection')
    }
    await session.dispatch({
      kind: 'insert-text',
      target,
      text: 'b'
    }).completion
    const effect = session.effects()[0]
    if (effect === undefined) {
      throw new Error('Expected a visible failure effect')
    }

    expect(await session.acknowledgeEffect(effect.id).completion).toEqual({
      kind: 'acknowledged',
      effect: effect.id
    })
    expect(session.effects()).toEqual([
      { ...effect, status: 'acknowledged' }
    ])
    expect(session.ticketOutcome(effect.ticket)).toMatchObject({
      effect: { id: effect.id, status: 'acknowledged' }
    })
    expect(await session.acknowledgeEffect(effect.id).completion).toEqual({
      kind: 'already-terminal',
      effect: effect.id,
      status: 'acknowledged'
    })

    const recovered = await createDocumentSession(options)
    expect(recovered.effects()).toEqual([
      { ...effect, status: 'acknowledged' }
    ])
    expect(recovered.ticketOutcome(effect.ticket)).toMatchObject({
      effect: { id: effect.id, status: 'acknowledged' }
    })
    expect(await recovered.acknowledgeEffect(effect.id).completion).toEqual({
      kind: 'already-terminal',
      effect: effect.id,
      status: 'acknowledged'
    })
  })

  it('cancels every pending effect when the session closes', async() => {
    const retained = createMemoryDocumentSessionJournalStorage()
    let writes = 0
    const storage: DocumentSessionJournalStorage = Object.freeze({
      read: retained.read,
      async compareExchange(
        key: string,
        expectedRevision: number | null,
        mutation: DocumentSessionJournalMutation
      ) {
        writes += 1
        if (writes === 3) {
          return null
        }
        return retained.compareExchange(key, expectedRevision, mutation)
      }
    })
    const options = durableOptions('effect-close', storage)
    const session = await createDocumentSession(options)
    const target = session.snapshot().revision.selection
    if (target === null) {
      throw new Error('Expected an initial selection')
    }
    await session.dispatch({
      kind: 'insert-text',
      target,
      text: 'b'
    }).completion
    const effect = session.effects()[0]
    if (effect === undefined) {
      throw new Error('Expected a pending effect')
    }

    expect(await session.close().completion).toEqual({ kind: 'closed' })
    expect(session.effects()).toEqual([{ ...effect, status: 'cancelled' }])
    expect(session.ticketOutcome(effect.ticket)).toMatchObject({
      effect: { id: effect.id, status: 'cancelled' }
    })
    expect(await session.acknowledgeEffect(effect.id).completion).toEqual({
      kind: 'already-terminal',
      effect: effect.id,
      status: 'cancelled'
    })

    const recovered = await createDocumentSession(options)
    expect(recovered.effects()).toEqual([{ ...effect, status: 'cancelled' }])
    expect(recovered.ticketOutcome(effect.ticket)).toMatchObject({
      effect: { id: effect.id, status: 'cancelled' }
    })
    expect(recovered.status()).toBe('closed')
  })

  it('recovers exact retained input and its terminal rejected outcome', async() => {
    const storage = createMemoryDocumentSessionJournalStorage()
    const options = durableOptions('retained-draft', storage)
    const session = await createDocumentSession(options)
    const originalTarget = session.snapshot().revision.selection
    if (originalTarget === null) {
      throw new Error('Expected an initial selection')
    }
    expect((await session.dispatch({
      kind: 'insert-text',
      target: originalTarget,
      text: 'b'
    }).completion).kind).toBe('committed')

    const exactText = 'Z\r\n𝄞{++x++}'
    const stale = session.dispatch({
      kind: 'insert-text',
      target: originalTarget,
      text: exactText
    })
    const rejected = await stale.completion
    if (rejected.kind !== 'rejected' || rejected.retainedDraft === undefined) {
      throw new Error('Expected exact retained input')
    }

    const recovered = await createDocumentSession(options)
    expect(recovered.snapshot().pending).toEqual({
      status: 'blocked',
      retained: [rejected.retainedDraft]
    })
    expect(recovered.ticketOutcome(stale.id)).toMatchObject({
      kind: 'rejected',
      reason: 'stale-selection',
      retainedDraft: {
        text: exactText,
        target: originalTarget,
        ticketIds: [stale.id]
      }
    })
    expect(await recovered.cancel(stale.id).completion).toEqual({
      kind: 'already-terminal',
      ticket: stale.id,
      outcome: 'rejected'
    })
    expect(recovered.snapshot().pending.retained).toEqual([
      rejected.retainedDraft
    ])
  })
})
