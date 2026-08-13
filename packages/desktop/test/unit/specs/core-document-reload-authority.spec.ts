import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (path: string) => string }
      fileUtils?: { isSamePathSync: (left: string, right: string) => boolean }
      electron?: { ipcRenderer: { send: (...args: unknown[]) => void; on: (...args: unknown[]) => void } }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: path => path }
  w.window.fileUtils ??= { isSamePathSync: (left, right) => left === right }
  w.window.electron ??= { ipcRenderer: { send: () => {}, on: () => {} } }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
vi.mock('@/store/bufferedState', () => ({ debouncedSendBufferedState: vi.fn() }))

import bus from '@/bus'
import { useEditorStore } from '@/store/editor'
import { coreDocumentReloadAuthority } from '@/documentAuthority/coreDocumentReloadAuthority'

const change = Object.freeze({
  pathname: '/tmp/reload.md',
  data: Object.freeze({
    markdown: 'exact reload bytes',
    filename: 'reload.md',
    encoding: Object.freeze({ encoding: 'utf8', isBom: false }),
    lineEnding: 'crlf',
    adjustLineEndingOnSave: true,
    trimTrailingNewline: 1,
    isMixedLineEndings: false
  })
})

describe('Core document external reload authority', () => {
  let unregister: (() => void) | undefined

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    unregister?.()
    unregister = undefined
  })

  const seed = () => {
    const store = useEditorStore()
    const tab = {
      id: 'reload-id',
      filename: 'reload.md',
      pathname: '/tmp/reload.md',
      markdown: 'stale Pinia bytes',
      isSaved: true,
      encoding: { encoding: 'utf8', isBom: false },
      lineEnding: 'lf',
      adjustLineEndingOnSave: false,
      trimTrailingNewline: 2,
      history: { stack: [], index: -1 },
      cursor: null,
      wordCount: { paragraph: 0, word: 0, character: 0, all: 0 },
      searchMatches: { index: -1, matches: [], value: '' },
      scrollTop: 17,
      muyaIndexCursor: null,
      notifications: []
    }
    store.tabs = [tab] as typeof store.tabs
    store.currentFile = tab as typeof store.currentFile
    store.updateTabIdToIndex()
    return { store, tab }
  }

  it('waits for Core generation replacement before publishing reload bytes to Pinia and the view', async() => {
    const { store, tab } = seed()
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const publicationOrder: string[] = []
    const replace = vi.fn(async() => {
      await held
      publicationOrder.push('core')
      return () => { publicationOrder.push('view') }
    })
    unregister = coreDocumentReloadAuthority.register('reload-id', replace)
    const emit = vi.spyOn(bus, 'emit')
    emit.mockImplementation((event) => {
      if (event === 'file-changed') publicationOrder.push('pinia')
    })

    const reloading = store.loadChange(change)
    expect(reloading).toBeInstanceOf(Promise)
    expect(replace).toHaveBeenCalledWith({
      documentId: 'reload-id',
      source: 'exact reload bytes',
      lineEnding: '\r\n'
    })
    expect(tab.markdown).toBe('stale Pinia bytes')
    expect(emit).not.toHaveBeenCalledWith('file-changed', expect.anything())

    release()
    await reloading
    expect(tab.markdown).toBe('exact reload bytes')
    expect(publicationOrder).toEqual(['core', 'pinia', 'view'])
    expect(emit).toHaveBeenCalledWith('file-changed', expect.objectContaining({
      id: 'reload-id',
      markdown: 'exact reload bytes',
      isReload: true
    }))
  })

  it('keeps legacy reload synchronous when no Core session is registered', () => {
    const { store, tab } = seed()
    const emit = vi.spyOn(bus, 'emit')

    const result = store.loadChange(change)

    expect(result).toBeUndefined()
    expect(tab.markdown).toBe('exact reload bytes')
    expect(emit).toHaveBeenCalledWith('file-changed', expect.objectContaining({
      id: 'reload-id',
      markdown: 'exact reload bytes',
      isReload: true
    }))
  })

  it('does not reactivate a reload target after the user switches tabs', async() => {
    const { store, tab } = seed()
    const otherTab = {
      ...tab,
      id: 'other-id',
      filename: 'other.md',
      pathname: '/tmp/other.md',
      markdown: 'other bytes'
    }
    store.tabs.push(otherTab as typeof store.tabs[number])
    store.updateTabIdToIndex()
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    unregister = coreDocumentReloadAuthority.register('reload-id', async() => {
      await held
      return () => {}
    })
    const emit = vi.spyOn(bus, 'emit')

    const reloading = store.loadChange(change)
    store.currentFile = otherTab as typeof store.currentFile
    release()
    await reloading

    expect(store.currentFile?.id).toBe('other-id')
    expect(tab.markdown).toBe('exact reload bytes')
    expect(emit).not.toHaveBeenCalledWith(
      'file-changed',
      expect.objectContaining({ id: 'reload-id' })
    )
  })

  it('does not resurrect a reload target closed before publication', async() => {
    const { store } = seed()
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    unregister = coreDocumentReloadAuthority.register('reload-id', async() => {
      await held
      return () => {}
    })
    const emit = vi.spyOn(bus, 'emit')

    const reloading = store.loadChange(change)
    store.tabs = []
    store.currentFile = null
    store.updateTabIdToIndex()
    release()
    await reloading

    expect(store.tabs).toEqual([])
    expect(store.currentFile).toBeNull()
    expect(emit).not.toHaveBeenCalledWith(
      'file-changed',
      expect.objectContaining({ id: 'reload-id' })
    )
  })
})
