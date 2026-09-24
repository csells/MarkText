import { expect, it } from 'vitest'
import { createDocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'

const options = { autoPairBracket: false, autoPairMarkdownSyntax: false, autoPairQuote: false }

const input = (at: number, inputType: string, data: string | null): DocumentInputAction => ({
  selection: { ranges: [{ anchor: at, focus: at }], primary: 0 },
  range: { start: at, end: at },
  inputType,
  data,
  options
})

/** Applies one native input through the production planning, compilation and selection path. */
const perform = (core: ReturnType<typeof createDocumentCore>, previous: DocumentRevision, action: DocumentInputAction) => {
  const plan = core.planInput(previous, action)
  const edits = core.inputEdits(previous, action, plan, false)
  if (edits === undefined) throw new Error('Input was refused')
  const commit = core.apply(previous, edits)
  const selection = core.reconcileInput(previous, plan, commit, action).selection
  if (selection === undefined || !('ranges' in selection)) throw new Error('Expected a text selection')
  const range = selection.ranges[selection.primary]
  if (range === undefined || range.anchor !== range.focus) throw new Error('Expected a caret')
  return { revision: commit.revision, caret: range.anchor }
}

// A caret beside hidden CriticMarkup delimiters has one visible position. Enter
// there splits outside the annotation, as it does beside visible `**` markers.
it.each([
  { source: 'word {~~old~>new~~}\n', at: 16, expected: 'word {~~old~>new~~}\n\n```\n' },
  { source: 'word {++add++}\n', at: 11, expected: 'word {++add++}\n\n```\n' },
  { source: 'word {--del--}\n', at: 11, expected: 'word {--del--}\n\n```\n' },
  { source: 'word {==hi==}\n', at: 10, expected: 'word {==hi==}\n\n```\n' },
  { source: 'word {==hi==}{>>note<<}\n', at: 10, expected: 'word {==hi==}{>>note<<}\n\n```\n' },
  { source: 'word {>>note<<}\n', at: 5, expected: 'word {>>note<<}\n\n```\n' },
  { source: 'word {==a {++b++}==}\n', at: 14, expected: 'word {==a {++b++}==}\n\n```\n' },
  { source: '# Title {++x++}\n', at: 12, expected: '# Title {++x++}\n\n```\n' },
  { source: '- item {++x++}\n', at: 11, expected: '- item {++x++}\n- ```\n' },
  { source: 'word **bold**\n', at: 13, expected: 'word **bold**\n\n```\n' }
])('Enter at the hidden end of $source starts a new paragraph after the closer', ({ source, at, expected }) => {
  const core = createDocumentCore()
  let { revision, caret } = perform(core, core.open(source), input(at, 'insertParagraph', null))
  for (const data of '```') ({ revision, caret } = perform(core, revision, input(caret, 'insertText', data)))
  expect(revision.source).toBe(expected)
  expect(caret).toBe(expected.length - 1)
})

it.each([
  { source: 'a {++b++} c\n', at: 6, expected: 'a {++b++}\n\n c\n', caret: 11 },
  { source: 'a {~~b~>c~~} d\n', at: 9, expected: 'a {~~b~>c~~}\n\n d\n', caret: 14 },
  { source: '{++add++} tail\n', at: 3, expected: '\n\n{++add++} tail\n', caret: 2 },
  { source: 'a {++b++}\n', at: 5, expected: 'a \n\n{++b++}\n', caret: 4 },
  { source: 'a{++aa++}a\n', at: 5, expected: 'a{++a\n\na++}a\n', caret: 7 },
  { source: 'a {~~b~>c~~}\n', at: 6, expected: 'a {~~b\n\n~>c~~}\n', caret: 8 }
])('Enter at $at in $source splits outside only the annotation edge at the caret', ({ source, at, expected, caret }) => {
  const core = createDocumentCore()
  const result = perform(core, core.open(source), input(at, 'insertParagraph', null))
  expect(result.revision.source).toBe(expected)
  expect(result.caret).toBe(caret)
})

it('keeps a soft line break outside a closed annotation', () => {
  const core = createDocumentCore()
  const result = perform(core, core.open('a {++b++} c\n'), input(6, 'insertLineBreak', null))
  expect(result.revision.source).toBe('a {++b++}\n c\n')
  expect(result.caret).toBe(10)
})

it('relates the raw native Enter echo to the relocated split', () => {
  const core = createDocumentCore()
  const previous = core.open('word {~~old~>new~~}\n')
  const action = input(16, 'insertParagraph', '\n')
  const plan = core.planInput(previous, action)
  const raw = core.apply(previous, [{ start: 16, end: 16, insert: '\n' }]).revision
  expect(core.apply(raw, plan.reconciliation).revision.source).toBe('word {~~old~>new~~}\n\n\n')
})
