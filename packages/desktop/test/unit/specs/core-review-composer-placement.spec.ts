import { describe, expect, it } from 'vitest'
import {
  coreReviewComposerPlacement,
  createCoreReviewComposer,
  type CoreReviewComposerState
} from '@/components/editorWithTabs/coreReviewComposer'
import type { CoreReviewOverviewEntry } from '@/documentAuthority/coreProtocol'

// An unsubmitted composer stays on its entry's card
// while edits move that entry, and never disappears.

const comment = (start: number, text: string): CoreReviewOverviewEntry => ({
  item: { kind: 'comment', range: { start, end: start + text.length + 6 } },
  commentText: text
})

const editing = (entry: CoreReviewOverviewEntry): CoreReviewComposerState => ({
  ...createCoreReviewComposer(),
  open: true,
  draft: 'Unsubmitted reply',
  target: {
    id: 'edit',
    revision: 1,
    text: entry.commentText ?? '',
    item: entry.item,
    entry: entry.item
  }
})

describe('Review composer placement', () => {
  it('stands on the card of the entry it edits', () => {
    const entry = comment(10, 'Check')
    expect(coreReviewComposerPlacement(editing(entry).target, [comment(0, 'Other'), entry]))
      .toEqual({ composerStart: 10 })
  })

  it('follows its entry when an edit in Source moves it', () => {
    const state = editing(comment(10, 'Check'))
    expect(coreReviewComposerPlacement(state.target, [comment(18, 'Check')]))
      .toEqual({ composerStart: 18 })
  })

  it('picks the matching entry nearest to where its entry was', () => {
    const state = editing(comment(40, 'Same'))
    expect(coreReviewComposerPlacement(state.target, [
      comment(5, 'Same'),
      comment(44, 'Same'),
      comment(90, 'Same')
    ])).toEqual({ composerStart: 44 })
  })

  it('does not move onto an entry of another Comment, kind or length', () => {
    const state = editing(comment(10, 'Check'))
    const highlight: CoreReviewOverviewEntry = { item: { kind: 'highlight', range: { start: 10, end: 21 } } }
    expect(coreReviewComposerPlacement(state.target, [comment(10, 'Other'), highlight, comment(12, 'Checked')]))
      .toEqual({ draftStart: 10 })
  })

  it('keeps unsubmitted input as a draft card where its entry was once the entry is gone', () => {
    const state = editing(comment(10, 'Check'))
    expect(coreReviewComposerPlacement(state.target, [])).toEqual({ draftStart: 10 })
  })

  it('places a new item where its draft card was opened', () => {
    const state: CoreReviewComposerState = {
      ...createCoreReviewComposer(),
      open: true,
      target: { id: 'new', revision: 1, text: '', form: 'comment', draftStart: 7 }
    }
    expect(coreReviewComposerPlacement(state.target, [comment(0, 'Other')])).toEqual({ draftStart: 7 })
    expect(coreReviewComposerPlacement(undefined, [])).toEqual({ draftStart: undefined })
  })
})
