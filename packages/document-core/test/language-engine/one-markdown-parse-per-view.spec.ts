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

  it('reads one shared view parse for an annotation-only document', () => {
    // Highlights show in both Original and Revised, and Comment bodies are
    // hidden in both, so an annotated-but-unchanged document is byte-identical
    // across views — the common "review without editing" case. Revised now reads
    // Original's parse instead of re-parsing it (was 3).
    //
    // The remaining parse is NOT a view parse: `createCommentDisplayProjections`
    // eagerly builds a display for each Comment, one full parse per comment.
    expect(parsesFor('Hello {==world==}{>>check this<<}.\n')).toBe(2)
  })

  it('costs one extra parse per comment, eagerly, at open', () => {
    // The O(comments x n) blow-up recorded in Phase 11 step 2: a review tool is
    // slowest exactly when it is most used. Each added Comment adds a full
    // document parse at open() even though nothing reads the display.
    const one = parsesFor('a {==x==}{>>one<<} b\n')
    const three = parsesFor('a {==x==}{>>one<<} {==y==}{>>two<<} {==z==}{>>three<<} b\n')
    expect(three - one).toBe(2)
  })

  it.fails('TARGET: comment displays are lazy, so annotation-only parses once', () => {
    // Turns green when comment-display projections are materialized on demand
    // (Phase 11 step 2), like the editing view already is.
    expect(parsesFor('Hello {==world==}{>>check this<<}.\n')).toBe(1)
  })

  it('parses unary-form documents twice today (was 4 — no-op planning removed)', () => {
    // Addition/Deletion/Highlight/Comment create no Substitution-arm scopes, so
    // no boundary planning runs; the two are Original and Revised per-view
    // reparses. Target is 1 once the fork-read model lands (slices 2-3).
    expect(parsesFor('a{++x++}{--y--}{==h==}b\n')).toBe(2)
  })

  it('reads the editing block AST without re-parsing when a view already matches', () => {
    // The editing view shows addition, deletion and highlight content and hides
    // comments. With no deletions and no Substitutions it is therefore
    // byte-identical to Revised, so mounting the editor's block AST must reuse
    // that parse rather than run another one over the same text.
    __resetMarkdownDocumentParsesV1()
    const revision = createLanguageEngine().open(
      createSourceSnapshot('a{++x++}b and {==h==}{>>note<<} here.\n'),
      TEST_CONFIGURATION
    )
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete document revision')
    }
    const afterOpen = __markdownDocumentParsesV1()
    revision.projection('editing')
    expect(__markdownDocumentParsesV1()).toBe(afterOpen)
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
