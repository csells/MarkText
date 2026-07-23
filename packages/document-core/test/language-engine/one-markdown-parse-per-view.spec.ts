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
 * The migration is measured here by parse count. Outside CriticMarkup marker
 * regions every view is byte-identical, so a CriticMarkup-free document must
 * parse exactly ONCE — the redundant per-view reparse is precisely the "parse
 * more than once when nothing changed" waste the single-parse architecture
 * removes. Marker cases still parse more than once until their fork-reads land
 * (slices 2-3); their counts below are the current ceiling, not the target.
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
  it('parses a CriticMarkup-free document exactly once (all views read one parse)', () => {
    // Original === Revised === editing when there are no markers, so one parse
    // serves every view. This is ADR 0013 slice 1.
    expect(parsesFor('# Title\n\nHello *world*.\n')).toBe(1)
  })

  it('parses a document whose forms create no arm scopes (slice-2 ceiling: 2)', () => {
    // Addition/Deletion/Highlight/Comment create no Substitution-arm scopes.
    // Target is 1 once inline arm-selection reads land (slice 2); today 2.
    expect(parsesFor('a{++x++}{--y--}{==h==}b\n')).toBe(2)
  })

  it('still verifies a Substitution, which does create arm scopes', () => {
    // Both arms produce matching scopes, so each view keeps its verification
    // parse: 2 views x (scoped + clean) = 4.
    expect(parsesFor('a{~~old~>new~~}b\n')).toBe(4)
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
