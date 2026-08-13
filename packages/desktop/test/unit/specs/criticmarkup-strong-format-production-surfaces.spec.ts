import type { BrowserWindow, MenuItem, MenuItemConstructorOptions } from 'electron'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import {
  COMMANDS,
  CommandManager,
  type CommandCallback
} from 'main_renderer/commands'
import { loadFormatCommands } from 'main_renderer/menu/actions/format'
import formatMenu from 'main_renderer/menu/templates/format'

const send = vi.fn()
const fakeWindow = {
  webContents: { send }
} as unknown as BrowserWindow
const registeredCommandIds: string[] = []
const submenu = formatMenu({
  getAccelerator: () => undefined
} as never).submenu as MenuItemConstructorOptions[]

const clickFormatMenu = (label: string): void => {
  const item = submenu.find(candidate => candidate.label === label)
  if (typeof item?.click !== 'function') {
    throw new Error(`Format menu item ${label} requires a click callback`)
  }
  item.click({} as MenuItem, fakeWindow, {} as KeyboardEvent)
}

describe('CriticMarkup Strong formatting production surfaces', () => {
  beforeAll(() => {
    loadFormatCommands({
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

  it('routes registered Strong command and Bold menu surfaces through the renderer format-action channel', () => {
    const surfaces = [
      {
        itemId: 'command:format.strong',
        invoke: () => CommandManager.execute(COMMANDS.FORMAT_STRONG, fakeWindow)
      },
      {
        itemId: 'menu-entry:menu.format.bold',
        invoke: () => clickFormatMenu('menu.format.bold')
      }
    ] as const

    for (const { itemId, invoke } of surfaces) {
      send.mockClear()
      invoke()
      expect(send, itemId).toHaveBeenCalledTimes(1)
      expect(send, itemId).toHaveBeenCalledWith(
        'mt::editor-format-action',
        { type: 'strong' }
      )
    }
  })
})
