import { beforeEach, describe, expect, it, vi } from 'vitest'

// Rename, Move-To, and Pandoc import are user-initiated file operations: when
// one fails, the user MUST be told — a log line in a file nobody watches is a
// silent failure, and the user walks away believing the file was renamed,
// moved, or imported. Move-To must also survive crossing volumes (plain
// fs.rename fails EXDEV there 100% of the time).

const { handlers, showMessageBox, showSaveDialog, fromWebContents, fromId, move, pandocMock } =
  vi.hoisted(() => {
    const pandocConverter = vi.fn()
    const pandocFn = Object.assign(
      vi.fn(() => pandocConverter),
      { exists: vi.fn(() => true), converter: pandocConverter }
    )
    return {
      handlers: new Map<string, (...args: unknown[]) => unknown>(),
      showMessageBox: vi.fn(),
      showSaveDialog: vi.fn(),
      fromWebContents: vi.fn(),
      fromId: vi.fn(),
      move: vi.fn(),
      pandocMock: pandocFn
    }
  })

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents, fromId },
  app: { on: vi.fn(), getPath: vi.fn(() => '/tmp') },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  dialog: { showMessageBox, showSaveDialog, showOpenDialog: vi.fn() },
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener)
    },
    handle: vi.fn(),
    emit: vi.fn(() => true)
  }
}))

vi.mock('electron-log', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('fs-extra', () => ({
  rename: vi.fn(),
  move
}))
vi.mock('common/filesystem', () => ({
  isDirectory: vi.fn(() => false),
  isFile: vi.fn(() => false),
  exists: vi.fn(async() => false)
}))
vi.mock('main_renderer/menu/actions/marktext', () => ({
  checkUpdates: vi.fn(),
  userSetting: vi.fn()
}))
vi.mock('main_renderer/menu/actions/view', () => ({ showTabBar: vi.fn() }))
vi.mock('main_renderer/commands', () => ({ COMMANDS: {} }))
vi.mock('main_renderer/filesystem', () => ({
  normalizeAndResolvePath: vi.fn((p: string) => p),
  writeFile: vi.fn()
}))
vi.mock('main_renderer/filesystem/markdown', () => ({ writeMarkdownFile: vi.fn() }))
vi.mock('main_renderer/utils', () => ({
  getPath: vi.fn(() => '/tmp/documents'),
  getRecommendTitleFromMarkdownString: vi.fn(() => '')
}))
vi.mock('main_renderer/utils/pandoc', () => ({ default: pandocMock }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

const fileActions = await import('main_renderer/menu/actions/file')

const makeWin = () => ({ id: 3, webContents: { send: vi.fn() } })

const notificationsOf = (win: ReturnType<typeof makeWin>) =>
  win.webContents.send.mock.calls.filter(([channel]) => channel === 'mt::show-notification')

const setPathnamesOf = (win: ReturnType<typeof makeWin>) =>
  win.webContents.send.mock.calls.filter(([channel]) => channel === 'mt::set-pathname')

const drive = async(channel: string, ...args: unknown[]): Promise<void> => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`${channel} handler was not registered`)
  await handler(...args)
  await new Promise((resolve) => setImmediate(resolve))
}

describe('file operations surface their failures to the user', () => {
  let win: ReturnType<typeof makeWin>

  beforeEach(() => {
    vi.clearAllMocks()
    win = makeWin()
    fromWebContents.mockReturnValue(win)
    fromId.mockReturnValue(win)
  })

  it('a failing rename notifies the user and does not update the tab path', async() => {
    move.mockRejectedValue(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }))

    await drive('mt::rename', { sender: win.webContents }, {
      id: 'tab-1',
      pathname: '/x/a.md',
      newPathname: '/x/b.md'
    })

    expect(setPathnamesOf(win)).toHaveLength(0)
    const notes = notificationsOf(win)
    expect(notes).toHaveLength(1)
    expect((notes[0][1] as { type: string }).type).toBe('error')
    expect((notes[0][1] as { message: string }).message).toContain('EACCES')
  })

  it('a successful rename updates the tab path and shows no error', async() => {
    move.mockResolvedValue(undefined)

    await drive('mt::rename', { sender: win.webContents }, {
      id: 'tab-1',
      pathname: '/x/a.md',
      newPathname: '/x/b.md'
    })

    expect(setPathnamesOf(win)).toHaveLength(1)
    expect(notificationsOf(win)).toHaveLength(0)
  })

  it('Move-To works across volumes (cross-device-safe move, not plain rename)', async() => {
    // fs.rename fails EXDEV across mount points; fs-extra move handles it via
    // copy+unlink. The handler must use the latter.
    move.mockResolvedValue(undefined)
    showSaveDialog.mockResolvedValue({ filePath: '/otherdrive/a.md', canceled: false })

    await drive('mt::response-file-move-to', { sender: win.webContents }, { id: 'tab-1', pathname: '/x/a.md' })

    expect(move).toHaveBeenCalledWith('/x/a.md', '/otherdrive/a.md')
    expect(setPathnamesOf(win)).toHaveLength(1)
  })

  it('a failing Move-To notifies the user and does not update the tab path', async() => {
    move.mockRejectedValue(Object.assign(new Error('EXDEV: cross-device link'), { code: 'EXDEV' }))
    showSaveDialog.mockResolvedValue({ filePath: '/otherdrive/a.md', canceled: false })

    await drive('mt::response-file-move-to', { sender: win.webContents }, { id: 'tab-1', pathname: '/x/a.md' })

    expect(setPathnamesOf(win)).toHaveLength(0)
    const notes = notificationsOf(win)
    expect(notes).toHaveLength(1)
    expect((notes[0][1] as { type: string }).type).toBe('error')
  })

  it('a failing Pandoc import notifies the user', async() => {
    pandocMock.exists.mockReturnValue(true)
    pandocMock.converter.mockRejectedValue(new Error('pandoc: a.docx: openBinaryFile failed'))
    ;(
      await import('electron')
    ).dialog.showOpenDialog = vi.fn().mockResolvedValue({ filePaths: ['/x/a.docx'] }) as never

    await fileActions.importFile(win as never)
    await new Promise((resolve) => setImmediate(resolve))

    const notes = notificationsOf(win)
    expect(notes).toHaveLength(1)
    expect((notes[0][1] as { type: string }).type).toBe('error')
    expect((notes[0][1] as { message: string }).message).toContain('openBinaryFile')
  })
})
