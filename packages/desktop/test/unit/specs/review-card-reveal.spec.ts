import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { createReviewOverviewTracker } from '@/documentAuthority/coreReviewOverview'
import {
  nearestScrollDelta,
  revealsSelectedEntry
} from '@/components/editorWithTabs/reviewCardReveal'

// The sidebar shows the card of the entry the author moves to, as Google
// Docs does, and otherwise stays where the author scrolled it.

describe('nearestScrollDelta', () => {
  const view = { top: 100, bottom: 500 }
  it('leaves a card in view where it is', () => {
    expect(nearestScrollDelta(view, { top: 100, bottom: 180 })).toBe(0)
    expect(nearestScrollDelta(view, { top: 420, bottom: 500 })).toBe(0)
  })
  it('scrolls the least that shows a card above or below the view', () => {
    expect(nearestScrollDelta(view, { top: -300, bottom: -220 })).toBe(-400)
    expect(nearestScrollDelta(view, { top: 900, bottom: 980 })).toBe(480)
  })
  it('shows the top of a card taller than the view', () => {
    expect(nearestScrollDelta(view, { top: 700, bottom: 1300 })).toBe(600)
  })
})

describe('revealsSelectedEntry', () => {
  const core = createDocumentCore()
  const tracker = createReviewOverviewTracker()
  let revision = core.open('Lead.\n\nOne {++first++} two {++second++}.\n')
  const entries = tracker.overview(core, revision)
  const [first, second] = entries

  it('reveals the entry navigation, the caret or a click selects', () => {
    expect(revealsSelectedEntry({ entries }, { start: first!.item.range.start, entries })).toBe(true)
    expect(revealsSelectedEntry(
      { start: first!.item.range.start, entries },
      { start: second!.item.range.start, entries }
    )).toBe(true)
  })

  it('does not reveal when nothing is selected or the selection is unchanged', () => {
    expect(revealsSelectedEntry({ start: first!.item.range.start, entries }, { entries })).toBe(false)
    expect(revealsSelectedEntry(
      { start: first!.item.range.start, entries },
      { start: first!.item.range.start, entries: [...entries] }
    )).toBe(false)
  })

  it('does not reveal the same entry moved by typing before it', () => {
    const commit = core.apply(revision, [{ start: 2, end: 2, insert: 'xyz' }], { projections: ['markup'] })
    tracker.committed(revision, commit.revision, commit.change)
    revision = commit.revision
    const moved = tracker.overview(core, revision)
    expect(moved[0]!.item.range.start).toBe(first!.item.range.start + 3)
    expect(revealsSelectedEntry(
      { start: first!.item.range.start, entries },
      { start: moved[0]!.item.range.start, entries: moved }
    )).toBe(false)
    // Another entry selected in the same refresh is revealed.
    expect(revealsSelectedEntry(
      { start: first!.item.range.start, entries },
      { start: moved[1]!.item.range.start, entries: moved }
    )).toBe(true)
  })
})
