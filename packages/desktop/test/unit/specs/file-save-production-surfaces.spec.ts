import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, MenuItem, MenuItemConstructorOptions } from 'electron'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', quit: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: {
    showMessageBox: vi.fn(),
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  ipcMain: { emit: vi.fn(), on: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn() }
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))
vi.mock('main_renderer/filesystem/markdown', () => ({ writeMarkdownFile: vi.fn() }))
vi.mock('main_renderer/menu/actions/marktext', () => ({
  checkUpdates: vi.fn(),
  userSetting: vi.fn()
}))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import { COMMANDS, CommandManager, type CommandCallback } from 'main_renderer/commands'
import { loadFileCommands } from 'main_renderer/menu/actions/file'
import fileTemplate from 'main_renderer/menu/templates/file'

const keybindings = { getAccelerator: () => null } as never
const preferences = { getAll: () => ({ autoSave: false }) } as never
const fakeWindow = Object.freeze({ webContents: { send } }) as unknown as BrowserWindow
const registeredCommandIds: string[] = []

const cases = [
  {
    commandId: COMMANDS.FILE_SAVE,
    menuLabel: 'menu.file.save',
    rendererChannel: 'mt::editor-ask-file-save'
  },
  {
    commandId: COMMANDS.FILE_SAVE_AS,
    menuLabel: 'menu.file.saveAs',
    rendererChannel: 'mt::editor-ask-file-save-as'
  }
] as const

const submenu = fileTemplate(keybindings, preferences, []).submenu as MenuItemConstructorOptions[]

describe('File save production surfaces', () => {
  beforeAll(() => {
    loadFileCommands({
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

  it('routes registered Save and Save As command and menu surfaces to the renderer save barriers', () => {
    for (const { commandId, menuLabel, rendererChannel } of cases) {
      send.mockClear()
      CommandManager.execute(commandId, fakeWindow)
      expect(send, `command ${commandId}`).toHaveBeenCalledExactlyOnceWith(rendererChannel)

      send.mockClear()
      const item = submenu.find(candidate => candidate.label === menuLabel)
      expect(item, `menu ${menuLabel}`).toBeDefined()
      item?.click?.({} as MenuItem, fakeWindow, {} as KeyboardEvent)
      expect(send, `menu ${menuLabel}`).toHaveBeenCalledExactlyOnceWith(rendererChannel)
    }
  })
})
