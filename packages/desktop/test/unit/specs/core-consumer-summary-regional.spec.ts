import { createDocumentCore, type DocumentRevision } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { inspectDocumentCore } from '../../../../document-core/src/internal/documentCoreInspection'
import {
  createConsumerSummaryTracker,
  type CoreConsumerSummary
} from '@/documentAuthority/coreConsumerSummary'
import { tocEntryOf } from '@/documentConsumers/documentProjectionConsumers'
import { projectedHeadingNodes } from '@/documentConsumers/projectedHeadings'

// Plan 0012 G35: after regional edits, counts and the outline read the
// Revised text and headings of only the blocks each edit replaced, and read
// exactly as the whole Revised projection of a fresh open does.

const lcg = (seed: number) => (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

const dense =
  'Review {++new evidence++} alongside {--obsolete details--}, {~~old wording~>better wording~~}, and {==a claim==}{>>Check this source.<<}.'
const blocks = [
  dense,
  'Plain words here.',
  '# Heading {++added++} words',
  '## Second {--gone--}level',
  'Setext {~~title~>heading~~}\n===',
  '{--# --}Revised paragraph',
  '> # Quoted {++heading++}\n> and text',
  '- item {++one++}\n- # item heading',
  'Line one {++x++}\nline two {--y--}.',
  '',
  '   '
]
const insertions = ['x', 'word', ' ', '\n', '\n\n', '# ', '{++n++}', '{--d--}', '{==h==}{>>c<<}']

const seeds = Number(process.env.MARKTEXT_SUMMARY_FUZZ_SEEDS ?? 24)
const first = Number(process.env.MARKTEXT_SUMMARY_FUZZ_FIRST ?? 1)

const readable = (summary: CoreConsumerSummary) => ({
  markdown: summary.markdown,
  headings: summary.headings.map((heading) => ({ ...tocEntryOf(heading), sourceRanges: heading.sourceRanges }))
})

const freshSummary = (source: string) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const projection = core.project(revision, 'revised')
  return readable({
    markdown: projection.markdown,
    headings: projectedHeadingNodes({
      markdown: projection.markdown,
      ast: projection.ast,
      sourceSegments: projection.coordinates.sourceSegments
    })
  })
}

let commits = 0
let regional = 0

describe('Counts and outline after regional edits', () => {
  it.each(Array.from({ length: seeds }, (_, index) => first + index))('read as a fresh Revised projection, seed %i', (seed) => {
    const random = lcg(seed * 7727)
    const count = 4 + Math.floor(random() * 8)
    const source =
      Array.from({ length: count }, () => blocks[Math.floor(random() * blocks.length)]).join('\n\n') +
      (random() < 0.8 ? '\n' : '')
    const core = createDocumentCore()
    let revision: DocumentRevision = core.open(source)
    const tracker = createConsumerSummaryTracker()
    tracker.summary(core, revision)
    for (let step = 0; step < 16; step += 1) {
      const text = revision.source
      const boundaries = [...text.matchAll(/(?<= )|(?=\r?\n)|(?<=\n)/gu)].map((match) => match.index)
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
        expect(readable(tracker.summary(core, revision)), `${JSON.stringify(text)} [${start}, ${end}) ${JSON.stringify(insert)}`)
          .toEqual(freshSummary(revision.source))
      }
    }
  })

  // Core keeps some edits in suggestion payloads whole-document; enough
  // others must be regional for the comparison to prove the patching.
  it('has compared summaries patched after regional changes', () => {
    expect(regional / commits).toBeGreaterThan(0.1)
  })

  it('refreshes after typing in a long dense document without a document parse', () => {
    const source = ['# Title', 'Warm editing paragraph.', ...Array.from({ length: 300 }, (_, index) =>
      index % 50 === 0 ? `## Section ${index} {++new++}` : dense)].join('\n\n') + '\n'
    const core = createDocumentCore()
    let revision = core.open(source)
    const tracker = createConsumerSummaryTracker()
    tracker.summary(core, revision)
    let caret = source.indexOf('Warm editing paragraph.') + 'Warm editing paragraph.'.length
    const edits = (at: number, insert: string) => {
      const commit = core.apply(revision, [{ start: at, end: at, insert }], { projections: ['markup'] })
      expect(commit.change.projections[0]).toMatchObject({ scope: 'regions' })
      tracker.committed(revision, commit.revision, commit.change)
      revision = commit.revision
    }
    // A suggestion, then words typed inside it, then a word in a later paragraph.
    for (const insert of ['{++x++}', 'y', 'z']) {
      edits(caret, insert)
      caret += insert.length === 1 ? 1 : '{++x'.length
    }
    edits(revision.source.indexOf('alongside', revision.source.indexOf('## Section 150')), 'q')
    const before = inspectDocumentCore(core)
    const summary = tracker.summary(core, revision)
    expect(inspectDocumentCore(core).documentParses - before.documentParses).toBe(0)
    expect(readable(summary)).toEqual(freshSummary(revision.source))
    expect(summary.headings.map((heading) => tocEntryOf(heading).content)).toContain('Section 150 new')
  })
})
