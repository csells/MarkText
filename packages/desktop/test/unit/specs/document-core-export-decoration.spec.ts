import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type {
  DocumentCoreExportOptions,
  DocumentCoreExportTheme
} from '@shared/types/documentCore'
import {
  createDocumentCoreExportDecorator,
  type DocumentCoreExportThemeSource
} from 'main_renderer/documentCore/exportDecorator'

const options = Object.freeze({
  title: 'Research <Draft>',
  page: Object.freeze({
    size: Object.freeze({
      kind: 'custom' as const,
      widthMm: 210,
      heightMm: 297
    }),
    landscape: true,
    marginsMm: Object.freeze({
      top: 20,
      right: 15,
      bottom: 18,
      left: 12
    })
  }),
  theme: Object.freeze({
    kind: 'custom' as const,
    name: 'research.css'
  }),
  typography: Object.freeze({
    fontFamily: 'Source Serif',
    fontSizePx: 14,
    lineHeight: 1.6
  }),
  autoNumberHeadings: true,
  showFrontMatter: true,
  toc: Object.freeze({
    title: 'Contents & Notes',
    includeTopHeading: false
  }),
  header: Object.freeze({
    layout: 'three-columns' as const,
    left: '<script>left</script>',
    center: 'Center',
    right: 'Right'
  }),
  footer: Object.freeze({
    layout: 'single' as const,
    left: '',
    center: 'Page',
    right: ''
  }),
  headerFooterAppearance: Object.freeze({
    drawRules: true,
    fontSizePx: 10
  })
}) satisfies DocumentCoreExportOptions

const input = [
  '<!doctype html>',
  '<html><head><meta charset="utf-8">',
  '<style data-marktext-export>body{margin:2rem}</style>',
  '</head><body>',
  '<pre class="front-matter"><code>---\\ntitle: Draft\\n---</code></pre>',
  '<h1 id="top">Top</h1>',
  '<nav class="toc-container" aria-label="Table of Contents">',
  '<p class="toc-title">Contents &amp; Notes</p>',
  '<ol class="toc-list">',
  '<li class="toc-level-2"><a href="#install-use">',
  'Install &amp; Use</a></li>',
  '<li class="toc-level-2"><a href="#install-use-1">',
  'Install &amp; Use</a></li>',
  '</ol></nav>',
  '<h2 id="install-use">Install &amp; Use</h2>',
  '<h2 id="install-use-1">Install &amp; Use</h2>',
  '</body></html>'
].join('')

const themeSource = (
  css = '.custom-theme{color:rebeccapurple}'
): DocumentCoreExportThemeSource => ({
  cssFor: vi.fn(async(_theme: DocumentCoreExportTheme) => css)
})

describe('main-owned export decoration', () => {
  it('makes every semantic option visible in authenticated PDF/print HTML', async() => {
    const themes = themeSource()
    const decorator = createDocumentCoreExportDecorator(themes)

    const result = await decorator.decorate(input, 'pdf', options)

    expect(result.pdfPageOptions).toEqual({
      landscape: true,
      pageSize: {
        width: 210_000,
        height: 297_000
      }
    })
    expect(result.html).toContain('<title>Research &lt;Draft&gt;</title>')
    expect(result.html).toContain(
      'margin:20mm 15mm 18mm 12mm;'
    )
    expect(result.html).toContain('size:210mm 297mm landscape;')
    expect(result.html).toContain('.custom-theme{color:rebeccapurple}')
    expect(result.html).toContain('font-family:"Source Serif"')
    expect(result.html).toContain('font-size:14px')
    expect(result.html).toContain('line-height:1.6')
    expect(result.html.indexOf('font-size:14px')).toBeGreaterThan(
      result.html.indexOf('.custom-theme')
    )
    expect(result.html).toContain('counter-reset')
    expect(result.html).not.toContain(
      'pre.front-matter{display:none'
    )
    expect(result.html).toContain(
      '<p class="toc-title">Contents &amp; Notes</p>'
    )
    expect(result.html).not.toContain('href="#top"')
    expect(result.html).toContain('href="#install-use"')
    expect(result.html).toContain('href="#install-use-1"')
    expect(result.html).toContain('<h1 id="top">')
    expect(result.html).toContain('<h2 id="install-use-1">')
    expect(result.html).toContain(
      '&lt;script&gt;left&lt;/script&gt;'
    )
    expect(result.html).not.toContain('<script>left</script>')
    expect(result.html).toContain('page-header three-columns rules')
    expect(result.html).toContain('page-footer single rules')
    expect(result.html).toContain('font-size:10px')
    expect(themes.cssFor).toHaveBeenCalledWith(options.theme)
  })

  it('applies the same semantic styling to styled HTML without print geometry', async() => {
    const decorator = createDocumentCoreExportDecorator(themeSource())

    const result = await decorator.decorate(input, 'styled-html', {
      ...options,
      autoNumberHeadings: false,
      showFrontMatter: false,
      header: null,
      footer: null,
      headerFooterAppearance: null
    })

    expect(result.pdfPageOptions).toBeUndefined()
    expect(result.html).not.toContain('@page{')
    expect(result.html).not.toContain('counter-reset')
    expect(result.html).toContain(
      'pre.front-matter{display:none!important;}'
    )
    expect(result.html).not.toContain('<header class="page-header')
    expect(result.html).not.toContain('<footer class="page-footer')
    expect(result.html).toContain('.custom-theme')
  })

  it('rejects theme CSS that could terminate the owned style element', async() => {
    const decorator = createDocumentCoreExportDecorator(
      themeSource('</style><script>globalThis.pwned=true</script>')
    )

    await expect(
      decorator.decorate(input, 'print', options)
    ).rejects.toThrow(/theme|css|style/i)
  })

  it('contains no main-side heading or TOC structural recognizer', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'src/main/documentCore/exportDecorator.ts'
      ),
      'utf8'
    )

    expect(source).not.toMatch(
      /HEADING_REGEXP|TOC_MARKER_REGEXP|decodeHeadingText/
    )
    expect(source).not.toMatch(/\/<h|\/<p|\/<body|\/<\\\/head/)
  })
})
