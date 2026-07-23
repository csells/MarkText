import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'
import {
  __criticMarkupRecognitionCountV1,
  __resetCriticMarkupRecognitionCountV1
} from '../../src/internal/profile1Document.js'

/**
 * Phase 0.5 ladder steps 1-2: "one CriticMarkup authority per open."
 *
 * A CriticMarkup document is recognized once — the canonical parse. The
 * per-projection boundary guard and clean verifier must NOT run a second and
 * third CriticMarkup recognition over each view; they need only a Markdown parse
 * plus a bounded marker scan. This spec counts full `parseCriticMarkup`
 * recognitions per `open()`.
 *
 * Baseline before the ladder: 5 for a single-form document (canonical +
 * guard×2 + verifier×2). Step 1 (verifier) drops it to 3; step 2 (guard) to 1.
 */

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

function recognitionsFor(source: string): number {
  __resetCriticMarkupRecognitionCountV1()
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  expect(revision.kind).toBe('complete')
  return __criticMarkupRecognitionCountV1()
}

describe('one CriticMarkup authority per open', () => {
  // Step 1 (verifier) — DONE. The clean verifier no longer recognizes
  // CriticMarkup, so the only remaining recognitions are the canonical parse
  // and one boundary guard per projection. A single-form document has two
  // projections (original, revised): 1 + 2 = 3.
  it('after step 1, recognizes only canonically and once per projection guard', () => {
    expect(recognitionsFor('a{++new++}b\n')).toBe(3)
  })

  // A document with a Comment adds a comment-display projection, hence one more
  // guard: 1 + 3 = 4. This pins the per-projection-guard shape until step 2.
  it('adds exactly one guard recognition per projection', () => {
    expect(recognitionsFor('a{++x++}{--y--}{~~o~>n~~}{==h==}{>>c<<}b\n')).toBe(4)
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

  // Step 2 (guard) — the target end state: exactly one recognition (canonical)
  // per open, zero for a CriticMarkup-free document. BLOCKED: the guard's
  // escaping is driven by the CriticMarkup parser's context-sensitive
  // delimiter-event stream, not by lexical marker tokens (verified: `a++}b`
  // stays unescaped in projections). The plan's "findMarker at each join"
  // mechanism would over-escape literal markers and regress round-trip
  // fidelity, so removing the guard's parse needs a delimiter-event-preserving
  // mechanism, not a lexical scan. Remove `.fails` when that lands.
  it.fails('step 2 target: exactly one recognition per open', () => {
    expect(recognitionsFor('a{++new++}b\n')).toBe(1)
    expect(recognitionsFor('# Title\n\nHello *world*.\n')).toBe(0)
  })
})
