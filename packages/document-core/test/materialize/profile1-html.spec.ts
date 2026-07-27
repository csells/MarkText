import { describe, expect, it } from 'vitest'
import {
  createLanguageEngine,
  createSourceSnapshot,
  renderMarkdownHtml,
  type ParseConfiguration
} from '@marktext/document-core'

const PROFILE1_CONFIGURATION: ParseConfiguration = {
  criticMarkupProfile: 'marktext-profile-1',
  markdownProfile: 'markdown-profile-1',
  markdownOptions: {
    schema: 'markdown-options-1',
    gfm: true,
    frontMatter: true,
    math: true,
    gitLabMath: true,
    footnotes: true,
    subscriptAndSuperscript: true
  },
  liveHtmlSafetyProfile: 'live-html-sanitized-v1',
  executionBudget: {
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

function html(source: string): string {
  const revision = createLanguageEngine().open(
    createSourceSnapshot(source),
    PROFILE1_CONFIGURATION
  )
  if (revision.kind !== 'complete') {
    throw new Error('Expected a complete Profile 1 revision')
  }
  return renderMarkdownHtml(revision.projection('revised').markdown, {
    rawHtml: 'escape',
    unsafeUrls: 'drop'
  })
}

describe('Profile 1 HTML materialization', () => {
  it('renders subscript and superscript as semantic inline elements', () => {
    expect(html('H~2~O and 2^n^\n'))
      .toBe('<p>H<sub>2</sub>O and 2<sup>n</sup></p>\n')
  })

  it('renders inline and block math from parser-owned content', () => {
    expect(html('before $x+y$ after\n\n$$\na < b\n$$\n')).toBe(
      '<p>before <span class="math-inline">x+y</span> after</p>\n' +
      '<pre class="math-block"><code>a &lt; b\n</code></pre>\n'
    )
  })

  it('renders diagrams as an inert language-addressed code representation', () => {
    expect(html('```mermaid\ngraph TD\n```\n')).toBe(
      '<pre class="diagram" data-language="mermaid">' +
      '<code>graph TD\n</code></pre>\n'
    )
  })

  it('renders numbered footnotes and back references from the AST', () => {
    expect(html('note[^n]\n\n[^n]: body\n')).toBe(
      '<p>note<sup class="footnote-ref">' +
      '<a href="#fn-n" id="fnref-n">1</a></sup></p>\n' +
      '<section class="footnotes">\n<ol>\n' +
      '<li id="fn-n">\n<p>body ' +
      '<a href="#fnref-n" class="footnote-backref" ' +
      'aria-label="Back to reference 1">↩</a></p>\n' +
      '</li>\n</ol>\n</section>\n'
    )
  })

  it('preserves an unresolved footnote reference as literal visible text', () => {
    expect(html('note[^missing]\n'))
      .toBe('<p>note[^missing]</p>\n')
  })

  it('escapes hostile literal content inside math and diagram representations', () => {
    expect(html('$<img src=x onerror=alert(1)>$\n\n```mermaid\n<script>x</script>\n```\n'))
      .toBe(
        '<p><span class="math-inline">' +
        '&lt;img src=x onerror=alert(1)&gt;</span></p>\n' +
        '<pre class="diagram" data-language="mermaid">' +
        '<code>&lt;script&gt;x&lt;/script&gt;\n</code></pre>\n'
      )
  })
})
