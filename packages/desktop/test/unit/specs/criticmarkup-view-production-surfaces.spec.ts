import type { BrowserWindow, MenuItem, MenuItemConstructorOptions } from 'electron'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { emit } = vi.hoisted(() => ({ emit: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { emit } }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import {
  COMMANDS,
  CommandManager,
  type CommandCallback
} from 'main_renderer/commands'
import { loadViewCommands } from 'main_renderer/menu/actions/view'
import viewMenuTemplate from 'main_renderer/menu/templates/view'

const send = vi.fn()
const toggleDevTools = vi.fn()
const fakeWindow = {
  id: 42,
  webContents: { send, toggleDevTools }
} as unknown as BrowserWindow
const registeredCommandIds: string[] = []
let viewMenu: MenuItemConstructorOptions
let submenu: MenuItemConstructorOptions[]
let previousDebug: boolean

type ExpectedEffect = Readonly<{
  send: readonly unknown[][]
  emit: readonly unknown[][]
  toggleDevTools: readonly unknown[][]
}>

const expectedEffect = (
  effect: Partial<ExpectedEffect>
): ExpectedEffect => ({
  send: [],
  emit: [],
  toggleDevTools: [],
  ...effect
})

const surfaces = [
  {
    commandItemId: 'command:view.command-palette',
    commandId: COMMANDS.VIEW_COMMAND_PALETTE,
    menuItemId: 'menu-entry:menu.view.commandPalette',
    menuLabel: 'menu.view.commandPalette',
    effect: expectedEffect({ send: [['mt::show-command-palette']] })
  },
  {
    commandItemId: 'command:view.dev-reload',
    commandId: COMMANDS.VIEW_DEV_RELOAD,
    menuItemId: 'menu-entry:menu.view.reloadWindow',
    menuLabel: 'menu.view.reloadWindow',
    effect: expectedEffect({ emit: [['window-reload-by-id', 42]] })
  },
  {
    commandItemId: 'command:view.focus-mode',
    commandId: COMMANDS.VIEW_FOCUS_MODE,
    menuItemId: 'menu-entry:menu.view.focusMode',
    menuLabel: 'menu.view.focusMode',
    effect: expectedEffect({ send: [['mt::toggle-view-mode-entry', 'focus']] })
  },
  {
    commandItemId: 'command:view.reload-images',
    commandId: COMMANDS.VIEW_FORCE_RELOAD_IMAGES,
    menuItemId: 'menu-entry:menu.view.reloadImages',
    menuLabel: 'menu.view.reloadImages',
    effect: expectedEffect({ send: [['mt::invalidate-image-cache']] })
  },
  {
    commandItemId: 'command:view.source-code-mode',
    commandId: COMMANDS.VIEW_SOURCE_CODE_MODE,
    menuItemId: 'menu-entry:menu.view.sourceCodeMode',
    menuLabel: 'menu.view.sourceCodeMode',
    effect: expectedEffect({ send: [['mt::toggle-view-mode-entry', 'sourceCode']] })
  },
  {
    commandItemId: 'command:view.toggle-dev-tools',
    commandId: COMMANDS.VIEW_TOGGLE_DEV_TOOLS,
    menuItemId: 'menu-entry:menu.view.showDeveloperTools',
    menuLabel: 'menu.view.showDeveloperTools',
    effect: expectedEffect({ toggleDevTools: [[]] })
  },
  {
    commandItemId: 'command:view.toggle-sidebar',
    commandId: COMMANDS.VIEW_TOGGLE_SIDEBAR,
    menuItemId: 'menu-entry:menu.view.toggleSidebar',
    menuLabel: 'menu.view.toggleSidebar',
    effect: expectedEffect({ send: [['mt::toggle-view-layout-entry', 'showSideBar']] })
  },
  {
    commandItemId: 'command:view.toggle-tabbar',
    commandId: COMMANDS.VIEW_TOGGLE_TABBAR,
    menuItemId: 'menu-entry:menu.view.toggleTabbar',
    menuLabel: 'menu.view.toggleTabbar',
    effect: expectedEffect({ send: [['mt::toggle-view-layout-entry', 'showTabBar']] })
  },
  {
    commandItemId: 'command:view.toggle-toc',
    commandId: COMMANDS.VIEW_TOGGLE_TOC,
    menuItemId: 'menu-entry:menu.view.toggleTableOfContents',
    menuLabel: 'menu.view.toggleTableOfContents',
    effect: expectedEffect({ send: [['mt::set-view-layout', { rightColumn: 'toc' }]] })
  },
  {
    commandItemId: 'command:view.typewriter-mode',
    commandId: COMMANDS.VIEW_TYPEWRITER_MODE,
    menuItemId: 'menu-entry:menu.view.typewriterMode',
    menuLabel: 'menu.view.typewriterMode',
    effect: expectedEffect({ send: [['mt::toggle-view-mode-entry', 'typewriter']] })
  }
] as const

const resetEffects = (): void => {
  send.mockClear()
  emit.mockClear()
  toggleDevTools.mockClear()
}

const observedEffect = (): ExpectedEffect => ({
  send: send.mock.calls,
  emit: emit.mock.calls,
  toggleDevTools: toggleDevTools.mock.calls
})

const clickViewMenu = (label: string): void => {
  const item = submenu.find(candidate => candidate.label === label)
  if (typeof item?.click !== 'function') {
    throw new Error(`View menu item ${label} requires a click callback`)
  }
  item.click({} as MenuItem, fakeWindow, {} as KeyboardEvent)
}

describe('CriticMarkup View production surfaces', () => {
  beforeAll(() => {
    previousDebug = global.MARKTEXT_DEBUG
    global.MARKTEXT_DEBUG = true
    loadViewCommands({
      add(id: string, callback: CommandCallback): void {
        registeredCommandIds.push(id)
        CommandManager.add(id, callback)
      }
    } as never)
    viewMenu = viewMenuTemplate({
      getAccelerator: () => undefined
    } as never)
    submenu = viewMenu.submenu as MenuItemConstructorOptions[]
  })

  afterAll(() => {
    registeredCommandIds.forEach(id => {
      if (!CommandManager.remove(id)) {
        throw new Error(`Registered command disappeared before cleanup: ${id}`)
      }
    })
    global.MARKTEXT_DEBUG = previousDebug
  })

  it('routes every registered View command and leaf menu surface to its exact runtime effect', () => {
    for (const surface of surfaces) {
      resetEffects()
      CommandManager.execute(surface.commandId, fakeWindow)
      expect(observedEffect(), surface.commandItemId).toEqual(surface.effect)

      resetEffects()
      clickViewMenu(surface.menuLabel)
      expect(observedEffect(), surface.menuItemId).toEqual(surface.effect)
    }
  })

  it('exposes the View root menu as the container for the proven leaf surfaces', () => {
    expect(viewMenu.label, 'menu-entry:menu.view.view').toBe('menu.view.view')
    expect(submenu.filter(item => typeof item.click === 'function')).toHaveLength(10)
  })
})
