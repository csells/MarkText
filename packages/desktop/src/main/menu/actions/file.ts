import {
  BrowserWindow,
  app,
  ipcMain,
  type MenuItem
} from 'electron'
import log from 'electron-log'
import { isDirectory, isFile } from 'common/filesystem'
import { MARKDOWN_EXTENSIONS } from 'common/filesystem/paths'
import { checkUpdates, userSetting } from './marktext'
import { showTabBar } from './view'
import { COMMANDS } from '../../commands'
import type { CommandManager } from '../../commands'
import { PANDOC_EXTENSIONS } from '../../config'
import { normalizeAndResolvePath } from '../../filesystem'
import pandoc from '../../utils/pandoc'
import { t } from '../../i18n'
import { presentationPolicy } from '../../presentationPolicy'
import {
  closeDocumentCoreFile,
  inspectDocumentCoreFiles,
  saveDocumentCoreFile
} from '../../ipc/documentCore'
import {
  decodeDocumentCoreLifecycleIntent
} from '../../ipc/documentFileRuntimeCodec'
import {
  coordinateDocumentLifecycle,
  type DocumentLifecycleConfirmation
} from '../../documentCore/documentLifecycleCoordinator'
import { emitInternalChannel } from '../../utils/internalIpc'

type Win = BrowserWindow | null | undefined

const showUnsavedFilesMessage = async(
  win: BrowserWindow,
  filenames: readonly string[]
): Promise<DocumentLifecycleConfirmation> => {
  const { response } = await presentationPolicy.showMessageBox(win, {
    type: 'warning',
    buttons: [t('dialog.save'), t('dialog.dontSave'), t('dialog.cancel')],
    defaultId: 0,
    message: t('dialog.saveChanges', {
      count: filenames.length,
      type: filenames.length === 1 ? t('dialog.file') : t('dialog.files'),
      files: filenames.join('\n')
    }),
    detail: t('dialog.changesWillBeLost'),
    cancelId: 2,
    noLink: true
  })

  switch (response) {
    case 0:
      return 'save'
    case 1:
      return 'discard'
    default:
      return 'cancel'
  }
}

const documentLifecycleQueues = new Map<number, Promise<void>>()

function enqueueDocumentLifecycle<Result>(
  senderId: number,
  operation: () => Promise<Result>
): Promise<Result> {
  const previous = documentLifecycleQueues.get(senderId) ?? Promise.resolve()
  const result = previous.then(operation)
  const terminal = result.then(
    () => {},
    () => {}
  )
  documentLifecycleQueues.set(senderId, terminal)
  terminal.then(() => {
    if (documentLifecycleQueues.get(senderId) === terminal) {
      documentLifecycleQueues.delete(senderId)
    }
  })
  return result
}

const noticePandocNotFound = (win: BrowserWindow): void => {
  win.webContents.send('mt::pandoc-not-exists', {
    title: t('dialog.importWarning'),
    type: 'warning',
    message: t('dialog.installPandoc'),
    time: 10000
  })
}

const openPandocFile = async(windowId: number, pathname: string): Promise<void> => {
  try {
    const converter = pandoc(pathname, 'markdown')
    const data = await converter()
    emitInternalChannel('app-open-markdown-by-id', windowId, data)
  } catch (err) {
    log.error('Error while converting file:', err)
  }
}

// --- events -----------------------------------

ipcMain.handle('mt::document-core::lifecycle', async(event, rawIntent: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win === null) {
    throw new Error('Document lifecycle requires an editor window')
  }
  const intent = decodeDocumentCoreLifecycleIntent(rawIntent)
  return await enqueueDocumentLifecycle(event.sender.id, async() =>
    await coordinateDocumentLifecycle(intent, {
      inspectDocuments: async() =>
        await inspectDocumentCoreFiles(event.sender),
      confirmUnsaved: async(documents) =>
        await showUnsavedFilesMessage(
          win,
          documents.map(({ filename }) => filename)
        ),
      save: async(documentId) =>
        await saveDocumentCoreFile(event.sender, {
          documentId,
          mode: 'save'
        }),
      close: async(documentId) =>
        await closeDocumentCoreFile(event.sender, documentId),
      publishClosed: documentIds => {
        win.webContents.send('mt::document-core::closed', documentIds)
      },
      closeWindow: () => {
        emitInternalChannel('window-close-by-id', win.id)
      }
    })
  )
})

ipcMain.on('mt::ask-for-open-project-in-sidebar', async(e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) {
    return
  }
  const { filePaths } = await presentationPolicy.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory']
  })

  if (filePaths && filePaths[0]) {
    const resolvedPath = normalizeAndResolvePath(filePaths[0])
    emitInternalChannel('app-open-directory-by-id', win.id, resolvedPath, true)
  }
})

// --- commands -------------------------------------

ipcMain.on('mt::cmd-open-file', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  openFile(win)
})

ipcMain.on('mt::cmd-new-tab', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  newBlankTab(win)
})

ipcMain.on('mt::cmd-new-editor-window', () => {
  newEditorWindow()
})

ipcMain.on('mt::cmd-open-folder', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  openFolder(win)
})

ipcMain.on('mt::cmd-close-window', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (win) {
    win.close()
  }
})

ipcMain.on('mt::cmd-import-file', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (win) {
    importFile(win)
  }
})

// --- menu -------------------------------------

export const exportFile = (win: Win, type: string): void => {
  if (win && win.webContents) {
    win.webContents.send('mt::show-export-dialog', type)
  }
}

export const importFile = async(win: BrowserWindow | null): Promise<void> => {
  if (!win) {
    return
  }
  const existsPandoc = pandoc.exists()

  if (!existsPandoc) {
    noticePandocNotFound(win)
    return
  }

  const { filePaths } = await presentationPolicy.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      {
        name: 'All Files',
        extensions: [...PANDOC_EXTENSIONS]
      }
    ]
  })

  if (filePaths && filePaths[0]) {
    openPandocFile(win.id, filePaths[0])
  }
}

export const printDocument = (win: Win): void => {
  if (win) {
    win.webContents.send('mt::show-export-dialog', 'print')
  }
}

export const openFile = async(win: BrowserWindow | null): Promise<void> => {
  if (!win) {
    return
  }
  const { filePaths } = await presentationPolicy.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Markdown document',
        extensions: [...MARKDOWN_EXTENSIONS]
      }
    ]
  })

  if (Array.isArray(filePaths) && filePaths.length > 0) {
    emitInternalChannel('app-open-files-by-id', win.id, filePaths)
  }
}

export const openFolder = async(win: BrowserWindow | null): Promise<void> => {
  if (!win) {
    return
  }
  const { filePaths } = await presentationPolicy.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory']
  })

  if (filePaths && filePaths[0]) {
    openFileOrFolder(win, filePaths[0])
  }
}

export const openFileOrFolder = (win: BrowserWindow, pathname: string): void => {
  const resolvedPath = normalizeAndResolvePath(pathname)
  if (isFile(resolvedPath)) {
    emitInternalChannel('app-open-file-by-id', win.id, resolvedPath)
  } else if (isDirectory(resolvedPath)) {
    emitInternalChannel('app-open-directory-by-id', win.id, resolvedPath)
  } else {
    console.error(`[ERROR] Cannot open unknown file: "${resolvedPath}"`)
  }
}

export const newBlankTab = (win: Win): void => {
  if (win && win.webContents) {
    emitInternalChannel('app-new-untitled-tab-by-id', win.id)
    showTabBar(win)
  }
}

export const newEditorWindow = (): void => {
  emitInternalChannel('app-create-editor-window')
}

export const closeTab = (win: Win): void => {
  if (win && win.webContents) {
    win.webContents.send('mt::editor-close-tab')
  }
}

export const closeWindow = (win: Win): void => {
  if (win) {
    win.close()
  }
}

export const save = (win: Win): void => {
  if (win && win.webContents) {
    win.webContents.send('mt::editor-ask-file-save')
  }
}

export const saveAs = (win: Win): void => {
  if (win && win.webContents) {
    win.webContents.send('mt::editor-ask-file-save-as')
  }
}

export const exportPDF = (win: Win): void => {
  if (win && win.webContents) {
    exportFile(win, 'pdf')
  }
}

export const autoSave = (menuItem: MenuItem, _browserWindow: BrowserWindow | undefined): void => {
  const { checked } = menuItem
  emitInternalChannel('set-user-preference', { autoSave: checked })
}

export const moveTo = (win: Win): void => {
  if (win && win.webContents) {
    win.webContents.send('mt::editor-move-file')
  }
}

export const rename = (win: Win): void => {
  if (win && win.webContents) {
    win.webContents.send('mt::editor-rename-file')
  }
}

export const clearRecentlyUsed = (): void => {
  emitInternalChannel('menu-clear-recently-used')
}

// --- Commands -------------------------------------------------------------

export const loadFileCommands = (commandManager: CommandManager): void => {
  commandManager.add(COMMANDS.FILE_CHECK_UPDATE, checkUpdates)
  commandManager.add(COMMANDS.FILE_CLOSE_TAB, closeTab)
  commandManager.add(COMMANDS.FILE_CLOSE_WINDOW, closeWindow)
  commandManager.add(COMMANDS.FILE_EXPORT_FILE, exportFile)
  commandManager.add(COMMANDS.FILE_IMPORT_FILE, importFile)
  commandManager.add(COMMANDS.FILE_MOVE_FILE, moveTo)
  commandManager.add(COMMANDS.FILE_NEW_FILE, newEditorWindow)
  commandManager.add(COMMANDS.FILE_NEW_TAB, newBlankTab)
  commandManager.add(COMMANDS.FILE_OPEN_FILE, openFile)
  commandManager.add(COMMANDS.FILE_OPEN_FOLDER, openFolder)
  commandManager.add(COMMANDS.FILE_PREFERENCES, userSetting)
  commandManager.add(COMMANDS.FILE_PRINT, printDocument)
  commandManager.add(COMMANDS.FILE_QUIT, app.quit)
  commandManager.add(COMMANDS.FILE_RENAME_FILE, rename)
  commandManager.add(COMMANDS.FILE_SAVE, save)
  commandManager.add(COMMANDS.FILE_SAVE_AS, saveAs)
  commandManager.add(COMMANDS.FILE_EXPORT_FILE_PDF, exportPDF)
}
