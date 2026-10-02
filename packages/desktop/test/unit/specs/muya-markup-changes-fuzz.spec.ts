import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { applyMuyaMarkupChanges } from '@/documentAuthority/muyaMarkupChanges'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'

// Plan 0012 G35: a view patched with a regional reply reads exactly as the
// view of the whole new revision, whatever the edit: blank-line runs and
// whitespace-only lines included, where Enter at a paragraph's end lands,
// stray or unfinished markers beside them, and every block kind, whose
// source structure the view reads from the canonical source as the editor's
// does.

const lcg = (seed: number) => (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

const blocks = [
  'Plain words here.',
  'Another ordinary sentence with more words.',
  'Text with {++added++} inside.',
  'Text {--deleted--} and {~~old~>new~~} too.',
  'Note {==marked==}{>>comment<<} end.',
  '{++Whole paragraph addition.++}',
  'Line one\nline two of one paragraph.',
  '# Heading',
  '- item one\n- item two',
  '> quoted line',
  '   ',
  '',
  '\t',
  'Stray ++} closer and --} here.',
  'Unfinished {== opener here.',
  'Kept {++ok++} then {== open.',
  'Text {--gone--} and ++} stray.',
  'Call `render()` once and cache it.',
  'See [the guide](http://x.y) for more.',
  'The area $a^2$ grows.',
  '```js\nconst total = 1\n```',
  '| a | b |\n| --- | --- |\n| c | d |',
  'Setext title\n---',
  '1. first step\n2. second step',
  '<div>\nhtml text\n</div>',
  '    indented code',
  'Some *emphasis* and **strong** words.',
  '---',
  '- alpha one\n- beta two\n- gamma three\n- delta four',
  '- loose a\n\n- loose b\n\n- loose c',
  '1. one\n2. two\n3. three',
  '- [ ] task a\n- [x] task b\n- [ ] task c',
  '- outer\n  - inner a\n  - inner b\n- outer two',
  // Long literal blocks, whose lines a regional reply replaces on their own.
  '```js\n' + Array.from({ length: 10 }, (_, index) => `const value${index} = compute(${index})`).join('\n') + '\n```',
  '~~~\n' + Array.from({ length: 6 }, (_, index) => `\tline ${index} {x}`).join('\n') + '\n~~~',
  Array.from({ length: 6 }, (_, index) => `    indented ${index}`).join('\n'),
  '$$\n' + Array.from({ length: 5 }, (_, index) => `x_{${index}} + y`).join('\n') + '\n$$',
  '<div>\n' + Array.from({ length: 5 }, (_, index) => `html ${index}`).join('\n') + '\n</div>',
  '```mermaid\n' + Array.from({ length: 4 }, (_, index) => `a${index} --> b${index}`).join('\n') + '\n```'
]
const insertions = ['x', ' ', '\n', '\n\n', '\n\n\n\n', '   ', '{++n++}', '# ', '- ', '++}', '{==', '`', '$', '[', ']', '|', '> ', '1. ', '```']

const seeds = Number(process.env.MARKTEXT_VIEW_FUZZ_SEEDS ?? 40)
const first = Number(process.env.MARKTEXT_VIEW_FUZZ_FIRST ?? 1)

describe('Patched Markup views read as the whole view', () => {
  // Seed 325 once patched a view whose root before the region kept the text
  // up to a block start the edit had moved.
  it.each([...Array.from({ length: seeds }, (_, index) => first + index), 325])('seed %i', (seed) => {
    const random = lcg(seed * 7919)
    for (let documentIndex = 0; documentIndex < 6; documentIndex += 1) {
      const count = 3 + Math.floor(random() * 8)
      const source =
        Array.from({ length: count }, () => blocks[Math.floor(random() * blocks.length)]).join(
          '\n\n'
        ) + (random() < 0.8 ? '\n' : '')
      const core = createDocumentCore()
      let revision = core.open(source)
      let view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations, revision.source)
      for (let edit = 0; edit < 6; edit += 1) {
        const text = revision.source
        // Favour paragraph ends and blank lines, where Enter lands.
        const ends = [...text.matchAll(/(?=\r?\n)/gu)].map((match) => match.index)
        const start =
          random() < 0.6 && ends.length > 0
            ? ends[Math.floor(random() * ends.length)]
            : Math.floor(random() * (text.length + 1))
        const end = random() < 0.2 ? Math.min(text.length, start + 1 + Math.floor(random() * 3)) : start
        const insert = end > start && random() < 0.5 ? '' : insertions[Math.floor(random() * insertions.length)]
        const label = `${JSON.stringify(text)} [${start}, ${end}) ${JSON.stringify(insert)}`
        const commit = core.apply(revision, [{ start, end, insert }], { projections: ['markup'] })
        const expected = createMuyaMarkupView(
          core.project(commit.revision, 'markup'),
          commit.revision.annotations,
          commit.revision.source
        )
        const change = commit.change.projections[0]
        const patched =
          change?.name === 'markup' && change.scope === 'regions'
            ? applyMuyaMarkupChanges(view, structuredClone(change))
            : undefined
        if (patched !== undefined) expect(patched, label).toEqual(expected)
        view = patched ?? expected
        revision = commit.revision
      }
    }
  })
})

// Suggestion arms each holding a whole long literal block, whose lines a
// regional reply replaces on their own (Core's `admitArmLiteralLines`): the
// arm's root takes the lines, and the roots of the suggestion's other arm
// and after it move the suggestion's end.
const armLines = (count: number, line: (index: number) => string): string =>
  Array.from({ length: count }, (_, index) => line(index)).join('\n')
const armBlocks = [
  'Plain words here.',
  '{~~```js\n' + armLines(6, (index) => `old ${index}`) + '\n```\n~>```js\n' + armLines(7, (index) => `new ${index} {x}`) + '\n```\n~~}',
  '{~~$$\n' + armLines(5, (index) => `x_{${index}}`) + '\n$$\n~>$$\n' + armLines(6, (index) => `y_{${index}} + 1`) + '\n$$\n~~}',
  '{~~<div>\n' + armLines(5, (index) => `old html ${index}`) + '\n</div>\n~><div>\n' + armLines(5, (index) => `new html ${index}`) + '\n</div>\n~~}',
  '{++~~~\n' + armLines(6, (index) => `added ${index}`) + '\n~~~\n++}',
  '{--```\n' + armLines(5, (index) => `gone ${index}`) + '\n```\n--}',
  '{~~' + armLines(5, (index) => `    old indented ${index}`) + '\n~>' + armLines(5, (index) => `    new indented ${index}`) + '\n~~}',
  '{==```\n' + armLines(5, (index) => `marked ${index}`) + '\n```\n==}{>>a comment<<}',
  '- item one\n- item two',
  'Text {--deleted--} and {~~old~>new~~} too.'
]
const armInsertions = ['x', ' ', '\n', '\n\n', '    ', 'ab', '# ', '{++n++}', '`', '$']
const armSeeds = Number(process.env.MARKTEXT_ARM_VIEW_FUZZ_SEEDS ?? 40)
const firstArm = Number(process.env.MARKTEXT_ARM_VIEW_FUZZ_FIRST ?? 1)

describe('Patched Markup views of suggestion arms\' lines read as the whole view', () => {
  it.each(Array.from({ length: armSeeds }, (_, index) => firstArm + index))('seed %i', (seed) => {
    const random = lcg(seed * 6151)
    let armPatches = 0
    for (let documentIndex = 0; documentIndex < 5; documentIndex += 1) {
      const count = 2 + Math.floor(random() * 5)
      const source =
        Array.from({ length: count }, () => armBlocks[Math.floor(random() * armBlocks.length)]).join('\n\n') +
        (random() < 0.8 ? '\n' : '')
      const core = createDocumentCore()
      let revision = core.open(source)
      let view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations, revision.source)
      for (let edit = 0; edit < 8; edit += 1) {
        const text = revision.source
        // Favour the inner lines of the arms' blocks.
        const inner = [...text.matchAll(/^ *(?:old|new|added|gone|marked|x_|y_)[^\n]*$/gmu)]
        const line = random() < 0.85 ? inner[Math.floor(random() * inner.length)] : undefined
        const start = line === undefined
          ? Math.floor(random() * (text.length + 1))
          : line.index + Math.floor(random() * (line[0].length + 1))
        const end = random() < 0.25 ? Math.min(text.length, start + 1 + Math.floor(random() * 3)) : start
        const insert = end > start && random() < 0.5 ? '' : armInsertions[Math.floor(random() * armInsertions.length)]
        const label = `${JSON.stringify(text)} [${start}, ${end}) ${JSON.stringify(insert)}`
        const commit = core.apply(revision, [{ start, end, insert }], { projections: ['markup'] })
        const expected = createMuyaMarkupView(
          core.project(commit.revision, 'markup'),
          commit.revision.annotations,
          commit.revision.source
        )
        const change = commit.change.projections[0]
        const patched =
          change?.name === 'markup' && change.scope === 'regions'
            ? applyMuyaMarkupChanges(view, structuredClone(change))
            : undefined
        if (patched !== undefined) expect(patched, label).toEqual(expected)
        if (patched !== undefined && change?.name === 'markup' && change.scope === 'regions' &&
            change.replacements[0]?.enclosing !== undefined) armPatches += 1
        view = patched ?? expected
        revision = commit.revision
      }
    }
    expect(armPatches).toBeGreaterThan(0)
  })
})
