// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Plan 0012 G41: an edited save of a file whose bytes did not survive decoding
// asks before replacing them, through the real save IPC and the real writer.

const { listeners, emit, fromWebContents, showMessageBox, showSaveDialog, send } = vi.hoisted(
  () => ({
    listeners: new Map<string, (...args: unknown[]) => unknown>(),
    emit: vi.fn(),
    fromWebContents: vi.fn(),
    showMessageBox: vi.fn(),
    showSaveDialog: vi.fn(),
    send: vi.fn()
  })
)

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), quit: vi.fn() },
  BrowserWindow: { fromWebContents },
  dialog: { showMessageBox, showOpenDialog: vi.fn(), showSaveDialog },
  ipcMain: {
    handle: () => {},
    emit,
    on(channel: string, listener: (...args: unknown[]) => unknown) {
      listeners.set(channel, listener)
    }
  },
  shell: { openExternal: vi.fn(), openPath: vi.fn() }
}))
vi.mock('electron-log', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('main_renderer/menu/actions/marktext', () => ({
  checkUpdates: vi.fn(),
  userSetting: vi.fn()
}))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

await import('main_renderer/menu/actions/file')
const { loadMarkdownFile } = await import('main_renderer/filesystem/markdown')

const win = { id: 7, webContents: { send } }
const event = { sender: win.webContents }
const invalid = Buffer.from([0x6f, 0x6b, 0x20, 0xc3, 0x28, 0x20, 0xff, 0x0a])
const dirs: string[] = []

const openLossyFile = async() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mt-lossy-'))
  dirs.push(dir)
  const pathname = path.join(dir, 'doc.md')
  writeFileSync(pathname, invalid)
  const doc = await loadMarkdownFile(pathname, 'lf', false, 2, false)
  const options = {
    encoding: doc.encoding,
    lineEnding: doc.lineEnding,
    adjustLineEndingOnSave: doc.adjustLineEndingOnSave
  }
  return { dir, pathname, doc, options }
}

const save = (
  channel: 'mt::response-file-save' | 'mt::response-file-save-as',
  pathname: string,
  markdown: string,
  options: object
) => listeners.get(channel)!(event, 'tab', 'doc.md', pathname, markdown, options, undefined, null)

beforeEach(() => {
  vi.clearAllMocks()
  fromWebContents.mockReturnValue(win)
  emit.mockImplementation((channel, _pathname, reply) => {
    if (channel === 'window-check-save-destination') reply(false)
  })
})

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('saving a file whose bytes did not survive decoding', () => {
  it('keeps the file and the unsaved tab when the user cancels', async() => {
    const { pathname, doc, options } = await openLossyFile()
    showMessageBox.mockResolvedValue({ response: 0 })

    await save('mt::response-file-save', pathname, `${doc.markdown}more\n`, options)

    expect(showMessageBox).toHaveBeenCalledExactlyOnceWith(
      win,
      expect.objectContaining({
        title: 'dialog.lossyDecodeTitle',
        message: 'dialog.lossyDecodeMessage',
        detail: 'dialog.lossyDecodeDetail',
        buttons: ['dialog.cancel', 'dialog.saveAnyway'],
        cancelId: 0
      })
    )
    expect(readFileSync(pathname).equals(invalid)).toBe(true)
    expect(send).not.toHaveBeenCalled()
  })

  it('writes the edit when the user saves anyway', async() => {
    const { pathname, doc, options } = await openLossyFile()
    showMessageBox.mockResolvedValue({ response: 1 })
    const edited = `${doc.markdown}more\n`

    await save('mt::response-file-save', pathname, edited, options)

    expect(readFileSync(pathname).toString()).toBe(edited)
    expect(send).toHaveBeenCalledWith('mt::tab-saved', 'tab', null)
  })

  it('writes the original bytes without asking when nothing was edited', async() => {
    const { pathname, doc, options } = await openLossyFile()

    await save('mt::response-file-save', pathname, doc.markdown, options)

    expect(showMessageBox).not.toHaveBeenCalled()
    expect(readFileSync(pathname).equals(invalid)).toBe(true)
    expect(send).toHaveBeenCalledWith('mt::tab-saved', 'tab', null)
  })

  it('does not ask for Save As to another file, which leaves the original intact', async() => {
    const { dir, pathname, doc, options } = await openLossyFile()
    const copy = path.join(dir, 'copy.md')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: copy })

    await save('mt::response-file-save-as', pathname, `${doc.markdown}more\n`, options)

    expect(showMessageBox).not.toHaveBeenCalled()
    expect(readFileSync(copy).toString()).toBe(`${doc.markdown}more\n`)
    expect(readFileSync(pathname).equals(invalid)).toBe(true)
  })

  it('does not ask again when Save As replaces another such file the save dialog confirmed', async() => {
    const source = await openLossyFile()
    const target = await openLossyFile()
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target.pathname })

    await save('mt::response-file-save-as', source.pathname, 'replacement\n', source.options)

    expect(showMessageBox).not.toHaveBeenCalled()
    expect(readFileSync(target.pathname).toString()).toBe('replacement\n')
  })
})
