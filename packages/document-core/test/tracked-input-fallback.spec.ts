import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type DocumentSourceEdit } from '../src/index.js'
import { keepsTyping, resolveAll } from './support/resolvedSuggestions.js'

// Owner rules: with Track Changes on, every key untracked input accepts is
// accepted, and Reject All afterwards gives the previous Reject All. Typing
// into deleted or replaced text splits that suggestion at the caret, so
// Accept All keeps the typing and is otherwise unchanged; anywhere else,
// Accept All gives the untracked result's. These keys land where no spelling
// the tracked compile weighs reads that way, so the last-resort spelling
// proposes them.

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

function key(caret: number, inputType: 'insertText' | 'insertParagraph'): DocumentInputAction {
  return {
    range: { start: caret, end: caret },
    selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
    inputType,
    data: inputType === 'insertText' ? 'x' : null,
    options
  } as DocumentInputAction
}

function typed(source: string, input: DocumentInputAction, tracked: boolean) {
  const core = createDocumentCore()
  const revision = core.open(source)
  const edits = core.inputEdits(revision, input, core.planInput(revision, input, { tracked }), tracked)
  const next = edits === undefined ? undefined : core.apply(revision, edits).revision
  return { revision, edits, next }
}

function expectHistoryTyping(source: string, input: DocumentInputAction): readonly DocumentSourceEdit[] | undefined {
  const plain = typed(source, input, false)
  const tracked = typed(source, input, true)
  expect(plain.edits).toBeDefined()
  expect(tracked.next).toBeDefined()
  if (plain.edits === undefined || plain.next === undefined || tracked.next === undefined) return undefined
  const typing = plain.edits.map(edit => edit.insert).join('')
  expect(keepsTyping(resolveAll(tracked.next.source, 'accept'), resolveAll(source, 'accept'), typing)).toBe(true)
  expect(resolveAll(tracked.next.source, 'reject')).toBe(resolveAll(source, 'reject'))
  expect(tracked.next.diagnostics.length).toBeLessThanOrEqual(Math.max(tracked.revision.diagnostics.length, plain.next.diagnostics.length))
  return tracked.edits
}

describe('typing into deleted or replaced text a literal block holds', () => {
  const deleted = '{--```\ngone\n```\n--}\n\nPlain words here.\n'

  it('splits a Deletion of a fence at the typed line', () => {
    expect(expectHistoryTyping(deleted, key(deleted.indexOf('one'), 'insertText')))
      .toEqual([{ start: 0, end: 19, insert: '{--```\n--}{++x++}{--gone\n```\n--}' }])
  })

  it('splits a Deletion of a fence for Enter', () => {
    expect(expectHistoryTyping(deleted, key(deleted.indexOf('one'), 'insertParagraph')))
      .toEqual([{ start: 0, end: 19, insert: '{--```\n--}{++\n++}{--gone\n```\n--}' }])
  })

  it('keeps typing and Enter in a fenced Substitution\'s old arm', () => {
    const source = '{~~```\ngone\n```\n~>```\nnew\n```\n~~}\n\nPlain words here.\n'
    expect(expectHistoryTyping(source, key(source.indexOf('one'), 'insertText'))).toBeDefined()
    expect(expectHistoryTyping(source, key(source.indexOf('one'), 'insertParagraph'))).toBeDefined()
  })

  it('keeps Enter in an indented Substitution\'s old arm', () => {
    const source = 'Intro.\n\n{~~    indented 0\n    indented 1\n    indented 2\n~>    new 0\n~~}\n\nPlain.\n'
    expect(expectHistoryTyping(source, key(source.indexOf('indented 1'), 'insertParagraph'))).toBeDefined()
  })
})

describe('typing into deleted or replaced text nested in a suggestion', () => {
  it('splits a Deletion an Addition holds', () => {
    const source = '{++new {--```\ngone\n```\n--} tail++}\n'
    const at = source.indexOf('one')
    expect(expectHistoryTyping(source, key(at, 'insertText'))).toEqual([{ start: at, end: at, insert: '--}{++x++}{--' }])
  })

  it('keeps typing in the proposed text of a Substitution an old arm holds', () => {
    const source = 'Intro.\n\n{~~{~~old~>new words~~} tail~>other~~}\n'
    expect(expectHistoryTyping(source, key(source.indexOf(' words'), 'insertText'))).toBeDefined()
    const fenced = '{~~{~~```\nold\n```\n~>```\nnq\nqqw\n```\n~~}~>other\n~~}\n'
    expect(expectHistoryTyping(fenced, key(fenced.indexOf('```\n~~}~>'), 'insertParagraph')))
      .toEqual([{ start: 0, end: 49, insert: '{++\n++}{~~{~~```\nold\n```\n~>```\nnq\nqqw\n```\n~~}~>other\n~~}' }])
  })

  it('keeps Enter in a Substitution an old arm holds beside a broken one', () => {
    // Splitting the inner Substitution would leave the typing in the outer
    // one's old arm, and a paragraph break before the outer one would change
    // how its broken new arm reads; the break follows it instead.
    const source = 'x{~~{~~```\nold\n```\n~>``x`\nnq\nqqw\n```\n~~}~>{~~```\nold\n``x`\n~>``x`\nnq\nqqw\n```\n~~}~~}\n'
    const after = source.length - 1
    expect(expectHistoryTyping(source, key(source.indexOf('old\n```') + 4, 'insertParagraph')))
      .toEqual([{ start: after, end: after, insert: '{++\n\n++}' }])
  })
})
