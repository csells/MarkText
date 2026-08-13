import type { BrowserWindow, MenuItem, MenuItemConstructorOptions } from 'electron'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  appQuit: vi.fn(),
  ipcEmit: vi.fn(),
  ipcOn: vi.fn(),
  responder: vi.fn()
}))
const updater = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  on: vi.fn(),
  quitAndInstall: vi.fn()
}))

vi.mock('electron', () => ({
  app: { quit: electron.appQuit },
  BrowserWindow: { fromWebContents: vi.fn() },
  ipcMain: { emit: electron.ipcEmit, on: electron.ipcOn },
  Menu: { sendActionToFirstResponder: electron.responder }
}))
vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: true,
    checkForUpdates: updater.checkForUpdates,
    downloadUpdate: updater.downloadUpdate,
    on: updater.on,
    quitAndInstall: updater.quitAndInstall
  }
}))
vi.mock('main_renderer/config', () => ({ isOsx: true }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import {
  COMMANDS,
  CommandManager,
  type CommandCallback
} from 'main_renderer/commands'
import { loadMarktextCommands } from 'main_renderer/menu/actions/marktext'
import marktextMenuTemplate from 'main_renderer/menu/templates/marktext'

const send = vi.fn()
const fakeWindow = { webContents: { send } } as unknown as BrowserWindow
const registeredCommandIds: string[] = []
let marktextMenu: MenuItemConstructorOptions
let submenu: MenuItemConstructorOptions[]

const clickMarktextMenu = (label: string): void => {
  const item = submenu.find(candidate => candidate.label === label)
  if (typeof item?.click !== 'function') {
    throw new Error(`MarkText menu item ${label} requires a click callback`)
  }
  item.click({} as MenuItem, fakeWindow, {} as KeyboardEvent)
}

describe('CriticMarkup MarkText application-menu production surfaces', () => {
  beforeAll(() => {
    loadMarktextCommands({
      add(id: string, callback: CommandCallback): void {
        registeredCommandIds.push(id)
        CommandManager.add(id, callback)
      }
    } as never)
    marktextMenu = marktextMenuTemplate({
      getAccelerator: () => undefined
    } as never)
    submenu = marktextMenu.submenu as MenuItemConstructorOptions[]
  })

  beforeEach(() => vi.clearAllMocks())

  afterAll(() => {
    registeredCommandIds.forEach(id => {
      if (!CommandManager.remove(id)) {
        throw new Error(`Registered command disappeared before cleanup: ${id}`)
      }
    })
  })

  it('routes registered hide commands and paired menu surfaces to exact native responders', () => {
    const surfaces = [
      {
        commandItemId: 'command:mt.hide',
        commandId: COMMANDS.MT_HIDE,
        menuItemId: 'menu-entry:menu.marktext.hide',
        menuLabel: 'menu.marktext.hide',
        responder: 'hide:'
      },
      {
        commandItemId: 'command:mt.hide-others',
        commandId: COMMANDS.MT_HIDE_OTHERS,
        menuItemId: 'menu-entry:menu.marktext.hideOthers',
        menuLabel: 'menu.marktext.hideOthers',
        responder: 'hideOtherApplications:'
      }
    ] as const

    for (const surface of surfaces) {
      CommandManager.execute(surface.commandId, fakeWindow)
      expect(electron.responder.mock.calls, surface.commandItemId)
        .toEqual([[surface.responder]])

      electron.responder.mockClear()
      clickMarktextMenu(surface.menuLabel)
      expect(electron.responder.mock.calls, surface.menuItemId)
        .toEqual([[surface.responder]])
      electron.responder.mockClear()
    }
  })

  it('routes remaining executable MarkText menu surfaces to exact application boundaries', () => {
    clickMarktextMenu('menu.marktext.about')
    expect(send.mock.calls, 'menu-entry:menu.marktext.about')
      .toEqual([['mt::about-dialog']])

    vi.clearAllMocks()
    clickMarktextMenu('menu.marktext.checkUpdates')
    expect(updater.checkForUpdates.mock.calls, 'menu-entry:menu.marktext.checkUpdates')
      .toEqual([[]])

    vi.clearAllMocks()
    clickMarktextMenu('menu.marktext.preferences')
    expect(electron.ipcEmit.mock.calls, 'menu-entry:menu.marktext.preferences')
      .toEqual([['app-create-settings-window']])

    vi.clearAllMocks()
    clickMarktextMenu('menu.marktext.showAll')
    expect(electron.responder.mock.calls, 'menu-entry:menu.marktext.showAll')
      .toEqual([['unhideAllApplications:']])

    vi.clearAllMocks()
    clickMarktextMenu('menu.marktext.quit')
    expect(electron.appQuit, 'menu-entry:menu.marktext.quit')
      .toHaveBeenCalledTimes(1)
  })

  it('exposes exact structural MarkText root and Services menu surfaces', () => {
    const services = submenu.find(item => item.label === 'menu.marktext.services')
    expect({
      itemId: 'menu-entry:menu.marktext.services',
      label: services?.label,
      role: services?.role,
      submenu: services?.submenu
    }).toEqual({
      itemId: 'menu-entry:menu.marktext.services',
      label: 'menu.marktext.services',
      role: 'services',
      submenu: []
    })

    expect({
      itemId: 'menu-entry:menu.marktext.title',
      label: marktextMenu.label
    }).toEqual({
      itemId: 'menu-entry:menu.marktext.title',
      label: 'menu.marktext.title'
    })
  })
})
