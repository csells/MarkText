import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'
import { inspectDocumentCore, planFromDocumentParse, searchWithoutBudget } from '../src/internal/documentCoreInspection.js'

// Keys pressed one after another beside and inside
// suggestions, such as Backspace then Delete over the text just struck,
// typing after Backspace, or a break at a suggestion's edge, are planned and
// applied from the paragraphs around the caret, tracked or not. Every key
// must read as the document parse gives it: a seeded differential replays
// each sequence against a core that plans from its document parse, and in
// long documents the named sequences take no document parse at all. A key
// no region can apply, such as a suggestion written around a code block,
// costs the single parse apply() publishes.

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
  'Stray ++} closer and {== unfinished opener.',
  'Plain {--a--} b {--c--} d {~~e~>f~~} g.',
  'Note {==high light==}{>>a comment<<} and {~~old text~>new text~~} end.',
  'Emph *a {++b++} c* and {--d--} e.',
  'Nested {++outer {--inner--} text++} end.',
  'Two {==x==}{>>c<<}{==y==}{>>d<<} words.',
  '{++Whole paragraph addition.++}',
  'See [a link](http://x.y) and {++added++} {--gone--} text.',
  '- item {++one++}\n- item {--two--} end',
  '> quote {++a++} and {~~b~>c~~} d',
  '# Heading {++x++} and {--y--}',
  'Ref [r] and {++x++} or {--y--} end.',
  '| a | b |\n| --- | --- |\n| {++c++} | d {--e--} |',
  'Code `x` and {++y++} and {--z--} w.',
  '```\ncode {++x++} here\n```',
  '    indented {--code--} line',
  '<div>\nhtml {++x++} block\n</div>',
  'Setext {++x++} title\n---'
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

function press(core: DocumentCore, revision: DocumentRevision, caret: number, key: Key, tracked = true): Step {
  try {
    const input = action(caret, key)
    const plan = core.planInput(revision, input, { tracked })
    const edits = core.inputEdits(revision, input, plan, tracked)
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

describe('key sequences read as the document parse', () => {
  it.each(Array.from({ length: seeds }, (_, index) => first + index))('seed %i', seed => {
    const random = lcg(seed * 5923)
    let regionalKeys = 0
    for (let documentIndex = 0; documentIndex < 4; documentIndex += 1) {
      const count = 3 + Math.floor(random() * 5)
      const chosen = Array.from({ length: count }, () => blocks[Math.floor(random() * blocks.length)] ?? '')
      const source = [...chosen, ...(chosen.some(block => block.includes('[r]')) ? ['[r]: http://example.com'] : [])]
        .join('\n\n') + '\n'
      for (let trial = 0; trial < 6; trial += 1) {
        const core = createDocumentCore()
        // Agreement is read without the search budget, as the reference searches.
        searchWithoutBudget(core)
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
        const tracked = random() < 0.7
        for (let press_ = 0; press_ < length; press_ += 1) {
          const key = keys[Math.floor(random() * keys.length)] ?? 'insertText'
          const label = `${JSON.stringify(revision.source)} @${caret} ${key} tracked=${tracked}`
          const before = inspectDocumentCore(core).documentParses
          const actual = press(core, revision, caret, key, tracked)
          if (inspectDocumentCore(core).documentParses === before) regionalKeys += 1
          const expected = press(control, controlRevision, caret, key, tracked)
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

// Keys in the lines of a suggestion arm's literal block read only the lines
// around them (see `admitArmLiteralLines`), tracked or not; first tracked
// keys in a plain literal block make such arms.
const armLines = (count: number, line: (index: number) => string): string =>
  Array.from({ length: count }, (_, index) => line(index)).join('\n')
const armBlocks = [
  'Plain words here.',
  '{~~```js\n' + armLines(6, index => `old ${index}`) + '\n```\n~>```js\n' + armLines(7, index => `new ${index} = x`) + '\n```\n~~}',
  '{~~$$\n' + armLines(5, index => `x_${index}`) + '\n$$\n~>$$\n' + armLines(6, index => `y_${index} + 1`) + '\n$$\n~~}',
  '{~~<div>\n' + armLines(5, index => `old html ${index}`) + '\n</div>\n~><div>\n' + armLines(5, index => `new html ${index}`) + '\n</div>\n~~}',
  '{++~~~\n' + armLines(6, index => `added ${index}`) + '\n~~~\n++}',
  '{--```\n' + armLines(5, index => `gone ${index}`) + '\n```\n--}',
  '{~~' + armLines(5, index => `    old indented ${index}`) + '\n~>' + armLines(5, index => `    new indented ${index}`) + '\n~~}',
  '```\n' + armLines(5, index => `plain code ${index}`) + '\n```',
  armLines(5, index => `    plain indented ${index}`),
  '$$\n' + armLines(4, index => `z_${index}`) + '\n$$'
]
const armSeeds = Number(process.env.MARKTEXT_ARM_KEY_SEEDS ?? 10)
const firstArmSeed = Number(process.env.MARKTEXT_ARM_KEY_FIRST ?? 1)

describe('key sequences in suggestion arms\' literal blocks read as the document parse', () => {
  it.each(Array.from({ length: armSeeds }, (_, index) => firstArmSeed + index))('seed %i', seed => {
    const random = lcg(seed * 7307)
    let regionalKeys = 0
    for (let documentIndex = 0; documentIndex < 3; documentIndex += 1) {
      const count = 2 + Math.floor(random() * 4)
      const source = Array.from({ length: count }, () => armBlocks[Math.floor(random() * armBlocks.length)] ?? '').join('\n\n') + '\n'
      for (let trial = 0; trial < 5; trial += 1) {
        const core = createDocumentCore()
        // Agreement is read without the search budget, as the reference searches.
        searchWithoutBudget(core)
        const control = createDocumentCore()
        planFromDocumentParse(control)
        let revision = regional(core, source)
        let controlRevision = regional(control, source)
        // Carets favour the inner lines of literal blocks.
        const inner = [...revision.source.matchAll(/^ *(?:old|new|added|gone|x_|y_|z_|plain code|plain indented)[^\n]*$/gmu)]
        const line = inner[Math.floor(random() * inner.length)]
        let caret = line === undefined
          ? 2 + Math.floor(random() * (revision.sourceLength - 2))
          : line.index + Math.floor(random() * (line[0].length + 1))
        const length = 2 + Math.floor(random() * 5)
        const tracked = random() < 0.7
        for (let press_ = 0; press_ < length; press_ += 1) {
          const key = keys[Math.floor(random() * keys.length)] ?? 'insertText'
          const label = `${JSON.stringify(revision.source)} @${caret} ${key} tracked=${tracked}`
          const before = inspectDocumentCore(core).documentParses
          const actual = press(core, revision, caret, key, tracked)
          if (inspectDocumentCore(core).documentParses === before) regionalKeys += 1
          const expected = press(control, controlRevision, caret, key, tracked)
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

describe('key sequences in a long document cost no document parse', () => {
  const dense = 'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.'
  const source = ['Warm editing paragraph.', ...Array.from({ length: 300 }, () => dense)].join('\n\n') + '\n'
  const target = source.indexOf(dense, source.length / 2) + 1
  const at = (text: string, offset = 0): number => target + dense.indexOf(text) + offset
  const B = 'deleteContentBackward'
  const D = 'deleteContentForward'
  const T = 'insertText'
  const E = 'insertParagraph'
  const cases: Array<{ name: string, at: number, keys: readonly Key[], untracked?: boolean }> = [
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
    { name: 'Backspace and Delete after a Comment', at: at('<<}.', 3), keys: [B, D] },
    { name: 'Backspace twice before a Substitution after a Deletion', at: at('{~~old'), keys: [B, B] },
    { name: 'Delete between a Deletion and a Substitution', at: at('--},', 3), keys: [D, D] },
    { name: 'Enter before a Highlight', at: at('{==a'), keys: [E] },
    { name: 'Enter at a Highlight text start', at: at('a claim'), keys: [E] },
    { name: 'typing inside a Highlight', at: at('claim', 2), keys: [T] },
    { name: 'Enter inside a Highlight', at: at('claim', 2), keys: [E] },
    { name: 'typing and Enter inside a Deletion', at: at('details', 3), keys: [T, E] },
    { name: 'typing inside a Substitution old text', at: at('wording~>', 3), keys: [T] },
    { name: 'Enter inside a Substitution old text', at: at('wording~>', 3), keys: [E] },
    { name: 'Enter before and after a Substitution', at: at('{~~old'), keys: [E] },
    { name: 'Enter at a Substitution old text start', at: at('old wording~>'), keys: [E] },
    { name: 'Backspace over a Substitution new text', at: at('wording~~}', 7), keys: [B, B, B, B, B, B, B, B, B, B, B, B, B, B] },
    { name: 'untracked Enter inside an Addition', at: at('evidence', 3), keys: [E, E], untracked: true },
    { name: 'untracked Enter at a Substitution text edge', at: at('~>better'), keys: [E], untracked: true },
    { name: 'untracked typing and deleting beside suggestions', at: at('++} alongside', 3), keys: [T, B], untracked: true },
    { name: 'Delete inside a hidden opener', at: at('{++new', 1), keys: [D] },
    { name: 'Backspace inside a hidden closer', at: at('++} alongside', 1), keys: [B] },
    { name: 'typing inside a hidden separator', at: at('~>better', 1), keys: [T] },
    { name: 'Enter inside a hidden Comment opener', at: at('{>>Check', 1), keys: [E] }
  ]
  it.each(cases)('$name', ({ at: start, keys: sequence, untracked }) => {
    const core = createDocumentCore()
    let revision = regional(core, source)
    let caret = start
    const before = inspectDocumentCore(core).documentParses
    for (const key of sequence) {
      const step = press(core, revision, caret, key, untracked !== true)
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
      const step = press(control, controlRevision, controlCaret, key, untracked !== true)
      if (step.revision === undefined || step.caret === undefined) throw new Error(`${key} was refused`)
      controlRevision = step.revision
      controlCaret = step.caret
    }
    expect(revision.source).toBe(controlRevision.source)
    expect(caret).toBe(controlCaret)
  }, 60_000)
})

describe('keys the general compiler plans in a long document', () => {
  const dense = 'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.'
  const shapes = [
    { name: 'Delete at the start of emphasis', block: 'Emph *a {++b++} c* and {--d--} e.', text: '*a', offset: 1, key: 'deleteContentForward', parses: 0 },
    { name: 'Backspace after emphasis', block: 'Emph *a {++b++} c* and {--d--} e.', text: 'c* and', offset: 2, key: 'deleteContentBackward', parses: 0 },
    { name: 'Enter inside emphasis', block: 'Emph *a {++b++} c* and {--d--} e.', text: 'a {++', offset: 1, key: 'insertParagraph', parses: 0 },
    { name: 'typing in a Highlight beside a Comment', block: 'Pair {==x==}{>>c<<}{==y==} end.', text: 'x==', offset: 1, key: 'insertText', parses: 0 },
    { name: 'Enter that turns the paragraph after into a list', block: 'Emph *a {++b++} c* and {--d--} e.', text: '* and', offset: 0, key: 'insertParagraph', parses: 0 },
    { name: 'typing in a paragraph holding a link', block: 'See [a link](http://x.y) and {++added++} text.', text: 'See', offset: 2, key: 'insertText', parses: 0 },
    { name: 'Enter in a list item', block: '- item {++one++}\n- item {--two--} end', text: 'item {++', offset: 2, key: 'insertParagraph', parses: 0 },
    { name: 'typing in a fenced code block', block: '```\ncode {++x++} here\n```', text: 'code', offset: 2, key: 'insertText', parses: 0 }
  ] as const
  it.each(shapes)('$name', ({ block, text, offset, key, parses }) => {
    const paragraphs = ['Warm editing paragraph.', ...Array.from({ length: 300 }, () => dense)]
    paragraphs[150] = block
    const source = paragraphs.join('\n\n') + '\n'
    const caret = source.indexOf(block) + 1 + block.indexOf(text) + offset
    const core = createDocumentCore()
    const revision = regional(core, source)
    const before = inspectDocumentCore(core).documentParses
    const step = press(core, revision, caret, key)
    expect(inspectDocumentCore(core).documentParses - before).toBe(parses)
    const control = createDocumentCore()
    planFromDocumentParse(control)
    expect(step.outcome).toEqual(press(control, regional(control, source), caret, key).outcome)
  }, 60_000)
})
