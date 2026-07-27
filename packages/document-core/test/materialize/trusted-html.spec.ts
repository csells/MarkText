import { describe, expect, it } from 'vitest'
import {
  consumeTrustedHtml,
  materializeCleanHtml,
  materializeReviewHtml
} from '../../src/materialize/trustedHtml.js'
import {
  createLanguageEngine,
  createSourceSnapshot,
  type CompleteDocumentRevision,
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

const STATIC_STRUCTURE = Object.freeze({
  headingAnchors: 'github-slug-v1' as const,
  tableOfContents: Object.freeze({
    title: '',
    includeTopHeading: true
  })
})

function complete(source: string): CompleteDocumentRevision {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete revision')
  }
  return revision
}

describe('sink-branded clean HTML', () => {
  it('keeps hostile source inert while retaining generated Markdown structure', () => {
    const revision = complete([
      '# Heading',
      '',
      '<script>globalThis.pwned = true</script>',
      '',
      '[unsafe](javascript:alert(1)) and [safe](https://example.com/a?q=1)',
      '',
      '{++new++} {--old--} {>>private <img src=x onerror=alert(1)><<}'
    ].join('\n'))

    const html = materializeCleanHtml(revision, {
      view: 'revised',
      sink: 'static',
      structure: STATIC_STRUCTURE
    })
    const text = consumeTrustedHtml(html, 'static')

    expect(text).toContain('<h1 id="heading">Heading</h1>')
    expect(text).toContain('&lt;script&gt;globalThis.pwned = true&lt;/script&gt;')
    expect(text).not.toContain('<script>')
    expect(text).not.toContain('javascript:')
    expect(text).toContain('href="https://example.com/a?q=1"')
    expect(text).toContain('new')
    expect(text).not.toContain('old')
    expect(text).not.toContain('private')
    expect(text).not.toContain('onerror=')
  })

  it('retains escaped front matter for static settings without leaking it to clipboard HTML', () => {
    const revision = complete([
      '---',
      'title: <unsafe>',
      '---',
      '# Heading'
    ].join('\n'))
    const cleanExport = materializeCleanHtml(revision, {
      view: 'revised',
      sink: 'pdf',
      structure: STATIC_STRUCTURE
    })
    const reviewExport = materializeReviewHtml(revision, {
      view: 'markup',
      sink: 'print',
      structure: STATIC_STRUCTURE
    })
    const clipboard = materializeCleanHtml(revision, {
      view: 'revised',
      sink: 'clipboard'
    })

    expect(consumeTrustedHtml(cleanExport, 'pdf')).toContain(
      '<pre class="front-matter"><code>---\ntitle: &lt;unsafe&gt;\n---\n</code></pre>'
    )
    expect(consumeTrustedHtml(reviewExport, 'print')).toContain(
      '<pre class="front-matter"><code>---\ntitle: &lt;unsafe&gt;\n---\n</code></pre>'
    )
    expect(consumeTrustedHtml(clipboard, 'clipboard')).not.toContain(
      'front-matter'
    )
  })

  it('rejects a forged capability and a real capability at the wrong sink', () => {
    const html = materializeCleanHtml(complete('safe'), {
      view: 'original',
      sink: 'pdf',
      structure: STATIC_STRUCTURE
    })

    expect(() => consumeTrustedHtml(html, 'print')).toThrow(/sink/i)
    expect(() => consumeTrustedHtml(
      Object.freeze({ sink: 'pdf' }) as typeof html,
      'pdf'
    )).toThrow(/capability/i)
  })

  it('rejects an unknown sink before minting an HTML capability', () => {
    expect(() => materializeCleanHtml(complete('safe'), {
      view: 'original',
      sink: 'forged'
    } as never)).toThrow(/sink/i)
    expect(() => materializeReviewHtml(complete('{++safe++}'), {
      view: 'markup',
      sink: 'forged'
    } as never)).toThrow(/sink/i)
  })

  it('rejects SourceOnly revisions instead of returning partial semantic output', () => {
    const revision = createLanguageEngine().open(
      createSourceSnapshot(`${'> '.repeat(129)}text\n`),
      CONFIGURATION
    )
    expect(revision.kind).toBe('source-only')
    expect(() => materializeCleanHtml(revision, {
      view: 'original',
      sink: 'print'
    })).toThrow(/SourceOnly/i)
  })
})
