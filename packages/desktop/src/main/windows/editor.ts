import path from 'path'
import { app, BrowserWindow } from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import log from 'electron-log'
import windowStateKeeper from 'electron-window-state'
import { isChildOfDirectory, isSamePathSync } from 'common/filesystem/paths'
import BaseWindow, { WindowLifecycle, WindowType } from './base'
import type Accessor from '../app/accessor'
import { ensureWindowPosition, zoomIn, zoomOut } from './utils'
import {
  TITLE_BAR_HEIGHT,
  editorWinOptions,
  isLinux,
  isOsx
} from '../config'
import { showEditorContextMenu } from '../contextMenu/editor'
import {
  getDocumentCoreFileSnapshot,
  loadMarkdownFile
} from '../filesystem/markdown'
import { switchLanguage } from '../spellchecker'
import { presentationPolicy } from '../presentationPolicy'
import { exceptionReporter } from '../exceptionReporting'
import { decodeFileSnapshot } from '@marktext/document-core'
import type {
  BufferedState,
  WindowUiCheckpointIntent
} from '@shared/types/bufferedState'
import { documentParseConfigurationFor } from '../documentCore/documentParseConfiguration'
import {
  DocumentCoreFileAlreadyOpenError
} from '../documentCore/documentFileHost'
import {
  describeDocumentCoreFile,
  listDocumentCoreRecoveryWindows,
  openDocumentCoreFile,
  recoverDocumentCoreFile
} from '../ipc/documentCore'
import { emitInternalChannel } from '../utils/internalIpc'
import {
  authorizeWindowUiCheckpoint as authorizeCheckpoint
} from '../editorBufferStore/windowUiCheckpointAuthority'

type RawMarkdownDocument = Awaited<ReturnType<typeof loadMarkdownFile>>

// The deferred file/markdown to open before the window finishes loading.
interface PendingFile {
  doc: RawMarkdownDocument
  options: Record<string, unknown>
  selected: boolean
}

interface BufferStoreInfo {
  id: string
  filePath: string | null
}

interface CandidateScore {
  id: number | null
  score: number
}

interface RetainedDocumentTab {
  readonly documentId: string
  readonly filename: string
  readonly pathname: string | null
}

class EditorWindow extends BaseWindow {
  // Root directory and file list to open when the window is ready.
  private _directoryToOpen: string | null
  private _filesToOpen: PendingFile[] | null
  private _markdownToOpen: string[] | null
  // Root directory and file list that are currently opened. These lists are
  // used to find the best window to open new files in.
  private _openedRootDirectory: string | null
  private _openedFiles: string[] | null
  private _nextUntitledId: number
  private _retainedDocumentTabs: RetainedDocumentTab[]
  private _selectedDocumentId: string | null
  private _pendingProjectFileAdmissions: Set<string>

  public bufferStoreInfo: BufferStoreInfo | null

  /**
   * @param accessor The application accessor for application instances.
   */
  constructor(accessor: Accessor) {
    super(accessor)
    this.type = WindowType.EDITOR

    // Root directory and file list to open when the window is ready.
    this._directoryToOpen = null
    this._filesToOpen = [] // {doc: IMarkdownDocumentRaw, options: any, selected: boolean}
    this._markdownToOpen = [] // List of markdown strings or an empty string will open a new untitled tab

    // Root directory and file list that are currently opened. These lists are
    // used to find the best window to open new files in.
    this._openedRootDirectory = ''
    this._openedFiles = []
    this._nextUntitledId = 0
    this._retainedDocumentTabs = []
    this._selectedDocumentId = null
    this._pendingProjectFileAdmissions = new Set()

    this.bufferStoreInfo = null
  }

  /**
   * Creates a new editor window.
   */
  createWindow(
    rootDirectory: string | null = null,
    fileList: string[] = [],
    markdownList: string[] = [],
    options: Partial<BrowserWindowConstructorOptions> = {},
    bufferStoreInfo: BufferStoreInfo | null = null
  ): BrowserWindow {
    const { menu: appMenu, env, preferences, editorBufferStore } = this._accessor
    const addBlankTab =
      !bufferStoreInfo && !rootDirectory && fileList.length === 0 && markdownList.length === 0

    const mainWindowState = windowStateKeeper({
      defaultWidth: 1200,
      defaultHeight: 800
    })

    const { x, y, width, height } = ensureWindowPosition(mainWindowState)
    const winOptions = presentationPolicy.deriveWindowOptions<BrowserWindowConstructorOptions>(
      Object.assign(
        { x, y, width, height },
        editorWinOptions,
        options
      )
    )
    if (isLinux) {
      winOptions.icon = path.join(process.cwd(), 'static', 'logo-96px.png')
    }

    const {
      titleBarStyle,
      theme,
      sideBarVisibility,
      restoreLayoutState,
      tabBarVisibility,
      sourceCodeModeEnabled,
      spellcheckerEnabled,
      spellcheckerLanguage
    } = preferences.getAll()
    const resolvedSideBarVisibility = restoreLayoutState ? !!sideBarVisibility : false

    // Enable native or custom/frameless window and titlebar
    if (!isOsx) {
      winOptions.titleBarStyle = 'default'
      if (titleBarStyle === 'native') {
        winOptions.frame = true
      }
    }

    winOptions.backgroundColor = this._getPreferredBackgroundColor(theme)
    if (env.disableSpellcheck) {
      // winOptions.webPreferences is set by editorWinOptions spread above
      ;(winOptions.webPreferences as { spellcheck: boolean }).spellcheck = false
    }
    let win: BrowserWindow | null = (this.browserWindow = new BrowserWindow(winOptions))

    // Give every editor window a stable id for session buffer persistence.
    // We cant use win.id as it might collide with same IDs from closed windows
    this.bufferStoreInfo = {
      id: bufferStoreInfo ? bufferStoreInfo.id : editorBufferStore.getUnUsedBufferUUID(),
      filePath: bufferStoreInfo ? bufferStoreInfo.filePath : null
    }
    ;(win as unknown as { restoreBufferId: string }).restoreBufferId = this.bufferStoreInfo.id

    this.id = win.id

    if (spellcheckerEnabled && !isOsx) {
      try {
        switchLanguage(win, spellcheckerLanguage as string)
      } catch (error) {
        log.error('Unable to set spell checker language on startup:', error)
      }
    }

    // Create a menu for the current window
    appMenu.addEditorMenu(win, { sourceCodeModeEnabled: sourceCodeModeEnabled as boolean })

    win.webContents.on('context-menu', (event, params) => {
      showEditorContextMenu(win!, event, params, preferences.getItem('spellcheckerEnabled'))
        .catch(error => log.error('Unable to show editor context menu.', error))
    })

    win.webContents.once('did-finish-load', () => {
      this.lifecycle = WindowLifecycle.READY
      this.emit('window-ready')

      // Restore and focus window
      this.bringToFront()

      win!.webContents.send('mt::bootstrap-editor', {
        sideBarVisibility: resolvedSideBarVisibility,
        tabBarVisibility,
        sourceCodeModeEnabled
      })

      if (bufferStoreInfo !== null) {
        this._restoreAllState().catch((error: unknown) => {
          log.error('Failed to restore main-owned documents:', error)
          win?.webContents.send('mt::show-notification', {
            title: 'Failed to restore documents',
            type: 'error',
            message: error instanceof Error ? error.message : String(error)
          })
        })
      } else {
        this._doOpenFilesToOpen()
        if (addBlankTab) {
          this.openUntitledTab(true)
        }
        let firstMarkdown = true
        for (const markdown of this._markdownToOpen!) {
          this.openUntitledTab(firstMarkdown, markdown)
          firstMarkdown = false
        }
        this._markdownToOpen!.length = 0
      }

      // Listen on default system mouse zoom event (e.g. Ctrl+MouseWheel on Linux/Windows).
      win!.webContents.on('zoom-changed', (_event, zoomDirection) => {
        if (zoomDirection === 'in') {
          zoomIn(win!)
        } else if (zoomDirection === 'out') {
          zoomOut(win!)
        }
      })
    })

    win.webContents.once('did-fail-load', (_event, errorCode, errorDescription, url) => {
      const message =
        `The window failed to load or was cancelled: ${errorCode}; ${errorDescription}; @ ${url}`
      log.error(message)
      exceptionReporter.handle('crash', new Error(message), async() => {})
        .catch((handlerError) => {
          log.error('Failed to process window load error through presentation policy.', handlerError)
        })
    })

    win.webContents.once('render-process-gone', async(_event, { reason }) => {
      if (reason === 'clean-exit') {
        return
      }

      const msg = `The renderer process has crashed unexpected or is killed (${reason}).`
      log.error(msg)
      const error = new Error(msg)

      if (reason === 'abnormal-exit') {
        await exceptionReporter.handle('crash', error, async() => {})
        return
      }

      const response: { value: number | null } = { value: null }
      const disposition = await exceptionReporter.handle('crash', error, async() => {
        response.value = (await presentationPolicy.showMessageBox(win!, {
          type: 'warning',
          buttons: ['Close', 'Reload', 'Keep It Open'],
          message: 'MarkText has crashed',
          detail: msg
        })).response
      })

      if (disposition === 'captured') return this.destroy()
      if (win!.id) {
        switch (response.value) {
          case 0:
            return this.destroy()
          case 1:
            return this.reload()
        }
      }
    })

    win.on('focus', () => {
      this.emit('window-focus')
      win!.webContents.send('mt::window-active-status', { status: true })
    })

    // Lost focus
    win.on('blur', () => {
      this.emit('window-blur')
      win!.webContents.send('mt::window-active-status', { status: false })
    })
    ;(['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const).forEach(
      (channel) => {
        // Electron's BrowserWindow.on() is heavily overloaded — the union of
        // event names can't be satisfied by a single overload, so we widen.
        ;(win! as { on(event: string, listener: () => void): void }).on(channel, () => {
          win!.webContents.send(`mt::window-${channel}`)
        })
      }
    )

    // Before closed. We cancel the action and ask the editor further instructions.
    win.on('close', (event) => {
      this.emit('window-close')

      event.preventDefault()
      win!.webContents.send('mt::ask-for-close')

      // TODO: Close all watchers etc. Should we do this manually or listen to 'quit' event?
    })

    // The window is now destroyed.
    win.on('closed', () => {
      this.lifecycle = WindowLifecycle.QUITTED
      this.emit('window-closed')

      // Free window reference
      win = null
    })

    this.lifecycle = WindowLifecycle.LOADING
    win.loadURL(this._buildUrlString(this.id, env, preferences))
    win.setSheetOffset(TITLE_BAR_HEIGHT)

    mainWindowState.manage(win)

    // Disable application menu shortcuts because we want to handle key bindings ourself.
    win.webContents.setIgnoreMenuShortcuts(true)

    // Delay load files and directories after the current control flow.
    setTimeout(() => {
      if (rootDirectory) {
        this.openFolder(rootDirectory)
      }
      if (fileList.length) {
        this.openTabsFromPaths(fileList)
      }
    }, 0)

    return win
  }

  /**
   * Open a new tab from a markdown file.
   */
  openTab(filePath: string, options: Record<string, unknown> = {}, selected: boolean = true): void {
    // TODO: Don't allow new files if quitting.
    if (this.lifecycle === WindowLifecycle.QUITTED) return
    this.openTabs([{ filePath, options, selected }])
  }

  /**
   * Open new tabs from the given file paths.
   */
  openTabsFromPaths(filePaths: string[]): void {
    if (!filePaths || filePaths.length === 0) return

    const fileList = filePaths.map((p) => ({ filePath: p, options: {}, selected: false }))
    fileList[0].selected = true
    this.openTabs(fileList)
  }

  /**
   * Open new tabs from markdown files with options for editor window.
   */
  openTabs(
    fileList: { filePath: string; selected: boolean; options: Record<string, unknown> }[]
  ): void {
    // TODO: Don't allow new files if quitting.
    if (this.lifecycle === WindowLifecycle.QUITTED) return

    const { browserWindow } = this
    for (const { filePath, options, selected } of fileList) {
      if (this._openedFiles!.includes(filePath)) {
        // File is already opened - avoid opening it again so we dont have duplicate watchers
        browserWindow!.webContents.send('mt::switch-tab-by-file_path', filePath)
        continue
      }
      loadMarkdownFile(filePath)
        .then(async(rawDocument) => {
          if (this.lifecycle === WindowLifecycle.READY) {
            await this._doOpenTab(rawDocument, options, selected)
          } else {
            this._filesToOpen!.push({ doc: rawDocument, options, selected })
          }
        })
        .catch((err: Error) => {
          if (err instanceof DocumentCoreFileAlreadyOpenError) {
            this._redirectDuplicateDocument(err)
            return
          }
          const { message, stack } = err
          log.error(`[ERROR] Cannot open file or directory: ${message}\n\n${stack}`)
          browserWindow!.webContents.send('mt::show-notification', {
            title: 'Cannot open tab',
            type: 'error',
            message: err.message
          })
        })
    }
  }

  /**
   * Open a new untitled tab optional with a markdown string.
   */
  openUntitledTab(selected: boolean = true, markdown: string = ''): void {
    // TODO: Don't allow new files if quitting.
    if (this.lifecycle === WindowLifecycle.QUITTED) return

    if (this.lifecycle === WindowLifecycle.READY) {
      this._doOpenUntitledTab(selected, markdown).catch((error: unknown) => {
        log.error('Unable to open main-owned untitled document:', error)
        this.browserWindow?.webContents.send('mt::show-notification', {
          title: 'Cannot open tab',
          type: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } else {
      this._markdownToOpen!.push(markdown)
    }
  }

  /**
   * Admit imported content through the main-owned document host and let the
   * caller observe any admission failure before acknowledging the import.
   */
  async admitImportedMarkdown(markdown: string): Promise<void> {
    if (this.lifecycle === WindowLifecycle.QUITTED) {
      throw new Error('Editor window quit before document import')
    }
    if (this.lifecycle === WindowLifecycle.READY) {
      await this._doOpenUntitledTab(true, markdown)
      return
    }
    this._markdownToOpen!.push(markdown)
  }

  /**
   * Open a (new) directory and replaces the old one.
   */
  openFolder(pathname: string): void {
    // TODO: Don't allow new files if quitting.
    if (
      !pathname ||
      this.lifecycle === WindowLifecycle.QUITTED ||
      isSamePathSync(pathname, this._openedRootDirectory ?? '')
    ) {
      return
    }

    if (this.lifecycle === WindowLifecycle.READY) {
      const { browserWindow } = this
      const { menu: appMenu, preferences } = this._accessor

      if (this._openedRootDirectory) {
        emitInternalChannel('watcher-unwatch-directory', browserWindow, this._openedRootDirectory)
      }

      preferences.setItems({ lastOpenedFolder: pathname })
      appMenu.addRecentlyUsedDocument(pathname)
      this._openedRootDirectory = pathname
      emitInternalChannel('watcher-watch-directory', browserWindow, pathname)
      browserWindow!.webContents.send('mt::open-directory', pathname)
    } else {
      this._directoryToOpen = pathname
    }
  }

  /**
   * Add a new path to the file list and watch the given path.
   */
  addToOpenedFiles(filePath: string): void {
    const { _openedFiles, browserWindow } = this
    _openedFiles!.push(filePath)
    emitInternalChannel('watcher-watch-file', browserWindow, filePath)
  }

  /**
   * Change a path in the opened file list and update the watcher.
   */
  changeOpenedFilePath(pathname: string, oldPathname: string): void {
    const { _openedFiles, browserWindow } = this
    const index = _openedFiles!.findIndex((p) => p === oldPathname)
    if (index === -1) {
      // The old path was not found but add the new one.
      _openedFiles!.push(pathname)
    } else {
      _openedFiles![index] = pathname
    }
    emitInternalChannel('watcher-unwatch-file', browserWindow, oldPathname)
    emitInternalChannel('watcher-watch-file', browserWindow, pathname)
  }

  /**
   * Remove a path from the opened file list and stop watching the path.
   */
  removeFromOpenedFiles(pathname: string): void {
    const { _openedFiles, browserWindow } = this
    const index = _openedFiles!.findIndex((p) => p === pathname)
    if (index !== -1) {
      _openedFiles!.splice(index, 1)
    }
    emitInternalChannel('watcher-unwatch-file', browserWindow, pathname)
  }

  /**
   * Returns a score list for a given file list.
   */
  getCandidateScores(fileList: string[]): CandidateScore[] {
    const { _openedFiles, _openedRootDirectory, id } = this
    const buf: CandidateScore[] = []
    for (const pathname of fileList) {
      let score = 0
      if (_openedFiles!.some((p) => p === pathname)) {
        score = -1
      } else {
        if (isChildOfDirectory(_openedRootDirectory ?? '', pathname)) {
          score += 5
        }
        for (const item of _openedFiles!) {
          if (isChildOfDirectory(path.dirname(item), pathname)) {
            score += 1
          }
        }
      }
      buf.push({ id, score })
    }
    return buf
  }

  override reload(): void {
    const { id, browserWindow } = this
    if (browserWindow === null) return
    const checkpoint = this._readWindowUiCheckpoint()

    // The renderer is going away, but the main-owned file/session registry is
    // not. Watchers are paused while no renderer can resolve their
    // notifications, then restored from retained native paths after load.
    emitInternalChannel('watcher-unwatch-all-by-id', id)

    browserWindow.webContents.once('did-finish-load', () => {
      this.lifecycle = WindowLifecycle.READY
      const { preferences } = this._accessor
      const { sideBarVisibility, restoreLayoutState, tabBarVisibility, sourceCodeModeEnabled } =
        preferences.getAll()
      const resolvedSideBarVisibility = restoreLayoutState ? !!sideBarVisibility : false
      browserWindow.webContents.send('mt::bootstrap-editor', {
        sideBarVisibility: resolvedSideBarVisibility,
        tabBarVisibility,
        sourceCodeModeEnabled
      })
      this._reattachAfterRendererReload(checkpoint)
    })

    this.lifecycle = WindowLifecycle.LOADING
    super.reload()
  }

  override destroy(): void {
    super.destroy()

    // Watchers are freed from WindowManager.

    this._directoryToOpen = null
    this._filesToOpen = null
    this._markdownToOpen = null
    this._openedRootDirectory = null
    this._openedFiles = null
    this._retainedDocumentTabs = []
    this._selectedDocumentId = null
    this._pendingProjectFileAdmissions.clear()
  }

  get openedRootDirectory(): string | null {
    return this._openedRootDirectory
  }

  findOpenedDocumentPath(candidatePath: string): string | null {
    return this._openedFiles?.find(
      pathname => isSamePathSync(pathname, candidatePath)
    ) ?? null
  }

  selectOpenedDocumentByPath(pathname: string): void {
    const openedPathname = this.findOpenedDocumentPath(pathname)
    if (openedPathname === null || this.browserWindow === null) {
      throw new Error('Project document is not admitted by this editor window')
    }
    const retained = this._retainedDocumentTabs.find(
      tab =>
        tab.pathname !== null &&
        isSamePathSync(tab.pathname, openedPathname)
    )
    if (retained === undefined) {
      throw new Error('Admitted project document has no retained session')
    }
    this._selectedDocumentId = retained.documentId
    this.browserWindow.webContents.send(
      'mt::switch-tab-by-file_path',
      openedPathname
    )
  }

  /**
   * Admit a file created by the main-owned project transaction.
   *
   * This promise exposes admission failure so a surrounding main-owned
   * transaction can roll back an exclusively created file.
   */
  async admitProjectFile(pathname: string): Promise<void> {
    if (this.lifecycle !== WindowLifecycle.READY) {
      throw new Error('Project file admission requires a ready editor window')
    }
    if (
      this.findOpenedDocumentPath(pathname) !== null ||
      this._pendingProjectFileAdmissions.has(pathname)
    ) {
      throw new Error(
        'Project file is already admitted or admission is in progress'
      )
    }
    this._pendingProjectFileAdmissions.add(pathname)
    try {
      const rawDocument = await loadMarkdownFile(pathname)
      await this._doOpenTab(rawDocument, {}, true)
    } finally {
      this._pendingProjectFileAdmissions.delete(pathname)
    }
  }

  // --- private ---------------------------------

  /**
   * Open a new new tab from the markdown document.
   */
  private _doOpenTab(
    rawDocument: RawMarkdownDocument,
    options: Record<string, unknown>,
    selected: boolean
  ): Promise<void> {
    return this._admitDocumentTab(
      rawDocument.markdown,
      rawDocument.filename,
      rawDocument.pathname,
      options,
      selected,
      getDocumentCoreFileSnapshot(rawDocument.pathname)
    )
  }

  private async _doOpenUntitledTab(
    selected: boolean,
    markdown: string
  ): Promise<void> {
    this._nextUntitledId += 1
    await this._admitDocumentTab(
      markdown,
      `Untitled-${String(this._nextUntitledId)}`,
      null,
      {},
      selected,
      decodeFileSnapshot(new TextEncoder().encode(markdown), 'utf-8')
    )
  }

  private async _admitDocumentTab(
    source: string,
    filename: string,
    pathname: string | null,
    options: Record<string, unknown>,
    selected: boolean,
    retainedSnapshot: ReturnType<typeof getDocumentCoreFileSnapshot>
  ): Promise<void> {
    const { _accessor, _openedFiles, browserWindow } = this
    const { menu: appMenu, preferences } = _accessor
    if (browserWindow === null) {
      throw new Error('Editor window was destroyed before document admission')
    }
    const settings = preferences.getAll()
    const fileSnapshot = retainedSnapshot ?? decodeFileSnapshot(
      new TextEncoder().encode(source),
      'utf-8'
    )
    const opened = await openDocumentCoreFile(
      browserWindow.webContents,
      this._durableWindowId(),
      {
        fileSnapshot,
        parseConfiguration: documentParseConfigurationFor({
          footnotes: settings.footnotes === true,
          gitLabMath: settings.gitLabMath === true,
          subscriptAndSuperscript:
            settings.subscriptAndSuperscript === true
        }),
        filename,
        pathname,
        defaultDirectory: app.getPath('documents')
      }
    )
    this._retainDocumentTab(opened, selected)

    if (pathname !== null) {
      emitInternalChannel('watcher-watch-file', browserWindow, pathname)
      appMenu.addRecentlyUsedDocument(pathname)
      _openedFiles!.push(pathname)
    }

    browserWindow.webContents.send('mt::document-core::tab-opened', {
      schema: 'document-core-tab-1',
      documentId: opened.documentId,
      filename: opened.filename,
      pathname: opened.pathname,
      selected
    })
  }

  private _retainDocumentTab(
    document: RetainedDocumentTab,
    selected: boolean
  ): void {
    const index = this._retainedDocumentTabs.findIndex(
      tab => tab.documentId === document.documentId
    )
    if (index === -1) {
      this._retainedDocumentTabs.push(Object.freeze({ ...document }))
    } else {
      this._retainedDocumentTabs[index] = Object.freeze({ ...document })
    }
    if (selected) this._selectedDocumentId = document.documentId
  }

  private _durableWindowId(): string {
    const id = this.bufferStoreInfo?.id
    if (id === undefined || id.length === 0) {
      throw new Error('Document admission requires a durable window identity')
    }
    return id
  }

  private _redirectDuplicateDocument(
    error: DocumentCoreFileAlreadyOpenError
  ): void {
    const windows = this._accessor.windowManager?.windows
    const target = windows === undefined
      ? (
        this.bufferStoreInfo?.id === error.occupancy.durableWindowId
          ? this
          : null
      )
      : [...windows.values()].find(candidate =>
        candidate.type === WindowType.EDITOR &&
        (candidate as EditorWindow).bufferStoreInfo?.id ===
          error.occupancy.durableWindowId
      ) as EditorWindow | undefined
    if (target === null || target === undefined) {
      throw error
    }

    let attempts = 0
    const redirectWhenRetained = (): void => {
      try {
        target.selectOpenedDocumentByPath(error.occupancy.pathname)
        target.bringToFront()
      } catch (redirectError) {
        attempts += 1
        if (attempts < 40 && target.lifecycle !== WindowLifecycle.QUITTED) {
          setTimeout(redirectWhenRetained, 25)
          return
        }
        log.error(
          'Unable to select the already admitted document:',
          redirectError
        )
      }
    }
    setTimeout(redirectWhenRetained, 0)
  }

  /**
   * Validate renderer presentation references against this window's live,
   * main-owned document registry and construct the durable checkpoint.
   */
  authorizeWindowUiCheckpoint(
    intent: WindowUiCheckpointIntent
  ): BufferedState {
    const { browserWindow } = this
    if (browserWindow === null) {
      throw new Error(
        'Window UI checkpoint requires a live editor window'
      )
    }
    const retained: RetainedDocumentTab[] = []
    for (const tab of this._retainedDocumentTabs) {
      try {
        retained.push(
          describeDocumentCoreFile(
            browserWindow.webContents,
            tab.documentId
          )
        )
      } catch {
        // The main document host may have completed an explicit close before
        // the renderer publishes its next presentation checkpoint.
      }
    }
    const checkpoint = authorizeCheckpoint(intent, {
      rootDirectory: this._openedRootDirectory ?? '',
      retainedDocumentIds: retained.map(tab => tab.documentId)
    })
    const retainedById = new Map(
      retained.map(tab => [tab.documentId, tab])
    )
    this._retainedDocumentTabs = checkpoint.tabs.map(tab => {
      const retainedTab = retainedById.get(tab.documentId)
      if (retainedTab === undefined) {
        throw new Error(
          `Authorized checkpoint lost retained document ${tab.documentId}`
        )
      }
      return retainedTab
    })
    this._selectedDocumentId = checkpoint.currentDocumentId
    return checkpoint
  }

  private _readWindowUiCheckpoint(): BufferedState | null {
    const { bufferStoreInfo } = this
    if (bufferStoreInfo === null) return null
    const { editorBufferStore } = this._accessor
    try {
      const filePath = bufferStoreInfo.filePath ??
        editorBufferStore.getBufferStoreInfo(bufferStoreInfo.id).filePath
      return editorBufferStore.readBufferStoreFile(filePath)
    } catch (error) {
      log.error('Unable to read window UI checkpoint before reload:', error)
      return null
    }
  }

  private _reattachAfterRendererReload(
    checkpoint: BufferedState | null
  ): void {
    const { browserWindow } = this
    if (browserWindow === null) return

    const retained: RetainedDocumentTab[] = []
    for (const tab of this._retainedDocumentTabs) {
      try {
        retained.push(
          describeDocumentCoreFile(browserWindow.webContents, tab.documentId)
        )
      } catch (error) {
        // A close that completed while the renderer was disappearing may
        // leave a stale UI descriptor. The main file host decides liveness.
        log.error(
          `Unable to reattach closed document ${tab.documentId}:`,
          error
        )
      }
    }
    this._retainedDocumentTabs = retained
    this._openedFiles = retained.flatMap(
      tab => tab.pathname === null ? [] : [tab.pathname]
    )

    const rootDirectory = this._openedRootDirectory ?? ''
    if (rootDirectory) {
      emitInternalChannel(
        'watcher-watch-directory',
        browserWindow,
        rootDirectory
      )
      browserWindow.webContents.send(
        'mt::open-directory',
        rootDirectory
      )
    }
    for (const pathname of this._openedFiles) {
      emitInternalChannel('watcher-watch-file', browserWindow, pathname)
    }

    if (retained.length === 0) {
      this._selectedDocumentId = null
      this.openUntitledTab(true)
      return
    }
    const firstRetained = retained[0]
    if (firstRetained === undefined) {
      throw new Error('Retained document list changed unexpectedly')
    }

    const checkpointIds = new Set(retained.map(tab => tab.documentId))
    const requestedDocumentId =
      checkpoint?.currentDocumentId !== null &&
      checkpoint?.currentDocumentId !== undefined &&
      checkpointIds.has(checkpoint.currentDocumentId)
        ? checkpoint.currentDocumentId
        : this._selectedDocumentId
    const selectedDocumentId =
      requestedDocumentId !== null &&
      requestedDocumentId !== undefined &&
      checkpointIds.has(requestedDocumentId)
        ? requestedDocumentId
        : firstRetained.documentId
    this._selectedDocumentId = selectedDocumentId

    if (checkpoint !== null) {
      const scrollByDocument = new Map(
        checkpoint.tabs.map(tab => [tab.documentId, tab.scrollTop])
      )
      browserWindow.webContents.send(
        'mt::document-core::restore-window-ui',
        Object.freeze({
          ...checkpoint,
          currentDocumentId: selectedDocumentId,
          tabs: Object.freeze(retained.map(tab => Object.freeze({
            documentId: tab.documentId,
            scrollTop: scrollByDocument.get(tab.documentId) ?? 0
          }))),
          project: Object.freeze({
            rootDirectory
          })
        })
      )
    }

    for (const tab of retained) {
      browserWindow.webContents.send('mt::document-core::tab-opened', {
        schema: 'document-core-tab-1',
        documentId: tab.documentId,
        filename: tab.filename,
        pathname: tab.pathname,
        selected: tab.documentId === selectedDocumentId
      })
    }
  }

  private _doOpenFilesToOpen(): void {
    if (this.lifecycle !== WindowLifecycle.READY) {
      throw new Error('Invalid state.')
    }

    if (this._directoryToOpen) {
      this.openFolder(this._directoryToOpen)
    }
    this._directoryToOpen = null

    for (const { doc, options, selected } of this._filesToOpen!) {
      this._doOpenTab(doc, options, selected).catch((error: unknown) => {
        if (error instanceof DocumentCoreFileAlreadyOpenError) {
          this._redirectDuplicateDocument(error)
          return
        }
        log.error('Unable to admit pending document:', error)
      })
    }
    this._filesToOpen!.length = 0
  }

  private async _restoreAllState(): Promise<void> {
    if (this.lifecycle !== WindowLifecycle.READY) {
      throw new Error('Invalid state.')
    }
    const { browserWindow, bufferStoreInfo, _accessor } = this
    const {
      editorBufferStore,
      menu: appMenu,
      preferences
    } = _accessor
    if (browserWindow === null || bufferStoreInfo === null) {
      throw new Error('Window restore has no live durable window')
    }
    const recoveryWindows = await listDocumentCoreRecoveryWindows()
    const recoveryWindow = recoveryWindows.find(
      candidate => candidate.durableWindowId === bufferStoreInfo.id
    )
    const recoverableIds = recoveryWindow?.documentIds ?? []
    const checkpoint = bufferStoreInfo.filePath === null
      ? null
      : editorBufferStore.readBufferStoreFile(bufferStoreInfo.filePath)
    const settings = preferences.getAll()
    const retainedIds = new Set(recoverableIds)
    const checkpointTabs = checkpoint?.tabs.filter(
      tab => retainedIds.has(tab.documentId)
    ) ?? []
    const checkpointIds = new Set(
      checkpointTabs.map(tab => tab.documentId)
    )
    const tabs = Object.freeze([
      ...checkpointTabs,
      ...recoverableIds
        .filter(documentId => !checkpointIds.has(documentId))
        .map(documentId => Object.freeze({
          documentId,
          scrollTop: 0
        }))
    ])
    const currentDocumentId =
      checkpoint?.currentDocumentId !== null &&
      checkpoint?.currentDocumentId !== undefined &&
      retainedIds.has(checkpoint.currentDocumentId)
        ? checkpoint.currentDocumentId
        : tabs[0]?.documentId ?? null
    const bufferState: BufferedState = Object.freeze({
      schema: 'document-core-window-ui-1',
      currentDocumentId,
      tabs,
      project: checkpoint?.project ?? Object.freeze({
        rootDirectory: ''
      }),
      layout: checkpoint?.layout ?? Object.freeze({
        rightColumn: '',
        showSideBar:
          settings.restoreLayoutState === true &&
          settings.sideBarVisibility === true,
        showTabBar: settings.tabBarVisibility !== false,
        sideBarWidth: 280
      })
    })
    if (bufferState.project.rootDirectory) {
      this.openFolder(bufferState.project.rootDirectory)
    }
    browserWindow.webContents.send(
      'mt::document-core::restore-window-ui',
      bufferState
    )

    const parseConfiguration = documentParseConfigurationFor({
      footnotes: settings.footnotes === true,
      gitLabMath: settings.gitLabMath === true,
      subscriptAndSuperscript:
        settings.subscriptAndSuperscript === true
    })
    const recovered = []
    for (const tab of bufferState.tabs) {
      try {
        recovered.push(await recoverDocumentCoreFile(
          browserWindow.webContents,
          bufferStoreInfo.id,
          {
            documentId: tab.documentId,
            parseConfiguration
          }
        ))
      } catch (error) {
        log.error(
          `Failed to recover document ${tab.documentId}:`,
          error
        )
        browserWindow.webContents.send('mt::show-notification', {
          title: 'Could not recover document',
          type: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }

    if (recovered.length === 0) {
      await this._doOpenUntitledTab(true, '')
      return
    }
    const firstRecovered = recovered[0]
    if (firstRecovered === undefined) {
      throw new Error('Recovered document list changed unexpectedly')
    }
    const requestedDocumentId = bufferState.currentDocumentId
    const selectedId =
      requestedDocumentId !== null &&
      recovered.some(
        document => document.documentId === requestedDocumentId
      )
        ? requestedDocumentId
        : firstRecovered.documentId
    for (const document of recovered) {
      this._retainDocumentTab(
        document,
        document.documentId === selectedId
      )
      if (
        document.pathname !== null &&
        !this._openedFiles!.includes(document.pathname)
      ) {
        this.addToOpenedFiles(document.pathname)
        appMenu.addRecentlyUsedDocument(document.pathname)
      }
      browserWindow.webContents.send('mt::document-core::tab-opened', {
        schema: 'document-core-tab-1',
        documentId: document.documentId,
        filename: document.filename,
        pathname: document.pathname,
        selected: document.documentId === selectedId
      })
      if (document.externalConflict) {
        browserWindow.webContents.send('mt::show-notification', {
          title: `File changed outside MarkText: ${document.filename}`,
          type: 'warning',
          message:
            'The recovered document is preserved. Choose reload or overwrite before saving.'
        })
      }
    }
  }
}

export default EditorWindow
