import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

describe('Review authoring on the common document model', () => {
  it.each([
    { form: 'addition' as const, text: '', source: '{++aaa++}', selection: { start: 3, end: 6 } },
    { form: 'highlight' as const, text: '', source: '{==aaa==}', selection: { start: 3, end: 6 } },
    { form: 'comment' as const, text: 'note', source: '{==aaa==}{>>note<<}', selection: { start: 3, end: 6 } },
    { form: 'substitution' as const, text: 'bbb', source: '{~~aaa~>bbb~~}', selection: { start: 8, end: 11 } }
  ])('returns the exact resulting syntax selection for $form', ({ form, text, source, selection }) => {
    const core = createDocumentCore()
    const revision = core.open('aaa')
    const planned = core.planAuthor(revision, { form, range: { start: 0, end: 3 }, text })
    if (planned === undefined) throw new Error('Missing author operation')
    expect(planned.selection).toEqual(selection)
    expect(core.apply(revision, [planned.edit]).revision.source).toBe(source)
  })

  it('preserves the selected link label when authoring wraps the complete owned link', () => {
    const core = createDocumentCore()
    const revision = core.open('[aaa](url)')
    const planned = core.planAuthor(revision, { form: 'highlight', range: { start: 1, end: 4 }, text: '' })
    if (planned === undefined) throw new Error('Missing author operation')
    expect(planned.selection).toEqual({ start: 4, end: 7 })
    expect(core.apply(revision, [planned.edit]).revision.source).toBe('{==[aaa](url)==}')
  })

  it('retains existing annotation ownership inside the selected text', () => {
    const core = createDocumentCore()
    const source = 'a{++a++}a'
    const revision = core.open(source)
    const planned = core.planAuthor(revision, { form: 'highlight', range: { start: 0, end: source.length }, text: '' })
    if (planned === undefined) throw new Error('Missing author operation')
    const result = core.apply(revision, [planned.edit])
    expect(result.revision.source).toBe('{==a{++a++}a==}')
    expect(result.revision.annotations[0]?.arms[0]?.annotations[0]?.kind).toBe('addition')
  })

  it('retains the existing explicit rejection for a partial annotation boundary', () => {
    const core = createDocumentCore()
    const revision = core.open('a{++a++}a')
    expect(core.planAuthor(revision, { form: 'highlight', range: { start: 0, end: 5 }, text: '' })).toBeUndefined()
    expect(revision.source).toBe('a{++a++}a')
  })

  const authored = (source: string, form: 'addition' | 'comment' | 'highlight' | 'substitution', start: number, end: number, text = form === 'comment' ? 'note' : '') => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const planned = core.planAuthor(revision, { form, range: { start, end }, text })
    if (planned === undefined) return undefined
    const result = core.apply(revision, [planned.edit]).revision.source
    return { source: result, selection: result.slice(planned.selection.start, planned.selection.end) }
  }

  // Plan 0012 G16: a comment on a standalone highlight makes it one commented span.
  it.each([
    { name: 'a selection inside it', start: 6, end: 7 },
    { name: 'its whole text', start: 5, end: 8 },
    { name: 'a caret inside it', start: 6, end: 6 },
    { name: 'a caret at its text end', start: 8, end: 8 }
  ])('Add Comment with $name attaches a gapless comment to a standalone highlight', ({ start, end }) => {
    expect(authored('x {==abc==} y', 'comment', start, end)).toEqual({ source: 'x {==abc==}{>>note<<} y', selection: 'abc' })
  })

  it('attaches to the innermost standalone highlight around the selection', () => {
    expect(authored('{==a {==b==} c==}{>>n<<}', 'comment', 8, 9)).toEqual({ source: '{==a {==b==}{>>note<<} c==}{>>n<<}', selection: 'b' })
  })

  it('refuses a caret outside any standalone highlight', () => {
    expect(authored('x abc y', 'comment', 3, 3)).toBeUndefined()
    expect(authored('x {==abc==}{>>n<<} y', 'comment', 6, 6)).toBeUndefined()
    expect(authored('x {==abc==} y', 'highlight', 6, 6)).toBeUndefined()
  })

  // Google Docs allows overlapping comments; CriticMarkup nests them (Profile 1 N1).
  it('nests a new commented span inside an already commented passage', () => {
    expect(authored('x {==abc==}{>>n<<} y', 'comment', 6, 7)).toEqual({ source: 'x {==a{==b==}{>>note<<}c==}{>>n<<} y', selection: 'b' })
    expect(authored('x {==abc==}{>>n<<} y', 'comment', 5, 8)).toEqual({ source: 'x {=={==abc==}{>>note<<}==}{>>n<<} y', selection: 'abc' })
  })

  it('widens a comment that partially overlaps a commented passage to enclose the whole passage', () => {
    expect(authored('x {==abc==}{>>n<<} y', 'comment', 0, 7)).toEqual({ source: '{==x {==abc==}{>>n<<}==}{>>note<<} y', selection: 'x {==ab' })
    expect(authored('x {==abc==}{>>n<<} y', 'comment', 6, 20)).toEqual({ source: 'x {=={==abc==}{>>n<<} y==}{>>note<<}', selection: 'bc==}{>>n<<} y' })
    expect(authored('x {==abc==} y', 'comment', 0, 6)).toEqual({ source: '{==x {==abc==}==}{>>note<<} y', selection: 'x {==a' })
  })

  it('still refuses other forms that partially overlap a commented passage', () => {
    expect(authored('x {==abc==}{>>n<<} y', 'highlight', 0, 7)).toBeUndefined()
    expect(authored('x {==abc==}{>>n<<} y', 'addition', 0, 7)).toBeUndefined()
  })

  // Plan 0012 G39: authored syntax never enters the gap of a Highlight+Comment pair.
  it.each([
    { form: 'highlight' as const, start: 0, end: 11, expected: '{==x {==abc==}{>>n<<}==} y' },
    { form: 'comment' as const, start: 0, end: 11, expected: '{==x {==abc==}{>>n<<}==}{>>note<<} y' },
    { form: 'addition' as const, start: 0, end: 8, expected: '{++x {==abc==}{>>n<<}++} y' },
    { form: 'highlight' as const, start: 11, end: 20, expected: 'x {==abc==}{>>n<<}{== y==}' },
    { form: 'highlight' as const, start: 8, end: 20, expected: 'x {==abc==}{>>n<<}{== y==}' },
    { form: 'highlight' as const, start: 0, end: 5, expected: '{==x ==}{==abc==}{>>n<<} y' }
  ])('keeps $form authored at [$start, $end) outside the commented span edges', ({ form, start, end, expected }) => {
    const result = authored('x {==abc==}{>>n<<} y', form, start, end)
    expect(result?.source).toBe(expected)
    expect(result?.selection).not.toMatch(/^[=}]|\{$/u)
  })
})
