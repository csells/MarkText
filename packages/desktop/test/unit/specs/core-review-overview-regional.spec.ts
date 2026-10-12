import { createDocumentCore, type DocumentRevision } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { inspectDocumentCore } from '../../../../document-core/src/internal/documentCoreInspection'
import { createReviewOverviewTracker } from '@/documentAuthority/coreReviewOverview'

// After regional edits the Review overview reads only the
// blocks each edit replaced, and reads exactly as the overview of a fresh
// open of the same source.

const lcg = (seed: number) => (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

const dense =
  'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.'
const blocks = [
  dense,
  'Plain words here.',
  'Text {==marked *text*==}{>>see **this** {++and that++}<<} end.',
  '{==outer {==inner==}{>>nested<<} text==}{>>outer comment<<}',
  '{=={--gone--}==}{>>only deleted<<} tail.',
  '- item {++one++}\n- item {--two--}',
  '> quoted {~~a~>b~~} line',
  '# Heading {++added++}',
  'Line one {++x++}\nline two {--y--}.',
  '',
  '   ',
  // Long literal blocks, whose lines a regional reply replaces on their own.
  '```js\n' + Array.from({ length: 8 }, (_, index) => `const value${index} = ${index}`).join('\n') + '\n```',
  '$$\n' + Array.from({ length: 5 }, (_, index) => `x_{${index}} + y`).join('\n') + '\n$$',
  '<div>\n' + Array.from({ length: 5 }, (_, index) => `html ${index}`).join('\n') + '\n</div>',
  Array.from({ length: 6 }, (_, index) => `    indented ${index}`).join('\n')
]
// The words, breaks and suggestions typing makes, which Core applies
// regionally. Stray delimiters make a document's edits whole-document ones.
const insertions = ['x', 'word', ' ', 'q', 'x', '\n', '\n\n', '{++n++}', '{--d--}', '{==h==}{>>c<<}']
let commits = 0
let regional = 0

const seeds = Number(process.env.MARKTEXT_OVERVIEW_FUZZ_SEEDS ?? 24)
const first = Number(process.env.MARKTEXT_OVERVIEW_FUZZ_FIRST ?? 1)

const freshOverview = (source: string) => {
  const core = createDocumentCore()
  return createReviewOverviewTracker().overview(core, core.open(source))
}

describe('Review overview after regional edits', () => {
  it.each(Array.from({ length: seeds }, (_, index) => first + index))('reads as a fresh overview, seed %i', (seed) => {
    const random = lcg(seed * 104729)
    const count = 4 + Math.floor(random() * 8)
    const source =
      Array.from({ length: count }, () => blocks[Math.floor(random() * blocks.length)]).join('\n\n') +
      (random() < 0.8 ? '\n' : '')
    const core = createDocumentCore()
    let revision: DocumentRevision = core.open(source)
    const tracker = createReviewOverviewTracker()
    tracker.overview(core, revision)
    for (let step = 0; step < 16; step += 1) {
      const text = revision.source
      // Favour word boundaries and line ends, where typing lands; a random
      // position can split a marker and leave stray delimiters.
      const boundaries = [...text.matchAll(/(?<= )|(?=\r?\n)/gu)].map((match) => match.index)
      const start = random() < 0.8 && boundaries.length > 0
        ? boundaries[Math.floor(random() * boundaries.length)]
        : Math.floor(random() * (text.length + 1))
      const reach = random() < 0.3 ? Math.min(text.length, start + 1 + Math.floor(random() * 4)) : start
      const end = /^[\p{L} ]*$/u.test(text.slice(start, reach)) ? reach : start
      const insert = end > start && random() < 0.5 ? '' : insertions[Math.floor(random() * insertions.length)]
      const edit = { start, end, insert }
      const tracked = random() < 0.3 ? core.trackedEdit(revision, edit) : undefined
      const commit = core.apply(revision, [tracked ?? edit], { projections: ['markup'] })
      commits += 1
      if (commit.change.projections.some((projection) => projection.name === 'markup' && projection.scope === 'regions')) regional += 1
      tracker.committed(revision, commit.revision, commit.change)
      revision = commit.revision
      if (random() < 0.4 || step === 15) {
        expect(tracker.overview(core, revision), `${JSON.stringify(text)} [${start}, ${end}) ${JSON.stringify(insert)}`)
          .toEqual(freshOverview(revision.source))
      }
    }
  })

  // Core keeps some edits in suggestion payloads whole-document; enough
  // others must be regional for the comparison to prove the patching.
  it('has compared overviews patched after regional changes', () => {
    expect(regional / commits).toBeGreaterThan(0.2)
  })

  it('refreshes after typing in a long dense document without a document parse', () => {
    const source = ['Warm editing paragraph.', ...Array.from({ length: 300 }, () => dense)].join('\n\n') + '\n'
    const core = createDocumentCore()
    let revision = core.open(source)
    const tracker = createReviewOverviewTracker()
    const opened = tracker.overview(core, revision)
    let caret = 'Warm editing paragraph.'.length
    const before = inspectDocumentCore(core)
    // A suggestion, then words typed inside it.
    for (const insert of ['{++x++}', 'y', 'z']) {
      const commit = core.apply(revision, [{ start: caret, end: caret, insert }], { projections: ['markup'] })
      tracker.committed(revision, commit.revision, commit.change)
      revision = commit.revision
      caret += insert.length === 1 ? 1 : '{++x'.length
    }
    // Typing inside a later dense paragraph replaces that paragraph only.
    const later = revision.source.indexOf('new evidence', revision.source.length / 2)
    const commit = core.apply(revision, [{ start: later, end: later, insert: 'q' }], { projections: ['markup'] })
    tracker.committed(revision, commit.revision, commit.change)
    revision = commit.revision
    const overview = tracker.overview(core, revision)
    const after = inspectDocumentCore(core)
    expect(after.documentParses - before.documentParses).toBe(0)
    expect(overview).toHaveLength(opened.length + 1)
    // Unchanged entries keep their passages, so their excerpts need no new rendering.
    expect(overview[opened.length].excerpt).toBe(opened[opened.length - 1].excerpt)
    expect(overview).toEqual(freshOverview(revision.source))
  })

  // Lines typed in a suggestion arm's long literal block: the suggestion's
  // entry takes them in its arm's passage, reading none of the block again.
  const armLines = (count: number, line: (index: number) => string): string =>
    Array.from({ length: count }, (_, index) => line(index)).join('\n')
  const armBlocks = [
    'Plain words here.',
    '{~~```js\n' + armLines(6, (index) => `old ${index}`) + '\n```\n~>```js\n' + armLines(7, (index) => `new ${index}`) + '\n```\n~~}',
    '{~~$$\n' + armLines(5, (index) => `x_${index}`) + '\n$$\n~>$$\n' + armLines(6, (index) => `y_${index} + 1`) + '\n$$\n~~}',
    '{~~<div>\n' + armLines(5, (index) => `old html ${index}`) + '\n</div>\n~><div>\n' + armLines(5, (index) => `new html ${index}`) + '\n</div>\n~~}',
    '{++~~~\n' + armLines(6, (index) => `added ${index}`) + '\n~~~\n++}',
    '{--```\n' + armLines(5, (index) => `gone ${index}`) + '\n```\n--}',
    '{~~' + armLines(5, (index) => `    old indented ${index}`) + '\n~>' + armLines(5, (index) => `    new indented ${index}`) + '\n~~}',
    '{==```\n' + armLines(5, (index) => `marked ${index}`) + '\n```\n==}{>>a comment<<}'
  ]
  it.each(Array.from({ length: seeds }, (_, index) => first + index))('reads lines typed in suggestion arms as a fresh overview, seed %i', (seed) => {
    const random = lcg(seed * 2203)
    const count = 2 + Math.floor(random() * 5)
    const source = Array.from({ length: count }, () => armBlocks[Math.floor(random() * armBlocks.length)]).join('\n\n') + '\n'
    const core = createDocumentCore()
    let revision: DocumentRevision = core.open(source)
    const tracker = createReviewOverviewTracker()
    tracker.overview(core, revision)
    for (let step = 0; step < 12; step += 1) {
      const text = revision.source
      const inner = [...text.matchAll(/^ *(?:old|new|added|gone|marked|x_|y_)[^\n]*$/gmu)]
      const line = inner[Math.floor(random() * inner.length)]
      const start = line === undefined ? Math.floor(random() * (text.length + 1)) : line.index + Math.floor(random() * (line[0].length + 1))
      const end = random() < 0.2 ? Math.min(text.length, start + 1 + Math.floor(random() * 3)) : start
      const insert = end > start && random() < 0.5 ? '' : ['x', 'word', ' ', '\n', '\n\n'][Math.floor(random() * 5)]
      const commit = core.apply(revision, [{ start, end, insert }], { projections: ['markup'] })
      tracker.committed(revision, commit.revision, commit.change)
      revision = commit.revision
      if (random() < 0.5 || step === 11) {
        expect(tracker.overview(core, revision), `${JSON.stringify(text)} [${start}, ${end}) ${JSON.stringify(insert)}`)
          .toEqual(freshOverview(revision.source))
      }
    }
  })

  it.each([['proposed', 'new'], ['struck', 'old']])('reads lines typed in a long %s block without reading the block', (_name, arm) => {
    const block = (word: string) => '```js\n' + armLines(2000, (index) => `const ${word}${index} = ${index}`) + '\n```'
    const source = `Opening.\n\n{~~${block('old')}\n~>${block('new')}\n~~}\n\nAfter {++x++}.\n`
    const core = createDocumentCore()
    let revision = core.apply(core.open(source), [{ start: 2, end: 2, insert: 'q' }], { projections: ['markup'] }).revision
    const tracker = createReviewOverviewTracker()
    tracker.overview(core, revision)
    let at = revision.source.indexOf(`${arm}1000 =`) + 3
    for (const insert of ['x', 'y', '\n', 'z']) {
      const commit = core.apply(revision, [{ start: at, end: at, insert }], { projections: ['markup'] })
      expect(commit.change.projections[0]).toMatchObject({ scope: 'regions', replacements: [{ enclosing: [expect.anything()] }] })
      tracker.committed(revision, commit.revision, commit.change)
      revision = commit.revision
      at += insert.length
      const before = inspectDocumentCore(core)
      const overview = tracker.overview(core, revision)
      const after = inspectDocumentCore(core)
      expect(after.documentParses - before.documentParses).toBe(0)
      expect(after.regionalIntrinsicSourceUnits - before.regionalIntrinsicSourceUnits).toBe(0)
      expect(overview).toEqual(freshOverview(revision.source))
    }
  }, 60_000)
})
