import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

// Real-mount component spec per specs/architecture/test-infrastructure.md:
// search/index.vue is mounted with @vue/test-utils, store state is arranged
// through real Pinia, the find bar opens the way the app opens it (the
// 'find' bus event), and the regression is asserted on the rendered input.
//
// The regression: the find-bar prefill race (the input showed a stale single
// char like "T" instead of the selection). `watch(searchMatches)` mirrors the
// editor selection into the input, but when the find bar opens it steals
// focus and the engine emits a spurious selection-change pointing at the
// document start, which used to clobber the just-prefilled value.

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      fileUtils?: { isSamePathSync: (a: string, b: string) => boolean }
      electron?: { ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void } }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
  w.window.electron ??= { ipcRenderer: { send: () => {}, on: () => {} } }
})

vi.mock('@/services/notification', () => ({ default: { notify: vi.fn(), name: 'notify' } }))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve(true))
}))
vi.mock(import('vue-i18n'), async(importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useI18n: (() => ({ t: (key: string) => key })) as unknown as typeof actual.useI18n
  }
})

import SearchBar from '@/components/search/index.vue'
import bus from '@/bus'
import { useEditorStore } from '@/store/editor'

type SearchMatches = { matches: unknown[]; index: number; value: string }

const mountSearchBar = () => {
  setActivePinia(createPinia())
  const editorStore = useEditorStore()
  editorStore.currentFile = {
    id: 'tab-1',
    searchMatches: { matches: [], index: -1, value: '' }
  } as unknown as typeof editorStore.currentFile

  const wrapper = mount(SearchBar, {
    global: {
      stubs: {
        // Third-party UI boundary: element-plus renders its own DOM; the
        // behaviors under test live in the input and the v-show state.
        'el-icon': { template: '<i><slot /></i>' },
        'el-tooltip': { template: '<span><slot /></span>' },
        'el-button': { template: '<button><slot /></button>' }
      }
    },
    attachTo: document.body
  })

  const setSelection = async(value: string) => {
    const file = editorStore.currentFile as unknown as { searchMatches: SearchMatches }
    file.searchMatches = { matches: [], index: -1, value }
    await nextTick()
  }

  return { wrapper, setSelection }
}

const searchInput = (wrapper: VueWrapper): HTMLInputElement =>
  wrapper.find('input[type="text"]').element as HTMLInputElement

describe('find-bar prefill from selection', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('prefills the input with the selected text when the bar opens', async() => {
    const mounted = mountSearchBar()
    wrapper = mounted.wrapper

    await mounted.setSelection('fox')
    bus.emit('find')
    await nextTick()

    expect(searchInput(mounted.wrapper).value).toBe('fox')
    expect((mounted.wrapper.find('.search-bar').element as HTMLElement).style.display).not.toBe(
      'none'
    )
  })

  it('does not let the focus-steal selection-change clobber the prefill', async() => {
    const mounted = mountSearchBar()
    wrapper = mounted.wrapper

    // User selects a word in the editor.
    await mounted.setSelection('fox')
    // Find bar opens (prefills "fox") and steals focus.
    bus.emit('find')
    await nextTick()
    expect(searchInput(mounted.wrapper).value).toBe('fox')

    // Opening the bar steals editor focus → the engine emits a spurious
    // selection-change pointing at the document start ("T"). It must NOT
    // overwrite the prefilled query now that the bar owns it.
    await mounted.setSelection('T')
    await nextTick()

    expect(
      (mounted.wrapper.find('.search-bar').element as HTMLElement).style.display
    ).not.toBe('none')
    expect(searchInput(mounted.wrapper).value).toBe('fox')
  })
})
