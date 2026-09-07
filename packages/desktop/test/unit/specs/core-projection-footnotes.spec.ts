import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it } from 'vitest'
import { renderMarkdownProjectionToSafeHtml } from '@/documentConsumers/markdownProjectionHtml'

const fragment = (html: string): HTMLDivElement => {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

describe('Core footnote presentation', () => {
  it('numbers semantic references in reading order and shares native definition/backlink presentation', () => {
    const core = createDocumentCore()
    const revision = core.open(
      'First[^second], next[^first], again[^second]. Literal `[^first]` and \\[^first].\n\n' +
        '[^first]: **First body**.\n\n[^second]: Second body.\n',
      { footnotes: true }
    )
    const host = fragment(renderMarkdownProjectionToSafeHtml(core.project(revision, 'revised')))
    expect(
      [...host.querySelectorAll('.footnote-ref a')].map((node) => ({
        text: node.textContent,
        href: node.getAttribute('href')
      }))
    ).toEqual([
      { text: '1', href: '#fn-1' },
      { text: '2', href: '#fn-2' },
      { text: '1', href: '#fn-1' }
    ])
    expect(host.querySelector('#fn-1 p')?.textContent).toBe('Second body. ↩')
    expect(host.querySelector('#fn-2 strong')?.textContent).toBe('First body')
    expect(host.querySelector('#fn-2 .footnote-backref')?.getAttribute('href')).toBe('#fnref-2')
    expect(host.querySelector('code')?.textContent).toBe('[^first]')
    expect(host.querySelector('p')?.textContent).toContain('and [^first].')
    expect(host.querySelector('.footnote-definition')).toBeNull()
  })

  it('keeps main and isolated Comment definitions separate and leaves orphan references literal', () => {
    const core = createDocumentCore()
    const revision = core.open(
      'Main[^x] and orphan[^missing].\n\n' +
        '{>>Comment[^x] and orphan[^mainOnly].\n\n[^x]: Comment body.\n<<}\n\n' +
        '[^x]: Main body.\n\n[^mainOnly]: Outside the comment.\n',
      { footnotes: true }
    )
    const main = fragment(renderMarkdownProjectionToSafeHtml(core.project(revision, 'revised')))
    const comment = fragment(
      renderMarkdownProjectionToSafeHtml(core.projectComment(revision, revision.annotations[0]))
    )
    expect(main.querySelector('#fn-1 p')?.textContent).toBe('Main body. ↩')
    expect(comment.querySelector('#fn-1 p')?.textContent).toBe('Comment body. ↩')
    expect(comment.querySelectorAll('.footnote-ref')).toHaveLength(1)
    expect(comment.textContent).toContain('[^mainOnly]')
    expect(comment.textContent).not.toContain('Outside the comment')
    expect(main.textContent).toContain('[^missing]')
    expect(main.textContent).not.toContain('Comment body')
  })

  it('keeps concurrently mounted comment links and backlinks inside their own presentation scope', () => {
    const core = createDocumentCore()
    const revision = core.open('Text[^x].\n\n[^x]: Body.\n', { footnotes: true })
    const projection = core.project(revision, 'revised')
    const host = fragment(
      ['comment-1-', 'comment-2-']
        .map((footnotePrefix) => renderMarkdownProjectionToSafeHtml(projection, { footnotePrefix }))
        .join('')
    )
    expect(
      [...host.querySelectorAll('.footnote-ref a')].map((node) => node.getAttribute('href'))
    ).toEqual(['#comment-1-fn-1', '#comment-2-fn-1'])
    expect(
      [...host.querySelectorAll('.footnote-backref')].map((node) => node.getAttribute('href'))
    ).toEqual(['#comment-1-fnref-1', '#comment-2-fnref-1'])
    expect(host.querySelectorAll('#comment-1-fn-1')).toHaveLength(1)
    expect(host.querySelectorAll('#comment-2-fn-1')).toHaveLength(1)
  })

  it('does not bind a projected reference to a definition from a different Comment Addition arm', () => {
    const core = createDocumentCore()
    const revision = core.open('{>>{++note[^r]++}\n\n{++[^r]: body\n++}<<}', { footnotes: true })
    const host = fragment(
      renderMarkdownProjectionToSafeHtml(core.projectComment(revision, revision.annotations[0]))
    )
    expect(host.querySelector('.footnote-ref')).toBeNull()
    expect(host.querySelector('.footnotes')).toBeNull()
    expect(host.textContent).toContain('note[^r]')
  })
})
