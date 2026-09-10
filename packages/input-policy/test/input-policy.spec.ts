import { describe, expect, it } from 'vitest'
import { applyInputPairing } from '../src/index'

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
