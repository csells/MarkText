import { expect, it } from 'vitest'
import { createDocumentCore } from '../src/index.js'

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

const type = (source: string, at: number, data: string, tracked: boolean): string => {
  const core = createDocumentCore()
  const previous = core.open(source)
  const selection = { ranges: [{ anchor: at, focus: at }], primary: 0 }
  const action = { selection, range: { start: at, end: at }, inputType: 'insertText', data, options }
  const edits = core.inputEdits(previous, action, core.planInput(previous, action), tracked)
  if (edits === undefined) throw new Error('Expected the key to compile')
  return core.apply(previous, edits).revision.source
}

// Typing right after one's own suggestion extends it, as in Google Docs.
it('extends a draft typed after it', () => {
  expect(type('Start {++crit++}\n', 16, 'x', true)).toBe('Start {++critx++}\n')
  expect(type('Start{~~~> {++crit++}~~}\n', 21, 'x', true)).toBe('Start{~~~> {++critx++}~~}\n')
})

// `{++` inside an Addition would read with the Addition's own `++}`.
it('respells a draft whose Addition cannot hold a typed opener', () => {
  const core = createDocumentCore()
  const source = type('Start{++ {+++}\n', 11, '+', true)
  expect(source).toBe('Start{~~~> {++~~}\n')
  const revision = core.open(source)
  expect(core.project(revision, 'original').markdown).toBe('Start\n')
  expect(type(source, 14, 'c', true)).toBe('Start{~~~> {++c~~}\n')
})

// CriticMarkup keeps the shapes it shares with Markdown extensions (owner
// decision, 12 October 2026): `~` in a Substitution's syntax is no strikethrough.
it.each([
  ['Start {}\n', 7, 'Start {~}\n'],
  ['Start {~}\n', 8, 'Start {~~}\n'],
  ['Start {~~old~>new}\n', 17, 'Start {~~old~>new~}\n'],
  ['Start {~~old~>new~}\n', 18, 'Start {~~old~>new~~}\n']
])('pairs no `~` typed in Substitution syntax (%s)', (source, at, expected) => {
  expect(type(source, at, '~', false)).toBe(expected)
})

it('still pairs `~` as strikethrough elsewhere', () => {
  expect(type('Start \n', 6, '~', false)).toBe('Start ~~\n')
  expect(type('{~~a~>b~~} \n', 11, '~', false)).toBe('{~~a~>b~~} ~~\n')
})
