import { expect, it } from 'vitest'
import { createDocumentCore } from '@marktext/document-core'
import { renderMarkdownProjectionToSafeHtml } from '@/documentConsumers/markdownProjectionHtml'

it.each([
  { source: '', html: '' },
  { source: '---\n\n\n\noutside\n', html: '<hr>\n<p>outside</p>\n' },
  {
    source: '> ---\n>\n> \n>\n> outside\n',
    html: '<blockquote>\n<hr>\n<p>outside</p>\n</blockquote>\n'
  }
])('does not publish editable blank paragraphs as HTML content: $source', ({ source, html }) => {
  const core = createDocumentCore()
  const revision = core.open(source)
  for (const mode of ['original', 'revised'] as const) {
    expect(renderMarkdownProjectionToSafeHtml(core.project(revision, mode))).toBe(html)
  }
  // These fixtures have no CM, so both ASTs use the identical source domain.
  // Exercise the renderer's empty-node contract independently of export routing.
  const projection = core.project(revision, 'revised')
  expect(
    renderMarkdownProjectionToSafeHtml({
      ...projection,
      ast: core.project(revision, 'markup').syntax.ast
    })
  ).toBe(html)
})
