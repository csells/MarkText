import { describe, expect, it } from 'vitest'
import { reviewCommandEnabled, type ReviewCommandState } from '../../../src/common/commands/review'

describe('review command availability', () => {
  const reader: ReviewCommandState = {
    available: true, editable: false, canAuthor: true, canTrack: true,
    tracking: false, hasItem: true, hasComment: false, removable: false,
    busy: false, mode: 'original'
  }
  it('permits review decisions on a read-only projection while preventing text authoring', () => {
    expect(reviewCommandEnabled('accept', reader)).toBe(true)
    expect(reviewCommandEnabled('reject', reader)).toBe(true)
    expect(reviewCommandEnabled('accept-all', reader)).toBe(true)
    expect(reviewCommandEnabled('add-comment', reader)).toBe(false)
    expect(reviewCommandEnabled('mark-highlight', reader)).toBe(false)
    expect(reviewCommandEnabled('track-changes', reader)).toBe(false)
  })
  it('protects an active draft or transaction on every surface', () => {
    expect(reviewCommandEnabled('accept', { ...reader, busy: true })).toBe(false)
    expect(reviewCommandEnabled('original', { ...reader, busy: true })).toBe(false)
    expect(reviewCommandEnabled('accept', { ...reader, available: false })).toBe(false)
  })
})
