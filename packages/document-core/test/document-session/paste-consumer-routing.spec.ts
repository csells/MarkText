import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type DocumentSession,
  type InitialModelSelection,
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

function caret(offset: number): InitialModelSelection {
  return Object.freeze({
    anchor: Object.freeze({ offset, affinity: 'next' as const }),
    focus: Object.freeze({ offset, affinity: 'next' as const })
  })
}

function sessionTarget(session: DocumentSession) {
  const target = session.snapshot().revision.selection
  if (target === null) {
    throw new Error('Expected an editable Markup selection')
  }
  return target
}

async function openSession(
  source: string,
  trackChanges = false
): Promise<DocumentSession> {
  return createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION,
    trackChanges,
    initialSelection: caret(1)
  })
}

/**
 * The paste question belongs to the consumer policy: classifyPasteConsumer
 * owns which payload flavors import raw syntax, which are semantic edits,
 * and which views may accept a paste at all. These rows pin the session's
 * dispatch to the policy's answers, so production cannot classify by hand.
 */
describe('paste routes through the consumer policy', () => {
  it('imports a private-source payload as raw CriticMarkup syntax', async() => {
    const session = await openSession('ab\n')
    const result = await session.dispatch({
      kind: 'paste-text',
      target: sessionTarget(session),
      payload: { kind: 'private-source', text: '{++x++}' }
    }).completion

    expect(result).toMatchObject({ kind: 'committed' })
    const snapshot = session.snapshot()
    if (snapshot.kind !== 'complete') throw new Error('Expected a complete snapshot')
    expect(snapshot.revision.source).toBe('a{++x++}b\n')
    // The marker parsed: it enumerates as a Review item.
    expect(snapshot.reviewIndex.items).toHaveLength(1)
    expect(snapshot.reviewIndex.items[0]?.kind).toBe('addition')
  })

  it('imports a markdown payload as raw syntax too', async() => {
    const session = await openSession('ab\n')
    const result = await session.dispatch({
      kind: 'paste-text',
      target: sessionTarget(session),
      payload: { kind: 'markdown', text: '*em*' }
    }).completion

    expect(result).toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe('a*em*b\n')
  })

  it('routes external text as a semantic edit: tracked paste escapes marker spelling', async() => {
    const session = await openSession('ab\n', true)
    const result = await session.dispatch({
      kind: 'paste-text',
      target: sessionTarget(session),
      payload: { kind: 'external-text', text: '{--z--}' }
    }).completion

    expect(result).toMatchObject({ kind: 'committed' })
    const snapshot = session.snapshot()
    if (snapshot.kind !== 'complete') throw new Error('Expected a complete snapshot')
    // Semantic text under Track Changes lands inside the tracked insertion
    // carrier with its marker spelling escaped: one addition enumerates and
    // no deletion does — the pasted braces never become syntax.
    expect(snapshot.reviewIndex.items.map((item) => item.kind)).toEqual([
      'addition'
    ])
  })

  it('refuses a paste while a read-only projection is displayed', async() => {
    const session = await openSession('ab\n')
    const target = sessionTarget(session)
    const shown = await session.dispatch({
      kind: 'set-projection',
      projection: 'original'
    }).completion
    expect(shown).toMatchObject({ kind: 'state-changed' })

    // Only the mounted view's contenteditable gate stood here before: the
    // engine accepted a paste dispatched against a read-only projection.
    // The policy's answer is authoritative for every caller, including a
    // forged or racing dispatch.
    const result = await session.dispatch({
      kind: 'paste-text',
      target,
      payload: { kind: 'external-text', text: 'x' }
    }).completion

    expect(result).toMatchObject({
      kind: 'rejected',
      reason: 'read-only-projection'
    })
    expect(session.snapshot().revision.source).toBe('ab\n')
  })
})
