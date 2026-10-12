import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction, type DocumentRevision } from '../src/index.js'
import { inspectDocumentCore, planFromDocumentParse, searchWithoutBudget } from '../src/internal/documentCoreInspection.js'
import { action, lcg, options, press, regional } from './support/inputDriver.js'

// Enter and a soft break are planned from the paragraphs
// around the caret, and tracked breaks are proved by reparsing only those
// paragraphs, once a regional edit has left the revision without its
// document parse. Each regional plan must be the one the document parse
// gives: a seeded differential compares every result with a core that
// plans from its document parse.

/** Paragraphs and suggestions: the blocks a regional window can plan in. */
const prose = [
  'Plain words here.',
  'More plain words.',
  'Short.',
  'Another ordinary sentence with more words.',
  'Line one\nline two of one paragraph.',
  'Trailing spaces  ',
  'Trailing backslash\\',
  'Text with {++added++} inside.',
  'Text {--deleted--} and {~~old~>new~~} too.',
  'Note {==marked==}{>>comment<<} end.',
  '{++Whole paragraph addition.++}',
  '{++Addition\n\nacross paragraphs.++} after.',
  'Para *em* and **strong** here.',
  'A [link](http://x.y) here.'
]

/** Every other block kind, which a window must leave to the document parse. */
const mixed = [
  ...prose,
  '# Heading',
  'Setext heading\n===',
  '- item one\n- item two',
  '1. first\n2. second',
  '> quoted line',
  '```\ncode\n```',
  '    indented code',
  '| a | b |\n| - | - |\n| 1 | 2 |',
  'Para with `code` here.',
  '$$\nmath\n$$',
  '<div>\nhtml\n</div>',
  '---',
  '   ',
  '```'
]

function documentFrom(random: () => number, blocks: readonly string[]): string {
  const count = 3 + Math.floor(random() * 8)
  const parts: string[] = []
  for (let index = 0; index < count; index += 1) {
    parts.push(blocks[Math.floor(random() * blocks.length)] ?? '')
    if (random() < 0.1) parts.push('')
  }
  const text = parts.join('\n\n') + (random() < 0.8 ? '\n' : '')
  return random() < 0.1 ? text.replace(/\n/gu, '\r\n') : text
}

/** Word ends in paragraph text, where a warm-up key lands regionally. */
function wordEnds(source: string): number[] {
  return [...source.matchAll(/[a-z](?= )/gu)].map(match => match.index + 1)
}

describe.each([
  { name: 'prose and suggestions', blocks: prose },
  { name: 'every block kind', blocks: mixed }
])('regional Enter planning in $name reads as the document parse', ({ blocks }) => {
  it.each(Array.from({ length: 20 }, (_, index) => index + 1))('seed %i', seed => {
    const random = lcg(seed * 104729 + blocks.length)
    let regionalPlans = 0
    for (let documentIndex = 0; documentIndex < 8; documentIndex += 1) {
      const source = documentFrom(random, blocks)
      const warm = wordEnds(source)
      if (warm.length === 0) continue
      const at = warm[Math.floor(random() * warm.length)] ?? 0
      const edited = source.slice(0, at) + 'q' + source.slice(at)
      // Carets favour the places Enter usually lands: line ends and the
      // edges and insides of suggestions.
      const favoured = [...edited.matchAll(/(?=\r?\n|\+\+\}|--\}|~~\})|\{\+\+|[a-z] |\n\n(?=[A-Za-z{])/gu)].map(match => match.index + match[0].length)
      for (let trial = 0; trial < 4; trial += 1) {
        const caret = random() < 0.6 && favoured.length > 0
          ? favoured[Math.floor(random() * favoured.length)] ?? 0
          : Math.floor(random() * (edited.length + 1))
        for (const key of ['insertParagraph', 'insertLineBreak', 'deleteContentBackward'] as const) {
          for (const tracked of [false, true]) {
            const core = createDocumentCore()
            // The planners are compared with the reference on their own, as
            // the reference searches spellings: without the search budget.
            searchWithoutBudget(core)
            const revision = regional(core, source, at)
            const before = inspectDocumentCore(core).documentParses
            const actual = press(core, revision, caret, key, tracked)
            if (inspectDocumentCore(core).documentParses === before) regionalPlans += 1
            const control = createDocumentCore()
            planFromDocumentParse(control)
            const expected = press(control, regional(control, source, at), caret, key, tracked)
            expect(actual, `${JSON.stringify(edited)} @${caret} ${key} tracked=${tracked}`).toEqual(expected)
          }
        }
      }
    }
    // Prose documents must exercise the windows; other blocks may refuse them.
    if (blocks === prose) expect(regionalPlans).toBeGreaterThan(0)
  }, 60_000)
})

describe('Enter in a long document plans and commits without a document parse', () => {
  const paragraph = 'Writing a useful document takes careful editing and a clear view of the text.'
  const long = (count: number): string =>
    ['Warm editing paragraph.', ...Array.from({ length: count }, () => paragraph)].join('\n\n') + '\n'

  const expectFreshParity = (core: DocumentCore, revision: DocumentRevision): void => {
    const oracle = createDocumentCore()
    const fresh = oracle.open(revision.source)
    expect(revision.annotations).toEqual(fresh.annotations)
    expect(core.project(revision, 'markup').syntax.ast).toEqual(oracle.project(fresh, 'markup').syntax.ast)
  }

  for (const tracked of [false, true]) {
    it(`${tracked ? 'tracked' : 'untracked'} Enter then typing, as the warm workload types`, () => {
      const core = createDocumentCore()
      let revision = core.open(long(300))
      let caret = 'Warm '.length
      const parses: number[] = []
      for (let index = 0; index < 8; index += 1) {
        for (const key of [{ inputType: 'insertParagraph', data: null }, { inputType: 'insertText', data: 'x' }]) {
          const input = { ...action(caret, 'insertParagraph'), ...key } as DocumentInputAction
          const before = inspectDocumentCore(core).documentParses
          const plan = core.planInput(revision, input, { tracked })
          const edits = core.inputEdits(revision, input, plan, tracked)
          if (edits === undefined) throw new Error(`${key.inputType} was refused`)
          const commit = core.apply(revision, edits, { projections: ['markup'] })
          const selection = core.reconcileInput(revision, plan, commit, input).selection
          if (key.inputType === 'insertParagraph') parses.push(inspectDocumentCore(core).documentParses - before)
          revision = commit.revision
          caret = selection !== undefined && 'ranges' in selection ? selection.ranges[0]?.focus ?? caret : caret
        }
      }
      // The first Enter plans from the document parse the open left.
      expect(parses.slice(1)).toEqual(Array.from({ length: 7 }, () => 0))
      const accepted = tracked ? revision.source.replace(/\{\+\+([\s\S]*?)\+\+\}/gu, '$1') : revision.source
      expect(accepted).toBe(long(300).replace('Warm editing', 'Warm ' + '\n\nx'.repeat(8) + 'editing'))
      expectFreshParity(core, revision)
    })
  }

  for (const tracked of [false, true]) {
    it(`${tracked ? 'tracked' : 'untracked'} Enter in the middle of a paragraph`, () => {
      const core = createDocumentCore()
      const source = long(300)
      const start = source.indexOf(paragraph, source.length / 2) + 30
      const revision = regional(core, source, start - 1)
      const before = inspectDocumentCore(core).documentParses
      const outcome = press(core, revision, start + 1, 'insertParagraph', tracked)
      expect(inspectDocumentCore(core).documentParses - before).toBe(0)
      expect(outcome.edits).toEqual([{ start: start + 1, end: start + 1, insert: tracked ? '{++\n\n++}' : '\n\n' }])
    })
  }
})

describe('new suggestions in a document that already has suggestions reparse only their paragraphs', () => {
  const paragraph = 'Writing a useful document takes careful editing and a clear view of the text.'
  const suggestions = Array.from({ length: 20 }, (_, index) => index % 2 === 0
    ? `Suggested {++addition ${index}++} text.`
    : `Retired {--deletion ${index}--} text.`).join('\n\n')
  const source = suggestions + '\n\n' + Array.from({ length: 300 }, () => paragraph).join('\n\n') + '\n'
  const target = source.indexOf(paragraph, source.length / 2)

  it.each([
    { name: 'a tracked word', caret: target + 30, inputType: 'insertText', data: 'x', range: { start: target + 31, end: target + 31 }, insert: '{++x++}' },
    { name: 'a tracked Enter', caret: target + 30, inputType: 'insertParagraph', data: null, range: { start: target + 31, end: target + 31 }, insert: '{++\n\n++}' },
    { name: 'a tracked join', caret: target, inputType: 'deleteContentBackward', data: null, range: { start: target - 1, end: target + 1 }, insert: '{--\n\n--}' }
  ])('$name', ({ caret, inputType, data, range, insert }) => {
    const core = createDocumentCore()
    const revision = regional(core, source, 5)
    const at = caret + 1
    const input = { range, selection: { ranges: [{ anchor: at, focus: at }], primary: 0 }, inputType, data, options } as DocumentInputAction
    const before = inspectDocumentCore(core).documentParses
    const plan = core.planInput(revision, input, { tracked: true })
    const edits = core.inputEdits(revision, input, plan, true)
    if (edits === undefined) throw new Error('The key was refused')
    const commit = core.apply(revision, edits, { projections: ['markup'] })
    core.reconcileInput(revision, plan, commit, input)
    expect(inspectDocumentCore(core).documentParses - before).toBe(0)
    expect(edits.map(edit => edit.insert)).toEqual([insert])
    const oracle = createDocumentCore()
    const fresh = oracle.open(commit.revision.source)
    expect(commit.revision.annotations).toEqual(fresh.annotations)
    expect(core.project(commit.revision, 'markup').syntax.ast).toEqual(oracle.project(fresh, 'markup').syntax.ast)
  })
})
