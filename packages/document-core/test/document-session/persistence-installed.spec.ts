import { describe, expect, it } from 'vitest'
import { createDocumentSession } from '../../src/documentSession.js'
import { createSourceSnapshot } from '../../src/sourceSnapshot.js'
import type { CanonicalSourceLease } from '../../src/documentSession.js'
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

async function openWithLease(source: string): Promise<Readonly<{
  session: Awaited<ReturnType<typeof createDocumentSession>>
  lease: CanonicalSourceLease
}>> {
  const session = await createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: CONFIGURATION
  })
  // Dirty the session first: durability confirmation is only observable on a
  // document whose bytes differ from the last saved identity.
  const selection = session.snapshot().revision.selection
  if (selection === null) {
    throw new Error('Expected a selection')
  }
  const caret = { offset: 0, affinity: 'next' } as const
  session.dispatch({
    kind: 'insert-text',
    target: { ...selection, anchor: caret, focus: caret },
    text: 'edited '
  })
  await session.settled()
  const flushed = await session.preparePersistence('save').completion
  if (flushed.kind !== 'flushed') {
    throw new Error(`Expected a flushed lease, got ${flushed.kind}`)
  }
  return Object.freeze({ session, lease: flushed.source })
}

// G34 §2 persistence lease: durability is confirmed against the held lease —
// installed(lease) — never inferred from a successful callback or reported
// through an identity side-channel.
describe('persistence installed(lease)', () => {
  it('marks the leased revision persisted through the held lease', async() => {
    const { session, lease } = await openWithLease('persist me\n')
    expect(session.historyState().dirty).toBe(true)
    const state = await session.installed(lease)
    expect(state.dirty).toBe(false)
    expect(session.historyState().dirty).toBe(false)
    const released = await lease.release('consumer-finished').completion
    expect(released.kind).toBe('released')
  })

  it('rejects a lease the session never minted', async() => {
    const { session, lease } = await openWithLease('mine\n')
    const foreign = await openWithLease('theirs\n')
    await expect(session.installed(foreign.lease)).rejects.toThrow(/lease/i)
    // A hand-built object with the right shape is not an authentic lease.
    const forged = {
      ...lease,
      id: lease.id
    } as CanonicalSourceLease
    await expect(session.installed(forged)).rejects.toThrow(/lease/i)
    await session.installed(lease)
  })

  it('rejects a released lease instead of confirming stale durability', async() => {
    const { session, lease } = await openWithLease('short lived\n')
    const released = await lease.release('consumer-finished').completion
    expect(released.kind).toBe('released')
    // A released lease leaves the ledger entirely; it can prove nothing.
    await expect(session.installed(lease)).rejects.toThrow(/lease/i)
    expect(session.historyState().dirty).toBe(true)
  })
})
