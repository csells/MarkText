import fs from 'fs'
import path from 'path'
import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import type { IpcMainEvent } from 'electron'
import log from 'electron-log'
import { ensureDirSync, isDirectory2, isFile2 } from 'common/filesystem'
import { isLinux, isOsx, isWindows } from '../config'
import {
  setSemanticClipboardMenuState,
  updateSidebarMenu
} from '../menu/actions/edit'
import { updateFormatMenu } from '../menu/actions/format'
import { updateReviewMenu } from '../menu/actions/review'
import { updateSelectionMenus } from '../menu/actions/paragraph'
import { onInternalChannel } from '../utils/internalIpc'
import { viewLayoutChanged } from '../menu/actions/view'
import configureMenu, { configSettingMenu } from '../menu/templates'
import { setLanguage } from '../i18n.js'
import type Preference from '../preferences'
import type Keybindings from '../keyboard/shortcutHandler'
import type { IUserPreferences } from '@shared/types/preferences'
import { REVIEW_COMMAND_DESCRIPTORS } from '../../common/commands/review'
import {
  documentClipboardConsumerPolicy,
  DOCUMENT_CAPABILITY_MENU_ROWS,
  type DocumentCapabilityMenuRow
} from '@shared/types/documentSurface'
import {
  decodeCriticMarkupReviewMenuState,
  decodeDocumentCapabilityMenuState,
  decodeDocumentClipboardMenuState,
  decodeDocumentFormatMenuState,
  decodeDocumentSelectionMenuState,
  decodeSidebarMenuVisibility,
  decodeWindowLayoutMenuState
} from './menuStateRuntimeCodec'

const RECENTLY_USED_DOCUMENTS_FILE_NAME = 'recently-used-documents.json'
const MAX_RECENTLY_USED_DOCUMENTS = 12
const REVIEW_STATE_MENU_IDS = [
  ...REVIEW_COMMAND_DESCRIPTORS.map((descriptor) => descriptor.menuId),
  'reviewDisplayMenuItem'
]
const DOCUMENT_CLIPBOARD_MENU_IDS = Object.freeze([
  'editCopyAsRichMenuItem',
  'editCopyAsHtmlMenuItem',
  'editPasteAsPlainTextMenuItem'
])
const DOCUMENT_CLIPBOARD_UNAVAILABLE = Object.freeze({
  copyAsRich: false,
  copyAsHtml: false,
  pasteAsPlainText: false
})

export const MenuType = {
  DEFAULT: 0,
  EDITOR: 1,
  SETTINGS: 2
} as const

export type MenuTypeValue = (typeof MenuType)[keyof typeof MenuType]

interface WindowMenuEntry {
  menu: Menu | null
  type: MenuTypeValue
}

interface AddEditorMenuOptions {
  sourceCodeModeEnabled?: boolean
}

interface ThemeMenuChange {
  theme?: string
  followSystemTheme?: boolean
}

class AppMenu {
  private readonly _preferences: Preference
  private readonly _keybindings: Keybindings
  private readonly _userDataPath: string
  public readonly RECENTS_PATH: string
  public readonly isOsxOrWindows: boolean
  public activeWindowId: number
  public windowMenus: Map<number, WindowMenuEntry>

  /**
   * @param preferences The preferences instances.
   * @param keybindings The keybindings instances.
   * @param userDataPath The user data path.
   */
  constructor(
    preferences: Preference,
    keybindings: Keybindings,
    userDataPath: string
  ) {
    this._preferences = preferences
    this._keybindings = keybindings
    this._userDataPath = userDataPath

    this.RECENTS_PATH = path.join(userDataPath, RECENTLY_USED_DOCUMENTS_FILE_NAME)
    this.isOsxOrWindows = isOsx || isWindows
    this.activeWindowId = -1
    this.windowMenus = new Map()

    // Initialize main process language from preferences
    this._initializeLanguage()

    this._listenForIpcMain()
  }

  /**
   * Add the file or directory path to the recently used documents.
   *
   * @param filePath The file or directory full path.
   */
  addRecentlyUsedDocument(filePath: string): void {
    const { isOsxOrWindows, RECENTS_PATH } = this

    if (isOsxOrWindows) app.addRecentDocument(filePath)
    if (isOsx) return

    const recentDocuments = this.getRecentlyUsedDocuments()
    const index = recentDocuments.indexOf(filePath)
    let needSave = index !== 0
    if (index > 0) {
      recentDocuments.splice(index, 1)
    }
    if (index !== 0) {
      recentDocuments.unshift(filePath)
    }

    if (recentDocuments.length > MAX_RECENTLY_USED_DOCUMENTS) {
      needSave = true
      recentDocuments.splice(
        MAX_RECENTLY_USED_DOCUMENTS,
        recentDocuments.length - MAX_RECENTLY_USED_DOCUMENTS
      )
    }

    this.updateAppMenu(recentDocuments)

    if (needSave) {
      ensureDirSync(this._userDataPath)
      const json = JSON.stringify(recentDocuments, null, 2)
      fs.writeFileSync(RECENTS_PATH, json, 'utf-8')
    }
  }

  /**
   * Returns a list of all recently used documents and folders.
   */
  getRecentlyUsedDocuments(): string[] {
    const { RECENTS_PATH } = this
    if (!isFile2(RECENTS_PATH)) {
      return []
    }

    try {
      const recentDocuments: string[] = JSON.parse(fs.readFileSync(RECENTS_PATH, 'utf-8')).filter(
        (f: string) => f && (isFile2(f) || isDirectory2(f))
      )

      if (recentDocuments.length > MAX_RECENTLY_USED_DOCUMENTS) {
        recentDocuments.splice(
          MAX_RECENTLY_USED_DOCUMENTS,
          recentDocuments.length - MAX_RECENTLY_USED_DOCUMENTS
        )
      }
      return recentDocuments
    } catch (err) {
      log.error('Error while read recently used documents:', err)
      return []
    }
  }

  /**
   * Clear recently used documents.
   */
  clearRecentlyUsedDocuments(): void {
    const { isOsxOrWindows, RECENTS_PATH } = this
    if (isOsxOrWindows) app.clearRecentDocuments()
    if (isOsx) return

    const recentDocuments: string[] = []
    this.updateAppMenu(recentDocuments)
    const json = JSON.stringify(recentDocuments, null, 2)
    ensureDirSync(this._userDataPath)
    fs.writeFileSync(RECENTS_PATH, json, 'utf-8')
  }

  /**
   * Add a default menu to the given window.
   *
   * @param windowId The window id.
   */
  addDefaultMenu(windowId: number): void {
    const { windowMenus } = this
    const menu = this._buildSettingMenu() // Setting menu is also the fallback menu.
    windowMenus.set(windowId, menu)
  }

  /**
   * Add the settings menu to the given window.
   *
   * @param window The settings browser window.
   */
  addSettingMenu(window: BrowserWindow): void {
    const { windowMenus } = this
    const menu = this._buildSettingMenu()
    windowMenus.set(window.id, menu)
  }

  /**
   * Add the editor menu to the given window.
   *
   * @param window The editor browser window.
   * @param options The menu options.
   */
  addEditorMenu(window: BrowserWindow, options: AddEditorMenuOptions = {}): void {
    const isSourceMode = !!options.sourceCodeModeEnabled
    const { windowMenus } = this
    windowMenus.set(window.id, this._buildEditorMenu())

    const entry = windowMenus.get(window.id)!
    const menu = entry.menu!

    // Set source-code editor if preferred.
    const sourceCodeModeMenuItem = menu.getMenuItemById('sourceCodeModeMenuItem')
    if (sourceCodeModeMenuItem) {
      sourceCodeModeMenuItem.checked = isSourceMode
    }

    if (isSourceMode) {
      const typewriterModeMenuItem = menu.getMenuItemById('typewriterModeMenuItem')
      const focusModeMenuItem = menu.getMenuItemById('focusModeMenuItem')
      if (typewriterModeMenuItem) typewriterModeMenuItem.enabled = false
      if (focusModeMenuItem) focusModeMenuItem.enabled = false
      setSemanticClipboardMenuState(
        menu,
        documentClipboardConsumerPolicy({
          surface: 'source',
          hasSelection: false
        })
      )
    } else {
      setSemanticClipboardMenuState(
        menu,
        DOCUMENT_CLIPBOARD_UNAVAILABLE
      )
    }

    const { _keybindings } = this
    _keybindings.registerEditorKeyHandlers(window)

    if (isWindows) {
      // WORKAROUND: Window close event isn't triggered on Windows if `setIgnoreMenuShortcuts(true)` is used (Electron#32674).
      // NB: Remove this immediately if upstream is fixed because the event may be emitted twice.
      _keybindings.registerAccelerator(window, 'Alt+F4', (win: BrowserWindow | null) => {
        if (win && !win.isDestroyed()) {
          win.close()
        }
      })
    }
  }

  /**
   * Remove menu from the given window.
   *
   * @param windowId The window id.
   */
  removeWindowMenu(windowId: number): void {
    // NOTE: Shortcut handler is automatically unregistered when window is closed.
    const { activeWindowId } = this
    this.windowMenus.delete(windowId)
    if (activeWindowId === windowId) {
      this.activeWindowId = -1
    }
  }

  /**
   * Returns the window menu.
   *
   * @param windowId The window id.
   */
  getWindowMenuById(windowId: number): Menu {
    const menu = this.windowMenus.get(windowId)
    if (!menu) {
      log.error(`getWindowMenuById: Cannot find window menu for window id ${windowId}.`)
      throw new Error(`Cannot find window menu for id ${windowId}.`)
    }
    // The original JS returns `menu.menu` directly; settings menus on non-macOS
    // platforms have `menu: null`, in which case the consumer is responsible
    // for handling the null/undefined return.
    return menu.menu as Menu
  }

  /**
   * Check whether the given window has a menu.
   *
   * @param windowId The window id.
   */
  has(windowId: number): boolean {
    return this.windowMenus.has(windowId)
  }

  /**
   * Set the given window as last active.
   *
   * @param windowId The window id.
   */
  setActiveWindow(windowId: number): void {
    if (this.activeWindowId !== windowId) {
      // Change application menu to the current window menu.
      this._setApplicationMenu(this.getWindowMenuById(windowId))
      this.activeWindowId = windowId
    }
  }

  /**
   * Updates all window menus.
   *
   * NOTE: We need this method to add or remove menu items at runtime.
   */
  updateAppMenu(recentUsedDocuments?: string[]): void {
    if (!recentUsedDocuments) {
      recentUsedDocuments = this.getRecentlyUsedDocuments()
    }

    // "we don't support changing menu object after calling setMenu, the behavior
    // is undefined if user does that." That mean we have to recreate the editor
    // application menu each time.

    // rebuild all window menus
    this.windowMenus.forEach((value, key) => {
      const { menu: oldMenu, type } = value
      if (type !== MenuType.EDITOR || !oldMenu) return

      const { menu: newMenu } = this._buildEditorMenu(recentUsedDocuments)
      if (!newMenu) return

      // all other menu items are set automatically
      updateMenuItem(oldMenu, newMenu, 'sourceCodeModeMenuItem')
      updateMenuItem(oldMenu, newMenu, 'typewriterModeMenuItem')
      updateMenuItem(oldMenu, newMenu, 'focusModeMenuItem')
      updateMenuItem(oldMenu, newMenu, 'sideBarMenuItem')
      updateMenuItem(oldMenu, newMenu, 'tabBarMenuItem')
      REVIEW_STATE_MENU_IDS.forEach((id) => updateMenuItem(oldMenu, newMenu, id))
      DOCUMENT_CLIPBOARD_MENU_IDS.forEach(
        id => updateMenuItem(oldMenu, newMenu, id)
      )

      // update window menu
      value.menu = newMenu
      // update application menu if necessary
      const { activeWindowId } = this
      if (activeWindowId === key) {
        this._setApplicationMenu(newMenu)
      }
    })
  }

  /**
   * Rebuild every window menu so updated keybinding accelerators are reflected
   * wherever shortcuts are shown: the menu bar on Windows/Linux and the macOS
   * application menu for both editor and settings windows.
   */
  updateKeybindings(): void {
    const recentUsedDocuments = this.getRecentlyUsedDocuments()
    this.windowMenus.forEach((value, key) => {
      const { menu: oldMenu, type } = value

      let newMenu: Menu | null = null
      if (type === MenuType.EDITOR) {
        if (!oldMenu) return
        const { menu: rebuilt } = this._buildEditorMenu(recentUsedDocuments)
        if (!rebuilt) return

        updateMenuItem(oldMenu, rebuilt, 'sourceCodeModeMenuItem')
        updateMenuItem(oldMenu, rebuilt, 'typewriterModeMenuItem')
        updateMenuItem(oldMenu, rebuilt, 'focusModeMenuItem')
        updateMenuItem(oldMenu, rebuilt, 'sideBarMenuItem')
        updateMenuItem(oldMenu, rebuilt, 'tabBarMenuItem')
        REVIEW_STATE_MENU_IDS.forEach((id) => updateMenuItem(oldMenu, rebuilt, id))
        DOCUMENT_CLIPBOARD_MENU_IDS.forEach(
          id => updateMenuItem(oldMenu, rebuilt, id)
        )
        newMenu = rebuilt
      } else if (type === MenuType.SETTINGS) {
        newMenu = this._buildSettingMenu().menu
        if (!newMenu) return
      } else {
        return
      }

      value.menu = newMenu
      if (this.activeWindowId === key) {
        this._setApplicationMenu(newMenu)
      }
    })
  }

  /**
   * Update always on top menu item.
   *
   * @param windowId The window id.
   * @param flag Always on top.
   */
  updateAlwaysOnTopMenu(windowId: number, flag: boolean): void {
    const menus = this.getWindowMenuById(windowId)
    const menu = menus.getMenuItemById('alwaysOnTopMenuItem')
    if (menu) menu.checked = flag
  }

  /**
   * Update theme menu state across editor menus.
   */
  updateThemeMenu = ({ theme, followSystemTheme }: ThemeMenuChange = {}): void => {
    this.windowMenus.forEach((value) => {
      const { menu, type } = value
      if (type !== MenuType.EDITOR || !menu) {
        return
      }

      const themeMenus = menu.getMenuItemById('themeMenu')
      if (!themeMenus || !themeMenus.submenu) {
        return
      }

      themeMenus.submenu.items.forEach((item) => {
        if (item.type === 'radio' && typeof followSystemTheme !== 'undefined') {
          item.enabled = !followSystemTheme
        }

        if (item.id === 'follow-system-theme' && typeof followSystemTheme !== 'undefined') {
          item.checked = followSystemTheme
        }

        if (item.type === 'radio' && typeof theme !== 'undefined') {
          item.checked = item.id === theme
        } else if (item.id && item.id === theme) {
          item.checked = true
        }
      })
    })
  }

  /**
   * Update all auto save entries from editor menus to the given state.
   */
  updateAutoSaveMenu = (autoSave: boolean): void => {
    this.windowMenus.forEach((value) => {
      const { menu, type } = value
      if (type !== MenuType.EDITOR || !menu) {
        return
      }

      const autoSaveMenu = menu.getMenuItemById('autoSaveMenuItem')
      if (!autoSaveMenu) {
        return
      }
      autoSaveMenu.checked = autoSave
    })
  }

  _buildEditorMenu(recentUsedDocuments: string[] | null = null): WindowMenuEntry {
    if (!recentUsedDocuments) {
      recentUsedDocuments = this.getRecentlyUsedDocuments()
    }

    const menuTemplate = configureMenu(this._keybindings, this._preferences, recentUsedDocuments)
    const menu = Menu.buildFromTemplate(menuTemplate)
    return { menu, type: MenuType.EDITOR }
  }

  _buildSettingMenu(): WindowMenuEntry {
    if (isOsx) {
      const menuTemplate = configSettingMenu(this._keybindings)
      const menu = Menu.buildFromTemplate(menuTemplate)
      return { menu, type: MenuType.SETTINGS }
    }
    return { menu: null, type: MenuType.SETTINGS }
  }

  _setApplicationMenu(menu: Menu | null): void {
    if (isLinux && !menu) {
      // WORKAROUND for Electron#16521: We cannot hide the (application) menu on Linux.
      const dummyMenu = Menu.buildFromTemplate([])
      Menu.setApplicationMenu(dummyMenu)
    } else {
      Menu.setApplicationMenu(menu)
    }
  }

  /**
   * Initialize main process language from preferences
   */
  async _initializeLanguage(): Promise<void> {
    try {
      const currentLanguage = this._preferences.getItem<string>('language')
      if (currentLanguage) {
        setLanguage(currentLanguage)
        log.info(`Main process language initialized to: ${currentLanguage}`)
      }
    } catch (error) {
      log.error('Failed to initialize main process language:', error)
    }
  }

  _listenForIpcMain(): void {
    const senderMenuState = <T>(
      event: IpcMainEvent,
      rawArguments: readonly unknown[],
      decode: (value: unknown) => T,
      label: string
    ): Readonly<{ menu: Menu; state: T }> | null => {
      let state
      try {
        if (rawArguments.length !== 1) {
          throw new TypeError(`${label} accepts exactly one state argument`)
        }
        state = decode(rawArguments[0])
      } catch (error) {
        log.error(`${label} rejected:`, error)
        return null
      }
      const senderWindow = BrowserWindow.fromWebContents(event.sender)
      if (!senderWindow || !this.has(senderWindow.id)) {
        log.error(`${label} rejected: sender has no live window menu.`)
        return null
      }
      return Object.freeze({
        menu: this.getWindowMenuById(senderWindow.id),
        state
      })
    }

    ipcMain.on(
      'mt::update-format-menu',
      (event, ...rawArguments: unknown[]) => {
        const decoded = senderMenuState(
          event,
          rawArguments,
          decodeDocumentFormatMenuState,
          'Format menu update'
        )
        if (decoded === null) return
        updateFormatMenu(decoded.menu, decoded.state)
      }
    )
    ipcMain.on('mt::update-sidebar-menu', (event, ...rawArguments: unknown[]) => {
      const decoded = senderMenuState(
        event,
        rawArguments,
        decodeSidebarMenuVisibility,
        'Sidebar menu update'
      )
      if (decoded === null) return
      updateSidebarMenu(decoded.menu, decoded.state)
    })
    ipcMain.on(
      'mt::update-review-menu',
      (event, ...rawArguments: unknown[]) => {
        const decoded = senderMenuState(
          event,
          rawArguments,
          decodeCriticMarkupReviewMenuState,
          'Review menu update'
        )
        if (decoded === null) return
        updateReviewMenu(decoded.menu, decoded.state)
      }
    )
    ipcMain.on(
      'mt::view-layout-changed',
      (event, ...rawArguments: unknown[]) => {
        const decoded = senderMenuState(
          event,
          rawArguments,
          decodeWindowLayoutMenuState,
          'View layout menu update'
        )
        if (decoded === null) return
        viewLayoutChanged(decoded.menu, decoded.state)
      }
    )
    ipcMain.on('mt::editor-selection-changed', (event, ...rawArguments: unknown[]) => {
      const decoded = senderMenuState(
        event,
        rawArguments,
        decodeDocumentSelectionMenuState,
        'Selection menu update'
      )
      if (decoded === null) return
      updateSelectionMenus(decoded.menu, decoded.state)
    })
    // G5: availability is a property of a command. The renderer projects
    // the per-revision capability snapshot into these bits; the menu never
    // re-derives them from editor state.
    ipcMain.on(
      'mt::set-document-capability-menu-state',
      (event, ...rawArguments: unknown[]) => {
        const decoded = senderMenuState(
          event,
          rawArguments,
          decodeDocumentCapabilityMenuState,
          'Document capability menu update'
        )
        if (decoded === null) return
        const EDIT_ROW_IDS: Readonly<Partial<
          Record<DocumentCapabilityMenuRow, string>
        >> = {
          undo: 'editUndoMenuItem',
          redo: 'editRedoMenuItem',
          duplicateBlock: 'editDuplicateMenuItem',
          insertParagraph: 'editCreateParagraphMenuItem',
          deleteBlock: 'editDeleteParagraphMenuItem'
        }
        for (const row of DOCUMENT_CAPABILITY_MENU_ROWS) {
          const id = EDIT_ROW_IDS[row] ?? `${row}MenuItem`
          const item = decoded.menu.getMenuItemById(id)
          if (item !== null) item.enabled = decoded.state[row]
        }
      }
    )
    ipcMain.on(
      'mt::set-document-clipboard-menu-state',
      (event, ...rawArguments: unknown[]) => {
        const decoded = senderMenuState(
          event,
          rawArguments,
          decodeDocumentClipboardMenuState,
          'Document clipboard menu update'
        )
        if (decoded === null) return
        setSemanticClipboardMenuState(
          decoded.menu,
          documentClipboardConsumerPolicy(decoded.state)
        )
      }
    )

    // In Source mode the Paragraph and Format commands target the hidden
    // semantic surface, so grey them out; on return, the next verified
    // selection publication refines their state (#3531).
    onInternalChannel('menu-add-recently-used', (pathname: string) => {
      this.addRecentlyUsedDocument(pathname)
    })
    onInternalChannel('menu-clear-recently-used', () => {
      this.clearRecentlyUsedDocuments()
    })

    onInternalChannel('broadcast-preferences-changed', async(prefs: Partial<IUserPreferences>) => {
      if (prefs.theme !== undefined || prefs.followSystemTheme !== undefined) {
        this.updateAppMenu()
      }
      if (prefs.autoSave !== undefined) {
        this.updateAutoSaveMenu(prefs.autoSave)
      }
      if (prefs.language) {
        // Update main process language and rebuild menu
        setLanguage(prefs.language)
        this.updateAppMenu()
      }
    })
  }
}

const updateMenuItem = (oldMenus: Menu, newMenus: Menu, id: string): void => {
  const oldItem = oldMenus.getMenuItemById(id)
  const newItem = newMenus.getMenuItemById(id)
  if (oldItem && newItem) {
    newItem.checked = oldItem.checked
    newItem.enabled = oldItem.enabled
  }
}

// ----------------------------------------------

// HACKY: We have one application menu per window and switch the menu when
// switching windows, so we can access and change the menu items via Electron.

/**
 * Return the menu from the application menu.
 *
 * @param menuId Menu ID
 * @returns Returns the menu or null.
 */
export const getMenuItemById = (menuId: string): Electron.MenuItem | null => {
  const menus = Menu.getApplicationMenu()
  if (!menus) return null
  return menus.getMenuItemById(menuId)
}

export default AppMenu
