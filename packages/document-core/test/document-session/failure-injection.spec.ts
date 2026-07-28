import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createMemoryDocumentSessionJournalStorage,
  createSourceSnapshot,
  type DocumentSessionJournalStorage,
  type DocumentSessionJournalMutation,
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

describe('DocumentSession failure injection', () => {
  it('failure before commit changes nothing and rejects visibly', async() => {
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
        // Initialization and ingress succeed. Fail the one-shot precommit
        // barrier, then allow the visible rejected outcome to become durable.
        if (writes === 3) {
          return null
        }
        return retained.compareExchange(key, expectedRevision, mutation)
      }
    })
    const session = await createDocumentSession({
      source: createSourceSnapshot('ac'),
      parseConfiguration: TEST_CONFIGURATION,
      initialSelection: {
        anchor: { offset: 1, affinity: 'next' },
        focus: { offset: 1, affinity: 'next' }
      },
      durability: {
        key: 'precommit-failure',
        storage
      }
    })
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
    expect((await ticket.admission).kind).toBe('admitted')
    const result = await ticket.completion

    expect(result).toMatchObject({
      kind: 'rejected',
      reason: 'precommit-failed',
      snapshot: before,
      effect: {
        kind: 'dispatch-failure',
        ticket: ticket.id,
        code: 'precommit-failed',
        status: 'pending'
      }
    })
    expect(session.snapshot()).toBe(before)
    expect(session.snapshot().revision.source).toBe('ac')
    expect(transitions).toEqual([])
    expect(session.ticketOutcome(ticket.id)).toMatchObject({
      kind: 'rejected',
      reason: 'precommit-failed',
      revision: before.revision.id
    })
    expect(session.effects()).toEqual([
      expect.objectContaining({
        kind: 'dispatch-failure',
        ticket: ticket.id,
        status: 'pending'
      })
    ])

    // A rolled-back candidate must not have entered history.
    expect(await session.dispatch({ kind: 'undo' }).completion).toMatchObject({
      kind: 'rejected',
      reason: 'nothing-to-undo'
    })
  })
})
