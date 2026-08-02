import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CompleteDocumentRevision,
  type DocumentRevision,
  type ParseConfiguration
} from '@marktext/document-core'
import { hostedRunnerTimeout } from '../helpers/hostedRunnerTimeout.js'

const CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: {
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: false,
    footnotes: false,
    subscriptAndSuperscript: true
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

function complete(revision: DocumentRevision): CompleteDocumentRevision {
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete revision')
  }
  return revision
}

function appendKeystrokeCounts(source: string): Readonly<{
  reuses: number
  emissions: number
}> {
  const engine = createLanguageEngine()
  const before = complete(engine.open(
    createSourceSnapshot(source),
    CONFIGURATION
  ))
  const at = source.length - 1
  const after = `${source.slice(0, at)}z${source.slice(at)}`
  const beforeCounts = engine.traversalCounts()
  complete(engine.reopen(
    before,
    createSourceSnapshot(after),
    Object.freeze([{ start: at, end: at, insert: 'z' }])
  ))
  const counts = engine.traversalCounts()
  return Object.freeze({
    // Provenance-carried regions satisfy the same property byte-keyed
    // reuse proves: the region was carried, not re-emitted.
    reuses: counts.forkAstRegionReuses - beforeCounts.forkAstRegionReuses +
      counts.forkAstRegionProvenanceReuses -
      beforeCounts.forkAstRegionProvenanceReuses,
    emissions:
      counts.forkAstRegionEmissions - beforeCounts.forkAstRegionEmissions
  })
}

// G31: fragment reuse is the standing performance commitment, and it
// previously switched off entirely between 95,177 and 95,415 bytes of
// blank-separated paragraphs — the retention budget filled, FIFO eviction
// thrashed, and one keystroke re-emitted every region in the document.
describe('fragment reuse coverage past the retention cliff', () => {
  it('reuses regions for a keystroke in a 150 KB paragraph document', () => {
    const source = Array.from(
      { length: 4_500 },
      (_, index) => `Para ${index} with some words in it.`
    ).join('\n\n') + '\n'
    expect(source.length).toBeGreaterThan(150_000)

    const counts = appendKeystrokeCounts(source)
    expect(counts.reuses).toBeGreaterThan(4_000)
    expect(counts.emissions).toBeLessThan(10)
  })

  it('reuses regions for a keystroke in a 500 KB paragraph document', () => {
    const source = Array.from(
      { length: 15_000 },
      (_, index) => `Para ${index} with some words in it.`
    ).join('\n\n') + '\n'
    expect(source.length).toBeGreaterThan(500_000)

    const counts = appendKeystrokeCounts(source)
    expect(counts.reuses).toBeGreaterThan(14_000)
    expect(counts.emissions).toBeLessThan(10)
  }, hostedRunnerTimeout(30_000))

  // The shape half of G31: a contiguous list is one region however long it
  // is, so reuse must engage at the item level.
  it('reuses items for a keystroke in a 4,000-item bullet list', () => {
    const source = Array.from(
      { length: 4_000 },
      (_, index) => `- item ${index} with some words in it.`
    ).join('\n') + '\n'

    const counts = appendKeystrokeCounts(source)
    expect(counts.reuses).toBeGreaterThan(3_900)
  }, hostedRunnerTimeout(30_000))

  it('reuses items for a keystroke in a 4,000-item ordered list', () => {
    const source = Array.from(
      { length: 4_000 },
      (_, index) => `${index + 1}. item ${index} with some words.`
    ).join('\n') + '\n'

    const counts = appendKeystrokeCounts(source)
    expect(counts.reuses).toBeGreaterThan(3_900)
  }, hostedRunnerTimeout(30_000))

  it('reuses items in a 4,000-item task list', () => {
    const source = Array.from(
      { length: 4_000 },
      (_, index) => `- [${index % 2 === 0 ? ' ' : 'x'}] task ${index}`
    ).join('\n') + '\n'

    const counts = appendKeystrokeCounts(source)
    expect(counts.reuses).toBeGreaterThan(3_900)
  }, hostedRunnerTimeout(30_000))

  it('reuses segments in a 4,000-paragraph blockquote', () => {
    const source = Array.from(
      { length: 4_000 },
      (_, index) => `> quoted ${index} with some words.\n>`
    ).join('\n') + '\n'

    const counts = appendKeystrokeCounts(source)
    expect(counts.reuses).toBeGreaterThan(3_900)
  }, hostedRunnerTimeout(30_000))
})
