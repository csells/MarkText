import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type CompleteEditorSnapshot,
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

async function snapshotOf(source: string): Promise<CompleteEditorSnapshot> {
  const session = await createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION
  })
  const snapshot = session.snapshot()
  if (snapshot.kind !== 'complete') {
    throw new Error('Expected a complete snapshot')
  }
  return snapshot
}

describe('DocumentSession Review index', () => {
  it('serializes parser-owned Review hierarchy, displays, and Commented spans', async() => {
    const source =
      'A {++new++} {==anchor==}{>>note {++new++} {--old--}<<} {--gone--}'
    const snapshot = await snapshotOf(source)
    const review = snapshot.reviewIndex

    expect(JSON.parse(JSON.stringify(review))).toEqual(review)
    expect(review.items.map((item) => item.kind)).toEqual([
      'addition',
      'highlight',
      'comment',
      'addition',
      'deletion',
      'deletion'
    ])

    const outerAddition = review.items[0]
    const highlight = review.items[1]
    const comment = review.items[2]
    const nestedAddition = review.items[3]
    const nestedDeletion = review.items[4]
    const outerDeletion = review.items[5]
    if (
      outerAddition === undefined ||
      highlight === undefined ||
      comment === undefined ||
      nestedAddition === undefined ||
      nestedDeletion === undefined ||
      outerDeletion === undefined
    ) {
      throw new Error('Expected the complete Review fixture')
    }

    expect(outerAddition).toMatchObject({
      depth: 0,
      parent: null,
      modelRange: { start: 2, end: 5 }
    })
    expect(highlight).toMatchObject({
      depth: 0,
      parent: null,
      modelRange: { start: 6, end: 12 }
    })
    expect(comment).toMatchObject({
      depth: 0,
      parent: null,
      modelRange: null,
      commentRevisedText: 'note new '
    })
    expect(nestedAddition).toMatchObject({
      depth: 1,
      parent: comment.nodeId,
      modelRange: null
    })
    expect(nestedDeletion).toMatchObject({
      depth: 1,
      parent: comment.nodeId,
      modelRange: null
    })
    expect(outerDeletion).toMatchObject({
      depth: 0,
      parent: null,
      modelRange: { start: 13, end: 17 }
    })

    expect(review.commentedSpans).toEqual([
      {
        highlight: highlight.nodeId,
        comment: comment.nodeId,
        sourceRange: {
          start: highlight.sourceRange.start,
          end: comment.sourceRange.end
        },
        modelRange: highlight.modelRange
      }
    ])
  })

  it('does not pair a Highlight absent from the root Revised view', async() => {
    const snapshot = await snapshotOf(
      '{--{==hidden==}{>>note<<}--}'
    )
    expect(snapshot.reviewIndex.items.map((item) => item.kind)).toEqual([
      'deletion',
      'highlight',
      'comment'
    ])
    expect(snapshot.reviewIndex.commentedSpans).toEqual([])
  })

  it('publishes both exact Substitution arm payloads', async() => {
    const snapshot = await snapshotOf(
      '{~~old {--nested--}~>new {++nested++}~~}'
    )
    const substitution = snapshot.reviewIndex.items[0]

    expect(substitution).toMatchObject({
      kind: 'substitution',
      oldContent: 'old {--nested--}',
      newContent: 'new {++nested++}',
      commentRevisedText: null
    })
    expect(JSON.parse(JSON.stringify(substitution))).toEqual(substitution)
  })

  it('publishes a deterministic Markup focus handoff for invisible point Comments', async() => {
    const snapshot = await snapshotOf('A{>>between<<}B{>>after<<}')
    const comments = snapshot.reviewIndex.items.filter(
      (item) => item.kind === 'comment'
    )

    expect(comments).toMatchObject([
      { modelRange: null, focusOffset: 1 },
      { modelRange: null, focusOffset: 2 }
    ])
  })
})
