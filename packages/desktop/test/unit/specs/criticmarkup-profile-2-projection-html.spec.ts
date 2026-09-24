import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { renderMarkdownProjectionToSafeHtml } from '@/documentConsumers/markdownProjectionHtml'

const fragment = (html: string): HTMLDivElement => {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

// CriticMarkup Profile 2 (specs/language/marktext-criticmarkup-profile-2.md)
// reaches HTML consumers only through the parser-owned reader projections.
describe('CriticMarkup Profile 2 reader HTML', () => {
  it('renders an Addition-defined reference as the untracked link in Revised only', () => {
    const core = createDocumentCore()
    const revision = core.open('{++[a]: /u\n++}\n\nSee [a].\n')
    const revised = fragment(renderMarkdownProjectionToSafeHtml(core.project(revision, 'revised')))
    const untracked = fragment(
      renderMarkdownProjectionToSafeHtml(
        core.project(core.open('[a]: /u\n\nSee [a].\n'), 'revised')
      )
    )
    expect(revised.querySelector('a')?.getAttribute('href')).toBe('/u')
    expect(revised.innerHTML).toBe(untracked.innerHTML)

    const original = fragment(
      renderMarkdownProjectionToSafeHtml(core.project(revision, 'original'))
    )
    expect(original.querySelector('a')).toBeNull()
    expect(original.textContent).toContain('See [a].')
  })

  it('renders each Substitution arm definition in its own reader view', () => {
    const core = createDocumentCore()
    const revision = core.open('{~~[a]: /old\n~>[a]: /new\n~~}\n\n[a]\n')
    const href = (view: 'original' | 'revised'): string | null | undefined =>
      fragment(renderMarkdownProjectionToSafeHtml(core.project(revision, view)))
        .querySelector('a')
        ?.getAttribute('href')
    expect(href('original')).toBe('/old')
    expect(href('revised')).toBe('/new')
  })

  it('renders an arm-opened fence that a line-start closer ends', () => {
    const core = createDocumentCore()
    const revision = core.open('{++```js\nlet x = 1\n++}\nafter\n')
    const revised = fragment(renderMarkdownProjectionToSafeHtml(core.project(revision, 'revised')))
    expect(revised.querySelector('pre code')?.textContent).toBe('let x = 1\n')
    expect(revised.querySelector('p')?.textContent).toBe('after')
    expect(revised.innerHTML).toBe(
      fragment(
        renderMarkdownProjectionToSafeHtml(
          core.project(core.open('```js\nlet x = 1\n```\nafter\n'), 'revised')
        )
      ).innerHTML
    )
  })

  it('keeps a line-start closer inside a fence opened outside any arm', () => {
    const core = createDocumentCore()
    const revision = core.open('```\n++}\n```\n')
    const revised = fragment(renderMarkdownProjectionToSafeHtml(core.project(revision, 'revised')))
    expect(revised.querySelector('pre code')?.textContent).toBe('++}\n')
  })
})
