import { createDocumentCore } from '@marktext/document-core'
import { describe, expect, it, vi } from 'vitest'

import { createMuyaMarkupView } from '@/documentAuthority/muyaMarkupView'
import { renderMuyaMarkupBinding } from '@/documentAuthority/muyaMarkupPresentation'
import { createMuyaMarkupPresentationIndex } from '@/documentAuthority/muyaMarkupPresentationIndex'

describe('Muya Markup presentation index', () => {
  it('updates and clears search highlights without changing raw text or reusing stale cached HTML', () => {
    const core = createDocumentCore()
    const revision = core.open('{--old--}{++**new**++}')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
    const index = createMuyaMarkupPresentationIndex(view)
    const text = 'old**new**'
    const host = document.createElement('div')
    index.render([0, 'text'], text)
    const context = { renderImage: () => undefined, highlights: [{ start: 5, end: 8, active: true }] }
    host.innerHTML = index.render([0, 'text'], text, context) ?? ''
    expect(host.querySelector('.mu-highlight')?.textContent).toBe('new')
    expect(host.querySelector('.mu-highlight strong')?.textContent).toBe('new')
    expect(host.textContent).toBe(text)
    host.innerHTML = index.render([0, 'text'], text, { ...context, highlights: [] }) ?? ''
    expect(host.querySelector('.mu-highlight')).toBeNull()
    expect(host.textContent).toBe(text)
  })

  it('refreshes native image state on a requested patch while retaining ordinary sibling HTML', () => {
    const core = createDocumentCore()
    const revision = core.open('![alt](image.png)\n\nplain')
    const view = createMuyaMarkupView(core.project(revision, 'markup'), revision.annotations)
    const renderer = vi.fn(renderMuyaMarkupBinding)
    const index = createMuyaMarkupPresentationIndex(view, undefined, renderer)
    const renderImage = vi.fn(() => ({ open: '<span class="loading">', close: '</span>' }))
    const context = { renderImage }
    expect(index.render([0, 'text'], '![alt](image.png)', context)).toContain('loading')
    index.render([1, 'text'], 'plain', context)
    renderImage.mockReturnValue({ open: '<span class="loaded">', close: '</span>' })
    expect(index.render([0, 'text'], '![alt](image.png)', context)).toContain('loaded')
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
    const nodes = view.bindings.map(binding => {
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
      const binding = nextView.bindings.find(candidate => JSON.stringify(candidate.path) === JSON.stringify(path))
      if (binding !== undefined) nodes[Number(path[0])].innerHTML = updated.render(path, binding.text) ?? ''
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
