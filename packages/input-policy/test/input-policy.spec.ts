import { describe, expect, it } from 'vitest'
import { applyInputPairing, inlineUpdateLayout, matchInlineUpdate } from '../src/index'

const options = { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
const action = { text: 'seed ', start: 5, end: 5, collapsed: true, inputType: 'insertText', options, context: undefined }

describe('shared input policy without known syntax', () => {
  it.each(['(', '"'])('retains syntax-independent pairing for %s', data => {
    const result = applyInputPairing({ ...action, data })
    expect(result.kind).toBe('replace')
    expect(result.edit).toEqual({ start: 5, end: 5, text: data === '(' ? '()' : '""' })
    expect(result.selection).toEqual({ start: 6, end: 6 })
  })

  it('does not invent Markdown context for a pending star', () => {
    expect(applyInputPairing({ ...action, data: '*' })).toEqual({
      kind: 'replace', edit: { start: 5, end: 5, text: '*' }, selection: { start: 6, end: 6 }
    })
  })
})

describe('inline update', () => {
  it.each([
    { text: 'a\n2. b', kind: 'list' },
    { text: 'a\n- ', kind: 'list' },
    { text: '[ ] a', kind: 'task-list' },
    { text: 'a\n[ ] b', kind: 'paragraph' },
    { text: 'a\n## b', kind: 'atx-heading', marker: '##' },
    { text: 'a\n####### b', kind: 'paragraph' },
    { text: 'a\n=== x', kind: 'setext-heading', underline: '===' },
    { text: 'a\n===\nb', kind: 'paragraph' },
    { text: 'a\n>b', kind: 'blockquote' },
    { text: 'a\n>', kind: 'paragraph' },
    { text: '    a', kind: 'indented-code' },
    { text: 'a\n***', kind: 'thematic-break' },
    { text: 'a\n*-*', kind: 'paragraph' },
    // The leftmost match decides: a setext underline anchors at the start.
    { text: 'a\n2. b\n=== x', kind: 'setext-heading', underline: '===' }
  ])('reads $text as $kind', ({ text, ...match }) => {
    expect(matchInlineUpdate(text)).toEqual(match)
  })

  it('writes a later list line as its own list after the trimmed paragraph', () => {
    expect(inlineUpdateLayout('a  \n2.  b\nc', 1, 1)).toEqual({
      kind: 'list',
      line: 1,
      markerEnd: 4,
      lines: [
        { cut: 0, lead: '', keep: 1, blankBefore: false },
        { cut: 4, lead: '2. ', blankBefore: true },
        { cut: 0, lead: '   ', blankBefore: false }
      ],
      selection: { start: { line: 1, offset: 3 }, end: { line: 1, offset: 3 } }
    })
  })

  it('keeps a quote caret at its place in the typed line', () => {
    expect(inlineUpdateLayout('aaaa\n>b\nccc', 6, 6)?.selection.start).toEqual({ line: 1, offset: 2 })
  })

  it('leaves indented code and plain text to the caller', () => {
    expect(inlineUpdateLayout('    a', 5, 5)).toBeUndefined()
    expect(inlineUpdateLayout('a\nb', 1, 1)).toBeUndefined()
  })
})
