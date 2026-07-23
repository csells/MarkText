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
  liveHtmlSafetyProfile: 'live-html-safety-profile-1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
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
    if (doc === null) {
      throw new Error('Expected a canonical block document for CriticMarkup-free source')
    }
    expect(doc.root.childCount).toBe(2)
    expect(doc.root.childAt(0).kind).toBe('heading')
    expect(doc.root.childAt(1).kind).toBe('paragraph')
    // The block tree is over the exact editing-view (canonical) source.
    expect(doc.source).toBe('# Title\n\nHello world.\n')
  })

  // ADR 0013 slice 3 (block forks): the editing view is a read of the single
  // forked parse. Until that lands, canonicalMarkupDocument returns null for
  // marker-bearing docs, so these acceptance targets are expected-fail.
  it.fails('provides the editing-view block tree for a marker-bearing document', () => {
    // The editing view parses the source with markers zero-width and all content
    // present (ADR 0013). '{--# --}Title' → editing text '# Title' → a heading
    // (the deletion's content is present in the editing surface, struck through).
    const doc = canonicalMarkupDocument(revisionFor('{--# --}Title'))
    if (doc === null) {
      throw new Error('Expected a canonical block document for marker-bearing source')
    }
    expect(doc.source).toBe('# Title')
    expect(doc.root.childCount).toBe(1)
    expect(doc.root.childAt(0).kind).toBe('heading')
  })

  it.fails('parses an addition that splits a paragraph as two editing-view blocks', () => {
    // 'a{++\n\n++}b' → editing text 'a\n\nb' → two paragraphs (the inserted blank
    // line is present in the editing surface as an addition).
    const doc = canonicalMarkupDocument(revisionFor('a{++\n\n++}b'))
    if (doc === null) {
      throw new Error('Expected a canonical block document for marker-bearing source')
    }
    expect(doc.source).toBe('a\n\nb')
    expect(doc.root.childCount).toBe(2)
    expect(doc.root.childAt(0).kind).toBe('paragraph')
    expect(doc.root.childAt(1).kind).toBe('paragraph')
  })

  it.fails('emits both substitution arms into the editing-view parse', () => {
    // 'a{~~old~>new~~}b' → editing text 'aoldnewb' (old arm then new arm) → one
    // paragraph. Verified against the session model text.
    const doc = canonicalMarkupDocument(revisionFor('a{~~old~>new~~}b'))
    if (doc === null) {
      throw new Error('Expected a canonical block document for marker-bearing source')
    }
    expect(doc.source).toBe('aoldnewb')
    expect(doc.root.childCount).toBe(1)
    expect(doc.root.childAt(0).kind).toBe('paragraph')
  })
})
