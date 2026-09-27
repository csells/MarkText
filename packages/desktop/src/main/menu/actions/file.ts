import { rename as fsRename } from 'fs-extra'
import path from 'path'
import {
  BrowserWindow,
  app,
  dialog,
  shell,
  ipcMain,
  type IpcMainEvent,
  type MenuItem
} from 'electron'
import log from 'electron-log'
import { getEncodingName } from 'common/encoding'
import { isDirectory, isFile, exists } from 'common/filesystem'
import {
  MARKDOWN_EXTENSIONS,
  isDangerousExecutableFile,
  isMarkdownFile
} from 'common/filesystem/paths'
import { checkUpdates, userSetting } from './marktext'
import { showTabBar } from './view'
import { COMMANDS } from '../../commands'
import type { CommandManager } from '../../commands'
import { EXTENSION_HASN, PANDOC_EXTENSIONS, URL_REG } from '../../config'
import { normalizeAndResolvePath, resolveLocalLinkTarget, writeFile } from '../../filesystem'
import { LossyDecodeError } from '../../filesystem/encoding'
import { writeMarkdownFile } from '../../filesystem/markdown'
import { getPath } from '../../utils'
import pandoc, {
  PANDOC_EXPORT_FORMATS,
  formatLinksMedia,
  getPandocLanguage,
  listLinkedMedia,
  shouldMirrorMedia,
  toPandocJson
} from '../../utils/pandoc'
import { t, getCurrentLanguage } from '../../i18n'
import type {
  DocumentSaveIdentity,
  PandocExportPayload,
  TabOptions,
  UnsavedFile
} from '@shared/types/files'
import { prepareWindowClose } from '../../windows/prepareClose'
import { isSameSaveDestination, withSaveDestination } from '../../windows/saveDestination'

type Win = BrowserWindow | null | undefined

interface PageOptions {
  pageSize?: string
  pageSizeWidth?: number
  pageSizeHeight?: number
  isLandscape?: boolean
}

// TODO(refactor): "save" and "save as" should be moved to the editor window (editor.js) and
// the renderer should communicate only with the editor window for file relevant stuff.
// E.g. "mt::save-tabs" --> "mt::window-save-tabs$wid:<windowId>"

const getExportExtensionFilter = (type: string): Electron.FileFilter[] | undefined => {
  if (type === 'pdf') {
    return [
      {
        name: 'Portable Document Format',
        extensions: ['pdf']
      }
    ]
  } else if (type === 'styledHtml') {
    return [
      {
        name: 'Hypertext Markup Language',
        extensions: ['html']
      }
    ]
  }

  // Allow all extensions.
  return undefined
}

const getPdfPageOptions = (options?: PageOptions): Record<string, unknown> => {
  if (!options) {
    return {}
  }

  const { pageSize, pageSizeWidth, pageSizeHeight, isLandscape } = options
  if (pageSize === 'custom' && pageSizeWidth && pageSizeHeight) {
    return {
      // Note: mm to microns
      pageSize: { height: pageSizeHeight * 1000, width: pageSizeWidth * 1000 },
      landscape: !!isLandscape
    }
  } else {
    return { pageSize, landscape: !!isLandscape }
  }
}

interface ExportPayload {
  type: string
  content?: string
  pathname?: string
  title?: string
  pageOptions?: PageOptions
}

/** A title or heading can carry a slash, a basename what the OS refuses; empty is `Untitled`. */
const sanitizeFilename = (name?: string): string =>
  (name || '').replace(/[/\\:*?"<>|]/g, '-').trim() || 'Untitled'

// Handle the export response from renderer process.
const handleResponseForExport = async(e: IpcMainEvent, payload: ExportPayload): Promise<void> => {
  const { type, content, pathname, title, pageOptions } = payload
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) {
    return
  }
  const extension = (EXTENSION_HASN as Record<string, string>)[type]
  const dirname = pathname ? path.dirname(pathname) : getPath('documents')
  const nakedFilename = sanitizeFilename(pathname ? path.basename(pathname, '.md') : title)

  const defaultPath = path.join(dirname, `${nakedFilename}${extension}`)
  const { filePath, canceled } = await dialog.showSaveDialog(win, {
    defaultPath,
    filters: getExportExtensionFilter(type)
  })

  if (filePath && !canceled) {
    try {
      if (type === 'pdf') {
        // Build a clickable bookmark/outline tree from the document's h1-h6
        // headings so exported PDFs have a navigation pane (#2989). The outline
        // is derived from the tagged-PDF structure tree, so generateTaggedPDF is
        // required — generateDocumentOutline alone produces no outline.
        const options: Electron.PrintToPDFOptions = {
          printBackground: true,
          generateTaggedPDF: true,
          generateDocumentOutline: true
        }
        Object.assign(options, getPdfPageOptions(pageOptions))
        const data = await win.webContents.printToPDF(options)
        removePrintServiceFromWindow(win)
        await writeFile(filePath, data, extension!, 'binary')
      } else {
        if (!content) {
          throw new Error('No HTML content found.')
        }
        await writeFile(filePath, content, extension!, 'utf8')
      }
      win.webContents.send('mt::export-success', { type, filePath })
    } catch (err) {
      log.error('Error while exporting:', err)
      const ERROR_MSG =
        (err instanceof Error && err.message) || `Error happened when export ${filePath}`
      win.webContents.send('mt::show-notification', {
        title: 'Export failure',
        type: 'error',
        message: ERROR_MSG
      })
    }
  } else {
    // User canceled save dialog
    if (type === 'pdf') {
      removePrintServiceFromWindow(win)
    }
  }
}

/** Bodies are HTML and pandoc echoes document text into them, so escape first. */
const escapeNotificationText = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const MAX_PANDOC_WARNING_LINES = 5

// The first few warning lines plus a count of the rest — pandoc prints one per link.
const summarizePandocWarnings = (warnings: string): string => {
  const lines = warnings
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const shown = lines.slice(0, MAX_PANDOC_WARNING_LINES).map(escapeNotificationText)
  const hidden = lines.length - MAX_PANDOC_WARNING_LINES
  if (hidden > 0) {
    shown.push(escapeNotificationText(t('dialog.exportWarningMore', { count: hidden })))
  }

  // The body is HTML, so pandoc's line-per-warning output needs explicit breaks.
  return shown.join('<br>')
}

const handlePandocExport = async(e: IpcMainEvent, payload: PandocExportPayload): Promise<void> => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return

  const format = PANDOC_EXPORT_FORMATS.find((f) => f.id === payload.target)
  if (!format) {
    log.error(`Unknown pandoc export target: ${payload.target}`)
    return
  }

  const { document, title, pathname } = payload
  // The save dialog and pandoc's link resolution both need the document's folder.
  const sourceDir = pathname ? path.dirname(pathname) : undefined
  const stem = sanitizeFilename(pathname ? path.basename(pathname, path.extname(pathname)) : title)
  let filePath = ''
  // Awaited inside the try, so a save the OS refuses becomes a notification.
  try {
    const { filePath: chosen, canceled } = await dialog.showSaveDialog(win, {
      defaultPath: path.join(sourceDir ?? getPath('documents'), `${stem}${format.extension}`),
      filters: [{ name: format.label, extensions: [format.extension.slice(1)] }]
    })
    if (canceled || !chosen || win.isDestroyed()) return
    // What comes back is the user's answer, "replace this one" included.
    filePath = chosen
    // The plain-text writers keep images as links, so the pictures are mirrored along.
    const linksMedia = formatLinksMedia(format.target)
    const media = linksMedia ? listLinkedMedia(document) : []

    // The renderer built the AST from Core's parse; pandoc never reads the Markdown.
    const input = await toPandocJson(document)
    const { warnings } = await pandoc.toFile(format.target, filePath, input, {
      cwd: sourceDir,
      resourcePath: sourceDir,
      mirrorMedia: linksMedia && shouldMirrorMedia(media, sourceDir, filePath),
      // Only EPUB takes a title, for its title page; `lang` is the app's, not the spawn locale.
      metadata: {
        ...(format.target === 'epub3' ? { title: title || stem } : {}),
        lang: getPandocLanguage(getCurrentLanguage())
      }
    })

    // Exit code 0 is not a clean conversion: an image pandoc could not fetch becomes its
    // alt text with a warning. The summary is the guard — a lone newline is truthy but
    // shows nothing — and it goes first so one click dismisses it.
    const message = summarizePandocWarnings(warnings)
    if (message && !win.isDestroyed()) {
      log.warn(`pandoc export warnings for ${filePath}:`, warnings)
      win.webContents.send('mt::show-notification', {
        title: t('dialog.exportWarning'),
        type: 'warning',
        message
      })
    }
    // Whether or not the pictures could be mirrored, the notice has to say they are links.
    if (!win.isDestroyed()) {
      win.webContents.send('mt::export-success', { type: format.id, filePath, linksMedia })
    }
  } catch (err) {
    log.error('Error while exporting with pandoc:', err)
    if (win.isDestroyed()) return
    const ERROR_MSG =
      (err instanceof Error && err.message) || `Error happened when export ${filePath}`
    // pandoc errors run several lines and the body is HTML, so the raw text is the fallback.
    win.webContents.send('mt::show-notification', {
      title: t('editor.export.failed', { type: format.label }),
      type: 'error',
      message: summarizePandocWarnings(ERROR_MSG) || escapeNotificationText(ERROR_MSG)
    })
  }
}

const handleResponseForPrint = async(e: IpcMainEvent): Promise<void> => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) {
    return
  }
  win.webContents.print({ printBackground: true }, () => {
    removePrintServiceFromWindow(win)
  })
}

/**
 * Resolves false when the user keeps a file whose bytes did not survive
 * decoding rather than let an edited save replace them. Replacing a different
 * file was already confirmed by the save dialog, so Save As never asks.
 */
const writeMarkdownWithConsent = async(
  win: BrowserWindow,
  filePath: string,
  sourcePathname: string | undefined,
  markdown: string,
  options: Parameters<typeof writeMarkdownFile>[2]
): Promise<boolean> => {
  try {
    await writeMarkdownFile(filePath, markdown, options)
    return true
  } catch (error) {
    if (!(error instanceof LossyDecodeError)) throw error
    if (sourcePathname !== undefined && isSameSaveDestination(filePath, sourcePathname)) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: [t('dialog.cancel'), t('dialog.saveAnyway')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: t('dialog.lossyDecodeTitle'),
        message: t('dialog.lossyDecodeMessage', { encoding: getEncodingName(error.encoding) }),
        detail: t('dialog.lossyDecodeDetail', { name: path.basename(filePath) })
      })
      if (response !== 1) return false
    }
    await writeMarkdownFile(filePath, markdown, options, { allowLossyDecode: true })
    return true
  }
}

const handleResponseForSave = async(
  e: IpcMainEvent,
  id: string,
  filename: string,
  pathname: string | undefined,
  markdown: string,
  options: UnsavedFile['options'],
  defaultPath?: string,
  saveIdentity?: DocumentSaveIdentity | null,
  saveAs: boolean = false,
  title?: string
): Promise<string | { id: string; saveIdentity: DocumentSaveIdentity } | void> => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) {
    return Promise.resolve()
  }
  // The renderer reads the title from Core's parse of the document.
  const recommendFilename = title || filename || 'Untitled'

  // If the file doesn't exist on disk add it to the recently used documents later
  // and execute file from filesystem watcher for a short time. The file may exists
  // on disk nevertheless but is already tracked by MarkText.
  const alreadyExistOnDisk = !!pathname

  let filePath = pathname

  if (!filePath || saveAs) {
    const { filePath: dialogPath, canceled } = await dialog.showSaveDialog(win, {
      defaultPath:
        pathname || path.join(defaultPath || getPath('documents'), `${recommendFilename}.md`)
    })

    if (dialogPath && !canceled) {
      filePath = dialogPath
    } else {
      return
    }
  }

  // Save dialog canceled by user - no error.
  if (!filePath) {
    return Promise.resolve()
  }

  filePath = path.resolve(filePath)
  const extension = path.extname(filePath) || '.md'
  filePath = !filePath.endsWith(extension) ? (filePath += extension) : filePath
  // The IPC `SaveOptions` has every field optional, but writeMarkdownFile
  // requires the strict `MarkdownDocumentOptions` shape — the renderer always
  // populates every field for the unsaved-file dialog payload, so the cast
  // is safe at this seam.
  return withSaveDestination(filePath, pathname, () =>
    writeMarkdownWithConsent(
      win,
      filePath!,
      pathname,
      markdown,
      options as Parameters<typeof writeMarkdownFile>[2]
    ).then((written) => {
      if (!written) return
      if (!alreadyExistOnDisk) {
        ipcMain.emit('window-add-file-path', win.id, filePath)
        ipcMain.emit('menu-add-recently-used', filePath)

        const newFilename = path.basename(filePath!)
        win.webContents.send('mt::set-pathname', {
          id,
          pathname: filePath,
          filename: newFilename,
          saveIdentity,
          ...(saveIdentity ? { savedSource: markdown } : {})
        })
      } else if (pathname !== filePath) {
        ipcMain.emit('window-change-file-path', win.id, filePath, pathname)
        win.webContents.send('mt::set-pathname', {
          id,
          pathname: filePath,
          filename: path.basename(filePath),
          saveIdentity,
          ...(saveIdentity ? { savedSource: markdown } : {})
        })
      } else {
        ipcMain.emit('window-file-saved', win.id, filePath)
        win.webContents.send('mt::tab-saved', id, saveIdentity, ...(saveIdentity ? [markdown] : []))
      }
      return saveIdentity === undefined || saveIdentity === null ? id : { id, saveIdentity }
    })
  ).catch((err: unknown) => {
    log.error('Error while saving:', err)
    const msg = err instanceof Error ? err.message : String(err)
    win.webContents.send('mt::tab-save-failure', id, msg)
    throw err
  })
}

const showUnsavedFilesMessage = async(
  win: BrowserWindow,
  files: UnsavedFile[]
): Promise<{ needSave: boolean } | null> => {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [t('dialog.save'), t('dialog.dontSave'), t('dialog.cancel')],
    defaultId: 0,
    message: t('dialog.saveChanges', {
      count: files.length,
      type: files.length === 1 ? t('dialog.file') : t('dialog.files'),
      files: files.map((f) => f.filename).join('\n')
    }),
    detail: t('dialog.changesWillBeLost'),
    cancelId: 2,
    noLink: true
  })

  switch (response) {
    case 0:
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ needSave: true })
        })
      })
    case 1:
      return { needSave: false }
    default:
      return null
  }
}

const noticePandocNotFound = (win: BrowserWindow, titleKey = 'dialog.importWarning'): void => {
  win.webContents.send('mt::pandoc-not-exists', {
    title: t(titleKey),
    type: 'warning',
    message: t('dialog.installPandoc'),
    time: 10000
  })
}

const openPandocFile = async(windowId: number, pathname: string): Promise<void> => {
  try {
    const data = await pandoc(pathname, 'markdown')
    ipcMain.emit('app-open-markdown-by-id', windowId, data)
  } catch (err) {
    log.error('Error while converting file:', err)
  }
}

const removePrintServiceFromWindow = (win: BrowserWindow): void => {
  // remove print service content and restore GUI
  win.webContents.send('mt::print-service-clearup')
}

// --- events -----------------------------------

ipcMain.on('mt::save-tabs', (e, unsavedFiles: UnsavedFile[]) => {
  Promise.all(
    unsavedFiles.map((file) =>
      handleResponseForSave(
        e,
        file.id,
        file.filename,
        file.pathname,
        file.markdown,
        file.options,
        file.defaultPath,
        file.saveIdentity,
        false,
        file.title
      )
    )
  ).catch(log.error)
})

ipcMain.on('mt::save-and-close-tabs', async(e, unsavedFiles: UnsavedFile[]) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) {
    return
  }
  const userResult = await showUnsavedFilesMessage(win, unsavedFiles)
  if (!userResult) {
    return
  }

  const { needSave } = userResult
  if (needSave) {
    Promise.all(
      unsavedFiles.map((file) =>
        handleResponseForSave(
          e,
          file.id,
          file.filename,
          file.pathname,
          file.markdown,
          file.options,
          file.defaultPath,
          file.saveIdentity,
          false,
          file.title
        )
      )
    )
      .then((arr) => {
        const tabIds = arr.filter(
          (item): item is string | { id: string; saveIdentity: DocumentSaveIdentity } =>
            item != null
        )
        win.webContents.send('mt::force-close-tabs-by-id', tabIds)
      })
      .catch((err: unknown) => {
        log.error('Error while save all:', err)
      })
  } else {
    const tabIds = unsavedFiles.map((f) => f.id)
    win.webContents.send('mt::force-close-tabs-by-id', tabIds)
  }
})

ipcMain.on(
  'mt::response-file-save-as',
  async(
    e: IpcMainEvent,
    id: string,
    filename: string,
    pathname: string | undefined,
    markdown: string,
    options: UnsavedFile['options'],
    defaultPath?: string,
    saveIdentity?: DocumentSaveIdentity | null,
    title?: string
  ) => {
    await handleResponseForSave(
      e,
      id,
      filename,
      pathname,
      markdown,
      options,
      defaultPath,
      saveIdentity,
      true,
      title
    ).catch(() => {})
  }
)

const closingWindows = new WeakSet<BrowserWindow>()

/** Native confirmation shared by tab close and window close/quit. */
const confirmDiscardReviewInput = async(win: BrowserWindow): Promise<boolean> => {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [t('dialog.discardAndClose'), t('dialog.cancel')],
    defaultId: 1,
    cancelId: 1,
    message: t('dialog.pendingReviewInput'),
    detail: t('dialog.pendingReviewInputDetail'),
    noLink: true
  })
  return response === 0
}

ipcMain.handle('mt::confirm-discard-review-input', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  return win === null ? false : confirmDiscardReviewInput(win)
})

const handleWindowClose = async(e: IpcMainEvent, unsavedFiles?: UnsavedFile[]): Promise<void> => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win || closingWindows.has(win)) return
  closingWindows.add(win)
  let preparation: ReturnType<typeof prepareWindowClose> | undefined
  let destroy = false
  try {
    let choice =
      unsavedFiles === undefined ? undefined : await showUnsavedFilesMessage(win, unsavedFiles)
    if (choice === null) return
    preparation = prepareWindowClose(win)
    const prepared = await preparation.ready
    if (prepared.pendingReviewInput && !(await confirmDiscardReviewInput(win))) return
    const initialIds = new Set(unsavedFiles?.map((file) => file.id))
    const membershipChanged =
      unsavedFiles !== undefined &&
      (initialIds.size !== prepared.files.length ||
        prepared.files.some((file) => !initialIds.has(file.id)))
    if (
      prepared.files.length > 0 &&
      ((choice === undefined && prepared.requiresConfirmation) || membershipChanged)
    ) {
      choice = await showUnsavedFilesMessage(win, prepared.files)
      if (choice === null) return
    }
    if (choice?.needSave) {
      try {
        const results = await Promise.allSettled(
          prepared.files.map((file) =>
            handleResponseForSave(
              e,
              file.id,
              file.filename,
              file.pathname,
              file.markdown,
              file.options,
              file.defaultPath,
              file.saveIdentity,
              false,
              file.title
            )
          )
        )
        const failure = results.find((result) => result.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
        if (results.some((result) => result.status === 'fulfilled' && result.value === undefined)) {
          return
        }
      } catch (error) {
        log.error('Error while saving before quit:', error)
        const { response } = await dialog.showMessageBox(win, {
          type: 'error',
          buttons: [t('dialog.close'), t('dialog.keepOpen')],
          message: t('dialog.saveFailure'),
          detail: error instanceof Error ? error.message : String(error)
        })
        if (response !== 0) return
      }
    }
    ipcMain.emit('window-close-by-id', win.id)
    destroy = true
  } catch (error) {
    log.error('Unable to preserve editor input before close:', error)
    if (!win.webContents.isDestroyed()) {
      win.webContents.send('mt::show-notification', {
        title: t('dialog.saveFailure'),
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  } finally {
    try {
      if (!destroy && preparation !== undefined && !win.webContents.isDestroyed()) {
        win.webContents.send('mt::cancel-window-close', preparation.requestId)
      }
    } finally {
      closingWindows.delete(win)
    }
  }
}

ipcMain.on('mt::close-window-confirm', handleWindowClose)
ipcMain.on('mt::close-window', (e) => handleWindowClose(e))

ipcMain.on(
  'mt::response-file-save',
  async(
    e: IpcMainEvent,
    id: string,
    filename: string,
    pathname: string | undefined,
    markdown: string,
    options: UnsavedFile['options'],
    defaultPath?: string,
    saveIdentity?: DocumentSaveIdentity | null,
    title?: string
  ) => {
    await handleResponseForSave(
      e,
      id,
      filename,
      pathname,
      markdown,
      options,
      defaultPath,
      saveIdentity,
      false,
      title
    ).catch(() => {})
  }
)

ipcMain.on('mt::response-export', handleResponseForExport as Parameters<typeof ipcMain.on>[1])

ipcMain.on('mt::response-pandoc-export', handlePandocExport as Parameters<typeof ipcMain.on>[1])

ipcMain.on('mt::response-print', handleResponseForPrint as Parameters<typeof ipcMain.on>[1])

ipcMain.on('mt::window::drop', async(e, fileList: string[]) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) {
    return
  }
  for (const file of fileList) {
    if (isMarkdownFile(file)) {
      openFileOrFolder(win, file)
      continue
    }

    // Try to import the file
    if (PANDOC_EXTENSIONS.some((ext: string) => file.endsWith(ext))) {
      const existsPandoc = await pandoc.exists()
      if (!existsPandoc) {
        noticePandocNotFound(win)
      } else {
        openPandocFile(win.id, file)
      }
      break
    }
  }
})

interface RenamePayload {
  id: string
  pathname: string
  newPathname: string
}

const renameOpenedFile = async(
  win: BrowserWindow,
  { id, pathname, newPathname }: RenamePayload
): Promise<void> => {
  try {
    await withSaveDestination(newPathname, pathname, async() => {
      await new Promise<void>((resolve, reject) => {
        fsRename(pathname, newPathname, (error: NodeJS.ErrnoException | null) => {
          if (error) reject(error)
          else resolve()
        })
      })
      ipcMain.emit('window-change-file-path', win.id, newPathname, pathname)
      win.webContents.send('mt::set-pathname', {
        id,
        pathname: newPathname,
        filename: path.basename(newPathname)
      })
    })
  } catch (error) {
    log.error('Cannot rename file:', error)
    win.webContents.send('mt::show-notification', {
      title: t('dialog.saveFailure'),
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

ipcMain.on('mt::rename', async(e, { id, pathname, newPathname }: RenamePayload) => {
  if (pathname === newPathname) return
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) {
    return
  }

  if (!(await exists(newPathname))) {
    await renameOpenedFile(win, { id, pathname, newPathname })
  } else {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: [t('dialog.replace'), t('dialog.cancel')],
      defaultId: 1,
      message: t('dialog.fileExists', { filename: path.basename(newPathname) }),
      cancelId: 1,
      noLink: true
    })

    if (response === 0) {
      await renameOpenedFile(win, { id, pathname, newPathname })
    }
  }
})

ipcMain.on(
  'mt::response-file-move-to',
  async(e, { id, pathname }: { id: string; pathname: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) {
      return
    }
    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      buttonLabel: 'Move to',
      nameFieldLabel: 'Filename:',
      defaultPath: pathname
    })

    if (filePath && !canceled) {
      await renameOpenedFile(win, { id, pathname, newPathname: path.resolve(filePath) })
    }
  }
)

ipcMain.on('mt::ask-for-open-project-in-sidebar', async(e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) {
    return
  }
  const { filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory']
  })

  if (filePaths && filePaths[0]) {
    const resolvedPath = normalizeAndResolvePath(filePaths[0])
    ipcMain.emit('app-open-directory-by-id', win.id, resolvedPath, true)
  }
})

interface FormatLinkPayload {
  data: { href?: string; text?: string }
  dirname?: string
}

ipcMain.on('mt::format-link-click', async(e, { data, dirname }: FormatLinkPayload) => {
  if (!data || (!data.href && !data.text)) {
    return
  }
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) {
    return
  }

  const rawUrl = data.href || data.text!
  const urlCandidate = rawUrl.replace(/^<(.+)>$/, '$1') // Replace any <> CommonMark #489
  if (urlCandidate === rawUrl) {
    // No <> found, no spaces should be allowed
    if (/\s/.test(rawUrl)) {
      win.webContents.send('mt::show-notification', {
        title: 'Links cannot contain spaces',
        type: 'error',
        message:
          'Either URI encode: <code>My%20Link.md</code> <br> or wrap it in brackets: <br> <code><./My Link.md></code>. <br> See CommonMark #488 for details.'
      })
      return
    }
  }

  if (URL_REG.test(urlCandidate)) {
    shell.openExternal(urlCandidate)
    return
  } else if (/^[a-z0-9]+:\/\//i.test(urlCandidate)) {
    // Prevent other URLs.
    return
  }

  const { pathname, anchor } = resolveLocalLinkTarget(urlCandidate, dirname ?? '')
  if (pathname) {
    if (isMarkdownFile(pathname)) {
      const innerWin = BrowserWindow.fromWebContents(e.sender)
      if (innerWin) {
        openFileOrFolder(innerWin, pathname, { anchor })
      }
    } else {
      // A link in an untrusted document could point at a co-located script or
      // executable; opening it via the OS shell would run code silently (#3575).
      if (isDangerousExecutableFile(pathname)) {
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning',
          buttons: [t('dialog.cancel'), t('dialog.openAnyway')],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
          title: t('dialog.unsafeFileTitle'),
          message: t('dialog.unsafeFileMessage'),
          detail: t('dialog.unsafeFileDetail', { name: path.basename(pathname) })
        })
        if (response !== 1) {
          return
        }
      }
      shell.openPath(pathname)
    }
  }
})

// --- commands -------------------------------------

ipcMain.on('mt::cmd-open-file', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  openFile(win)
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

// Convert the current document with pandoc. Unlike `exportFile` (HTML/PDF in the renderer)
// this needs the markdown source and a file target, which the reply carries.
export const exportWithPandoc = async(win: Win, target: string): Promise<void> => {
  if (!win || !win.webContents) return
  if (!(await pandoc.exists())) return noticePandocNotFound(win, 'dialog.exportWarning')
  win.webContents.send('mt::export-with-pandoc', target)
}

export const importFile = async(win: BrowserWindow | null): Promise<void> => {
  if (!win) {
    return
  }
  const existsPandoc = await pandoc.exists()

  if (!existsPandoc) {
    noticePandocNotFound(win)
    return
  }

  const { filePaths } = await dialog.showOpenDialog(win, {
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
  const { filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Markdown document',
        extensions: [...MARKDOWN_EXTENSIONS]
      }
    ]
  })

  if (Array.isArray(filePaths) && filePaths.length > 0) {
    ipcMain.emit('app-open-files-by-id', win.id, filePaths)
  }
}

export const openFolder = async(win: BrowserWindow | null): Promise<void> => {
  if (!win) {
    return
  }
  const { filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory']
  })

  if (filePaths && filePaths[0]) {
    openFileOrFolder(win, filePaths[0])
  }
}

export const openFileOrFolder = (
  win: BrowserWindow,
  pathname: string,
  options: TabOptions = {}
): void => {
  const resolvedPath = normalizeAndResolvePath(pathname)
  if (isFile(resolvedPath)) {
    ipcMain.emit('app-open-file-by-id', win.id, resolvedPath, options)
  } else if (isDirectory(resolvedPath)) {
    ipcMain.emit('app-open-directory-by-id', win.id, resolvedPath)
  } else {
    console.error(`[ERROR] Cannot open unknown file: "${resolvedPath}"`)
  }
}

export const newBlankTab = (win: Win): void => {
  if (win && win.webContents) {
    win.webContents.send('mt::new-untitled-tab')
    showTabBar(win)
  }
}

export const newEditorWindow = (): void => {
  ipcMain.emit('app-create-editor-window')
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
  ipcMain.emit('set-user-preference', { autoSave: checked })
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
  ipcMain.emit('menu-clear-recently-used')
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
