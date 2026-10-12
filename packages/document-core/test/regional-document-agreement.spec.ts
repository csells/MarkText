import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction, type DocumentRevision, type DocumentSourceEdit } from '../src/index.js'
import { planFromGeneralCompile, searchWithoutBudget } from '../src/internal/documentCoreInspection.js'
import { dense, lcg } from './support/inputDriver.js'

// One input gives one output whatever path reads it: every tracked key a
// core plans regionally, from a window or its regional planners, is the key
// the general compile alone gives from the whole document's parse. Keys build on each
// other, as typing nests suggestions, on 1-10 KB documents, on a
// 2,000-block document, and as input actions on documents of literal blocks
// and literal suggestions.

const lines = (count: number, line: (index: number) => string): string => Array.from({ length: count }, (_, index) => line(index)).join('\n')

function control(): DocumentCore {
  const core = createDocumentCore()
  planFromGeneralCompile(core)
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
  // Agreement is read without the search budget, as the reference searches.
  searchWithoutBudget(core)
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
  // Agreement is read without the search budget, as the reference searches.
  searchWithoutBudget(core)
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
  const regional = createDocumentCore()
  searchWithoutBudget(regional)
  return read(regional) === read(control())
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

  // A widened spelling is weighed against the whole document's readings.
  it('leaves a widened spelling to the document', () => {
    expect(keyAgrees('- item one\n- item two\n\n{++    indented in an ```arm\n++}{++n\n`$$``++}\n\nx{~~```\nold\n```\n~>```\nnq\nqw\n```\n~~}xPara *em* and `code` here.\n\n{--d--}```js\nconst closed = 1\n```\n\n{~~```js{++n++}\nconst a = 0\n```\n~>```const a = 1\n```{--d--}\n~~}\n', { start: 227, end: 227, insert: '\n\n' })).toBe(true)
  })

  // Typing in one's own Addition of indented code keeps its lines code.
  it('keeps a replacement in one\'s own indented-code arm as typed', () => {
    const source = '{~~$$\nx + y\n$$~>$$+ y$$\n$$~~}\n\n{~~```js\nold code\n~>w te    xt\n~~}\n\n> q{++x++}uoted line\n\n{++    indented in an arm\n++}\n\n{++    indented > in an arm\n++}\n\n<div> >\nold html\n--}\n'
    const edit = { start: 105, end: 109, insert: '> ' }
    const core = control()
    expect(core.trackedEdit(core.open(source), edit)).toEqual(edit)
    expect(keyAgrees(source, edit)).toBe(true)
  })

  it('reads a key in replaced fenced text beside an unclosed comment as the document does', () => {
    expect(keyAgrees('x{~~```\nold\n```\n~>```\nnq\nqw\n```\n~~}\n\n\n\n{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n``    `\n~~}\n\n{++~>++}{--<div>\nold html\n--}\n\nPlain words here.\n\n{++    indented in an arm\n++}\n\n{~~<div>\nold\n~><!--\nnew\n~~} ', { start: 58, end: 58, insert: '$$' })).toBe(true)
  })
})

// Dollar-heavy keys whose window compile once trimmed a spelling from the
// window's own extent, where the document compile weighs a wider one (B16):
// a window's spelling found in a span reaching its open edge is the document's.
const dollarWindowKeys: readonly (readonly [string, string, DocumentSourceEdit])[] = [
  ['4/5', 'q> $$\n> q\n\n```\ncode $$\n```\n\n$$\n\nz\n$$\n\n$$\n\n- item $$\n- item\n\ninline $a$ math\n\nz\n$' + '{++$$++}$\n\n$$\n\n{++$$\nx\ny\n$$++}\n\nReview {++new++} and {--old--} text.\n\nz\n$$\n\n$$\n\nz\n$$\n\n$$\n\n$$\nx_0 + y\nx_1\n$$\n\n{++$$\nx\ny\n$$++}\n\n$$\n\nPlain words here.\n\nx\n$$\n\n- item $$\n- item\n\nx\n$$\n\n$$\nx_0 + y\nx_1\n$$\n\n$$\n\nReview {++new++} and {--old--} text.\n\n- item $$\n- item\n\n{~~$$\nx\ny\n$\n$~>$$\nx\n\n\ny\n$$~~}\n\ninline $a$ math\n\ninline $a$ math\n\n$$\nx_0 + y\nx_1\n$$\n\ncosts $$5 and $3\n\ncosts $$5 and $3\n\n{++$$\nx\ny\n$$++}\n\n- item $$\n- item\n\nx\n$$\n\nz\n$$\n\n$$\n\n$$\nx_0 + y\nx_1\n$$\n\n\n\n{~~a~>$$\nx\ny\n$$\n~~}\n\n- item $$\n- item\n\nReview {++new++} and {--old--} text.\n\n{++x\ny\n$$++}\n\nReview {++new++} and {--old--} text.\n\n$$\nx_0 + y\nx_1\n$$\n\ninline $a$ math\n\n> $$\n> q\n\n{++x\n\n$$\ny\n\nw++}\n\n{~~a~>$$\nx\ny\n$$\n~~}\n\nx\n$$\n\n- item $$\n- item\n\n{~~$$\nx\ny\n$$~>$$\nx\n\n\ny\n$$~~}\n\nz\n$$\n\n$$\n\ncost$$s $$5 and $3\n\n$$\n\n- item $$\n- item\n\ncosts $$5 and $3\n\nPlain words here.\n\nReview {++new++} and {--old--} text.\n\nReview {++new++} and {--old--} text.\n\ncosts $$5 and $3\n\n$$\n\n- item $$\n- item\n\nz\n$$\n\n$$\n\n> $$\n> q\n\n```\ncode $$\n```\n\nx\n$$\n\n{++x\n\n$$\ny\n\nw++}\n\n{~~$$\nx\ny\n$$~>$$\nx\n\n\ny\n$$~~}\n\nPlain words here.\n\n- item $$\n- item\n\nx\n$$\n\nz\n$$\n\n$$\n\nz\n$$\n\n$$\n\n```\ncode $$\n```\n\n{++$$\nx\ny\n$$++}\n\n> $$\n> q\n\nx\n$$\n\ncosts $$5 and $3\n\n```\ncode $$\n```\n\n$$\nx_0 + y\nx_1\n$$\n', { start: 817, end: 820, insert: '\n\n$$\n' }],
  ['47/3', 'q$$\n\nz\n$$\n\n$$\n\n{++x\n\n$$\ny\n\nw++}\n\ninline $a$ math\n\n> $$\n> q\n\nReview {++new++} and {--old--} text.\n\n{~~$$\nx\ny\n$$~>$$\nx\n\n\ny\n$$~~}\n\n$$\nx_0 + y\nx_1\n$$\n\n{++$$\nx\ny\n$$++}\n\n{++x\n\n$$\ny\n\nw++}\n\n```\ncode $$\n```\n\nReview {++nx++} and {--old--} text.\n\ncosts $$5 and $3\n\n{++$$\nx\ny\n$$++}\n\n$$\nx_0 + y\nx_1\n$$\n\ncosts $$5 and $3\n\n$$\n\nReview {++new++} and{++$$++} {--old--} text.\n\n- item $$\n- item\n\n{++$$\nx\ny\n$$++}\n\nReview {++new++} and {--old--} text.\n\ninline $a$ math\n\nReview {++new++} and {--old--} text.\n\n> $$\n> q\n\n> $$\n> q\n\n{~~$$\nx\ny\n$$~>$$\nx\n\n\ny\n$$~~}\n\nz\n$$\n\n$$\n\nReview {++new++} and {--old--} text.\n\n{~~$$\nx\ny\n$$~>$$\nx\n\n\ny$\n$$~~}\n\n{~~$$\nx\ny\n$$~>$$\nx\n\n\ny\n$$~~}\n\nReview {++new++} and {--old--} text.\n', { start: 19, end: 19, insert: '$$' }],
  ['98/0', 'qinline $a$ math\n\n{~~a~>$$\nx\ny\n$$\n~~}\n\ninline $a$ math\n\ninline $a$ math\n\nz\n$$\n\n$$\n\n{++x\n\n$$\ny\n\nw++}\n\n```\ncode $$\n```\n\nz\n$$\n\n$$\n\nPlain words here.\n\nx\n$$\n\n> $$\n> q\n\n$$\nx_0 + y\nx_1\n$$\n\n```\ncode $$\n```\n\ncosts $$5 and $3\n\n$$\n\n```\ncode $$\n```\n\n- item $$\n- item\n\n```\ncode $$\n```\n\ncosts $$5 and $3\n\ncosts $$5 and $3\n\n$$\nx_0 + y\nx_1\n$$\n\n{~~$$\nx\ny\n$$~>$$\nx\n\n\ny\n$$~~}\n\n$$\nx_0 + y\nx_1\n$$\n\ncosts $$5 and $3\n\n{~~a~>$$\nx\ny\n$$\n~~}\n\n$$\nx_0 + y\nx_1\n$$\n\nz\n$$\n\n$$\n\n```\ncode $$\n```\n\n$$\n\nPlain words here.\n\ncosts $$5 and $3\n\n- item $$\n- item\n\nPlain words here.\n\nz\n$$\n\n$$\n\n$$\nx_0 + y\nx_1\n$$\n\n$$\nx_0 + y\nx_1\n$$\n\n{~~$$\nx\ny\n$$~>$$\nx\n\n\ny\n$$~~}\n\n```\ncode $$\n```\n\nPlain words here.\n\n$$\n\n{++x\n\n$$\ny\n\nw++}\n\n{++$$\nx\ny\n$$++}\n\nPlain words here.\n\n$$\nx_0 + y\nx_1\n$$\n\ninline $a$ math\n\nx\n$$\n\n{~~a~>$$\nx\ny\n$$\n~~}\n\ninline $a$ math\n\nz\n$$\n\n$$\n\nPlain words here.\n', { start: 230, end: 230, insert: '\n' }],
  ['132/3', 'q> $$\n> q\n\n{++$\n\n$$\n$\nx\ny\n$$++}\n\n{++x\n\n$$\ny\n\nw++}\n\n{++$$\nx\ny\n$$++}\n\n{++x\n\n$$\ny\n\nw++}\n\n```\ncode $$\n```\n\ncosts $$5 and $3\n\n{++x\n\n$$\ny\n\nw++}\n\ncosts $$5 and $3\n\nReview {++new++} and {--old--} text.\n\ninline \n$a$ math\n\n{++$$\nx\ny\n$$++}\n\nReview {++new++} and {--old--} text.\n\n{~~a~>$$\nx\ny\n$$\n~~}\n\nPlain words here.\n\nReview {++new++} and {--old--} text.\n\n```\ncode $$\n```\n\nz\n$$\n\n$$\n\n{++x\n\n$$\ny\n\nw++}\n\n{~~a~>$$\nx\ny\n$$\n~~}\n\n$$\nx_0 + y\nx_1\n$$\n\n$$\n\n$$\nx_0 + y\nx_1\n$$\n\nReview {++new++} and {--old--} text.\n\nz{++$$++}\n$$\n\n$$\n\n{++$$\nx\ny\n$$++}\n\n- item $$\n- item\n\ncosts $$5 and $3\n\n$$\nx_0 + y\nx_1\n$$\n\nReview {++new++} and {--old--} text.\n\nx\n$$\n\nz\n$$\n\n$$\n\n$$\nx_0 + y\nx_1\n$$\n\n{~~a~>$$\nx\ny\n$$\n~~}\n\nPlain words here.\n\ninline $a$ math\n\n> $$\n> q\n\n$$\n\nPlain words here.\n\n{++$$\nx\ny\n$$++}\n\nReview {++new++} and {--old--} text.\n\ninline $a$ math\n', { start: 562, end: 562, insert: 'x' }],
  ['591/0', 'q$$\n\n$$\nx_0 + y\nx_1\n$$\n\n$$\nx_0 + y\nx_1\n$$\n\n```\ncode $$\n```\n\nReview {++new++} and {--old--} text.\n\n$$\nx_0 + y\nx_1\n$$\n\n> $$\n> q\n\n$$\nx_0 + y\nx_1\n$$\n\n> $$\n> q\n\n$$\nx_0 + y\nx_1\n$$\n\nReview {++new++} and {--old--} text.\n\nReview {++new++} and {--old--} text.\n\nPlain words here.\n\n{++x\n\n$$\ny\n\nw++}\n\n$$\nx_0 + y\nx_1\n$$\n\nPlain words here.\n\nReview {++new++} and {--old--} text.\n\nz\n$$\n\n$$\n\nPlain words here.\n\nz\n$$\n\n$$\n\ninline $a$ math\n\n{++x\n\n$$\ny\n\nw++}\n\n> $$\n> q\n\n$$\n\nReview {++new++} and {--old--} text.\n\n{++$$\nx\ny\n$$++}\n\n$$\nx_0 + y\nx_1\n$$\n\nx\n$$\n\n{~~$$\nx\ny\n$$~>$$\nx\n\n\ny\n$$~~}\n\n{~~a~>$$\nx\ny\n$$\n~~}\n', { start: 410, end: 410, insert: '$' }]
]

// A tracked Enter at a Substitution's old text start is the document
// compile's to place (generator key 141/1).
describe('Enter at a Substitution\'s old text start reads as the whole document plans it', () => {
  it.each(['Plain words.\n\n{~~old para~>new para~~}\n\nPlain words.', 'Lead {~~old para~>new para~~} tail.'])('in %j', middle => {
    const pad = Array.from({ length: 30 }, () => 'Plain words here.').join('\n\n')
    const source = `${pad}\n\n${middle}\n\n${pad}\n`
    const at = source.indexOf('{~~old') + 3
    for (const insert of ['\n\n', '\n']) expect(keyAgrees(source, { start: at, end: at, insert })).toBe(true)
  })
})

// An ordered list's items are no plain paragraph for the regional break
// planner, whatever words they hold (generator keys from the gap shapes).
describe('a tracked break in an ordered list item reads as the whole document plans it', () => {
  it.each(['\n', '\n\n'])('typing %j after an item marker', insert => {
    const pad = Array.from({ length: 6 }, (_, index) => `Plain paragraph ${index} here.`).join('\n\n')
    const source = `${pad}\n\n1. step 0\n1. step 1\n1. step 2\n{++added\n\nblock++}\n\n${pad}\n`
    const at = source.lastIndexOf('1.') + 2
    expect(keyAgrees(source, { start: at, end: at, insert })).toBe(true)
  })
})

// Structural keys the gap generator found planned differently by a window or
// a regional planner than by the general compile (B19): a table cell scan
// that read fences otherwise than the parser, a `$$` before the window, a
// projection that failed on a Substitution ending in list items, and own
// draft typing that opens an HTML block.
const structuralKeys: readonly (readonly [string, string, DocumentSourceEdit])[] = [
  ['330/1', 'q> - nested item\n>   more\n\n    indented code\n\n{~~old para~>new para~~}\n\n- item one\n- item {++two++}\n  continued\n\n<div>\nhtml\n</div>\n\n{++\n++}> - nested item\n>   more\n\n{++block\n\nadded++}\n\n# Heading\n\n    indented code\n\nSetext\n---\n\ntext with `code` and *em*\n\n- item one\n- item {++two++}\n  continued\n\n> - nested item\n>   more\n\nPlain words here.\n\nReview {++new++} and {--old--} text.\n\n- item one\n- item {++two++}\n  continued\n\n{++block\n\nadded++}\n\ntext with `code` and *em*\n\n# Heading\n\n> quoted line\n> second {~~a~>b~~} line\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nSetext\n---\n\n{++block\n\nadded++}\n\nPlain words here.\n\n# Heading\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nPlain words here.\n\n<div>\nhtml\n</div>\n\n> - nested item\n>   more\n\n1. first\n2. second\n\n{++block\n\nadded++}\n\n    indented code\n\n```js\nconst a = 1\n```\n\n- outer\n  > inner quote\n  > more\n\n{++block\n\nadded++}\n\nReview {++new++} and {--old--} text.\n\n> - nested item\n>   more\n\n    indented code\n\ntext with `code` and *em*\n\n{~~old para~>new para~~}\n\n{++block\n\nadded++}\n\n{~~old para~>new para~~}\n\n> quoted line\n> second {~~a~>b~~} line\n\nSetext\n---\n\n{++block\n\nadded++}\n\n1. first\n2. second\n\nPlain words here.\n\n- item one\n- item {++two++}\n  continued\n\n    indented code\n\nReview {++new++} and {--old--} text.\n\nPlain words here.\n\n> - nested item\n>   more\n\n1. first\n2. second\n\n- outer\n  > inner quote\n  > more\n\n{++block\n\nadded++}\n\nReview {++new++} and {--old--} text.\n\ntext with `code` and *em*\n\n- outer\n  > inner quote\n  > more\n\n<div>\nhtml\n</div>\n\nSetext\n---\n\n$$\nx\n$$\n\n> quoted line\n> second {~~a~>b~~} line\n\n- item one\n- item {++two++}\n  continued\n\n<div>\nhtml\n</div>\n\n{++block\n\nadded++}\n\nSetext\n---\n\n{~~old para~>new para~~}\n\n    indented code\n\n    indented code\n\n```js\nconst a = 1\n```\n\nSetext\n---\n\n$$\nx\n$$\n\ntext with `code` and *em*\n\n- item one\n- item {++two++}\n  continued\n\nPlain words here.\n\n{~~old para~>new para~~}\n', { start: 1486, end: 1487, insert: '\n' }],
  ['509/7', 'qtext with `code` and *em*\n\n1. first\n2. second\n\n{++$$++}Plain words here.\n\n```js\nconst a = 1\n```\n\nPlain words here.\n{++\n++}\nReview {++new++} and {--old--} text.\n\ntext with `code` and *em*\n\ntext with `code` and *em*\n\n- item one\n- item {++two++}\n  continued\n\n- item one\n- item {++two++}\n  continued\n\nPlain words here.\n\n# Heading\n\nSetext\n---\n\n$$\nx\n$$\n\n- outer\n  > inner quote\n  > more\n\n{++block\n\nadded++}\n\ntext with `code` and *em*\n\n# Heading\n\n{~~old para~>new para~~}\n\n- item one\n- item {++two++}\n  continued\n\n- item one\n- item {++two++}\n  continued\n\n$$\nx\n$$\n\nReview {++new++} and {--old--} text.\n\n# Heading\n\n> - nested item\n>   more\n\nReview {++new++} and {--old--} text.\n\n- outer\n  > inner quote\n  > more\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n{~~old para~>new para~~}\n\n{~~old para~>new para~~}\n\n- outer\n  > inner quote\n  > more\n\n    indented code\n\ntext with `code` and *em*\n\n```js\nconst a = 1\n```\n\n1. first\n2. second\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\ntext with {~~`code`~>`cod|e`~~} and *em*\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n> quoted line\n> second {~~a~>b~~} line\n\n> - nested item\n>   more\n\n- item one\n- item {++two++}\n  continued\n\n- outer\n  > inner quote\n  > more\n\n| a | b |\n{++1. ++}| - | - |\n| 1 | 2 |\n\n<div>\nhtml\n</div>\n\nReview {++new++} and {--old--} text.\n\n```js\nconst a = 1\n```\n\n- item one\n- item {++two++}\n  continued\n\n- item one\n- item {++two++}\n  continued\n\n```js\nconst a = 1\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n    indented code\n\n# Heading\n{++\n++}\n{~~old para~>\\{--new para~~}\n\n- outer\n  > inner quote\n  > more\n\nSetext\n---\n\n- item one\n- item {++two++}\n  continued\n\n{~~Review {++new++} and {--old--} text.\n\nPlain words here.\n\nSetext\n---\n~>```Review {++new++} and {--old--} text.\n\nPlain words here.\n\nSetext\n---\n~~}', { start: 466, end: 466, insert: '|' }],
  ['524/0', 'q$$\nx\n$$\n\n# Heading\n\n{~~old para~>new para~~}\n\nSetext\n---\n\n- item one\n- item {++two++}\n  continued\n\n<div>\nhtml\n</div>\n\nSetext\n---\n\n> - nested item\n>   more\n\n```js\nconst a = 1\n```\n\nPlain words here.\n\nPlain words here.\n\n1. first\n2. second\n\n{~~old para~>new para~~}\n\n{++block\n\nadded++}\n\nSetext\n---\n\n$$\nx\n$$\n\n- item one\n- item {++two++}\n  continued\n\n- outer\n  > inner quote\n  > more\n\n1. first\n2. second\n\n1. first\n2. second\n\nReview {++new++} and {--old--} text.\n\n$$\nx\n$$\n\n- item one\n- item {++two++}\n  continued\n\nReview {++new++} and {--old--} text.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nPlain words here.\n\nSetext\n---\n\n# Heading\n\n- item one\n- item {++two++}\n  continued\n\n{~~old para~>new para~~}\n\n$$\nx\n$$\n\n```js\nconst a = 1\n```\n\n- outer\n  > inner quote\n  > more\n\n{++block\n\nadded++}\n\n> - nested item\n>   more\n\n1. first\n2. second\n\n$$\nx\n$$\n\n- item one\n- item {++two++}\n  continued\n\n> - nested item\n>   more\n\n{++block\n\nadded++}\n\n> quoted line\n> second {~~a~>b~~} line\n\n<div>\nhtml\n</div>\n\n$$\nx\n$$\n\n> quoted line\n> second {~~a~>b~~} line\n\n> - nested item\n>   more\n', { start: 618, end: 618, insert: '$$' }],
  ['597/1', 'q```js\nconst a = 1\n```\n\n$$\nx\n$$\n\n- outer\n  > inner quote\n  > more\n\n> quoted line\n> second {~~a~>b~~} line\n\n# Heading\n\n    indented code\n\n- item one\n- item {++two++}\n  continued\n\n# Heading\n\n1. first\n2. second\n\n    indented code\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- outer\n  > inner quote\n  > more\n\n$$\nx\n$$\n\n# Heading\n\n{~~old para~>new para~~}\n\n- item one\n- item {++two++}\n  continued\n\n# Heading\n\n- item one\n- item {++two++}\n  continued\n\ntext with `code` and *em*\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nPlain words here.\n\nSetext\n---\n\n    indented code\n\n# Heading\n\n<div>\nhtml\n</div>\n\n```js\nconst a = 1\n```\n\n- item one\n- item {++two++}\n  continued\n\n    indented code\n\ntext with `code` and *em*\n\n> quoted line\n> second {~~a~>b~~} line\n\n1. first\n2. second\n\n    indented code\n\n{++> ++}<div>\nhtml\n</div>\n\n- outer\n  > inner quote\n  > more\n\n> - nested item\n>   more\n\n<div>\nhtml\n</div>\n\n> - nested item\n>   more\n\nPlain words here.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\nconst a = 1\n```\n\nReview {++new++} and {--old--} text.\n\nSetext\n---\n\n$$\nx\n$$\n\ntext with `code` and *em*\n\ntext with `code` and *em*\n\n<div>\nhtml\n</div>\n\n<div>\nhtml\n</div>\n', { start: 909, end: 911, insert: '# ' }],
  ['639/5', 'q- outer\n  > inner quote\n  > more\n\n- outer\n  > inner quote\n  > more\n\n> quoted line\n> second {~~a~>b~~} line\n\nReview {++new++} and {--old--} text.\n\n{~~old para~>new para~~}\n\n- outer\n  > inner quote\n  > more\n\n# Heading\n\n{++block\n\nadded++}\n\n$$\nx\n$$\n\n1. first\n2. second\n\n- outer\n  > inner quote\n  > more\n\ntext with {~~`code`~>````e`~~} and *em*\n\nPlain words here.\n\n<div>\nhtml\n</div>\n\nSetext\n{++\n> ++}---\n\n<div>\nhtml\n</div>\n\n```js\nconst a = 1\n```\n\n```js\nconst a = 1\n```\n\nReview {++new++} and {--old--} text.\n\n$$\nx\n$$\n\n- item one\n- item {++two++}\n  continued\n\n    indented code\n\nSetext\n--{++\n++}-\n\n- item one\n- item {++two++}\n  continued\n\n1. first\n2. second\n\n# Heading\n\n# Heading\n\ntext with `code` and *em*\n\n# Heading\n\n> quoted line\n> second {~~a~>b~~} line\n\n{++block\n\nadded++}\n\n> quoted line\n> second {~~a~>b~~} line\n\n$$\nx\n$$\n\n- outer\n  > inner quote\n  > more\n\nR{++\n\n++}eview {++new++} and {--old--} text.\n\n1. first\n2. second\n\nSetext\n---\n\n{~~old para~>new para~~}\n\n{~~old para~>new para~~}\n\n```js\nconst a = 1\n```\n\n> - nested item\n>   more\n\n> - nested item\n>   more\n\n{++block\n\nadded++}\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n> - nested item\n>   more\n\n{~~old para~>new para~~}\n\n1. first\n2. second\n\n{++block\n\nadded++}\n\n- outer\n  > inner quote\n  > more\n\nSetext\n---\n\n# Heading\n\n- item one\n- item {++two++}\n  continued\n\n> - nested item\n>   more\n{++\\++}++}\n> quoted line\n> second {~~a~>b~~} line\n', { start: 861, end: 861, insert: '<div>' }],
  ['678/3', 'q    indented code\n\nPlain words here.\n\n- outer\n  > inner quote\n  > more\n\n> quoted line\n> second {~~a~>b~~} line\n\n{++block\n\nadded++}\n\n$$\nx\n$$\n\n- outer\n  > inner quote\n  > more\n\nPlain words here.\n\n> - nested item\n>   more\n\n- item one\n- item {++two++}\n  continued\n\n$$\nx\n$$\n\n$$\nx\n$$\n\n# Heading\n\n- outer\n  > inner quote\n  > more\n```\n- outer\n  > inner quote\n  > more\n\n- item one\n- item {++two++}\n  continued\n\n- outer\n  > inner quote\n  > more\n\ntext with `code` and *em*\n\n> quoted line\n> second {~~a~>b~~} line\n\n$$\nx\n$$\n\n{~~old para~>new para~~}\n\n1. first\n2. second\n\n    indented code\n\nReview {++new++} and {--old--} text.\n\n{~~old para~>new para~~}\n\n> - nested item\n>   more\n\n$$\nx\n$$\n\n- outer\n  > inner quote\n  > more\n\n> quoted line\n> second {~~a~>b~~} line\n\n> quoted line\n> second {~~a~>b~~} line\n\n<div>\nhtml\n</div>\n\n# Heading\n\n{~~- item one\n- item {++two++}\n  continued\n\n- item one\n- item {++two++}\n  continued\n\n- outer\n  > inner quote\n  > more\n\n```js\nconst a = 1\n```\n\nP{++\n> ++}lain words here.\n\n    indented code\n\n- item one\n- item {++two++}\n  continued\n\n- item one\n- item {++two++}\n  continued\n\ntext with `code` and *em*\n\n> quoted line\n> second {~~a~>b~~} line\n\n<div>\nhtml\n</div>\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- item one\n- item {++two++}\n  continued\n\n> quoted line\n> second {~~a~>b~~} line\n\n```js\nconst a = 1\n```\n\n- outer\n  > inner quote\n  > more\n\n{++block\n\nadded++}\n\ntext with `code` and *em*\n\n{++block\n\nadded++}\n\n{~~old para~>new para~~}\n\n> quoted line\n> second {~~a~>b~~} line\n~>- item one\n- item {++two++}\n  continued\n~~~item one\n- item {++two++}\n  continued\n\n- outer\n  > inner quote\n  > more\n\n```js\nconst a = 1\n```\n\nPlain words here.\n\n    indented code\n\n- item one\n- item {++two++}\n  continued\n\n- item one\n- item {++two++}\n  continued\n\ntext with `code` and *em*\n\n> quoted line\n> second {~~a~>b~~} line\n\n<div>\nhtml\n</div>\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- item one\n- item {++two++}\n  continued\n\n> quoted line\n> second {~~a~>b~~} line\n\n```js\nconst a = 1\n```\n\n- outer\n  > inner quote\n  > more\n\n{++block\n\nadded++}\n\ntext with `code` and *em*\n\n{++block\n\nadded++}\n\n{~~old para~>new para~~}\n\n> quoted line\n> second {~~a~>b~~} line\n~~}', { start: 1208, end: 1208, insert: '# ' }],
  ['718/5', 'qSetext\n---\n\n{++block\n\nadded++}\n\n{++block\n\nadded++}\n\n- item one\n- item {++two++}\n  continued\n\n{~~old para~>new para~~}\n\n{++block\n\nadded++}\n\n# Heading\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n1. first\n2. second\n\n- outer\n  > inner quote\n  > more\n\nReview {++new++} and {--old--} text.\n\n> - nested item\n>   more\n\n> - nested item\n>   more\n\n    indented code\n\n```js\nconst a = 1\n```\n\nSetext\n---\n\n{~~<div>\nhtml\n</div>\n~><div>\n~~~html\n</div>\n~~}\nSetext\n---\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n> - nested item\n>   more\n\n> - nested item\n>   more\n\n1. first\n2. second\n\n    indented code\n\n- item one\n- item {++two++}\n  continued\n\n> quoted line\n> second {~~a~>b~~} line\n\n- item one\n- item {++two++}\n  continued\n\n$$\nx\n$$\n\n{++block\n\nadded++}\n\nPlain words here.\n\n```js\nconst a = 1\n```\n\n- item one\n- item {++two++}\n  continued\n\n- item one\n- item {++two++}\n  continued\n\n1. first\n2. second\n\n> quoted line\n> second {~~a~>b~~} line\n\n{~~old para~>new pa===ra~~}\n\n$$\nx\n$$\n\n# Heading\n\n{++block\n\nadded++}\n\nSetext\n---\n\n# Heading\n\n$$\nx\n$$\n\n- item one\n- item {++two++}\n  continued\n\n{~~old para~>new para~~}\n\n<div>\nhtml\n</div>\n\n{~~old para~>new para~~}\n\n> quoted line\n> second {~~a~>b~~} line\n\n> quoted line\n> second {~~a~>b~~} line\n\n    indented code\n\n    indented code\n\nPlain words here.\n\n- out{++- ++}er\n  > inner quote\n  > more\n\n    indented code\n\n1. first\n2. second\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n    indented code\n\nReview {++new++} and {--old--} text.\n\n{~~old para~>new para~~}\n\n# Heading\n\ntext with `code` and *em*\n\n{~~old para~>new para~~}\n\n{++block\n\nadded++}\n\n```js\nconst a = 1\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n{++\n\n++}\n# Heading\n\n- outer\n  > inner quote\n  > more\n\n1. first\n2. second\n\n{++block\n\nadded++}\n\nPlain words here.\n\n> quoted line\n> second {~~a~>b~~} line\n\n- outer\n  > inner quote\n  > more\n\n# Heading\n\n{++\n++}1. first\n2. second\n\n> quoted line\n> second {~~a~>b~~} line\n\nSetext\n---\n', { start: 1548, end: 1550, insert: '++}' }],
  ['736/5', 'qtext with `code` and *em*\n\n```js\nconst a = 1\n```\n{++===++}\n> quoted line\n> second {~~a~>b~~} line\n\n> - nested item\n>   more\n\n- item one\n- item {++two++}\n  continued\n\nPlain words here.\n\n> quoted line\n> second {~~a~>b~~} line\n\nReview {++new++} and {--old--} text.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\ntext with `code` and *em*\n\n```js\nconst a = 1\n```\n\nPlain words here.\n\n1. first\n2. second\n\ntext with `code` and *em*\n\nReview {++new++} and {--old--} text.\n\n- item one\n- item {++two++}\n  continued\n\n    indented code\n\n> quoted line\n> second {~~a~>b~~} line\n\n```js\nconst a = 1\n```\n\nPlain words here.\n{--\n{++block\n\nadded++}\n\n$$\nx\n$$\n\ntext with `code` and *em*\n\n1. first\n2--}{++~~~++}{~~. second\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nSetext\n---\n\n<div>\nhtml\n</div>\n\n<div>\nhtml\n</div>\n\n    indented code\n\n```js\nconst a = 1\n```\n~>\n```\n\n{++block\n\nadded++}\n\n$$\nx\n$$\n\ntext with `code` and *em*\n\n1. first\n2. second\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nSetext\n---\n\n<div>\nhtml\n</div>\n\n<div>\nhtml\n</div>\n\n    indented code\n\n```js\nconst a = 1\n```\n~~}\n> quoted line\n> second {~~a~>b~~} line\n\nPlain words here.\n\ntext wi{++|++}th `code` and *em*\n\n<div>\nhtml\n</div>\n\n> - nested item\n>   more\n\n> - nested item\n>   more\n\n> - nested item\n>   more\n\n> quoted line\n> second {~~a~>b~~} line\n\n<div>\nhtml\n</div>\n\n```js\nconst a = 1\n```\n\nPlain words here.\n\n- item one\n- item {++two++}\n  continued\n\ntext with `code` and *em*\n\n> quoted line\n> second {~~a~>b~~} line\n\n<div>\nhtml\n</div>\n\n{++block\n\nadded++}\n\nPlain words here.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n    indented code\n\ntext with `code` and *em*\n\n1. first\n2. second\n\n{++\nblock\n\nadded++}\n\n> - nested item\n>   more\n\n{++block\n\nadded++}\n\n1. first\n2. second\n\n- outer\n  > inner quote\n  > more\n\nReview {++new++} and {--old--} text.\n\nPlain words here.\n\ntext with `code` and *em*\n\n{++block\n\nadded++}\n\n$$\nx\n$$\n\n> - nested item\n>   more\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\nconst a = 1\n```\n\n1. first\n2. second\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- item one\n- item {++two++}\n  continued\n\n<div>\nhtml\n</div>\n\n| a | b |\n| - | - |\n| 1 | 2 |\n', { start: 1935, end: 1935, insert: 'x' }],
  ['1236/0', 'q<div>\nhtml\n</div>\n\nReview {++new++} and {--old--} text.\n\n{~~old para~>new para~~}\n\n{~~old para~>new para~~}\n\ntext with `code` and *em*\n\n    indented code\n\n1. first\n2. second\n\ntext with `code` and *em*\n\n- item one\n- item {++two++}\n  continued\n\nReview {++new++} and {--old--} text.\n\n<div>\nhtml\n</div>\n\nSetext\n---\n\n    indented code\n\n1. first\n2. second\n\nReview {++new++} and {--old--} text.\n\nPlain words here.\n\n{++block\n\nadded++}\n\n1. first\n2. second\n\n- outer\n  > inner quote\n  > more\n\n{~~old para~>new para~~}\n\n# Heading\n\ntext with `code` and *em*\n\nReview {++new++} and {--old--} text.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n    indented code\n\nReview {++new++} and {--old--} text.\n\n1. first\n2. second\n\n> quoted line\n> second {~~a~>b~~} line\n\n<div>\nhtml\n</div>\n\ntext with `code` and *em*\n\nPlain words here.\n\n> - nested item\n>   more\n\n# Heading\n\n{++block\n\nadded++}\n\n{++block\n\nadded++}\n\n- item one\n- item {++two++}\n  continued\n\n{~~old para~>new para~~}\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n1. first\n2. second\n\n# Heading\n\n- outer\n  > inner quote\n  > more\n\n$$\nx\n$$\n\n$$\nx\n$$\n\n{++block\n\nadded++}\n\n> quoted line\n> second {~~a~>b~~} line\n\n> - nested item\n>   more\n\n- outer\n  > inner quote\n  > more\n\n# Heading\n\n<div>\nhtml\n</div>\n\n{++block\n\nadded++}\n\n{++block\n\nadded++}\n\n$$\nx\n$$\n\n# Heading\n\n- item one\n- item {++two++}\n  continued\n\n<div>\nhtml\n</div>\n\n$$\nx\n$$\n\nPlain words here.\n\n> - nested item\n>   more\n\nSetext\n---\n\n1. first\n2. second\n\n$$\nx\n$$\n\n$$\nx\n$$\n\n    indented code\n\n{~~old para~>new para~~}\n\n    indented code\n\n1. first\n2. second\n\n> - nested item\n>   more\n', { start: 1251, end: 1251, insert: '~~~' }],
  ['1291/2', 'q1. first\n2. second\n\n- item one\n- item {++two++}\n  continued\n\nReview {++new++} and {--old--} text.\n\n> quoted line\n> second {~~a~>b~~} line\n\nReview {++new++} and {--old--} text.\n\n```js\nconst a = 1\n```\n\n> - nested item\n>   more\n\n> quoted line\n> second {~~a~>b~~} line\n\n- outer\n  > inner quote\n  > more\n\nReview {++new++} and {--old--} text.\n\nReview {++new++} and {--old--} text.\n\n- item one\n- item {++two++}\n  continued\n\n- outer\n  > inner quote\n  > more\n\nSetext\n---\n\n<div>\nhtml\n</div>\n\n1. first\n2. second\n\n- item one\n- item {++two++}\n  continued\n\n# Heading\n\n<div>\nhtml\n</div>\n\n{++block\n\nadded++}\n\nReview {++new++} and {--old--} text.\n\nPlain words here.\n\n- item one\n- item {++two++}\n  continued\n\n{~~- outer\n  > inner quote\n  > more\n~><div>- outer\n  > inner quote\n  > more\n~~}\n$$\nx\n$$\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n# Heading\n\n> - nested item\n>   more\n\nSetext\n---\n\n> - nested item\n>   more\n\n{~~old para~>new p`a~~}\n\nSetext\n---\n\n- item one\n- item {++two++}\n  continued\n\nPlain words here.\n\n1. first\n2. second\n\n    indented code\n\nPlain words here.\n\n> - nested item\n>   more\n\ntext with `code` and *em*\n\n    indented code\n\n{++block\n\nadded++}\n\n# Heading\n\n- outer\n  > inner quote\n  > more\n\nReview {++new++} and {--old--} text.\n\nReview {++new++} and {--old--} text.\n\nPlain words here.\n\n```js\nconst a = 1\n```\n\n> quoted line\n> second {~~a~>b~~} line\n\nReview {++new++} and {--old--} text.\n\n```js\nconst a = 1\n```\n\ntext with `code` and *em*\n\nPlain words here.\n\n> quoted line\n> second {~~a~>b~~} line\n\n{++block\n\nadded++}\n\n<div>\nhtml\n</div>\n\ntext with `code` and *em*\n\n    indented code\n\n- outer\n  > inner quote\n  > more\n\n<div>\nhtml\n</div>\n\n<div>\nhtml\n</div>\n\n{++block\n\nadded++}\n\n$$\nx\n$$\n\n```js\nconst a = 1\n```\n\n- outer\n  > inner quote\n  > more\n\n{~~old para~>new para~~}\n\n- item one\n- item {++two++}\n  continued\n\n$$\nx\n$$\n\n- outer\n  > inner quote\n  > more\n\n$$\nx\n$$\n\nSetext\n---\n\n1. first\n2. second\n\n{++block\n\nadded++}\n\n    indented code\n\n```js\nconst a = 1\n```\n', { start: 1842, end: 1842, insert: '~~~' }]
]

describe('a structural key reads as the whole document plans it', () => {
  it.each(structuralKeys)('generator key %s', (_key, source, edit) => {
    expect(keyAgrees(source, edit)).toBe(true)
  })
})

describe('a dollar-heavy key reads as the whole document plans it', () => {
  // Key 4/5 compiles its whole document unbudgeted (about 1.7 s at idle),
  // which outlasts the default 5 s under a loaded lane.
  it.each(dollarWindowKeys)('fuzz key %s', (_key, source, edit) => {
    expect(keyAgrees(source, edit)).toBe(true)
  })
})

// The draft's own acceptance can read past the arm before any edit (a block
// the arm boundary ends absorbs what follows; a paragraph it ends joins the
// next): an edit in one's own arm is still the edit as typed.
describe('a plain edit in one\'s own draft reads as typed', () => {
  it.each([
    ['in an unclosed fence, by Backspace', 'Text\n\n{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n``\n`\n~~}\n\nPlain words here.\n', 'const a = 1', 2, 1, ''],
    ['in an unclosed fence, by Enter', 'Text\n\n{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n`\n``\n~~}\n\nPlain words here.\n', 'const a = 1', 10, 0, '\n'],
    ['in an HTML block the next suggestion follows', '{~~<div>\nold\n</div>\n~><div>\nnew 1\n</div>\n~~}{~~\n<div>\nold html\n</div>\n~><div>\nnew html\n</div>\n~~}\n', 'new 1\n</div', 9, 1, ''],
    ['in a $$ block after a paragraph', '{~~a~>x~~}\n{~~$$\nx_0\n$$\n~>$$\ny_0 + 1\n$$\n~~}\n', 'y_0 + 1', 6, 0, '\n'],
    // The arm reads the split-off line as a paragraph until it resolves, its
    // acceptance as indented code: the draft's layout, not the edit's.
    ['in lines its arm reads as a paragraph, by Enter', 'Intro.\n\n{~~    indented 0\n~>\n     \n   indented 0\n    indented 1\n    indxnted 2\n~~}\n', '    indxnted', 0, 0, '\n\n'],
    ['in a paragraph before an HTML block', 'Plain words here.\n\n{~~<div>\nold\n</div>\n~>x<divx>\nml 1\nhtml 2\n</div>\n~~}{++\n++}\n{++```js\nconst added = 1\n```\n++}\n', 'ml 1\nhtml', 4, 1, ''],
    // A `$$` that opens its arm's line stands alone there, as in the draft's
    // acceptance, so its math block spans a blank line typed into it.
    ['in a $$ block that opens its arm, by a blank line', 'Intro.\n\n{~~a~>$$\nx\ny{--d--}\n$$\n~~}\n\nEnd.\n', 'x\ny', 1, 0, '\n\n']
  ])('%s', (_name, source, anchor, offset, length, insert) => {
    const start = source.lastIndexOf(anchor) + offset
    const edit = { start, end: start + length, insert }
    const core = control()
    expect(core.trackedEdit(core.open(source), edit)).toEqual(edit)
    expect(keyAgrees(source, edit)).toBe(true)
  })

  // The changes are compared up to a bound; past it the edit is weighed as
  // any other, which rewrites the draft here, and a window leaves it so too.
  it.each([
    ['within the regional shortcut', 20, 10, true],
    ['past the regional shortcut', 40, 100, true],
    ['past the compared change', 300, 1200, false]
  ])('deletes a paragraph\'s text %s', (_name, words, length, plain) => {
    const head = 'Plain words here.\n\n{~~<div>\nold\n</div>\n~>x<divx>\n'
    // Underscores keep the text out of plain word typing, which stays as typed.
    const source = `${head}${'w_rd '.repeat(words)}\nml 1\nhtml 2\n</div>\n~~}{++\n++}\n{++\`\`\`js\nconst added = 1\n\`\`\`\n++}\n`
    const edit = { start: head.length + 2, end: head.length + 2 + length, insert: '' }
    const core = control()
    const planned = core.trackedEdit(core.open(source), edit)
    if (plain) expect(planned).toEqual(edit)
    else expect(planned).toMatchObject({ start: head.indexOf('{~~'), insert: expect.stringMatching(/^\{~~\{~~<div>/u) })
    expect(keyAgrees(source, edit)).toBe(true)
  })
})
