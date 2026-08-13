import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  ipcMain: { emit: vi.fn(), on: vi.fn() }
}))
vi.mock('electron-log', () => ({
  default: { error: vi.fn() }
}))
vi.mock('main_renderer/config', () => ({ isOsx: false }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import { COMMANDS, CommandManager } from 'main_renderer/commands'
import { loadEditCommands } from 'main_renderer/menu/actions/edit'
import editMenu from 'main_renderer/menu/templates/edit'

const editorWindow = (): Readonly<{
  browserWindow: BrowserWindow
  send: ReturnType<typeof vi.fn>
}> => {
  const send = vi.fn()
  return Object.freeze({
    browserWindow: {
      webContents: {
        copy: vi.fn(),
        cut: vi.fn(),
        paste: vi.fn(),
        send
      }
    } as unknown as BrowserWindow,
    send
  })
}

describe('CriticMarkup projected-copy production surfaces', () => {
  it('routes registered Copy as Rich and Copy as HTML commands to the editor', () => {
    const { browserWindow, send } = editorWindow()
    loadEditCommands(CommandManager)

    CommandManager.execute(COMMANDS.EDIT_COPY_AS_RICH, browserWindow)
    CommandManager.execute(COMMANDS.EDIT_COPY_AS_HTML, browserWindow)

    expect(send.mock.calls).toEqual([
      ['mt::editor-edit-action', 'copyAsRich'],
      ['mt::editor-edit-action', 'copyAsHtml']
    ])
  })

  it('routes Edit menu Copy as Rich and Copy as HTML entries to the editor', () => {
    const { browserWindow, send } = editorWindow()
    const submenu = editMenu({
      getAccelerator: () => undefined
    } as never).submenu as MenuItemConstructorOptions[]
    const click = (label: string): void => {
      const item = submenu.find(candidate => candidate.label === label)
      if (typeof item?.click !== 'function') {
        throw new Error(`Edit menu item ${label} requires a click callback`)
      }
      item.click({} as never, browserWindow, {} as never)
    }

    click('menu.edit.copyAsRich')
    click('menu.edit.copyAsHtml')

    expect(send.mock.calls).toEqual([
      ['mt::editor-edit-action', 'copyAsRich'],
      ['mt::editor-edit-action', 'copyAsHtml']
    ])
  })
})
