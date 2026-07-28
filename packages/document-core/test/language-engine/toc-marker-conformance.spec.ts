import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  consumeTrustedHtml,
  createLanguageEngine,
  createSourceSnapshot,
  materializeCleanHtml,
  materializeReviewHtml,
  type CompleteDocumentRevision,
  type MarkdownNode,
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
    limitsProfile: 'desktop-v1',
    accountingSchema: 'syntax-accounting-1'
  }
}

function complete(source: string): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete document revision')
  }
  return revision
}

function roots(
  revision: CompleteDocumentRevision,
  view: 'original' | 'revised' | 'editing'
): readonly MarkdownNode[] {
  const root = revision.projection(view).markdown.root
  return Object.freeze(Array.from(
    { length: root.childCount },
    (_, ordinal) => root.childAt(ordinal)
  ))
}

function tocFacts(
  revision: CompleteDocumentRevision,
  view: 'original' | 'revised' | 'editing'
): readonly MarkdownNode[] {
  return roots(revision, view).filter(
    node => node.attributes['tableOfContents'] === true
  )
}

describe('Profile 1 table-of-contents marker production', () => {
  it('has no table-of-contents spelling recognizer in the HTML trust boundary', () => {
    const source = readFileSync(
      new URL('../../src/materialize/trustedHtml.ts', import.meta.url),
      'utf8'
    )

    expect(source).not.toContain('[TOC]')
    expect(source).not.toContain('tableOfContentsNodeIds')
    expect(source).not.toContain('markdownTextValue')
  })

  it.each([
    ['exact', '[TOC]\n'],
    ['surrounding ASCII space and tab', '  [TOC]\t  \n']
  ])('emits one parser fact for %s spelling', (_label, source) => {
    const revision = complete(source)

    for (const view of ['original', 'revised', 'editing'] as const) {
      expect(roots(revision, view).map(node => node.kind)).toEqual([
        'paragraph'
      ])
      expect(tocFacts(revision, view)).toHaveLength(1)
    }
    expect(revision.source.text).toBe(source)
  })

  it.each([
    ['lowercase spelling', '[toc]\n'],
    ['escaped opener', '\\[TOC]\n'],
    ['entity opener', '&#91;TOC]\n'],
    ['non-ASCII surrounding whitespace', '\u00a0[TOC]\u00a0\n'],
    ['inline code', '`[TOC]`\n'],
    ['fenced code', '```\n[TOC]\n```\n'],
    ['raw HTML block', '<p>[TOC]</p>\n'],
    ['link', '[TOC](/target)\n'],
    ['blockquote container', '> [TOC]\n'],
    ['multi-line paragraph', '[TOC]\ncontinued\n'],
    ['setext heading', '[TOC]\n---\n']
  ])('leaves %s as its ordinary Markdown production', (_label, source) => {
    const revision = complete(source)

    for (const view of ['original', 'revised', 'editing'] as const) {
      expect(tocFacts(revision, view)).toEqual([])
    }
    expect(revision.source.text).toBe(source)
  })

  it('combines fork-local marker facts with editing-view review ownership', () => {
    const addition = complete('{++[TOC]++}\n\n# Heading\n')
    expect(tocFacts(addition, 'original')).toEqual([])
    expect(tocFacts(addition, 'revised')).toHaveLength(1)
    // The editing AST can share the same intrinsic source fork as Revised.
    // Review ownership is a second parser fact; together they keep the marked
    // spelling visible as prose instead of activating the marker.
    expect(tocFacts(addition, 'editing')).toHaveLength(1)
    const structure = Object.freeze({
      headingAnchors: 'github-slug-v1' as const,
      tableOfContents: Object.freeze({
        title: '',
        includeTopHeading: true
      })
    })
    const revisedHtml = consumeTrustedHtml(materializeCleanHtml(addition, {
      view: 'revised',
      sink: 'styled',
      structure
    }), 'styled')
    const markupHtml = consumeTrustedHtml(materializeReviewHtml(addition, {
      view: 'markup',
      sink: 'styled',
      structure
    }), 'styled')
    expect(revisedHtml).toContain('class="toc-container"')
    expect(markupHtml).not.toContain('class="toc-container"')
    expect(markupHtml).toContain('<ins>[TOC]</ins>')

    const deletion = complete('{--[TOC]--}\n')
    expect(tocFacts(deletion, 'original')).toHaveLength(1)
    expect(tocFacts(deletion, 'revised')).toEqual([])
    expect(tocFacts(deletion, 'editing')).toHaveLength(1)

    const substitution = complete('{~~plain~>[TOC]~~}\n')
    expect(tocFacts(substitution, 'original')).toEqual([])
    expect(tocFacts(substitution, 'revised')).toHaveLength(1)
    expect(tocFacts(substitution, 'editing')).toEqual([])
  })
})
