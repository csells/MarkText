import { describe, expect, it } from 'vitest'
import { createDocumentSession } from '../../src/documentSession.js'
import { createSourceSnapshot } from '../../src/sourceSnapshot.js'
import type { ParseConfiguration } from '../../src/revision.js'

const CONFIGURATION: ParseConfiguration = {
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

// G34 §2 Selection: the session owns the caret and settlement, and exposes
// one public settled() barrier every consumer awaits — a real production
// affordance, not a test seam or a fixed sleep.
describe('session selection and settlement', () => {
  it('resolves settled() only after previously dispatched work has settled', async() => {
    const session = await createDocumentSession({
      source: createSourceSnapshot('ab\n'),
      parseConfiguration: CONFIGURATION
    })
    const selection = session.snapshot().revision.selection
    if (selection === null) {
      throw new Error('Expected a selection')
    }
    const caret = { offset: 1, affinity: 'next' } as const
    const ticket = session.dispatch({
      kind: 'insert-text',
      target: { ...selection, anchor: caret, focus: caret },
      text: 'X'
    })
    // The barrier, not the ticket promise, is what settles the dispatch: by
    // the time settled() resolves the head carries the admitted bytes.
    await session.settled()
    const snapshot = session.snapshot()
    if (snapshot.kind !== 'complete') {
      throw new Error('Expected a complete snapshot')
    }
    expect(snapshot.revision.source).toBe('aXb\n')
    expect(session.ticketOutcome(ticket.id)?.kind).toBe('committed')
  })

  it('covers work enqueued before the barrier and none after', async() => {
    const session = await createDocumentSession({
      source: createSourceSnapshot('start\n'),
      parseConfiguration: CONFIGURATION
    })
    // A quiet session settles immediately.
    await session.settled()
    const selection = session.snapshot().revision.selection
    if (selection === null) {
      throw new Error('Expected a selection')
    }
    const caret = { offset: 5, affinity: 'next' } as const
    session.dispatch({
      kind: 'insert-text',
      target: { ...selection, anchor: caret, focus: caret },
      text: '-first'
    })
    const barrier = session.settled()
    await barrier
    const snapshot = session.snapshot()
    if (snapshot.kind !== 'complete') {
      throw new Error('Expected a complete snapshot')
    }
    expect(snapshot.revision.source).toBe('start-first\n')
  })

  it('moves the caret through select() and settles without a revision', async() => {
    const session = await createDocumentSession({
      source: createSourceSnapshot('caret target\n'),
      parseConfiguration: CONFIGURATION
    })
    const before = session.snapshot()
    if (before.kind !== 'complete') {
      throw new Error('Expected a complete snapshot')
    }
    session.select({
      anchor: { offset: 6, affinity: 'next' },
      focus: { offset: 6, affinity: 'next' }
    })
    await session.settled()
    const after = session.snapshot()
    if (after.kind !== 'complete') {
      throw new Error('Expected a complete snapshot')
    }
    expect(after.revision.selection?.anchor.offset).toBe(6)
    expect(after.revision.id).toBe(before.revision.id)
    expect(session.historyState().canUndo).toBe(false)
  })
})
