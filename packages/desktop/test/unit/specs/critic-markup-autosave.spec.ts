import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// `@/store/editor` reads `window.path` at module load and `window.electron`
// at runtime; stub those surfaces before the hoisted imports run (mirrors
// flush-before-save.spec.ts).
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      electron?: {
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: {
          send: (...a: unknown[]) => void
          on: (...a: unknown[]) => void
          invoke: (...a: unknown[]) => Promise<unknown>
        }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {}, invoke: async() => false }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { useCriticMarkupReviewStore } from '@/store/criticMarkupReview'
import { getOptionsFromState } from '@/store/help'
import { CRITIC_MARKUP_CORPUS } from '../../../../muya/src/criticMarkup/__tests__/sharedCorpus'
import type { CriticMarkupProjection } from '@shared/types/criticMarkup'

// Wave 5: autosave must persist the canonical CriticMarkup source. The
// engine's `json-change` payload always carries `muya.getMarkdown()` — the
// canonical Critic source, independent of the active display projection
// (proven at the engine boundary by muya's consumer-parity suite). These
// tests prove the DESKTOP autosave pipeline (LISTEN_FOR_CONTENT_CHANGE →
// HANDLE_AUTO_SAVE → `mt::response-file-save`) is a byte-identity transport
// for that payload and consults nothing from the Review projection state, so
// an active Original/Revised view can never leak projected text into the
// autosaved file.

const CRITIC_ROW = CRITIC_MARKUP_CORPUS.find((row) => row.id === 'all-five-canonical-forms')
if (!CRITIC_ROW) {
  throw new TypeError('Shared CriticMarkup corpus row all-five-canonical-forms is missing.')
}

const CANONICAL = CRITIC_ROW.source
const PROJECTED: Record<string, string> = {
  original: CRITIC_ROW.expected.original,
  revised: CRITIC_ROW.expected.revised
}
const STALE = 'A {++new++} pending autosave baseline.\n'
const MARKDOWN_ARG = 4 // send(channel, id, filename, pathname, markdown, options, defaultPath)
const OPTIONS_ARG = 5
const AUTO_SAVE_DELAY = 100

function seedCriticTab(store: ReturnType<typeof useEditorStore>) {
  const tab = {
    id: 'tab-1',
    filename: 'review.md',
    pathname: '/tmp/review.md',
    markdown: STALE,
    isSaved: true,
    encoding: { encoding: 'utf8', isBom: false },
    lineEnding: 'lf',
    adjustLineEndingOnSave: false,
    // 2 = "keep the text exactly as the engine serialized it"
    // (adjustTrailingNewlines' disabled branch) so every comparison below is
    // an exact byte comparison.
    trimTrailingNewline: 2,
    history: { stack: [], index: -1 },
    lastSavedHistoryId: 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
  store.tabs = [tab]
  store.tabIdToIndex = { 'tab-1': 0 }
  store.currentFile = store.tabs[0]
  return store.tabs[0]
}

function armAutoSave() {
  const preferencesStore = usePreferencesStore()
  preferencesStore.autoSave = true
  preferencesStore.autoSaveDelay = AUTO_SAVE_DELAY
}

function activateProjection(projection: CriticMarkupProjection) {
  useCriticMarkupReviewStore().UPDATE({
    fileId: 'tab-1',
    available: true,
    items: [],
    currentItemId: null,
    trackChanges: true,
    projection
  })
}

describe('editor store — autosave writes canonical CriticMarkup bytes', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['marked', 'original', 'revised'] as const)(
    'autosaves the canonical Critic document while the %s projection is active',
    (projection) => {
      const store = useEditorStore()
      armAutoSave()
      seedCriticTab(store)
      activateProjection(projection)
      const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

      store.LISTEN_FOR_CONTENT_CHANGE({ id: 'tab-1', markdown: CANONICAL })

      // Autosave is deferred behind autoSaveDelay — nothing may be sent yet.
      expect(
        sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save')
      ).toBeUndefined()

      vi.advanceTimersByTime(AUTO_SAVE_DELAY)

      const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save')
      expect(call).toBeDefined()
      expect(call?.[MARKDOWN_ARG]).toBe(CANONICAL)
      // Every raw Critic marker survives in the autosaved bytes …
      for (const raw of CRITIC_ROW.expected.itemRaw) {
        expect(call?.[MARKDOWN_ARG]).toContain(raw)
      }
      // … and the visible projected text never replaces them.
      if (projection !== 'marked') {
        expect(call?.[MARKDOWN_ARG]).not.toBe(PROJECTED[projection])
      }
    }
  )

  it('transports the tab persistence options unchanged alongside the canonical bytes', () => {
    const store = useEditorStore()
    armAutoSave()
    const tab = seedCriticTab(store)
    activateProjection('revised')
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.LISTEN_FOR_CONTENT_CHANGE({ id: 'tab-1', markdown: CANONICAL })
    vi.advanceTimersByTime(AUTO_SAVE_DELAY)

    const call = sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save')
    expect(call).toBeDefined()
    // The main process re-applies BOM/line-ending bookkeeping from exactly
    // these options; the projection state must not perturb them either.
    expect(call?.[OPTIONS_ARG]).toEqual(getOptionsFromState(tab))
  })

  it('does not autosave when the deferred timer finds the tab already saved', () => {
    const store = useEditorStore()
    armAutoSave()
    seedCriticTab(store)
    activateProjection('original')
    const sendSpy = vi.spyOn(window.electron.ipcRenderer, 'send')

    store.LISTEN_FOR_CONTENT_CHANGE({ id: 'tab-1', markdown: CANONICAL })
    // An explicit save (or main-process ack) can land before the deferred
    // autosave fires; the timer must then skip the redundant write.
    if (store.currentFile) store.currentFile.isSaved = true
    vi.advanceTimersByTime(AUTO_SAVE_DELAY)

    expect(
      sendSpy.mock.calls.find((c) => c[0] === 'mt::response-file-save')
    ).toBeUndefined()
  })
})
