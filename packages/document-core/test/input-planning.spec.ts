import { describe, expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
const insertion = (at: number, data: string) => ({
  range: { start: at, end: at }, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, inputType: 'insertText', data, options
})

describe('Core native input planning', () => {
  it('pairs a queued opener against the latest admitted document', () => {
    const core = createDocumentCore()
    const previous = core.open('seed')
    const current = core.apply(previous, [{ start: 4, end: 4, insert: 'a' }]).revision
    expect(core.planInput(current, insertion(5, '('))).toEqual({
      edits: [{ start: 5, end: 5, insert: '()' }],
      selection: { ranges: [{ anchor: 6, focus: 6 }], primary: 0 },
      reconciliation: [{ start: 6, end: 6, insert: ')' }]
    })
  })

  it('skips an existing closer without a source edit and reconciles its raw echo', () => {
    const core = createDocumentCore()
    const revision = core.open('seed()')
    expect(core.planInput(revision, insertion(5, ')'))).toEqual({
      edits: [],
      selection: { ranges: [{ anchor: 6, focus: 6 }], primary: 0 },
      reconciliation: [{ start: 6, end: 7, insert: '' }]
    })
  })

  it.each(['`seed `', '$seed + 1$', '{++`seed `++}'])('uses owned literal syntax for %s', source => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const at = source.indexOf('seed ') + 5
    expect(core.planInput(revision, insertion(at, '*'))).toEqual({
      edits: [{ start: at, end: at, insert: '*' }],
      selection: { ranges: [{ anchor: at + 1, focus: at + 1 }], primary: 0 },
      reconciliation: []
    })
  })

  it('pairs ordinary Markdown inside an addition using the same syntax owner', () => {
    const core = createDocumentCore()
    const revision = core.open('{++seed ++}')
    expect(core.planInput(revision, insertion(8, '*'))).toEqual({
      edits: [{ start: 8, end: 8, insert: '**' }],
      selection: { ranges: [{ anchor: 9, focus: 9 }], primary: 0 },
      reconciliation: [{ start: 9, end: 9, insert: '*' }]
    })
  })

  it('plans paired deletion from actual collapsed selection and its browser target range', () => {
    const core = createDocumentCore()
    const revision = core.open('seed()')
    expect(core.planInput(revision, {
      ...insertion(5, ''), range: { start: 4, end: 5 }, inputType: 'deleteContentBackward', data: null
    })).toEqual({
      edits: [{ start: 4, end: 6, insert: '' }],
      selection: { ranges: [{ anchor: 4, focus: 4 }], primary: 0 },
      reconciliation: [{ start: 4, end: 5, insert: '' }]
    })
  })

  it('retains selected annotation source while wrapping, with an explicit resulting selection', () => {
    const core = createDocumentCore()
    const revision = core.open('a{++bc++}d')
    expect(core.planInput(revision, {
      ...insertion(1, '('), range: { start: 1, end: 9 }, selection: { ranges: [{ anchor: 1, focus: 9 }], primary: 0 }
    })).toEqual({
      edits: [{ start: 1, end: 1, insert: '(' }, { start: 9, end: 9, insert: ')' }],
      selection: { ranges: [{ anchor: 2, focus: 10 }], primary: 0 },
      reconciliation: [{ start: 2, end: 2, insert: '{++bc++})' }]
    })
  })
  it('deletes a visible pair without consuming its hidden comment', () => {
    const core = createDocumentCore()
    const revision = core.open('({>>note<<})')
    expect(core.planInput(revision, {
      ...insertion(1, ''), range: { start: 0, end: 1 }, inputType: 'deleteContentBackward', data: null
    })).toEqual({
      edits: [{ start: 0, end: 1, insert: '' }, { start: 11, end: 12, insert: '' }],
      selection: { ranges: [{ anchor: 0, focus: 0 }], primary: 0 },
      reconciliation: [{ start: 10, end: 11, insert: '' }]
    })
  })

  it('skips an existing closer across a hidden comment with an explicit source selection', () => {
    const core = createDocumentCore()
    const revision = core.open('({>>note<<})')
    expect(core.planInput(revision, insertion(1, ')'))).toEqual({
      edits: [],
      selection: { ranges: [{ anchor: 12, focus: 12 }], primary: 0 },
      reconciliation: [{ start: 1, end: 2, insert: '' }]
    })
  })
})

it('cancels composition without editing source or losing the starting selection', () => {
  const core = createDocumentCore()
  const previous = core.open('a{++a++}a\n')
  const range = { start: 0, end: 8 }
  const selection = { ranges: [{ anchor: 0, focus: 8 }], primary: 0 }
  expect(core.planInput(previous, { range, selection, inputType: 'cancelComposition', data: null, options }))
    .toEqual({ edits: [], reconciliation: [], selection })
  expect(previous.source).toBe('a{++a++}a\n')
  expect(() => core.planInput(previous, { range: { start: 0, end: 100 }, selection, inputType: 'cancelComposition', data: null, options }))
    .toThrow()
})
