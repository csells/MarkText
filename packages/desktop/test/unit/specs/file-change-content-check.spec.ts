import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

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

import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { sendBufferedState } from '@/store/bufferedState'
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
    return call[1] as (e: unknown, payload: unknown) => void
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

  it('does not mark a dirty tab clean when matching decoded content has different file metadata', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.isSaved = false
    const notifySpy = vi.spyOn(store, 'pushTabNotification').mockImplementation(() => {})
    store.LISTEN_FOR_FILE_CHANGE()

    fire(captureHandler(), 'hello', {
      lineEnding: 'crlf',
      adjustLineEndingOnSave: true
    })

    expect(notifySpy).toHaveBeenCalledTimes(1)
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
    'does not mark a dirty tab clean when matching decoded content has changed %s metadata',
    (_name, data) => {
      const store = useEditorStore()
      const tab = makeSavedTab(store)
      tab.isSaved = false
      const notifySpy = vi.spyOn(store, 'pushTabNotification').mockImplementation(() => {})
      store.LISTEN_FOR_FILE_CHANGE()

      fire(captureHandler(), 'hello', data)

      expect(notifySpy).toHaveBeenCalledTimes(1)
      expect(tab.isSaved).toBe(false)
    }
  )

  it('still warns when the on-disk content actually changed', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.isSaved = false
    const notifySpy = vi.spyOn(store, 'pushTabNotification').mockImplementation(() => {})
    store.LISTEN_FOR_FILE_CHANGE()

    fire(captureHandler(), 'hello world')

    expect(notifySpy).toHaveBeenCalledTimes(1)
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('Undo')
      })
    )
    expect(tab.isSaved).toBe(false)
  })

  it('auto-merges non-overlapping dirty local and disk changes', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one local\nshared\nthree\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    store.LISTEN_FOR_FILE_CHANGE()

    fire(captureHandler(), 'one\nshared\nthree remote\n')

    expect(tab.markdown).toBe('one local\nshared\nthree remote\n')
    expect(tab.diskBaseMarkdown).toBe('one\nshared\nthree remote\n')
    expect(tab.isSaved).toBe(false)
    expect(store.mergeConflict).toBeNull()
    expect(tab.notifications).toEqual([
      expect.objectContaining({
        msg: expect.stringContaining('Merged disk changes'),
        showConfirm: true,
        action: expect.any(Function)
      })
    ])

    const [notification] = tab.notifications as Array<{ action: (status?: unknown) => void }>
    notification.action(true)

    expect(tab.markdown).toBe('one local\nshared\nthree\n')
    expect(tab.diskBaseMarkdown).toBe('one\nshared\nthree remote\n')
    expect(tab.isSaved).toBe(false)
  })

  it('opens a merge conflict resolver for overlapping dirty local and disk changes', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nlocal\nthree\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    store.LISTEN_FOR_FILE_CHANGE()

    fire(captureHandler(), 'one\nremote\nthree\n')

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

  it('accepts a resolved conflict as dirty while advancing the disk base', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nlocal\nthree\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    store.LISTEN_FOR_FILE_CHANGE()

    fire(captureHandler(), 'one\nremote\nthree\n')
    store.ACCEPT_DIRTY_EXTERNAL_MERGE_CONFLICT('one\nlocal\nremote\nthree\n')

    expect(tab.markdown).toBe('one\nlocal\nremote\nthree\n')
    expect(tab.diskBaseMarkdown).toBe('one\nremote\nthree\n')
    expect(tab.isSaved).toBe(false)
    expect(store.mergeConflict).toBeNull()
  })

  it('accepts the remote side of a conflict as clean', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nlocal\nthree\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    store.LISTEN_FOR_FILE_CHANGE()

    fire(captureHandler(), 'one\nremote\nthree\n')
    store.ACCEPT_DIRTY_EXTERNAL_MERGE_CONFLICT('one\nremote\nthree\n')

    expect(tab.markdown).toBe('one\nremote\nthree\n')
    expect(tab.diskBaseMarkdown).toBe('one\nremote\nthree\n')
    expect(tab.isSaved).toBe(true)
    expect(store.mergeConflict).toBeNull()
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

    fire(captureHandler(), 'one\nremote\nthree\n')
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

  it('keeps the resolver open when accepted merge output introduces new comment diagnostics', () => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.diskBaseMarkdown = 'one\nshared\nthree\n'
    tab.markdown = 'one\nlocal\nthree\n'
    tab.isSaved = false
    store.currentFile = tab as unknown as typeof store.currentFile
    store.LISTEN_FOR_FILE_CHANGE()

    fire(captureHandler(), 'one\nremote\nthree\n')
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

  it('keeps a dirty local recovery tab before confirmed reload replaces the original', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.isSaved = false
    tab.markdown = 'local dirty content'
    tab.lineEnding = 'crlf'
    tab.adjustLineEndingOnSave = true
    store.currentFile = tab as unknown as typeof store.currentFile
    const loadSpy = vi.spyOn(store, 'loadChange').mockImplementation(() => {})
    store.LISTEN_FOR_FILE_CHANGE()

    fire(captureHandler(), 'disk content')
    const [notification] = tab.notifications as Array<{ action: (status?: unknown) => void }>
    expect(notification).toBeDefined()

    tab.notifications.shift()
    notification?.action(true)
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

  it('flushes the recovery tab snapshot before replacing the original tab', async() => {
    const store = useEditorStore()
    const tab = makeSavedTab(store)
    tab.isSaved = false
    tab.markdown = 'local dirty content'
    store.currentFile = tab as unknown as typeof store.currentFile
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
    const loadSpy = vi.spyOn(store, 'loadChange').mockImplementation(() => {
      order.push('load')
    })
    store.LISTEN_FOR_FILE_CHANGE()

    fire(captureHandler(), 'disk content')
    const [notification] = tab.notifications as Array<{ action: (status?: unknown) => void }>
    tab.notifications.shift()
    notification?.action(true)

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
