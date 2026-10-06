import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction, type DocumentRevision, type DocumentSourceEdit } from '../src/index.js'
import { planFromDocumentParse } from '../src/internal/documentCoreInspection.js'

// One input gives one output whatever path reads it: every tracked key a
// core plans regionally, from a window or its regional planners, is the key
// a core planning from the whole document's parse gives. Keys build on each
// other, as typing nests suggestions, on 1-10 KB documents, on a
// 2,000-block document, and as input actions on documents of literal blocks
// and literal suggestions.

const lcg = (seed: number) => (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}
const lines = (count: number, line: (index: number) => string): string => Array.from({ length: count }, (_, index) => line(index)).join('\n')
const dense = 'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.'

function control(): DocumentCore {
  const core = createDocumentCore()
  planFromDocumentParse(core)
  return core
}

const sweepBlocks = [
  dense, 'Plain words here.', 'Text {==marked *text*==}{>>see **this** {++and that++}<<} end.',
  '{==outer {==inner==}{>>nested<<} text==}{>>outer comment<<}', '{=={--gone--}==}{>>only deleted<<} tail.',
  '- item {++one++}\n- item {--two--}', '> quoted {~~a~>b~~} line', '# Heading {++added++}', 'Line one {++x++}\nline two {--y--}.', '', '   ',
  '```js\n' + lines(8, index => `const value${index} = ${index}`) + '\n```',
  '$$\n' + lines(5, index => `x_{${index}} + y`) + '\n$$',
  '<div>\n' + lines(5, index => `html ${index}`) + '\n</div>',
  lines(6, index => `    indented ${index}`),
  '{++```js\nconst added = 1\n```\n++}',
  '{~~```js\nconst value0 = 0\nconst value1 = 1\n```\n~>```js\nconst value0 = 0\nconst {--d--}value1 = 1\n```\n~~}'
]
const insertions = ['x', 'word', ' ', 'q', 'x', '\n', '\n\n', '{++n++}', '{--d--}', '{==h==}{>>c<<}']

/** Seeded tracked keys, each compared with the whole-document compile of the same key; the keys that differ. */
function trackedKeyDisagreements(seed: number, paragraphs: number, keys: number): string[] {
  const random = lcg(seed * 7727)
  const target = 1000 + Math.floor(random() * 9000)
  const parts: string[] = []
  if (paragraphs > 0) {
    while (parts.length < paragraphs) parts.push(sweepBlocks[Math.floor(random() * sweepBlocks.length)] ?? '')
  } else {
    let length = 0
    while (length < target) {
      const block = sweepBlocks[Math.floor(random() * sweepBlocks.length)] ?? ''
      parts.push(block)
      length += block.length + 2
    }
  }
  const core = createDocumentCore()
  let revision: DocumentRevision = core.open(parts.join('\n\n') + '\n')
  const differing: string[] = []
  for (let key = 0; key < keys; key += 1) {
    const text = revision.source
    const boundaries = [...text.matchAll(/(?<= )|(?=\r?\n)/gu)].map(match => match.index)
    const start = random() < 0.8 && boundaries.length > 0
      ? boundaries[Math.floor(random() * boundaries.length)] ?? 0
      : Math.floor(random() * (text.length + 1))
    const reach = random() < 0.3 ? Math.min(text.length, start + 1 + Math.floor(random() * 4)) : start
    const end = /^[\p{L} ]*$/u.test(text.slice(start, reach)) ? reach : start
    const insert = end > start && random() < 0.5 ? '' : insertions[Math.floor(random() * insertions.length)] ?? 'x'
    const edit = { start, end, insert }
    const read = (target: DocumentCore, at: DocumentRevision): string => {
      try {
        return JSON.stringify(target.trackedEdit(at, edit) ?? null)
      } catch (error) {
        return `throws ${String(error)}`
      }
    }
    const regional = read(core, revision)
    const checker = control()
    if (regional !== read(checker, checker.open(text))) differing.push(`${seed}/${key}`)
    const planned = JSON.parse(regional.startsWith('throws') ? 'null' : regional) as DocumentSourceEdit | null
    try {
      revision = core.apply(revision, [planned ?? edit], { projections: ['markup'] }).revision
    } catch {
      // A refused key leaves the document as it was.
    }
  }
  return differing
}

const inputBlocks = [
  dense, 'Plain words here.', 'Text {==marked *text*==}{>>see **this** {++and that++}<<} end.', '- item {++one++}\n- item {--two--}',
  '> quoted {~~a~>b~~} line', '# Heading {++added++}', '```js\n' + lines(4, index => `const v${index} = ${index}`) + '\n```',
  '$$\n' + lines(3, index => `x_{${index}} + y`) + '\n$$', '<div>\n' + lines(3, index => `html ${index}`) + '\n</div>',
  lines(3, index => `    indented ${index}`), '{++```js\nconst added = 1\n```\n++}', '{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n```\n~~}',
  '{~~$$\nx_0\n$$\n~>$$\ny_0 + 1\n$$\n~~}', '{~~<div>\nold html\n</div>\n~><div>\nnew html\n</div>\n~~}', '{--```\ngone\n```\n--}',
  'x{~~```\nold\n```\n~>```\nnq\nqqw\n```\n~~}'
]
const inputKeys = ['insertText', 'insertParagraph', 'deleteContentBackward', 'deleteContentForward'] as const
const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

/** Seeded tracked input actions, each compared with the whole-document plan of the same action; the keys that differ. */
function inputKeyDisagreements(seed: number): string[] {
  const random = lcg(seed * 4441)
  const source = Array.from({ length: 3 + Math.floor(random() * 5) }, () => inputBlocks[Math.floor(random() * inputBlocks.length)] ?? '')
    .join('\n\n') + '\n'
  const core = createDocumentCore()
  let revision: DocumentRevision = core.open(source)
  const differing: string[] = []
  for (let press = 0; press < 12; press += 1) {
    const caret = Math.floor(random() * (revision.sourceLength + 1))
    const key = inputKeys[Math.floor(random() * inputKeys.length)] ?? 'insertText'
    const range = key === 'deleteContentBackward'
      ? { start: Math.max(0, caret - 1), end: caret }
      : key === 'deleteContentForward' ? { start: caret, end: Math.min(revision.sourceLength, caret + 1) } : { start: caret, end: caret }
    const input = {
      range,
      selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
      inputType: key,
      data: key === 'insertText' ? 'x' : null,
      options
    } as DocumentInputAction
    const plan = (target: DocumentCore, at: DocumentRevision): readonly DocumentSourceEdit[] | undefined | 'throws' => {
      try {
        return target.inputEdits(at, input, target.planInput(at, input, { tracked: true }), true)
      } catch {
        return 'throws'
      }
    }
    const regional = plan(core, revision)
    const checker = control()
    if (JSON.stringify(regional ?? null) !== JSON.stringify(plan(checker, checker.open(revision.source)) ?? null)) {
      differing.push(`${seed}/${press}`)
    }
    if (regional === undefined || regional === 'throws' || regional.length === 0) continue
    try {
      revision = core.apply(revision, regional).revision
    } catch {
      break
    }
  }
  return differing
}

/** Whether one tracked key on a document reads the same regionally and from the whole document. */
function keyAgrees(source: string, edit: DocumentSourceEdit): boolean {
  const read = (target: DocumentCore): string => {
    try {
      return JSON.stringify(target.trackedEdit(target.open(source), edit) ?? null)
    } catch (error) {
      return `throws ${String(error)}`
    }
  }
  return read(createDocumentCore()) === read(control())
}

const range = (count: number, first: number): number[] => Array.from({ length: count }, (_, index) => first + index)

describe('a tracked key reads as the whole document plans it', () => {
  it.each(range(Number(process.env.MARKTEXT_AGREE_SMALL_SEEDS ?? 6), Number(process.env.MARKTEXT_AGREE_SMALL_FIRST ?? 1)))(
    'on a 1-10 KB document, seed %i', seed => {
      expect(trackedKeyDisagreements(seed, 0, 16)).toEqual([])
    }, 120_000)

  it.each(range(Number(process.env.MARKTEXT_AGREE_LONG_SEEDS ?? 1), 1))('on a 2,000-block document, seed %i', seed => {
    expect(trackedKeyDisagreements(seed, 2000, 16)).toEqual([])
  }, 300_000)

  it.each(range(Number(process.env.MARKTEXT_AGREE_INPUT_SEEDS ?? 40), Number(process.env.MARKTEXT_AGREE_INPUT_FIRST ?? 1)))(
    'as input actions, seed %i', seed => {
      expect(inputKeyDisagreements(seed)).toEqual([])
    }, 120_000)

  // Keys that once read differently.
  it('extends an Addition by Enter typed against its opener', () => {
    expect(inputKeyDisagreements(298)).toEqual([])
  }, 120_000)

  it('splits replaced math in one window as the document does', () => {
    expect(trackedKeyDisagreements(13, 0, 16)).toEqual([])
  }, 120_000)

  it('spells a key beside a closed fence as the document does', () => {
    expect(inputKeyDisagreements(86)).toEqual([])
  }, 120_000)

  it('reads a separator typed into a proposed fence line as the document does', () => {
    expect(keyAgrees('<div>\nhtml\n</div>\n\n{~~```js  $$  \nconst closed = 1\n```\n~>\\{++n\\++}```js  $$  \nconst c\ned = 1\n```\n~~}\n{--$$<div>\nol--}{++\\~~}<div>++}{--d html\n--}\n', { start: 71, end: 71, insert: '~>' })).toBe(true)
  })

  it('reads a fence typed over replaced text as the document does', () => {
    expect(keyAgrees('{~~```\nold\n```\n~>```\nnew\n~~}\n\n- item one\n- item two\n\n{~~```\nold\n```\n~>~~}```\nnew\n~~}\n\nPara *em* and `cod` here.\n', { start: 73, end: 77, insert: '```' })).toBe(true)
  })

  it('reads a key in replaced fenced text beside an unclosed comment as the document does', () => {
    expect(keyAgrees('x{~~```\nold\n```\n~>```\nnq\nqw\n```\n~~}\n\n\n\n{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n``    `\n~~}\n\n{++~>++}{--<div>\nold html\n--}\n\nPlain words here.\n\n{++    indented in an arm\n++}\n\n{~~<div>\nold\n~><!--\nnew\n~~} ', { start: 58, end: 58, insert: '$$' })).toBe(true)
  })
})
