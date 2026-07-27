import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WindowLifecycle } from 'main_renderer/windows/base'
import {
  DocumentCoreFileAlreadyOpenError
} from 'main_renderer/documentCore/documentFileHost'

const mocks = vi.hoisted(() => ({
  emitInternalChannel: vi.fn(),
  loadMarkdownFile: vi.fn(),
  openDocumentCoreFile: vi.fn()
}))

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
  getDocumentCoreFileSnapshot: vi.fn(() => ({
    source: { text: '# One' }
  })),
  loadMarkdownFile: mocks.loadMarkdownFile
}))

vi.mock('main_renderer/ipc/documentCore', () => ({
  describeDocumentCoreFile: vi.fn(),
  listDocumentCoreRecoveryWindows: vi.fn(async() => []),
  openDocumentCoreFile: mocks.openDocumentCoreFile,
  recoverDocumentCoreFile: vi.fn()
}))

vi.mock('main_renderer/utils/internalIpc', () => ({
  emitInternalChannel: mocks.emitInternalChannel
}))

const { default: EditorWindow } = await import(
  'main_renderer/windows/editor'
)

describe('EditorWindow project document admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reserves a canonical path across asynchronous admission', async() => {
    const pathname = '/project/one.md'
    let releaseFirstLoad: () => void = () => {}
    const firstLoad = new Promise<void>(resolve => {
      releaseFirstLoad = resolve
    })
    const rawDocument = {
      markdown: '# One',
      filename: 'one.md',
      pathname
    }
    mocks.loadMarkdownFile
      .mockImplementationOnce(async() => {
        await firstLoad
        return rawDocument
      })
      .mockResolvedValue(rawDocument)
    mocks.openDocumentCoreFile.mockResolvedValue({
      documentId: 'document:1',
      filename: 'one.md',
      pathname
    })
    const send = vi.fn()
    const editor = new EditorWindow({
      menu: {
        addRecentlyUsedDocument: vi.fn()
      },
      preferences: {
        getAll: vi.fn(() => ({
          footnotes: false,
          gitLabMath: false,
          subscriptAndSuperscript: false
        }))
      }
    } as never)
    editor.lifecycle = WindowLifecycle.READY
    editor.browserWindow = {
      webContents: {
        send
      }
    } as never
    editor.bufferStoreInfo = {
      id: 'window-buffer:project',
      filePath: null
    }

    const first = editor.admitProjectFile(pathname)
    const second = editor.admitProjectFile(pathname)
    releaseFirstLoad()
    const results = await Promise.allSettled([first, second])

    expect(results.map(result => result.status)).toEqual([
      'fulfilled',
      'rejected'
    ])
    expect(
      results[1]?.status === 'rejected'
        ? results[1].reason
        : null
    ).toEqual(expect.objectContaining({
      message: expect.stringMatching(/already|progress/i)
    }))
    expect(mocks.loadMarkdownFile).toHaveBeenCalledOnce()
    expect(mocks.openDocumentCoreFile).toHaveBeenCalledOnce()
  })

  it('switches to the retained tab when a physical alias loses main admission', async() => {
    const retainedPathname = '/project/target.md'
    const aliasPathname = '/project/alias.md'
    mocks.loadMarkdownFile
      .mockResolvedValueOnce({
        markdown: '# One',
        filename: 'target.md',
        pathname: retainedPathname
      })
      .mockResolvedValueOnce({
        markdown: '# One',
        filename: 'alias.md',
        pathname: aliasPathname
      })
    mocks.openDocumentCoreFile
      .mockResolvedValueOnce({
        documentId: 'document:1',
        filename: 'target.md',
        pathname: retainedPathname
      })
      .mockRejectedValueOnce(new DocumentCoreFileAlreadyOpenError({
        schema: 'document-core-file-occupancy-1',
        documentId: 'document:1',
        ownerId: 'renderer:41',
        durableWindowId: 'window-buffer:project',
        pathname: retainedPathname
      }))
    const send = vi.fn()
    const editor = new EditorWindow({
      menu: {
        addRecentlyUsedDocument: vi.fn()
      },
      preferences: {
        getAll: vi.fn(() => ({
          footnotes: false,
          gitLabMath: false,
          subscriptAndSuperscript: false
        }))
      }
    } as never)
    editor.lifecycle = WindowLifecycle.READY
    editor.browserWindow = {
      webContents: {
        id: 41,
        send
      }
    } as never
    editor.bufferStoreInfo = {
      id: 'window-buffer:project',
      filePath: null
    }

    await editor.admitProjectFile(retainedPathname)
    send.mockClear()
    editor.openTab(aliasPathname)

    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        'mt::switch-tab-by-file_path',
        retainedPathname
      )
    })
    expect(send).not.toHaveBeenCalledWith(
      'mt::show-notification',
      expect.anything()
    )
  })

  it('brings forward the owning window when another window loses alias admission', async() => {
    const retainedPathname = '/project/target.md'
    const aliasPathname = '/project/alias.md'
    mocks.loadMarkdownFile
      .mockResolvedValueOnce({
        markdown: '# One',
        filename: 'target.md',
        pathname: retainedPathname
      })
      .mockResolvedValueOnce({
        markdown: '# One',
        filename: 'alias.md',
        pathname: aliasPathname
      })
    mocks.openDocumentCoreFile
      .mockResolvedValueOnce({
        documentId: 'document:1',
        filename: 'target.md',
        pathname: retainedPathname
      })
      .mockRejectedValueOnce(new DocumentCoreFileAlreadyOpenError({
        schema: 'document-core-file-occupancy-1',
        documentId: 'document:1',
        ownerId: 'renderer:41',
        durableWindowId: 'window-buffer:owner',
        pathname: retainedPathname
      }))
    const accessor = {
      menu: {
        addRecentlyUsedDocument: vi.fn()
      },
      preferences: {
        getAll: vi.fn(() => ({
          footnotes: false,
          gitLabMath: false,
          subscriptAndSuperscript: false
        }))
      },
      windowManager: {
        windows: new Map<number, InstanceType<typeof EditorWindow>>()
      }
    }
    const ownerSend = vi.fn()
    const owner = new EditorWindow(accessor as never)
    owner.id = 1
    owner.lifecycle = WindowLifecycle.READY
    owner.browserWindow = {
      webContents: {
        id: 41,
        send: ownerSend
      }
    } as never
    owner.bufferStoreInfo = {
      id: 'window-buffer:owner',
      filePath: null
    }
    accessor.windowManager.windows.set(1, owner)
    await owner.admitProjectFile(retainedPathname)

    const contenderSend = vi.fn()
    const contender = new EditorWindow(accessor as never)
    contender.id = 2
    contender.lifecycle = WindowLifecycle.READY
    contender.browserWindow = {
      webContents: {
        id: 42,
        send: contenderSend
      }
    } as never
    contender.bufferStoreInfo = {
      id: 'window-buffer:contender',
      filePath: null
    }
    accessor.windowManager.windows.set(2, contender)
    ownerSend.mockClear()

    contender.openTab(aliasPathname)

    await vi.waitFor(() => {
      expect(ownerSend).toHaveBeenCalledWith(
        'mt::switch-tab-by-file_path',
        retainedPathname
      )
    })
    expect(contenderSend).not.toHaveBeenCalledWith(
      'mt::show-notification',
      expect.anything()
    )
  })
})
