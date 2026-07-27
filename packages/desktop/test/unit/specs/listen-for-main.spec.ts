import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// `listenForMain` pulls in the layout store, which transitively imports the
// preferences store and `@/config` (the latter reads `window.path.sep` at
// module load). Stub the contextBridge surfaces before the hoisted imports run
// so the store graph can load.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: { path?: { sep: string } }
    localStorage?: { getItem: () => null; setItem: () => void }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/' }
  w.localStorage ??= { getItem: () => null, setItem: () => {} }
})

import { useListenForMainStore } from '@/store/listenForMain'
import { useLayoutStore } from '@/store/layout'
import bus from '@/bus'

// `EDITOR_EDIT_ACTION('findInFolder')` routes through `layoutStore.SET_LAYOUT`,
// which (because `showSideBar` is defined) reads `window.marktext.env`,
// fires `window.electron.ipcRenderer.send`, and persists the sidebar
// visibility preference (another `ipcRenderer.send`). The renderer i18n module
// (pulled in via the preferences store) also reads `window.electron.ipcRenderer`
// at import time. Provide spies for all of it.
const win = window as unknown as {
  electron?: { ipcRenderer: { on: Mock; send: Mock; invoke: Mock } }
  marktext?: { env: { windowId: number } }
}

const EDIT_ACTIONS = [
  'undo',
  'redo',
  'copyAsRich',
  'copyAsHtml',
  'pasteAsPlainText',
  'selectAll',
  'duplicate',
  'createParagraph',
  'deleteParagraph',
  'find',
  'findNext',
  'findPrev',
  'replace',
  'findInFolder'
] as const

const PARAGRAPH_ACTIONS = [
  'ul-bullet',
  'pre',
  'degrade heading',
  'front-matter',
  'heading 1',
  'heading 2',
  'heading 3',
  'heading 4',
  'heading 5',
  'heading 6',
  'hr',
  'html',
  'loose-list-item',
  'mathblock',
  'ol-order',
  'paragraph',
  'blockquote',
  'table',
  'ul-task',
  'upgrade heading'
] as const

const INLINE_FORMAT_ACTIONS = [
  'clear',
  'em',
  'mark',
  'link',
  'image',
  'inline_code',
  'inline_math',
  'del',
  'strong',
  'sub',
  'sup',
  'u'
] as const

const registeredIpcListener = (
  channel: string
): ((event: unknown, payload: unknown) => void) => {
  const registration = win.electron?.ipcRenderer.on.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel
  )
  expect(registration).toBeDefined()
  const listener: unknown = registration?.[1]
  if (typeof listener !== 'function') {
    throw new Error(`No renderer listener was registered for ${channel}`)
  }
  return listener as (event: unknown, payload: unknown) => void
}

describe('listenForMain command boundary', () => {
  beforeEach(() => {
    win.electron = {
      ipcRenderer: {
        on: vi.fn(),
        send: vi.fn(),
        invoke: vi.fn(() => Promise.resolve(false))
      }
    }
    win.marktext = { env: { windowId: 1 } }
    setActivePinia(createPinia())
  })

  afterEach(() => {
    delete win.electron
    delete win.marktext
    vi.clearAllMocks()
  })

  it("opens the search side panel for 'findInFolder'", () => {
    const layoutStore = useLayoutStore()
    expect(layoutStore.rightColumn).toBe('files')
    expect(layoutStore.showSideBar).toBe(false)

    useListenForMainStore().EDITOR_EDIT_ACTION('findInFolder')

    expect(layoutStore.rightColumn).toBe('search')
    expect(layoutStore.showSideBar).toBe(true)
  })

  it('does not mutate the layout for a non-findInFolder action', () => {
    const layoutStore = useLayoutStore()
    layoutStore.$patch({ rightColumn: 'files', showSideBar: false })

    useListenForMainStore().EDITOR_EDIT_ACTION('undo')

    expect(layoutStore.rightColumn).toBe('files')
    expect(layoutStore.showSideBar).toBe(false)
  })

  it('routes every supported edit action to its named bus event', () => {
    const routed: Array<readonly [string, unknown]> = []
    const listeners = EDIT_ACTIONS.map(action => {
      const listener = (value: unknown) => routed.push([action, value])
      bus.on(action, listener)
      return { action, listener }
    })

    try {
      const store = useListenForMainStore()
      for (const action of EDIT_ACTIONS) {
        store.EDITOR_EDIT_ACTION(action)
      }
      expect(routed).toEqual(
        EDIT_ACTIONS.map(action => [action, action])
      )
    } finally {
      for (const { action, listener } of listeners) {
        bus.off(action, listener)
      }
    }
  })

  it('rejects an unknown main edit action without emitting an arbitrary bus event', () => {
    const arbitraryListener = vi.fn()
    bus.on('attacker-selected-event', arbitraryListener)
    const store = useListenForMainStore()
    store.LISTEN_FOR_EDIT()
    const listener = registeredIpcListener('mt::editor-edit-action')

    try {
      expect(() => listener(undefined, 'attacker-selected-event'))
        .toThrow(TypeError)
      expect(arbitraryListener).not.toHaveBeenCalled()
    } finally {
      bus.off('attacker-selected-event', arbitraryListener)
    }
  })

  it('rejects a paragraph action envelope with extra fields before routing it', () => {
    const paragraphListener = vi.fn()
    bus.on('paragraph', paragraphListener)
    const store = useListenForMainStore()
    store.LISTEN_FOR_PARAGRAPH_INLINE_STYLE()
    const listener = registeredIpcListener('mt::editor-paragraph-action')

    try {
      expect(() => listener(undefined, {
        type: 'paragraph',
        extra: true
      })).toThrow(TypeError)
      expect(paragraphListener).not.toHaveBeenCalled()
    } finally {
      bus.off('paragraph', paragraphListener)
    }
  })

  it('routes the complete supported paragraph-action vocabulary', () => {
    const routed: unknown[] = []
    const paragraphListener = (value: unknown) => routed.push(value)
    bus.on('paragraph', paragraphListener)
    const store = useListenForMainStore()
    store.LISTEN_FOR_PARAGRAPH_INLINE_STYLE()
    const listener = registeredIpcListener('mt::editor-paragraph-action')

    try {
      for (const action of PARAGRAPH_ACTIONS) {
        listener(undefined, { type: action })
      }
      expect(routed).toEqual(PARAGRAPH_ACTIONS)
    } finally {
      bus.off('paragraph', paragraphListener)
    }
  })

  it('rejects a near-miss inline-format discriminator before routing it', () => {
    const formatListener = vi.fn()
    bus.on('format', formatListener)
    const store = useListenForMainStore()
    store.LISTEN_FOR_PARAGRAPH_INLINE_STYLE()
    const listener = registeredIpcListener('mt::editor-format-action')

    try {
      expect(() => listener(undefined, { type: 'stronger' }))
        .toThrow(TypeError)
      expect(formatListener).not.toHaveBeenCalled()
    } finally {
      bus.off('format', formatListener)
    }
  })

  it('routes the complete supported inline-format vocabulary', () => {
    const routed: unknown[] = []
    const formatListener = (value: unknown) => routed.push(value)
    bus.on('format', formatListener)
    const store = useListenForMainStore()
    store.LISTEN_FOR_PARAGRAPH_INLINE_STYLE()
    const listener = registeredIpcListener('mt::editor-format-action')

    try {
      for (const action of INLINE_FORMAT_ACTIONS) {
        listener(undefined, { type: action })
      }
      expect(routed).toEqual(INLINE_FORMAT_ACTIONS)
    } finally {
      bus.off('format', formatListener)
    }
  })

  it('rejects an unsupported export-dialog action before routing it', () => {
    const exportListener = vi.fn()
    bus.on('showExportDialog', exportListener)
    const store = useListenForMainStore()
    store.LISTEN_FOR_SHOW_DIALOG()
    const listener = registeredIpcListener('mt::show-export-dialog')

    try {
      expect(() => listener(undefined, 'pdf-preview')).toThrow(TypeError)
      expect(exportListener).not.toHaveBeenCalled()
    } finally {
      bus.off('showExportDialog', exportListener)
    }
  })

  it('routes only the three supported export-dialog actions', () => {
    const routed: unknown[] = []
    const exportListener = (value: unknown) => routed.push(value)
    bus.on('showExportDialog', exportListener)
    const store = useListenForMainStore()
    store.LISTEN_FOR_SHOW_DIALOG()
    const listener = registeredIpcListener('mt::show-export-dialog')

    try {
      for (const action of ['pdf', 'styledHtml', 'print'] as const) {
        listener(undefined, action)
      }
      expect(routed).toEqual(['pdf', 'styledHtml', 'print'])
    } finally {
      bus.off('showExportDialog', exportListener)
    }
  })
})
