import { describe, it, expect, vi } from 'vitest'
import { createDocumentCore } from '@marktext/document-core'

// `@/util/pdf` (imported transitively for `getHtmlToc`) and the export wrapper
// reach `window.path` / `window.fileUtils` / `window.marktext` via the preload
// bridge. Stub the surfaces the modules touch before the hoisted imports run.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: {
        sep: string
        join?: (...parts: string[]) => string
        resolve?: (...parts: string[]) => string
      }
      fileUtils?: unknown
      marktext?: unknown
      DIRNAME?: string
    }
  }
  w.window ??= {}
  w.window.path ??= {
    sep: '/',
    join: (...parts: string[]) =>
      parts
        .join('/')
        .replace(/\/\.\//g, '/')
        .replace(/\/{3,}/g, '//'),
    // Some transitive helpers still expect a minimal POSIX-ish `resolve`.
    resolve: (...parts: string[]) =>
      parts
        .join('/')
        .replace(/\/\.\//g, '/')
        .replace(/\/{2,}/g, '/')
  }
  // The document directory the export wrapper resolves relative <img> src
  // against (see resolveLocalImageSrc / window.DIRNAME).
  w.window.DIRNAME = '/docs'
})

import { exportStyledHTMLFromProjection } from '@/util/exportHtml'
import { getHtmlToc, type TocEntry } from '@/util/pdf'

// `exportStyledHTMLFromProjection(muya, projection, options)` renders Core's
// Revised projection through the real `@muyajs/core` `MarkdownToHtml` shell
// (which runs in jsdom). The engine treats the Muya instance as optional — the
// export path only reads a few `muya.options.*` flags with `??` defaults — so
// the desktop wrapper works with a bare `null` here.
const NO_MUYA = null as unknown as Parameters<typeof exportStyledHTMLFromProjection>[0]

const revisedProjectionOf = (source: string) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  return core.project(revision, 'revised')
}

describe('exportStyledHTMLFromProjection — Core consumer authority', () => {
  it('renders math with KaTeX', async() => {
    const projected = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('Math: $x^2$.\n'))
    const projectedDocument = new DOMParser().parseFromString(projected, 'text/html')
    expect(projectedDocument.querySelector('.katex .msupsub')?.textContent).toContain('2')
  })

  it('builds the shipped HTML shell from Revised AST output without canonical markers', async() => {
    const out = await exportStyledHTMLFromProjection(
      NO_MUYA,
      revisedProjectionOf(
        '# Review\n\nKeep {~~legacy~>current~~}, {++fresh++}, {--gone--}. {>>note<<}\n'
      ),
      {}
    )

    expect(out).toMatch(/<h1[^>]*\sid="review"[^>]*>Review<\/h1>/)
    expect(out).toContain('<p>Keep current, fresh, .</p>')
    expect(out).not.toContain('legacy')
    expect(out).not.toContain('gone')
    expect(out).not.toContain('note')
    expect(out).not.toMatch(/\{(?:\+\+|--|~~|==|>>)/)
  })
})

describe('exportStyledHTMLFromProjection — document shell', () => {
  it('emits a self-contained document: inline <style> blocks, no CDN <link>', async() => {
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('# Hi\n\ntext'), {})

    // The engine inlines github-markdown-css / katex / prism as <style> blocks
    // by default (inlineStyles: true) instead of CDN <link rel="stylesheet">
    // tags — so a saved file renders offline / behind CSP.
    expect(out).toContain('<style>')
    expect(out).not.toMatch(/<link[^>]+rel="stylesheet"[^>]+href="https:\/\//)
    expect(out).not.toMatch(/href="https:\/\/cdnjs\.cloudflare\.com/)
  })

  it('wraps the rendered body in exactly one <article class="markdown-body"> with the rendered <h1>', async() => {
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('# Hi\n\ntext'), {})

    expect((out.match(/<article class="markdown-body">/g) || []).length).toBe(1)
    // Heading rendered, and the engine injects a github-compatible slug id.
    expect(out).toMatch(/<h1[^>]*\sid="hi"[^>]*>Hi<\/h1>/)
    expect(out).toContain('<p>text</p>')
  })

  it('cleanly replaces <body> exactly once (no duplicate <body>)', async() => {
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('# Hi\n\ntext'), {})

    expect((out.match(/<body>/g) || []).length).toBe(1)
    expect((out.match(/<\/body>/g) || []).length).toBe(1)
    const body = /<body>([\s\S]*)<\/body>/.exec(out)![1]
    expect(body).toContain('<article class="markdown-body">')
    expect(body).not.toContain('<body>')
  })

  it('preserves `$<` in the exported body', async() => {
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('literal `$<` text'), {})

    expect((out.match(/<body>/g) || []).length).toBe(1)
    expect((out.match(/<\/body>/g) || []).length).toBe(1)
    expect((out.match(/<article class="markdown-body">/g) || []).length).toBe(1)
    expect(out).toContain('<p>literal <code>$&lt;</code> text</p>')
  })
})

describe('exportStyledHTMLFromProjection — [TOC] expansion and slug matching', () => {
  // Mirror what `muya.getTOC()` returns ({ lvl, content } per heading, content
  // being the heading's rendered plain text — inline markdown stripped (#4811)).
  // `getHtmlToc` re-slugs `content`; the engine slugs each heading's rendered
  // textContent — both via the SAME `generateGithubSlug` over the same plain
  // text, so the anchors line up even for headings authored with formatting.
  const MD = [
    '# Getting Started',
    '',
    '[TOC]',
    '',
    '## Installation',
    '',
    'first',
    '',
    '## Installation',
    '',
    'second',
    '',
    '## Use **bold** and [a link](http://x)'
  ].join('\n')

  const TOC: TocEntry[] = [
    { lvl: 1, content: 'Getting Started' },
    { lvl: 2, content: 'Installation' },
    { lvl: 2, content: 'Installation' },
    // getTOC() strips the `**bold**` / `[a link](http://x)` markup to the
    // rendered text before it reaches the export TOC.
    { lvl: 2, content: 'Use bold and a link' }
  ]

  it('replaces the rendered <p>[TOC]</p> with the toc list', async() => {
    const toc = getHtmlToc(TOC, {})
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf(MD), { toc })

    expect(out).toContain('toc-container')
    expect(out).toContain('Table of Contents')
    // The literal [TOC] paragraph is gone — replaced by the toc list.
    expect(out).not.toMatch(/<p>\s*\[TOC\]\s*<\/p>/i)
  })

  it('dedups repeated headings: two "Installation" → installation / installation-1, with matching anchors', async() => {
    const toc = getHtmlToc(TOC, {})
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf(MD), { toc })

    // Engine-written heading ids in document order.
    const ids = [...out.matchAll(/<h[1-6][^>]*\sid="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toEqual([
      'getting-started',
      'installation',
      'installation-1',
      'use-bold-and-a-link'
    ])

    // The two plain-text anchors resolve to real heading ids.
    expect(out).toContain('href="#installation"')
    expect(out).toContain('href="#installation-1"')
    expect(ids).toContain('installation')
    expect(ids).toContain('installation-1')
  })

  it('a heading with inline markup produces a TOC anchor that matches the heading id (#4811)', async() => {
    const toc = getHtmlToc(TOC, {})
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf(MD), { toc })

    const hrefs = [...out.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
    const ids = [...out.matchAll(/<h[1-6][^>]*\sid="([^"]+)"/g)].map((m) => m[1])

    // getHtmlToc slugs the plain-text content "Use bold and a link" that
    // getTOC() now yields → "use-bold-and-a-link", and the engine slugs the
    // heading's rendered textContent to the same "use-bold-and-a-link". They
    // converge, so the anchor is a live link in the exported document. The old
    // raw-markdown slug "use-bold-and-a-linkhttpx" (a dead link) is gone.
    expect(hrefs).toContain('use-bold-and-a-link')
    expect(ids).toContain('use-bold-and-a-link')
    expect(hrefs).not.toContain('use-bold-and-a-linkhttpx')
  })

  // The marker is the paragraph Core reads as `[TOC]` alone: a `[TOC]` line in
  // code, or one that renders without its own paragraph, keeps its text (B9).
  it('places the toc at the marker paragraph and leaves [TOC] in code as text', async() => {
    const toc = getHtmlToc(TOC, {})
    const out = await exportStyledHTMLFromProjection(
      NO_MUYA,
      revisedProjectionOf('# Getting Started\n\n```\na\n[TOC]\nb\n```\n\n[TOC]\n'),
      { toc }
    )
    expect(out.match(/toc-container/g)).toHaveLength(1)
    expect(out).toMatch(/<code[^>]*>a\n\[TOC\]\nb\n<\/code>/)
    expect(out.indexOf('toc-container')).toBeGreaterThan(out.indexOf('</pre>'))
    // With no marker paragraph, the `[TOC]` line in code is not one.
    const codeOnly = await exportStyledHTMLFromProjection(
      NO_MUYA,
      revisedProjectionOf('# Getting Started\n\n```\na\n[TOC]\nb\n```\n'),
      { toc }
    )
    expect(codeOnly).not.toContain('toc-container')
    expect(codeOnly).toMatch(/<code[^>]*>a\n\[TOC\]\nb\n<\/code>/)
  })

  it('keeps [TOC] text where it renders without a paragraph or after the first marker', async() => {
    const toc = getHtmlToc(TOC, {})
    const tight = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('# Getting Started\n\n- [TOC]\n'), { toc })
    expect(tight).not.toContain('toc-container')
    expect(tight).toContain('<li>[TOC]</li>')
    const twice = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('[TOC]\n\n[TOC]\n'), { toc })
    expect(twice.match(/toc-container/g)).toHaveLength(1)
    expect(twice).toContain('<p>[TOC]</p>')
    expect(twice).not.toMatch(/marktexttoc/)
  })

  it('does not inject the toc when the document has no [TOC] marker', async() => {
    const toc = getHtmlToc(TOC, {})
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('# Getting Started\n\n## Installation\n'), {
      toc
    })

    expect(out).not.toContain('toc-container')
  })
})

describe('exportStyledHTMLFromProjection — header/footer assembly', () => {
  it('type:2 + headerFooterStyled:true → styled page table with all parts', async() => {
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('# Hi'), {
      header: { type: 2, left: 'L', center: 'C', right: 'R' },
      footer: { type: 2, center: 'FC' },
      headerFooterStyled: true
    })

    expect(out).toContain('page-container')
    // type !== 1 → no 'single'; headerFooterStyled === true → ' styled'.
    expect(out).toMatch(/class="page-header\s+styled"/)
    expect(out).toContain('header-content-left')
    expect(out).toContain('header-content-right')
    expect(out).toMatch(/<div class="header-content">C<\/div>/)
    // A hidden footer placeholder row inside the table, plus a fixed real footer.
    expect(out).toContain('page-footer-fake')
    expect(out).toMatch(/class="page-footer\s+styled"/)
    expect(out).toMatch(/<div class="footer-content">FC<\/div>/)
  })

  it('type:1 + headerFooterStyled:false → single + simple', async() => {
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('# Hi'), {
      header: { type: 1, center: 'C' },
      headerFooterStyled: false
    })

    expect(out).toContain('page-container')
    // type === 1 → 'single'; headerFooterStyled === false → ' simple'.
    expect(out).toMatch(/page-header[^"]*single/)
    expect(out).toMatch(/page-header[^"]*simple/)
  })

  it('no header/footer → no page-container table', async() => {
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('# Hi'), {})

    expect(out).not.toContain('page-container')
    expect(out).not.toContain('page-footer')
    // Body is just the plain article.
    const body = /<body>([\s\S]*)<\/body>/.exec(out)![1]
    expect(body.trim()).toMatch(/^<article class="markdown-body">/)
  })

  it('a footer alone still builds the page table (real footer + fake footer row)', async() => {
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('# Hi'), {
      footer: { type: 2, center: 'only-footer' }
    })

    expect(out).toContain('page-container')
    expect(out).toContain('page-footer-fake')
    // No type and no headerFooterStyled → bare `page-footer` class (sanitize
    // collapses the trailing space the template leaves behind).
    expect(out).toMatch(/class="page-footer"/)
    expect(out).toContain('only-footer')
  })
})

describe('exportStyledHTMLFromProjection — text direction (issue #4553)', () => {
  it('sets dir="rtl" on the exported <html> when dir is "rtl"', async() => {
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('# سلام\n\nمتن'), { dir: 'rtl' })

    expect(out).toMatch(/<html lang="en" dir="rtl">/)
  })

  it('forwards dir="auto" to the exported <html>', async() => {
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('# Hi'), { dir: 'auto' })

    expect(out).toMatch(/<html lang="en" dir="auto">/)
  })

  it('leaves the default LTR export without a dir attribute', async() => {
    const ltr = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('# Hi'), { dir: 'ltr' })
    const none = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('# Hi'), {})

    expect(ltr).toContain('<html lang="en">')
    expect(ltr).not.toMatch(/<html[^>]+dir=/)
    expect(none).not.toMatch(/<html[^>]+dir=/)
  })
})

describe('exportStyledHTMLFromProjection — relative image paths', () => {
  it('rewrites a relative img src to an absolute file:// URL (issue 230)', async() => {
    // window.DIRNAME is stubbed to '/docs', so `./a.png` resolves against it.
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('![alt](./a.png)'), {})

    expect(out).toMatch(/<img[^>]+src="file:\/\/\/docs\/a\.png"/)
    expect(out).not.toContain('src="./a.png"')
    expect(out).toContain('alt="alt"')
  })

  it('resolves Windows separators in Markdown image destinations (#5714)', async() => {
    const filename = '90ddb94aced7dd9421a1dc67e76a83c9f0a77378.png'
    const out = await exportStyledHTMLFromProjection(
      NO_MUYA,
      revisedProjectionOf(`![](assets\\${filename})`),
      {}
    )

    expect(out).toContain(`src="file:///docs/assets/${filename}"`)
  })

  it('leaves a remote http(s) img src untouched', async() => {
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('![alt](https://example.com/a.png)'), {})

    expect(out).toMatch(/<img[^>]+src="https:\/\/example\.com\/a\.png"/)
    expect(out).not.toContain('file://')
  })
})

describe('exportStyledHTMLFromProjection — relative link paths (#1688)', () => {
  it('rewrites a relative <a href> to an absolute file:// URL', async() => {
    // window.DIRNAME is stubbed to '/docs', so `./my_file.pdf` resolves against it.
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('[doc](./my_file.pdf)'), {})

    expect(out).toMatch(/<a[^>]+href="file:\/\/\/docs\/my_file\.pdf"/)
    expect(out).not.toContain('href="./my_file.pdf"')
  })

  it('leaves a remote http(s) link untouched', async() => {
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('[site](https://example.com/p)'), {})

    expect(out).toMatch(/<a[^>]+href="https:\/\/example\.com\/p"/)
    expect(out).not.toContain('file://')
  })

  it('leaves an in-page fragment anchor untouched', async() => {
    const out = await exportStyledHTMLFromProjection(NO_MUYA, revisedProjectionOf('# Heading\n\n[jump](#heading)'), {})

    expect(out).toContain('href="#heading"')
    expect(out).not.toContain('file://')
  })
})
