import { describe, expect, it } from 'vitest'
import {
  createDocumentSession,
  createSourceSnapshot,
  type DocumentSession,
  type InitialModelSelection,
  type ParseConfiguration,
  type ReviewIndexItem
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

const SELECTION: InitialModelSelection = Object.freeze({
  anchor: Object.freeze({ offset: 0, affinity: 'next' as const }),
  focus: Object.freeze({ offset: 0, affinity: 'next' as const })
})

async function open(source: string): Promise<DocumentSession> {
  return createDocumentSession({
    source: createSourceSnapshot(source),
    parseConfiguration: TEST_CONFIGURATION,
    initialSelection: SELECTION
  })
}

function source(session: DocumentSession): string {
  const snapshot = session.snapshot()
  if (snapshot.kind !== 'complete') {
    throw new Error('Expected a complete snapshot')
  }
  return snapshot.revision.source
}

function item(
  session: DocumentSession,
  predicate: (item: ReviewIndexItem) => boolean
): ReviewIndexItem {
  const snapshot = session.snapshot()
  if (snapshot.kind !== 'complete') {
    throw new Error('Expected a complete snapshot')
  }
  const found = snapshot.reviewIndex.items.find(predicate)
  if (found === undefined) {
    throw new Error('Expected a matching Review item')
  }
  return found
}

// G35: a Comment payload is an isolated subdocument that Original and Revised
// omit, and the vision's non-goal says comments are preserved exactly and
// never interpreted. CriticMarkup spelled inside a comment is the reviewer's
// prose — quoting a suggestion, not making one — so no resolution gesture may
// rewrite it.
describe('comment payloads are not resolution targets', () => {
  it('rejects resolving an addition nested in a comment payload', async() => {
    const before = 'x {>>see {++this++} and more<<} y\n'
    const session = await open(before)
    const nested = item(
      session,
      (candidate) => candidate.kind === 'addition' && candidate.depth > 0
    )

    await expect(session.dispatch({
      kind: 'resolve-change',
      target: nested.nodeId,
      decision: 'accept'
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'comment-payload-target'
    })
    expect(source(session)).toBe(before)
  })

  it('leaves comment payloads untouched under resolve-all-changes', async() => {
    const before = 'a {++real++} b {>>see {--quoted--} here<<} c\n'
    const session = await open(before)

    await expect(session.dispatch({
      kind: 'resolve-all-changes',
      decision: 'accept'
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(source(session)).toBe('a real b {>>see {--quoted--} here<<} c\n')
  })

  it('does not commit a resolve-all whose only change is comment prose', async() => {
    const before = 'x {>>see {++this++} and more<<} y\n'
    const session = await open(before)

    await expect(session.dispatch({
      kind: 'resolve-all-changes',
      decision: 'accept'
    }).completion).resolves.toMatchObject({ kind: 'rejected' })
    expect(source(session)).toBe(before)
  })

  it('rejects removing a highlight quoted in a comment payload', async() => {
    const before = 'x {>>see {==quoted==} here<<} y\n'
    const session = await open(before)
    const nested = item(
      session,
      (candidate) => candidate.kind === 'highlight' && candidate.depth > 0
    )

    await expect(session.dispatch({
      kind: 'remove-highlight',
      target: nested.nodeId
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'comment-payload-target'
    })
    expect(source(session)).toBe(before)
  })

  it('rejects removing a comment nested in another comment', async() => {
    const before = 'x {>>outer {>>inner<<} tail<<} y\n'
    const session = await open(before)
    const inner = item(
      session,
      (candidate) => candidate.kind === 'comment' && candidate.depth > 0
    )

    await expect(session.dispatch({
      kind: 'remove-comment',
      target: inner.nodeId
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'comment-payload-target'
    })
    expect(source(session)).toBe(before)
  })

  it('rejects editing a comment nested in another comment', async() => {
    const before = 'x {>>outer {>>inner<<} tail<<} y\n'
    const session = await open(before)
    const inner = item(
      session,
      (candidate) => candidate.kind === 'comment' && candidate.depth > 0
    )

    await expect(session.dispatch({
      kind: 'edit-comment',
      target: inner.nodeId,
      comment: 'replaced'
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'comment-payload-target'
    })
    expect(source(session)).toBe(before)
  })

  it('still resolves a change nested in a highlight payload', async() => {
    const before = 'x {==a {++b++} c==} y\n'
    const session = await open(before)
    const nested = item(
      session,
      (candidate) => candidate.kind === 'addition' && candidate.depth > 0
    )

    await expect(session.dispatch({
      kind: 'resolve-change',
      target: nested.nodeId,
      decision: 'accept'
    }).completion).resolves.toMatchObject({ kind: 'committed' })
    expect(source(session)).toBe('x {==a b c==} y\n')
  })

  it('marks comment-interior items in the Review index', async() => {
    const session = await open('x {>>see {++this++}<<} y {++real++} z\n')
    const nested = item(
      session,
      (candidate) => candidate.kind === 'addition' && candidate.depth > 0
    )
    const top = item(
      session,
      (candidate) => candidate.kind === 'addition' && candidate.depth === 0
    )
    expect(nested.withinCommentPayload).toBe(true)
    expect(top.withinCommentPayload).toBe(false)
  })
})
