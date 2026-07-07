import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The editor store's `addCommentEnabled` field is the ONLY renderer copy of
// the Add Comment commentability bit: SELECTION_CHANGE assigns it from the
// engine predicate, and the command palette reads it back. (Source mode
// writes the same field and mirrors it to main over IPC; main keeps its own
// per-window map as the single main-process copy.)

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      marktext?: { env: { windowId: number } }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.marktext ??= { env: { windowId: 1 } }
  w.window.electron ??= { clipboard: { writeText: () => {} }, ipcRenderer: { send: () => {}, on: () => {} } }
})

vi.mock('@/services/notification', () => ({ default: { notify: vi.fn(), name: 'notify' } }))

const { useEditorStore } = await import('@/store/editor')
const { isAddCommentCommandEnabled } = await import('@/commands')

const selectionFor = (canAddComment: boolean) => ({
  start: { key: 'a', offset: 2, type: 'span', block: { functionType: 'paragraphContent', text: 'A reviewed span.' } },
  end: { key: 'a', offset: 10, type: 'span', block: { functionType: 'paragraphContent', text: 'A reviewed span.' } },
  canAddComment,
  affiliation: [{ type: 'p', blockName: 'paragraph' }]
})

describe('add comment capability — single store field', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('SELECTION_CHANGE assigns the store field from the engine predicate', () => {
    const store = useEditorStore()

    store.SELECTION_CHANGE(selectionFor(true) as never)
    expect(store.addCommentEnabled).toBe(true)

    store.SELECTION_CHANGE(selectionFor(false) as never)
    expect(store.addCommentEnabled).toBe(false)
  })

  it('the command palette predicate reads the store field', () => {
    const store = useEditorStore()

    store.SELECTION_CHANGE(selectionFor(true) as never)
    expect(isAddCommentCommandEnabled()).toBe(true)

    store.SELECTION_CHANGE(selectionFor(false) as never)
    expect(isAddCommentCommandEnabled()).toBe(false)
  })
})
