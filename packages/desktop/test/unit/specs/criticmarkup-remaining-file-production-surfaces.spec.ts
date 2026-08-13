import type { BrowserWindow, MenuItem, MenuItemConstructorOptions } from 'electron'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  appQuit: vi.fn(),
  dialogOpen: vi.fn(async() => ({ filePaths: [] as string[] })),
  ipcEmit: vi.fn()
}))
const collaborators = vi.hoisted(() => ({
  checkUpdates: vi.fn(),
  showTabBar: vi.fn(),
  userSetting: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', quit: electron.appQuit },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: {
    showMessageBox: vi.fn(),
    showOpenDialog: electron.dialogOpen,
    showSaveDialog: vi.fn()
  },
  ipcMain: { emit: electron.ipcEmit, on: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn() }
}))
vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))
vi.mock('main_renderer/config', () => ({
  isOsx: false,
  EXTENSION_HASN: {},
  PANDOC_EXTENSIONS: [],
  URL_REG: /^https?:/
}))
vi.mock('main_renderer/filesystem/markdown', () => ({ writeMarkdownFile: vi.fn() }))
vi.mock('main_renderer/menu/actions/marktext', () => ({
  checkUpdates: collaborators.checkUpdates,
  userSetting: collaborators.userSetting
}))
vi.mock('main_renderer/menu/actions/view', () => ({
  showTabBar: collaborators.showTabBar
}))
vi.mock('main_renderer/utils/pandoc', () => ({
  default: Object.assign(vi.fn(), { exists: () => false })
}))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import {
  COMMANDS,
  CommandManager,
  type CommandCallback
} from 'main_renderer/commands'
import { loadFileCommands as loadQuickOpenCommand } from 'main_renderer/commands/file'
import { loadFileCommands } from 'main_renderer/menu/actions/file'
import fileMenu from 'main_renderer/menu/templates/file'

const send = vi.fn()
const close = vi.fn()
const fakeWindow = {
  id: 42,
  close,
  webContents: { send }
} as unknown as BrowserWindow
const registeredCommandIds: string[] = []
const template = fileMenu(
  { getAccelerator: () => undefined } as never,
  { getAll: () => ({ autoSave: false }) } as never,
  []
)
const submenu = template.submenu as MenuItemConstructorOptions[]

const findMenuItem = (
  items: MenuItemConstructorOptions[],
  label: string
): MenuItemConstructorOptions | undefined => {
  for (const item of items) {
    if (item.label === label) return item
    if (Array.isArray(item.submenu)) {
      const nested = findMenuItem(item.submenu, label)
      if (nested) return nested
    }
  }
}

const clickFileMenu = async(label: string, checked = false): Promise<void> => {
  const item = findMenuItem(submenu, label)
  if (typeof item?.click !== 'function') {
    throw new Error(`File menu item ${label} requires a click callback`)
  }
  await item.click({ checked } as MenuItem, fakeWindow, {} as KeyboardEvent)
}

type Surface = Readonly<{
  itemId: string
  invoke: () => unknown
  expected: () => void
}>

const rendererSurface = (
  itemId: string,
  invoke: () => unknown,
  channel: string,
  ...args: unknown[]
): Surface => ({
  itemId,
  invoke,
  expected: () => expect(send.mock.calls, itemId).toEqual([[channel, ...args]])
})

describe('CriticMarkup remaining File production surfaces', () => {
  beforeAll(() => {
    const registrar = {
      add(id: string, callback: CommandCallback): void {
        registeredCommandIds.push(id)
        CommandManager.add(id, callback)
      }
    } as never
    loadFileCommands(registrar)
    loadQuickOpenCommand(registrar)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    electron.dialogOpen.mockResolvedValue({ filePaths: [] })
  })

  afterAll(() => {
    registeredCommandIds.forEach(id => {
      if (!CommandManager.remove(id)) {
        throw new Error(`Registered command disappeared before cleanup: ${id}`)
      }
    })
  })

  it('routes every remaining registered File command to its exact application boundary', async() => {
    const surfaces: readonly Surface[] = [
      {
        itemId: 'command:file.check-update',
        invoke: () => CommandManager.execute(COMMANDS.FILE_CHECK_UPDATE, fakeWindow),
        expected: () => expect(collaborators.checkUpdates).toHaveBeenCalledTimes(1)
      },
      rendererSurface('command:file.close-tab', () =>
        CommandManager.execute(COMMANDS.FILE_CLOSE_TAB, fakeWindow), 'mt::editor-close-tab'),
      {
        itemId: 'command:file.close-window',
        invoke: () => CommandManager.execute(COMMANDS.FILE_CLOSE_WINDOW, fakeWindow),
        expected: () => expect(close).toHaveBeenCalledTimes(1)
      },
      rendererSurface('command:file.export-file', () =>
        CommandManager.execute(COMMANDS.FILE_EXPORT_FILE, fakeWindow), 'mt::show-export-dialog', undefined),
      rendererSurface('command:file.export-file.pdf', () =>
        CommandManager.execute(COMMANDS.FILE_EXPORT_FILE_PDF, fakeWindow), 'mt::show-export-dialog', 'pdf'),
      rendererSurface('command:file.import-file', () =>
        CommandManager.execute(COMMANDS.FILE_IMPORT_FILE, fakeWindow), 'mt::pandoc-not-exists', {
        title: 'dialog.importWarning',
        type: 'warning',
        message: 'dialog.installPandoc',
        time: 10000
      }),
      rendererSurface('command:file.move-file', () =>
        CommandManager.execute(COMMANDS.FILE_MOVE_FILE, fakeWindow), 'mt::editor-move-file'),
      {
        itemId: 'command:file.new-window',
        invoke: () => CommandManager.execute(COMMANDS.FILE_NEW_FILE, fakeWindow),
        expected: () => expect(electron.ipcEmit.mock.calls).toEqual([['app-create-editor-window']])
      },
      rendererSurface('command:file.new-tab', () =>
        CommandManager.execute(COMMANDS.FILE_NEW_TAB, fakeWindow), 'mt::new-untitled-tab'),
      {
        itemId: 'command:file.open-file',
        invoke: () => CommandManager.execute(COMMANDS.FILE_OPEN_FILE, fakeWindow),
        expected: () => expect(electron.dialogOpen).toHaveBeenCalledTimes(1)
      },
      {
        itemId: 'command:file.open-folder',
        invoke: () => CommandManager.execute(COMMANDS.FILE_OPEN_FOLDER, fakeWindow),
        expected: () => expect(electron.dialogOpen).toHaveBeenCalledTimes(1)
      },
      rendererSurface('command:file.quick-open', () =>
        CommandManager.execute(COMMANDS.FILE_QUICK_OPEN, fakeWindow),
      'mt::execute-command-by-id', 'file.quick-open'),
      {
        itemId: 'command:file.preferences',
        invoke: () => CommandManager.execute(COMMANDS.FILE_PREFERENCES, fakeWindow),
        expected: () => expect(collaborators.userSetting).toHaveBeenCalledTimes(1)
      },
      rendererSurface('command:file.print', () =>
        CommandManager.execute(COMMANDS.FILE_PRINT, fakeWindow), 'mt::show-export-dialog', 'print'),
      {
        itemId: 'command:file.quit',
        invoke: () => CommandManager.execute(COMMANDS.FILE_QUIT, fakeWindow),
        expected: () => expect(electron.appQuit).toHaveBeenCalledTimes(1)
      },
      rendererSurface('command:file.rename-file', () =>
        CommandManager.execute(COMMANDS.FILE_RENAME_FILE, fakeWindow), 'mt::editor-rename-file')
    ]

    for (const surface of surfaces) {
      vi.clearAllMocks()
      await surface.invoke()
      surface.expected()
    }
  })

  it('routes every remaining executable File menu surface to its exact application boundary', async() => {
    const surfaces: readonly Surface[] = [
      {
        itemId: 'menu-entry:menu.file.autoSave',
        invoke: () => clickFileMenu('menu.file.autoSave', true),
        expected: () => expect(electron.ipcEmit.mock.calls).toEqual([
          ['set-user-preference', { autoSave: true }]
        ])
      },
      {
        itemId: 'menu-entry:menu.file.clearRecentlyUsed',
        invoke: () => clickFileMenu('menu.file.clearRecentlyUsed'),
        expected: () => expect(electron.ipcEmit.mock.calls).toEqual([['menu-clear-recently-used']])
      },
      rendererSurface('menu-entry:menu.file.closeTab', () =>
        clickFileMenu('menu.file.closeTab'), 'mt::editor-close-tab'),
      {
        itemId: 'menu-entry:menu.file.closeWindow',
        invoke: () => clickFileMenu('menu.file.closeWindow'),
        expected: () => expect(close).toHaveBeenCalledTimes(1)
      },
      rendererSurface('menu-entry:menu.file.exportHtml', () =>
        clickFileMenu('menu.file.exportHtml'), 'mt::show-export-dialog', 'styledHtml'),
      rendererSurface('menu-entry:menu.file.exportPdf', () =>
        clickFileMenu('menu.file.exportPdf'), 'mt::show-export-dialog', 'pdf'),
      rendererSurface('menu-entry:menu.file.import', () =>
        clickFileMenu('menu.file.import'), 'mt::pandoc-not-exists', {
        title: 'dialog.importWarning',
        type: 'warning',
        message: 'dialog.installPandoc',
        time: 10000
      }),
      rendererSurface('menu-entry:menu.file.moveTo', () =>
        clickFileMenu('menu.file.moveTo'), 'mt::editor-move-file'),
      rendererSurface('menu-entry:menu.file.newTab', () =>
        clickFileMenu('menu.file.newTab'), 'mt::new-untitled-tab'),
      {
        itemId: 'menu-entry:menu.file.newWindow',
        invoke: () => clickFileMenu('menu.file.newWindow'),
        expected: () => expect(electron.ipcEmit.mock.calls).toEqual([['app-create-editor-window']])
      },
      {
        itemId: 'menu-entry:menu.file.openFile',
        invoke: () => clickFileMenu('menu.file.openFile'),
        expected: () => expect(electron.dialogOpen).toHaveBeenCalledTimes(1)
      },
      {
        itemId: 'menu-entry:menu.file.openFolder',
        invoke: () => clickFileMenu('menu.file.openFolder'),
        expected: () => expect(electron.dialogOpen).toHaveBeenCalledTimes(1)
      },
      {
        itemId: 'menu-entry:menu.file.preferences',
        invoke: () => clickFileMenu('menu.file.preferences'),
        expected: () => expect(collaborators.userSetting).toHaveBeenCalledTimes(1)
      },
      rendererSurface('menu-entry:menu.file.print', () =>
        clickFileMenu('menu.file.print'), 'mt::show-export-dialog', 'print'),
      {
        itemId: 'menu-entry:menu.file.quit',
        invoke: () => clickFileMenu('menu.file.quit'),
        expected: () => expect(electron.appQuit).toHaveBeenCalledTimes(1)
      },
      rendererSurface('menu-entry:menu.file.rename', () =>
        clickFileMenu('menu.file.rename'), 'mt::editor-rename-file')
    ]

    for (const surface of surfaces) {
      vi.clearAllMocks()
      await surface.invoke()
      surface.expected()
    }
  })

  it('exposes every remaining non-executable File menu container', () => {
    expect({ itemId: 'menu-entry:menu.file.file', label: template.label }).toEqual({
      itemId: 'menu-entry:menu.file.file',
      label: 'menu.file.file'
    })
    for (const [itemId, label] of [
      ['menu-entry:menu.file.export', 'menu.file.export'],
      ['menu-entry:menu.file.openRecent', 'menu.file.openRecent']
    ] as const) {
      expect(findMenuItem(submenu, label), itemId).toBeDefined()
    }
  })
})
