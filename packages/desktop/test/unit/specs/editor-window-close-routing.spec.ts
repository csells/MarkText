import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Accessor from 'main_renderer/app/accessor'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  quit: vi.fn(),
  preparing: new WeakSet<object>(),
  emit: vi.fn(),
  listeners: new Map<string, (...args: unknown[]) => unknown>()
}))
vi.mock('electron', async() => {
  const { EventEmitter } = await import('node:events')
  let nextWindowId = 17
  const windows = new Map<number, TestWindow>()
  class TestWindow extends EventEmitter {
    id = nextWindowId++
    constructor() {
      super()
      windows.set(this.id, this)
    }

    static fromId(id: number) {
      return windows.get(id)
    }

    destroy = vi.fn()
    webContents = Object.assign(new EventEmitter(), {
      send: vi.fn(),
      setIgnoreMenuShortcuts: vi.fn()
    })

    loadURL = vi.fn()
    setSheetOffset = vi.fn()
  }
  return {
    ipcMain: {
      emit: mocks.emit,
      on: (channel: string, listener: (...args: unknown[]) => unknown) =>
        mocks.listeners.set(channel, listener),
      handle: vi.fn()
    },
    BrowserWindow: TestWindow,
    dialog: {},
    app: { quit: mocks.quit }
  }
})
vi.mock('electron-log', () => ({ default: { error: vi.fn(), info: vi.fn() } }))
vi.mock('electron-window-state', () => ({ default: () => ({ manage: vi.fn() }) }))
vi.mock('main_renderer/windows/windowActivationPolicy', () => ({
  isHiddenE2eWindow: () => true,
  windowActivationAllowed: () => false
}))
vi.mock('main_renderer/windows/prepareClose', () => ({
  isWindowPreparingToClose: (win: object) => mocks.preparing.has(win)
}))
vi.mock('main_renderer/windows/utils', () => ({
  ensureWindowPosition: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
  zoomIn: vi.fn(),
  zoomOut: vi.fn()
}))
vi.mock('main_renderer/config', () => ({
  isLinux: false,
  isOsx: true,
  TITLE_BAR_HEIGHT: 22,
  editorWinOptions: {}
}))
vi.mock('main_renderer/contextMenu/editor', () => ({ showEditorContextMenu: vi.fn() }))
vi.mock('main_renderer/contextMenu/editor/reviewContext', () => ({ requestReviewContext: vi.fn() }))
vi.mock('main_renderer/filesystem/markdown', () => ({
  loadMarkdownFile: mocks.load,
  normalizeMarkdownPath: (pathname: string) => ({ path: pathname, isDir: false })
}))
vi.mock('main_renderer/spellchecker', () => ({ switchLanguage: vi.fn(), default: vi.fn() }))
import EditorWindow, { type PendingEditorOpen } from 'main_renderer/windows/editor'
import { WindowLifecycle } from 'main_renderer/windows/base'
vi.mock('main_renderer/filesystem/watcher', () => ({
  default: class {
    unwatchByWindowId = vi.fn()
    watch = vi.fn()
  },
  WATCHER_STABILITY_THRESHOLD: 1,
  WATCHER_STABILITY_POLL_INTERVAL: 1
}))
import WindowManager from 'main_renderer/app/windowManager'

vi.mock('main_renderer/cli/parser', () => ({ default: vi.fn() }))
vi.mock('main_renderer/filesystem', () => ({
  normalizeAndResolvePath: (pathname: string) => pathname
}))
vi.mock('main_renderer/keyboard', () => ({ registerKeyboardListeners: vi.fn() }))
vi.mock('main_renderer/menu/actions/theme', () => ({ selectTheme: vi.fn() }))
vi.mock('main_renderer/menu/templates', () => ({ dockMenu: vi.fn() }))
vi.mock('main_renderer/utils/imagePathAutoComplement', () => ({ watchers: new Map() }))
vi.mock('main_renderer/windows/setting', () => ({ default: class {} }))
vi.mock('main_renderer/i18n', () => ({ setLanguage: vi.fn() }))
import App from 'main_renderer/app'

const registerApplication = (accessor: Accessor) => new App(accessor, {})

const makeEditor = () => {
  const accessor = {
    preferences: {
      getPreferredEol: () => '\n',
      getAll: () => ({}),
      getItem: (key: string) => (key === 'language' ? 'en' : false)
    },
    menu: {
      addRecentlyUsedDocument: vi.fn(),
      addEditorMenu: vi.fn(),
      updateLineEndingMenu: vi.fn(),
      setActiveWindow: vi.fn()
    },
    env: { paths: { userDataPath: '/scratch/profile' } },
    editorBufferStore: { getUnUsedBufferUUID: () => 'scratch-buffer' }
  } as unknown as Accessor
  const editor = new EditorWindow(accessor)
  const contents = Object.assign(new EventEmitter(), { send: vi.fn() })
  const win = { webContents: contents } as unknown as BrowserWindow
  editor.browserWindow = win
  editor.lifecycle = WindowLifecycle.READY
  return { editor, win, send: contents.send, accessor }
}

describe('incoming documents during window close', () => {
  beforeEach(() => {
    mocks.emit.mockReset()
    mocks.load.mockReset()
    mocks.quit.mockReset()
  })

  it('routes populated untitled source away from a prepared renderer and resumes normal routing after cancellation', () => {
    const { editor, win, send } = makeEditor()
    mocks.preparing.add(win)
    editor.openUntitledTab(false, 'a{++b++}\r\n{>>keep<<}\r\n')
    expect(send).not.toHaveBeenCalled()
    expect(mocks.emit).toHaveBeenCalledWith('app-create-editor-window', {
      markdown: [{ selected: false, markdown: 'a{++b++}\r\n{>>keep<<}\r\n' }]
    })
    mocks.preparing.delete(win)
    editor.openUntitledTab(true, 'after cancel')
    expect(send).toHaveBeenCalledWith('mt::new-untitled-tab', true, 'after cancel')
  })

  it('routes the loaded document without rereading when the read finishes after preparation', async() => {
    const { editor, win, send } = makeEditor()
    let finish!: (doc: unknown) => void
    mocks.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const options = { cursor: { line: 3, ch: 4 }, preserve: true }
    const doc = {
      pathname: '/scratch/incoming.md',
      markdown: 'raw {~~old~>new~~}\r\n',
      encoding: 'utf16le',
      bom: true
    }
    editor.openTab('/scratch/incoming.md', options, false)
    mocks.preparing.add(win)
    finish(doc)
    await Promise.resolve()
    expect(send).not.toHaveBeenCalled()
    expect(mocks.emit).toHaveBeenCalledWith('app-create-editor-window', {
      files: [{ doc, options, selected: false }]
    })
    expect(mocks.load).toHaveBeenCalledTimes(1)
  })
  it('delivers redirected source, loaded bytes and selection only after the replacement window loads', async() => {
    const origin = makeEditor()
    const destination = makeEditor()
    const replacement = destination.editor.createWindow()
    const send = vi.mocked(replacement.webContents.send)
    mocks.emit.mockImplementation((channel, request: PendingEditorOpen) => {
      if (channel === 'app-create-editor-window') destination.editor.openPending(request)
    })
    const doc = {
      pathname: '/scratch/loaded.md',
      filename: 'loaded.md',
      markdown: 'literal {>>comment<<}\r\n',
      encoding: { encoding: 'utf16le', isBom: true },
      lineEnding: 'crlf' as const,
      adjustLineEndingOnSave: false,
      trimTrailingNewline: 0,
      isMixedLineEndings: false
    }
    const options = { cursor: { line: 2, ch: 8 } }
    mocks.load.mockResolvedValue(doc)
    mocks.preparing.add(origin.win)
    origin.editor.openTab(doc.pathname, options, false)
    origin.editor.openUntitledTab(false, 'incoming {++unsaved++}\r\n')
    await Promise.resolve()
    expect(send).not.toHaveBeenCalled()
    replacement.webContents.emit('did-finish-load')
    expect(send).toHaveBeenCalledWith('mt::open-new-tab', doc, options, false)
    expect(send).toHaveBeenCalledWith('mt::new-untitled-tab', false, 'incoming {++unsaved++}\r\n')
    expect(send).toHaveBeenCalledWith(
      'mt::bootstrap-editor',
      expect.objectContaining({ addBlankTab: false })
    )
    expect(mocks.load).toHaveBeenCalledTimes(1)
    expect(origin.send).not.toHaveBeenCalled()
  })

  it('preserves provided startup Markdown through the pending queue', () => {
    const { editor } = makeEditor()
    const replacement = editor.createWindow(null, [], ['raw {~~a~>b~~}\r\n'])
    replacement.webContents.emit('did-finish-load')
    expect(replacement.webContents.send).toHaveBeenCalledWith(
      'mt::new-untitled-tab',
      true,
      'raw {~~a~>b~~}\r\n'
    )
  })

  it('preserves an in-flight loaded document even if its former window is destroyed before the read finishes', async() => {
    const { editor, send } = makeEditor()
    let finish!: (doc: unknown) => void
    mocks.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const doc = { pathname: '/scratch/in-flight.md', markdown: 'already read source' }
    editor.openTab(doc.pathname, { encoding: 'unchanged' }, true)
    editor.lifecycle = WindowLifecycle.QUITTED
    editor.browserWindow = null
    finish(doc)
    await Promise.resolve()
    expect(send).not.toHaveBeenCalled()
    expect(mocks.emit).toHaveBeenCalledWith('app-create-editor-window', {
      files: [{ doc, options: { encoding: 'unchanged' }, selected: true }]
    })
  })

  it.each([false, true])(
    'never chooses a preparing window or discards its already-open file; other editor: %s',
    (otherEditor) => {
      const closing = makeEditor()
      closing.editor.id = 1
      const menu = {
        has: () => true,
        addDefaultMenu: vi.fn(),
        setActiveWindow: vi.fn(),
        removeWindowMenu: vi.fn(),
        updateAlwaysOnTopMenu: vi.fn()
      }
      const manager = new WindowManager(menu, closing.accessor.preferences, {
        handleClose: vi.fn()
      })
      manager.add(closing.editor)
      closing.editor.addToOpenedFiles('/scratch/again.md')
      if (otherEditor) {
        const other = makeEditor()
        other.editor.id = 2
        manager.add(other.editor)
      }
      mocks.preparing.add(closing.win)
      expect(manager.findBestWindowToOpenIn(['/scratch/again.md'])).toEqual([
        { windowId: otherEditor ? 2 : null, fileList: ['/scratch/again.md'] }
      ])
      mocks.preparing.delete(closing.win)
      if (!otherEditor) {
        expect(manager.findBestWindowToOpenIn(['/scratch/again.md'])).toEqual([
          { windowId: 1, fileList: ['/scratch/again.md'] }
        ])
      }
    }
  )

  it.each([
    'app-open-markdown-by-id',
    'app-open-file-by-id',
    'app-open-files-by-id',
    'mt::open-file-by-window-id'
  ])('retains an incoming request after its former window is removed: %s', async(channel) => {
    vi.useFakeTimers()
    try {
      const { accessor } = makeEditor()
      const add = vi.fn()
      accessor.windowManager = {
        get: () => undefined,
        add,
        windowCount: 1
      } as unknown as WindowManager
      registerApplication(accessor)
      const listener = mocks.listeners.get(channel)
      if (!listener) throw new Error('Missing application open handler')
      const markdown = 'unsaved {++raw++}\r\n'
      const doc = { pathname: '/scratch/late.md', markdown: 'loaded file' }
      mocks.load.mockResolvedValue(doc)
      if (channel === 'mt::open-file-by-window-id') listener({}, 99, doc.pathname)
      else {
        listener(
          99,
          channel === 'app-open-markdown-by-id'
            ? markdown
            : channel === 'app-open-files-by-id'
              ? [doc.pathname]
              : doc.pathname
        )
      }
      expect(add).toHaveBeenCalledTimes(1)
      await vi.runAllTimersAsync()
      const target = add.mock.calls[0]![0] as EditorWindow
      target.browserWindow!.webContents.emit('did-finish-load')
      if (channel === 'app-open-markdown-by-id') {
        expect(target.browserWindow!.webContents.send).toHaveBeenCalledWith(
          'mt::new-untitled-tab',
          true,
          markdown
        )
        expect(mocks.load).not.toHaveBeenCalled()
      } else {
        expect(target.browserWindow!.webContents.send).toHaveBeenCalledWith(
          'mt::open-new-tab',
          doc,
          {},
          true
        )
        expect(mocks.load).toHaveBeenCalledTimes(1)
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the application new-window handler to carry loaded content and options into its pending queue', () => {
    const { accessor } = makeEditor()
    const add = vi.fn()
    accessor.windowManager = { add, windowCount: 1 } as unknown as WindowManager
    registerApplication(accessor)
    const listener = mocks.listeners.get('app-create-editor-window')
    if (!listener) throw new Error('Missing application new-window handler')
    const doc = {
      pathname: '/scratch/loaded.md',
      markdown: 'source already loaded {++once++}\r\n',
      encoding: { encoding: 'utf16le', isBom: true }
    }
    const options = { cursor: { line: 4, ch: 2 }, unchanged: true }
    listener({
      files: [{ doc, options, selected: false }],
      markdown: [{ markdown: 'unsaved', selected: true }]
    })
    const target = add.mock.calls[0]![0] as EditorWindow
    target.browserWindow!.webContents.emit('did-finish-load')
    expect(target.browserWindow!.webContents.send).toHaveBeenCalledWith(
      'mt::open-new-tab',
      doc,
      options,
      false
    )
    expect(target.browserWindow!.webContents.send).toHaveBeenCalledWith(
      'mt::new-untitled-tab',
      true,
      'unsaved'
    )
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('keeps an ordinary loaded file in its window and switches existing files without reading twice', async() => {
    const { editor, send } = makeEditor()
    const doc = { pathname: '/scratch/existing.md', markdown: 'unchanged source' }
    const options = { cursor: { line: 3, ch: 8 } }
    mocks.load.mockResolvedValue(doc)
    editor.openTab(doc.pathname, options, false)
    await Promise.resolve()
    expect(send).toHaveBeenCalledWith('mt::open-new-tab', doc, options, false)
    editor.openTab(doc.pathname)
    expect(send).toHaveBeenCalledWith('mt::switch-tab-by-file_path', doc.pathname)
    expect(mocks.load).toHaveBeenCalledTimes(1)
    expect(mocks.emit).not.toHaveBeenCalledWith('app-create-editor-window', expect.anything())
  })
  it('drains pending reads before destroying the last window and registers their replacement before app quit', async() => {
    const { editor, accessor } = makeEditor()
    const menu = Object.assign(accessor.menu, {
      has: () => true,
      addDefaultMenu: vi.fn(),
      removeWindowMenu: vi.fn(),
      updateAlwaysOnTopMenu: vi.fn()
    })
    const manager = new WindowManager(menu, accessor.preferences, { handleClose: vi.fn() })
    accessor.windowManager = manager
    registerApplication(accessor)
    const origin = editor.createWindow()
    manager.add(editor)
    origin.webContents.emit('did-finish-load')
    mocks.emit.mockImplementation((channel, ...args: unknown[]) =>
      mocks.listeners.get(channel)?.(...args)
    )
    let finish!: (doc: unknown) => void
    mocks.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const doc = {
      pathname: '/scratch/held.md',
      markdown: 'exact {++read++}\r\n',
      encoding: { encoding: 'utf16le', isBom: true }
    }
    const options = { cursor: { line: 5, ch: 2 } }
    editor.openTab(doc.pathname, options, false)
    mocks.preparing.add(origin)
    const close = mocks.listeners.get('window-close-by-id')
    if (!close) throw new Error('Missing internal close handler')
    const closing = close(origin.id)
    try {
      close(origin.id)
      await Promise.resolve()
      expect(origin.destroy).not.toHaveBeenCalled()
      expect(mocks.quit).not.toHaveBeenCalled()
    } finally {
      finish(doc)
      await closing
      await Promise.resolve()
    }
    expect(origin.destroy).toHaveBeenCalledTimes(1)
    expect(manager.get(origin.id)).toBeUndefined()
    expect(manager.windowCount).toBe(1)
    const replacement = [...manager.windows.values()][0] as EditorWindow
    replacement.browserWindow!.webContents.emit('did-finish-load')
    expect(replacement.browserWindow!.webContents.send).toHaveBeenCalledWith(
      'mt::open-new-tab',
      doc,
      options,
      false
    )
    expect(mocks.quit).not.toHaveBeenCalled()
    expect(mocks.load).toHaveBeenCalledTimes(1)
  })

  it('also drains a second read arriving while the first read is settling', async() => {
    const { editor, win, send } = makeEditor()
    const finishes: ((doc: unknown) => void)[] = []
    mocks.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishes.push(resolve)
        })
    )
    editor.openTab('/scratch/first.md')
    mocks.preparing.add(win)
    const closed = vi.fn()
    const closing = editor.withPendingFilesOpened(closed)
    editor.openTab('/scratch/second.md', { preserve: true }, false)
    const first = { pathname: '/scratch/first.md', markdown: 'first exact' }
    const second = { pathname: '/scratch/second.md', markdown: 'second {++exact++}' }
    try {
      finishes[0]!(first)
      await vi.waitFor(() =>
        expect(mocks.emit).toHaveBeenCalledWith('app-create-editor-window', {
          files: [{ doc: first, options: {}, selected: true }]
        })
      )
      expect(closed).not.toHaveBeenCalled()
    } finally {
      finishes[1]!(second)
      await closing
    }
    expect(mocks.emit).toHaveBeenCalledWith('app-create-editor-window', {
      files: [{ doc: second, options: { preserve: true }, selected: false }]
    })
    expect(closed).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  it('reports a failed read before allowing its close continuation', async() => {
    const { editor, send } = makeEditor()
    mocks.load.mockRejectedValue(new Error('read failed'))
    editor.openTab('/scratch/unreadable.md')
    const close = vi.fn(() => {
      expect(send).toHaveBeenCalledWith(
        'mt::show-notification',
        expect.objectContaining({ type: 'error', message: 'read failed' })
      )
    })
    await editor.withPendingFilesOpened(close)
    expect(close).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalledWith(
      'mt::open-new-tab',
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })
})
