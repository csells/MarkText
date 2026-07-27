import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { NodeId } from '@marktext/document-core'

// `@/store/editor` transitively imports `@/config`, which reads
// `window.path.sep` at module load (normally injected by the preload bridge).
// It also reaches `window.electron.ipcRenderer` at runtime. Stub the surface
// before the hoisted imports run.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      electron?: {
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.electron ??= {
    ipcRenderer: { send: () => {}, on: () => {} }
  }
})

// The notification service touches the DOM / template HTML; stub it so we can
// observe `notify` without rendering a toast.
vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

import { useEditorStore } from '@/store/editor'
import bus from '@/bus'
import notice from '@/services/notification'

const nodeId = (value: string): NodeId => value as NodeId

describe('useEditorStore parser-authenticated document anchors', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('emits the matching parser NodeId for an in-document heading anchor', () => {
    const store = useEditorStore()
    store.listToc = [{
      nodeId: nodeId('heading:installation'),
      slug: 'installation',
      content: 'Installation',
      lvl: 2
    }]

    const emitSpy = vi.spyOn(bus, 'emit')
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.NAVIGATE_DOCUMENT_ANCHOR('installation')

    expect(emitSpy).toHaveBeenCalledWith(
      'scroll-to-header',
      'heading:installation'
    )
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('does nothing for an anchor that matches no TOC slug and no DOM id', () => {
    const store = useEditorStore()
    store.listToc = [{
      nodeId: nodeId('heading:installation'),
      slug: 'installation',
      content: 'Installation',
      lvl: 2
    }]

    const emitSpy = vi.spyOn(bus, 'emit')
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')
    const getByIdSpy = vi.spyOn(document, 'getElementById').mockReturnValue(null)

    store.NAVIGATE_DOCUMENT_ANCHOR('nope')

    expect(emitSpy).not.toHaveBeenCalled()
    expect(sendSpy).not.toHaveBeenCalled()
    getByIdSpy.mockRestore()
  })

  // marktext #3609: `[text](#id)` where `#id` is a custom `<a id="id">` (not a
  // heading) was silently swallowed — it isn't in the TOC. Fall back to the DOM.
  it('emits scroll-to-anchor-element for a non-heading anchor id found in the DOM', () => {
    const store = useEditorStore()
    store.listToc = [{
      nodeId: nodeId('heading:installation'),
      slug: 'installation',
      content: 'Installation',
      lvl: 2
    }]

    const fakeEl = document.createElement('a')
    const getByIdSpy = vi.spyOn(document, 'getElementById').mockReturnValue(fakeEl)
    const emitSpy = vi.spyOn(bus, 'emit')
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.NAVIGATE_DOCUMENT_ANCHOR('jump')

    expect(getByIdSpy).toHaveBeenCalledWith('jump')
    expect(emitSpy).toHaveBeenCalledWith('scroll-to-anchor-element', fakeEl)
    expect(sendSpy).not.toHaveBeenCalled()
    getByIdSpy.mockRestore()
  })

  it('ignores a bare "#" (empty anchor slug) without emit or IPC', () => {
    const store = useEditorStore()
    store.listToc = [{
      nodeId: nodeId('heading:installation'),
      slug: 'installation',
      content: 'Installation',
      lvl: 2
    }]

    const emitSpy = vi.spyOn(bus, 'emit')
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.NAVIGATE_DOCUMENT_ANCHOR('')

    expect(emitSpy).not.toHaveBeenCalled()
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('does not expose the renderer URL/path forwarding action', () => {
    const store = useEditorStore()
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    expect('FORMAT_LINK_CLICK' in store).toBe(false)
    expect(sendSpy).not.toHaveBeenCalled()
  })
})

describe('heading-link clipboard authority', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('does not expose renderer slug-to-clipboard materialization', () => {
    const store = useEditorStore()
    store.listToc = [{
      nodeId: nodeId('heading:getting-started'),
      slug: 'getting-started',
      content: 'Getting started',
      lvl: 2
    }]

    expect('copyGithubSlug' in store).toBe(false)
    expect(notice.notify).not.toHaveBeenCalled()
  })
})
