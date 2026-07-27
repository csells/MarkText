import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WindowLifecycle } from 'main_renderer/windows/base'

const mocks = vi.hoisted(() => {
  const didFinishLoad: Array<() => void> = []
  return {
    didFinishLoad,
    hosted: new Map<string, {
      documentId: string
      filename: string
      pathname: string | null
    }>(),
    describeDocumentCoreFile: vi.fn(),
    ipcEmit: vi.fn(),
    listDocumentCoreRecoveryWindows:
      vi.fn<() => Promise<readonly unknown[]>>(async() => []),
    loadMarkdownFile: vi.fn(),
    openDocumentCoreFile: vi.fn(),
    recoverDocumentCoreFile: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/documents')
  },
  BrowserWindow: vi.fn()
}))

vi.mock('electron-log', () => ({
  default: {
    error: vi.fn()
  }
}))

vi.mock('electron-window-state', () => ({
  default: vi.fn()
}))

vi.mock('main_renderer/windows/utils', () => ({
  ensureWindowPosition: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn()
}))

vi.mock('main_renderer/contextMenu/editor', () => ({
  showEditorContextMenu: vi.fn()
}))

vi.mock('main_renderer/spellchecker', () => ({
  switchLanguage: vi.fn()
}))

vi.mock('main_renderer/presentationPolicy', () => ({
  presentationPolicy: {
    bringToFront: vi.fn(),
    deriveWindowOptions: vi.fn((value: unknown) => value),
    showMessageBox: vi.fn()
  }
}))

vi.mock('main_renderer/exceptionReporting', () => ({
  exceptionReporter: {
    handle: vi.fn()
  }
}))

vi.mock('main_renderer/filesystem/markdown', () => ({
  getDocumentCoreFileSnapshot: vi.fn(() => null),
  loadMarkdownFile: mocks.loadMarkdownFile
}))

vi.mock('main_renderer/ipc/documentCore', () => ({
  describeDocumentCoreFile: mocks.describeDocumentCoreFile,
  listDocumentCoreRecoveryWindows: mocks.listDocumentCoreRecoveryWindows,
  openDocumentCoreFile: mocks.openDocumentCoreFile,
  recoverDocumentCoreFile: mocks.recoverDocumentCoreFile
}))

vi.mock('main_renderer/utils/internalIpc', () => ({
  emitInternalChannel: mocks.ipcEmit
}))

const { default: EditorWindow } = await import(
  'main_renderer/windows/editor'
)

const preferences = {
  getAll: vi.fn(() => ({
    footnotes: false,
    gitLabMath: false,
    restoreLayoutState: true,
    sideBarVisibility: true,
    sourceCodeModeEnabled: false,
    subscriptAndSuperscript: false,
    tabBarVisibility: true
  })),
  setItems: vi.fn()
}

const makeAccessor = () => {
  const readBufferStoreFile = vi.fn()
  return {
    accessor: {
      editorBufferStore: {
        getBufferStoreInfo: vi.fn(() => ({
          id: 'window-buffer',
          filePath: '/state/window-buffer.json'
        })),
        readBufferStoreFile
      },
      menu: {
        addRecentlyUsedDocument: vi.fn()
      },
      preferences
    },
    readBufferStoreFile
  }
}

const makeBrowserWindow = () => {
  const send = vi.fn()
  const reload = vi.fn()
  const webContents = {
    id: 41,
    once: vi.fn((event: string, listener: () => void) => {
      if (event === 'did-finish-load') mocks.didFinishLoad.push(listener)
    }),
    send
  }
  return {
    browserWindow: {
      reload,
      webContents
    },
    reload,
    send
  }
}

describe('main-owned renderer reload reattachment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.didFinishLoad.length = 0
    mocks.hosted.clear()
    mocks.loadMarkdownFile.mockResolvedValue({
      markdown: 'alpha\n',
      filename: 'alpha.md',
      pathname: '/workspace/alpha.md'
    })
    let nextId = 0
    mocks.openDocumentCoreFile.mockImplementation(
      async(
        _sender: unknown,
        _durableWindowId: string,
        request: {
          filename: string
          pathname: string | null
        }
      ) => {
        const opened = {
          documentId: `document:${++nextId}`,
          filename: request.filename,
          pathname: request.pathname
        }
        mocks.hosted.set(opened.documentId, opened)
        return opened
      }
    )
    mocks.describeDocumentCoreFile.mockImplementation(
      (_sender: unknown, documentId: string) => {
        const hosted = mocks.hosted.get(documentId)
        if (hosted === undefined) throw new Error('Unknown document')
        return hosted
      }
    )
  })

  it('reattaches retained ids and restores the selected tab and watchers without admitting a blank', async() => {
    const { accessor, readBufferStoreFile } = makeAccessor()
    const { browserWindow, reload, send } = makeBrowserWindow()
    const editor = new EditorWindow(accessor as never)
    editor.id = 17
    editor.browserWindow = browserWindow as never
    editor.lifecycle = WindowLifecycle.READY
    editor.bufferStoreInfo = {
      id: 'window-buffer',
      filePath: null
    }

    editor.openFolder('/workspace')
    await editor.admitProjectFile('/workspace/alpha.md')
    editor.openUntitledTab(true, 'bravo\n')
    await vi.waitFor(() => expect(mocks.openDocumentCoreFile).toHaveBeenCalledTimes(2))

    const descriptors = send.mock.calls
      .filter(([channel]) => channel === 'mt::document-core::tab-opened')
      .map(([, descriptor]) => descriptor as {
        documentId: string
        filename: string
        pathname: string | null
        selected: boolean
      })
    expect(descriptors).toHaveLength(2)
    const [fileTab, untitledTab] = descriptors
    if (fileTab === undefined || untitledTab === undefined) {
      throw new Error('Expected both admitted documents')
    }

    readBufferStoreFile.mockReturnValue({
      schema: 'document-core-window-ui-1',
      currentDocumentId: fileTab.documentId,
      tabs: [
        { documentId: fileTab.documentId, scrollTop: 90 },
        { documentId: untitledTab.documentId, scrollTop: 12 }
      ],
      project: { rootDirectory: '/workspace' },
      layout: {
        rightColumn: 'files',
        showSideBar: true,
        showTabBar: true,
        sideBarWidth: 280
      }
    })
    send.mockClear()
    mocks.ipcEmit.mockClear()

    editor.reload()

    expect(reload).toHaveBeenCalledOnce()
    expect(editor.openedRootDirectory).toBe('/workspace')
    expect(mocks.ipcEmit).toHaveBeenCalledWith(
      'watcher-unwatch-all-by-id',
      17
    )
    expect(mocks.didFinishLoad).toHaveLength(1)
    mocks.didFinishLoad[0]?.()

    expect(mocks.ipcEmit).toHaveBeenCalledWith(
      'watcher-watch-directory',
      browserWindow,
      '/workspace'
    )
    expect(mocks.ipcEmit).toHaveBeenCalledWith(
      'watcher-watch-file',
      browserWindow,
      '/workspace/alpha.md'
    )
    expect(send).toHaveBeenCalledWith(
      'mt::open-directory',
      '/workspace'
    )
    expect(send).toHaveBeenCalledWith(
      'mt::document-core::restore-window-ui',
      expect.objectContaining({
        currentDocumentId: fileTab.documentId,
        tabs: [
          { documentId: fileTab.documentId, scrollTop: 90 },
          { documentId: untitledTab.documentId, scrollTop: 12 }
        ],
        project: { rootDirectory: '/workspace' }
      })
    )
    expect(send.mock.calls
      .filter(([channel]) => channel === 'mt::document-core::tab-opened')
      .map(([, descriptor]) => descriptor)
    ).toEqual([
      { ...fileTab, selected: true },
      { ...untitledTab, selected: false }
    ])
    expect(mocks.openDocumentCoreFile).toHaveBeenCalledTimes(2)
  })

  it('restores a just-admitted document from the main registry without a renderer checkpoint', async() => {
    mocks.listDocumentCoreRecoveryWindows.mockResolvedValue([{
      schema: 'document-core-recovery-window-1',
      durableWindowId: 'window-buffer',
      documentIds: ['document:crash']
    }])
    mocks.recoverDocumentCoreFile.mockResolvedValue({
      schema: 'document-core-recovered-file-1',
      documentId: 'document:crash',
      filename: 'crash.md',
      pathname: '/workspace/crash.md',
      externalConflict: false
    })
    const { accessor, readBufferStoreFile } = makeAccessor()
    const { browserWindow, send } = makeBrowserWindow()
    const editor = new EditorWindow(accessor as never)
    editor.id = 17
    editor.browserWindow = browserWindow as never
    editor.lifecycle = WindowLifecycle.READY
    editor.bufferStoreInfo = {
      id: 'window-buffer',
      filePath: null
    }

    await (
      editor as unknown as {
        _restoreAllState(): Promise<void>
      }
    )._restoreAllState()

    expect(readBufferStoreFile).not.toHaveBeenCalled()
    expect(mocks.recoverDocumentCoreFile).toHaveBeenCalledWith(
      browserWindow.webContents,
      'window-buffer',
      expect.objectContaining({
        documentId: 'document:crash'
      })
    )
    expect(send).toHaveBeenCalledWith(
      'mt::document-core::restore-window-ui',
      expect.objectContaining({
        currentDocumentId: 'document:crash',
        tabs: [{
          documentId: 'document:crash',
          scrollTop: 0
        }]
      })
    )
    expect(send).toHaveBeenCalledWith(
      'mt::document-core::tab-opened',
      {
        schema: 'document-core-tab-1',
        documentId: 'document:crash',
        filename: 'crash.md',
        pathname: '/workspace/crash.md',
        selected: true
      }
    )
  })

  it('sanitizes a forged reload checkpoint before directory, watcher, or document effects', async() => {
    const { accessor, readBufferStoreFile } = makeAccessor()
    const { browserWindow, send } = makeBrowserWindow()
    const editor = new EditorWindow(accessor as never)
    editor.id = 17
    editor.browserWindow = browserWindow as never
    editor.lifecycle = WindowLifecycle.READY
    editor.bufferStoreInfo = {
      id: 'window-buffer',
      filePath: null
    }

    editor.openFolder('/main/project')
    await editor.admitProjectFile('/main/project/alpha.md')
    const descriptor = send.mock.calls
      .find(([channel]) => channel === 'mt::document-core::tab-opened')
      ?.[1] as {
        documentId: string
        filename: string
        pathname: string | null
        selected: boolean
      } | undefined
    if (descriptor === undefined) {
      throw new Error('Expected an admitted document descriptor')
    }
    readBufferStoreFile.mockReturnValue({
      schema: 'document-core-window-ui-1',
      currentDocumentId: 'document:forged',
      tabs: [{
        documentId: 'document:forged',
        scrollTop: 900
      }],
      project: {
        rootDirectory: '/forged/project'
      },
      layout: {
        rightColumn: 'files',
        showSideBar: true,
        showTabBar: true,
        sideBarWidth: 280
      }
    })
    send.mockClear()
    mocks.ipcEmit.mockClear()
    mocks.recoverDocumentCoreFile.mockClear()

    editor.reload()
    mocks.didFinishLoad[0]?.()

    expect(mocks.recoverDocumentCoreFile).not.toHaveBeenCalled()
    expect(mocks.ipcEmit).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '/forged/project'
    )
    expect(send).not.toHaveBeenCalledWith(
      'mt::open-directory',
      '/forged/project'
    )
    expect(send).toHaveBeenCalledWith(
      'mt::open-directory',
      '/main/project'
    )
    expect(send).toHaveBeenCalledWith(
      'mt::document-core::restore-window-ui',
      expect.objectContaining({
        currentDocumentId: descriptor.documentId,
        tabs: [{
          documentId: descriptor.documentId,
          scrollTop: 0
        }],
        project: {
          rootDirectory: '/main/project'
        }
      })
    )
  })
})
