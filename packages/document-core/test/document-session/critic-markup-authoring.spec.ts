import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type CriticMarkupAuthoringInput,
  type DocumentSession,
  type InitialModelSelection,
  type MarkupModelSelection,
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

function selection(start: number, end = start): InitialModelSelection {
  return Object.freeze({
    anchor: Object.freeze({ offset: start, affinity: 'next' as const }),
    focus: Object.freeze({
      offset: end,
      affinity: start === end ? 'next' as const : 'previous' as const
    })
  })
}

async function openSession(
  source: string,
  initialSelection: InitialModelSelection
): Promise<DocumentSession> {
  return createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION,
    initialSelection
  })
}

function targetOf(session: DocumentSession): MarkupModelSelection {
  const snapshot = session.snapshot()
  if (
    snapshot.kind !== 'complete' ||
    snapshot.revision.selection === null
  ) {
    throw new Error('Expected a complete Markup selection')
  }
  return snapshot.revision.selection
}

describe('DocumentSession CriticMarkup authoring', () => {
  it('authors one Addition from a Markup selection and undoes exactly', async() => {
    const source = 'word\n'
    const session = await openSession(source, selection(0, 4))
    const before = session.snapshot()
    const input: CriticMarkupAuthoringInput = { kind: 'addition' }

    await expect(session.dispatch({
      kind: 'author-critic-markup',
      target: targetOf(session),
      input
    }).completion).resolves.toMatchObject({
      kind: 'committed',
      transition: {
        cause: 'source-edit',
        history: 'record',
        before
      }
    })
    expect(session.snapshot().revision.source).toBe('{++word++}\n')

    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({
        kind: 'committed',
        transition: { cause: 'undo', history: 'none' }
      })
    expect(session.snapshot().revision.source).toBe(source)
    expect(session.snapshot().revision.selection).toMatchObject({
      anchor: before.revision.selection?.anchor,
      focus: before.revision.selection?.focus
    })
  })

  it.each([
    {
      input: { kind: 'deletion' } as const,
      expected: '{--word--}\n'
    },
    {
      input: {
        kind: 'substitution',
        replacement: 'term'
      } as const,
      expected: '{~~word~>term~~}\n'
    },
    {
      input: { kind: 'highlight' } as const,
      expected: '{==word==}\n'
    },
    {
      input: {
        kind: 'comment',
        comment: 'Clarify this.'
      } as const,
      expected: '{==word==}{>>Clarify this.<<}\n'
    }
  ])('authors $input.kind from one typed Markup selection', async({
    input,
    expected
  }) => {
    const source = 'word\n'
    const session = await openSession(source, selection(0, 4))
    const before = session.snapshot()

    await expect(session.dispatch({
      kind: 'author-critic-markup',
      target: targetOf(session),
      input
    }).completion).resolves.toMatchObject({
      kind: 'committed',
      transition: {
        cause: 'source-edit',
        history: 'record',
        before
      }
    })
    expect(session.snapshot().revision.source).toBe(expected)

    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({
        kind: 'committed',
        transition: { cause: 'undo', history: 'none' }
      })
    expect(session.snapshot().revision.source).toBe(source)
    expect(session.snapshot().revision.selection).toMatchObject({
      anchor: before.revision.selection?.anchor,
      focus: before.revision.selection?.focus
    })
  })

  it('protects delimiter-looking selected text inside the authored form', async() => {
    const source = 'a ++} b\r\n'
    const session = await openSession(source, selection(0, 7))

    await expect(session.dispatch({
      kind: 'author-critic-markup',
      target: targetOf(session),
      input: { kind: 'addition' }
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source)
      .toBe(String.raw`{++a ++\} b++}` + '\r\n')
  })

  it('protects both Substitution arms without changing the authoring EOL', async() => {
    const session = await openSession('old\r\n', selection(0, 3))

    await expect(session.dispatch({
      kind: 'author-critic-markup',
      target: targetOf(session),
      input: {
        kind: 'substitution',
        replacement: 'new ~> {-- marker ~~}'
      }
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(
      String.raw`{~~old~>new \~> \{-- marker ~~\}~~}` + '\r\n'
    )
  })

  it('preserves raw nested Comment input and CRLF spelling exactly', async() => {
    const source = 'word\r\n'
    const comment = 'outer\r\n{>>inner<<}\r\ntail'
    const session = await openSession(source, selection(0, 4))

    await expect(session.dispatch({
      kind: 'author-critic-markup',
      target: targetOf(session),
      input: { kind: 'comment', comment }
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source)
      .toBe(`{==word==}{>>${comment}<<}\r\n`)

    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe(source)
  })

  it('rejects every authoring command at a collapsed caret', async() => {
    const invalid = [
      {
        input: { kind: 'addition' } as const,
        reason: 'selection-collapsed'
      },
      {
        input: { kind: 'deletion' } as const,
        reason: 'selection-collapsed'
      },
      {
        input: {
          kind: 'substitution',
          replacement: ''
        } as const,
        reason: 'selection-collapsed'
      },
      {
        input: { kind: 'highlight' } as const,
        reason: 'selection-collapsed'
      },
      {
        input: {
          kind: 'comment',
          comment: 'note'
        } as const,
        reason: 'empty-comment-anchor'
      }
    ]
    for (const row of invalid) {
      const session = await openSession('word', selection(2))
      const before = session.snapshot()
      await expect(session.dispatch({
        kind: 'author-critic-markup',
        target: targetOf(session),
        input: row.input
      }).completion).resolves.toMatchObject({
        kind: 'rejected',
        reason: row.reason,
        snapshot: before
      })
      expect(session.snapshot()).toBe(before)
      await expect(session.dispatch({ kind: 'undo' }).completion)
        .resolves.toMatchObject({
          kind: 'rejected',
          reason: 'nothing-to-undo',
          snapshot: before
        })
    }
  })

  it.each([
    {
      source: 'word',
      selection: selection(0, 4),
      input: { kind: 'comment', comment: '   ' } as const,
      reason: 'empty-comment'
    },
    {
      source: 'word',
      selection: selection(0, 4),
      input: {
        kind: 'comment',
        comment: 'premature <<} tail'
      } as const,
      reason: 'invalid-comment-payload'
    },
    {
      source: '`code`',
      selection: selection(1, 5),
      input: { kind: 'highlight' } as const,
      expected: '{==`code`==}'
    },
    {
      source: '{==word==} tail',
      selection: selection(2, 6),
      input: { kind: 'deletion' } as const,
      reason: 'selection-partially-intersects-critic-markup'
    },
    {
      source: 'first {>>hidden<<} tail',
      selection: selection(0, 11),
      input: { kind: 'highlight' } as const,
      reason: 'selection-includes-hidden-comment'
    }
  ])('handles classified $input.kind authoring without ambiguity', async(row) => {
    const session = await openSession(row.source, row.selection)
    const before = session.snapshot()

    const result = await session.dispatch({
      kind: 'author-critic-markup',
      target: targetOf(session),
      input: row.input
    }).completion
    if ('expected' in row) {
      expect(result).toMatchObject({ kind: 'committed' })
      expect(session.snapshot().revision.source).toBe(row.expected)
      return
    }
    expect(result).toMatchObject({
      kind: 'rejected',
      reason: row.reason,
      snapshot: before
    })
    expect(session.snapshot()).toBe(before)
    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({
        kind: 'rejected',
        reason: 'nothing-to-undo',
        snapshot: before
      })
  })
})
