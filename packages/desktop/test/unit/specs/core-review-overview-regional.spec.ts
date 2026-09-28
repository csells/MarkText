import { createDocumentCore, type DocumentRevision } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { inspectDocumentCore } from '../../../../document-core/src/internal/documentCoreInspection'
import { createReviewOverviewTracker } from '@/documentAuthority/coreReviewOverview'

// Plan 0012 G35: after regional edits the Review overview reads only the
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
  '   '
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
})
