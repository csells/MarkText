import { describe, expect, it } from 'vitest'
import { finalNewlineEdit } from '../src/index.js'

const conformed = (text: string, mode: number): string => {
  const edit = finalNewlineEdit(text, 0, mode)
  return edit === undefined ? text : text.slice(0, edit.start) + edit.insert + text.slice(edit.end)
}

describe('trailing newline mode', () => {
  it('ensures one final newline in mode 1', () => {
    expect(conformed('Alpha.\n\nSource line.', 1)).toBe('Alpha.\n\nSource line.\n')
    expect(conformed('Alpha.\n\n\n', 1)).toBe('Alpha.\n')
    expect(conformed('Alpha.\r\n\r\n', 1)).toBe('Alpha.\r\n')
    expect(finalNewlineEdit('Alpha.\n', 0, 1)).toBeUndefined()
  })

  it('trims every final newline in mode 0', () => {
    expect(conformed('Alpha.\n\n', 0)).toBe('Alpha.')
    expect(conformed('Alpha.\r\n', 0)).toBe('Alpha.')
    expect(finalNewlineEdit('Alpha.', 0, 0)).toBeUndefined()
  })

  it('keeps a final question mark, unlike upstream\'s pattern', () => {
    expect(conformed('Why?', 0)).toBe('Why?')
    expect(conformed('Why?', 1)).toBe('Why?\n')
  })

  it('leaves text alone in modes 2 and 3 and with no mode', () => {
    for (const mode of [2, 3, undefined]) expect(finalNewlineEdit('Alpha.\n\n\n', 0, mode)).toBeUndefined()
  })

  it('writes a document of only line breaks as empty, and an empty one as is', () => {
    expect(conformed('\n\n', 1)).toBe('')
    expect(finalNewlineEdit('', 0, 1)).toBeUndefined()
  })

  it('reads a tail at its document offset', () => {
    expect(finalNewlineEdit('a.\n\n', 10, 1)).toEqual({ start: 13, end: 14, insert: '' })
  })
})
