import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type * as MuyaCore from '@muyajs/core'

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      fileUtils?: { isSamePathSync: (a: string, b: string) => boolean }
      electron?: { ipcRenderer: { send: Mock; on: Mock } }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
  w.window.electron ??= { ipcRenderer: { send: vi.fn(), on: vi.fn() } }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve(true))
}))
vi.mock('@muyajs/core', async(importOriginal) => {
  const actual = await importOriginal<typeof MuyaCore>()
  return {
    ...actual,
    analyzeMarkdownComments: vi.fn(actual.analyzeMarkdownComments)
  }
})

import { useEditorStore } from '@/store/editor'
import { analyzeMarkdownComments } from '@muyajs/core'

// Characterization tests locking the observable behavior of the dirty-external
// merge store actions that are only transitively covered elsewhere, so the
// extraction of this subsystem into its own module cannot change behavior.
describe('dirty-external-merge store actions — behavior lock', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  const makeDirtyTab = (store: ReturnType<typeof useEditorStore>) => {
    const tab = {
      id: 'tab-1',
      filename: 'a.md',
      pathname: '/x/a.md',
      markdown: 'local edits',
      diskBaseMarkdown: 'base',
      isSaved: false,
      encoding: { encoding: 'utf8', isBom: false },
      lineEnding: 'lf',
      adjustLineEndingOnSave: false,
      trimTrailingNewline: 0,
      isMixedLineEndings: false,
      notifications: [],
      history: { stack: [], index: -1 }
    }
    store.tabs = [tab] as unknown as typeof store.tabs
    store.tabIdToIndex = { 'tab-1': 0 }
    return tab
  }

  const metadata = (body: string): string =>
    `data:application/json;base64,${Buffer.from(
      JSON.stringify({
        version: 1,
        status: 'open',
        replies: [
          {
            author: 'Agent',
            createdAt: '2026-06-30T12:00:00.000Z',
            body
          }
        ]
      })
    ).toString('base64')}`

  it('CREATE_DIRTY_RELOAD_RECOVERY_TAB adds an unsaved tab carrying the source markdown', () => {
    const store = useEditorStore()
    const source = makeDirtyTab(store)

    const recovery = store.CREATE_DIRTY_RELOAD_RECOVERY_TAB(source as never)

    expect(recovery.markdown).toBe('local edits')
    expect(recovery.isSaved).toBe(false)
    expect(store.tabs.some((t) => t.id === (recovery as { id: string }).id)).toBe(true)
    expect(store.tabs.length).toBe(2)
  })

  it('OPEN_DIRTY_EXTERNAL_MERGE_CONFLICT populates mergeConflict with both sides', () => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    const change = {
      pathname: '/x/a.md',
      data: { filename: 'a.md', markdown: 'remote edits' }
    }

    store.OPEN_DIRTY_EXTERNAL_MERGE_CONFLICT(
      tab as never,
      change as never,
      'base',
      'result <<<',
      [] as never
    )

    expect(store.mergeConflict).toMatchObject({
      tabId: 'tab-1',
      pathname: '/x/a.md',
      baseMarkdown: 'base',
      localMarkdown: 'local edits',
      remoteMarkdown: 'remote edits',
      resultMarkdown: 'result <<<'
    })
  })

  it('HANDLE_DIRTY_EXTERNAL_CHANGE rejects a dirty merge without a recorded disk base', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    delete (tab as { diskBaseMarkdown?: string }).diskBaseMarkdown

    await expect(
      store.HANDLE_DIRTY_EXTERNAL_CHANGE(
        tab as never,
        {
          pathname: '/x/a.md',
          data: { filename: 'a.md', markdown: 'remote edits' }
        } as never
      )
    ).rejects.toThrow(/diskBaseMarkdown/)

    expect(tab.markdown).toBe('local edits')
    expect(store.mergeConflict).toBeNull()
  })

  it('RECONCILE_RESTORED_DISK_CHANGES re-handles a tab whose restored disk content diverged', () => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store) as typeof makeDirtyTab extends never
      ? never
      : { restoredDiskDocument?: unknown } & ReturnType<typeof makeDirtyTab>
    ;(tab as { restoredDiskDocument?: unknown }).restoredDiskDocument = {
      filename: 'a.md',
      markdown: 'disk changed'
    }
    const handle = vi.spyOn(store, 'HANDLE_DIRTY_EXTERNAL_CHANGE').mockResolvedValue()

    store.RECONCILE_RESTORED_DISK_CHANGES()

    expect(handle).toHaveBeenCalledTimes(1)
    // The transient restoredDiskDocument marker is consumed.
    expect((tab as { restoredDiskDocument?: unknown }).restoredDiskDocument).toBeUndefined()
  })

  // Regression: diagnostic occurrence keys embedded absolute source offsets,
  // so a clean merge that merely shifted a pre-existing diagnostic escalated
  // to the resolver dialog even though no new comment defect was introduced.
  it('HANDLE_DIRTY_EXTERNAL_CHANGE auto-merges when a pre-existing diagnostic only shifts offsets', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    const orphan = `[MC:zz]: ${metadata('Stale note.')}`
    tab.diskBaseMarkdown = `one\nshared\nthree\n\n${orphan}\n`
    tab.markdown = `one\nlocal\nthree\n\n${orphan}\n`
    store.currentFile = tab as unknown as typeof store.currentFile

    await store.HANDLE_DIRTY_EXTERNAL_CHANGE(
      tab as never,
      {
        pathname: '/x/a.md',
        data: {
          filename: 'a.md',
          pathname: '/x/a.md',
          markdown: `zero\none\nshared\nthree\n\n${orphan}\n`
        }
      } as never
    )

    expect(store.mergeConflict).toBeNull()
    expect(tab.markdown).toBe(`zero\none\nlocal\nthree\n\n${orphan}\n`)
    expect(tab.isSaved).toBe(false)
  })

  it('HANDLE_DIRTY_EXTERNAL_CHANGE compares comment diagnostics through the authoritative analyzer', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nlocal\nthree\n'
    store.OPEN_DIRTY_EXTERNAL_MERGE_CONFLICT(
      tab as never,
      {
        pathname: '/x/a.md',
        data: {
          filename: 'a.md',
          pathname: '/x/a.md',
          markdown: 'one\nremote\nthree\n'
        }
      } as never,
      tab.diskBaseMarkdown,
      'one\n<<<<<<< MARKTEXT_LOCAL\nlocal\n=======\nremote\n>>>>>>> MARKTEXT_REMOTE\nthree\n',
      [] as never
    )

    store.ACCEPT_DIRTY_EXTERNAL_MERGE_CONFLICT(
      'one\n<!--MC:missing-->commented<!--MC:~missing-->\nthree\n'
    )

    expect(analyzeMarkdownComments).toHaveBeenCalled()
  })
})
