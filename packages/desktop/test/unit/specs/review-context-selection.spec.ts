import { describe, expect, it } from 'vitest'
import { createReviewContextSession, reviewContextSelection } from '../../../src/renderer/src/documentAuthority/reviewContextSelection'
import type { CoreReviewOverviewEntry } from '../../../src/renderer/src/documentAuthority/coreProtocol'

const entries: CoreReviewOverviewEntry[] = [
  { item: { kind: 'commented-span', range: { start: 0, end: 80 }, highlightRange: { start: 0, end: 60 }, commentRange: { start: 60, end: 80 } }, commentText: 'Outer' },
  { item: { kind: 'commented-span', range: { start: 10, end: 50 }, highlightRange: { start: 10, end: 30 }, commentRange: { start: 30, end: 50 } }, commentText: 'Inner' },
  { item: { kind: 'addition', range: { start: 15, end: 25 } }, text: 'suggestion' }
]

it('retains the deepest suggestion and independently selects its nearest anchored comment', () => {
  const result = reviewContextSelection(entries, 15)
  expect(result?.deepest.item.kind).toBe('addition')
  expect(result?.comment?.commentText).toBe('Inner')
})

describe('native review context target ownership', () => {
  const lease = {}
  const identity = { documentId: 'one', revision: 4, lease }
  it.each([
    { ...identity, documentId: 'two' },
    { ...identity, revision: 5 },
    { ...identity, lease: {} }
  ])('rejects document, revision or lease replacement: %j', replacement => {
    const session = createReviewContextSession<string>()
    session.set(1, identity, 'captured')
    expect(session.take(1, replacement)).toBeUndefined()
    expect(session.take(1, identity)).toBeUndefined()
  })
  it('consumes a target once and ignores an older menu closing after its replacement', () => {
    const session = createReviewContextSession<string>()
    session.set(1, identity, 'older')
    session.set(2, identity, 'newer')
    session.clear(1)
    expect(session.take(1, identity)).toBeUndefined()
    expect(session.take(2, identity)).toBe('newer')
    expect(session.take(2, identity)).toBeUndefined()
  })
  it('releases the target when its menu closes', () => {
    const session = createReviewContextSession<string>()
    session.set(1, identity, 'captured')
    session.clear(1)
    expect(session.take(1, identity)).toBeUndefined()
  })
})
