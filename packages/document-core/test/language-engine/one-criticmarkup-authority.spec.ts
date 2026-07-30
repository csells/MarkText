import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

/**
 * Phase 0.5 ladder steps 1-2: "one CriticMarkup authority per open."
 *
 * A CriticMarkup document is recognized once — the canonical parse. The
 * per-projection boundary guard and clean verifier must NOT run another
 * CriticMarkup recognition over either view. A projection without even a
 * marker candidate is provably safe without a guard. A projection join that
 * can spell a marker remains the RED case until the intrinsic grammar emits
 * the delimiter facts needed to protect it without reparsing.
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
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

function recognitionsFor(source: string): number {
  const engine = createLanguageEngine()
  const revision = engine.open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  expect(revision.kind).toBe('complete')
  return engine.traversalCounts().markerBearingIntrinsicSource
}

describe('one CriticMarkup authority per open', () => {
  it('recognizes marker-bearing canonical source exactly once', () => {
    expect(recognitionsFor('a{++new++}b\n')).toBe(1)
  })

  it('recognizes a complex marker-bearing source only canonically', () => {
    expect(recognitionsFor('a{++x++}{--y--}{~~o~>n~~}{==h==}{>>c<<}b\n')).toBe(1)
  })

  // A document with no CriticMarkup has nothing elided, so every projection is
  // byte-identical to canonical source with no joins — the boundary guard
  // cannot have anything to protect against, and must not run a CriticMarkup
  // recognition at all.
  it('runs no CriticMarkup recognition for a CriticMarkup-free document', () => {
    expect(recognitionsFor('# Title\n\nHello *world*.\n')).toBe(0)
  })

  it('runs no CriticMarkup recognition for CriticMarkup-free Markdown with links', () => {
    expect(recognitionsFor('[a]: /x\n\nSee [a] and `code`.\n')).toBe(0)
  })

  it('does not re-recognize a projection join that can spell a marker', () => {
    expect(recognitionsFor('{{--z--}++x++}')).toBe(1)
  })

  it('stages later reference definitions without replaying intrinsic source', () => {
    expect(recognitionsFor('See {++[r]++}.\n\n[r]: /url\n')).toBe(1)
  })
})
