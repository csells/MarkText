import type { BrowserWindow } from 'electron'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('@/i18n', () => ({ t: (key: string) => key }))

import bus from '@/bus'
import {
  getCloseAll,
  getCloseOthers,
  getCloseSaved,
  getCloseThis,
  getCopyPath,
  getRENAME,
  getShowInFolder
} from '@/contextMenu/tabs/menuItems'
import {
  COMMANDS,
  CommandManager,
  type CommandCallback
} from 'main_renderer/commands'
import { loadTabCommands } from 'main_renderer/commands/tab'

const send = vi.fn()
const fakeWindow = {
  webContents: { send }
} as unknown as BrowserWindow
const registeredCommandIds: string[] = []

const commandSurfaces = [
  {
    itemId: 'command:tabs.cycleBackward',
    commandId: COMMANDS.TABS_CYCLE_BACKWARD,
    expected: ['mt::tabs-cycle-left']
  },
  {
    itemId: 'command:tabs.cycleForward',
    commandId: COMMANDS.TABS_CYCLE_FORWARD,
    expected: ['mt::tabs-cycle-right']
  },
  {
    itemId: 'command:tabs.switchToLeft',
    commandId: COMMANDS.TABS_SWITCH_TO_LEFT,
    expected: ['mt::tabs-cycle-left']
  },
  {
    itemId: 'command:tabs.switchToRight',
    commandId: COMMANDS.TABS_SWITCH_TO_RIGHT,
    expected: ['mt::tabs-cycle-right']
  },
  {
    itemId: 'command:tabs.switchToFirst',
    commandId: COMMANDS.TABS_SWITCH_TO_FIRST,
    expected: ['mt::switch-tab-by-index', 0]
  },
  {
    itemId: 'command:tabs.switchToSecond',
    commandId: COMMANDS.TABS_SWITCH_TO_SECOND,
    expected: ['mt::switch-tab-by-index', 1]
  },
  {
    itemId: 'command:tabs.switchToThird',
    commandId: COMMANDS.TABS_SWITCH_TO_THIRD,
    expected: ['mt::switch-tab-by-index', 2]
  },
  {
    itemId: 'command:tabs.switchToFourth',
    commandId: COMMANDS.TABS_SWITCH_TO_FOURTH,
    expected: ['mt::switch-tab-by-index', 3]
  },
  {
    itemId: 'command:tabs.switchToFifth',
    commandId: COMMANDS.TABS_SWITCH_TO_FIFTH,
    expected: ['mt::switch-tab-by-index', 4]
  },
  {
    itemId: 'command:tabs.switchToSixth',
    commandId: COMMANDS.TABS_SWITCH_TO_SIXTH,
    expected: ['mt::switch-tab-by-index', 5]
  },
  {
    itemId: 'command:tabs.switchToSeventh',
    commandId: COMMANDS.TABS_SWITCH_TO_SEVENTH,
    expected: ['mt::switch-tab-by-index', 6]
  },
  {
    itemId: 'command:tabs.switchToEighth',
    commandId: COMMANDS.TABS_SWITCH_TO_EIGHTH,
    expected: ['mt::switch-tab-by-index', 7]
  },
  {
    itemId: 'command:tabs.switchToNinth',
    commandId: COMMANDS.TABS_SWITCH_TO_NINTH,
    expected: ['mt::switch-tab-by-index', 8]
  },
  {
    itemId: 'command:tabs.switchToTenth',
    commandId: COMMANDS.TABS_SWITCH_TO_TENTH,
    expected: ['mt::switch-tab-by-index', 9]
  }
] as const

type TabMenuItem = Readonly<{
  click: (item: { _tabId: string }) => void
}>

const contextMenuSurfaces = [
  {
    itemId: 'menu-entry:contextMenu.tabs.close',
    item: getCloseThis,
    event: 'TABS::close-this',
    expectedPayload: 'tab-id'
  },
  {
    itemId: 'menu-entry:contextMenu.tabs.closeAllTabs',
    item: getCloseAll,
    event: 'TABS::close-all',
    expectedPayload: undefined
  },
  {
    itemId: 'menu-entry:contextMenu.tabs.closeOthers',
    item: getCloseOthers,
    event: 'TABS::close-others',
    expectedPayload: 'tab-id'
  },
  {
    itemId: 'menu-entry:contextMenu.tabs.closeSavedTabs',
    item: getCloseSaved,
    event: 'TABS::close-saved',
    expectedPayload: undefined
  },
  {
    itemId: 'menu-entry:contextMenu.tabs.copyPath',
    item: getCopyPath,
    event: 'TABS::copy-path',
    expectedPayload: 'tab-id'
  },
  {
    itemId: 'menu-entry:contextMenu.tabs.rename',
    item: getRENAME,
    event: 'TABS::rename',
    expectedPayload: 'tab-id'
  },
  {
    itemId: 'menu-entry:contextMenu.tabs.showInFolder',
    item: getShowInFolder,
    event: 'TABS::show-in-folder',
    expectedPayload: 'tab-id'
  }
] as const

describe('CriticMarkup Tabs production surfaces', () => {
  beforeAll(() => {
    loadTabCommands({
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

  it('routes every registered Tabs command to its exact renderer tab action', () => {
    for (const surface of commandSurfaces) {
      send.mockClear()
      CommandManager.execute(surface.commandId, fakeWindow)
      expect(send.mock.calls, surface.itemId).toEqual([surface.expected])
    }
  })

  it('routes every tab context-menu surface through its exact tab bus event', () => {
    for (const surface of contextMenuSurfaces) {
      const delivered = vi.fn()
      bus.on(surface.event, delivered)
      ;(surface.item() as TabMenuItem).click({ _tabId: 'tab-id' })
      expect(delivered.mock.calls, surface.itemId).toEqual([
        [surface.expectedPayload]
      ])
      bus.off(surface.event, delivered)
    }
  })
})
