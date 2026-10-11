import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it, vi } from 'vitest'
import type { IInlinePresentationContext } from '@muyajs/core'
import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import { renderMuyaMarkupBinding } from '@/documentAuthority/muyaMarkupPresentation'

const shapeOf = (host: HTMLElement): string[] =>
  [...host.querySelectorAll('span')].map((span) => `${span.className}|${span.textContent}`)

const rendered = (
  source: string,
  currentText?: string,
  context?: IInlinePresentationContext
): HTMLDivElement => {
  const core = createDocumentCore()
  const revision = core.open(source)
  const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
  const binding = view.bindings[0]
  const host = document.createElement('div')
  host.innerHTML = renderMuyaMarkupBinding(
    binding,
    view.decorations,
    currentText ?? binding.text,
    context,
    view.comments
  )
  return host
}

describe('Muya Core Markup presentation', () => {
  it('exposes comments at their document locations without adding payload or caret characters', () => {
    const host = rendered('{>>first<<}a{>>middle<<}b{>>last<<}')
    const markers = [...host.querySelectorAll('[data-critic-kind="comment"]')]
    expect(markers).toHaveLength(3)
    expect(host.textContent).toBe('ab')
    expect(markers.map((marker) => marker.previousSibling?.textContent ?? '')).toEqual([
      '',
      'a',
      'b'
    ])
    expect(
      markers.map((marker) => [
        marker.getAttribute('data-critic-start'),
        marker.getAttribute('data-critic-end')
      ])
    ).toEqual([
      // This leaf starts at the first visible character, after the first note.
      ['-11', '0'],
      ['1', '13'],
      ['14', '24']
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
    const link = host.querySelector<HTMLElement>('span.mu-link')
    expect(link?.dataset).toMatchObject({
      start: '7',
      end: '34',
      raw: '[name](https://example.com)'
    })
    expect(
      rendered('[unsafe](javascript:alert(1))').querySelector('.mu-link')?.getAttribute('href')
    ).toBeNull()
  })

  it('delegates Core image semantics to native widgets and keeps raw text offsets', () => {
    const renderImage = vi.fn(() => ({
      open: '<span class="mu-inline-image" contenteditable="false" data-raw="![**alt**][ref]"><span class="mu-hide mu-remove">',
      close:
        '</span><span class="mu-image-container"><img src="file:///safe.png" alt="alt"></span></span>'
    }))
    const source = '{++![**alt**][ref]++}\n\n[ref]: /safe.png "Title"'
    const host = rendered(source, undefined, { renderImage })
    expect(renderImage).toHaveBeenCalledWith({
      raw: '![**alt**][ref]',
      range: { start: 0, end: 15 },
      src: '/safe.png',
      alt: 'alt',
      title: 'Title'
    })
    expect(host.textContent).toBe('![**alt**][ref]')
    expect(host.querySelector('[data-critic-kind="addition"] .mu-inline-image')).not.toBeNull()
    expect(host.querySelector('.mu-inline-image')?.getAttribute('contenteditable')).toBe('false')
    expect(host.querySelector('img')?.getAttribute('src')).toBe('file:///safe.png')
  })

  it.each([
    'before <img src="old.png" alt="a&amp;b" title="Title"> after',
    '<img src="old.png" alt="a&amp;b" title="Title">'
  ])('renders parser-owned HTML image semantics through the existing widget: %s', (source) => {
    const renderImage = vi.fn(() => ({
      open: '<span class="mu-inline-image" contenteditable="false"><span class="mu-hide mu-remove">',
      close: '</span><span class="mu-image-container"></span></span>'
    }))
    const host = rendered(source, undefined, { renderImage })
    const start = source.indexOf('<img')
    expect(renderImage).toHaveBeenCalledWith({
      raw: source.slice(start, source.indexOf('>') + 1),
      range: { start, end: source.indexOf('>') + 1 },
      src: 'old.png',
      alt: 'a&b',
      title: 'Title'
    })
    expect(host.querySelectorAll('.mu-inline-image')).toHaveLength(1)
    expect(host.textContent).toBe(source)
  })

  it('passes parser-owned HTML image dimensions and alignment to the native renderer', () => {
    const renderImage = vi.fn(() => ({ open: '<span>', close: '</span>' }))
    rendered('<img src="a.png" width="120" height="80" data-align="center">', undefined, {
      renderImage
    })
    expect(renderImage).toHaveBeenCalledWith(
      expect.objectContaining({ width: '120', height: '80', align: 'center' })
    )
  })

  it('renders one native image when a suggestion spans only part of its alt text', () => {
    const renderImage = vi.fn(() => ({
      open: '<span class="mu-inline-image" contenteditable="false"><span class="mu-hide mu-remove">',
      close: '</span><span class="mu-image-container"></span></span>'
    }))
    const host = rendered('![a{++a++}a]()', undefined, { renderImage })
    expect(renderImage).toHaveBeenCalledTimes(1)
    expect(host.querySelectorAll('.mu-inline-image')).toHaveLength(1)
    expect(host.textContent).toBe('![aaa]()')
    expect(host.querySelectorAll('[data-critic-kind="addition"]')).toHaveLength(1)
  })

  it('uses Core spelling ranges for entities and escapes, retaining every caret character', () => {
    const source = 'x &amp; y \\* &#x1F600; \\&copy; &unknown;'
    const host = rendered(source)
    expect(host.textContent).toBe(source)
    expect(
      [...host.querySelectorAll('[data-character]')].map((node) => [
        node.textContent,
        node.getAttribute('data-character')
      ])
    ).toEqual([['&amp;', '&']])
    // As upstream, a backslash escape hides only its backslash, and only
    // before a character upstream's escape rule lists: `\&` stays text.
    expect([...host.querySelectorAll('.mu-hide.mu-remove')].map((node) => node.textContent)).toEqual([
      '\\'
    ])
    expect(shapeOf(rendered('a \\/ b \\* c'))).toEqual(['mu-hide mu-remove|\\'])
  })

  it('presents known emoji only inside Core text leaves, never across annotation arms or inside code', () => {
    const source = ':smile: `:smile:` {~~:smi~>le:~~} :unknown:'
    const host = rendered(source)
    expect(host.textContent).toBe(':smile: `:smile:` :smile: :unknown:')
    expect(
      [...host.querySelectorAll('[data-emoji]')].map((node) => node.getAttribute('data-emoji'))
    ).toEqual(['😄'])
  })

  it('renders one parser-owned emoji across an additive arm while preserving its editable text', () => {
    const host = rendered(':s{++mi++}le:')
    expect(host.textContent).toBe(':smile:')
    expect(host.querySelectorAll('[data-emoji]')).toHaveLength(1)
    expect(host.querySelector('[data-emoji] [data-critic-kind=addition]')?.textContent).toBe('mi')
  })

  it('presents angle and extended autolinks with their Core destinations', () => {
    const source = '<https://example.com> <person@example.com> https://example.org'
    const host = rendered(source)
    expect(host.textContent).toBe(source)
    expect(
      [...host.querySelectorAll('a')].map((link) => [link.textContent, link.getAttribute('href')])
    ).toEqual([
      ['https://example.com', 'https://example.com'],
      ['person@example.com', 'mailto:person@example.com'],
      ['https://example.org', 'https://example.org']
    ])
    expect([...host.querySelectorAll('.mu-hide')].map((node) => node.textContent)).toEqual([
      '<',
      '>',
      '<',
      '>'
    ])
  })

  it('presents both Core hard-break spellings without altering editing characters', () => {
    const source = 'one  \ntwo\\\nthree'
    const host = rendered(source)
    expect(host.textContent).toBe(source)
    expect(
      [...host.querySelectorAll('.mu-hard-line-break-space')].map((node) => node.textContent)
    ).toEqual(['  ', '\\'])
    expect([...host.querySelectorAll('.mu-line-end')].map((node) => node.textContent)).toEqual([
      '\n',
      '\n'
    ])
  })

  it('keeps stars literal when they belong to separate substitution arms', () => {
    const host = rendered('{~~*old~>new*~~}')
    expect(host.textContent).toBe('*oldnew*')
    expect(host.querySelector('em')).toBeNull()
    expect(
      host.querySelector('[data-critic-kind="substitution"][data-critic-arm="old"]')?.textContent
    ).toBe('*old')
    expect(
      host.querySelector('[data-critic-kind="substitution"][data-critic-arm="new"]')?.textContent
    ).toBe('new*')
  })

  it('renders Core strong syntax with hidden markers and unchanged raw editing offsets', () => {
    const host = rendered('**bold**')
    expect(host.textContent).toBe('**bold**')
    expect(host.querySelector('strong')?.textContent).toBe('bold')
    expect(
      [...host.querySelectorAll('.mu-hide.mu-remove')].map((node) => node.textContent)
    ).toEqual(['**', '**'])
  })

  it('renders semantic emphasis, code and links from the Core AST', () => {
    const source = '*em* `code` [hi](https://example.com)'
    const host = rendered(source)
    expect(host.textContent).toBe(source)
    expect(host.querySelector('em')?.textContent).toBe('em')
    expect(host.querySelector('code')?.textContent).toBe('code')
    expect(host.querySelector('span.mu-link')?.textContent).toBe('hi')
    expect(host.querySelector('span.mu-link')?.getAttribute('href')).toBe('https://example.com')
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
    expect(host.querySelector('.mu-link')?.hasAttribute('href')).toBe(false)
  })

  it('shows speculative text literally until Core acknowledges its marks', () => {
    const host = rendered('A {++**bold**++} Z', 'A **bolder** Z')
    expect(host.textContent).toBe('A **bolder** Z')
    expect(host.querySelector('strong')).toBeNull()
    expect(host.querySelector('[data-critic-kind]')).toBeNull()
  })

  it('never attributes a mark to repeated text by comparing strings', () => {
    // Typing `a` at the start of `a{++a++}a` makes `aaaa`; a text comparison
    // cannot tell which `a` is new and would move the addition onto old text.
    const host = rendered('a{++a++}a{>>note<<}', 'aaaa')
    expect(host.textContent).toBe('aaaa')
    expect(host.querySelector('[data-critic-kind]')).toBeNull()
  })

  it('preserves independently valid inline formatting inside both substitution arms', () => {
    const host = rendered('{~~*old*~>**new**~~}')
    expect(host.textContent).toBe('*old***new**')
    expect(host.querySelector('[data-critic-arm="old"] em')?.textContent).toBe('old')
    expect(host.querySelector('[data-critic-arm="new"] strong')?.textContent).toBe('new')
  })

  describe('ATX heading markers, as upstream presents them', () => {
    const caretAt = (offset: number): IInlinePresentationContext => ({
      renderImage: () => undefined,
      cursor: { anchor: offset, focus: offset }
    })
    // Each element's classes and text, in document order.
    const shape = (host: HTMLElement): string[] =>
      [...host.querySelectorAll('span')].map((span) => `${span.className}|${span.textContent}`)

    it('hides the opening marker and pulls its spaces tight at every level', () => {
      for (let level = 1; level <= 6; level += 1) {
        const marker = '#'.repeat(level)
        const host = rendered(`${marker} Heading text\n\nBody paragraph.\n`)
        expect(shape(host)).toEqual([
          `mu-hide mu-remove|${marker}`,
          'mu-header-tight-space mu-remove| '
        ])
        expect(host.textContent).toBe(`${marker} Heading text`)
      }
    })

    it('shows the opening marker in gray only while the caret is on it', () => {
      const source = '## Heading text'
      const gray = ['mu-gray mu-remove|##', 'mu-gray mu-remove| ']
      const hidden = ['mu-hide mu-remove|##', 'mu-header-tight-space mu-remove| ']
      expect(shape(rendered(source, undefined, caretAt(0)))).toEqual(gray)
      expect(shape(rendered(source, undefined, caretAt(2)))).toEqual(gray)
      expect(shape(rendered(source, undefined, caretAt(3)))).toEqual(hidden)
      expect(shape(rendered(source, undefined, caretAt(source.length)))).toEqual(hidden)
      expect(
        shape(rendered(source, undefined, { renderImage: () => undefined, cursor: { anchor: 9, focus: 1 } }))
      ).toEqual(gray)
    })

    it('hides indentation, extra spaces and a closing sequence unless the caret is in them', () => {
      const source = '  ###   Hi ##  '
      expect(shape(rendered(source))).toEqual([
        'mu-hide mu-remove|  ###',
        'mu-header-tight-space mu-remove|   ',
        'mu-hide| ##'
      ])
      expect(shape(rendered(source, undefined, caretAt(10)))).toEqual([
        'mu-hide mu-remove|  ###',
        'mu-header-tight-space mu-remove|   ',
        'mu-gray| ##'
      ])
      expect(rendered(source).textContent).toBe(source)
      // Upstream reads `##` with no space before it as the heading's text.
      expect(shape(rendered('# ##'))).toEqual(['mu-hide mu-remove|#', 'mu-header-tight-space mu-remove| '])
      expect(shape(rendered('#'))).toEqual(['mu-hide mu-remove|#'])
      expect(shape(rendered('#', undefined, caretAt(1)))).toEqual(['mu-gray mu-remove|#'])
    })

    it('presents headings inside containers by their own text', () => {
      for (const source of ['> ## In quote', '- ## In list', '> - ## Nested']) {
        expect(shape(rendered(source))).toEqual([
          'mu-hide mu-remove|##',
          'mu-header-tight-space mu-remove| '
        ])
      }
    })

    it('leaves a setext heading without markers', () => {
      expect(shape(rendered('Setext text\n===\n'))).toEqual([])
      expect(shape(rendered('Setext text\n---\n', undefined, caretAt(0)))).toEqual([])
    })

    it('keeps annotations and inline syntax inside a heading', () => {
      const host = rendered('# {++added++} **bold** ##')
      expect(host.textContent).toBe('# added **bold** ##')
      expect(shape(host).slice(0, 2)).toEqual(['mu-hide mu-remove|#', 'mu-header-tight-space mu-remove| '])
      expect(host.querySelector('[data-critic-kind="addition"]')?.textContent).toBe('added')
      expect(host.querySelector('strong')?.textContent).toBe('bold')
      expect(shape(host).at(-1)).toBe('mu-hide| ##')
    })
  })

  describe('inline syntax markers follow the caret as upstream shows them', () => {
    const renderedWith = (
      source: string,
      offset: number | undefined,
      options?: Parameters<ReturnType<typeof createDocumentCore>['open']>[1]
    ): HTMLDivElement => {
      const core = createDocumentCore()
      const revision = core.open(source, options)
      const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
      const binding = view.bindings[0]
      const host = document.createElement('div')
      host.innerHTML = renderMuyaMarkupBinding(
        binding,
        view.decorations,
        binding.text,
        {
          renderImage: () => undefined,
          ...(offset === undefined ? {} : { cursor: { anchor: offset, focus: offset } })
        },
        view.comments
      )
      return host
    }
    // Each marker-bearing element's classes and text, in document order.
    const markers = (host: HTMLElement): string[] =>
      [...host.querySelectorAll('span, a')]
        .filter(
          (element) =>
            element.className !== '' &&
            (!element.classList.contains('mu-inline-rule') ||
              element.classList.contains('mu-emoji-marked-text') ||
              element.classList.contains('mu-no-text-link'))
        )
        .map((element) => `${element.className}|${element.textContent}`)

    it.each([
      ['**bold**', '**', 4],
      ['__bold__', '__', 4],
      ['*em*', '*', 2],
      ['_em_', '_', 2],
      ['~~del~~', '~~', 3],
      ['`code`', '`', 3]
    ])('shows the markers of %s in gray only while the caret is in it', (syntax, marker, inside) => {
      const source = `a ${syntax} b`
      const hidden = [`mu-hide mu-remove|${marker}`, `mu-hide mu-remove|${marker}`]
      const gray = [`mu-gray mu-remove|${marker}`, `mu-gray mu-remove|${marker}`]
      expect(markers(renderedWith(source, undefined))).toEqual(hidden)
      expect(markers(renderedWith(source, 1))).toEqual(hidden)
      expect(markers(renderedWith(source, 2))).toEqual(gray)
      expect(markers(renderedWith(source, 2 + inside))).toEqual(gray)
      expect(markers(renderedWith(source, 2 + syntax.length))).toEqual(gray)
      expect(markers(renderedWith(source, 3 + syntax.length))).toEqual(hidden)
    })

    it('reveals only the syntax holding the caret among nested syntax', () => {
      expect(markers(renderedWith('**a *b* c**', 1))).toEqual([
        'mu-gray mu-remove|**',
        'mu-hide mu-remove|*',
        'mu-hide mu-remove|*',
        'mu-gray mu-remove|**'
      ])
      expect(markers(renderedWith('**a *b* c**', 5))).toEqual([
        'mu-gray mu-remove|**',
        'mu-gray mu-remove|*',
        'mu-gray mu-remove|*',
        'mu-gray mu-remove|**'
      ])
    })

    it('shows superscript and subscript markers while the caret is in them', () => {
      const options = { subscriptAndSuperscript: true }
      expect(markers(renderedWith('x^2^ H~2~O', 2, options))).toEqual([
        'mu-gray mu-remove|^',
        'mu-gray mu-remove|^',
        'mu-hide mu-remove|~',
        'mu-hide mu-remove|~'
      ])
    })

    it('splits a shown inline link into brackets and destination as upstream does', () => {
      const source = '[text](https://example.com "title") after'
      // Hidden, the parts after the text read alike and stay one element.
      expect(markers(renderedWith(source, undefined))).toEqual([
        'mu-hide mu-remove|[',
        'mu-hide mu-remove|](https://example.com "title")'
      ])
      expect(markers(renderedWith(source, 3))).toEqual([
        'mu-gray mu-remove|[',
        'mu-gray mu-remove|](',
        'mu-link-in-bracket mu-remove|https://example.com "title"',
        'mu-gray mu-remove|)'
      ])
      expect(renderedWith(source, 3).querySelector('span.mu-link')?.textContent).toBe('text')
      expect(markers(renderedWith('[](https://example.com)', undefined))).toEqual([
        'mu-gray mu-remove|[](',
        'mu-no-text-link mu-inline-rule|https://example.com',
        'mu-gray mu-remove|)'
      ])
    })

    it('presents reference links with their label as upstream does', () => {
      const source = '[text][label] [label][] [label]\n\n[label]: https://example.com'
      expect(markers(renderedWith(source, undefined))).toEqual([
        'mu-hide|[',
        'mu-hide|][label]',
        'mu-hide|[',
        'mu-hide|][]',
        'mu-hide|[',
        'mu-hide|]'
      ])
      expect(markers(renderedWith(source, 2)).slice(0, 4)).toEqual([
        'mu-gray|[',
        'mu-gray|][',
        'mu-reference-label|label',
        'mu-gray|]'
      ])
      expect(renderedWith(source, 2).querySelector('a.mu-reference-link')?.getAttribute('href')).toBe(
        'https://example.com'
      )
    })

    it('shows autolink, footnote, emoji and escape markers while the caret is in them', () => {
      expect(markers(renderedWith('<https://a.b> x', 0))).toEqual(['mu-gray|<', 'mu-gray|>'])
      expect(markers(renderedWith('<https://a.b> x', 14))).toEqual(['mu-hide|<', 'mu-hide|>'])
      expect(markers(renderedWith('see[^1]\n\n[^1]: note', 4, { footnotes: true }))).toEqual([
        'mu-gray mu-remove|[^',
        'mu-gray mu-remove|]'
      ])
      expect(markers(renderedWith('see[^1]\n\n[^1]: note', 1, { footnotes: true }))).toEqual([
        'mu-hide mu-remove|[^',
        'mu-hide mu-remove|]'
      ])
      expect(markers(renderedWith(':smile: x', undefined))).toEqual([
        'mu-hide mu-emoji-marker|:',
        'mu-hide mu-inline-rule mu-emoji-marked-text|smile',
        'mu-hide mu-emoji-marker|:'
      ])
      expect(markers(renderedWith(':smile: x', 3))).toEqual([
        'mu-gray mu-emoji-marker|:',
        'mu-inline-rule mu-emoji-marked-text|smile',
        'mu-gray mu-emoji-marker|:'
      ])
      expect(markers(renderedWith(':nosuch: x', undefined))).toEqual([
        'mu-warn mu-emoji-marker|:',
        'mu-warn mu-inline-rule mu-emoji-marked-text|nosuch',
        'mu-warn mu-emoji-marker|:'
      ])
      const escapes = 'a &amp; \\* b'
      expect(markers(renderedWith(escapes, undefined))).toEqual([
        'mu-hide mu-html-escape|&amp;',
        'mu-html-escape-marker|&amp;',
        'mu-hide mu-remove|\\'
      ])
      expect(markers(renderedWith(escapes, 3))).toEqual([
        'mu-gray mu-html-escape|&amp;',
        'mu-html-escape-marker|&amp;',
        'mu-hide mu-remove|\\'
      ])
      expect(markers(renderedWith(escapes, 9))).toEqual([
        'mu-hide mu-html-escape|&amp;',
        'mu-html-escape-marker|&amp;',
        'mu-gray mu-remove|\\'
      ])
      expect(renderedWith(escapes, undefined).textContent).toBe('a &amp; \\* b')
    })

    it('keeps CriticMarkup marks around syntax whose markers the caret shows', () => {
      const host = renderedWith('a {++**new**++} b', 3)
      expect(host.textContent).toBe('a **new** b')
      expect(host.querySelector('[data-critic-kind="addition"]')?.textContent).toBe('**new**')
      expect(markers(host).filter((marker) => marker.startsWith('mu-'))).toEqual([
        'mu-gray mu-remove|**',
        'mu-gray mu-remove|**'
      ])
    })
  })

  describe('definitions and character references, as upstream presents them', () => {
    const shape = (host: HTMLElement): string[] =>
      [...host.querySelectorAll('span')].map((span) => `${span.className}|${span.textContent}`)

    it('colours a one-line reference definition by its parts', () => {
      expect(shape(rendered('[label]: https://example.com "A title"\n\n[x][label]'))).toEqual([
        'mu-reference-marker|[',
        'mu-reference-label|label',
        'mu-reference-marker|]: https://example.com "',
        'mu-reference-title|A title',
        'mu-reference-marker|"'
      ])
      expect(shape(rendered("   [label]: <https://example.com> 't'  "))).toEqual([
        'mu-reference-marker|   [',
        'mu-reference-label|label',
        "mu-reference-marker|]: <https://example.com> '",
        'mu-reference-title|t',
        "mu-reference-marker|'  "
      ])
      expect(shape(rendered('[label]: https://example.com  '))).toEqual([
        'mu-reference-marker|[',
        'mu-reference-label|label',
        'mu-reference-marker|]: https://example.com',
        'mu-reference-marker|  '
      ])
      expect(shape(rendered('> [quoted]: https://example.com'))).toEqual([
        'mu-reference-marker|[',
        'mu-reference-label|quoted',
        'mu-reference-marker|]: https://example.com'
      ])
      const label = rendered('[label]: https://example.com').querySelector('.mu-reference-label')
      expect(label?.getAttribute('spellcheck')).toBe('false')
      expect(rendered('[label]: https://example.com').textContent).toBe('[label]: https://example.com')
    })

    // The label's place comes from Core as written, so a label Core folds or
    // collapses for matching (`A  b` matches `a b`) colours as upstream does (B9).
    it('colours a definition whose label Core normalizes, by the label as written', () => {
      expect(shape(rendered('[A  b]: https://example.com'))).toEqual([
        'mu-reference-marker|[',
        'mu-reference-label|A  b',
        'mu-reference-marker|]: https://example.com'
      ])
    })

    it('leaves plain the definitions upstream does not colour', () => {
      for (const source of [
        '[label]: https://example.com (paren title)',
        '[label]:\n  https://example.com\n  "title"',
        '[label]: <a b>',
        '[label]:\thttps://example.com',
        '[a\\]b]: https://example.com'
      ]) {
        expect(shape(rendered(source))).toEqual([])
      }
    })

    it('draws only the named character references upstream knows', () => {
      const host = rendered('a &amp; &copy; &#35; &#x1F600; &AMP; b')
      expect(host.textContent).toBe('a &amp; &copy; &#35; &#x1F600; &AMP; b')
      expect(
        [...host.querySelectorAll('.mu-html-escape')].map((node) => [
          node.textContent,
          node.getAttribute('data-character')
        ])
      ).toEqual([
        ['&amp;', '&'],
        ['&copy;', '©'],
        // Upstream knows the name in any case but draws only `&amp;`'s character.
        ['&AMP;', null]
      ])
    })
  })
})
