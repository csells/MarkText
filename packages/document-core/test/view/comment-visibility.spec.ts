import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  materializeSearchText,
  type ParseConfiguration
} from '@marktext/document-core'

const CONFIGURATION: ParseConfiguration = {
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
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

describe('Comment prose visibility', () => {
  it('nested Comment source has no prose position', () => {
    const source = 'a{>>outer {++card++} {>>inner<<}<<}b'
    const revision = createLanguageEngine().open(
      createSourceSnapshot(source),
      CONFIGURATION
    )
    expect(revision.kind).toBe('complete')
    if (revision.kind !== 'complete') return

    for (const view of ['original', 'revised'] as const) {
      const projected = revision.projection(view)
      expect(projected.source, view).toBe('ab')
      expect(materializeSearchText(revision, view).text, view).toBe('ab')
      expect(projected.provenance.originAt(0)).toEqual({
        kind: 'canonical',
        sourceOffset: 0
      })
      expect(projected.provenance.originAt(1)).toEqual({
        kind: 'canonical',
        sourceOffset: source.length - 1
      })
    }

    const outer = revision.criticMarkup.rootAt(0)
    expect(outer.kind).toBe('comment')
    if (outer.kind !== 'comment') return
    const card = revision.commentDisplay(outer)
    expect(card.source).toBe('outer card ')
    expect(card.markdown.source).toBe(card.source)
  })
})
