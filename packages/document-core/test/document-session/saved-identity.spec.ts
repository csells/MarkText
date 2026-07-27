import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
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

describe('saved identity', () => {
  // Saved identity is the identity by which a revision is recognized as the one
  // on disk. It is content-addressed: two revisions holding the same canonical
  // source are the same saved state no matter what path the history took to
  // reach them.
  it('reports a document typed back to its saved bytes as clean', async() => {
    const source = 'alpha bravo\n'
    const session = await createDocumentSession({
      source: createSourceSnapshot(source),
      parseConfiguration: TEST_CONFIGURATION
    })
    const persisted = session as unknown as {
      markPersisted: (headIdentity: string) => Promise<unknown>
    }
    await persisted.markPersisted(session.historyState().headIdentity)
    expect(session.historyState()).toMatchObject({ dirty: false })

    const target = session.snapshot().revision.selection
    if (target === null) throw new Error('Expected an authenticated selection')
    const caret = { offset: source.indexOf('bravo'), affinity: 'next' as const }
    await session.dispatch({
      kind: 'insert-text',
      target: { ...target, anchor: caret, focus: caret },
      text: 'X'
    }).completion
    expect(session.snapshot().revision.source).toBe('alpha Xbravo\n')
    expect(session.historyState()).toMatchObject({ dirty: true })

    const afterInsert = session.snapshot().revision.selection
    if (afterInsert === null) throw new Error('Expected a selection after insert')
    const inserted = 'alpha Xbravo\n'.indexOf('X')
    await session.dispatch({
      kind: 'delete-text',
      target: {
        ...afterInsert,
        anchor: { offset: inserted, affinity: 'next' as const },
        focus: { offset: inserted + 1, affinity: 'previous' as const }
      }
    }).completion

    // The bytes are exactly the saved bytes again, reached by a forward edit
    // rather than by undo, so history sits two entries past where it was saved.
    expect(session.snapshot().revision.source).toBe(source)
    expect(session.historyState()).toMatchObject({ dirty: false })
  })
})
