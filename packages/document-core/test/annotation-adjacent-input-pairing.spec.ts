import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'

const paired = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
const unpaired = { autoPairBracket: false, autoPairMarkdownSyntax: false, autoPairQuote: false }

const typeAt = (source: string, at: number, typed: string, options = paired) => {
  const core = createDocumentCore()
  let revision: DocumentRevision = core.open(source)
  let caret = at
  for (const data of typed) {
    const action: DocumentInputAction = {
      selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
      range: { start: caret, end: caret },
      inputType: 'insertText',
      data,
      options
    }
    const plan = core.planInput(revision, action)
    const edits = core.inputEdits(revision, action, plan, false)
    if (edits === undefined) throw new Error(`Typing ${JSON.stringify(data)} was refused`)
    const commit = core.apply(revision, edits)
    const selection = core.reconcileInput(revision, plan, commit, action).selection
    if (selection === undefined || !('ranges' in selection)) throw new Error('Expected a text selection')
    caret = selection.ranges[selection.primary]!.focus
    revision = commit.revision
  }
  return { source: revision.source, caret }
}

// Upstream MarkText (8d6c198c) pairs from the raw characters beside the caret,
// so annotation delimiters there are ordinary punctuation to its input policy.
// Expected bytes and carets were recorded from upstream Muya for the same keys.
const afterCloser: ReadonlyArray<readonly [string, string, number]> = [
  ['*', '**', 1], ['_', '__', 1], ['$', '$$', 1], ['~', '~~', 1], ['`', '`', 1],
  ['"', '""', 1], ['\'', '\'\'', 1], ['(', '()', 1], ['[', '[]', 1], ['{', '{}', 1],
  ['**', '****', 2], ['~~~', '~~~~~~', 3], ['***', '******', 3], ['___', '______', 3],
  ['$$$', '$$$$', 3], ['```', '```', 3]
]

describe('input pairing beside annotation delimiters matches upstream', () => {
  for (const annotation of ['{++x++}', '{--x--}', '{==x==}', '{~~o~>n~~}', '{>>c<<}', '{==x==}{>>c<<}']) {
    it.each(afterCloser)(`types %j after a line-final ${annotation}`, (typed, inserted, caret) => {
      const source = `${annotation}\n`
      expect(typeAt(source, annotation.length, typed)).toEqual({
        source: `${annotation}${inserted}\n`,
        caret: annotation.length + caret
      })
    })

    it.each(afterCloser)(`types %j after a mid-line ${annotation} before a space`, (typed, inserted, caret) => {
      const at = 2 + annotation.length
      expect(typeAt(`a ${annotation} b\n`, at, typed)).toEqual({
        source: `a ${annotation}${inserted} b\n`,
        caret: at + caret
      })
    })

    it.each(afterCloser)(`types %j after ${annotation} without auto-pairing`, (typed) => {
      expect(typeAt(`${annotation}\n`, annotation.length, typed, unpaired)).toEqual({
        source: `${annotation}${typed}\n`,
        caret: annotation.length + typed.length
      })
    })
  }

  it.each([
    // Upstream sees the closer's `+` after the caret, which touches the key.
    { source: '{++x++} b\n', at: 4, typed: '"', expected: '{++x"++} b\n', caret: 5 },
    { source: '{++x++} b\n', at: 4, typed: '[', expected: '{++x[++} b\n', caret: 5 },
    // Upstream sees the opener's `+` before the caret, which is not a word character.
    { source: 'a{++x++}\n', at: 4, typed: '*', expected: 'a{++**x++}\n', caret: 5 },
    // Before an opener, the `{` after the caret touches a quote or bracket.
    { source: 'a {++x++}\n', at: 2, typed: '(', expected: 'a ({++x++}\n', caret: 3 }
  ])('types $typed beside the delimiters of $source at $at', ({ source, at, typed, expected, caret }) => {
    expect(typeAt(source, at, typed)).toEqual({ source: expected, caret })
  })

  // Upstream would step over the next `~` of the closer. A caret cannot occupy
  // an annotation delimiter, so the key is inserted as typed instead.
  it('inserts a tilde before a substitution closer instead of entering it', () => {
    expect(typeAt('{~~o~>n~~} b\n', 7, '~')).toEqual({ source: '{~~o~>n~~~} b\n', caret: 8 })
  })
})

describe('input pairing on an opener-only fence line matches upstream', () => {
  // Upstream keeps the line a paragraph until Enter converts it.
  it.each([
    { source: '\n', at: 0, typed: '~~~', expected: '~~~~~~\n', caret: 3 },
    { source: 'plain tail\n', at: 0, typed: '~~~', expected: '~~~~~~plain tail\n', caret: 3 },
    { source: '\n', at: 0, typed: '~~~~', expected: '~~~~~~~~\n', caret: 4 },
    { source: '\n', at: 0, typed: '```', expected: '```\n', caret: 3 }
  ])('types $typed at $at of $source', ({ source, at, typed, expected, caret }) => {
    expect(typeAt(source, at, typed)).toEqual({ source: expected, caret })
  })
})

describe('typing a block quote marker before paragraph text matches upstream', () => {
  // Upstream converts `>` followed by text into a quote at once and writes its
  // marker as `> `; a following space is typed into the quoted paragraph.
  it.each([
    { source: 'plain tail\n', at: 0, typed: '>', expected: '> plain tail\n', caret: 2 },
    { source: 'plain tail\n', at: 0, typed: '> ', expected: '>  plain tail\n', caret: 3 },
    { source: '{++add++} tail\n', at: 0, typed: '> ', expected: '>  {++add++} tail\n', caret: 3 },
    { source: '- item\n', at: 2, typed: '>', expected: '- > item\n', caret: 4 },
    { source: '\n', at: 0, typed: '> ', expected: '> \n', caret: 2 },
    { source: 'lead tail\n', at: 5, typed: '> ', expected: 'lead > tail\n', caret: 7 }
  ])('types $typed at $at of $source', ({ source, at, typed, expected, caret }) => {
    expect(typeAt(source, at, typed)).toEqual({ source: expected, caret })
    expect(typeAt(source, at, typed, unpaired)).toEqual({ source: expected, caret })
  })
})
