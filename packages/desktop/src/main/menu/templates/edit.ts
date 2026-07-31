import { type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import * as actions from '../actions/edit'
import { isOsx } from '../../config'
import { COMMANDS } from '../../commands'
import { t } from '../../i18n'
import type Keybindings from '../../keyboard/shortcutHandler'

export default function(keybindings: Keybindings): MenuItemConstructorOptions {
  return {
    label: t('menu.edit.edit'),
    submenu: [
      {
        id: 'editUndoMenuItem',
        label: t('menu.edit.undo'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_UNDO) ?? undefined,
        click: (_menuItem, browserWindow) => {
          actions.editorUndo(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        id: 'editRedoMenuItem',
        label: t('menu.edit.redo'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_REDO) ?? undefined,
        click: (_menuItem, browserWindow) => {
          actions.editorRedo(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        type: 'separator'
      },
      {
        id: 'editCutMenuItem',
        label: t('menu.edit.cut'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_CUT) ?? undefined,
        click(_menuItem, browserWindow) {
          actions.nativeCut(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        id: 'editCopyMenuItem',
        label: t('menu.edit.copy'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_COPY) ?? undefined,
        click(_menuItem, browserWindow) {
          actions.nativeCopy(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        id: 'editPasteMenuItem',
        label: t('menu.edit.paste'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_PASTE) ?? undefined,
        click(_menuItem, browserWindow) {
          actions.nativePaste(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        type: 'separator'
      },
      {
        id: 'editCopyAsRichMenuItem',
        label: t('menu.edit.copyAsRich'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_COPY_AS_RICH) ?? undefined,
        click(_menuItem, browserWindow) {
          actions.editorCopyAsRich(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        id: 'editCopyAsHtmlMenuItem',
        label: t('menu.edit.copyAsHtml'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_COPY_AS_HTML) ?? undefined,
        click(_menuItem, browserWindow) {
          actions.editorCopyAsHtml(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        id: 'editPasteAsPlainTextMenuItem',
        label: t('menu.edit.pasteAsPlainText'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_PASTE_AS_PLAINTEXT) ?? undefined,
        click(_menuItem, browserWindow) {
          actions.editorPasteAsPlainText(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        type: 'separator'
      },
      {
        id: 'editSelectAllMenuItem',
        label: t('menu.edit.selectAll'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_SELECT_ALL) ?? undefined,
        click(_menuItem, browserWindow) {
          actions.editorSelectAll(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        type: 'separator'
      },
      {
        id: 'editDuplicateMenuItem',
        label: t('menu.edit.duplicate'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_DUPLICATE) ?? undefined,
        click(_menuItem, browserWindow) {
          actions.editorDuplicate(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        id: 'editCreateParagraphMenuItem',
        label: t('menu.edit.createParagraph'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_CREATE_PARAGRAPH) ?? undefined,
        click(_menuItem, browserWindow) {
          actions.editorCreateParagraph(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        id: 'editDeleteParagraphMenuItem',
        label: t('menu.edit.deleteParagraph'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_DELETE_PARAGRAPH) ?? undefined,
        click(_menuItem, browserWindow) {
          actions.editorDeleteParagraph(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        type: 'separator'
      },
      {
        id: 'editFindMenuItem',
        label: t('menu.edit.find'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_FIND) ?? undefined,
        click(_menuItem, browserWindow) {
          actions.editorFind(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        id: 'editFindNextMenuItem',
        label: t('menu.edit.findNext'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_FIND_NEXT) ?? undefined,
        click(_menuItem, browserWindow) {
          actions.editorFindNext(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        id: 'editFindPreviousMenuItem',
        label: t('menu.edit.findPrevious'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_FIND_PREVIOUS) ?? undefined,
        click(_menuItem, browserWindow) {
          actions.editorFindPrevious(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        id: 'editReplaceMenuItem',
        label: t('menu.edit.replace'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_REPLACE) ?? undefined,
        click(_menuItem, browserWindow) {
          actions.editorReplace(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        type: 'separator'
      },
      {
        id: 'editFindInFolderMenuItem',
        label: t('menu.edit.findInFolder'),
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_FIND_IN_FOLDER) ?? undefined,
        click(_menuItem, browserWindow) {
          actions.findInFolder(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        type: 'separator'
      },
      {
        label: t('menu.edit.screenshot'),
        id: 'screenshot',
        visible: isOsx,
        accelerator: keybindings.getAccelerator(COMMANDS.EDIT_SCREENSHOT) ?? undefined,
        click(_menuItem, browserWindow) {
          actions.screenshot(browserWindow as BrowserWindow | undefined)
        }
      },
      {
        // Screenshot is macOS-only; hide its trailing separator too so
        // Windows/Linux don't show a doubled divider here (#2997).
        type: 'separator',
        visible: isOsx
      }
    ]
  }
}
