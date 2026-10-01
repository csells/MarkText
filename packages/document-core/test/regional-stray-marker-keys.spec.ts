import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'
import { inspectDocumentCore, planFromDocumentParse } from '../src/internal/documentCoreInspection.js'

// Plan 0012 G35: stray and unfinished CriticMarkup markers are text with a
// diagnostic, and a document holding them is edited from the paragraphs
// around the caret like any other. Every regional result must be the one the
// document parse gives: a seeded differential compares each key with a core
// that plans from its document parse, and a long document with 10,000 stray
// markers takes typing, Enter, Backspace and Delete without a document parse.

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

const lcg = (seed: number) => (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

const blocks = [
  'Stray ++} closer and --} here.',
  'Unfinished {== opener here.',
  'Both {~~ and <<} marks.',
  'Arrow ~> lone text.',
  'Kept {++ok++} then {== open.',
  'Text {--gone--} and ++} stray.',
  'Open {>> note\n\nlater <<} closes',
  'Review {++new evidence++} and {~~old~>better~~} words.',
  'A paragraph of ordinary words.',
  '# Head {~~ open',
  '- item ==} x\n- more {== y',
  '> quoted {== open --}'
]

type Key = 'insertText' | 'insertParagraph' | 'insertLineBreak' | 'deleteContentBackward' | 'deleteContentForward'

const action = (caret: number, inputType: Key): DocumentInputAction => ({
  range: inputType === 'deleteContentBackward'
    ? { start: Math.max(0, caret - 1), end: caret }
    : inputType === 'deleteContentForward' ? { start: caret, end: caret + 1 } : { start: caret, end: caret },
  selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
  inputType,
  data: inputType === 'insertText' ? 'x' : null,
  options
}) as DocumentInputAction

/** A revision reached by a regional edit, so it holds no document parse. */
function regional(core: DocumentCore, source: string): DocumentRevision {
  return core.apply(core.open(source), [{ start: 1, end: 1, insert: 'q' }], { projections: ['markup'] }).revision
}

type Outcome = Readonly<{ plan?: unknown, edits?: unknown, selection?: unknown, source?: string, diagnostics?: unknown, error?: string }>

function press(core: DocumentCore, revision: DocumentRevision, caret: number, key: Key, tracked: boolean): Outcome {
  try {
    const input = action(caret, key)
    const plan = core.planInput(revision, input, { tracked })
    const edits = core.inputEdits(revision, input, plan, tracked)
    if (edits === undefined) return { plan }
    const commit = core.apply(revision, edits, { projections: ['markup'] })
    const result = core.reconcileInput(revision, plan, commit, input)
    return { plan, edits, selection: result.selection, source: commit.revision.source, diagnostics: commit.revision.diagnostics }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

const seeds = Number(process.env.MARKTEXT_STRAY_KEY_SEEDS ?? 12)
const first = Number(process.env.MARKTEXT_STRAY_KEY_FIRST ?? 1)

// Seed 187: a Substitution the window compile weighed repeated the window's
// divider, which in the document an unfinished Substitution opener before
// the window reads; the window, without that opener, chose another edit.
const regressionSeeds = [187].filter(seed => seed < first || seed >= first + seeds)

describe('keys in a document with stray markers read as the document parse', () => {
  it.each([...Array.from({ length: seeds }, (_, index) => first + index), ...regressionSeeds])('seed %i', seed => {
    const random = lcg(seed * 6781)
    let regionalKeys = 0
    for (let documentIndex = 0; documentIndex < 4; documentIndex += 1) {
      const count = 4 + Math.floor(random() * 6)
      const source = Array.from({ length: count }, () => blocks[Math.floor(random() * blocks.length)] ?? '')
        .join('\n\n') + '\n'
      const edited = source.slice(0, 1) + 'q' + source.slice(1)
      for (let trial = 0; trial < 6; trial += 1) {
        const caret = 2 + Math.floor(random() * (edited.length - 2))
        for (const key of ['insertText', 'insertParagraph', 'insertLineBreak', 'deleteContentBackward', 'deleteContentForward'] as const) {
          for (const tracked of [false, true]) {
            const core = createDocumentCore()
            const revision = regional(core, source)
            const before = inspectDocumentCore(core).documentParses
            const actual = press(core, revision, caret, key, tracked)
            if (inspectDocumentCore(core).documentParses === before) regionalKeys += 1
            const control = createDocumentCore()
            planFromDocumentParse(control)
            const expected = press(control, regional(control, source), caret, key, tracked)
            expect(actual, `${JSON.stringify(edited)} @${caret} ${key} tracked=${tracked}`).toEqual(expected)
            if (actual.source !== undefined) {
              const fresh = createDocumentCore().open(actual.source)
              expect(actual.diagnostics, 'diagnostics of a fresh parse').toEqual(fresh.diagnostics)
            }
          }
        }
      }
    }
    expect(regionalKeys).toBeGreaterThan(0)
  }, 120_000)
})

describe('keys in a document with 10,000 stray markers cost no document parse', () => {
  // Each paragraph holds a suggestion, stray closers and an unfinished
  // opener whose form no later closer spells, so every block is its own
  // region, as a draft full of half-typed markup is.
  const paragraphs = [
    (ordinal: number) => `Review ${ordinal} {++new evidence++} then stray --} and {== unfinished here.`,
    (ordinal: number) => `Notes ${ordinal} {--old words--} beside ++} and {~~ open words.`,
    (ordinal: number) => `Plain ${ordinal} {>>comment<<} with <<} stray closer and --} more.`
  ]
  const count = 5_001
  const texts = Array.from({ length: count }, (_, ordinal) => paragraphs[ordinal % 3]?.(ordinal) ?? '')
  const source = texts.join('\n\n') + '\n'
  const target = source.indexOf(texts[2_502] ?? '') + 'Review 2502 {++new evidence++} then stra'.length

  it('holds 10,000 stray markers', () => {
    expect(createDocumentCore().open(source).diagnostics.length).toBeGreaterThanOrEqual(10_000)
  })

  const keys: ReadonlyArray<{ name: string, key: Key, tracked: boolean }> = [
    { name: 'untracked typing', key: 'insertText', tracked: false },
    { name: 'untracked Enter', key: 'insertParagraph', tracked: false },
    { name: 'untracked Backspace', key: 'deleteContentBackward', tracked: false },
    { name: 'untracked Delete', key: 'deleteContentForward', tracked: false },
    { name: 'tracked typing', key: 'insertText', tracked: true },
    { name: 'tracked Enter', key: 'insertParagraph', tracked: true },
    { name: 'tracked Backspace', key: 'deleteContentBackward', tracked: true },
    { name: 'tracked Delete', key: 'deleteContentForward', tracked: true }
  ]
  it.each(keys)('$name', ({ key, tracked }) => {
    const core = createDocumentCore()
    const revision = regional(core, source)
    const before = inspectDocumentCore(core).documentParses
    const actual = press(core, revision, target + 1, key, tracked)
    expect(actual.error).toBeUndefined()
    expect(inspectDocumentCore(core).documentParses - before).toBe(0)
    const oracle = createDocumentCore()
    const fresh = oracle.open(actual.source ?? '')
    expect(actual.diagnostics).toEqual(fresh.diagnostics)
  }, 60_000)
})
