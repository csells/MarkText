import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it, vi } from 'vitest'

import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import { renderMuyaMarkupBinding } from '@/documentAuthority/muyaMarkupPresentation'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'

describe('Muya Markup presentation index', () => {
  it('uses the rendered Core syntax for inline code and math input boundaries', () => {
    const core = createDocumentCore()
    const revision = core.open('pre `code` $x$ post')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
    const index = createMuyaMarkupPresentationIndex(view)
    for (const [offset, code, math] of [
      [0, false, false],
      [4, false, false],
      [5, true, false],
      [9, true, false],
      [10, false, false],
      [11, false, false],
      [12, false, true],
      [13, false, true],
      [14, false, false]
    ] as const) {
      expect(index.syntaxContext({ path: [0, 'text'], offset })).toEqual({
        type: 'format',
        isInInlineCode: code,
        isInInlineMath: math
      })
    }
  })

  it('does not invent inline code across substitution arms while recognizing code inside an addition', () => {
    const core = createDocumentCore()
    for (const [source, offset, expectedCode] of [
      ['a{++`code`++}b', 2, true],
      ['{~~`old~>new`~~}', 2, false]
    ] as const) {
      const revision = core.open(source)
      const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
      const index = createMuyaMarkupPresentationIndex(view)
      expect(index.syntaxContext({ path: [0, 'text'], offset })).toEqual({
        type: 'format',
        isInInlineCode: expectedCode,
        isInInlineMath: false
      })
    }
  })

  it.each(['```js\ntext\n```', '$$\nx\n$$', '<script>text</script>'])(
    'uses the Core literal block owner for %s',
    (source) => {
      const core = createDocumentCore()
      const revision = core.open(source)
      const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
      const index = createMuyaMarkupPresentationIndex(view)
      const binding = view.bindings[0]
      expect(binding).toBeDefined()
      expect(index.syntaxContext({ path: binding.path, offset: 0 })).toEqual({
        type: 'literal',
        isInInlineCode: false,
        isInInlineMath: false
      })
    }
  )

  it('withholds stale syntax after pending input and restores it only from the next Core view', () => {
    const core = createDocumentCore()
    const revision = core.open('pre `code` post\n\nuntouched')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
    const index = createMuyaMarkupPresentationIndex(view)
    index.replaceText({
      selection: {
        anchor: { path: [0, 'text'], offset: 4 },
        focus: { path: [0, 'text'], offset: 5 }
      },
      text: '',
      inputType: 'deleteContentForward'
    })
    // The old inline-code node is no longer authoritative after deleting its
    // opener, even though a later caret can map to an old source position.
    expect(index.syntaxContext({ path: [0, 'text'], offset: 6 })).toBeUndefined()
    expect(index.syntaxContext({ path: [1, 'text'], offset: 0 })).toEqual({
      type: 'format',
      isInInlineCode: false,
      isInInlineMath: false
    })
    const acknowledged = core.apply(revision, [{ start: 4, end: 5, insert: '' }]).revision
    const refreshed = createMuyaMarkupPresentationIndex(
      createMuyaMarkupView(core.project(acknowledged, 'markup'), acknowledged.annotations),
      index
    )
    expect(refreshed.syntaxContext({ path: [0, 'text'], offset: 6 })).toEqual({
      type: 'format',
      isInInlineCode: false,
      isInInlineMath: false
    })
  })

  it('withholds syntax when a pending cross-block replacement changes view ownership', () => {
    const core = createDocumentCore()
    const revision = core.open('first\n\n`code`\n\nlast')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
    const index = createMuyaMarkupPresentationIndex(view)
    index.replaceText({
      selection: {
        anchor: { path: [0, 'text'], offset: 0 },
        focus: { path: [1, 'text'], offset: 6 }
      },
      text: 'plain',
      inputType: 'insertText'
    })
    expect(index.syntaxContext({ path: [1, 'text'], offset: 2 })).toBeUndefined()
  })

  it('moves a pending suggestion using the actual insertion location in repeated text', () => {
    const core = createDocumentCore()
    const revision = core.open('a{++a++}a')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
    const index = createMuyaMarkupPresentationIndex(view)
    index.replaceText({
      selection: {
        anchor: { path: [0, 'text'], offset: 0 },
        focus: { path: [0, 'text'], offset: 0 }
      },
      text: 'a',
      inputType: 'insertText'
    })
    const host = document.createElement('div')
    host.innerHTML = index.render([0, 'text'], 'aaaa') ?? ''
    const suggestion = host.querySelector('[data-critic-kind="addition"]')
    expect(host.textContent).toBe('aaaa')
    expect(suggestion?.textContent).toBe('a')
    expect(suggestion?.previousSibling?.textContent).toBe('aa')
    expect(suggestion?.nextSibling?.textContent).toBe('a')
  })

  it('refreshes localized comment names without changing source or reusing the old locale cache', () => {
    const core = createDocumentCore()
    const revision = core.open('a{>>note<<}b')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
    const english = createMuyaMarkupPresentationIndex(view, undefined, undefined, 'Comment')
    expect(english.render([0, 'text'], 'ab')).toContain('aria-label="Comment"')
    const french = createMuyaMarkupPresentationIndex(view, english, undefined, 'Commentaire')
    expect(french.changedPaths).toContainEqual([0, 'text'])
    expect(french.render([0, 'text'], 'ab')).toContain('aria-label="Commentaire"')
    const escaped = createMuyaMarkupPresentationIndex(
      view,
      french,
      undefined,
      'Note "quoted" <safe>'
    )
    const host = document.createElement('div')
    host.innerHTML = escaped.render([0, 'text'], 'ab') ?? ''
    expect(host.querySelector('[role="button"]')?.getAttribute('aria-label')).toBe(
      'Note "quoted" <safe>'
    )
    expect(host.textContent).toBe('ab')
  })

  it('retains a shifted comment leaf but refreshes changed comment locations and annotation extents', () => {
    const core = createDocumentCore()
    const renderer = vi.fn(renderMuyaMarkupBinding)
    const first = core.open('first\n\na{>>note<<}b')
    const view = createMuyaMarkupView(core.project(first, 'markup'), first.annotations)
    const previous = createMuyaMarkupPresentationIndex(view, undefined, renderer)
    const html = previous.render([1, 'text'], 'ab')
    const host = document.createElement('div')
    host.innerHTML = html ?? ''
    expect(
      host.querySelector('[data-critic-kind="comment"]')?.getAttribute('data-critic-start')
    ).toBe('1')

    const shifted = core.open('first expanded\n\na{>>note<<}b')
    const shiftedView = createMuyaMarkupView(core.project(shifted, 'markup'), shifted.annotations)
    const retained = createMuyaMarkupPresentationIndex(shiftedView, previous, renderer)
    expect(retained.changedPaths).toEqual([[0, 'text']])
    expect(retained.render([1, 'text'], 'ab')).toBe(html)
    expect(renderer).toHaveBeenCalledTimes(1)

    const edited = core.open('first expanded\n\nab{>>longer note<<}')
    const editedView = createMuyaMarkupView(core.project(edited, 'markup'), edited.annotations)
    const updated = createMuyaMarkupPresentationIndex(editedView, retained, renderer)
    expect(updated.changedPaths).toEqual([[1, 'text']])
    host.innerHTML = updated.render([1, 'text'], 'ab') ?? ''
    const marker = host.querySelector('[data-critic-kind="comment"]')
    expect(marker?.getAttribute('data-critic-start')).toBe('2')
    expect(marker?.getAttribute('data-critic-end')).toBe('19')
    expect(marker?.previousSibling?.textContent).toBe('ab')
    expect(host.textContent).toBe('ab')
    expect(renderer).toHaveBeenCalledTimes(2)

    const removed = core.open('first expanded\n\nab')
    const removedView = createMuyaMarkupView(core.project(removed, 'markup'), removed.annotations)
    const cleared = createMuyaMarkupPresentationIndex(removedView, updated, renderer)
    expect(cleared.changedPaths).toEqual([[1, 'text']])
    expect(cleared.render([1, 'text'], 'ab')).toBe('ab')
  })

  it('updates and clears search highlights without changing raw text or reusing stale cached HTML', () => {
    const core = createDocumentCore()
    const revision = core.open('{--old--}{++**new**++}')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
    const index = createMuyaMarkupPresentationIndex(view)
    const text = 'old**new**'
    const host = document.createElement('div')
    index.render([0, 'text'], text)
    const context = {
      renderImage: () => undefined,
      highlights: [{ start: 5, end: 8, active: true }]
    }
    host.innerHTML = index.render([0, 'text'], text, context) ?? ''
    expect(host.querySelector('.mu-highlight')?.textContent).toBe('new')
    expect(host.querySelector('.mu-highlight strong')?.textContent).toBe('new')
    expect(host.textContent).toBe(text)
    host.innerHTML = index.render([0, 'text'], text, { ...context, highlights: [] }) ?? ''
    expect(host.querySelector('.mu-highlight')).toBeNull()
    expect(host.textContent).toBe(text)
  })

  it.each([
    '![alt](image.png)',
    '<img src="image.png" alt="alt" width="120" data-align="center">',
    'prefix <img src="image.png" alt="a{++a++}a">'
  ])('refreshes native image state for %s while retaining ordinary sibling HTML', (source) => {
    const core = createDocumentCore()
    const revision = core.open(`${source}\n\nplain`)
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
    const renderer = vi.fn(renderMuyaMarkupBinding)
    const index = createMuyaMarkupPresentationIndex(view, undefined, renderer)
    const renderImage = vi.fn(() => ({ open: '<span class="loading">', close: '</span>' }))
    const context = { renderImage }
    expect(index.render([0, 'text'], source, context)).toContain('loading')
    index.render([1, 'text'], 'plain', context)
    renderImage.mockReturnValue({ open: '<span class="loaded">', close: '</span>' })
    expect(index.render([0, 'text'], source, context)).toContain('loaded')
    index.render([1, 'text'], 'plain', context)
    expect(renderImage).toHaveBeenCalledTimes(2)
    expect(renderer).toHaveBeenCalledTimes(3)
  })

  it('keeps unchanged sibling DOM and cached HTML after an earlier source edit shifts its coordinates', () => {
    const core = createDocumentCore()
    const previous = core.open('first\n\n{++**kept**++}\n\nlast')
    const renderer = vi.fn(renderMuyaMarkupBinding)
    const view = createMuyaMarkupView(core.project(previous, 'markup'), previous.annotations)
    const index = createMuyaMarkupPresentationIndex(view, undefined, renderer)
    const nodes = view.bindings.map((binding) => {
      const node = document.createElement('div')
      node.innerHTML = index.render(binding.path, binding.text) ?? ''
      return node
    })
    const kept = nodes[1].querySelector('strong')
    expect(kept?.textContent).toBe('kept')
    expect(renderer).toHaveBeenCalledTimes(3)
    expect(renderer.mock.calls[0][1]).toHaveLength(0)
    expect(renderer.mock.calls[1][1]).toHaveLength(1)

    const next = core.apply(previous, [{ start: 5, end: 5, insert: ' expanded' }]).revision
    const nextView = createMuyaMarkupView(core.project(next, 'markup'), next.annotations)
    const updated = createMuyaMarkupPresentationIndex(nextView, index, renderer)
    expect(updated.changedPaths).toEqual([[0, 'text']])
    for (const path of updated.changedPaths) {
      const binding = nextView.bindings.find(
        (candidate) => JSON.stringify(candidate.path) === JSON.stringify(path)
      )
      if (binding !== undefined) {
        nodes[Number(path[0])].innerHTML = updated.render(path, binding.text) ?? ''
      }
    }
    expect(nodes[1].querySelector('strong')).toBe(kept)
    expect(updated.render([1, 'text'], '**kept**')).toBe(nodes[1].innerHTML)
    expect(renderer).toHaveBeenCalledTimes(4)
  })

  it('invalidates identical text when its annotation kind or resolved link destination changes', () => {
    const core = createDocumentCore()
    const first = core.open('{++same++}\n\n[link][ref]\n\n[ref]: https://old.test')
    const firstView = createMuyaMarkupView(core.project(first, 'markup'), first.annotations)
    const previous = createMuyaMarkupPresentationIndex(firstView)
    expect(previous.render([0, 'text'], 'same')).toContain('data-critic-kind="addition"')
    expect(previous.render([1, 'text'], '[link][ref]')).toContain('https://old.test')
    const next = core.open('{--same--}\n\n[link][ref]\n\n[ref]: https://new.test')
    const nextView = createMuyaMarkupView(core.project(next, 'markup'), next.annotations)
    const updated = createMuyaMarkupPresentationIndex(nextView, previous)
    expect(updated.changedPaths).toContainEqual([0, 'text'])
    expect(updated.changedPaths).toContainEqual([1, 'text'])
    expect(updated.render([0, 'text'], 'same')).toContain('data-critic-kind="deletion"')
    expect(updated.render([1, 'text'], '[link][ref]')).toContain('https://new.test')
  })

  it('marks a previously rendered speculative draft dirty when authority retains the original text', () => {
    const core = createDocumentCore()
    const revision = core.open('**original**')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
    const previous = createMuyaMarkupPresentationIndex(view)
    expect(previous.render([0, 'text'], '**draft**')).not.toContain('<strong')
    const updated = createMuyaMarkupPresentationIndex(structuredClone(view), previous)
    expect(updated.changedPaths).toEqual([[0, 'text']])
    expect(updated.render([0, 'text'], '**original**')).toContain('<strong')
  })
})
