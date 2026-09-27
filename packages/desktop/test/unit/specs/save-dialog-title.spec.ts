import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listeners, emit, fromWebContents, showSaveDialog, writeMarkdownFile, send } = vi.hoisted(
  () => ({
    listeners: new Map<string, (...args: unknown[]) => unknown>(),
    emit: vi.fn(),
    fromWebContents: vi.fn(),
    showSaveDialog: vi.fn(),
    writeMarkdownFile: vi.fn(),
    send: vi.fn()
  })
)

vi.mock('electron', () => ({
  app: { getPath: () => '/documents', quit: vi.fn() },
  BrowserWindow: { fromWebContents },
  dialog: { showMessageBox: vi.fn(), showOpenDialog: vi.fn(), showSaveDialog },
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
vi.mock('main_renderer/filesystem/markdown', () => ({ writeMarkdownFile }))
vi.mock('main_renderer/menu/actions/marktext', () => ({
  checkUpdates: vi.fn(),
  userSetting: vi.fn()
}))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

await import('main_renderer/menu/actions/file')

const win = { id: 7, webContents: { send } }
const event = { sender: win.webContents }
const options = { encoding: { encoding: 'utf8', isBom: false }, lineEnding: 'lf' }
const markdown = '```sh\n# not a heading\n```\n\n# Draft {++new++}{>>why<<}\n'
const suggested = () => showSaveDialog.mock.lastCall?.[1]?.defaultPath

describe('Save suggests the title Core reads from the document', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromWebContents.mockReturnValue(win)
    showSaveDialog.mockResolvedValue({ canceled: true })
    emit.mockImplementation((channel, _pathname, reply) => {
      if (channel === 'window-check-save-destination') reply(true)
    })
  })

  it.each(['mt::response-file-save', 'mt::response-file-save-as'])(
    '%s names a new file after the title the renderer sends',
    async(channel) => {
      await listeners.get(channel)!(
        event, 'tab', 'Untitled-1', '', markdown, options, '/project', null, 'Draft new'
      )
      expect(suggested()).toBe('/project/Draft new.md')
    }
  )

  it('never reads a title from the saved Markdown, which may hold CriticMarkup', async() => {
    await listeners.get('mt::response-file-save')!(
      event, 'tab', 'Untitled-1', '', markdown, options, '/project', null
    )
    expect(suggested()).toBe('/project/Untitled-1.md')
  })

  it('names each new file of a batch save after its own title', async() => {
    await listeners.get('mt::save-tabs')!(event, [
      { id: 'a', filename: 'Untitled-1', markdown, options, defaultPath: '/project', title: 'Draft new' },
      { id: 'b', filename: 'Untitled-2', markdown: '# Other\n', options, defaultPath: '/project' }
    ])
    await vi.waitFor(() => expect(showSaveDialog).toHaveBeenCalledTimes(2))
    expect(showSaveDialog.mock.calls.map((call) => call[1].defaultPath)).toEqual([
      '/project/Draft new.md',
      '/project/Untitled-2.md'
    ])
  })
})
