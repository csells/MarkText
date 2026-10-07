import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentSourceEdit } from '../src/index.js'
import { planFromDocumentParse, planFromGeneralCompile } from '../src/internal/documentCoreInspection.js'
import { resolvedSuggestions } from '../src/trackedExtent.js'

// A tracked key that breaks a fence or math delimiter, or joins a line to
// the block above with punctuation typed at its start, changes the reading
// of the document beyond its own lines. Its suggestion is spelled over the
// lines that change, as the document reads them, before the spans are
// searched shortest first: a window and the document spell it alike, and
// Accept All gives the untracked edit, Reject All the document as it was.

const fence = '```js\nconst a = 0\nconst b = 1\n```'
const documentWith = (block: string): string =>
  `Intro {++x++}.\n\n<div>\nhtml 0\n</div>\n\n${block}\n\n> quoted {~~a~>b~~} line\n\nText {--y--} end.\n`

const control = (plan: (core: DocumentCore) => void): DocumentCore => {
  const core = createDocumentCore()
  plan(core)
  return core
}

const spellsAsTheDocument = (source: string, edit: DocumentSourceEdit): void => {
  const core = createDocumentCore()
  const opened = core.open(source)
  const planned = core.trackedEdit(opened, edit)
  if (planned === undefined) throw new Error('Expected a tracked spelling')
  for (const reference of [control(planFromGeneralCompile), control(planFromDocumentParse)]) {
    expect(reference.trackedEdit(reference.open(source), edit)).toEqual(planned)
  }
  const tracked = core.apply(opened, [planned]).revision
  const untrackedCore = createDocumentCore()
  const untrackedOpened = untrackedCore.open(source)
  const untracked = untrackedCore.apply(untrackedOpened, untrackedCore.markupEdit(untrackedOpened, edit) ?? [edit]).revision
  expect(resolvedSuggestions(tracked.source, tracked.annotations, 'accept'))
    .toBe(resolvedSuggestions(untracked.source, untracked.annotations, 'accept'))
  expect(resolvedSuggestions(tracked.source, tracked.annotations, 'reject'))
    .toBe(resolvedSuggestions(source, opened.annotations, 'reject'))
}

describe('tracked keys spelled over the lines their reading changes', () => {
  it.each([
    ['inside an opening fence run', '``', 'word'],
    ['inside a closing fence run', `${fence.slice(0, -1)}`, ']'],
    ['at the start of an opening fence run', '', '>']
  ])('spells a key typed %s', (_name, prefix, insert) => {
    const source = documentWith(fence)
    const at = source.indexOf(fence) + (prefix === '``' ? 2 : prefix.length)
    spellsAsTheDocument(source, { start: at, end: at, insert })
  })

  it('spells punctuation typed at the start of a list item below a table', () => {
    const source = 'Intro.\n\n| a | b |\n| - | - |\n| 1 | {++2++} |\n- item {++one++}\n- item {--two--}\n\nTail.\n'
    const at = source.indexOf('- item {++one')
    spellsAsTheDocument(source, { start: at, end: at, insert: '$' })
  })
})
