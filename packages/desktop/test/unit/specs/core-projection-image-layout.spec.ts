import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'

import { renderProjectedDocumentHtml } from '@/documentConsumers/documentProjectionConsumers'
import {
  presentMarkdownProjectionHtml,
  renderMarkdownProjectionToSafeHtml
} from '@/documentConsumers/markdownProjectionHtml'

const fragment = (html: string): HTMLDivElement => {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

describe('parser-owned image layout in readers and exports', () => {
  it.each(['original', 'revised'] as const)(
    'preserves dimensions and the %s label through the existing media pipeline',
    async(mode) => {
      const core = createDocumentCore()
      const source =
        '![A {++sunny ++}{++sandy ++}beach{>>keep this note<<}](https://example.test/beach.png "Caption"){width=320 height=200 data-align=center}\n'
      const revision = core.open(source)
      const projection = core.project(revision, mode)
      const html = renderMarkdownProjectionToSafeHtml(projection, { htmlEnabled: false })
      expect(renderProjectedDocumentHtml(projection)).toBe(html)
      for (const rendered of [html, await presentMarkdownProjectionHtml(html)]) {
        const host = fragment(rendered)
        const image = host.querySelector('img')
        expect(image?.getAttribute('src')).toBe('https://example.test/beach.png')
        expect(image?.getAttribute('alt')).toBe(
          mode === 'original' ? 'A beach' : 'A sunny sandy beach'
        )
        expect(image?.getAttribute('title')).toBe('Caption')
        expect(image?.getAttribute('width')).toBe('320')
        expect(image?.getAttribute('height')).toBe('200')
        expect(image?.getAttribute('data-align')).toBe('center')
        expect(host.textContent).toBe('\n')
      }
      expect(revision.source).toBe(source)
      expect(revision.annotations.map((annotation) => annotation.kind)).toEqual([
        'addition',
        'addition',
        'comment'
      ])
    }
  )

  it('uses each reference image’s own dimensions without changing its shared destination', () => {
    const core = createDocumentCore()
    const source =
      '![same][photo]{width=50%} ![same][photo]{width=120 height=80}\n\n[photo]: https://example.test/photo.png\n'
    const revision = core.open(source)
    const host = fragment(renderProjectedDocumentHtml(core.project(revision, 'revised')))
    expect(
      [...host.querySelectorAll('img')].map((image) => ({
        source: image.getAttribute('src'),
        width: image.getAttribute('width'),
        height: image.getAttribute('height')
      }))
    ).toEqual([
      { source: 'https://example.test/photo.png', width: '50%', height: null },
      { source: 'https://example.test/photo.png', width: '120', height: '80' }
    ])
    expect(host.textContent).toBe(' \n')
    expect(revision.source).toBe(source)
  })

  it.each(['original', 'revised'] as const)(
    'renders the %s dimension of a tracked resize without combining its numeric arms',
    (mode) => {
      const core = createDocumentCore()
      const source =
        '![A {++sunny ++}beach](https://example.test/beach.png){width={~~120~>320~~}}\n'
      const revision = core.open(source)
      const host = fragment(renderProjectedDocumentHtml(core.project(revision, mode)))
      expect(host.querySelector('img')?.getAttribute('width')).toBe(
        mode === 'original' ? '120' : '320'
      )
      expect(host.querySelector('img')?.getAttribute('alt')).toBe(
        mode === 'original' ? 'A beach' : 'A sunny beach'
      )
      expect(host.textContent).toBe('\n')
      expect(revision.source).toBe(source)
    }
  )

  it('renders sized images inside isolated Comment subdocuments from their own syntax', () => {
    const core = createDocumentCore()
    const source =
      '{>>![A {~~cloudy~>sunny~~} beach][photo]{width=320}\n\n[photo]: https://example.test/comment.png\n<<}'
    const revision = core.open(source)
    const projection = core.projectComment(revision, revision.annotations[0])
    const host = fragment(renderMarkdownProjectionToSafeHtml(projection))
    expect(host.querySelector('img')?.getAttribute('alt')).toBe('A sunny beach')
    expect(host.querySelector('img')?.getAttribute('width')).toBe('320')
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://example.test/comment.png')
    expect(host.textContent).toBe('\n')
    expect(renderProjectedDocumentHtml(core.project(revision, 'revised'))).toBe('')
    expect(revision.source).toBe(source)
  })
})
