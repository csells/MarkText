import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CompleteDocumentRevision,
  type DocumentRevision,
  type ParseConfiguration
} from '@marktext/document-core'
import {
  __profile1PhysicalTraversalCountsV1,
  __resetProfile1PhysicalTraversalCountsV1
} from '../../src/internal/profile1/physicalTraversalAccounting.js'

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
  __resetProfile1PhysicalTraversalCountsV1()
  complete(engine.reopen(
    before,
    createSourceSnapshot(after),
    Object.freeze([{ start: at, end: at, insert: 'z' }])
  ))
  const counts = __profile1PhysicalTraversalCountsV1()
  return Object.freeze({
    reuses: counts.forkAstRegionReuses,
    emissions: counts.forkAstRegionEmissions
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
  }, 30_000)
})
