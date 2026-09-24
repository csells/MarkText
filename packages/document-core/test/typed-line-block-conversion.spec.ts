import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'

const paired = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
const unpaired = { autoPairBracket: false, autoPairMarkdownSyntax: false, autoPairQuote: false }

const typeAt = (source: string, at: number, typed: string, { options = paired, tracked = false } = {}) => {
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
    const edits = core.inputEdits(revision, action, plan, tracked)
    if (edits === undefined) throw new Error(`Typing ${JSON.stringify(data)} was refused`)
    const commit = core.apply(revision, edits)
    const selection = core.reconcileInput(revision, plan, commit, action).selection
    if (selection === undefined || !('ranges' in selection)) throw new Error('Expected a text selection')
    caret = selection.ranges[selection.primary]!.focus
    revision = commit.revision
  }
  return { source: revision.source, caret }
}

const view = (source: string, name: 'original' | 'revised'): string => {
  const core = createDocumentCore()
  return core.project(core.open(source), name).markdown
}

// Upstream MarkText (8d6c198c) converts the typed line of a multi-line
// paragraph into its own block, splitting the lines before it into a
// paragraph and serializing each block afresh. Bytes were recorded from
// upstream Muya for the same keys with default preferences.
const conversions = [
  // Upstream's quote caret, measured from the paragraph's start, slips into a
  // later line's quoted text; the caret stays before it, as on a first line.
  { source: 'first\nsecond\n', at: 6, typed: '>', expected: 'first\n\n> second\n', caret: 9 },
  { source: 'first\nsecond\nthird\n', at: 6, typed: '>', expected: 'first\n\n> second\n> third\n', caret: 9 },
  { source: 'first\nsecond\n', at: 6, typed: '# ', expected: 'first\n\n# second\n', caret: 9 },
  { source: 'first\nsecond\n', at: 6, typed: '## ', expected: 'first\n\n## second\n', caret: 10 },
  { source: 'first\nsecond\nthird\n', at: 6, typed: '# ', expected: 'first\n\n# second\n\nthird\n', caret: 9 },
  { source: 'first\nsecond\n', at: 6, typed: '- ', expected: 'first\n\n- second\n', caret: 9 },
  { source: 'first\nsecond\nthird\n', at: 6, typed: '- ', expected: 'first\n\n- second\n  third\n', caret: 9 },
  { source: 'first\nsecond\nthird\n', at: 6, typed: '+ ', expected: 'first\n\n+ second\n  third\n', caret: 9 },
  { source: 'first\nsecond\n', at: 6, typed: '* ', expected: 'first\n\n* *second\n', caret: 9 },
  { source: 'first\nsecond\nthird\n', at: 6, typed: '1. ', expected: 'first\n\n1. second\n   third\n', caret: 10 },
  { source: 'first\nsecond\n', at: 6, typed: '2. ', expected: 'first\n\n2. second\n', caret: 10 },
  { source: 'first\nsecond\n', at: 6, typed: '1) ', expected: 'first\n\n1) second\n', caret: 10 },
  { source: 'first  \nsecond\n', at: 8, typed: '# ', expected: 'first  \n\n# second\n', caret: 11 },
  // The first line of a multi-line paragraph carries the paragraph's later lines.
  { source: 'first\nsecond\nthird\n', at: 0, typed: '>', expected: '> first\n> second\n> third\n', caret: 2 },
  { source: 'first\nsecond\nthird\n', at: 0, typed: '# ', expected: '# first\n\nsecond\nthird\n', caret: 2 },
  { source: 'first\nsecond\n', at: 0, typed: '- ', expected: '- first\n  second\n', caret: 2 },
  { source: 'first\nsecond\nthird\n', at: 0, typed: '1. ', expected: '1. first\n   second\n   third\n', caret: 3 },
  // Containers write their own prefix on each new line.
  { source: '> first\n> second\n', at: 10, typed: '>', expected: '> first\n>\n> > second\n', caret: 14 },
  { source: '> first\n> second\n> third\n', at: 10, typed: '# ', expected: '> first\n>\n> # second\n>\n> third\n', caret: 14 },
  { source: '> first\n> second\n> third\n', at: 10, typed: '- ', expected: '> first\n>\n> - second\n>   third\n', caret: 14 },
  { source: '- first\n  second\n  third\n', at: 10, typed: '>', expected: '- first\n\n  > second\n  > third\n', caret: 13 },
  { source: '- first\n  second\n  third\n', at: 10, typed: '# ', expected: '- first\n\n  # second\n\n  third\n', caret: 13 },
  // A list nested in a tight list item follows its paragraph without a blank line.
  { source: '- first\n  second\n  third\n', at: 10, typed: '1. ', expected: '- first\n  1. second\n     third\n', caret: 13 }
]

// Keys that upstream leaves as paragraph text.
const unconverted = [
  { source: 'first\nsecond\nthird\n', at: 12, typed: '>', expected: 'first\nsecond>\nthird\n', caret: 13 },
  { source: 'first\nsecond\n', at: 6, typed: '#x', expected: 'first\n#xsecond\n', caret: 8 },
  { source: 'first\nsecond\n', at: 6, typed: '-x', expected: 'first\n-xsecond\n', caret: 8 },
  { source: 'first\nsecond\nthird\n', at: 12, typed: '# ', expected: 'first\nsecond# \nthird\n', caret: 14 }
]

describe('typing a block marker on a paragraph line matches upstream', () => {
  it.each(conversions)('types $typed at $at of $source', ({ source, at, typed, expected, caret }) => {
    expect(typeAt(source, at, typed)).toEqual({ source: expected, caret })
  })

  it.each(conversions)('types $typed at $at of $source without auto-pairing', ({ source, at, typed, expected, caret }) => {
    // Without auto-pairing the star is not doubled.
    const plain = typed === '* ' ? expected.replace('* *', '* ') : expected
    expect(typeAt(source, at, typed, { options: unpaired })).toEqual({ source: plain, caret })
  })

  it.each(unconverted)('keeps $typed at $at of $source as text', ({ source, at, typed, expected, caret }) => {
    expect(typeAt(source, at, typed)).toEqual({ source: expected, caret })
  })

  it.each(conversions)('tracks $typed at $at of $source as a suggestion of the same text', ({ source, at, typed }) => {
    const ordinary = typeAt(source, at, typed).source
    const tracked = typeAt(source, at, typed, { tracked: true }).source
    expect(tracked).not.toBe(ordinary)
    expect(view(tracked, 'revised')).toBe(view(ordinary, 'revised'))
    expect(view(tracked, 'original')).toBe(view(source, 'original'))
  })

  it.each([
    // Upstream treats annotation delimiters as literal text, so the line's
    // start is before an opener that begins it.
    { source: 'first\n{++second++}\n', at: 6, typed: '>', expected: 'first\n\n> {++second++}\n', caret: 9 },
    { source: 'first\n{++second++}\nthird\n', at: 6, typed: '# ', expected: 'first\n\n# {++second++}\n\nthird\n', caret: 9 },
    { source: 'first\n{==second==}\nthird\n', at: 6, typed: '- ', expected: 'first\n\n- {==second==}\n  third\n', caret: 9 },
    { source: '{++first\nsecond++}\nthird\n', at: 9, typed: '# ', expected: '{++first\n\n# second++}\n\nthird\n', caret: 12 }
  ])('types $typed on an annotated line of $source', ({ source, at, typed, expected, caret }) => {
    expect(typeAt(source, at, typed)).toEqual({ source: expected, caret })
  })
})
