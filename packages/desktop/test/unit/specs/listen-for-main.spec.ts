import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// `listenForMain` pulls in the layout store, which transitively imports the
// preferences store and `@/config` (the latter reads `window.path.sep` at
// module load). Stub the contextBridge surfaces before the hoisted imports run
// so the store graph can load.
vi.hoisted(() => {
  const w = globalThis as unknown as { window?: { path?: { sep: string } } }
  w.window ??= {}
  w.window.path ??= { sep: '/' }
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

describe('listenForMain store EDITOR_EDIT_ACTION', () => {
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
    document.body.replaceChildren()
    delete win.electron
    delete win.marktext
    vi.restoreAllMocks()
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

    useListenForMainStore().EDITOR_EDIT_ACTION('insertParagraph')

    expect(layoutStore.rightColumn).toBe('files')
    expect(layoutStore.showSideBar).toBe(false)
  })

  for (const action of ['undo', 'redo'] as const) {
    for (const control of ['input', 'textarea'] as const) {
      for (const caller of ['main IPC', 'renderer command'] as const) {
        it(`${caller} ${action} belongs to the focused ${control}, even with no native history`, () => {
          const field = document.createElement(control)
          document.body.append(field)
          field.focus()
          const nativeHistory = vi.fn(() => false)
          Object.defineProperty(document, 'execCommand', {
            configurable: true,
            value: nativeHistory
          })
          const documentHistory = vi.fn()
          bus.on(action, documentHistory)
          const store = useListenForMainStore()
          store.LISTEN_FOR_EDIT()
          try {
            if (caller === 'main IPC') {
              const listener = win.electron?.ipcRenderer.on.mock.calls.find(
                ([channel]) => channel === 'mt::editor-edit-action'
              )?.[1]
              expect(listener).toBeTypeOf('function')
              listener({}, action)
            } else {
              bus.emit('mt::editor-edit-action', action)
            }
            expect(nativeHistory).toHaveBeenCalledExactlyOnceWith(action)
            expect(documentHistory).not.toHaveBeenCalled()
          } finally {
            bus.off(action, documentHistory)
            bus.all.delete('mt::editor-edit-action')
            delete (document as unknown as { execCommand?: unknown }).execCommand
          }
        })
      }
    }

    for (const surface of ['markup', 'source'] as const) {
      it(`${surface} ${action} retains the document history owner`, () => {
        const container = document.createElement('div')
        container.className = surface === 'source' ? 'CodeMirror' : 'muya-content'
        const field = document.createElement(surface === 'source' ? 'textarea' : 'div')
        field.setAttribute('contenteditable', 'true')
        field.tabIndex = 0
        container.append(field)
        document.body.append(container)
        field.focus()
        const documentHistory = vi.fn()
        bus.on(action, documentHistory)
        try {
          useListenForMainStore().EDITOR_EDIT_ACTION(action)
          expect(documentHistory).toHaveBeenCalledExactlyOnceWith(action)
        } finally {
          bus.off(action, documentHistory)
        }
      })
    }
  }
})
