import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'

const options = { autoPairBracket: false, autoPairMarkdownSyntax: false, autoPairQuote: false }
const lineBreak = (at: number): DocumentInputAction => ({
  selection: { ranges: [{ anchor: at, focus: at }], primary: 0 },
  range: { start: at, end: at },
  inputType: 'insertLineBreak',
  data: '\n',
  options
})
const perform = (core: ReturnType<typeof createDocumentCore>, previous: DocumentRevision, action: DocumentInputAction) => {
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  if (edits === undefined) throw new Error('Input was refused')
  const commit = core.apply(previous, edits)
  const selection = core.reconcileInput(previous, plan, commit, action).selection
  if (selection === undefined || !('ranges' in selection)) throw new Error('Expected a text selection')
  return { revision: commit.revision, source: commit.revision.source, caret: selection.ranges[selection.primary]?.anchor }
}

// Shift+Enter on an empty line of a paragraph ends the paragraph instead, as
// upstream does (#5300): the soft break and its hard-break marker go, and the
// caret starts the next block.
it.each([
  { source: 'abc  \ndef\n', at: 6, expected: 'abc\n\ndef\n' },
  { source: 'abc\\\ndef\n', at: 5, expected: 'abc\n\ndef\n' },
  { source: 'abc\ndef\n', at: 4, expected: 'abc\n\ndef\n' },
])('ends the paragraph for $source', ({ source, at, expected }) => {
  const core = createDocumentCore()
  expect(perform(core, core.open(source), lineBreak(at)).source).toBe(expected)
})

it.each([
  { source: '- abc\n', at: 5, expected: '- abc\n- \n' },
  { source: '> abc\n', at: 5, expected: '> abc\n>\n> \n' },
  { source: 'abc\n', at: 3, expected: 'abc\n\n\n' }
])('ends the paragraph after two breaks at the end of $source', ({ source, at, expected }) => {
  const core = createDocumentCore()
  const first = perform(core, core.open(source), lineBreak(at))
  if (first.caret === undefined) throw new Error('Expected a caret')
  expect(perform(core, first.revision, lineBreak(first.caret)).source).toBe(expected)
})
