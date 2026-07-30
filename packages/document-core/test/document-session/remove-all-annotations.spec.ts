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

function sourceOf(session: DocumentSession): string {
  const snapshot = session.snapshot()
  if (snapshot.kind !== 'complete') {
    throw new Error('Expected a complete snapshot')
  }
  return snapshot.revision.source
}

// G37: per-item gestures exist for every form, but an editorial pass needs a
// bulk finish. Accept/Reject All resolves the three changes; this gesture
// resolves the other two — every Highlight unwraps to its text and every
// Comment (pair note or standalone) is removed — so Accept All plus Remove
// All Annotations leaves nothing but plain Markdown.
describe('remove-all-annotations', () => {
  it('unwraps highlights and removes comments in one exact undo step', async() => {
    const source =
      'A {++add++} B {--del--} C {~~old~>new~~} D {==hi==} E {>>note<<} ' +
      'F {==anchor==}{>>pair<<} G\n'
    const session = await open(source)

    await expect(session.dispatch({
      kind: 'remove-all-annotations'
    }).completion).resolves.toMatchObject({
      kind: 'committed',
      transition: { history: 'record' }
    })
    expect(sourceOf(session)).toBe(
      'A {++add++} B {--del--} C {~~old~>new~~} D hi E  F anchor G\n'
    )

    await expect(session.dispatch({ kind: 'undo' }).completion)
      .resolves.toMatchObject({ kind: 'committed' })
    expect(sourceOf(session)).toBe(source)
  })

  it('completes an editorial pass after Accept All', async() => {
    const source =
      'A {++add++} B {--del--} C {~~old~>new~~} D {==hi==} E {>>note<<} ' +
      'F {==anchor==}{>>pair<<} G\n'
    const session = await open(source)

    await session.dispatch({
      kind: 'resolve-all-changes',
      decision: 'accept'
    }).completion
    await session.dispatch({ kind: 'remove-all-annotations' }).completion

    const clean = sourceOf(session)
    expect(clean).toBe('A add B  C new D hi E  F anchor G\n')
    expect(clean.match(/\{(\+\+|--|~~|==|>>)/g)).toBeNull()
  })

  it('resolves annotations nested inside a removed highlight', async() => {
    const session = await open('{=={++a++} {>>n<<}==} x\n')

    await session.dispatch({ kind: 'remove-all-annotations' }).completion
    expect(sourceOf(session)).toBe('{++a++}  x\n')
  })

  it('removes a comment inside a kept change arm', async() => {
    const session = await open('{++keep {>>note<<}++}\n')

    await session.dispatch({ kind: 'remove-all-annotations' }).completion
    expect(sourceOf(session)).toBe('{++keep ++}\n')
  })

  it('removes an outer comment together with its quoted markup', async() => {
    const session = await open('x {>>see {++this++} and {>>inner<<}<<} y\n')

    await session.dispatch({ kind: 'remove-all-annotations' }).completion
    expect(sourceOf(session)).toBe('x  y\n')
  })

  it('rejects visibly when there is nothing to remove', async() => {
    const session = await open('A {++only-changes++} B\n')

    await expect(session.dispatch({
      kind: 'remove-all-annotations'
    }).completion).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'no-source-change'
    })
    expect(sourceOf(session)).toBe('A {++only-changes++} B\n')
  })
})
