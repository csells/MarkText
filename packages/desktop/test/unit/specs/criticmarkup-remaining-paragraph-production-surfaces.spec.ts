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
const template = paragraphMenu({
  getAccelerator: () => undefined
} as never)
const submenu = template.submenu as MenuItemConstructorOptions[]

const clickParagraphMenu = (label: string): void => {
  const item = submenu.find(candidate => candidate.label === label)
  if (typeof item?.click !== 'function') {
    throw new Error(`Paragraph menu item ${label} requires a click callback`)
  }
  item.click({} as MenuItem, fakeWindow, {} as KeyboardEvent)
}

const remainingParagraphSurfaces = [
  {
    commandItemId: 'command:paragraph.degrade-heading',
    commandId: COMMANDS.PARAGRAPH_DEGRADE_HEADING,
    menuItemId: 'menu-entry:menu.paragraph.demoteHeading',
    menuLabel: 'menu.paragraph.demoteHeading',
    type: 'degrade heading'
  },
  {
    commandItemId: 'command:paragraph.front-matter',
    commandId: COMMANDS.PARAGRAPH_FRONT_MATTER,
    menuItemId: 'menu-entry:menu.paragraph.frontMatter',
    menuLabel: 'menu.paragraph.frontMatter',
    type: 'front-matter'
  },
  ...([1, 2, 3, 4, 5, 6] as const).map(level => ({
    commandItemId: `command:paragraph.heading-${level}`,
    commandId: COMMANDS[`PARAGRAPH_HEADING_${level}`],
    menuItemId: `menu-entry:menu.paragraph.heading${level}`,
    menuLabel: `menu.paragraph.heading${level}`,
    type: `heading ${level}`
  })),
  {
    commandItemId: 'command:paragraph.horizontal-line',
    commandId: COMMANDS.PARAGRAPH_HORIZONTAL_LINE,
    menuItemId: 'menu-entry:menu.paragraph.horizontalRule',
    menuLabel: 'menu.paragraph.horizontalRule',
    type: 'hr'
  },
  {
    commandItemId: 'command:paragraph.loose-list-item',
    commandId: COMMANDS.PARAGRAPH_LOOSE_LIST_ITEM,
    menuItemId: 'menu-entry:menu.paragraph.looseListItem',
    menuLabel: 'menu.paragraph.looseListItem',
    type: 'loose-list-item'
  },
  {
    commandItemId: 'command:paragraph.paragraph',
    commandId: COMMANDS.PARAGRAPH_PARAGRAPH,
    menuItemId: 'menu-entry:menu.paragraph.paragraph',
    menuLabel: 'menu.paragraph.paragraph',
    type: 'paragraph'
  },
  {
    commandItemId: 'command:paragraph.table',
    commandId: COMMANDS.PARAGRAPH_TABLE,
    menuItemId: 'menu-entry:menu.paragraph.table',
    menuLabel: 'menu.paragraph.table',
    type: 'table'
  },
  {
    commandItemId: 'command:paragraph.upgrade-heading',
    commandId: COMMANDS.PARAGRAPH_INCREASE_HEADING,
    menuItemId: 'menu-entry:menu.paragraph.promoteHeading',
    menuLabel: 'menu.paragraph.promoteHeading',
    type: 'upgrade heading'
  }
] as const

describe('CriticMarkup remaining Paragraph production surfaces', () => {
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

  it('covers remaining Paragraph command and menu entry production surfaces', () => {
    expect({
      itemId: 'menu-entry:menu.paragraph.title',
      templateId: template.id,
      label: template.label
    }).toEqual({
      itemId: 'menu-entry:menu.paragraph.title',
      templateId: 'paragraphMenuEntry',
      label: 'menu.paragraph.title'
    })

    for (const surface of remainingParagraphSurfaces) {
      send.mockClear()
      CommandManager.execute(surface.commandId, fakeWindow)
      expect(send.mock.calls, surface.commandItemId).toEqual([
        ['mt::editor-paragraph-action', { type: surface.type }]
      ])

      send.mockClear()
      clickParagraphMenu(surface.menuLabel)
      expect(send.mock.calls, surface.menuItemId).toEqual([
        ['mt::editor-paragraph-action', { type: surface.type }]
      ])
    }
  })
})
