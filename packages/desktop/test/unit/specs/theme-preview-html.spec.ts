import { describe, expect, it } from 'vitest'
import markdownToHtml from '../../../src/renderer/src/util/markdownToHtml'
import themeMd from '../../../src/renderer/src/prefComponents/theme/theme.md?raw'

// The theme previews render their sample through the document core, as
// exports render documents, not through a second Markdown parser (B9).
describe('theme preview sample', () => {
  it('renders the sample heading, emphasis and link as the document core reads them', async() => {
    const html = await markdownToHtml(themeMd.replace(/{theme}/, 'graphite'))
    expect(html.startsWith('<article class="markdown-body">')).toBe(true)
    expect(html).toMatch(/<h3[^>]*>graphite<\/h3>/)
    expect(html).toContain('<strong>Lorem Ipsum</strong>')
    expect(html).toMatch(/<a [^>]*href="http:\/\/marktext\.app"[^>]*>dummy<\/a>/)
  })
})
