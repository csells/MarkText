import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CompleteDocumentRevision,
  type ParseConfiguration
} from '@marktext/document-core'

const TEST_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

// Research 0007's host spikes distilled adversarial inputs that broke (or
// nearly broke) every candidate engine; its adversarial review then broke the
// spike's own first implementation with them. These rows import that armor:
// each pins a Profile 1 recognition ruling document-core must hold.
describe('research 0007 spike regression rows', () => {
  const open = (source: string): CompleteDocumentRevision => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      TEST_CONFIGURATION
    )
    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') {
      throw new Error('Expected a complete revision')
    }
    return revision
  }

  it('nests same-form substitutions (N1): inner forms inside the outer old arm', () => {
    const revision = open('{~~a{~~b~>c~~}d~>e~~}\n')
    expect(revision.criticMarkup.rootCount).toBe(1)
    const outer = revision.criticMarkup.rootAt(0)
    expect(outer.kind).toBe('substitution')
  })

  it('keeps a divider inside a nested annotation as that annotation\'s payload (R4)', () => {
    // The spike\'s divider-hijack bug: the outer substitution stole the `~>`
    // inside the nested addition, destroying the addition.
    const revision = open('{~~x{++y~>z++}w~>v~~}\n')
    expect(revision.criticMarkup.rootCount).toBe(1)
    expect(revision.criticMarkup.rootAt(0).kind).toBe('substitution')
  })

  it('treats a stray divider after a failed substitution as literal (R2/R4)', () => {
    const revision = open('{~~old~~} and ~> arrow\n')
    // No top-level divider inside the braces: the substitution does not form,
    // and the stray arrow is text — nothing is erased or restructured.
    expect(revision.criticMarkup.rootCount).toBe(0)
    expect(revision.source.text).toContain('~> arrow')
  })

  it('degrades an unclosed substitution without blocking later constructs (R2)', () => {
    const revision = open('{~~ *b ~> c* d\n')
    expect(revision.criticMarkup.rootCount).toBe(0)
  })

  it('closes at the first closer even with an in-arm backtick open (C1 fixpoint ruling)', () => {
    // Two self-consistent readings exist for an in-arm backtick whose
    // completing run sits past the closer: defer the closer (the lezer host
    // behavior research 0007 recorded) or let it stand. Profile 1 rules for
    // standing, per C1: the completing run is OUTSIDE the arm, so the span
    // may not form — both endpoints must be in-arm. The corpus row
    // 'does not let a containing-arm literal erase its enclosing closer'
    // pinned this before the spike existed; this row states it in the
    // spike's vocabulary. (An attempted 'fix' toward the lezer reading was
    // reverted when four corpus rows — including R5 comment opacity —
    // defended this ruling.)
    const TICK = String.fromCharCode(96)
    const revision = open('{++a ' + TICK + 'x++}' + TICK + ' b++}\n')
    expect(revision.criticMarkup.rootCount).toBe(1)
    const addition = revision.criticMarkup.rootAt(0)
    expect(addition.kind).toBe('addition')
    expect(addition.range.end).toBe(revision.source.text.indexOf('++}') + 3)
  })

  it('never lets an unclosed code span swallow the closer (R2/R6)', () => {
    const TICK = String.fromCharCode(96)
    const revision = open('{++code ' + TICK + 'never closed++} tail\n')
    expect(revision.criticMarkup.rootCount).toBe(1)
    const addition = revision.criticMarkup.rootAt(0)
    expect(addition.kind).toBe('addition')
    // The backtick never completes, so the FIRST closer stands.
    expect(addition.range.end).toBe(revision.source.text.indexOf('++}') + 3)
  })

  it('keeps cross-arm backtick pairing dead: an intervening opener kills completion (C1)', () => {
    const TICK = String.fromCharCode(96)
    const unit = '{~~o~>' + TICK + 'a~~}'
    const revision = open(unit + unit + '\n')
    // Two clean substitutions — the second arm's backtick may not complete
    // the first arm's open span across the intervening opener.
    expect(revision.criticMarkup.rootCount).toBe(2)
    expect(revision.criticMarkup.rootAt(0).kind).toBe('substitution')
    expect(revision.criticMarkup.rootAt(1).kind).toBe('substitution')
  })

  it('adjacent annotations never cross-pair (R2 pairing)', () => {
    const revision = open('{++a++}{--b--} {==c==}{>>d<<}\n')
    expect(revision.criticMarkup.rootCount).toBe(4)
    expect(revision.criticMarkup.rootAt(0).kind).toBe('addition')
    expect(revision.criticMarkup.rootAt(1).kind).toBe('deletion')
    expect(revision.criticMarkup.rootAt(2).kind).toBe('highlight')
    expect(revision.criticMarkup.rootAt(3).kind).toBe('comment')
  })
})
