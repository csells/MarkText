import type { BrowserWindow, MenuItem, MenuItemConstructorOptions } from 'electron'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  ipcMain: { emit: vi.fn(), on: vi.fn() }
}))
vi.mock('electron-log', () => ({
  default: { error: vi.fn() }
}))
vi.mock('main_renderer/config', () => ({ isOsx: false }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import {
  COMMANDS,
  CommandManager,
  type CommandCallback
} from 'main_renderer/commands'
import { loadEditCommands } from 'main_renderer/menu/actions/edit'
import editMenu from 'main_renderer/menu/templates/edit'

const send = vi.fn()
const fakeWindow = {
  webContents: {
    copy: vi.fn(),
    cut: vi.fn(),
    paste: vi.fn(),
    send
  }
} as unknown as BrowserWindow
const registeredCommandIds: string[] = []
const submenu = editMenu({
  getAccelerator: () => undefined
} as never).submenu as MenuItemConstructorOptions[]

const clickEditMenu = (label: string): void => {
  const item = submenu.find(candidate => candidate.label === label)
  if (typeof item?.click !== 'function') {
    throw new Error(`Edit menu item ${label} requires a click callback`)
  }
  item.click({} as MenuItem, fakeWindow, {} as KeyboardEvent)
}

describe('CriticMarkup Select All production surfaces', () => {
  beforeAll(() => {
    loadEditCommands({
      add(id: string, callback: CommandCallback): void {
        registeredCommandIds.push(id)
        CommandManager.add(id, callback)
      }
    } as never)
  })

  afterAll(() => {
    registeredCommandIds.forEach(id => {
      if (!CommandManager.remove(id)) {
        throw new Error(`Registered command disappeared before cleanup: ${id}`)
      }
    })
  })

  it('routes registered Select All command and Edit menu surfaces through the renderer edit-action channel', () => {
    const surfaces = [
      {
        itemId: 'command:edit.select-all',
        invoke: () => CommandManager.execute(COMMANDS.EDIT_SELECT_ALL, fakeWindow)
      },
      {
        itemId: 'menu-entry:menu.edit.selectAll',
        invoke: () => clickEditMenu('menu.edit.selectAll')
      }
    ] as const

    for (const { itemId, invoke } of surfaces) {
      send.mockClear()
      invoke()
      expect(send.mock.calls, itemId).toEqual([
        ['mt::editor-edit-action', 'selectAll']
      ])
    }
  })
})
