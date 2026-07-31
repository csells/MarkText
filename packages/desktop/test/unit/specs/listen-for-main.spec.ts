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

// `EDITOR_COMMAND('find-in-folder')` routes through `layoutStore.SET_LAYOUT`,
// which (because `showSideBar` is defined) reads `window.marktext.env`,
// fires `window.electron.ipcRenderer.send`, and persists the sidebar
// visibility preference (another `ipcRenderer.send`). The renderer i18n module
// (pulled in via the preferences store) also reads `window.electron.ipcRenderer`
// at import time. Provide spies for all of it.
const win = window as unknown as {
  electron?: { ipcRenderer: { on: Mock; send: Mock; invoke: Mock } }
  marktext?: { env: { windowId: number } }
}

import {
  EDITOR_COMMAND_IDS
} from '../../../src/shared/types/editorCommands'

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

  it("opens the search side panel for 'find-in-folder'", () => {
    const layoutStore = useLayoutStore()
    expect(layoutStore.rightColumn).toBe('files')
    expect(layoutStore.showSideBar).toBe(false)

    const store = useListenForMainStore()
    store.LISTEN_FOR_EDITOR_COMMAND()
    store.EDITOR_COMMAND('find-in-folder')

    expect(layoutStore.rightColumn).toBe('search')
    expect(layoutStore.showSideBar).toBe(true)
  })

  it('does not mutate the layout for a non-find-in-folder command', () => {
    const layoutStore = useLayoutStore()
    layoutStore.$patch({ rightColumn: 'files', showSideBar: false })

    const store = useListenForMainStore()
    store.LISTEN_FOR_EDITOR_COMMAND()
    store.EDITOR_COMMAND('undo')

    expect(layoutStore.rightColumn).toBe('files')
    expect(layoutStore.showSideBar).toBe(false)
  })

  it('routes the complete command vocabulary to the one bus event', () => {
    const routed: unknown[] = []
    const listener = (value: unknown) => routed.push(value)
    bus.on('editor-command', listener)

    try {
      const store = useListenForMainStore()
      for (const command of EDITOR_COMMAND_IDS) {
        store.EDITOR_COMMAND(command)
      }
      expect(routed).toEqual([...EDITOR_COMMAND_IDS])
    } finally {
      bus.off('editor-command', listener)
    }
  })

  it('rejects an unknown command without emitting an arbitrary bus event', () => {
    const arbitraryListener = vi.fn()
    const commandListener = vi.fn()
    bus.on('attacker-selected-event', arbitraryListener)
    bus.on('editor-command', commandListener)
    const store = useListenForMainStore()
    store.LISTEN_FOR_EDITOR_COMMAND()
    const listener = registeredIpcListener('mt::editor-command')

    try {
      expect(() => listener(undefined, 'attacker-selected-event'))
        .toThrow(TypeError)
      expect(arbitraryListener).not.toHaveBeenCalled()
      expect(commandListener).not.toHaveBeenCalled()
    } finally {
      bus.off('attacker-selected-event', arbitraryListener)
      bus.off('editor-command', commandListener)
    }
  })

  it('rejects every superseded action token instead of translating aliases', () => {
    const commandListener = vi.fn()
    bus.on('editor-command', commandListener)
    const store = useListenForMainStore()
    store.LISTEN_FOR_EDITOR_COMMAND()
    const listener = registeredIpcListener('mt::editor-command')

    try {
      for (const token of [
        'duplicate',
        'createParagraph',
        'deleteParagraph',
        'findNext',
        'findPrev',
        'findInFolder',
        'pasteAsPlainText',
        'selectAll',
        'pre',
        'mathblock',
        'reset-to-paragraph',
        'heading 1',
        'table',
        'stronger',
        'em',
        'u',
        'mark',
        'inline_code',
        'inline_math',
        'del'
      ]) {
        expect(() => listener(undefined, token)).toThrow(TypeError)
      }
      for (const envelope of [
        { type: 'image' },
        { kind: 'request-table' },
        { kind: 'convert-block', conversion: { kind: 'paragraph' } }
      ]) {
        expect(() => listener(undefined, envelope)).toThrow(TypeError)
      }
      expect(commandListener).not.toHaveBeenCalled()
    } finally {
      bus.off('editor-command', commandListener)
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
