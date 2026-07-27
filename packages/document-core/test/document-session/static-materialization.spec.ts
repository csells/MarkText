import { describe, expect, it } from 'vitest'
import {
  consumeTrustedHtml,
  createDocumentSession,
  createSourceSnapshot,
  type ParseConfiguration
} from '@marktext/document-core'

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
    limitsProfile: 'test-unbounded',
    accountingSchema: 'syntax-accounting-1'
  }
}

const STATIC_STRUCTURE = Object.freeze({
  headingAnchors: 'github-slug-v1' as const,
  tableOfContents: Object.freeze({
    title: 'Contents <safe>',
    includeTopHeading: true
  })
})

describe('DocumentSession static materialization', () => {
  it('materializes the causally settled immutable revision in-process', async() => {
    const session = await createDocumentSession({
      source: createSourceSnapshot('a{++new++}b'),
      parseConfiguration: TEST_CONFIGURATION,
      trackChanges: true,
      initialSelection: {
        anchor: { offset: 1, affinity: 'next' },
        focus: { offset: 1, affinity: 'next' }
      }
    })
    const target = session.snapshot().revision.selection
    if (target === null) {
      throw new Error('Expected a Markup selection')
    }
    const ingress = session.dispatch({
      kind: 'insert-text',
      target,
      text: 'x'
    })
    const operation = session.materializeStatic({
      consumer: 'static-html',
      view: 'revised',
      structure: STATIC_STRUCTURE
    })

    await expect(ingress.completion)
      .resolves.toMatchObject({ kind: 'committed' })
    const result = await operation.completion
    expect(result).toMatchObject({
      kind: 'materialized',
      revision: {
        kind: 'complete',
        id: session.snapshot().revision.id
      },
      artifact: {
        kind: 'static-html',
        view: 'revised'
      }
    })
    if (result.kind !== 'materialized') {
      throw new Error('Expected a static materialization')
    }
    const html = consumeTrustedHtml(result.artifact.html, 'static')
    expect(html).toContain('axnewb')
    expect(html).not.toContain('{++')
  })

  it('renders parser-owned heading anchors and TOC without recognizing HTML-shaped text', async() => {
    const source = [
      '  [TOC]  ',
      '',
      '# Über 世界',
      '',
      '# Über 世界',
      '',
      '```html',
      '<h1>Forged heading</h1>',
      '<p>[TOC]</p>',
      '```',
      '',
      '<h2>Also forged</h2>',
      '',
      '## Safe <img src=x onerror=alert(1)>'
    ].join('\n')
    const session = await createDocumentSession({
      source: createSourceSnapshot(source),
      parseConfiguration: TEST_CONFIGURATION,
      trackChanges: false,
      initialSelection: {
        anchor: { offset: 0, affinity: 'next' },
        focus: { offset: 0, affinity: 'next' }
      }
    })

    const result = await session.materializeStatic({
      consumer: 'styled-html',
      view: 'markup',
      structure: STATIC_STRUCTURE
    }).completion
    if (result.kind !== 'materialized') {
      throw new Error('Expected a static materialization')
    }
    const html = consumeTrustedHtml(result.artifact.html, 'styled')

    expect(html).toContain('<h1 id="über-世界">Über 世界</h1>')
    expect(html).toContain('<h1 id="über-世界-1">Über 世界</h1>')
    expect(html).toContain(
      '<p class="toc-title">Contents &lt;safe&gt;</p>'
    )
    expect(html).toContain('href="#über-世界"')
    expect(html).toContain('href="#über-世界-1"')
    expect(html).toContain('href="#safe-img-srcx-onerroralert1"')
    expect(html.match(/class="toc-container"/g)).toHaveLength(1)
    expect(html).not.toContain('href="#forged-heading"')
    expect(html).not.toContain('href="#also-forged"')
    expect(html).not.toContain('<img src=x onerror=')
  })

  it('uses each parser projection for heading anchors and configurable TOC entries', async() => {
    const session = await createDocumentSession({
      source: createSourceSnapshot([
        '[TOC]',
        '',
        '# Top',
        '',
        '## {~~Old~>New~~}',
        ''
      ].join('\n')),
      parseConfiguration: TEST_CONFIGURATION,
      trackChanges: false,
      initialSelection: {
        anchor: { offset: 0, affinity: 'next' },
        focus: { offset: 0, affinity: 'next' }
      }
    })
    const structure = Object.freeze({
      headingAnchors: 'github-slug-v1' as const,
      tableOfContents: Object.freeze({
        title: '',
        includeTopHeading: false
      })
    })

    for (const [view, slug] of [
      ['markup', 'oldnew'],
      ['original', 'old'],
      ['revised', 'new']
    ] as const) {
      const result = await session.materializeStatic({
        consumer: 'styled-html',
        view,
        structure
      }).completion
      if (result.kind !== 'materialized') {
        throw new Error('Expected a static materialization')
      }
      const html = consumeTrustedHtml(result.artifact.html, 'styled')
      expect(html).toContain('<h1 id="top">Top</h1>')
      expect(html).toContain(`<h2 id="${slug}">`)
      expect(html).toContain(`href="#${slug}"`)
      expect(html).not.toContain('href="#top"')
      expect(html).toContain(
        '<p class="toc-title">Table of Contents</p>'
      )
    }
  })

  it('rejects semantic materialization visibly in SourceOnly state', async() => {
    const source = `${'> '.repeat(129)}text\r\n`
    const session = await createDocumentSession({
      source: createSourceSnapshot(source),
      parseConfiguration: {
        ...TEST_CONFIGURATION,
        executionBudget: {
          limitsProfile: 'desktop-v1',
          accountingSchema: 'syntax-accounting-1'
        }
      }
    })
    await expect(session.materializeStatic({
      consumer: 'print',
      view: 'markup',
      structure: STATIC_STRUCTURE
    }).completion).resolves.toMatchObject({
      kind: 'unavailable',
      reason: 'source-only-revision',
      revision: {
        kind: 'source-only',
        fatalDiagnostic: {
          code: 'CM_RESOURCE_MARKDOWN_DEPTH_EXCEEDED'
        }
      }
    })
  })
})
