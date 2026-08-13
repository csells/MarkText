import type { BrowserWindow, MenuItem, MenuItemConstructorOptions } from 'electron'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import {
  COMMANDS,
  CommandManager,
  type CommandCallback
} from 'main_renderer/commands'
import { loadParagraphCommands } from 'main_renderer/menu/actions/paragraph'
import paragraphMenu from 'main_renderer/menu/templates/paragraph'

const send = vi.fn()
const fakeWindow = {
  webContents: { send }
} as unknown as BrowserWindow
const registeredCommandIds: string[] = []
const submenu = paragraphMenu({
  getAccelerator: () => undefined
} as never).submenu as MenuItemConstructorOptions[]

const clickParagraphMenu = (label: string): void => {
  const item = submenu.find(candidate => candidate.label === label)
  if (typeof item?.click !== 'function') {
    throw new Error(`Paragraph menu item ${label} requires a click callback`)
  }
  item.click({} as MenuItem, fakeWindow, {} as KeyboardEvent)
}

describe('CriticMarkup Math Formula production surfaces', () => {
  beforeAll(() => {
    loadParagraphCommands({
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

  it('routes registered Math Formula command and Paragraph menu surface through the renderer paragraph-action channel', () => {
    const surfaces = [
      {
        itemId: 'command:paragraph.math-formula',
        invoke: () => CommandManager.execute(COMMANDS.PARAGRAPH_MATH_FORMULA, fakeWindow)
      },
      {
        itemId: 'menu-entry:menu.paragraph.mathBlock',
        invoke: () => clickParagraphMenu('menu.paragraph.mathBlock')
      }
    ] as const

    for (const { itemId, invoke } of surfaces) {
      send.mockClear()
      invoke()
      expect(send.mock.calls, itemId).toEqual([
        ['mt::editor-paragraph-action', { type: 'mathblock' }]
      ])
    }
  })
})
