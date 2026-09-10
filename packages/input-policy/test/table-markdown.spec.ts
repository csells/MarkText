import { expect, it } from 'vitest'
import { tableToMarkdown, tableToMarkdownWithPositions } from '../src/index.js'

it('retains native table spelling while mapping trimmed, escaped and Unicode cell boundaries exactly', () => {
  const state = {
    children: [
      { children: [{ text: ' a|b ', meta: { align: 'none' } }, { text: '界', meta: { align: 'center' } }] },
      { children: [{ text: 'a\\|b', meta: { align: 'none' } }, { text: 'e\u0301', meta: { align: 'center' } }] }
    ]
  }
  const output = tableToMarkdownWithPositions(state)
  expect(output.markdown).toBe('| a\\|b | 界  |\n| ---- |:---:|\n| a\\|b | e\u0301   |')
  expect(tableToMarkdown(state)).toBe(output.markdown)
  expect(output.rows[0]!.cells[0]!.offsets).toEqual([2, 2, 3, 5, 6, 6])
  expect(output.rows[0]!.cells[1]!.offsets).toEqual([9, 10])
  expect(output.rows[1]!.cells[0]!.offsets).toEqual([31, 32, 33, 34, 35])
  expect(tableToMarkdown(state, '', output.markdown.length)).toBe(output.markdown)
  expect(tableToMarkdown(state, '', output.markdown.length - 1)).toBeUndefined()
  expect(tableToMarkdownWithPositions(state, '', output.markdown.length)).toEqual(output)
  expect(tableToMarkdownWithPositions(state, '', output.markdown.length - 1)).toBeUndefined()
})

it.each(['none', 'left', 'center', 'right'] as const)('exposes exact serialized %s delimiter token extents', align => {
  const output = tableToMarkdownWithPositions({ children: [{ children: [{ text: 'wide header', meta: { align } }] }] })
  const delimiter = output.delimiterCells[0]
  if (delimiter === undefined) throw new Error('Expected delimiter position')
  const slot = output.markdown.slice(delimiter.start, delimiter.end)
  expect(output.markdown.slice(delimiter.contentStart, delimiter.contentEnd)).toBe(slot.trim())
  expect(slot).toBe(({ none: ' ----------- ', left: ':----------- ', center: ':-----------:', right: ' -----------:' })[align])
})

it('places an empty cell boundary after its padding, where the Markdown parser owns empty content', () => {
  const output = tableToMarkdownWithPositions({ children: [{ children: [{ text: '   ', meta: { align: 'none' } }] }] })
  expect(output.markdown).toBe('|     |\n| --- |')
  expect(output.rows[0]?.cells[0]).toEqual({ start: 6, end: 6, slotStart: 1, slotEnd: 6, offsets: [6, 6, 6, 6] })
})
