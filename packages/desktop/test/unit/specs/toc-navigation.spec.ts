import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { NodeId } from '@marktext/document-core'

// `@/store/editor` transitively imports `@/config`, which reads `window.path`
// at module load and reaches `window.electron` at runtime. Stub those surfaces
// (normally injected by the preload bridge) before the hoisted imports run.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {} }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

import { useEditorStore } from '@/store/editor'
import { getBlankFileState } from '@/store/help'
import { resolveTocHeadingElement } from '@/util/tocNavigation'

const nodeId = (value: string): NodeId => value as NodeId

describe('useEditorStore UPDATE_TOC', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('seeds the flat listToc and the nested tree from an engine snapshot', () => {
    const store = useEditorStore()
    store.UPDATE_TOC([
      {
        nodeId: nodeId('heading:intro'),
        slug: 'intro',
        content: 'Intro',
        lvl: 1
      },
      {
        nodeId: nodeId('heading:details'),
        slug: 'details',
        content: 'Details',
        lvl: 2
      }
    ])

    expect(store.listToc.map((i) => i.nodeId)).toEqual([
      'heading:intro',
      'heading:details'
    ])
    // listToTree nests the lvl-2 entry under the lvl-1 entry.
    expect(store.toc).toHaveLength(1)
    expect(store.toc[0].nodeId).toBe('heading:intro')
    expect(store.toc[0].children).toHaveLength(1)
    expect(store.toc[0].children[0].nodeId).toBe('heading:details')
  })

  it('re-seeds unconditionally, even when the new snapshot deep-equals the old', () => {
    const store = useEditorStore()
    const first = [{
      nodeId: nodeId('heading:intro'),
      slug: 'intro',
      content: 'Intro',
      lvl: 1
    }]
    store.UPDATE_TOC(first)
    const prevListToc = store.listToc

    // A fresh array with identical content (mirrors re-seeding the SAME document
    // on a tab switch). There is no `equal` guard, so the new snapshot must
    // replace the old reference rather than be short-circuited.
    store.UPDATE_TOC([{
      nodeId: nodeId('heading:intro'),
      slug: 'intro',
      content: 'Intro',
      lvl: 1
    }])
    expect(store.listToc).not.toBe(prevListToc)
    expect(store.listToc).toEqual(prevListToc)
  })

  it('resets to empty for a nullish snapshot', () => {
    const store = useEditorStore()
    store.UPDATE_TOC([{
      nodeId: nodeId('heading:intro'),
      slug: 'intro',
      content: 'Intro',
      lvl: 1
    }])
    store.UPDATE_TOC(undefined as unknown as never)
    expect(store.listToc).toEqual([])
    expect(store.toc).toEqual([])
  })
})

describe('useEditorStore UPDATE_WORD_COUNT', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('seeds the active tab without changing its clean or document state', () => {
    const store = useEditorStore()
    const tab = getBlankFileState([])
    const documentState = tab.documentCoreHistory
    store.tabs.push(tab)
    store.currentFile = tab

    store.UPDATE_WORD_COUNT({ paragraph: 2, word: 7, character: 31, all: 38 })

    expect(tab.wordCount).toEqual({ paragraph: 2, word: 7, character: 31, all: 38 })
    expect(tab.isSaved).toBe(true)
    expect(tab.documentCoreHistory).toBe(documentState)
  })
})

describe('resolveTocHeadingElement', () => {
  const buildOwner = (): Readonly<{
    container: HTMLElement
    resolveHeadingElement: (nodeId: string) => HTMLElement | null
  }> => {
    const container = document.createElement('div')
    container.className = 'editor-component document-view-editor'
    container.innerHTML = `
      <div class="document-view-container">
        <h1 class="document-view-heading" data-node-id="heading:top-one">Top One</h1>
        <blockquote>
          <h2 class="document-view-heading" data-node-id="heading:nested">Nested heading</h2>
        </blockquote>
        <div class="document-view-html-block"><h2>Raw HTML heading</h2></div>
        <h2 class="document-view-heading" data-node-id="heading:top-two">Top Two</h2>
      </div>
    `
    const owned = new Map<string, HTMLElement>()
    for (const element of container.querySelectorAll<HTMLElement>(
      '.document-view-heading[data-node-id]'
    )) {
      const nodeId = element.dataset.nodeId
      if (nodeId !== undefined) owned.set(nodeId, element)
    }
    return Object.freeze({
      container,
      resolveHeadingElement: (nodeId: string) => owned.get(nodeId) ?? null
    })
  }

  it('resolves a heading directly by parser NodeId', () => {
    const owner = buildOwner()
    const el = resolveTocHeadingElement(owner, 'heading:top-one')
    expect(el?.textContent).toBe('Top One')
  })

  it('resolves a parser heading nested in a blockquote', () => {
    const owner = buildOwner()
    const el = resolveTocHeadingElement(owner, 'heading:nested')
    expect(el?.textContent).toBe('Nested heading')
  })

  it('returns null for an unknown NodeId', () => {
    const owner = buildOwner()
    expect(resolveTocHeadingElement(owner, 'heading:missing')).toBeNull()
  })

  it('does not treat hostile raw HTML classes and data attributes as ownership', () => {
    const owner = buildOwner()
    const raw = owner.container.querySelector('.document-view-html-block h2')
    raw?.classList.add('document-view-heading')
    raw?.setAttribute('data-node-id', 'heading:spoofed')
    expect(resolveTocHeadingElement(owner, 'heading:spoofed')).toBeNull()
  })

  it('selects the second duplicate heading by its parser NodeId', () => {
    const container = document.createElement('div')
    container.className = 'document-view-editor'
    container.innerHTML = `
      <div class="document-view-container">
        <h1 class="document-view-heading" data-node-id="heading:first">Repeat</h1>
        <h1 class="document-view-heading" data-node-id="heading:second">Repeat</h1>
      </div>
    `
    const second = container.querySelectorAll<HTMLElement>(
      '.document-view-heading'
    )[1] ?? null
    const owner = {
      resolveHeadingElement: (nodeId: string) =>
        nodeId === 'heading:second' ? second : null
    }

    expect(
      resolveTocHeadingElement(owner, 'heading:second')?.dataset.nodeId
    ).toBe('heading:second')
  })

  it('selects a later top-level heading by NodeId after a nested heading', () => {
    const container = document.createElement('div')
    container.className = 'document-view-editor'
    container.innerHTML = `
      <div class="document-view-container">
        <blockquote>
          <h2 class="document-view-heading" data-node-id="heading:nested">Nested</h2>
        </blockquote>
        <h2 class="document-view-heading" data-node-id="heading:later">Later</h2>
      </div>
    `
    const later = container.querySelector<HTMLElement>(
      '[data-node-id="heading:later"]'
    )
    const owner = {
      resolveHeadingElement: (nodeId: string) =>
        nodeId === 'heading:later' ? later : null
    }

    expect(
      resolveTocHeadingElement(owner, 'heading:later')?.dataset.nodeId
    ).toBe('heading:later')
  })
})
