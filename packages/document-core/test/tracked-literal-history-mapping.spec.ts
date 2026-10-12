import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'
import { keepsTyping, resolveAll } from './support/resolvedSuggestions.js'

// Typing into the old arm of a Substitution of a literal block goes to the
// same place in its proposed block where that stays within the Substitution.
// Where it would not, as when a paragraph break typed into the proposed math
// breaks the paragraph the Substitution lives in, the old arm splits instead:
// Accept All keeps the typing and Reject All restores the original.

const lines = (count: number, line: (index: number) => string): string => Array.from({ length: count }, (_, index) => line(index)).join('\n')

describe('typing into a literal block\'s replaced text', () => {
  it('splits rather than reach past the Substitution', () => {
    const substitution = '{~~$$\n' + lines(5, index => `x_{${index}} + y`) + '\n$$~>$$\n' + lines(5, index => `x_{${index}} + y`) + '{--d--}\n$$~~}'
    const source = `Intro.\n\n${substitution}\n\nText {==marked *text*==}{>>see<<} end.\n`
    const caret = source.indexOf('x_{3} ') + 6
    const core = createDocumentCore()
    const edit = core.trackedEdit(core.open(source), { start: caret, end: caret, insert: '\n\n' })
    expect(edit).toBeDefined()
    if (edit === undefined) return
    const start = source.indexOf(substitution)
    expect(edit.start).toBeGreaterThanOrEqual(start)
    expect(edit.end).toBeLessThanOrEqual(start + substitution.length)
    const next = source.slice(0, edit.start) + edit.insert + source.slice(edit.end)
    expect(resolveAll(next, 'reject')).toBe(resolveAll(source, 'reject'))
    expect(keepsTyping(resolveAll(next, 'accept'), resolveAll(source, 'accept'), '\n\n')).toBe(true)
  })

  it('keeps typing that stays within the Substitution in the proposed block', () => {
    const source = '{~~```\ngone\n```\n~>```\nnew\n```\n~~}\n\nPlain words here.\n'
    const caret = source.indexOf('one')
    const core = createDocumentCore()
    expect(core.trackedEdit(core.open(source), { start: caret, end: caret, insert: 'x' }))
      .toEqual({ start: caret, end: source.indexOf('new'), insert: source.slice(caret, source.indexOf('new')) + 'x' })
  })
})
