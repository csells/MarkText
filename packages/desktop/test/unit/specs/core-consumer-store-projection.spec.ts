import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const w = globalThis as unknown as {
    localStorage?: { getItem: () => null; setItem: () => void }
    window?: {
      path?: { sep: string; dirname: (path: string) => string }
      electron?: {
        clipboard: { writeText: (value: string) => void }
        ipcRenderer: { send: () => void; on: () => void }
      }
    }
  }
  w.localStorage ??= { getItem: () => null, setItem: () => {} }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: path => path }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {} }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

import { useEditorStore } from '@/store/editor'

describe('Core consumer projection store seam', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('updates count only for the exact Core identity and never writes Markdown', () => {
    const store = useEditorStore()
    const originalCount = { paragraph: 0, word: 0, character: 0, all: 0 }
    const tab = {
      id: 'projection-count-tab',
      markdown: 'canonical bytes must not cross this seam',
      wordCount: originalCount
    }
    store.currentFile = tab as never
    store.tabs = [tab] as never
    store.tabIdToIndex = { 'projection-count-tab': 0 }
    store.REGISTER_CORE_SAVE_IDENTITY(
      'projection-count-tab',
      { generation: 9, revision: 4 }
    )

    store.UPDATE_CORE_CONSUMER_COUNT(
      'projection-count-tab',
      { generation: 9, revision: 3 },
      { paragraph: 1, word: 2, character: 3, all: 4 }
    )
    expect(tab.wordCount).toBe(originalCount)

    const nextCount = { paragraph: 2, word: 5, character: 21, all: 26 }
    store.UPDATE_CORE_CONSUMER_COUNT(
      'projection-count-tab',
      { generation: 9, revision: 4 },
      nextCount
    )
    expect(tab.wordCount).toBe(nextCount)
    expect(tab.markdown).toBe('canonical bytes must not cross this seam')
  })

  it('publishes async search only to the exact document revision', () => {
    const store = useEditorStore()
    const originalSearch = { index: -1, matches: [], value: '' }
    const tab = {
      id: 'projection-search-tab',
      markdown: 'unobserved source',
      searchMatches: originalSearch
    }
    store.currentFile = tab as never
    store.tabs = [tab] as never
    store.tabIdToIndex = { 'projection-search-tab': 0 }
    store.REGISTER_CORE_SAVE_IDENTITY(
      'projection-search-tab',
      { generation: 12, revision: 8 }
    )
    const result = {
      index: 0,
      matches: [{ start: 1, end: 3, match: 'bc' }],
      value: 'bc'
    }

    store.UPDATE_CORE_CONSUMER_SEARCH(
      'projection-search-tab',
      { generation: 12, revision: 7 },
      result
    )
    expect(tab.searchMatches).toBe(originalSearch)

    store.UPDATE_CORE_CONSUMER_SEARCH(
      'projection-search-tab',
      { generation: 12, revision: 8 },
      result
    )
    expect(tab.searchMatches).toEqual(result)
    expect(tab.searchMatches).not.toBe(result)
    expect(tab.markdown).toBe('unobserved source')
  })

  it('publishes projection TOC only to the exact document revision', () => {
    const store = useEditorStore()
    const tab = { id: 'projection-toc-tab', markdown: 'unobserved', wordCount: {} }
    store.currentFile = tab as never
    store.tabs = [tab] as never
    store.tabIdToIndex = { 'projection-toc-tab': 0 }
    store.REGISTER_CORE_SAVE_IDENTITY(
      'projection-toc-tab',
      { generation: 5, revision: 3 }
    )

    store.UPDATE_CORE_CONSUMER_TOC(
      'projection-toc-tab',
      { generation: 5, revision: 2 },
      [{ lvl: 1, content: 'stale' }]
    )
    expect(store.listToc).toEqual([])

    store.UPDATE_CORE_CONSUMER_TOC(
      'projection-toc-tab',
      { generation: 5, revision: 3 },
      [{ lvl: 1, content: 'Current' }]
    )
    expect(store.listToc).toEqual([{ lvl: 1, content: 'Current' }])
    expect(tab.markdown).toBe('unobserved')
  })

  it('sends Save the title from the current TOC, not from the saved Markdown', async() => {
    const store = useEditorStore()
    const send = vi.fn()
    window.electron.ipcRenderer.send = send as never
    const tab = {
      id: 'title-tab',
      filename: 'Untitled-1',
      markdown: '# Draft {++new++}\n',
      wordCount: {},
      encoding: { encoding: 'utf8', isBom: false },
      lineEnding: 'lf',
      adjustLineEndingOnSave: false,
      trimTrailingNewline: 2
    }
    store.currentFile = tab as never
    store.tabs = [tab] as never
    store.tabIdToIndex = { 'title-tab': 0 }
    store.REGISTER_CORE_SAVE_IDENTITY('title-tab', { generation: 2, revision: 1 })
    store.UPDATE_CORE_CONSUMER_TOC('title-tab', { generation: 2, revision: 1 }, [
      { lvl: 2, content: 'Second', source: 'Second' },
      { lvl: 1, content: 'Draft new', source: 'Draft new' }
    ])

    await store.FILE_SAVE_AS()
    expect(send.mock.lastCall?.[0]).toBe('mt::response-file-save-as')
    expect(send.mock.lastCall?.[8]).toBe('Draft new')
  })
})
