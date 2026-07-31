import type { BrowserWindow, Menu, MenuItem } from 'electron'
import { COMMANDS } from '../../commands'
import type { CommandManager } from '../../commands'
import { emitInternalChannel } from '../../utils/internalIpc'
import type {
  DocumentClipboardConsumerPolicy
} from '@shared/types/documentSurface'
import type { EditorCommandId } from '@shared/types/editorCommands'

type Win = BrowserWindow | null | undefined

const SEMANTIC_CLIPBOARD_MENU_IDS = Object.freeze({
  copyAsRich: 'editCopyAsRichMenuItem',
  copyAsHtml: 'editCopyAsHtmlMenuItem',
  pasteAsPlainText: 'editPasteAsPlainTextMenuItem'
} as const)

// --- Menu actions -------------------------------------------------------------

export const editorUndo = (win: Win): void => {
  edit(win, 'undo')
}

export const editorRedo = (win: Win): void => {
  edit(win, 'redo')
}

export const editorCopyAsRich = (win: Win): void => {
  edit(win, 'copy-as-rich')
}

export const editorCopyAsHtml = (win: Win): void => {
  edit(win, 'copy-as-html')
}

export const editorPasteAsPlainText = (win: Win): void => {
  edit(win, 'paste-as-plain-text')
}

export const editorSelectAll = (win: Win): void => {
  edit(win, 'select-all')
}

export const editorDuplicate = (win: Win): void => {
  edit(win, 'duplicate-block')
}

export const editorCreateParagraph = (win: Win): void => {
  edit(win, 'insert-paragraph')
}

export const editorDeleteParagraph = (win: Win): void => {
  edit(win, 'delete-block')
}

export const editorFind = (win: Win): void => {
  edit(win, 'find')
}

export const editorFindNext = (win: Win): void => {
  edit(win, 'find-next')
}

export const editorFindPrevious = (win: Win): void => {
  edit(win, 'find-previous')
}

export const editorReplace = (win: Win): void => {
  edit(win, 'replace')
}

export const findInFolder = (win: Win): void => {
  edit(win, 'find-in-folder')
}

export const edit = (win: Win, command: EditorCommandId): void => {
  if (win && win.webContents) {
    win.webContents.send('mt::editor-command', command)
  }
}

export const setSemanticClipboardMenuState = (
  applicationMenu: Menu,
  state: DocumentClipboardConsumerPolicy
): void => {
  for (const [command, id] of Object.entries(
    SEMANTIC_CLIPBOARD_MENU_IDS
  ) as Array<
    [keyof DocumentClipboardConsumerPolicy, string]
  >) {
    const item = applicationMenu.getMenuItemById(id)
    if (item !== null) item.enabled = state[command]
  }
}

export const nativeCut = (win: Win): void => {
  if (win) {
    win.webContents.cut()
  }
}

export const nativeCopy = (win: Win): void => {
  if (win) {
    win.webContents.copy()
  }
}

export const nativePaste = (win: Win): void => {
  if (win) {
    win.webContents.paste()
  }
}

export const screenshot = (win: Win): void => {
  emitInternalChannel('screen-capture', win)
}

// --- Commands -------------------------------------------------------------

export const loadEditCommands = (commandManager: CommandManager): void => {
  commandManager.add(COMMANDS.EDIT_COPY, nativeCopy)
  commandManager.add(COMMANDS.EDIT_COPY_AS_HTML, editorCopyAsHtml)
  commandManager.add(COMMANDS.EDIT_COPY_AS_RICH, editorCopyAsRich)
  commandManager.add(COMMANDS.EDIT_CREATE_PARAGRAPH, editorCreateParagraph)
  commandManager.add(COMMANDS.EDIT_CUT, nativeCut)
  commandManager.add(COMMANDS.EDIT_DELETE_PARAGRAPH, editorDeleteParagraph)
  commandManager.add(COMMANDS.EDIT_DUPLICATE, editorDuplicate)
  commandManager.add(COMMANDS.EDIT_FIND, editorFind)
  commandManager.add(COMMANDS.EDIT_FIND_IN_FOLDER, findInFolder)
  commandManager.add(COMMANDS.EDIT_FIND_NEXT, editorFindNext)
  commandManager.add(COMMANDS.EDIT_FIND_PREVIOUS, editorFindPrevious)
  commandManager.add(COMMANDS.EDIT_PASTE, nativePaste)
  commandManager.add(COMMANDS.EDIT_PASTE_AS_PLAINTEXT, editorPasteAsPlainText)
  commandManager.add(COMMANDS.EDIT_REDO, editorRedo)
  commandManager.add(COMMANDS.EDIT_REPLACE, editorReplace)
  commandManager.add(COMMANDS.EDIT_SCREENSHOT, screenshot)
  commandManager.add(COMMANDS.EDIT_SELECT_ALL, editorSelectAll)
  commandManager.add(COMMANDS.EDIT_UNDO, editorUndo)
}

// --- IPC events -------------------------------------------------------------

// NOTE: Don't use static `getMenuItemById` here, instead request the menu by
//       window id from `AppMenu` manager.

export const updateSidebarMenu = (applicationMenu: Menu, value: unknown): void => {
  const sideBarMenuItem: MenuItem = applicationMenu.getMenuItemById('sideBarMenuItem')!
  sideBarMenuItem.checked = !!value
}
