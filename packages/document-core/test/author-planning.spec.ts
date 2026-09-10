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
})
