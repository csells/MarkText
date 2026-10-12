import { describe, expect, it } from 'vitest'
import { createDocumentCore, type DocumentCore, type DocumentInputAction, type DocumentRevision, type DocumentSourceEdit } from '../src/index.js'
import { inspectRegionalLeaves, planFromGeneralCompile, searchWithoutBudget } from '../src/internal/documentCoreInspection.js'
import { lcg } from './support/inputDriver.js'

// A root suggestion that opens a block after a blank line starts a region:
// nothing is open before it, its arms read from that same clean state as
// self-contained fragments (ADR-0010, ADR-0016 L2c), and after its closer
// the enclosing state resumes unchanged. Windows may therefore start there,
// and must read every key as the whole document does, also where an arm
// leaves a fence, math or HTML block open at its boundary.

/** Offsets at which the revision's regional leaves start. */
function leafStarts(core: DocumentCore, revision: DocumentRevision): number[] {
  let offset = 0
  return (inspectRegionalLeaves(core, revision) ?? []).map(value => {
    const start = offset
    offset += (value as { sourceLength: number }).sourceLength
    return start
  })
}

const openArmBlocks = [
  'Plain words here.',
  'Para *em* and `code` here.',
  '```js\nconst closed = 1\n```',
  '$$\nx + y\n$$',
  '<div>\nhtml\n</div>',
  '- item one\n- item two',
  '> quoted line',
  '',
  // Arms that leave a literal open at their boundary.
  '{~~```js\nold code\n~>new text\n~~}',
  '{~~```js\nold code~>new text~~}',
  '{~~```\nold\n```\n~>```\nnew\n~~}',
  '{++$$\nx + y\n++}',
  '{--<div>\nold html\n--}',
  '{~~<div>\nold\n~><!--\nnew\n~~}',
  '{==```\nmarked\n==}{>>a comment<<}',
  '{++    indented in an arm\n++}',
  // Whole literal blocks in arms, and a suggestion right after one.
  '{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n```\n~~}',
  'x{~~```\nold\n```\n~>```\nnq\nqw\n```\n~~}',
  '{++```js\nconst added = 1\n```\n++}\n{--gone--}'
]
const insertions = ['x', 'word', ' ', '\n', '\n\n', '```', '~~~', '$$', '</div>', '<div>', '~>', '~~}', '{++n++}', '{--d--}', '    ', '- ', '> ']

/** The reference: the general compile over whole parses, with no safe point, window or reuse. */
function control(): DocumentCore {
  const core = createDocumentCore()
  planFromGeneralCompile(core)
  return core
}

function documentFrom(random: () => number): string {
  return Array.from({ length: 3 + Math.floor(random() * 6) }, () => openArmBlocks[Math.floor(random() * openArmBlocks.length)] ?? '')
    .join('\n\n') + '\n'
}

const options = { autoPairBracket: true, autoPairMarkdownSyntax: true, autoPairQuote: true }

describe('a root suggestion opening a block after a blank line', () => {
  it('starts a region, and does not where it opens mid-line or after an open literal', () => {
    const suggestion = '{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n```\n~~}'
    const source = `x{~~a~>b~~}\n\n${suggestion}\n\nAfter.\n`
    const core = createDocumentCore()
    const revision = core.open(source)
    expect(leafStarts(core, revision)).toContain(source.indexOf(suggestion))

    const afterOpenFence = `\`\`\`\nunclosed\n\n${suggestion}\n`
    const fenced = core.open(afterOpenFence)
    expect(leafStarts(core, fenced)).not.toContain(afterOpenFence.indexOf(suggestion))

    const inList = `- item\n\n  ${suggestion}\n`
    const listed = core.open(inList)
    expect(leafStarts(core, listed)).not.toContain(inList.indexOf(suggestion))
  })

  // Plan 0012, 5 October: Enter in one's own Substitution's new arm, inside
  // its fence, after a paragraph ending in another fenced Substitution, put
  // the whole of both in a new Substitution. It extends the draft, as the
  // untracked edit does, whichever compile reads it.
  it('lets Enter in its new arm extend the draft', () => {
    const source = 'x{~~```\nold\n```\n~>```\nnq\nqw\n```\n~~}\n\n{~~```js\nconst a = 0\n```\n~>```js\nconst a = 1\n`\n``\n~~}\n'
    const caret = source.indexOf('const a = 1') + 'const a = '.length
    const input = {
      range: { start: caret, end: caret },
      selection: { ranges: [{ anchor: caret, focus: caret }], primary: 0 },
      inputType: 'insertParagraph',
      data: null,
      options
    } as DocumentInputAction
    const plan = (core: DocumentCore): readonly DocumentSourceEdit[] | undefined => {
      const revision = core.open(source)
      return core.inputEdits(revision, input, core.planInput(revision, input, { tracked: true }), true)
    }
    expect(plan(createDocumentCore())).toEqual([{ start: caret, end: caret, insert: '\n' }])
    expect(plan(control())).toEqual([{ start: caret, end: caret, insert: '\n' }])
  })

  const seeds = Number(process.env.MARKTEXT_OPEN_ARM_SEEDS ?? 40)
  const first = Number(process.env.MARKTEXT_OPEN_ARM_FIRST ?? 1)
  it.each(Array.from({ length: seeds }, (_, index) => first + index))('reads keys around arms left open as the whole document does, seed %i', seed => {
    const random = lcg(seed * 6151)
    const core = createDocumentCore()
    // The planners are compared with the reference on their own, as the
    // reference searches spellings: without the search budget.
    searchWithoutBudget(core)
    let revision = core.open(documentFrom(random))
    for (let key = 0; key < 12; key += 1) {
      const text = revision.source
      const start = Math.floor(random() * (text.length + 1))
      const end = random() < 0.3 ? Math.min(text.length, start + 1 + Math.floor(random() * 4)) : start
      const insert = end > start && random() < 0.5 ? '' : insertions[Math.floor(random() * insertions.length)] ?? 'x'
      const label = `${JSON.stringify(text)} [${start}, ${end}) ${JSON.stringify(insert)}`
      if (random() < 0.5) {
        // A tracked key, as its window and as the whole document's parse plan it.
        const read = (target: DocumentCore, at: DocumentRevision): string => {
          try {
            return JSON.stringify(target.trackedEdit(at, { start, end, insert }) ?? null)
          } catch (error) {
            return `throws ${String(error)}`
          }
        }
        const regional = read(core, revision)
        const checker = control()
        expect(regional, label).toBe(read(checker, checker.open(text)))
        const planned = regional.startsWith('throws') ? null : JSON.parse(regional) as DocumentSourceEdit | null
        try {
          revision = core.apply(revision, [planned ?? { start, end, insert }], { projections: ['markup'] }).revision
        } catch {
          // A refused key leaves the document as it was.
        }
      } else {
        // An untracked edit, applied regionally, reads as a fresh open.
        const applied = core.apply(revision, [{ start, end, insert }], { projections: ['markup'] }).revision
        const oracle = createDocumentCore()
        const fresh = oracle.open(applied.source)
        expect(applied.annotations, label).toEqual(fresh.annotations)
        expect(applied.diagnostics, label).toEqual(fresh.diagnostics)
        expect(core.project(applied, 'markup').events, label).toEqual(oracle.project(fresh, 'markup').events)
        revision = applied
      }
    }
    // The reference compiles each tracked key over whole parses, with no
    // window or reuse, which costs seconds per seed.
  }, 60_000)
})
