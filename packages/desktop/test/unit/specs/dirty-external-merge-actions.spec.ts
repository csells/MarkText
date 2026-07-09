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

  it('HANDLE_DIRTY_EXTERNAL_CHANGE routes a dirty merge without a recorded base to the resolver', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    delete (tab as { diskBaseMarkdown?: string }).diskBaseMarkdown

    await store.HANDLE_DIRTY_EXTERNAL_CHANGE(
      tab as never,
      {
        pathname: '/x/a.md',
        data: { filename: 'a.md', pathname: '/x/a.md', markdown: 'remote edits' }
      } as never
    )

    expect(tab.markdown).toBe('local edits')
    expect(store.mergeConflict).not.toBeNull()
    expect(store.mergeConflict!.conflicts.length).toBeGreaterThan(0)
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

  it('an accepted resolution does not push the auto-merged Undo/Review notification', () => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    openConflictSession(store, tab)

    store.ACCEPT_DIRTY_EXTERNAL_MERGE_CONFLICT('one\nresolved\nthree\n')

    expect(store.mergeConflict).toBeNull()
    expect(tab.markdown).toBe('one\nresolved\nthree\n')
    expect(tab.isSaved).toBe(false)
    // The user just resolved this merge by hand; offering to Undo/Review the
    // merge again is noise.
    expect(tab.notifications).toEqual([])
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

  it('a legacy dirty tab with no recorded base opens the whole-file resolver, never auto-applies', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    // Legacy session restore: dirty buffer, no recorded merge base.
    delete (tab as { diskBaseMarkdown?: string }).diskBaseMarkdown
    tab.markdown = 'local dirty content\n'
    store.currentFile = tab as unknown as typeof store.currentFile

    await store.HANDLE_DIRTY_EXTERNAL_CHANGE(
      tab as never,
      {
        pathname: '/x/a.md',
        data: { filename: 'a.md', pathname: '/x/a.md', markdown: 'disk content\n' }
      } as never
    )

    expect(tab.markdown).toBe('local dirty content\n')
    expect(tab.isSaved).toBe(false)
    expect(store.mergeConflict).not.toBeNull()
    expect(store.mergeConflict!.conflicts.length).toBeGreaterThan(0)
    expect(store.mergeConflict!.resultMarkdown).toContain('local dirty content')
    expect(store.mergeConflict!.resultMarkdown).toContain('disk content')
  })

  // F4(a): a save while a resolver is open must go through the REDUCER, not
  // close the dialog behind its back. external-merge.md §The session reducer:
  // `saved` while reviewing marks the session base-superseded, so the dialog
  // stays open and the next Accept closes the dead session rather than
  // applying disk content that no longer exists.
  it('a save while reviewing supersedes the session; the next Accept closes without applying', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    delete (tab as { diskBaseMarkdown?: string }).diskBaseMarkdown
    tab.markdown = 'local dirty content\n'
    store.currentFile = tab as unknown as typeof store.currentFile

    await store.HANDLE_DIRTY_EXTERNAL_CHANGE(
      tab as never,
      {
        pathname: '/x/a.md',
        data: { filename: 'a.md', pathname: '/x/a.md', markdown: 'disk content\n' }
      } as never
    )
    expect(store.mergeConflict).not.toBeNull()

    // The user saves their buffer while the resolver is open — main echoes the
    // written bytes on mt::tab-saved.
    store.LISTEN_FOR_SET_PATHNAME()
    const onMock = window.electron.ipcRenderer.on as unknown as {
      mock: { calls: Array<[string, (e: unknown, ...args: unknown[]) => void]> }
    }
    const saved = onMock.mock.calls.find(([channel]) => channel === 'mt::tab-saved')
    if (!saved) throw new Error('mt::tab-saved handler not registered')
    saved[1](null, tab.id, 'local dirty content\n')

    // The base advanced and the tab is clean, but the resolver stays open
    // (base-superseded) — it did NOT close eagerly.
    expect(tab.diskBaseMarkdown).toBe('local dirty content\n')
    expect(store.mergeConflict).not.toBeNull()

    // Accept on the superseded session closes it WITHOUT applying stale disk
    // content over the saved buffer.
    store.ACCEPT_DIRTY_EXTERNAL_MERGE_CONFLICT('disk content\n')
    expect(store.mergeConflict).toBeNull()
    expect(tab.markdown).toBe('local dirty content\n')
  })

  // Regression: accepting the whole-file session a no-base tab opens used to
  // throw (requireDiskBaseMarkdown ran unconditionally on the apply path)
  // AFTER the resolver had already closed — silently discarding the user's
  // hand-resolved result.
  it('ACCEPT applies a hand-resolved result for a no-base whole-file session', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    delete (tab as { diskBaseMarkdown?: string }).diskBaseMarkdown
    tab.markdown = 'local dirty content\n'
    store.currentFile = tab as unknown as typeof store.currentFile

    await store.HANDLE_DIRTY_EXTERNAL_CHANGE(
      tab as never,
      {
        pathname: '/x/a.md',
        data: { filename: 'a.md', pathname: '/x/a.md', markdown: 'disk content\n' }
      } as never
    )
    expect(store.mergeConflict).not.toBeNull()

    store.ACCEPT_DIRTY_EXTERNAL_MERGE_CONFLICT('local dirty content\ndisk content\n')

    expect(store.mergeConflict).toBeNull()
    expect(tab.markdown).toBe('local dirty content\ndisk content\n')
    expect(tab.isSaved).toBe(false)
    expect(tab.diskBaseMarkdown).toBe('disk content\n')
  })

  // When the clean merge's output is byte-identical to the disk content (the
  // remote subsumed the local edits) the tab is truthfully clean — but the
  // buffer still visibly changed, so the Undo/Review notification must be
  // offered, and Undo must restore the pre-merge dirty buffer.
  it('a clean merge equal to disk marks the tab clean but still offers Undo back to the dirty buffer', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nshared\nthree\nlocal tail\n'
    store.currentFile = tab as unknown as typeof store.currentFile

    // The remote contains the local addition plus its own edit: the merge
    // output equals the remote bytes exactly.
    const remote = 'one\nshared REMOTE\nthree\nlocal tail\n'
    await store.HANDLE_DIRTY_EXTERNAL_CHANGE(
      tab as never,
      {
        pathname: '/x/a.md',
        data: { filename: 'a.md', pathname: '/x/a.md', markdown: remote }
      } as never
    )

    expect(store.mergeConflict).toBeNull()
    expect(tab.markdown).toBe(remote)
    expect(tab.isSaved).toBe(true)
    const notifications = tab.notifications as {
      exclusiveType?: string
      action?: (status: boolean | 'secondary') => void
    }[]
    const notification = notifications.find((n) => n.exclusiveType === 'file_changed')
    if (!notification?.action) throw new Error('expected the Undo/Review notification')

    notification.action(true)
    expect(tab.markdown).toBe('one\nshared\nthree\nlocal tail\n')
    expect(tab.isSaved).toBe(false)
    expect(tab.diskBaseMarkdown).toBe(remote)
  })

  // Regression (round-7 gap analysis): the markClean apply sets isSaved
  // without any save. The reviewing-liveness check must not read that flag
  // as "the base moved" — a Review session opened from the markClean
  // notification was stillborn: Accept Merge closed the resolver via the
  // dead-session branch and silently discarded the hand-edited result.
  it('markClean → Review → Accept applies the hand-edited result instead of silently closing', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nshared\nthree\nlocal tail\n'
    store.currentFile = tab as unknown as typeof store.currentFile

    const remote = 'one\nshared REMOTE\nthree\nlocal tail\n'
    await store.HANDLE_DIRTY_EXTERNAL_CHANGE(
      tab as never,
      {
        pathname: '/x/a.md',
        data: { filename: 'a.md', pathname: '/x/a.md', markdown: remote }
      } as never
    )
    expect(tab.isSaved).toBe(true)

    const notifications = tab.notifications as {
      exclusiveType?: string
      action?: (status: boolean | 'secondary') => void
    }[]
    const notification = notifications.find((n) => n.exclusiveType === 'file_changed')
    if (!notification?.action) throw new Error('expected the Undo/Review notification')

    notification.action('secondary')
    expect(store.mergeConflict).not.toBeNull()

    const edited = 'one\nshared REMOTE hand-edited\nthree\nlocal tail\n'
    store.ACCEPT_DIRTY_EXTERNAL_MERGE_CONFLICT(edited)

    expect(store.mergeConflict).toBeNull()
    expect(tab.markdown).toBe(edited)
    expect(tab.isSaved).toBe(false)
    expect(tab.diskBaseMarkdown).toBe(remote)
  })

  // Drive the real watcher listener: LISTEN_FOR_FILE_CHANGE registers the
  // mt::update-file handler on the mocked ipcRenderer; tests retrieve and
  // invoke it with a byte-identical echo payload.
  const invokeFileChange = async(
    store: ReturnType<typeof useEditorStore>,
    tab: ReturnType<typeof makeDirtyTab>,
    markdown: string
  ) => {
    store.LISTEN_FOR_FILE_CHANGE()
    const onMock = window.electron.ipcRenderer.on as unknown as {
      mock: { calls: Array<[string, (e: unknown, payload: unknown) => Promise<void>]> }
    }
    const entry = onMock.mock.calls.find(([channel]) => channel === 'mt::update-file')
    if (!entry) throw new Error('mt::update-file handler not registered')
    // Mirror the tab's live persistence fields so isSameFileSnapshot sees a
    // genuinely byte-identical echo (loadChange may have rewritten them).
    const live = tab as unknown as Record<string, unknown>
    await entry[1](null, {
      type: 'change',
      change: {
        pathname: tab.pathname,
        data: {
          filename: tab.filename,
          pathname: tab.pathname,
          markdown,
          encoding: live.encoding,
          lineEnding: live.lineEnding,
          adjustLineEndingOnSave: live.adjustLineEndingOnSave,
          trimTrailingNewline: live.trimTrailingNewline,
          isMixedLineEndings: live.isMixedLineEndings
        }
      }
    })
  }

  // Reload Disk on a BACKGROUND tab: loadChange invalidates the tab's engine
  // history (pre-reload ops describe a different document), so undoability
  // must come from the journal — the same mechanism background apply-merge
  // uses. Without it the spec's "the reload remains undoable back to the
  // local buffer" holds only for the foreground tab.
  it('reload-disk on a background tab journals the pre-reload buffer for activation undo', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    tab.markdown = 'one\nlocal\nthree\n'
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    // Background: the current file is a different tab.
    store.currentFile = { id: 'other-tab' } as unknown as typeof store.currentFile

    await store.HANDLE_DIRTY_EXTERNAL_CHANGE(
      tab as never,
      {
        pathname: '/x/a.md',
        data: { filename: 'a.md', pathname: '/x/a.md', markdown: 'one\nremote\nthree\n' }
      } as never
    )
    expect(store.mergeConflict).not.toBeNull()

    store.RELOAD_DISK_FROM_MERGE_CONFLICT()
    await vi.waitFor(() => {
      expect(store.mergeConflict).toBeNull()
    })

    const journal = (tab as unknown as { preMergeJournal?: { markdown: string } | null })
      .preMergeJournal
    if (!journal) throw new Error('expected the pre-reload buffer journaled for activation undo')
    expect(journal.markdown).toBe('one\nlocal\nthree\n')
  })

  // Regression (round-10 gap analysis): a byte-DIFFERENT disk change for a
  // CLEAN tab with an open resolver (reachable: markClean → Review) must
  // supersede the session through the reducer — close, re-derive against the
  // new remote, stay headed for review — not silently reload underneath the
  // dialog and leave it wedged on stale panes.
  it('a new disk change for a clean tab supersedes its open review session', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nshared\nthree\nlocal tail\n'
    store.currentFile = tab as unknown as typeof store.currentFile

    const remote = 'one\nshared REMOTE\nthree\nlocal tail\n'
    await store.HANDLE_DIRTY_EXTERNAL_CHANGE(
      tab as never,
      {
        pathname: '/x/a.md',
        data: { filename: 'a.md', pathname: '/x/a.md', markdown: remote }
      } as never
    )
    expect(tab.isSaved).toBe(true)

    const notifications = tab.notifications as {
      exclusiveType?: string
      action?: (status: boolean | 'secondary') => void
    }[]
    const notification = notifications.find((n) => n.exclusiveType === 'file_changed')
    if (!notification?.action) throw new Error('expected the Undo/Review notification')
    notification.action('secondary')
    expect(store.mergeConflict).not.toBeNull()

    const remote2 = 'one\nshared REMOTE AGAIN\nthree\nlocal tail\n'
    await invokeFileChange(store, tab, remote2)

    // The session re-derived against the new remote (clean tab: base ==
    // buffer, so the merge output IS remote2) and stayed headed for review.
    const superseded = store.mergeConflict
    if (!superseded) throw new Error('expected the re-derived resolver session')
    expect(superseded.resultMarkdown).toBe(remote2)
    expect(superseded.remoteMarkdown).toBe(remote2)
  })

  // A byte-identical watcher echo after a clean-subsumed (markClean) merge
  // must NOT remove the Undo/Review notification — it is the only path back
  // to the pre-merge dirty buffer.
  it('a byte-identical watcher echo keeps the auto-merge Undo/Review notification', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nshared\nthree\nlocal tail\n'
    store.currentFile = tab as unknown as typeof store.currentFile

    const remote = 'one\nshared REMOTE\nthree\nlocal tail\n'
    await store.HANDLE_DIRTY_EXTERNAL_CHANGE(
      tab as never,
      {
        pathname: '/x/a.md',
        data: { filename: 'a.md', pathname: '/x/a.md', markdown: remote }
      } as never
    )
    expect(tab.markdown).toBe(remote)
    const hasNotification = () =>
      (tab.notifications as { exclusiveType?: string }[]).some(
        (n) => n.exclusiveType === 'file_changed'
      )
    expect(hasNotification()).toBe(true)

    await invokeFileChange(store, tab, remote)

    expect(hasNotification()).toBe(true)
    expect(tab.markdown).toBe(remote)
  })

  // A disk change that converges to the user's exact buffer while the
  // resolver is open must close the dead session (via the reducer), not
  // leave stale panes up.
  it('a converging byte-identical disk change closes an open resolver session', async() => {
    const store = useEditorStore()
    const tab = makeDirtyTab(store)
    openConflictSession(store, tab)
    expect(store.mergeConflict).not.toBeNull()

    await invokeFileChange(store, tab, tab.markdown)

    expect(store.mergeConflict).toBeNull()
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
