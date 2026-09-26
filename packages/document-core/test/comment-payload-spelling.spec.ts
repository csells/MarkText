import { describe, expect, it } from 'vitest'
import { createDocumentCore, spellCommentPayload } from '../src/index.js'

const commentPayload = (source: string) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const comment = revision.annotations.find(annotation => annotation.kind === 'comment')
  const arm = comment?.arms.find(item => item.name === 'comment')
  return arm === undefined ? undefined : source.slice(arm.range.start, arm.range.end)
}

describe('Comment payload spelling', () => {
  it.each([
    { text: 'plain note', payload: 'plain note', escaped: false },
    { text: '', payload: '', escaped: false },
    { text: 'line one\n\nline two', payload: 'line one\n\nline two', escaped: false },
    { text: 'nested {++added++} and {>>inner<<}', payload: 'nested {++added++} and {>>inner<<}', escaped: false },
    // A closer stands against a code span still open inside the payload (L2a).
    { text: 'a code span `<<}` closes', payload: 'a code span `\\<<}` closes', escaped: true },
    { text: 'already \\<<} escaped', payload: 'already \\<<} escaped', escaped: false },
    { text: 'a \\ backslash', payload: 'a \\ backslash', escaped: false },
    { text: 'ends with <<} closer', payload: 'ends with \\<<} closer', escaped: true },
    { text: 'outer {>>inner<<} plus <<} literal', payload: 'outer {>>inner<<} plus \\<<} literal', escaped: true },
    { text: 'opens {>> without closing', payload: 'opens \\{>> without closing', escaped: true },
    { text: 'path C:\\', payload: 'path C:\\\\', escaped: true }
  ])('spells $text minimally', ({ text, payload, escaped }) => {
    expect(spellCommentPayload(text)).toEqual({ payload, escaped })
    // The spelling is the payload an ordinary parse of the Comment reads back.
    expect(commentPayload(`{>>${payload}<<}`)).toBe(payload)
  })

  it('replaces an existing Comment payload as one validated edit', () => {
    const core = createDocumentCore()
    const source = 'before {==text==}{>>old<<} after\n'
    const revision = core.open(source)
    const range = { start: 17, end: 26 }
    expect(core.planCommentEdit(revision, { range, text: 'new note' })).toEqual({
      edit: { start: 17, end: 26, insert: '{>>new note<<}' },
      escaped: false
    })
    const escaped = core.planCommentEdit(revision, { range, text: 'x <<} y' })
    expect(escaped).toEqual({ edit: { start: 17, end: 26, insert: '{>>x \\<<} y<<}' }, escaped: true })
    if (escaped === undefined) throw new Error('Missing comment edit')
    const applied = core.apply(revision, [escaped.edit]).revision
    expect(applied.source).toBe('before {==text==}{>>x \\<<} y<<} after\n')
    expect(applied.diagnostics).toEqual([])
    expect(revision.source).toBe(source)
  })

  it('edits a standalone and a nested Comment in place', () => {
    const core = createDocumentCore()
    const revision = core.open('a {>>old<<} b {++c{>>in<<}++}\n')
    expect(core.planCommentEdit(revision, { range: { start: 2, end: 11 }, text: 'new' })?.edit)
      .toEqual({ start: 2, end: 11, insert: '{>>new<<}' })
    expect(core.planCommentEdit(revision, { range: { start: 18, end: 26 }, text: 'end\\' }))
      .toEqual({ edit: { start: 18, end: 26, insert: '{>>end\\\\<<}' }, escaped: true })
  })

  it('refuses a range that is not a Comment', () => {
    const core = createDocumentCore()
    const revision = core.open('a {++b++} c\n')
    expect(core.planCommentEdit(revision, { range: { start: 2, end: 9 }, text: 'x' })).toBeUndefined()
    expect(core.planCommentEdit(revision, { range: { start: 0, end: 1 }, text: 'x' })).toBeUndefined()
  })

  it('reports MarkText-only escaping when authoring a comment', () => {
    const core = createDocumentCore()
    const revision = core.open('aaa')
    const plain = core.planAuthor(revision, { form: 'comment', range: { start: 0, end: 3 }, text: 'note' })
    expect(plain).toMatchObject({ edit: { insert: '{==aaa==}{>>note<<}' }, escaped: false })
    // A new Comment keeps Critic-looking text literal.
    const literal = core.planAuthor(revision, { form: 'comment', range: { start: 0, end: 3 }, text: '{--X--} <<}' })
    expect(literal).toMatchObject({ edit: { insert: '{==aaa==}{>>\\{--X\\--} \\<<}<<}' }, escaped: true })
    expect(spellCommentPayload('{--X--} <<}', undefined, true)).toEqual({ payload: '\\{--X\\--} \\<<}', escaped: true })
    const trailing = core.planAuthor(revision, { form: 'comment', range: { start: 0, end: 3 }, text: 'C:\\' })
    expect(trailing).toMatchObject({ edit: { insert: '{==aaa==}{>>C:\\\\<<}' }, escaped: true })
  })
})
