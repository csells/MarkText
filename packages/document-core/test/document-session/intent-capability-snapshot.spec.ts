import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type DocumentSession,
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

const SNAPSHOT_EVALUABLE_REASONS = new Set([
  'read-only-projection',
  'source-only-revision',
  'nothing-to-undo',
  'nothing-to-redo'
])

async function open(source: string): Promise<DocumentSession> {
  return await createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION
  })
}

function caretAtEnd(session: DocumentSession) {
  const selection = session.snapshot().revision.selection
  const offset = session.snapshot().revision.source.length
  return Object.freeze({
    ...selection,
    anchor: Object.freeze({ offset, affinity: 'next' as const }),
    focus: Object.freeze({ offset, affinity: 'next' as const })
  })
}

// G8/G5: the capability snapshot is the one record availability reads. Its
// contract is two-sided — a disabled entry names the exact rejection a
// dispatch returns right now, and an enabled entry may only reject for a
// reason the snapshot never evaluates.
describe('intent capability snapshot', () => {
  it('covers every union arm', async() => {
    const session = await open('Alpha beta.\n')
    const capabilities = session.capabilities()
    expect(Object.keys(capabilities).length).toBeGreaterThanOrEqual(43)
    for (const capability of Object.values(capabilities)) {
      if (!capability.enabled) {
        expect(SNAPSHOT_EVALUABLE_REASONS.has(capability.reason)).toBe(true)
      }
    }
  })

  it('predicts history exhaustion exactly', async() => {
    const session = await open('Alpha beta.\n')
    expect(session.capabilities().undo).toEqual({
      enabled: false,
      reason: 'nothing-to-undo'
    })
    expect(session.capabilities().redo).toEqual({
      enabled: false,
      reason: 'nothing-to-redo'
    })
    await expect(
      session.dispatch({ kind: 'undo' }).completion
    ).resolves.toMatchObject({ kind: 'rejected', reason: 'nothing-to-undo' })

    await expect(session.dispatch({
      kind: 'insert-text',
      target: caretAtEnd(session),
      text: 'x'
    }).completion).resolves.toMatchObject({ kind: 'committed' })

    expect(session.capabilities().undo).toEqual({ enabled: true })
    expect(session.capabilities().redo).toEqual({
      enabled: false,
      reason: 'nothing-to-redo'
    })
    await expect(
      session.dispatch({ kind: 'redo' }).completion
    ).resolves.toMatchObject({ kind: 'rejected', reason: 'nothing-to-redo' })
    await expect(
      session.dispatch({ kind: 'undo' }).completion
    ).resolves.toMatchObject({ kind: 'committed' })
  })

  it('predicts the read-only projection for every revision intent', async() => {
    const session = await open('Alpha {++beta++}.\n')
    await expect(session.dispatch({
      kind: 'set-projection',
      projection: 'original'
    }).completion).resolves.toMatchObject({ kind: 'state-changed' })

    const capabilities = session.capabilities()
    expect(capabilities['insert-text']).toEqual({
      enabled: false,
      reason: 'read-only-projection'
    })
    expect(capabilities['resolve-all-changes']).toEqual({
      enabled: false,
      reason: 'read-only-projection'
    })
    // Session-state intents stay available in a read-only projection —
    // that is how the user returns to the editable view.
    expect(capabilities['set-projection']).toEqual({ enabled: true })
    expect(capabilities['set-track-changes']).toEqual({ enabled: true })

    await expect(session.dispatch({
      kind: 'insert-text',
      target: caretAtEnd(session),
      text: 'x'
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'read-only-projection'
    })
    await expect(session.dispatch({
      kind: 'set-projection',
      projection: 'marked'
    }).completion).resolves.toMatchObject({ kind: 'state-changed' })
    expect(session.capabilities()['insert-text']).toEqual({ enabled: true })
  })

  it('never rejects an enabled intent for a snapshot-evaluable reason', async() => {
    const session = await open('Alpha beta.\n')
    const capabilities = session.capabilities()
    // resolve-change is enabled by the snapshot (marked, complete) but has
    // no resolvable node here: the rejection must be prepare-only.
    expect(capabilities['resolve-change']).toEqual({ enabled: true })
    const outcome = await session.dispatch({
      kind: 'resolve-change',
      target: 'node:absent' as never,
      decision: 'accept'
    }).completion
    expect(outcome.kind).toBe('rejected')
    if (outcome.kind === 'rejected') {
      expect(SNAPSHOT_EVALUABLE_REASONS.has(outcome.reason)).toBe(false)
    }
  })
})
