import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'
import {
  __referenceDefinitionIndexBuildsV1,
  __resetReferenceDefinitionIndexBuildsV1
} from '../../src/internal/profile1/markdownLaneState.js'

/**
 * Phase 0.5 step 6: one block/literal phase builds the reference-definition
 * index and the inline phase consumes it.
 *
 * `parsePlainMarkdownLane` built the index to drive its second pass and then
 * dropped it (`PlainMarkdownLaneParse` carried only literals/lines/depth), so
 * the CST builder rebuilt an identical index from the same literals. That is
 * one redundant whole-document scan per lane parse.
 *
 * The lane parse now returns the index it built from its final literals, and
 * the CST builder consumes it. Counted per `open()` across every lane parse
 * (canonical plus one per projection), so the numbers below are totals.
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

function indexBuildsFor(source: string): number {
  __resetReferenceDefinitionIndexBuildsV1()
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  expect(revision.kind).toBe('complete')
  return __referenceDefinitionIndexBuildsV1()
}

describe('one reference-definition index per lane parse', () => {
  it('builds one index per lane parse when there are no definitions', () => {
    // Was 12 per open: every lane parse built an index, then the CST builder
    // rebuilt an identical one from the same literals. Sharing the index halved
    // that to 6; dropping the tautological clean-verification parse halved it to
    // 4; ADR 0013 (Revised reads Original's parse) halved it to 2; and removing
    // the no-op arm-boundary planning parse (no scopes, no edits to plan) halves
    // it to 1 — a CriticMarkup-free document now builds the index exactly once.
    expect(indexBuildsFor('# Title\n\nHello *world*.\n')).toBe(1)
  })

  it('costs one extra build when definitions force a second block pass', () => {
    // A definition may follow its reference, so the block phase runs twice and
    // the carried index must come from the FINAL literals (the second pass can
    // reclassify them) — correctness over symmetry. Was 12; then 8; then 4;
    // removing the no-op planning parse halves it to 2 (the two block passes).
    expect(indexBuildsFor('[a]: /x\n\nSee [a].\n')).toBe(2)
  })

  it('preserves reference-link resolution while sharing the index', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('[a]: /x\n\nSee [a].\n'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }
    // The reference link must still resolve through the shared index.
    const revised = revision.projection('revised')
    expect(revised.source).toBe('[a]: /x\n\nSee [a].\n')
    expect(revised.markdown.root.childCount).toBeGreaterThan(0)
  })
})
