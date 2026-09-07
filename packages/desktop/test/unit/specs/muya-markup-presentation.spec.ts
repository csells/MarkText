import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it, vi } from 'vitest'
import type { IInlinePresentationContext } from '@muyajs/core'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import { renderMuyaMarkupBinding } from '@/documentAuthority/muyaMarkupPresentation'

const rendered = (source: string, currentText?: string, context?: IInlinePresentationContext): HTMLDivElement => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
  const binding = view.bindings[0]
  const host = document.createElement('div')
  host.innerHTML = renderMuyaMarkupBinding(binding, view.decorations, currentText ?? binding.text, context, view.comments)
  return host
}

describe('Muya Core Markup presentation', () => {
  it('exposes comments at their document locations without adding payload or caret characters', () => {
    const host = rendered('{>>first<<}a{>>middle<<}b{>>last<<}')
    const markers = [...host.querySelectorAll('[data-critic-kind="comment"]')]
    expect(markers).toHaveLength(3)
    expect(host.textContent).toBe('ab')
    expect(markers.map(marker => marker.previousSibling?.textContent ?? '')).toEqual(['', 'a', 'b'])
    expect(markers.map(marker => [marker.getAttribute('data-critic-start'), marker.getAttribute('data-critic-end')])).toEqual([
      // This leaf starts at the first visible character, after the first note.
      ['-11', '0'], ['1', '13'], ['14', '24']
    ])
    for (const marker of markers) {
      expect(marker.getAttribute('contenteditable')).toBe('false')
      expect(marker.getAttribute('role')).toBe('button')
      expect(marker.getAttribute('tabindex')).toBe('0')
      expect(marker.getAttribute('aria-label')).toBe('Comment')
      expect(marker.classList.contains('mu-remove')).toBe(true)
      expect(marker.textContent).toBe('')
    }
    expect(host.innerHTML).not.toMatch(/first|middle|last/u)
    expect(rendered('{>>only<<}').querySelectorAll('[data-critic-kind="comment"]')).toHaveLength(1)
    expect(rendered('{>>only<<}').textContent).toBe('')
  })

  it('retains only trusted native link coordinates through the browser sanitizer', () => {
    const host = rendered('prefix {++[name](https://example.com)++}')
    const link = host.querySelector<HTMLAnchorElement>('a.mu-link')
    expect(link?.dataset).toMatchObject({ start: '7', end: '34', raw: '[name](https://example.com)' })
    expect(rendered('[unsafe](javascript:alert(1))').querySelector('a')?.getAttribute('href')).toBeNull()
  })

  it('delegates Core image semantics to native widgets and keeps raw text offsets', () => {
    const renderImage = vi.fn(() => ({
      open: '<span class="mu-inline-image" contenteditable="false" data-raw="![**alt**][ref]"><span class="mu-hide mu-remove">',
      close: '</span><span class="mu-image-container"><img src="file:///safe.png" alt="alt"></span></span>'
    }))
    const source = '{++![**alt**][ref]++}\n\n[ref]: /safe.png "Title"'
    const host = rendered(source, undefined, { renderImage })
    expect(renderImage).toHaveBeenCalledWith({
      raw: '![**alt**][ref]', range: { start: 0, end: 15 }, src: '/safe.png', alt: 'alt', title: 'Title'
    })
    expect(host.textContent).toBe('![**alt**][ref]')
    expect(host.querySelector('[data-critic-kind="addition"] .mu-inline-image')).not.toBeNull()
    expect(host.querySelector('.mu-inline-image')?.getAttribute('contenteditable')).toBe('false')
    expect(host.querySelector('img')?.getAttribute('src')).toBe('file:///safe.png')
  })

  it('uses Core spelling ranges for entities and escapes, retaining every caret character', () => {
    const source = 'x &amp; y \\* &#x1F600; \\&copy; &unknown;'
    const host = rendered(source)
    expect(host.textContent).toBe(source)
    expect([...host.querySelectorAll('[data-character]')].map(node => [node.textContent, node.getAttribute('data-character')])).toEqual([
      ['&amp;', '&'], ['\\*', '*'], ['&#x1F600;', '😀'], ['\\&', '&']
    ])
  })

  it('presents known emoji only inside Core text leaves, never across annotation arms or inside code', () => {
    const source = ':smile: `:smile:` {~~:smi~>le:~~} :unknown:'
    const host = rendered(source)
    expect(host.textContent).toBe(':smile: `:smile:` :smile: :unknown:')
    expect([...host.querySelectorAll('[data-emoji]')].map(node => node.getAttribute('data-emoji'))).toEqual(['😄'])
  })

  it('presents angle and extended autolinks with their Core destinations', () => {
    const source = '<https://example.com> <person@example.com> https://example.org'
    const host = rendered(source)
    expect(host.textContent).toBe(source)
    expect([...host.querySelectorAll('a')].map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['https://example.com', 'https://example.com'],
      ['person@example.com', 'mailto:person@example.com'],
      ['https://example.org', 'https://example.org']
    ])
    expect([...host.querySelectorAll('.mu-hide.mu-remove')].map(node => node.textContent)).toEqual(['<', '>', '<', '>'])
  })

  it('presents both Core hard-break spellings without altering editing characters', () => {
    const source = 'one  \ntwo\\\nthree'
    const host = rendered(source)
    expect(host.textContent).toBe(source)
    expect([...host.querySelectorAll('.mu-hard-line-break-space')].map(node => node.textContent)).toEqual(['  ', '\\'])
    expect([...host.querySelectorAll('.mu-line-end')].map(node => node.textContent)).toEqual(['\n', '\n'])
  })

  it('keeps stars literal when they belong to separate substitution arms', () => {
    const host = rendered('{~~*old~>new*~~}')
    expect(host.textContent).toBe('*oldnew*')
    expect(host.querySelector('em')).toBeNull()
    expect(host.querySelector('[data-critic-kind="substitution"][data-critic-arm="old"]')?.textContent).toBe('*old')
    expect(host.querySelector('[data-critic-kind="substitution"][data-critic-arm="new"]')?.textContent).toBe('new*')
  })

  it('renders Core strong syntax with hidden markers and unchanged raw editing offsets', () => {
    const host = rendered('**bold**')
    expect(host.textContent).toBe('**bold**')
    expect(host.querySelector('strong')?.textContent).toBe('bold')
    expect([...host.querySelectorAll('.mu-hide.mu-remove')].map(node => node.textContent)).toEqual(['**', '**'])
  })

  it('renders semantic emphasis, code and links from the Core AST', () => {
    const source = '*em* `code` [hi](https://example.com)'
    const host = rendered(source)
    expect(host.textContent).toBe(source)
    expect(host.querySelector('em')?.textContent).toBe('em')
    expect(host.querySelector('code')?.textContent).toBe('code')
    expect(host.querySelector('a')?.textContent).toBe('hi')
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
  })

  it('decorates all visible CriticMarkup forms and elides comments', () => {
    const host = rendered('{++add++} {--delete--} {~~old~>new~~} {==mark==}{>>note<<}')
    expect(host.textContent).toBe('add delete oldnew mark')
    expect(host.querySelector('[data-critic-kind="addition"]')?.textContent).toBe('add')
    expect(host.querySelector('[data-critic-kind="deletion"]')?.textContent).toBe('delete')
    expect(host.querySelector('[data-critic-kind="highlight"]')?.textContent).toBe('mark')
    expect(host.querySelectorAll('[data-critic-kind="substitution"]')).toHaveLength(2)
    expect(host.innerHTML).not.toContain('note')
  })

  it('never executes raw HTML or unsafe Markdown link destinations', () => {
    const source = '[link](javascript:alert%281%29) <img src=x onerror=alert(1)>'
    const host = rendered(source)
    expect(host.textContent).toBe(source)
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('[onerror]')).toBeNull()
    expect(host.querySelector('a')?.hasAttribute('href')).toBe(false)
  })

  it('rebases existing change marks while speculative text waits for Core acknowledgement', () => {
    const host = rendered('A {++**bold**++} Z', 'A **bolder** Z')
    expect(host.textContent).toBe('A **bolder** Z')
    expect(host.querySelector('strong')).toBeNull()
    expect(host.querySelector('[data-critic-kind="addition"]')?.textContent).toBe('**bolder**')
  })

  it('preserves independently valid inline formatting inside both substitution arms', () => {
    const host = rendered('{~~*old*~>**new**~~}')
    expect(host.textContent).toBe('*old***new**')
    expect(host.querySelector('[data-critic-arm="old"] em')?.textContent).toBe('old')
    expect(host.querySelector('[data-critic-arm="new"] strong')?.textContent).toBe('new')
  })
})
