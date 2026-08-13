import type { BrowserWindow, MenuItem, MenuItemConstructorOptions } from 'electron'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
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

describe('CriticMarkup Highlight formatting production surfaces', () => {
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

  it('routes registered Highlight command and Format menu surface through the renderer format-action channel', () => {
    const surfaces = [
      {
        itemId: 'command:format.highlight',
        invoke: () => CommandManager.execute(COMMANDS.FORMAT_HIGHLIGHT, fakeWindow)
      },
      {
        itemId: 'menu-entry:menu.format.highlight',
        invoke: () => clickFormatMenu('menu.format.highlight')
      }
    ] as const

    for (const { itemId, invoke } of surfaces) {
      send.mockClear()
      invoke()
      expect(send.mock.calls, itemId).toEqual([
        ['mt::editor-format-action', { type: 'mark' }]
      ])
    }
  })
})
