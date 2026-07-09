import { beforeEach, describe, expect, it, vi } from 'vitest'

// mt::close-window-confirm is the "save my work, then close the window" path.
// The window must be destroyed ONLY when every save verifiably succeeded: a
// failed disk write (disk full, read-only volume, disconnected cloud drive)
// or a canceled Save-As dialog must keep the window alive — destroying it
// anyway silently loses the user's edits while telling them they saved.

const { handlers, emitted, showMessageBox, showSaveDialog, fromWebContents, writeMarkdownFile } =
  vi.hoisted(() => ({
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    emitted: [] as Array<[string, ...unknown[]]>,
    showMessageBox: vi.fn(),
    showSaveDialog: vi.fn(),
    fromWebContents: vi.fn(),
    writeMarkdownFile: vi.fn()
  }))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents },
  app: { on: vi.fn(), getPath: vi.fn(() => '/tmp') },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  dialog: { showMessageBox, showSaveDialog, showOpenDialog: vi.fn() },
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener)
    },
    handle: vi.fn(),
    emit: (channel: string, ...args: unknown[]) => {
      emitted.push([channel, ...args])
      return true
    }
  }
}))

vi.mock('electron-log', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('fs-extra', () => ({ rename: vi.fn(), move: vi.fn() }))
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
vi.mock('main_renderer/filesystem/markdown', () => ({ writeMarkdownFile }))
vi.mock('main_renderer/utils', () => ({
  getPath: vi.fn(() => '/tmp/documents'),
  getRecommendTitleFromMarkdownString: vi.fn(() => '')
}))
vi.mock('main_renderer/utils/pandoc', () => ({ default: vi.fn() }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

await import('main_renderer/menu/actions/file')

const FAKE_WIN = { id: 7, webContents: { send: vi.fn() } }

const unsavedFile = (overrides: Record<string, unknown> = {}) => ({
  id: 'tab-1',
  filename: 'a.md',
  pathname: '/x/a.md',
  markdown: '# edited',
  options: {
    encoding: { encoding: 'utf8', isBom: false },
    lineEnding: 'lf',
    adjustLineEndingOnSave: false,
    trimTrailingNewline: 2
  },
  ...overrides
})

const driveCloseConfirm = async(files: unknown[]): Promise<void> => {
  const handler = handlers.get('mt::close-window-confirm')
  if (!handler) throw new Error('mt::close-window-confirm handler was not registered')
  await handler({ sender: {} }, files)
  // The save promise chain resolves in microtasks after the handler returns.
  await new Promise((resolve) => setImmediate(resolve))
}

const closeEmits = () => emitted.filter(([channel]) => channel === 'window-close-by-id')

describe('mt::close-window-confirm — the window closes only when saves verifiably succeed', () => {
  // The module registers its ipcMain handlers once at import; never clear
  // the handler map between tests — only the emit log and mock state.
  beforeEach(() => {
    emitted.length = 0
    vi.clearAllMocks()
    fromWebContents.mockReturnValue(FAKE_WIN)
  })

  it('closes the window after all saves succeed', async() => {
    showMessageBox.mockResolvedValueOnce({ response: 0 }) // Save
    writeMarkdownFile.mockResolvedValue(undefined)

    await driveCloseConfirm([unsavedFile()])

    expect(writeMarkdownFile).toHaveBeenCalledTimes(1)
    expect(closeEmits()).toHaveLength(1)
  })

  it('a failed write keeps the window open and surfaces the failure dialog', async() => {
    showMessageBox
      .mockResolvedValueOnce({ response: 0 }) // Save
      .mockResolvedValueOnce({ response: 1 }) // failure dialog: Keep Open
    writeMarkdownFile.mockRejectedValue(new Error('ENOSPC: no space left on device'))

    await driveCloseConfirm([unsavedFile()])

    expect(closeEmits()).toHaveLength(0)
    // The failure dialog (second showMessageBox) actually reached the user.
    expect(showMessageBox).toHaveBeenCalledTimes(2)
    const failureDialog = showMessageBox.mock.calls[1][1] as Record<string, unknown>
    expect(String(failureDialog.detail)).toContain('ENOSPC')
  })

  it('the failure dialog Close button still lets the user discard and close', async() => {
    showMessageBox
      .mockResolvedValueOnce({ response: 0 }) // Save
      .mockResolvedValueOnce({ response: 0 }) // failure dialog: Close
    writeMarkdownFile.mockRejectedValue(new Error('EACCES: permission denied'))

    await driveCloseConfirm([unsavedFile()])

    expect(closeEmits()).toHaveLength(1)
  })

  it('canceling the Save-As dialog keeps the window open (cancel means "wait")', async() => {
    showMessageBox.mockResolvedValueOnce({ response: 0 }) // Save
    // Untitled tab -> Save triggers the Save-As dialog; user cancels it.
    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined })

    await driveCloseConfirm([unsavedFile({ pathname: undefined })])

    expect(writeMarkdownFile).not.toHaveBeenCalled()
    expect(closeEmits()).toHaveLength(0)
  })
})
