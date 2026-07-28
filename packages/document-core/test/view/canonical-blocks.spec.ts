import { describe, expect, it } from 'vitest'
import {
  canonicalMarkupDocument,
  createLanguageEngine,
  createSourceSnapshot,
  type CompleteDocumentRevision,
  type ParseConfiguration
} from '@marktext/document-core'

/**
 * Integration vertical slice, increment 2b — the editing-view block AST.
 *
 * A WYSIWYG editor renders the CANONICAL (marker-bearing) view. Its block
 * structure (headings, lists, blockquotes) must come from the engine — if the
 * view re-parsed Markdown to get it, that would be a second Markdown authority
 * in the editing path, the sin this rebuild exists to kill. The engine must
 * MOUNTable block structure; the view mounts it, never computes it.
 *
 * ADR 0013: the engine parses once and reads every view off it; the editing
 * view is that single parse. For a CriticMarkup-free document the editing view
 * IS the source, so its block tree is the shared parse the engine already
 * builds. For a marker-bearing document the editing-view block tree is a read of
 * the single forked parse (slice 3); until that lands it returns null.
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

function revisionFor(source: string): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    TEST_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete document revision')
  }
  return revision
}

describe('canonical editing-view block AST', () => {
  it('provides the block tree for a CriticMarkup-free document', () => {
    const doc = canonicalMarkupDocument(revisionFor('# Title\n\nHello world.\n'))
    expect(doc.root.childCount).toBe(2)
    expect(doc.root.childAt(0).kind).toBe('heading')
    expect(doc.root.childAt(1).kind).toBe('paragraph')
    // The block tree is over the exact editing-view (canonical) source.
    expect(doc.source).toBe('# Title\n\nHello world.\n')
  })

  it('provides the editing-view block tree for a marker-bearing document', () => {
    // The editing view parses the source with markers zero-width and all content
    // present (ADR 0013). '{--# --}Title' → editing text '# Title' → a heading
    // (the deletion's content is present in the editing surface, struck through).
    const doc = canonicalMarkupDocument(revisionFor('{--# --}Title'))
    expect(doc.source).toBe('# Title')
    expect(doc.root.childCount).toBe(1)
    expect(doc.root.childAt(0).kind).toBe('heading')
  })

  it('parses an addition that splits a paragraph as two editing-view blocks', () => {
    // 'a{++\n\n++}b' → editing text 'a\n\nb' → two paragraphs (the inserted blank
    // line is present in the editing surface as an addition).
    const doc = canonicalMarkupDocument(revisionFor('a{++\n\n++}b'))
    expect(doc.source).toBe('a\n\nb')
    expect(doc.root.childCount).toBe(2)
    expect(doc.root.childAt(0).kind).toBe('paragraph')
    expect(doc.root.childAt(1).kind).toBe('paragraph')
  })

  it('emits both substitution arms into the editing-view parse', () => {
    // 'a{~~old~>new~~}b' → editing text 'aoldnewb' (old arm then new arm) → one
    // paragraph. Verified against the session model text.
    const doc = canonicalMarkupDocument(revisionFor('a{~~old~>new~~}b'))
    expect(doc.source).toBe('aoldnewb')
    expect(doc.root.childCount).toBe(1)
    expect(doc.root.childAt(0).kind).toBe('paragraph')
  })

  it('keeps both substitution arms self-contained at their junction', () => {
    // The editing view is the only view showing both arms adjacent, so it is the
    // only one that can pair Markdown across the arm junction — which ADR-0010
    // forbids ("matching state created inside an arm must finish inside it").
    // 'a{~~*x*~>*y*~~}b' → 'a*x**y*b': the two `*` at the junction must NOT pair
    // into one span; each arm keeps its own emphasis.
    const doc = canonicalMarkupDocument(revisionFor('a{~~*x*~>*y*~~}b'))
    // Exact content, with no protective escapes injected — the editing surface
    // shows what the author wrote, and matches the session's model text.
    expect(doc.source).toBe('a*x**y*b')
    expect(doc.root.childCount).toBe(1)
    const paragraph = doc.root.childAt(0)
    expect(Array.from(
      { length: paragraph.childCount },
      (_, ordinal) => paragraph.childAt(ordinal).kind
    )).toEqual(['text', 'emphasis', 'emphasis', 'text'])
  })
})
