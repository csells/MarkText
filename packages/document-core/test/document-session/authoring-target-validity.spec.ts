import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createLanguageEngine,
  createSourceSnapshot,
  createTransformationKernel,
  criticMarkupAuthoringCapabilities,
  type CompleteDocumentRevision,
  type CriticMarkupAuthoringInput,
  type DocumentSession,
  type InitialModelSelection,
  type MarkupModelSelection,
  type ParseConfiguration,
  type SourceOffset,
  type SourceRange
} from '@marktext/document-core'

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
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

function selection(start: number, end = start): InitialModelSelection {
  return Object.freeze({
    anchor: Object.freeze({
      offset: start,
      affinity: 'next' as const
    }),
    focus: Object.freeze({
      offset: end,
      affinity: start === end ? 'next' as const : 'previous' as const
    })
  })
}

function sourceRange(start: number, end: number): SourceRange {
  return Object.freeze({
    start: start as SourceOffset,
    end: end as SourceOffset
  })
}

async function openSession(
  source: string,
  target: InitialModelSelection
): Promise<DocumentSession> {
  return await createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: CONFIGURATION,
    initialSelection: target
  })
}

function targetOf(session: DocumentSession): MarkupModelSelection {
  const snapshot = session.snapshot()
  if (
    snapshot.kind !== 'complete' ||
    snapshot.revision.selection === null
  ) {
    throw new Error('Expected an authenticated Markup selection')
  }
  return snapshot.revision.selection
}

function openRevision(source: string): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete revision')
  }
  return revision
}

async function author(
  session: DocumentSession,
  input: CriticMarkupAuthoringInput
) {
  return await session.dispatch({
    kind: 'author-critic-markup',
    target: targetOf(session),
    input
  }).completion
}

describe('parser-owned CriticMarkup authoring targets', () => {
  it.each([
    {
      name: 'complete nested CriticMarkup for Add Comment',
      source: 'A {++nested++} Z',
      target: selection(2, 8),
      input: {
        kind: 'comment',
        comment: 'nested note'
      } as const,
      expected: 'A {=={++nested++}==}{>>nested note<<} Z'
    },
    {
      name: 'complete nested CriticMarkup for Highlight',
      source: 'A {--old--} Z',
      target: selection(2, 5),
      input: { kind: 'highlight' } as const,
      expected: 'A {=={--old--}==} Z'
    },
    {
      name: 'complete inline-code owner for Add Comment',
      source: 'A `code` Z',
      target: selection(3, 7),
      input: {
        kind: 'comment',
        comment: 'literal note'
      } as const,
      expected: 'A {==`code`==}{>>literal note<<} Z'
    },
    {
      name: 'complete inline-code owner for Highlight',
      source: 'A `code` Z',
      target: selection(3, 7),
      input: { kind: 'highlight' } as const,
      expected: 'A {==`code`==} Z'
    },
    {
      name: 'complete Substitution with a Revised contribution',
      source: 'A {~~old~>new~~} Z',
      target: selection(2, 8),
      input: {
        kind: 'comment',
        comment: 'replacement note'
      } as const,
      expected:
        'A {=={~~old~>new~~}==}{>>replacement note<<} Z'
    }
  ])('widens and preserves $name with exact undo', async(row) => {
    const session = await openSession(row.source, row.target)
    const beforeSelection = targetOf(session)

    await expect(author(session, row.input)).resolves.toMatchObject({
      kind: 'committed',
      transition: {
        cause: 'source-edit',
        history: 'record'
      }
    })
    expect(session.snapshot().revision.source).toBe(row.expected)

    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({
        kind: 'committed',
        transition: {
          cause: 'undo',
          history: 'none'
        }
      })
    expect(session.snapshot().revision.source).toBe(row.source)
    expect(session.snapshot().revision.selection).toMatchObject({
      anchor: beforeSelection.anchor,
      focus: beforeSelection.focus
    })
  })

  it.each([
    {
      name: 'collapsed',
      source: 'word',
      target: selection(2),
      input: { kind: 'comment', comment: 'note' } as const,
      reason: 'empty-comment-anchor'
    },
    {
      name: 'hidden Comment',
      source: 'first {>>hidden<<} tail',
      target: selection(0, 'first  tail'.length),
      input: { kind: 'comment', comment: 'note' } as const,
      reason: 'selection-includes-hidden-comment'
    },
    {
      name: 'partially intersected CriticMarkup',
      source: 'A {++nested++} Z',
      target: selection(4, 10),
      input: { kind: 'comment', comment: 'note' } as const,
      reason: 'selection-partially-intersects-critic-markup'
    },
    {
      name: 'crossed Substitution arms',
      source: 'A {~~old~>new~~} Z',
      target: selection(3, 7),
      input: { kind: 'comment', comment: 'note' } as const,
      reason: 'selection-crosses-syntax-boundary'
    },
    {
      name: 'inside a Markdown literal',
      source: 'A `code` Z',
      target: selection(4, 6),
      input: { kind: 'comment', comment: 'note' } as const,
      reason: 'selection-inside-markdown-literal'
    },
    {
      name: 'partially intersected Markdown literal',
      source: 'A before `code` Z',
      target: selection(2, 11),
      input: { kind: 'comment', comment: 'note' } as const,
      reason: 'selection-partially-intersects-markdown-literal'
    },
    {
      name: 'zero root-Revised contribution',
      source: 'A {--gone--} Z',
      target: selection(2, 6),
      input: { kind: 'comment', comment: 'note' } as const,
      reason: 'selection-has-no-revised-contribution'
    },
    {
      name: 'zero root-Original contribution',
      source: 'A {++new++} Z',
      target: selection(2, 5),
      input: { kind: 'deletion' } as const,
      reason: 'selection-has-no-original-contribution'
    }
  ])('rejects $name without source or history', async(row) => {
    const session = await openSession(row.source, row.target)
    const before = session.snapshot()

    await expect(author(session, row.input)).resolves.toMatchObject({
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

  it('rejects a source-only literal target without opening an authoring hole', () => {
    for (const row of [
      {
        source: '[ref]: /url\n',
        range: sourceRange(0, 12)
      },
      {
        source: '---\nx: y\n---\n',
        range: sourceRange(0, 13)
      },
      {
        source: '[label](/url)',
        range: sourceRange(7, 13)
      }
    ]) {
      const revision = openRevision(row.source)
      const result = createTransformationKernel().author(
        revision,
        row.range,
        { kind: 'comment', comment: 'note' }
      )

      expect(result).toMatchObject({
        kind: 'rejected',
        reason: 'markdown-literal-source-only',
        revision
      })
      expect(result.revision).toBe(revision)
    }
  })

  it('classifies plain Markdown from ownership without traversing its projection', () => {
    const revision = openRevision('plain Markdown')
    const projection = (): never => {
      throw new Error('plain authoring classification traversed the projection')
    }
    const plainRevision: CompleteDocumentRevision = Object.freeze({
      ...revision,
      projection
    })

    expect(criticMarkupAuthoringCapabilities(
      plainRevision,
      sourceRange(0, 5)
    )).toEqual({
      canCreateAddition: true,
      canCreateDeletion: true,
      canCreateSubstitution: true,
      canCreateHighlight: true,
      canCreateComment: true
    })
  })

  it.each([
    {
      name: 'inline code',
      source: 'A `code` Z',
      range: sourceRange(3, 7),
      expected: 'A {==`code`==} Z'
    },
    {
      name: 'inline math',
      source: '$x+1$',
      range: sourceRange(1, 4),
      expected: '{==$x+1$==}'
    },
    {
      name: 'autolink',
      source: '<https://x.dev>',
      range: sourceRange(1, 14),
      expected: '{==<https://x.dev>==}'
    },
    {
      name: 'fenced code',
      source: '```js\nx\n```\n',
      range: sourceRange(6, 8),
      expected: '{==```js\nx\n```\n==}'
    },
    {
      name: 'indented code',
      source: '    one\n    two\n',
      range: sourceRange(4, 16),
      expected: '{==    one\n    two\n==}'
    },
    {
      name: 'HTML block',
      source: '<div>\nhi\n</div>\n',
      range: sourceRange(0, 16),
      expected: '{==<div>\nhi\n</div>\n==}'
    },
    {
      name: 'inline HTML',
      source: '<b>hi',
      range: sourceRange(0, 3),
      expected: '{==<b>==}hi'
    },
    {
      name: 'diagram',
      source: '```mermaid\ngraph TD\n```\n',
      range: sourceRange(11, 20),
      expected: '{==```mermaid\ngraph TD\n```\n==}'
    }
  ])('widens the complete visible $name owner', (row) => {
    const revision = openRevision(row.source)
    const result = createTransformationKernel().author(
      revision,
      row.range,
      { kind: 'highlight' }
    )

    expect(result).toMatchObject({
      kind: 'committed',
      revision: {
        source: {
          text: row.expected
        }
      }
    })
  })

  it('closes nested literal and CriticMarkup owners without inferred overlap', () => {
    const source = 'A {++`code`++} Z'
    const revision = openRevision(source)
    const result = createTransformationKernel().author(
      revision,
      sourceRange(6, 10),
      { kind: 'highlight' }
    )

    expect(result).toMatchObject({
      kind: 'committed',
      revision: {
        source: {
          text: 'A {=={++`code`++}==} Z'
        }
      }
    })
  })

  it('rejects an authenticated target after its revision becomes stale', async() => {
    const session = await openSession('word', selection(0, 4))
    const stale = targetOf(session)
    await expect(author(session, { kind: 'highlight' }))
      .resolves.toMatchObject({ kind: 'committed' })
    const beforeRejected = session.snapshot()

    await expect(session.dispatch({
      kind: 'author-critic-markup',
      target: stale,
      input: {
        kind: 'comment',
        comment: 'stale note'
      }
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'stale-selection',
      snapshot: beforeRejected
    })
    expect(session.snapshot()).toBe(beforeRejected)

    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(session.snapshot().revision.source).toBe('word')
    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({
        kind: 'rejected',
        reason: 'nothing-to-undo'
      })
  })
})
