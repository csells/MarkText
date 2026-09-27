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
  parses: number
}

const open = (source: string, caret: number): Session => {
  const core = createDocumentCore()
  const revision = core.open(source)
  core.project(revision, 'markup')
  return { core, revision, caret, parses: 0 }
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
  const commit = core.apply(revision, edits, { projections: ['markup'] })
  const result = core.reconcileInput(revision, plan, commit, action)
  session.parses += inspectDocumentCore(core).documentParses - before
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
    session.parses = 0
    for (const data of ['y', 'z', 'é', '🙂']) press(session, { inputType: 'insertText', data }, true)
    expect(session.parses).toBe(0)
    expect(session.revision.source.slice(paragraphStart(index), paragraphStart(index) + 20)).toBe('Writing{++xyzé🙂++} ')
    expectFullParseParity(session)
  })
})
