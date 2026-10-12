import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'
import { inspectDocumentCore } from '../src/internal/documentCoreInspection.js'
import { dense } from './support/inputDriver.js'

// Every document upstream MarkText opens must open. Upstream
// has no node ceiling, so large ordinary and densely reviewed documents open,
// project every view the desktop reads, and accept typing, Enter and a tracked
// insertion that each read exactly as a fresh parse of the edited source.

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }
const plainParagraph = 'Writing a useful document takes careful editing and a clear view of the text.'

type Key = Readonly<{ inputType: 'insertText', data: string } | { inputType: 'insertParagraph' } | { inputType: 'deleteContentBackward' }>

interface Session {
  readonly core: DocumentCore
  revision: DocumentRevision
  caret: number
}

const press = (session: Session, key: Key, tracked: boolean): void => {
  const { core, revision, caret } = session
  const action = {
    range: { start: key.inputType === 'deleteContentBackward' ? caret - 1 : caret, end: caret },
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
    { name: '2,000 densely reviewed paragraphs', paragraph: dense, count: 2_000, wordEnd: 'Review'.length }
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

// A stray marker is ordinary text upstream, so no count of
// them refuses a document. The builder records every stray marker and
// annotation it writes, so the expected diagnostics, annotations and views
// come from the construction rather than from the parser under test.
type Piece = string | Readonly<{ stray: string }> | Readonly<{ annotation: string, kind: string }>

/** Closers come first: no opener precedes them, so every one is unmatched. */
const closerBlocks: ReadonlyArray<(ordinal: number) => readonly Piece[]> = [
  ordinal => [`Closer ${ordinal} `, { stray: '++}' }, ' text *em* ', { stray: '--}' }, ' and ', { stray: '~~}' }, ' end'],
  ordinal => [`# Heading ${ordinal} `, { stray: '==}' }, ' tail ', { stray: '<<}' }],
  ordinal => [`- item ${ordinal} `, { stray: '--}' }, ' with ', { annotation: '{++valid++}', kind: 'addition' }, ' then ', { stray: '++}' }],
  ordinal => [`Swap ${ordinal} `, { annotation: '{~~old~>new~~}', kind: 'substitution' }, ' then ', { stray: '~~}' }, ' and a lone ~> arrow'],
  ordinal => [`Note ${ordinal} `, { annotation: '{==marked==}', kind: 'highlight' }, { annotation: '{>>comment<<}', kind: 'comment' }, ' then ', { stray: '<<}' }, ' and ', { stray: '==}' }]
]

/** Openers come last: no stray closer follows them, so none terminates. */
const openerBlocks: ReadonlyArray<(ordinal: number) => readonly Piece[]> = [
  ordinal => [`Opener ${ordinal} `, { stray: '{++' }, ' text and ', { stray: '{--' }, ' more'],
  ordinal => [`## Head ${ordinal} `, { stray: '{==' }, ' open'],
  ordinal => [`> quote ${ordinal} `, { stray: '{>>' }, ' open'],
  ordinal => [`Swap ${ordinal} `, { stray: '{~~' }, ' open'],
  ordinal => [`Valid ${ordinal} `, { annotation: '{++add++}', kind: 'addition' }, ' beside ', { stray: '{--' }, ' open']
]

interface StrayDocument {
  readonly source: string
  readonly strays: ReadonlyArray<Readonly<{ start: number, marker: string }>>
  readonly annotations: ReadonlyArray<Readonly<{ kind: string, start: number, end: number }>>
}

function strayDocument(blocks: number): StrayDocument {
  let source = ''
  const strays: Array<Readonly<{ start: number, marker: string }>> = []
  const annotations: Array<Readonly<{ kind: string, start: number, end: number }>> = []
  const write = (pieces: readonly Piece[]): void => {
    for (const piece of pieces) {
      if (typeof piece === 'string') {
        source += piece
      } else if ('stray' in piece) {
        strays.push({ start: source.length, marker: piece.stray })
        source += piece.stray
      } else {
        annotations.push({ kind: piece.kind, start: source.length, end: source.length + piece.annotation.length })
        source += piece.annotation
      }
    }
    source += '\n\n'
  }
  for (let ordinal = 0; ordinal < blocks; ordinal += 1) write(closerBlocks[ordinal % closerBlocks.length]!(ordinal))
  for (let ordinal = 0; ordinal < blocks; ordinal += 1) write(openerBlocks[ordinal % openerBlocks.length]!(ordinal))
  return { source, strays, annotations }
}

const expectedDiagnostics = (document: StrayDocument): unknown[] => document.strays.map(({ start, marker }) => ({
  code: marker.startsWith('{') ? 'CM_UNTERMINATED_OPENER' : 'CM_UNMATCHED_CLOSER',
  range: { start, end: start + marker.length },
  metadata: marker === '{~~' ? { separatorSeen: 'false' } : {}
}))

/** Views escape stray delimiters so they stay text; compare their text. */
const unescapedView = (markdown: string): string => markdown.replace(/\\([{}~<>=+-])/gu, '$1')

describe('documents with more stray CriticMarkup markers than the former 1,024-diagnostic cap', () => {
  it('opens, projects and edits a document with 10,000 stray markers', () => {
    const document = strayDocument(3_125)
    expect(document.strays.length).toBeGreaterThanOrEqual(10_000)
    const core = createDocumentCore()
    const revision = core.open(document.source)
    expect(inspectDocumentCore(core).documentParses).toBe(1)
    expect(revision.diagnostics.map(({ code, range, metadata }) => ({ code, range, metadata })))
      .toEqual(expectedDiagnostics(document))
    expect(revision.annotations.map(({ kind, range }) => ({ kind, start: range.start, end: range.end })))
      .toEqual(document.annotations)
    expect(core.project(revision, 'markup').events.length).toBeGreaterThan(document.annotations.length)
    expect(unescapedView(core.project(revision, 'original').markdown)).toBe(document.source
      .replace(/\{\+\+.*?\+\+\}/gu, '')
      .replace(/\{~~(.*?)~>.*?~~\}/gu, '$1')
      .replace(/\{==(.*?)==\}/gu, '$1')
      .replace(/\{>>.*?<<\}/gu, ''))
    expect(unescapedView(core.project(revision, 'revised').markdown)).toBe(document.source
      .replace(/\{\+\+(.*?)\+\+\}/gu, '$1')
      .replace(/\{~~.*?~>(.*?)~~\}/gu, '$1')
      .replace(/\{==(.*?)==\}/gu, '$1')
      .replace(/\{>>.*?<<\}/gu, ''))

    // Typing, Enter and Backspace beside stray closers, then tracked beside
    // unfinished openers; each run of keys reads as a fresh parse of its source.
    const closerParagraph = document.source.indexOf('Closer 1500 ') + 'Closer'.length
    const session: Session = { core, revision, caret: closerParagraph }
    for (const [key, tracked] of [
      [{ inputType: 'insertText', data: 'x' }, false],
      [{ inputType: 'insertParagraph' }, false],
      [{ inputType: 'deleteContentBackward' }, false]
    ] as const) {
      press(session, key, tracked)
      expect(session.revision.diagnostics).toHaveLength(document.strays.length)
    }
    expectFreshParse(session)
    expect(session.revision.source.slice(closerParagraph - 'Closer'.length, closerParagraph + 1)).toBe('Closerx')

    session.caret = session.revision.source.indexOf('Opener 1500 ') + 'Opener'.length
    for (const key of [
      { inputType: 'insertText', data: 'y' },
      { inputType: 'insertParagraph' },
      { inputType: 'deleteContentBackward' }
    ] as const) {
      press(session, key, true)
      expect(session.revision.diagnostics).toHaveLength(document.strays.length)
    }
    expectFreshParse(session)
    expect(session.revision.source).toContain('Opener{++y')
  }, 300_000)

  it('does no more document parses to open or edit as stray markers grow', () => {
    // Recovery of unfinished openers once re-parsed per marker; a document
    // parse count that grows with the markers would bring that back.
    const parsesFor = (source: string, caret: number): readonly number[] => {
      const core = createDocumentCore()
      const session: Session = { core, revision: core.open(source), caret }
      const counts = [inspectDocumentCore(core).documentParses]
      for (const [key, tracked] of [
        [{ inputType: 'insertText', data: 'x' }, false],
        [{ inputType: 'insertParagraph' }, false],
        [{ inputType: 'insertText', data: 'y' }, true]
      ] as const) {
        const before = inspectDocumentCore(core).documentParses
        press(session, key, tracked)
        counts.push(inspectDocumentCore(core).documentParses - before)
      }
      return counts
    }
    const blockers = (count: number): string => '{== start\n\n' +
      Array.from({ length: count }, (_, ordinal) => `Blocker ${ordinal} {++ a {-- b {>> c`).join('\n\n') +
      '\n\nend ==} ++} --} <<}\n'
    const small = strayDocument(100)
    const large = strayDocument(1_000)
    expect(parsesFor(large.source, large.source.indexOf('Closer 500 ') + 6))
      .toEqual(parsesFor(small.source, small.source.indexOf('Closer 50 ') + 6))
    const largeBlockers = blockers(3_000)
    const smallBlockers = blockers(30)
    expect(parsesFor(largeBlockers, largeBlockers.indexOf('Blocker 1500 ') + 'Blocker'.length))
      .toEqual(parsesFor(smallBlockers, smallBlockers.indexOf('Blocker 15 ') + 'Blocker'.length))
  }, 300_000)
})
