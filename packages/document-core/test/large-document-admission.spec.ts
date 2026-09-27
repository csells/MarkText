import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'

// Plan 0012 G35: every document upstream MarkText opens must open. Upstream
// has no node ceiling, so large ordinary and densely reviewed documents open,
// project every view the desktop reads, and accept typing, Enter and a tracked
// insertion that each read exactly as a fresh parse of the edited source.

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
const plainParagraph = 'Writing a useful document takes careful editing and a clear view of the text.'
const denseParagraph = 'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.'

type Key = Readonly<{ inputType: 'insertText', data: string } | { inputType: 'insertParagraph' }>

interface Session {
  readonly core: DocumentCore
  revision: DocumentRevision
  caret: number
}

const press = (session: Session, key: Key, tracked: boolean): void => {
  const { core, revision, caret } = session
  const action = {
    range: { start: caret, end: caret },
    selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
    inputType: key.inputType,
    data: 'data' in key ? key.data : null,
    options
  } as DocumentInputAction
  const plan = core.planInput(revision, action, { tracked })
  const edits = core.inputEdits(revision, action, plan, tracked)
  if (edits === undefined) throw new Error(`${key.inputType} was refused`)
  const commit = core.apply(revision, edits, { projections: ['markup'] })
  const selection = core.reconcileInput(revision, plan, commit, action).selection
  if (selection === undefined || !('ranges' in selection)) throw new Error('Expected a text selection')
  const focus = selection.ranges[selection.primary]?.focus
  if (focus === undefined) throw new Error('Expected a primary caret')
  session.caret = focus
  session.revision = commit.revision
}

const expectFreshParse = (session: Session): void => {
  const { core, revision } = session
  const oracle = createDocumentCore()
  const fresh = oracle.open(revision.source)
  expect(revision.annotations).toEqual(fresh.annotations)
  expect(revision.diagnostics).toEqual(fresh.diagnostics)
  expect(core.project(revision, 'markup').events).toEqual(oracle.project(fresh, 'markup').events)
  for (const mode of ['original', 'revised'] as const) {
    expect(core.project(revision, mode).markdown).toBe(oracle.project(fresh, mode).markdown)
  }
}

describe('documents larger than the former 65,536-node ceiling', () => {
  it.each([
    { name: '10,000 plain paragraphs', paragraph: plainParagraph, count: 10_000, wordEnd: 'Writing'.length },
    { name: '2,000 densely reviewed paragraphs', paragraph: denseParagraph, count: 2_000, wordEnd: 'Review'.length }
  ])('opens, projects and edits $name', ({ paragraph, count, wordEnd }) => {
    const source = Array.from({ length: count }, () => paragraph).join('\n\n') + '\n'
    const core = createDocumentCore()
    const revision = core.open(source)
    expect(revision.sourceLength).toBe(source.length)
    expect(core.project(revision, 'markup').events.length).toBeGreaterThanOrEqual(count)
    for (const mode of ['original', 'revised'] as const) {
      expect(core.project(revision, mode).markdown.length).toBeGreaterThan(count)
    }

    const middle = Math.floor(count / 2) * (paragraph.length + 2)
    const session: Session = { core, revision, caret: middle + wordEnd }
    press(session, { inputType: 'insertText', data: 'x' }, false)
    expect(session.revision.source.slice(middle, middle + wordEnd + 1)).toBe(paragraph.slice(0, wordEnd) + 'x')
    expectFreshParse(session)

    press(session, { inputType: 'insertParagraph' }, false)
    expect(session.revision.sourceLength).toBeGreaterThan(source.length + 1)
    expectFreshParse(session)

    press(session, { inputType: 'insertText', data: 'y' }, true)
    expect(session.revision.source).toContain('{++y++}')
    expectFreshParse(session)
  }, 120_000)
})
