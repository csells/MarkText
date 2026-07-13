import { describe, it, expect, vi, beforeEach } from 'vitest'

// Main-process slice: after the user saves new keybindings the application menu
// must be rebuilt so the menu bar shows the updated accelerators (#3998). Drive
// `AppMenu.updateKeybindings()` with a fake Electron `Menu` and stubbed menu
// templates and assert every window menu (editor + macOS settings) is rebuilt
// from the current keybindings and the active window's menu is re-applied.

const { buildFromTemplate, setApplicationMenu, configureMenu, configSettingMenu } = vi.hoisted(
  () => ({
    buildFromTemplate: vi.fn((template: unknown) => {
      const items = new Map<string, { checked: boolean; enabled: boolean }>()
      return {
        template,
        getMenuItemById: (id: string) => {
          if (!items.has(id)) items.set(id, { checked: false, enabled: true })
          return items.get(id)
        }
      }
    }),
    setApplicationMenu: vi.fn(),
    configureMenu: vi.fn(() => ['EDITOR_TEMPLATE']),
    configSettingMenu: vi.fn(() => ['SETTINGS_TEMPLATE'])
  })
)

vi.mock('electron', () => ({
  app: { addRecentDocument: vi.fn(), clearRecentDocuments: vi.fn() },
  ipcMain: { on: vi.fn(), handle: vi.fn(), emit: vi.fn() },
  Menu: { buildFromTemplate, setApplicationMenu, getApplicationMenu: vi.fn() }
}))

vi.mock('common/filesystem', () => ({
  ensureDirSync: vi.fn(),
  isDirectory2: () => false,
  isFile2: () => false
}))

// macOS so the settings window also owns a (non-null) menu that must rebuild.
vi.mock('main_renderer/config', () => ({ isLinux: false, isOsx: true, isWindows: false }))

vi.mock('main_renderer/menu/actions/edit', () => ({ updateSidebarMenu: vi.fn() }))
vi.mock('main_renderer/menu/actions/format', () => ({ updateFormatMenu: vi.fn() }))
vi.mock('main_renderer/menu/actions/paragraph', () => ({ updateSelectionMenus: vi.fn() }))
vi.mock('main_renderer/menu/actions/view', () => ({ viewLayoutChanged: vi.fn() }))
vi.mock('main_renderer/utils/internalIpc', () => ({ onInternalChannel: vi.fn() }))
vi.mock('main_renderer/i18n.js', () => ({ setLanguage: vi.fn() }))
vi.mock('main_renderer/menu/templates', () => ({
  default: configureMenu,
  configSettingMenu
}))

import AppMenu from 'main_renderer/menu'
import type Preference from 'main_renderer/preferences'
import type Keybindings from 'main_renderer/keyboard/shortcutHandler'

const makeAppMenu = () => {
  const preferences = { getItem: () => 'en' } as unknown as Preference
  const keybindings = { registerEditorKeyHandlers: vi.fn() } as unknown as Keybindings
  return new AppMenu(preferences, keybindings, '/tmp/mt-test')
}

describe('AppMenu.updateKeybindings rebuilds menus after a keybinding change (#3998)', () => {
  beforeEach(() => {
    buildFromTemplate.mockClear()
    setApplicationMenu.mockClear()
    configureMenu.mockClear()
    configSettingMenu.mockClear()
  })

  it('rebuilds the active editor menu and re-applies it as the application menu', () => {
    const appMenu = makeAppMenu()
    const editorWin = { id: 1 } as never
    appMenu.addEditorMenu(editorWin)
    appMenu.setActiveWindow(1)

    configureMenu.mockClear()
    setApplicationMenu.mockClear()

    appMenu.updateKeybindings()

    // The editor menu is rebuilt from the current keybindings...
    expect(configureMenu).toHaveBeenCalled()
    // ...and pushed to the OS as the active application menu.
    expect(setApplicationMenu).toHaveBeenCalledTimes(1)
  })

  it('also rebuilds the settings-window menu so its accelerators refresh', () => {
    const appMenu = makeAppMenu()
    const settingWin = { id: 2 } as never
    appMenu.addSettingMenu(settingWin)

    configSettingMenu.mockClear()

    appMenu.updateKeybindings()

    expect(configSettingMenu).toHaveBeenCalled()
  })

  it('preserves Review capability, display, and projection state while rebuilding', () => {
    const appMenu = makeAppMenu()
    const editorWin = { id: 3 } as never
    appMenu.addEditorMenu(editorWin)

    const oldMenu = appMenu.getWindowMenuById(3)
    const deletion = oldMenu.getMenuItemById('reviewMarkDeletionMenuItem')
    const trackChanges = oldMenu.getMenuItemById('reviewTrackChangesMenuItem')
    const display = oldMenu.getMenuItemById('reviewDisplayMenuItem')
    const marked = oldMenu.getMenuItemById('reviewShowMarkedMenuItem')
    const revised = oldMenu.getMenuItemById('reviewShowRevisedMenuItem')
    if (!deletion || !trackChanges || !display || !marked || !revised) {
      throw new TypeError('Review menu fixture is incomplete.')
    }
    deletion.enabled = false
    trackChanges.checked = true
    display.enabled = false
    marked.checked = false
    revised.checked = true

    appMenu.updateKeybindings()

    const rebuilt = appMenu.getWindowMenuById(3)
    expect(rebuilt).not.toBe(oldMenu)
    expect(rebuilt.getMenuItemById('reviewMarkDeletionMenuItem')?.enabled).toBe(false)
    expect(rebuilt.getMenuItemById('reviewTrackChangesMenuItem')?.checked).toBe(true)
    expect(rebuilt.getMenuItemById('reviewDisplayMenuItem')?.enabled).toBe(false)
    expect(rebuilt.getMenuItemById('reviewShowMarkedMenuItem')?.checked).toBe(false)
    expect(rebuilt.getMenuItemById('reviewShowRevisedMenuItem')?.checked).toBe(true)
  })
})
