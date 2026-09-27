import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'

// Plan 0012 G35: ordinary tracked typing and structural keys reuse the
// unchanged document instead of reparsing it. Every case also checks the
// regional result against an independent full parse of the same source.

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
const paragraph = 'Writing a useful document takes careful editing and a clear view of the text.'
const plain = (count: number): string => Array.from({ length: count }, () => paragraph).join('\n\n') + '\n'
const paragraphStart = (index: number): number => index * (paragraph.length + 2)

type Key = Readonly<{ inputType: 'insertText', data: string } | { inputType: 'insertParagraph' | 'deleteContentBackward' | 'deleteContentForward' }>

interface Session {
  readonly core: DocumentCore
  revision: DocumentRevision
  caret: number
  /** Document parses while planning and compiling keys. */
  parses: number
  /** Document parses while committing keys. */
  commitParses: number
  readonly keys: Array<Readonly<{ planned: number, committed: number }>>
}

const open = (source: string, caret: number): Session => {
  const core = createDocumentCore()
  const revision = core.open(source)
  core.project(revision, 'markup')
  return { core, revision, caret, parses: 0, commitParses: 0, keys: [] }
}

/** One native key through the same planning, compilation and commit the desktop adapter uses. */
const press = (session: Session, key: Key, tracked: boolean, range?: Readonly<{ start: number, end: number }>): void => {
  const { core, revision, caret } = session
  const target = range ?? (key.inputType === 'deleteContentBackward'
    ? { start: caret - 1, end: caret }
    : key.inputType === 'deleteContentForward' ? { start: caret, end: caret + 1 } : { start: caret, end: caret })
  const action = {
    range: target,
    selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
    inputType: key.inputType,
    data: 'data' in key ? key.data : null,
    options
  } as DocumentInputAction
  const before = inspectDocumentCore(core).documentParses
  const plan = core.planInput(revision, action, { tracked })
  const edits = core.inputEdits(revision, action, plan, tracked)
  if (edits === undefined) throw new Error(`${key.inputType} was refused`)
  const planned = inspectDocumentCore(core).documentParses
  session.parses += planned - before
  const commit = core.apply(revision, edits, { projections: ['markup'] })
  const result = core.reconcileInput(revision, plan, commit, action)
  const committed = inspectDocumentCore(core).documentParses - planned
  session.commitParses += committed
  session.keys.push({ planned: planned - before, committed })
  const selection = result.selection
  if (selection === undefined || !('ranges' in selection)) throw new Error('Expected a text selection')
  const focus = selection.ranges[selection.primary]?.focus
  if (focus === undefined) throw new Error('Expected a primary caret')
  session.caret = focus
  session.revision = commit.revision
}

/** The regional revision reads exactly as a fresh parse of its source. */
const expectFullParseParity = (session: Session): void => {
  const { core, revision } = session
  const oracle = createDocumentCore()
  const fresh = oracle.open(revision.source)
  expect(revision.annotations).toEqual(fresh.annotations)
  expect(revision.diagnostics).toEqual(fresh.diagnostics)
  const actual = core.project(revision, 'markup')
  const expected = oracle.project(fresh, 'markup')
  expect(actual.events).toEqual(expected.events)
  expect(actual.syntax.ast).toEqual(expected.syntax.ast)
  for (const mode of ['original', 'revised'] as const) {
    expect(core.project(revision, mode).markdown).toBe(oracle.project(fresh, mode).markdown)
  }
}

describe('tracked typing extends its suggestion without a document parse', () => {
  it.each([
    { location: 'first', index: 0 },
    { location: 'middle', index: 100 },
    { location: 'last', index: 199 }
  ])('at the end of the only Addition in the $location paragraph', ({ index }) => {
    const source = plain(200)
    const session = open(source, paragraphStart(index) + 7)
    press(session, { inputType: 'insertText', data: 'x' }, true)
    expect(session.revision.source.slice(paragraphStart(index), paragraphStart(index) + 15)).toBe('Writing{++x++} ')
    for (const data of ['y', 'z', 'é', '🙂']) press(session, { inputType: 'insertText', data }, true)
    expect(session.parses + session.commitParses).toBe(0)
    expect(session.revision.source.slice(paragraphStart(index), paragraphStart(index) + 20)).toBe('Writing{++xyzé🙂++} ')
    expectFullParseParity(session)
  })
})

describe('structural keys and new suggestions reparse only their paragraphs', () => {
  const suggestions = (count: number): string => Array.from({ length: count }, (_, index) =>
    index % 2 === 0 ? `Suggested {++addition ${index}++} text.` : `Retired {--deletion ${index}--} text.`).join('\n\n')
  const fixtures = [
    { name: 'a plain document', source: plain(300) },
    { name: 'a document whose suggestions all precede the edit', source: suggestions(20) + '\n\n' + plain(300) },
    { name: 'a document with one suggestion', source: plain(100) + 'One {++suggestion++} here.\n\n' + plain(200) }
  ]
  // Forty paragraphs before the end: after the last suggestion, away from both document edges.
  const target = (source: string): number => source.length - 40 * (paragraph.length + 2) + 30

  for (const fixture of fixtures) {
    for (const tracked of [false, true]) {
      it(`${tracked ? 'tracked' : 'untracked'} typing, Enter and a Backspace join in ${fixture.name}`, () => {
        const session = open(fixture.source, target(fixture.source))
        press(session, { inputType: 'insertText', data: 'x' }, tracked)
        press(session, { inputType: 'insertText', data: 'y' }, tracked)
        press(session, { inputType: 'insertParagraph' }, tracked)
        press(session, { inputType: 'insertText', data: 'z' }, tracked)
        press(session, { inputType: 'insertParagraph' }, tracked)
        // Backspace at the next paragraph's start joins it to the one before.
        const start = session.revision.source.indexOf('\n\nWriting', session.caret) + 2
        session.caret = start
        press(session, { inputType: 'deleteContentBackward' }, tracked, { start: start - 2, end: start })
        const [first, second, enter, typed, secondEnter, join] = session.keys
        // Typing plans and commits regionally, and so does a first suggestion
        // in a document spelling no other CriticMarkup.
        const firstSuggestionIsRegional = !tracked || fixture.name === 'a plain document'
        expect(first).toEqual(firstSuggestionIsRegional ? { planned: 0, committed: 0 } : expect.anything())
        for (const key of [second, typed]) expect(key).toEqual({ planned: 0, committed: 0 })
        // Enter commits regionally, inside a suggestion too.
        for (const key of [enter, secondEnter]) expect(key?.committed).toBe(0)
        // An untracked join commits regionally. A tracked join spells a new
        // Deletion, which only a marker-free document admits regionally.
        if (!tracked) expect(join?.committed).toBe(0)
        expectFullParseParity(session)
      })
    }
  }
})
