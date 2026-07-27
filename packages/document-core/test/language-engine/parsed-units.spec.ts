import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'
import {
  __markdownParsedUnitsV1,
  __resetMarkdownDocumentParsesV1
} from '../../src/internal/profile1/markdownParser.js'

/**
 * The parse-once invariant, measured in source units rather than parse calls.
 *
 * Parse *count* cannot express slice 2. A marker-bearing document resolves to
 * genuinely different text per view (`ab` vs `axb`), so Original and Revised can
 * never literally share one parse — the count has a floor of one per distinct
 * view text, no matter how much work is shared. The invariant's actual claim is
 * that *unchanged* text is parsed once, which is a statement about units.
 *
 * Target for slices 2-3: a document whose views differ in one paragraph costs
 * about its own length plus that paragraph — not a multiple of its length. These
 * rows pin today's cost so the fork work has a baseline to move, and mark the
 * target as expected-fail rather than implying it.
 */

const TEST_CONFIGURATION: ParseConfiguration = {
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
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

function unitsFor(source: string): number {
  __resetMarkdownDocumentParsesV1()
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  expect(revision.kind).toBe('complete')
  return __markdownParsedUnitsV1()
}

/** Review prose: `count` paragraphs, one carrying a tracked insertion. */
function reviewProse(count: number): string {
  return `${Array.from({ length: count }, (_, index) =>
    index === 3
      ? `Paragraph ${index} with an {++inserted++} clause.`
      : `Paragraph ${index} of ordinary untouched prose.`
  ).join('\n\n')}\n`
}

describe('parsed units', () => {
  it('parses a CriticMarkup-free document exactly once over its length', () => {
    const source = '# Title\n\nHello *world*.\n'
    // One parse of one text: no view diverges, so no unit is parsed twice.
    expect(unitsFor(source)).toBe(source.length)
  })

  it('parses an annotation-only document once over its projected length', () => {
    // Highlights render in both views and Comment bodies are hidden in both, so
    // the two views share one text — and the Comment display is what remains.
    const source = 'Hello {==world==}{>>note<<}.\n'
    expect(unitsFor(source)).toBeLessThan(source.length * 2)
  })

  it('parses unchanged text once when a paragraph diverges', () => {
    // Slice 2, landed. Was ~2x the document: 19 untouched paragraphs analysed
    // once for Original and again for Revised despite identical text. Revised
    // now reuses every shared region, so the cost is the document plus the one
    // divergent paragraph, not a multiple of the document.
    const source = reviewProse(20)
    const divergentParagraph = 'Paragraph 3 with an inserted clause.'.length
    expect(unitsFor(source)).toBeLessThan(source.length + divergentParagraph * 3)
  })

  it('no longer grows the cost with untouched prose', () => {
    // The waste used to track the text the reviewer did NOT change. Doubling the
    // untouched prose now roughly doubles the cost once — the shape of a single
    // pass — rather than doubling a duplicated pass.
    const small = unitsFor(reviewProse(10))
    const large = unitsFor(reviewProse(20))
    const smallSource = reviewProse(10)
    const largeSource = reviewProse(20)
    expect(small / smallSource.length).toBeLessThan(1.3)
    expect(large / largeSource.length).toBeLessThan(1.3)
  })

  it('scales the saving with document size', () => {
    // The bigger the untouched majority, the more is saved — the property that
    // makes this matter for real documents rather than fixtures.
    const source = reviewProse(60)
    expect(unitsFor(source) / source.length).toBeLessThan(1.1)
  })
})
