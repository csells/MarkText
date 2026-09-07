import type { BrowserWindow, MenuItem, MenuItemConstructorOptions } from 'electron'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  emit: vi.fn(),
  sendActionToFirstResponder: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: { emit: electron.emit },
  Menu: { sendActionToFirstResponder: electron.sendActionToFirstResponder },
  screen: {}
}))
vi.mock('main_renderer/config', () => ({
  isLinux: false,
  isOsx: true,
  isWindows: false
}))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import { COMMANDS, CommandManager, type CommandCallback } from 'main_renderer/commands'
import { loadWindowCommands } from 'main_renderer/menu/actions/window'
import windowMenuTemplate from 'main_renderer/menu/templates/window'

const send = vi.fn()
const minimize = vi.fn()
const setFullScreen = vi.fn()
const fakeWindow = {
  id: 42,
  minimize,
  isFullScreen: () => false,
  setFullScreen,
  webContents: {
    getZoomFactor: () => 1,
    send
  }
} as unknown as BrowserWindow
const registeredCommandIds: string[] = []
let windowMenu: MenuItemConstructorOptions
let submenu: MenuItemConstructorOptions[]

type ExpectedEffect = Readonly<{
  emit: readonly unknown[][]
  minimize: readonly unknown[][]
  responder: readonly unknown[][]
  send: readonly unknown[][]
  setFullScreen: readonly unknown[][]
}>

const expectedEffect = (effect: Partial<ExpectedEffect>): ExpectedEffect => ({
  emit: [],
  minimize: [],
  responder: [],
  send: [],
  setFullScreen: [],
  ...effect
})

const pairedSurfaces = [
  {
    commandItemId: 'command:window.minimize',
    commandId: COMMANDS.WINDOW_MINIMIZE,
    menuItemId: 'menu-entry:menu.window.minimize',
    menuLabel: 'menu.window.minimize',
    effect: expectedEffect({ responder: [['performMiniaturize:']] })
  },
  {
    commandItemId: 'command:window.toggle-always-on-top',
    commandId: COMMANDS.WINDOW_TOGGLE_ALWAYS_ON_TOP,
    menuItemId: 'menu-entry:menu.window.alwaysOnTop',
    menuLabel: 'menu.window.alwaysOnTop',
    effect: expectedEffect({ emit: [['window-toggle-always-on-top', fakeWindow]] })
  },
  {
    commandItemId: 'command:window.toggle-full-screen',
    commandId: COMMANDS.WINDOW_TOGGLE_FULL_SCREEN,
    menuItemId: 'menu-entry:menu.window.fullScreen',
    menuLabel: 'menu.window.fullScreen',
    effect: expectedEffect({ setFullScreen: [[true]] })
  },
  {
    commandItemId: 'command:window.zoomIn',
    commandId: COMMANDS.WINDOW_ZOOM_IN,
    menuItemId: 'menu-entry:menu.window.zoomIn',
    menuLabel: 'menu.window.zoomIn',
    effect: expectedEffect({ send: [['mt::window-zoom', 1.125]] })
  },
  {
    commandItemId: 'command:window.resetZoom',
    commandId: COMMANDS.WINDOW_ZOOM_RESET,
    menuItemId: 'menu-entry:menu.window.resetZoom',
    menuLabel: 'menu.window.resetZoom',
    effect: expectedEffect({ send: [['mt::window-zoom', 1]] })
  },
  {
    commandItemId: 'command:window.zoomOut',
    commandId: COMMANDS.WINDOW_ZOOM_OUT,
    menuItemId: 'menu-entry:menu.window.zoomOut',
    menuLabel: 'menu.window.zoomOut',
    effect: expectedEffect({ send: [['mt::window-zoom', 0.875]] })
  }
] as const

const resetEffects = (): void => {
  electron.emit.mockClear()
  electron.sendActionToFirstResponder.mockClear()
  minimize.mockClear()
  send.mockClear()
  setFullScreen.mockClear()
}

const observedEffect = (): ExpectedEffect => ({
  emit: electron.emit.mock.calls,
  minimize: minimize.mock.calls,
  responder: electron.sendActionToFirstResponder.mock.calls,
  send: send.mock.calls,
  setFullScreen: setFullScreen.mock.calls
})

const clickWindowMenu = (label: string): void => {
  const item = submenu.find((candidate) => candidate.label === label)
  if (typeof item?.click !== 'function') {
    throw new Error(`Window menu item ${label} requires a click callback`)
  }
  item.click({} as MenuItem, fakeWindow, {} as KeyboardEvent)
}

describe('CriticMarkup Window production surfaces', () => {
  beforeAll(() => {
    loadWindowCommands({
      add(id: string, callback: CommandCallback): void {
        registeredCommandIds.push(id)
        CommandManager.add(id, callback)
      }
    } as never)
    windowMenu = windowMenuTemplate({
      getAccelerator: () => undefined
    } as never)
    submenu = windowMenu.submenu as MenuItemConstructorOptions[]
  })

  afterAll(() => {
    registeredCommandIds.forEach((id) => {
      if (!CommandManager.remove(id)) {
        throw new Error(`Registered command disappeared before cleanup: ${id}`)
      }
    })
  })

  it('routes every registered Window command and paired menu surface to its exact runtime effect', () => {
    for (const surface of pairedSurfaces) {
      resetEffects()
      CommandManager.execute(surface.commandId, fakeWindow)
      expect(observedEffect(), surface.commandItemId).toEqual(surface.effect)

      resetEffects()
      clickWindowMenu(surface.menuLabel)
      expect(observedEffect(), surface.menuItemId).toEqual(surface.effect)
    }
  })

  it('routes Bring All to Front and exposes the Window root menu', () => {
    resetEffects()
    clickWindowMenu('menu.window.bringAllToFront')
    expect(observedEffect(), 'menu-entry:menu.window.bringAllToFront').toEqual(
      expectedEffect({ responder: [['arrangeInFront:']] })
    )

    expect(windowMenu.label, 'menu-entry:menu.window.title').toBe('menu.window.title')
    expect(submenu.filter((item) => typeof item.click === 'function')).toHaveLength(7)
  })
})
