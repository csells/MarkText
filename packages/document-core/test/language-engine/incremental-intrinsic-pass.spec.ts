import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

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
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

/** Plain prose: `count` paragraphs with no CriticMarkup. */
function prose(count: number): string {
  return `${Array.from({ length: count }, (_, index) =>
    `Paragraph ${index} of ordinary untouched prose that fills a line.`
  ).join('\n\n')}\n`
}

/**
 * G32: the intrinsic pass re-reads the whole document on every reopen. A
 * one-character edit near the end of a document must cost about the edited
 * region — bounded re-scan between safe points plus suffix re-basing — not
 * another full pass over text the edit never touched. The passing row pins
 * today's whole-document cost so the incremental work has a baseline to
 * move; the failing row is the target and flips green when G32 lands.
 */
describe('incremental intrinsic pass', () => {
  function reopenCost(paragraphs: number): Readonly<{
    spent: number
    ratio: number
  }> {
    const engine = createLanguageEngine()
    const source = prose(paragraphs)
    const revision = engine.open(
      createSourceSnapshot(source),
      TEST_CONFIGURATION
    )
    expect(revision.kind).toBe('complete')
    const before = engine.traversalCounts().intrinsicSourceUnits

    const offset = source.length - 2
    const edited = `${source.slice(0, offset)}x${source.slice(offset)}`
    const reopened = engine.reopen(
      revision,
      createSourceSnapshot(edited),
      [{ start: offset, end: offset, insert: 'x' }]
    )
    expect(reopened.kind).toBe('complete')
    const spent = engine.traversalCounts().intrinsicSourceUnits - before
    return Object.freeze({ spent, ratio: spent / edited.length })
  }

  it('a one-character reopen costs o(document)', () => {
    // Safe-point-bounded re-scan: the edited paragraph plus splice
    // bookkeeping, far below another full pass. Landed by the G32 splice;
    // incremental-equivalence.spec.ts proves the spliced revision is
    // indistinguishable from a full parse.
    expect(reopenCost(60).ratio).toBeLessThan(0.25)
  })

  it('the reopen cost does not scale with untouched prose', () => {
    const small = reopenCost(20).spent
    const large = reopenCost(80).spent
    // Fixed per-edit cost in absolute units: quadrupling the untouched
    // prose must not quadruple what a one-character edit spends.
    expect(large).toBeLessThan(small * 2)
  })
})
