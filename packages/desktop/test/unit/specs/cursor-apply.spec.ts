import { describe, it, expect, vi } from 'vitest'
import { applyCursor, isIndexCursor } from '@/util/cursor'

describe('applyCursor', () => {
  const makeEditor = () => ({
    setCursorByOffset: vi.fn(() => true)
  })

  it('routes a source-code index cursor to setCursorByOffset', () => {
    const editor = makeEditor()
    const cursor = { anchor: { line: 3, ch: 2 }, focus: { line: 3, ch: 5 } }

    applyCursor(editor, cursor)

    expect(editor.setCursorByOffset).toHaveBeenCalledWith(cursor)
  })

  it('restores a serialized document cursor by its focus offset', () => {
    const editor = makeEditor()
    const cursor = {
      anchor: { offset: 1 },
      focus: { offset: 4 }
    }

    applyCursor(editor, cursor)

    expect(editor.setCursorByOffset).toHaveBeenCalledWith(4)
  })

  it('does nothing for null or malformed cursors', () => {
    const editor = makeEditor()

    applyCursor(editor, null)
    applyCursor(editor, { anchor: { offset: 1 } })

    expect(editor.setCursorByOffset).not.toHaveBeenCalled()
  })
})

describe('isIndexCursor', () => {
  it('is true only when both ends carry numeric line and ch', () => {
    expect(isIndexCursor({ anchor: { line: 0, ch: 0 }, focus: { line: 1, ch: 2 } })).toBe(true)
    expect(isIndexCursor({ anchor: { offset: 0 }, focus: { offset: 1 } })).toBe(false)
    expect(isIndexCursor({ anchor: { line: 0 }, focus: { line: 1, ch: 2 } })).toBe(false)
    expect(isIndexCursor(null)).toBe(false)
  })
})
