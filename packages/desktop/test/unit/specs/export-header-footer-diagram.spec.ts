import { describe, expect, it, vi } from 'vitest'

// #3359 — exporting with Header & Footer enabled dropped diagram (mermaid)
// content. The header/footer branch re-sanitized the WHOLE already-rendered
// article with the export DOMPurify config, which strips the <foreignObject>
// that mermaid renders its node labels into; the no-header/footer branch never
// re-sanitized, so the same document exported fine without header/footer.

const FULL_DOC =
  '<html><head></head><body>' +
  '<article class="markdown-body">' +
  '<figure class="mu-diagram-block"><svg class="mermaid"><g class="node">' +
  '<foreignObject width="80" height="20"><div xmlns="http://www.w3.org/1999/xhtml">' +
  '<span class="nodeLabel"><p>DiagramLabel</p></span></div></foreignObject>' +
  '</g></svg></figure>' +
  '</article></body></html>'

const UNSAFE_SOURCE = 'unsafe post-render diagram'
const UNSAFE_FULL_DOC =
  '<html><head></head><body>' +
  '<article class="markdown-body">' +
  '<figure class="mu-diagram-block"><svg class="mermaid"><g class="node">' +
  '<foreignObject width="80" height="20"><div xmlns="http://www.w3.org/1999/xhtml">' +
  '<span class="nodeLabel"><p>DiagramLabel</p></span>' +
  '<script>globalThis.__desktopPostRenderScript = true</script>' +
  '<img src="javascript:globalThis.__desktopPostRenderUrl = true" ' +
  'onerror="globalThis.__desktopPostRenderEvent = true">' +
  '<a href="javascript:globalThis.__desktopPostRenderLink = true">Unsafe link</a>' +
  '</div></foreignObject>' +
  '</g></svg></figure>' +
  '</article></body></html>'

vi.mock('@muyajs/core', async(importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.mock factories cannot hoist a top-level type import
  const actual = await importOriginal<typeof import('@muyajs/core')>()
  return {
    ...actual,
    MarkdownToHtml: class {
      constructor(private readonly markdown: string) {}

      async generate(): Promise<string> {
        return this.markdown === UNSAFE_SOURCE ? UNSAFE_FULL_DOC : FULL_DOC
      }
    }
  }
})

vi.mock('@/util/resolveImageSrc', () => ({ resolveLocalImageSrc: (s: string) => s }))
vi.mock('@/util/resolveLinkHref', () => ({ resolveLocalLinkHref: (s: string) => s }))

const { exportStyledHTML } = await import('@/util/exportHtml')

const fakeMuya = {} as never

describe('export with Header & Footer preserves diagram content (#3359)', () => {
  it('keeps the mermaid foreignObject label when a header is present', async() => {
    const html = await exportStyledHTML(fakeMuya, '```mermaid\ngraph LR\n```', {
      header: { type: 0, left: '', center: 'My Title', right: '' }
    })
    expect(html).toContain('DiagramLabel')
    expect(html).toContain('My Title')
  })

  it('still strips unsafe markup from the user-supplied header text', async() => {
    const html = await exportStyledHTML(fakeMuya, 'x', {
      header: { type: 0, left: '', center: '<script>alert(1)</script>Safe', right: '' }
    })
    expect(html).toContain('Safe')
    expect(html).not.toContain('<script>')
  })

  it('sanitizes post-render diagram output after desktop export augmentation', async() => {
    const html = await exportStyledHTML(fakeMuya, UNSAFE_SOURCE, {
      header: { type: 0, left: 'Left', center: 'My Title', right: 'Right' },
      footer: { type: 0, left: 'Left footer', center: 'Page', right: 'Right footer' }
    })
    const root = document.createElement('div')
    root.innerHTML = html

    expect(root.textContent).toContain('DiagramLabel')
    expect(root.textContent).toContain('My Title')
    expect(root.textContent).toContain('Page')
    expect(root.querySelector('script')).toBeNull()
    expect(root.querySelector('[onerror], [onload]')).toBeNull()
    expect(root.querySelector('img')?.getAttribute('src') ?? null).toBeNull()
    expect(root.querySelector('a')?.getAttribute('href') ?? null).toBeNull()
  })
})
