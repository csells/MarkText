import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type CompleteEditorSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'
import { hostedRunnerTimeout } from '../helpers/hostedRunnerTimeout.js'

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

  it('indexes and edits the accepted maximum-depth Review hierarchy iteratively', async() => {
    const depth = 16_384
    const source = `${'{++'.repeat(depth)}x${'++}'.repeat(depth)}`
    const session = await createDocumentSession({
      source: createSourceSnapshot(source),
      parseConfiguration: TEST_CONFIGURATION,
      initialSelection: {
        anchor: { offset: 1, affinity: 'previous' },
        focus: { offset: 1, affinity: 'previous' }
      }
    })
    const snapshot = session.snapshot()
    if (
      snapshot.kind !== 'complete' ||
      snapshot.revision.selection === null
    ) {
      throw new Error('Expected the maximum-depth Markup snapshot')
    }
    const first = snapshot.reviewIndex.items[0]
    const last = snapshot.reviewIndex.items.at(-1)

    expect(snapshot.reviewIndex.items).toHaveLength(depth)
    expect(first).toMatchObject({
      kind: 'addition',
      depth: 0,
      parent: null,
      modelRange: { start: 0, end: 1 }
    })
    expect(last).toMatchObject({
      kind: 'addition',
      depth: depth - 1,
      modelRange: { start: 0, end: 1 }
    })
    expect(last?.parent).toBe(snapshot.reviewIndex.items.at(-2)?.nodeId)

    await expect(session.dispatch({
      kind: 'insert-text',
      target: snapshot.revision.selection,
      text: '!'
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    const edited = session.snapshot()
    if (edited.kind !== 'complete') {
      throw new Error('Expected the edited maximum-depth Markup snapshot')
    }
    expect(edited.revision.source).toBe(
      `${'{++'.repeat(depth)}x!${'++}'.repeat(depth)}`
    )
    expect(edited.reviewIndex.items).toHaveLength(depth)
  }, hostedRunnerTimeout(30_000))

  it('publishes authoring and bulk-resolves through the accepted maximum depth iteratively', async() => {
    const depth = 16_384
    const session = await createDocumentSession({
      source: createSourceSnapshot(
        `${'{++'.repeat(depth)}x${'++}'.repeat(depth)}`
      ),
      parseConfiguration: TEST_CONFIGURATION,
      initialSelection: {
        anchor: { offset: 0, affinity: 'next' },
        focus: { offset: 1, affinity: 'previous' }
      }
    })
    const before = session.snapshot()
    if (before.kind !== 'complete') {
      throw new Error('Expected the maximum-depth Markup snapshot')
    }

    expect(before.reviewIndex.authoring).toMatchObject({
      canCreateAddition: true,
      canCreateDeletion: false,
      canCreateSubstitution: false,
      canCreateHighlight: true,
      canCreateComment: true
    })
    await expect(session.dispatch({
      kind: 'resolve-all-changes',
      decision: 'accept'
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    const after = session.snapshot()
    if (after.kind !== 'complete') {
      throw new Error('Expected the resolved maximum-depth Markup snapshot')
    }
    expect(after.revision.source).toBe('x')
    expect(after.reviewIndex.items).toEqual([])
  }, hostedRunnerTimeout(30_000))

  it('rejects all maximum-depth additions without subtree rescans', async() => {
    const depth = 16_384
    const session = await createDocumentSession({
      source: createSourceSnapshot(
        `${'{++'.repeat(depth)}x${'++}'.repeat(depth)}`
      ),
      parseConfiguration: TEST_CONFIGURATION
    })
    const startedAt = performance.now()

    await expect(session.dispatch({
      kind: 'resolve-all-changes',
      decision: 'reject'
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    const elapsedMs = performance.now() - startedAt

    expect(session.snapshot().revision.source).toBe('')
    expect(
      elapsedMs,
      `maximum-depth reject-all took ${elapsedMs.toFixed(3)}ms`
    ).toBeLessThanOrEqual(1_000)
  }, hostedRunnerTimeout(30_000))

  it('authors beside an untouched maximum-depth tree with linear scaling', async() => {
    // One-shot wall-clock ratios at these depths sit inside scheduler and GC
    // noise (healthy runs measure 2.0-2.5x), so linearity is pinned on the
    // engine's deterministic execution accounting: tracked work exactly
    // doubles when depth doubles, while a quadratic subtree rescan reports ~4x.
    const measure = async(depth: number): Promise<number> => {
      let trackedWork = 0
      const nested = `${'{++'.repeat(depth)}x${'++}'.repeat(depth)}`
      const session = await createDocumentSession({
        source: createSourceSnapshot(`${nested} tail`),
        parseConfiguration: TEST_CONFIGURATION,
        initialSelection: {
          anchor: { offset: 2, affinity: 'next' },
          focus: { offset: 6, affinity: 'previous' }
        },
        executionControl: {
          checkpoint(progress): void {
            trackedWork = progress.sourceUnits + progress.logicalNodes
          }
        }
      })
      const before = session.snapshot()
      if (
        before.kind !== 'complete' ||
        before.revision.selection === null
      ) {
        throw new Error('Expected the deep sibling authoring target')
      }

      const workBefore = trackedWork
      await expect(session.dispatch({
        kind: 'author-critic-markup',
        target: before.revision.selection,
        input: { kind: 'highlight' }
      }).completion).resolves.toMatchObject({ kind: 'committed' })
      const after = session.snapshot()
      if (after.kind !== 'complete') {
        throw new Error('Expected the authored deep sibling snapshot')
      }
      expect(after.revision.source).toBe(`${nested} {==tail==}`)
      expect(after.reviewIndex.items).toHaveLength(depth + 1)
      return trackedWork - workBefore
    }
    const lowerWork = await measure(8_192)
    const upperWork = await measure(16_384)

    expect(
      upperWork / Math.max(lowerWork, 1),
      `sibling-author lower=${lowerWork} upper=${upperWork} tracked units+nodes`
    ).toBeLessThanOrEqual(2.25)
  }, hostedRunnerTimeout(30_000))
})
