import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type ParseConfiguration,
  type SourceModelSelection
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

async function openSession(source: string) {
  const session = await createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION
  })
  const authenticated = session.snapshot().revision.selection
  if (authenticated === null) {
    throw new Error('Expected an authenticated initial selection')
  }
  return { session, authenticated }
}

function rangeTarget(
  authenticated: { session: string; revision: string },
  start: number,
  end: number
): SourceModelSelection {
  return Object.freeze({
    session: authenticated.session,
    revision: authenticated.revision,
    view: 'source',
    anchor: { offset: start, affinity: 'next' as const },
    focus: { offset: end, affinity: 'previous' as const }
  }) as SourceModelSelection
}

describe('history replay exactness', () => {
  // ADR-0015: the engine authors no bytes the user did not type. Candidate
  // protection runs when an edit is first admitted; replaying an edit that was
  // already admitted and proved must reproduce its exact recorded bytes.
  it.each([
    { name: 'opening delimiter', source: '{++new++}\n', start: 2, end: 3 },
    { name: 'closing delimiter', source: '{++new++}\n', start: 8, end: 9 },
    { name: 'substitution separator', source: '{~~old~>new~~}\n', start: 6, end: 8 },
    { name: 'comment closer', source: 'a{>>note<<}b\n', start: 8, end: 9 }
  ])('restores exact source when an edit splits the $name', async({ source, start, end }) => {
    const { session, authenticated } = await openSession(source)
    const caret = { offset: start, affinity: 'next' as const }

    await session.dispatch({
      kind: 'edit-source',
      target: rangeTarget(authenticated, start, end),
      text: '',
      selection: { anchor: caret, focus: caret }
    }).completion
    const afterEdit = session.snapshot().revision.source
    expect(afterEdit).toBe(source.slice(0, start) + source.slice(end))

    await session.dispatch({ kind: 'undo' }).completion
    expect(session.snapshot().revision.source).toBe(source)

    await session.dispatch({ kind: 'redo' }).completion
    expect(session.snapshot().revision.source).toBe(afterEdit)

    await session.dispatch({ kind: 'undo' }).completion
    expect(session.snapshot().revision.source).toBe(source)
  })

  it('reports a document restored to its saved bytes as clean', async() => {
    const source = '{++new++}\n'
    const { session, authenticated } = await openSession(source)
    const persisted = session as unknown as {
      markPersisted: (headIdentity: string) => Promise<unknown>
    }
    await persisted.markPersisted(session.historyState().headIdentity)

    const caret = { offset: 2, affinity: 'next' as const }
    await session.dispatch({
      kind: 'edit-source',
      target: rangeTarget(authenticated, 2, 3),
      text: '',
      selection: { anchor: caret, focus: caret }
    }).completion
    expect(session.historyState()).toMatchObject({ dirty: true })

    await session.dispatch({ kind: 'undo' }).completion
    expect(session.snapshot().revision.source).toBe(source)
    expect(session.historyState()).toMatchObject({ dirty: false })
  })
})
