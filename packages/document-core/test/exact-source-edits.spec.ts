import { describe, expect, it } from 'vitest'

import { applyExactSourceEdits } from '../src/exactSourceEdits.js'

describe('exact source edits', () => {
  it('applies base-coordinate edits without normalizing untouched source', () => {
    const source = 'alpha\r\n{++beta++}\r\nomega\r\n'

    expect(applyExactSourceEdits(source, [
      { start: 0, end: 5, insert: 'ALPHA' },
      { start: 10, end: 14, insert: 'BETA' }
    ], 'edit')).toBe('ALPHA\r\n{++BETA++}\r\nomega\r\n')
  })

  it('rejects overlapping, reversed, and out-of-range edits before publishing', () => {
    const source = 'abcdef'

    expect(() => applyExactSourceEdits(source, [
      { start: 2, end: 4, insert: 'x' },
      { start: 3, end: 5, insert: 'y' }
    ], 'edit')).toThrow('edit 1 is invalid')
    expect(() => applyExactSourceEdits(source, [
      { start: 4, end: 2, insert: 'x' }
    ], 'edit')).toThrow('edit 0 is invalid')
    expect(() => applyExactSourceEdits(source, [
      { start: 0, end: 7, insert: 'x' }
    ], 'edit')).toThrow('edit 0 is invalid')
  })
})
