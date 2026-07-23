import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'
import {
  __markdownDocumentParsesV1,
  __resetMarkdownDocumentParsesV1
} from '../../src/internal/profile1/markdownParser.js'

/**
 * ADR 0013: parse each document once and read every view off it.
 *
 * The migration is measured here by parse count, and the counter is now honest:
 * `__markdownDocumentParsesV1` increments in `parseMarkdownDocumentWithBoundaryEvidence`,
 * the shared entry of EVERY full document parse (invariant 21). That exposed —
 * and then let us remove — a hidden parse: the projection builder ran
 * `planMarkdownArmBoundaryProjectionEdits`, a full document parse, once per
 * projection even when the view has no Substitution-arm scopes and so no
 * boundary edits to plan. Skipping that no-op parse makes a CriticMarkup-free
 * document parse exactly ONCE (the invariant, now actually true) and halves
 * unary-form documents. Substitution still plans real arm boundaries.
 *
 * Remaining counts above 1 are per-view projection reparses that the fork-read
 * model (slices 2-3) removes; they are the current honest ceiling, not the target.
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

function parsesFor(source: string): number {
  __resetMarkdownDocumentParsesV1()
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  expect(revision.kind).toBe('complete')
  return __markdownDocumentParsesV1()
}

describe('one authoritative Markdown parse per view', () => {
  it('parses a CriticMarkup-free document exactly once', () => {
    // The invariant, now actually true and honestly counted: no markers, no
    // per-view divergence, no boundary edits to plan — one authoritative parse.
    expect(parsesFor('# Title\n\nHello *world*.\n')).toBe(1)
  })

  it('parses unary-form documents twice today (was 4 — no-op planning removed)', () => {
    // Addition/Deletion/Highlight/Comment create no Substitution-arm scopes, so
    // no boundary planning runs; the two are Original and Revised per-view
    // reparses. Target is 1 once the fork-read model lands (slices 2-3).
    expect(parsesFor('a{++x++}{--y--}{==h==}b\n')).toBe(2)
  })

  it('parses a Substitution six times today (arm boundaries genuinely planned)', () => {
    // Both arms produce matching scopes, so each view keeps its verification and
    // boundary-planning parses. Target is 1 once fork-reads land.
    expect(parsesFor('a{~~old~>new~~}b\n')).toBe(6)
  })

  it('preserves projected Markdown structure while skipping the tautology', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot('# T\n\n- a\n- b\n'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }
    const revised = revision.projection('revised')
    expect(revised.source).toBe('# T\n\n- a\n- b\n')
    expect(revised.markdown.root.childAt(0).kind).toBe('heading')
  })
})
