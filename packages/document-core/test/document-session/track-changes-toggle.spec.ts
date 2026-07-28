import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createMemoryDocumentSessionJournalStorage,
  createSourceSnapshot,
  type DocumentSession,
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

function targetOf(session: DocumentSession) {
  const target = session.snapshot().revision.selection
  if (target === null) {
    throw new Error('Expected a Markup selection')
  }
  return target
}

describe('DocumentSession Track Changes state', () => {
  it('toggles durably without committing a revision or history entry', async() => {
    const storage = createMemoryDocumentSessionJournalStorage()
    const options: DocumentSessionOpenOptions = {
      source: createSourceSnapshot('ab'),
      parseConfiguration: TEST_CONFIGURATION,
      trackChanges: false,
      initialSelection: {
        anchor: { offset: 1, affinity: 'next' },
        focus: { offset: 1, affinity: 'next' }
      },
      durability: {
        key: 'track-changes-toggle',
        storage
      }
    }
    const session = await createDocumentSession(options)
    expect(session.snapshot().configuration.trackChanges).toBe(false)
    const before = session.snapshot()
    const transitions: SessionTransition[] = []
    session.subscribe((transition) => {
      transitions.push(transition)
    })

    const toggle = session.dispatch({
      kind: 'set-track-changes',
      enabled: true
    })
    await expect(toggle.completion).resolves.toMatchObject({
      kind: 'state-changed',
      transition: {
        kind: 'session-state-changed',
        coalescing: 'break',
        before: {
          configuration: { trackChanges: false }
        },
        after: {
          configuration: { trackChanges: true }
        }
      }
    })
    expect(session.snapshot().revision.id).toBe(before.revision.id)
    expect(session.snapshot().revision.source).toBe('ab')
    expect(session.ticketOutcome(toggle.id)).toMatchObject({
      kind: 'state-changed',
      trackChanges: true,
      revision: before.revision.id
    })
    expect(transitions).toHaveLength(1)
    expect(transitions[0]?.kind).toBe('session-state-changed')
    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({
        kind: 'rejected',
        reason: 'nothing-to-undo'
      })

    const trackedInsert = session.dispatch({
      kind: 'insert-text',
      target: targetOf(session),
      text: 'x'
    })
    await expect(trackedInsert.completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe('a{++x++}b')
    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe('ab')

    const recovered = await createDocumentSession(options)
    expect(recovered.snapshot().configuration.trackChanges).toBe(true)
    const recoveredInsert = recovered.dispatch({
      kind: 'insert-text',
      target: targetOf(recovered),
      text: 'y'
    })
    await expect(recoveredInsert.completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(recovered.snapshot().revision.source).toBe('a{++y++}b')

    const disable = recovered.dispatch({
      kind: 'set-track-changes',
      enabled: false
    })
    await expect(disable.completion).resolves.toMatchObject({
      kind: 'state-changed'
    })
    await expect(recovered.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(recovered.snapshot().revision.source).toBe('ab')
    expect(recovered.snapshot().configuration.trackChanges).toBe(false)
    const directInsert = recovered.dispatch({
      kind: 'insert-text',
      target: targetOf(recovered),
      text: 'z'
    })
    await expect(directInsert.completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(recovered.snapshot().revision.source).toBe('azb')
  })
})
