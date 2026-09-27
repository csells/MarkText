import { describe, it, expect } from 'vitest'
import { isIndexCursor } from '@/util/cursor'

describe('isIndexCursor', () => {
  it('is true only when both ends carry numeric line and ch', () => {
    expect(isIndexCursor({ anchor: { line: 0, ch: 0 }, focus: { line: 1, ch: 2 } })).toBe(true)
    expect(isIndexCursor({ anchor: { offset: 0 }, focus: { offset: 1 } })).toBe(false)
    expect(isIndexCursor({ anchor: { line: 0 }, focus: { line: 1, ch: 2 } })).toBe(false)
    expect(isIndexCursor(null)).toBe(false)
  })
})
