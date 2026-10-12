import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'
import { inspectDocumentCore, planFromDocumentParse, searchWithoutBudget } from '../src/internal/documentCoreInspection.js'

// In a document dense with suggestions, typing, Enter,
// Backspace and Delete are planned and proved from the paragraphs around
// the caret. Every regional result must be the one the document parse gives:
// a seeded differential compares each key with a core that plans from its
// document parse.

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

const lcg = (seed: number) => (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

const blocks = [
  'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.',
  'Plain words before {--struck--} and after.',
  'Words {--one--}{++two++} and {~~a~>b~~}.',
  'A paragraph of ordinary words.',
  'Text with {++added++} inside.',
  'Note {==marked==}{>>comment<<} end.',
  '{--Whole paragraph deletion.--}',
  'Para *em* and {--gone--} here.',
  '# Heading {++new++}',
  '- item {--one--}\n- item two',
  '- same\n{~~- ~>\n  ~~}target\n- last',
  '- {++sa++}me{>>keep<<}\n- target\n- end',
  'Line {++one\ntwo++} words.'
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

function regional(core: DocumentCore, source: string): DocumentRevision {
  return core.apply(core.open(source), [{ start: 1, end: 1, insert: 'q' }], { projections: ['markup'] }).revision
}

type Outcome = Readonly<{ plan?: unknown, edits?: unknown, selection?: unknown, source?: string, error?: string }>

function press(core: DocumentCore, revision: DocumentRevision, caret: number, key: Key, tracked: boolean): Outcome {
  try {
    const input = action(caret, key)
    const plan = core.planInput(revision, input, { tracked })
    const edits = core.inputEdits(revision, input, plan, tracked)
    if (edits === undefined) return { plan }
    const commit = core.apply(revision, edits, { projections: ['markup'] })
    const result = core.reconcileInput(revision, plan, commit, input)
    return { plan, edits, selection: result.selection, source: commit.revision.source }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

const seeds = Number(process.env.MARKTEXT_DENSE_KEY_SEEDS ?? 12)
const first = Number(process.env.MARKTEXT_DENSE_KEY_FIRST ?? 1)

describe('keys in a document dense with suggestions read as the document parse', () => {
  // Seeds past the range once diverged: Enter beside a Deletion of a whole
  // paragraph between two lists, which join in the Revised view.
  const regressionSeeds = [140, 188, 189, 240, 324, 359]
  it.each([...Array.from({ length: seeds }, (_, index) => first + index), ...regressionSeeds])('seed %i', seed => {
    const random = lcg(seed * 7727)
    let regionalKeys = 0
    for (let documentIndex = 0; documentIndex < 4; documentIndex += 1) {
      const count = 4 + Math.floor(random() * 6)
      const joined = Array.from({ length: count }, () => blocks[Math.floor(random() * blocks.length)] ?? '')
        .join('\n\n') + '\n'
      const source = random() < 0.25 ? joined.replace(/\n/gu, '\r\n') : joined
      const edited = source.slice(0, 1) + 'q' + source.slice(1)
      // Carets favour suggestion edges: outside, inside and among delimiters.
      const edges = [...edited.matchAll(/\{(?:\+\+|--|~~|==|>>)|(?:\+\+|--|~~|==|<<)\}|~>/gu)]
        .flatMap(match => [match.index, match.index + 1, match.index + 2, match.index + 3])
        .filter(position => position >= 2)
      for (let trial = 0; trial < 6; trial += 1) {
        const caret = random() < 0.5 && edges.length > 0
          ? edges[Math.floor(random() * edges.length)] ?? 2
          : 2 + Math.floor(random() * (edited.length - 2))
        for (const key of ['insertText', 'insertParagraph', 'insertLineBreak', 'deleteContentBackward', 'deleteContentForward'] as const) {
          for (const tracked of [false, true]) {
            const core = createDocumentCore()
            // Agreement is read without the search budget, as the reference searches.
            searchWithoutBudget(core)
            const revision = regional(core, source)
            const before = inspectDocumentCore(core).documentParses
            const actual = press(core, revision, caret, key, tracked)
            if (inspectDocumentCore(core).documentParses === before) regionalKeys += 1
            const control = createDocumentCore()
            planFromDocumentParse(control)
            const expected = press(control, regional(control, source), caret, key, tracked)
            expect(actual, `${JSON.stringify(edited)} @${caret} ${key} tracked=${tracked}`).toEqual(expected)
          }
        }
      }
    }
    expect(regionalKeys).toBeGreaterThan(0)
  }, 120_000)
})

describe('keys in a long dense document cost no document parse', () => {
  const paragraph = 'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.'
  const source = ['Warm editing paragraph.', ...Array.from({ length: 300 }, () => paragraph)].join('\n\n') + '\n'
  const target = source.indexOf(paragraph, source.length / 2)
  const cases: Array<{ name: string, at: number, key: Key, tracked: boolean }> = [
    { name: 'tracked Backspace in plain words', at: target + 'Review {++new evidence++} alongs'.length, key: 'deleteContentBackward', tracked: true },
    { name: 'tracked Delete in plain words', at: target + 'Review {++new evidence++} alongs'.length, key: 'deleteContentForward', tracked: true },
    { name: 'tracked Backspace before a Deletion', at: target + 'Review {++new evidence++} alongside '.length, key: 'deleteContentBackward', tracked: true },
    { name: 'tracked Delete after a Deletion', at: target + 'Review {++new evidence++} alongside {--obsolete details--}'.length, key: 'deleteContentForward', tracked: true },
    { name: 'tracked typing in an Addition', at: target + 'Review {++new ev'.length, key: 'insertText', tracked: true },
    { name: 'tracked typing after an Addition', at: target + 'Review {++new evidence++}'.length, key: 'insertText', tracked: true },
    { name: 'tracked typing before a Substitution', at: target + 'Review {++new evidence++} alongside {--obsolete details--}, '.length, key: 'insertText', tracked: true },
    { name: 'untracked typing in plain words', at: target + 'Review {++new evidence++} alongs'.length, key: 'insertText', tracked: false },
    { name: 'tracked Enter in an Addition', at: target + 'Review {++new ev'.length, key: 'insertParagraph', tracked: true },
    { name: 'tracked Enter between suggestions', at: target + 'Review {++new evidence++} alongs'.length, key: 'insertParagraph', tracked: true },
    { name: 'untracked Enter between suggestions', at: target + 'Review {++new evidence++} alongs'.length, key: 'insertParagraph', tracked: false },
    { name: 'untracked Backspace in plain words', at: target + 'Review {++new evidence++} alongs'.length, key: 'deleteContentBackward', tracked: false },
    { name: 'untracked Delete in plain words', at: target + 'Review {++new evidence++} alongs'.length, key: 'deleteContentForward', tracked: false },
    { name: 'tracked Backspace in an Addition', at: target + 'Review {++new ev'.length, key: 'deleteContentBackward', tracked: true },
    { name: 'tracked Delete in a Substitution\'s new text', at: target + 'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better'.length, key: 'deleteContentForward', tracked: true },
    { name: 'tracked typing at an Addition\'s end', at: target + 'Review {++new evidence'.length, key: 'insertText', tracked: true },
    { name: 'tracked Enter after an Addition', at: target + 'Review {++new evidence++}'.length, key: 'insertParagraph', tracked: true },
    { name: 'tracked Enter at a paragraph\'s end', at: target + paragraph.length, key: 'insertParagraph', tracked: true },
    { name: 'tracked line break between suggestions', at: target + 'Review {++new evidence++} alongs'.length, key: 'insertLineBreak', tracked: true }
  ]
  it.each(cases)('$name', ({ name, at, key, tracked }) => {
    const core = createDocumentCore()
    // Agreement is read without the search budget, as the reference searches.
    searchWithoutBudget(core)
    const revision = regional(core, source)
    const before = inspectDocumentCore(core)
    const actual = press(core, revision, at + 1, key, tracked)
    const after = inspectDocumentCore(core)
    expect(after.documentParses - before.documentParses).toBe(0)
    // The document holds 1,500 annotations; each key reads only those of the
    // blocks around the caret, a few times over.
    expect(after.regionalInventoryAnnotationMaterializedNodes - before.regionalInventoryAnnotationMaterializedNodes)
      .toBeLessThan(key === 'insertText' && (!tracked || name === 'tracked typing in an Addition') ? 100 : 150)
    const control = createDocumentCore()
    planFromDocumentParse(control)
    expect(actual).toEqual(press(control, regional(control, source), at + 1, key, tracked))
    const oracle = createDocumentCore()
    const fresh = oracle.open(actual.source ?? '')
    expect(oracle.project(fresh, 'markup').syntax.ast.root.children.length).toBeGreaterThan(300)
  })
})
