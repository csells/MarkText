import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type * as DirtyExternalMergeModule from '@/util/dirtyExternalMerge'

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
vi.mock('@/util/dirtyExternalMerge', async(importOriginal) => {
  const actual = await importOriginal<typeof DirtyExternalMergeModule>()
  return {
    ...actual,
    mergeDirtyExternalMarkdown: vi.fn(actual.mergeDirtyExternalMarkdown)
  }
})

import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { sendBufferedState } from '@/store/bufferedState'
import { mergeDirtyExternalMarkdown } from '@/util/dirtyExternalMerge'
import bus from '@/bus'

// #1861: a watcher 'change' event fires even when only the file's mtime changed
// (e.g. a git checkout that left the content byte-identical). The handler then
// marked the tab unsaved and showed a "file changed on disk" prompt for a
// no-op change. Skip the handling when the new on-disk content equals the
// tab's current content.
describe('useEditorStore LISTEN_FOR_FILE_CHANGE — content-identical change (#1861)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ;(window.electron.ipcRenderer.on as Mock).mockReset()
    ;(window.electron.ipcRenderer.send as Mock).mockReset()
  })

  const makeSavedTab = (store: ReturnType<typeof useEditorStore>) => {
    const tab = {
      id: 'tab-1',
      filename: 'a.md',
      pathname: '/x/a.md',
      markdown: 'hello',
      diskBaseMarkdown: undefined as string | undefined,
      isSaved: true,
      encoding: { encoding: 'utf8', isBom: false },
      lineEnding: 'lf',
      adjustLineEndingOnSave: false,
      trimTrailingNewline: 0,
      notifications: [],
      history: { stack: [], index: -1 }
    }
    store.tabs = [tab] as unknown as typeof store.tabs
    store.tabIdToIndex = { 'tab-1': 0 }
    return tab
  }

  const captureHandler = () => {
    const onMock = window.electron.ipcRenderer.on as Mock
    const call = onMock.mock.calls.find((c) => c[0] === 'mt::update-file')
    if (!call) throw new Error('mt::update-file handler was not registered')
    return call[1] as (e: unknown, payload: unknown) => void | Promise<void>
  }

  const fire = (
    handler: ReturnType<typeof captureHandler>,
    markdown: string,
    data: Record<string, unknown> = {}
  ) =>
    handler(null, {
      type: 'change',
      change: {
        pathname: '/x/a.md',
        data: {
          markdown,
          filename: 'a.md',
          pathname: '/x/a.md',
          encoding: { encoding: 'utf8', isBom: false },
          lineEnding: 'lf',
          adjustLineEndingOnSave: false,
          trimTrailingNewline: 0,
          ...data
        }
      }
    })

  const metadata = (body: string): string =>
    `data:application/json;base64,${Buffer.from(JSON.stringify({
      version: 1,
      status: 'open',
      replies: [
        {
          author: 'Agent',
          createdAt: '2026-06-30T12:00:00.000Z',
          body
        }
      ]
    })).toString('base64')}`

  const emptyMetadata = (): string =>
    `data:application/json;base64,${Buffer.from(JSON.stringify({
      version: 1,
      status: 'open',
      replies: []
    })).toString('base64')}`

  it('flushes the active editor before sending a save payload', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.markdown = 'stale tab state'
    store.currentFile = tab as unknown as typeof store.currentFile
    const flush = () => {
      tab.markdown = 'fresh source state'
    }

    bus.on('flush-active-editor', flush)
    try {
      store.FILE_SAVE()
    } finally {
      bus.off('flush-active-editor', flush)
    }

    expect(window.electron.ipcRenderer.send).toHaveBeenCalledWith(
      'mt::response-file-save',
      'tab-1',
      'a.md',
      '/x/a.md',
      'fresh source state',
      expect.anything(),
      expect.anything()
    )
  })

  it('strips zero-reply comment threads before sending a save payload', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.markdown = [
      'A <!--MC:draft-->reviewed<!--MC:~draft--> span.',
      '',
      `[MC:draft]: ${emptyMetadata()}`,
      ''
    ].join('\n')
    store.currentFile = tab as unknown as typeof store.currentFile

    store.FILE_SAVE()

    expect(window.electron.ipcRenderer.send).toHaveBeenCalledWith(
      'mt::response-file-save',
      'tab-1',
      'a.md',
      '/x/a.md',
      expect.not.stringContaining('MC:'),
      expect.anything(),
      expect.anything()
    )
    expect(tab.markdown).toContain('A reviewed span.')
    expect(tab.markdown).not.toContain('MC:')
  })

  it('marks the tab dirty when line-ending persistence metadata changes', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    store.currentFile = tab as unknown as typeof store.currentFile

    store.SET_LINE_ENDING('crlf')

    expect(tab.lineEnding).toBe('crlf')
    expect(tab.adjustLineEndingOnSave).toBe(true)
    expect(tab.isSaved).toBe(false)
  })

  it('marks the tab dirty when encoding persistence metadata changes', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.encoding.isBom = true
    store.currentFile = tab as unknown as typeof store.currentFile

    store.SET_FILE_ENCODING('utf16le')

    expect(tab.encoding).toEqual({ encoding: 'utf16le', isBom: false })
    expect(tab.isSaved).toBe(false)
  })

  it('marks the tab dirty when final-newline persistence metadata changes', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    store.currentFile = tab as unknown as typeof store.currentFile

    store.SET_FINAL_NEWLINE(1)

    expect(tab.trimTrailingNewline).toBe(1)
    expect(tab.isSaved).toBe(false)
  })

  it('ignores a change whose content matches the tab (mtime-only change)', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    const notifySpy = vi.spyOn(store, 'pushTabNotification').mockImplementation(() => {})
    store.LISTEN_FOR_FILE_CHANGE()

    fire(captureHandler(), 'hello')

    expect(notifySpy).not.toHaveBeenCalled()
    expect(tab.isSaved).toBe(true)
  })

  it('does not ignore matching decoded content when file line-ending metadata changed', () => {
    const store = useEditorStore()
    makeSavedTab(store)
    const loadSpy = vi.spyOn(store, 'loadChange').mockImplementation(() => {})
    const notifySpy = vi.spyOn(store, 'pushTabNotification').mockImplementation(() => {})
    store.LISTEN_FOR_FILE_CHANGE()

    fire(captureHandler(), 'hello', {
      lineEnding: 'crlf',
      adjustLineEndingOnSave: true
    })

    expect(loadSpy).toHaveBeenCalledTimes(1)
    expect(notifySpy).not.toHaveBeenCalled()
  })

  it.each([false, true])('auto-reloads clean changed content when Auto Save is %s', (autoSave) => {
    const preferencesStore = usePreferencesStore()
    preferencesStore.autoSave = autoSave
    const store = useEditorStore()
    makeSavedTab(store)
    const loadSpy = vi.spyOn(store, 'loadChange').mockImplementation(() => {})
    const notifySpy = vi.spyOn(store, 'pushTabNotification').mockImplementation(() => {})
    store.LISTEN_FOR_FILE_CHANGE()

    fire(captureHandler(), 'changed on disk')

    expect(loadSpy).toHaveBeenCalledTimes(1)
    expect(notifySpy).not.toHaveBeenCalled()
  })

  it.each([
    ['BOM', { encoding: { encoding: 'utf8', hasBOM: true } }],
    ['encoding', { encoding: { encoding: 'utf16le', hasBOM: false } }],
    ['trailing-newline policy', { trimTrailingNewline: 1 }]
  ])('does not ignore matching decoded content when file %s metadata changed', (_name, data) => {
    const store = useEditorStore()
    makeSavedTab(store)
    const loadSpy = vi.spyOn(store, 'loadChange').mockImplementation(() => {})
    const notifySpy = vi.spyOn(store, 'pushTabNotification').mockImplementation(() => {})
    store.LISTEN_FOR_FILE_CHANGE()

    fire(captureHandler(), 'hello', data)

    expect(loadSpy).toHaveBeenCalledTimes(1)
    expect(notifySpy).not.toHaveBeenCalled()
  })

  it('adopts disk metadata but keeps a matching dirty tab dirty when only line-ending metadata changed', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.isSaved = false
    const loadSpy = vi.spyOn(store, 'loadChange')
    const notifySpy = vi.spyOn(store, 'pushTabNotification').mockImplementation(() => {})
    store.LISTEN_FOR_FILE_CHANGE()

    await fire(captureHandler(), 'hello', {
      lineEnding: 'crlf',
      adjustLineEndingOnSave: true
    })

    expect(loadSpy).toHaveBeenCalledTimes(1)
    expect(loadSpy.mock.calls[0]?.[1]).toEqual({ preserveDirty: true })
    expect(notifySpy).not.toHaveBeenCalled()
    expect(store.mergeConflict).toBeNull()
    expect(tab.lineEnding).toBe('crlf')
    expect(tab.adjustLineEndingOnSave).toBe(true)
    expect(tab.isSaved).toBe(false)
  })

  it('marks a dirty tab clean when disk content catches up to matching local content', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'base content'
    tab.markdown = 'hello'
    tab.isSaved = false
    const notifySpy = vi.spyOn(store, 'pushTabNotification').mockImplementation(() => {})
    store.LISTEN_FOR_FILE_CHANGE()

    fire(captureHandler(), 'hello')

    expect(notifySpy).not.toHaveBeenCalled()
    expect(tab.diskBaseMarkdown).toBe('hello')
    expect(tab.isSaved).toBe(true)
  })

  it.each([
    ['BOM', { encoding: { encoding: 'utf8', hasBOM: true } }],
    ['encoding', { encoding: { encoding: 'utf16le', hasBOM: false } }],
    ['trailing-newline policy', { trimTrailingNewline: 1 }]
  ])(
    'adopts disk metadata but keeps a matching dirty tab dirty when %s metadata changed',
    async(_name, data) => {
      const store = useEditorStore()
      const tab = makeSavedTab(store)
      tab.isSaved = false
      const loadSpy = vi.spyOn(store, 'loadChange')
      const notifySpy = vi.spyOn(store, 'pushTabNotification').mockImplementation(() => {})
      store.LISTEN_FOR_FILE_CHANGE()

      await fire(captureHandler(), 'hello', data)

      expect(loadSpy).toHaveBeenCalledTimes(1)
      expect(loadSpy.mock.calls[0]?.[1]).toEqual({ preserveDirty: true })
      expect(notifySpy).not.toHaveBeenCalled()
      expect(store.mergeConflict).toBeNull()
      expect(tab.isSaved).toBe(false)
    }
  )

  it('opens the conflict resolver for a dirty change when no merge base is recorded', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    store.LISTEN_FOR_FILE_CHANGE()

    // No diskBaseMarkdown → base '' → we cannot silently choose a side, so the
    // divergent content is surfaced in the conflict resolver and the local
    // buffer is left untouched until the user resolves it.
    await fire(captureHandler(), 'hello world')

    expect(store.mergeConflict).toEqual(expect.objectContaining({ tabId: 'tab-1' }))
    expect(tab.markdown).toBe('hello')
  })

  it('merges disk changes discovered while restoring an unsaved tab', async() => {
    const store = useEditorStore()

    store.RESTORE_BUFFERED_STATE({
      currentFileId: 'old-tab',
      tabs: [
        {
          id: 'old-tab',
          filename: 'a.md',
          pathname: '/x/a.md',
          markdown: 'one local\nshared\nthree\n',
          diskBaseMarkdown: 'one\nshared\nthree\n',
          isSaved: false,
          encoding: { encoding: 'utf8', isBom: false },
          lineEnding: 'lf',
          adjustLineEndingOnSave: false,
          trimTrailingNewline: 0,
          restoredDiskDocument: {
            markdown: 'one\nshared\nthree remote\n',
            filename: 'a.md',
            encoding: { encoding: 'utf8', isBom: false },
            lineEnding: 'lf',
            adjustLineEndingOnSave: false,
            trimTrailingNewline: 0
          }
        }
      ]
    })

    await vi.waitFor(() => {
      expect(store.tabs[0]?.markdown).toBe('one local\nshared\nthree remote\n')
    })
    expect(store.tabs[0]?.diskBaseMarkdown).toBe('one\nshared\nthree remote\n')
    expect(store.tabs[0]?.isSaved).toBe(false)
  })

  it('auto-merges non-overlapping dirty local and disk changes', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one local\nshared\nthree\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    const emitSpy = vi.spyOn(bus, 'emit')
    store.LISTEN_FOR_FILE_CHANGE()

    await fire(captureHandler(), 'one\nshared\nthree remote\n')

    expect(tab.markdown).toBe('one local\nshared\nthree remote\n')
    expect(tab.diskBaseMarkdown).toBe('one\nshared\nthree remote\n')
    expect(tab.isSaved).toBe(false)
    expect(store.mergeConflict).toBeNull()
    expect(tab.notifications).toEqual([
      expect.objectContaining({
        msg: expect.stringContaining('Merged disk changes'),
        confirmLabel: 'Undo',
        secondaryLabel: 'Review',
        showConfirm: true,
        action: expect.any(Function)
      })
    ])
    expect(emitSpy).toHaveBeenCalledWith(
      'file-changed',
      expect.objectContaining({
        markdown: 'one local\nshared\nthree remote\n',
        isReload: true,
        preserveDirty: true
      })
    )

    const [notification] = tab.notifications as Array<{ action: (status?: unknown) => void }>
    notification.action('secondary')

    expect(store.mergeConflict).toEqual(
      expect.objectContaining({
        tabId: 'tab-1',
        baseMarkdown: 'one\nshared\nthree\n',
        localMarkdown: 'one local\nshared\nthree\n',
        remoteMarkdown: 'one\nshared\nthree remote\n',
        resultMarkdown: 'one local\nshared\nthree remote\n',
        conflicts: []
      })
    )
    store.CANCEL_DIRTY_EXTERNAL_MERGE_CONFLICT()

    notification.action(true)

    expect(tab.markdown).toBe('one local\nshared\nthree\n')
    expect(tab.diskBaseMarkdown).toBe('one\nshared\nthree remote\n')
    expect(tab.isSaved).toBe(false)
    expect(emitSpy).toHaveBeenCalledWith(
      'file-changed',
      expect.objectContaining({
        markdown: 'one local\nshared\nthree\n',
        isReload: true,
        preserveDirty: true
      })
    )
  })

  it('ignores stale auto-merge notification actions after newer local edits', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one local\nshared\nthree\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    store.LISTEN_FOR_FILE_CHANGE()

    await fire(captureHandler(), 'one\nshared\nthree remote\n')

    const [notification] = tab.notifications as Array<{ action: (status?: unknown) => void }>
    tab.markdown = 'one local\nshared\nthree remote\nkept typing\n'

    notification.action('secondary')
    expect(store.mergeConflict).toBeNull()

    notification.action(true)
    expect(tab.markdown).toBe('one local\nshared\nthree remote\nkept typing\n')
    expect(tab.diskBaseMarkdown).toBe('one\nshared\nthree remote\n')
    expect(tab.isSaved).toBe(false)
  })

  it('ignores an async dirty merge result when the local buffer changed again', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one local\nshared\nthree\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    store.LISTEN_FOR_FILE_CHANGE()

    const pendingChange = fire(captureHandler(), 'one\nshared\nthree remote\n')
    tab.markdown = 'one local\nshared\nthree\nstill typing\n'

    await pendingChange

    expect(tab.markdown).toBe('one local\nshared\nthree\nstill typing\n')
    expect(tab.diskBaseMarkdown).toBe('one\nshared\nthree\n')
    expect(tab.notifications).toEqual([])
    expect(store.mergeConflict).toBeNull()
  })

  it('ignores an async dirty merge result when the tab was saved against a new base', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one local\nshared\nthree\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    store.LISTEN_FOR_FILE_CHANGE()

    const pendingChange = fire(captureHandler(), 'one\nshared\nthree remote\n')
    tab.diskBaseMarkdown = 'one\nshared\nthree saved\n'
    tab.isSaved = true

    await pendingChange

    expect(tab.markdown).toBe('one local\nshared\nthree\n')
    expect(tab.diskBaseMarkdown).toBe('one\nshared\nthree saved\n')
    expect(tab.notifications).toEqual([])
    expect(store.mergeConflict).toBeNull()
  })

  it('ignores dirty external changes whose disk content still matches the merge base', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one local\nshared\nthree\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    store.LISTEN_FOR_FILE_CHANGE()

    await fire(captureHandler(), 'one\nshared\nthree\n')

    expect(tab.markdown).toBe('one local\nshared\nthree\n')
    expect(tab.diskBaseMarkdown).toBe('one\nshared\nthree\n')
    expect(tab.notifications).toEqual([])
    expect(store.mergeConflict).toBeNull()
  })

  it('auto-merges non-overlapping dirty local edits with disk comment metadata edits', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    const base = [
      'A <!--MC:a-->reviewed<!--MC:~a--> span.',
      '',
      `[MC:a]: ${metadata('Base note.')}`,
      ''
    ].join('\n')
    const local = base.replace(' span.', ' span with local edits.')
    const remote = base.replace(metadata('Base note.'), metadata('Agent note.'))
    tab.diskBaseMarkdown = base
    tab.markdown = local
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    store.LISTEN_FOR_FILE_CHANGE()

    await fire(captureHandler(), remote)

    expect(tab.markdown).toContain('<!--MC:a-->reviewed<!--MC:~a-->')
    expect(tab.markdown).toContain('span with local edits.')
    expect(tab.markdown).toContain(`[MC:a]: ${metadata('Agent note.')}`)
    expect(tab.diskBaseMarkdown).toBe(remote)
    expect(tab.isSaved).toBe(false)
    expect(store.mergeConflict).toBeNull()
  })

  it('opens a merge conflict resolver for overlapping dirty local and disk changes', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nlocal\nthree\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    store.LISTEN_FOR_FILE_CHANGE()

    await fire(captureHandler(), 'one\nremote\nthree\n')

    expect(tab.markdown).toBe('one\nlocal\nthree\n')
    expect(tab.isSaved).toBe(false)
    expect(store.mergeConflict).toEqual(
      expect.objectContaining({
        tabId: 'tab-1',
        localMarkdown: 'one\nlocal\nthree\n',
        remoteMarkdown: 'one\nremote\nthree\n',
        resultMarkdown: expect.stringContaining('<<<<<<< MARKTEXT_LOCAL c1')
      })
    )
  })

  it('can reopen a canceled dirty merge resolver from the notification', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nlocal\nthree\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    store.LISTEN_FOR_FILE_CHANGE()

    await fire(captureHandler(), 'one\nremote\nthree\n')
    const [notification] = tab.notifications as Array<{
      action: (status?: unknown) => void
      confirmLabel?: string
      showConfirm?: boolean
    }>
    expect(notification).toEqual(
      expect.objectContaining({
        showConfirm: true,
        confirmLabel: 'Resolve disk changes'
      })
    )

    store.CANCEL_DIRTY_EXTERNAL_MERGE_CONFLICT()
    expect(store.mergeConflict).toBeNull()

    notification.action(true)

    expect(store.mergeConflict).toEqual(
      expect.objectContaining({
        tabId: 'tab-1',
        localMarkdown: 'one\nlocal\nthree\n',
        remoteMarkdown: 'one\nremote\nthree\n'
      })
    )
  })

  it('accepts a resolved conflict as dirty while advancing the disk base', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nlocal\nthree\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    const emitSpy = vi.spyOn(bus, 'emit')
    store.LISTEN_FOR_FILE_CHANGE()

    await fire(captureHandler(), 'one\nremote\nthree\n')
    store.ACCEPT_DIRTY_EXTERNAL_MERGE_CONFLICT('one\nlocal\nremote\nthree\n')

    expect(tab.markdown).toBe('one\nlocal\nremote\nthree\n')
    expect(tab.diskBaseMarkdown).toBe('one\nremote\nthree\n')
    expect(tab.isSaved).toBe(false)
    expect(store.mergeConflict).toBeNull()
    expect(emitSpy).toHaveBeenCalledWith(
      'file-changed',
      expect.objectContaining({
        markdown: 'one\nlocal\nremote\nthree\n',
        isReload: true,
        preserveDirty: true
      })
    )
  })

  it('accepts the remote side of a conflict as dirty while advancing the disk base', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nlocal\nthree\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    store.LISTEN_FOR_FILE_CHANGE()

    await fire(captureHandler(), 'one\nremote\nthree\n')
    store.ACCEPT_DIRTY_EXTERNAL_MERGE_CONFLICT('one\nremote\nthree\n')

    expect(tab.markdown).toBe('one\nremote\nthree\n')
    expect(tab.diskBaseMarkdown).toBe('one\nremote\nthree\n')
    expect(tab.isSaved).toBe(false)
    expect(store.mergeConflict).toBeNull()
  })

  it('opens the conflict resolver when the dirty merge worker fails', async() => {
    vi.mocked(mergeDirtyExternalMarkdown).mockRejectedValueOnce(new Error('worker crashed'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nlocal\nthree\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    store.LISTEN_FOR_FILE_CHANGE()

    try {
      await fire(captureHandler(), 'one\nremote\nthree\n')
    } finally {
      errorSpy.mockRestore()
    }

    expect(tab.markdown).toBe('one\nlocal\nthree\n')
    expect(tab.isSaved).toBe(false)
    expect(store.mergeConflict).toEqual(
      expect.objectContaining({
        tabId: 'tab-1',
        localMarkdown: 'one\nlocal\nthree\n',
        remoteMarkdown: 'one\nremote\nthree\n',
        resultMarkdown: expect.stringContaining('<<<<<<< MARKTEXT_LOCAL')
      })
    )
  })

  it('clears the merge-conflict notification when reloading disk from the resolver', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nlocal\nthree\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    const loadSpy = vi.spyOn(store, 'loadChange').mockImplementation(() => {})
    store.LISTEN_FOR_FILE_CHANGE()

    await fire(captureHandler(), 'one\nremote\nthree\n')
    expect(tab.notifications).toEqual([
      expect.objectContaining({
        msg: expect.stringContaining('Resolve the merge')
      })
    ])

    store.RELOAD_DISK_FROM_MERGE_CONFLICT()
    await Promise.resolve()
    await Promise.resolve()

    expect(store.mergeConflict).toBeNull()
    expect(tab.notifications).toEqual([
      expect.objectContaining({
        msg: expect.stringContaining('kept')
      })
    ])
    expect(loadSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps the resolver open when accepted merge output introduces new comment diagnostics', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nlocal\nthree\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    store.LISTEN_FOR_FILE_CHANGE()

    await fire(captureHandler(), 'one\nremote\nthree\n')
    store.ACCEPT_DIRTY_EXTERNAL_MERGE_CONFLICT(
      'one\n<!--MC:missing-->commented<!--MC:~missing-->\nthree\n'
    )

    expect(tab.markdown).toBe('one\nlocal\nthree\n')
    expect(tab.diskBaseMarkdown).toBe('one\nshared\nthree\n')
    expect(tab.isSaved).toBe(false)
    expect(store.mergeConflict).toEqual(
      expect.objectContaining({
        resultMarkdown: 'one\n<!--MC:missing-->commented<!--MC:~missing-->\nthree\n',
        validationError: expect.stringContaining('invalid MarkText comment syntax')
      })
    )
  })

  it('keeps the resolver open when accepted merge output moves an existing diagnostic to new syntax', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nlocal\nthree\n\n<!--MC:missing-->old<!--MC:~missing-->\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    store.LISTEN_FOR_FILE_CHANGE()

    await fire(captureHandler(), 'one\nremote\nthree\n\n<!--MC:missing-->old<!--MC:~missing-->\n')
    store.ACCEPT_DIRTY_EXTERNAL_MERGE_CONFLICT(
      'one\n<!--MC:missing-->new<!--MC:~missing-->\nthree\n'
    )

    expect(tab.markdown).toBe('one\nlocal\nthree\n\n<!--MC:missing-->old<!--MC:~missing-->\n')
    expect(store.mergeConflict).toEqual(
      expect.objectContaining({
        resultMarkdown: 'one\n<!--MC:missing-->new<!--MC:~missing-->\nthree\n',
        validationError: expect.stringContaining('invalid MarkText comment syntax')
      })
    )
  })

  it('keeps a dirty local recovery tab when abandoning a merge to reload disk', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.isSaved = false
    tab.markdown = 'local dirty content'
    tab.diskBaseMarkdown = 'base content'
    tab.lineEnding = 'crlf'
    tab.adjustLineEndingOnSave = true
    store.currentFile = tab as unknown as typeof store.currentFile
    const loadSpy = vi.spyOn(store, 'loadChange').mockImplementation(() => {})
    store.LISTEN_FOR_FILE_CHANGE()

    // Divergent local + disk edits over the base conflict → resolver opens.
    await fire(captureHandler(), 'disk content')
    expect(store.mergeConflict).not.toBeNull()

    // Abandoning the merge to reload disk must first preserve the local buffer
    // in a dirty untitled recovery tab (the data-safety backstop).
    store.RELOAD_DISK_FROM_MERGE_CONFLICT()
    await Promise.resolve()
    await Promise.resolve()

    const recoveryTab = store.tabs.find((item) => item.id !== 'tab-1')
    expect(recoveryTab).toEqual(
      expect.objectContaining({
        pathname: '',
        markdown: 'local dirty content',
        isSaved: false,
        lineEnding: 'crlf',
        adjustLineEndingOnSave: true
      })
    )
    expect(loadSpy).toHaveBeenCalledTimes(1)
  })

  it('flushes the recovery tab snapshot before replacing the original tab on abandon', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.isSaved = false
    tab.markdown = 'local dirty content'
    tab.diskBaseMarkdown = 'base content'
    store.currentFile = tab as unknown as typeof store.currentFile
    const loadSpy = vi.spyOn(store, 'loadChange').mockImplementation(() => {})
    store.LISTEN_FOR_FILE_CHANGE()

    await fire(captureHandler(), 'disk content')
    expect(store.mergeConflict).not.toBeNull()

    const order: string[] = []
    let resolveFlush: (value: unknown) => void = () => {}
    vi.mocked(sendBufferedState).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFlush = (value) => {
            order.push('flush')
            resolve(value)
          }
        })
    )
    loadSpy.mockImplementation(() => {
      order.push('load')
    })

    store.RELOAD_DISK_FROM_MERGE_CONFLICT()

    expect(sendBufferedState).toHaveBeenCalledTimes(1)
    expect(loadSpy).not.toHaveBeenCalled()

    resolveFlush(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(loadSpy).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['flush', 'load'])
  })

  it('reloads the active editor when the watcher path matches by platform path semantics', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.pathname = '/X/A.md'
    store.currentFile = tab as unknown as typeof store.currentFile
    window.fileUtils.isSamePathSync = (a, b) => a.toLowerCase() === b.toLowerCase()
    const emitSpy = vi.spyOn(bus, 'emit')

    store.loadChange({
      pathname: '/x/a.md',
      data: {
        markdown: 'disk content',
        filename: 'a.md',
        pathname: '/x/a.md',
        encoding: { encoding: 'utf8', isBom: false },
        lineEnding: 'lf',
        adjustLineEndingOnSave: false,
        trimTrailingNewline: 0
      }
    } as Parameters<typeof store.loadChange>[0])

    expect(emitSpy).toHaveBeenCalledWith(
      'file-changed',
      expect.objectContaining({
        id: 'tab-1',
        markdown: 'disk content',
        isReload: true
      })
    )
  })
})
