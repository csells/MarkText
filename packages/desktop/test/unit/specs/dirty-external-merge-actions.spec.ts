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

  // The initial-merge escalation gate: a CLEAN line merge whose combined
  // output introduces a comment defect neither side had (here: both sides
  // independently added a comment with the same id in disjoint regions) must
  // open the resolver instead of silently auto-applying a corrupted document.
  it('HANDLE_DIRTY_EXTERNAL_CHANGE escalates a clean merge that introduces new comment diagnostics', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    const localDef = `[MC:x]: ${metadata('Local note.')}`
    const remoteDef = `[MC:x]: ${metadata('Agent note.')}`
    tab.diskBaseMarkdown = 'aaa\nbbb\nccc\nddd\neee\n'
    tab.markdown = `<!--MC:x-->aaa<!--MC:~x-->\n${localDef}\nccc\nddd\neee\n`
    store.currentFile = tab as unknown as typeof store.currentFile

    await store.HANDLE_DIRTY_EXTERNAL_CHANGE(
      tab as never,
      {
        pathname: '/x/a.md',
        data: {
          filename: 'a.md',
          pathname: '/x/a.md',
          markdown: `aaa\nbbb\nccc\n<!--MC:x-->ddd<!--MC:~x-->\n${remoteDef}\n`
        }
      } as never
    )

    // The user's buffer is untouched and the resolver is open on the clean
    // (conflict-free) but comment-corrupting merge output.
    expect(tab.markdown).toBe(`<!--MC:x-->aaa<!--MC:~x-->\n${localDef}\nccc\nddd\neee\n`)
    expect(tab.isSaved).toBe(false)
    expect(store.mergeConflict).not.toBeNull()
    expect(store.mergeConflict!.conflicts).toEqual([])
    expect(store.mergeConflict!.resultMarkdown).toContain('<!--MC:x-->aaa<!--MC:~x-->')
    expect(store.mergeConflict!.resultMarkdown).toContain('<!--MC:x-->ddd<!--MC:~x-->')
  })

  it('ACCEPT applies a hand-corrected result after the escalation and clears the session', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    const localDef = `[MC:x]: ${metadata('Local note.')}`
    const remoteDefY = `[MC:y]: ${metadata('Agent note.')}`
    tab.diskBaseMarkdown = 'aaa\nbbb\nccc\nddd\neee\n'
    tab.markdown = `<!--MC:x-->aaa<!--MC:~x-->\n${localDef}\nccc\nddd\neee\n`
    store.currentFile = tab as unknown as typeof store.currentFile

    await store.HANDLE_DIRTY_EXTERNAL_CHANGE(
      tab as never,
      {
        pathname: '/x/a.md',
        data: {
          filename: 'a.md',
          pathname: '/x/a.md',
          markdown: `aaa\nbbb\nccc\n<!--MC:x-->ddd<!--MC:~x-->\n[MC:x]: ${metadata('Agent note.')}\n`
        }
      } as never
    )
    expect(store.mergeConflict).not.toBeNull()

    // The user renames the agent's duplicate id in the result pane and accepts.
    const corrected = `<!--MC:x-->aaa<!--MC:~x-->\n${localDef}\nccc\n<!--MC:y-->ddd<!--MC:~y-->\n${remoteDefY}\n`
    store.ACCEPT_DIRTY_EXTERNAL_MERGE_CONFLICT(corrected)

    expect(store.mergeConflict).toBeNull()
    expect(tab.markdown).toBe(corrected)
    expect(tab.isSaved).toBe(false)
  })

  // Two watcher events can be in flight at once (agents write fast). The
  // FIRST merge result is stale by the time it resolves and must be dropped,
  // or the newest disk content would be overwritten by the older merge.
  it('HANDLE_DIRTY_EXTERNAL_CHANGE drops a superseded in-flight merge (second watcher event wins)', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nlocal\nthree\n'
    store.currentFile = tab as unknown as typeof store.currentFile

    const changeFor = (markdown: string) =>
      ({
        pathname: '/x/a.md',
        data: { filename: 'a.md', pathname: '/x/a.md', markdown }
      }) as never

    // Fire both before awaiting either: the second supersedes the first
    // while the first merge is still in flight.
    const first = store.HANDLE_DIRTY_EXTERNAL_CHANGE(tab as never, changeFor('ONE\nshared\nthree\n'))
    const second = store.HANDLE_DIRTY_EXTERNAL_CHANGE(tab as never, changeFor('one\nshared\nTHREE\n'))
    await Promise.all([first, second])

    expect(store.mergeConflict).toBeNull()
    expect(tab.markdown).toBe('one\nlocal\nTHREE\n')
    expect(tab.diskBaseMarkdown).toBe('one\nshared\nTHREE\n')
    expect(tab.isSaved).toBe(false)
  })

  it('HANDLE_DIRTY_EXTERNAL_CHANGE drops a merge whose tab was closed mid-flight', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nlocal\nthree\n'
    store.currentFile = tab as unknown as typeof store.currentFile

    const pending = store.HANDLE_DIRTY_EXTERNAL_CHANGE(
      tab as never,
      {
        pathname: '/x/a.md',
        data: { filename: 'a.md', pathname: '/x/a.md', markdown: 'one\nshared\nTHREE\n' }
      } as never
    )
    // The user closes the tab while the merge is in flight.
    store.tabs = [] as unknown as typeof store.tabs
    store.tabIdToIndex = {}
    store.currentFile = null as unknown as typeof store.currentFile
    await pending

    expect(store.mergeConflict).toBeNull()
    // The closed tab's buffer is left untouched — nothing was applied.
    expect(tab.markdown).toBe('one\nlocal\nthree\n')
    expect(tab.notifications).toEqual([])
  })

  // Session liveness: a merge-conflict session captures snapshots (base,
  // local, remote). Any superseding event — a newer disk change, a save that
  // advances the base, a buffer edit — must invalidate the session instead of
  // letting Accept/Reload apply stale content over newer reality.
  const openConflictSession = (store: ReturnType<typeof useEditorStore>, tab: ReturnType<typeof makeDirtyTab>) => {
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nlocal\nthree\n'
    store.OPEN_DIRTY_EXTERNAL_MERGE_CONFLICT(
      tab as never,
      {
        pathname: '/x/a.md',
        data: { filename: 'a.md', pathname: '/x/a.md', markdown: 'one\nremote\nthree\n' }
      } as never,
      tab.diskBaseMarkdown,
      'one\n<<<<<<< MARKTEXT_LOCAL\nlocal\n=======\nremote\n>>>>>>> MARKTEXT_REMOTE\nthree\n',
      [] as never
    )
  }

  it('ACCEPT refuses a session whose local buffer moved and re-derives against the new buffer', () => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    openConflictSession(store, tab)

    // The buffer changed under the open dialog (background edit).
    tab.markdown = 'one\nlocal EDITED\nthree\n'

    store.ACCEPT_DIRTY_EXTERNAL_MERGE_CONFLICT('one\nremote\nthree\n')

    // The stale result was NOT applied.
    expect(tab.markdown).toBe('one\nlocal EDITED\nthree\n')
    expect(tab.diskBaseMarkdown).toBe('one\nshared\nthree\n')
  })

  it('ACCEPT refuses a session whose disk base advanced (save happened) and closes it', () => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    openConflictSession(store, tab)

    // A save advanced the base: the on-disk agent write this session was
    // resolving no longer exists.
    tab.diskBaseMarkdown = tab.markdown
    tab.isSaved = true

    store.ACCEPT_DIRTY_EXTERNAL_MERGE_CONFLICT('one\nremote\nthree\n')

    expect(store.mergeConflict).toBeNull()
    expect(tab.markdown).toBe('one\nlocal\nthree\n')
    expect(tab.diskBaseMarkdown).toBe('one\nlocal\nthree\n')
  })

  it('a newer disk change supersedes an open session instead of acting beneath it', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    openConflictSession(store, tab)
    const firstSession = store.mergeConflict!.session

    await store.HANDLE_DIRTY_EXTERNAL_CHANGE(
      tab as never,
      {
        pathname: '/x/a.md',
        data: { filename: 'a.md', pathname: '/x/a.md', markdown: 'one\nshared\nthree NEWER\n' }
      } as never
    )

    // The session was re-derived against the newest remote — not auto-applied
    // beneath the open modal, not left stale.
    expect(store.mergeConflict).not.toBeNull()
    expect(store.mergeConflict!.remoteMarkdown).toBe('one\nshared\nthree NEWER\n')
    expect(store.mergeConflict!.session).not.toBe(firstSession)
    expect(tab.markdown).toBe('one\nlocal\nthree\n')
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
