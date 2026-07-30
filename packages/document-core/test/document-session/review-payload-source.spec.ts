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

function items(session: DocumentSession): readonly ReviewIndexItem[] {
  const snapshot = session.snapshot()
  if (snapshot.kind !== 'complete') {
    throw new Error('Expected a complete snapshot')
  }
  return snapshot.reviewIndex.items
}

function payloadText(
  session: DocumentSession,
  item: ReviewIndexItem | undefined
): string | undefined {
  if (item === undefined) {
    return undefined
  }
  const snapshot = session.snapshot()
  if (snapshot.kind !== 'complete') {
    throw new Error('Expected a complete snapshot')
  }
  return snapshot.revision.source.slice(
    Number(item.payloadRange.start),
    Number(item.payloadRange.end)
  )
}

// G30: a payload editor must round-trip the exact bytes the author wrote.
// The Review surface previously reconstructed payload text — a delimiter-width
// slice in the renderer for changes, and the accept-all render for comments —
// so saving an untouched comment destroyed the CriticMarkup nested inside it.
// The parser owns the marker ranges; the index publishes the payload extent
// (a range, not a copy: materializing every payload is O(depth × size)).
describe('ReviewIndex payload range', () => {
  it('names the exact comment payload, nested markup included', async() => {
    const session = await open('x {>>see {++this++} and *that*<<} y\n')
    const comment = items(session).find(
      (item) => item.kind === 'comment' && item.depth === 0
    )
    expect(payloadText(session, comment)).toBe('see {++this++} and *that*')
  })

  it('names payload bytes for every unary form', async() => {
    const session = await open(
      'a {++add++} b {--del--} c {==hi==} d {>>note<<} e\n'
    )
    const byKind = new Map(
      items(session).map((item) => [item.kind, payloadText(session, item)])
    )
    expect(byKind.get('addition')).toBe('add')
    expect(byKind.get('deletion')).toBe('del')
    expect(byKind.get('highlight')).toBe('hi')
    expect(byKind.get('comment')).toBe('note')
  })

  it('names the divider-bearing payload for a substitution', async() => {
    const session = await open('a {~~old~>new~~} b\n')
    const substitution = items(session).find(
      (item) => item.kind === 'substitution'
    )
    expect(payloadText(session, substitution)).toBe('old~>new')
    expect(substitution?.oldContent).toBe('old')
    expect(substitution?.newContent).toBe('new')
  })

  it('keeps a nested comment byte-exact inside its outer payload', async() => {
    const session = await open('x {>>outer {>>inner<<} tail<<} y\n')
    const outer = items(session).find(
      (item) => item.kind === 'comment' && item.depth === 0
    )
    expect(payloadText(session, outer)).toBe('outer {>>inner<<} tail')
  })

  it('names empty payloads exactly', async() => {
    const session = await open('a {++++} b\n')
    const addition = items(session).find((item) => item.kind === 'addition')
    expect(payloadText(session, addition)).toBe('')
  })
})
