import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'
import { inspectDocumentCore, planFromDocumentParse } from '../src/internal/documentCoreInspection.js'

// Plan 0012 G35: tracked keys pressed one after another beside and inside
// suggestions, such as Backspace then Delete over the text just struck, or
// typing after Backspace, are planned and applied from the paragraphs
// around the caret. Every key must read as the document parse gives it: a
// seeded differential replays each sequence against a core that plans from
// its document parse, and in long documents the named sequences take no
// document parse at all.

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

const lcg = (seed: number) => (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

const blocks = [
  'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.',
  'Words {--one--}{++two++} and {~~a~>b~~}.',
  'Plain words before {--struck--} and after.',
  'Beside {++added++}{--gone--} and {==marked==} text.',
  'A {~~sub~>stitution~~} then {++x++} end.',
  'Ordinary words of a plain paragraph.',
  'Stray ++} closer and {== unfinished opener.'
]

type Key = 'insertText' | 'insertParagraph' | 'deleteContentBackward' | 'deleteContentForward'
const keys: readonly Key[] = ['insertText', 'insertParagraph', 'deleteContentBackward', 'deleteContentForward']

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

interface Step {
  readonly outcome: unknown
  readonly revision?: DocumentRevision
  readonly caret?: number
}

function press(core: DocumentCore, revision: DocumentRevision, caret: number, key: Key): Step {
  try {
    const input = action(caret, key)
    const plan = core.planInput(revision, input, { tracked: true })
    const edits = core.inputEdits(revision, input, plan, true)
    if (edits === undefined) return { outcome: { plan } }
    const commit = core.apply(revision, edits, { projections: ['markup'] })
    const selection = core.reconcileInput(revision, plan, commit, input).selection
    const focus = selection !== undefined && 'ranges' in selection ? selection.ranges[selection.primary]?.focus : undefined
    return {
      outcome: {
        plan,
        edits,
        selection,
        source: commit.revision.source,
        annotations: commit.revision.annotations,
        diagnostics: commit.revision.diagnostics
      },
      revision: commit.revision,
      ...(focus === undefined ? {} : { caret: focus })
    }
  } catch (error) {
    return { outcome: { error: error instanceof Error ? error.message : String(error) } }
  }
}

const seeds = Number(process.env.MARKTEXT_KEY_SEQUENCE_SEEDS ?? 10)
const first = Number(process.env.MARKTEXT_KEY_SEQUENCE_FIRST ?? 1)

describe('tracked key sequences read as the document parse', () => {
  it.each(Array.from({ length: seeds }, (_, index) => first + index))('seed %i', seed => {
    const random = lcg(seed * 5923)
    let regionalKeys = 0
    for (let documentIndex = 0; documentIndex < 4; documentIndex += 1) {
      const count = 3 + Math.floor(random() * 5)
      const source = Array.from({ length: count }, () => blocks[Math.floor(random() * blocks.length)] ?? '')
        .join('\n\n') + '\n'
      for (let trial = 0; trial < 6; trial += 1) {
        const core = createDocumentCore()
        const control = createDocumentCore()
        planFromDocumentParse(control)
        let revision = regional(core, source)
        let controlRevision = regional(control, source)
        // Carets favour the edges of suggestions, where the sequences meet
        // deleted text and hidden delimiters.
        const edges = [...revision.source.matchAll(/\{(?:\+\+|--|~~|==|>>)|(?:\+\+|--|~~|==|<<)\}/gu)]
          .flatMap(match => [match.index, match.index + match[0].length])
        let caret = random() < 0.7 && edges.length > 0
          ? edges[Math.floor(random() * edges.length)] ?? 2
          : 2 + Math.floor(random() * (revision.sourceLength - 2))
        const length = 2 + Math.floor(random() * 3)
        for (let press_ = 0; press_ < length; press_ += 1) {
          const key = keys[Math.floor(random() * keys.length)] ?? 'insertText'
          const label = `${JSON.stringify(revision.source)} @${caret} ${key}`
          const before = inspectDocumentCore(core).documentParses
          const actual = press(core, revision, caret, key)
          if (inspectDocumentCore(core).documentParses === before) regionalKeys += 1
          const expected = press(control, controlRevision, caret, key)
          expect(actual.outcome, label).toEqual(expected.outcome)
          if (actual.revision === undefined || expected.revision === undefined || actual.caret === undefined) break
          const fresh = createDocumentCore().open(actual.revision.source)
          expect(actual.revision.annotations, label).toEqual(fresh.annotations)
          revision = actual.revision
          controlRevision = expected.revision
          caret = actual.caret
        }
      }
    }
    expect(regionalKeys).toBeGreaterThan(0)
  }, 180_000)
})

describe('tracked key sequences in a long document cost no document parse', () => {
  const dense = 'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.'
  const source = ['Warm editing paragraph.', ...Array.from({ length: 300 }, () => dense)].join('\n\n') + '\n'
  const target = source.indexOf(dense, source.length / 2) + 1
  const at = (text: string, offset = 0): number => target + dense.indexOf(text) + offset
  const B = 'deleteContentBackward'
  const D = 'deleteContentForward'
  const T = 'insertText'
  const cases: Array<{ name: string, at: number, keys: readonly Key[] }> = [
    { name: 'Backspace then Delete in words', at: at('alongside', 5), keys: [B, D, D] },
    { name: 'Delete then Backspace in words', at: at('alongside', 5), keys: [D, B, B] },
    { name: 'Backspace then typing', at: at('alongside', 5), keys: [B, T, T] },
    { name: 'Delete then typing', at: at('alongside', 5), keys: [D, T] },
    { name: 'typing then Backspace', at: at('alongside', 5), keys: [T, B, D] },
    { name: 'Backspace then Enter', at: at('alongside', 5), keys: [B, 'insertParagraph'] },
    { name: 'Delete after an Addition', at: at('++} alongside', 3), keys: [D, D] },
    { name: 'Backspace before an Addition', at: at('{++new'), keys: [B, B] },
    { name: 'Backspace and Delete at an Addition text edge', at: at('new evidence'), keys: [B, D] },
    { name: 'Backspace and Delete inside a Deletion', at: at('details', 3), keys: [B, D] },
    { name: 'Backspace and Delete in a Substitution old text', at: at('wording~>', 3), keys: [B, D] },
    { name: 'Delete then Backspace at a Substitution new text end', at: at('wording~~}', 7), keys: [D, B] },
    { name: 'Backspace before a Substitution', at: at('{~~old'), keys: [B] },
    { name: 'Backspace and Delete after a Substitution', at: at('~~}, and', 3), keys: [B, D] },
    { name: 'Backspace inside a Highlight', at: at('claim', 2), keys: [B, D] },
    { name: 'Backspace and Delete after a Comment', at: at('<<}.', 3), keys: [B, D] }
  ]
  it.each(cases)('$name', ({ at: start, keys: sequence }) => {
    const core = createDocumentCore()
    let revision = regional(core, source)
    let caret = start
    const before = inspectDocumentCore(core).documentParses
    for (const key of sequence) {
      const step = press(core, revision, caret, key)
      expect(step.outcome).not.toHaveProperty('error')
      if (step.revision === undefined || step.caret === undefined) throw new Error(`${key} was refused`)
      revision = step.revision
      caret = step.caret
    }
    expect(inspectDocumentCore(core).documentParses - before).toBe(0)
    const control = createDocumentCore()
    planFromDocumentParse(control)
    let controlRevision = regional(control, source)
    let controlCaret = start
    for (const key of sequence) {
      const step = press(control, controlRevision, controlCaret, key)
      if (step.revision === undefined || step.caret === undefined) throw new Error(`${key} was refused`)
      controlRevision = step.revision
      controlCaret = step.caret
    }
    expect(revision.source).toBe(controlRevision.source)
    expect(caret).toBe(controlCaret)
  }, 60_000)
})
