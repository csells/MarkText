import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listeners,
  emit,
  fromWebContents,
  showMessageBox,
  writeMarkdownFile,
  send
} = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => unknown>(),
  emit: vi.fn(),
  fromWebContents: vi.fn(),
  showMessageBox: vi.fn(),
  writeMarkdownFile: vi.fn(),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', quit: vi.fn() },
  BrowserWindow: { fromWebContents },
  dialog: {
    showMessageBox,
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  ipcMain: {
    emit,
    on(channel: string, listener: (...args: unknown[]) => unknown) {
      listeners.set(channel, listener)
    }
  },
  shell: { openExternal: vi.fn(), openPath: vi.fn() }
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))

vi.mock('main_renderer/filesystem/markdown', () => ({ writeMarkdownFile }))
vi.mock('main_renderer/menu/actions/marktext', () => ({
  checkUpdates: vi.fn(),
  userSetting: vi.fn()
}))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

await import('main_renderer/menu/actions/file')

const win = Object.freeze({ id: 41, webContents: { send } })
const event = Object.freeze({ sender: {} })
const unsavedFile = Object.freeze({
  id: 'tab-1',
  filename: 'note.md',
  pathname: '/tmp/note.md',
  markdown: 'acknowledged source',
  options: {
    encoding: { encoding: 'utf8', isBom: false },
    lineEnding: 'lf',
    adjustLineEndingOnSave: false,
    trimTrailingNewline: 2
  }
})

describe('mt::close-window-confirm save failure', () => {
  beforeEach(() => {
    emit.mockClear()
    send.mockClear()
    fromWebContents.mockReset()
    fromWebContents.mockReturnValue(win)
    showMessageBox.mockReset()
    showMessageBox
      .mockResolvedValueOnce({ response: 0 }) // Save.
      .mockResolvedValueOnce({ response: 1 }) // Keep the window open after failure.
    writeMarkdownFile.mockReset()
    writeMarkdownFile.mockRejectedValue(new Error('disk full'))
  })

  it('keeps the window open when a requested close cannot save every file', async() => {
    const handler = listeners.get('mt::close-window-confirm')
    if (handler === undefined) throw new Error('close-window-confirm handler was not registered')

    await handler(event, [unsavedFile])

    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith('mt::tab-save-failure', 'tab-1', 'disk full')
      expect(showMessageBox).toHaveBeenCalledTimes(2)
    })
    expect(emit).not.toHaveBeenCalledWith('window-close-by-id', win.id)
  })
})
