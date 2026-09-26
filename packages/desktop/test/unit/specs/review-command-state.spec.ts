import { describe, expect, it } from 'vitest'
import { reviewCommandEnabled, type ReviewCommandState } from '../../../src/common/commands/review'

describe('review command availability', () => {
  const markup: ReviewCommandState = {
    available: true,
    editable: true,
    canAuthor: true,
    canTrack: true,
    tracking: false,
    hasItem: true,
    targeted: true,
    hasComment: false,
    removable: false,
    busy: false,
    mode: 'markup'
  }
  const reader: ReviewCommandState = { ...markup, editable: false, mode: 'original' }

  it('keeps read-only projections for reading: no resolution or authoring (owner decision)', () => {
    for (const command of ['accept', 'reject', 'accept-all', 'reject-all', 'remove', 'edit-comment', 'add-comment', 'mark-highlight', 'track-changes'] as const) {
      expect(reviewCommandEnabled(command, { ...reader, removable: true, hasComment: true }), command).toBe(false)
    }
    expect(reviewCommandEnabled('markup', reader)).toBe(true)
    expect(reviewCommandEnabled('next', reader)).toBe(true)
  })
  it('resolves an item only when it is a visible target', () => {
    expect(reviewCommandEnabled('accept', markup)).toBe(true)
    expect(reviewCommandEnabled('accept', { ...markup, targeted: false })).toBe(false)
    expect(reviewCommandEnabled('reject', { ...markup, targeted: false })).toBe(false)
    expect(reviewCommandEnabled('remove', { ...markup, removable: true, targeted: false })).toBe(false)
    expect(reviewCommandEnabled('edit-comment', { ...markup, hasComment: true, targeted: false })).toBe(false)
    expect(reviewCommandEnabled('accept-all', { ...markup, targeted: false })).toBe(true)
    expect(reviewCommandEnabled('next', { ...markup, targeted: false })).toBe(true)
  })
  it('protects an active draft or transaction on every surface', () => {
    expect(reviewCommandEnabled('accept', { ...markup, busy: true })).toBe(false)
    expect(reviewCommandEnabled('original', { ...markup, busy: true })).toBe(false)
    expect(reviewCommandEnabled('accept', { ...markup, available: false })).toBe(false)
  })
})
