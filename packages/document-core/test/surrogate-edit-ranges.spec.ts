import { describe, expect, it } from 'vitest'
import { createDocumentCore, DocumentSourceEditError, type DocumentInputAction } from '../src/index.js'

// A source transaction never splits a UTF-16 surrogate pair: an edit whose
// start or end falls between the two halves of an astral code point, or whose
// insert holds a lone surrogate, is refused and no revision is published.

const EMOJI = '😀'
const source = `a${EMOJI}b`
const between = 2

describe('edits that would split a surrogate pair', () => {
  it.each([
    ['deletes the high half', { start: 1, end: between, insert: '' }],
    ['deletes the low half', { start: between, end: 3, insert: '' }],
    ['inserts between the halves', { start: between, end: between, insert: 'x' }],
    ['replaces from the middle of the pair', { start: between, end: 4, insert: 'y' }],
    ['inserts a lone high surrogate', { start: 0, end: 0, insert: '\uD83D' }],
    ['inserts a lone low surrogate', { start: 4, end: 4, insert: '\uDE00' }]
  ])('refuses an edit that %s', (_label, edit) => {
    const core = createDocumentCore()
    const revision = core.open(source)
    expect(() => core.apply(revision, [edit])).toThrow(DocumentSourceEditError)
    // Nothing was published: the same revision remains current and editable.
    expect(core.apply(revision, [{ start: 0, end: 0, insert: 'z' }]).revision.source).toBe(`z${source}`)
  })

  it('refuses a split pair in any edit of a transaction', () => {
    const core = createDocumentCore()
    const revision = core.open(`${EMOJI} ${EMOJI}`)
    expect(() => core.apply(revision, [
      { start: 0, end: 2, insert: '' },
      { start: 4, end: 4, insert: 'x' }
    ])).toThrow(DocumentSourceEditError)
  })

  it('refuses a reopen whose exact edits split a pair', () => {
    const core = createDocumentCore()
    const revision = core.open(source)
    expect(() => core.reopen(revision, 'a\uDE00b', [{ start: 1, end: between, insert: '' }])).toThrow(DocumentSourceEditError)
  })

  it('refuses native input whose target range splits a pair', () => {
    const core = createDocumentCore()
    const revision = core.open(source)
    const action: DocumentInputAction = {
      range: { start: 1, end: between },
      selection: { ranges: [{ anchor: between, focus: between }], primary: 0 },
      inputType: 'deleteContentBackward',
      data: null,
      options: { autoPairBracket: true, autoPairQuote: true, autoPairMarkdownSyntax: true }
    }
    for (const tracked of [false, true]) {
      expect(() => {
        const plan = core.planInput(revision, action, { tracked })
        const edits = core.inputEdits(revision, action, plan, tracked)
        if (edits !== undefined) core.apply(revision, edits)
      }).toThrow(DocumentSourceEditError)
    }
  })

  it('admits edits at code-point boundaries and around astral text', () => {
    const core = createDocumentCore()
    let revision = core.open(source)
    revision = core.apply(revision, [{ start: 1, end: 3, insert: '' }]).revision
    expect(revision.source).toBe('ab')
    revision = core.apply(revision, [{ start: 1, end: 1, insert: `${EMOJI}🇯🇵` }]).revision
    expect(revision.source).toBe(`a${EMOJI}🇯🇵b`)
    // A source opened with a lone surrogate stays editable around it.
    const malformed = core.open('a\uD83Db')
    expect(core.apply(malformed, [{ start: 3, end: 3, insert: 'c' }]).revision.source).toBe('a\uD83Dbc')
  })
})
