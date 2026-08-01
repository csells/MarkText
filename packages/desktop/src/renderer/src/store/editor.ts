import equal from 'deep-equal'
import {
  reportAsyncFailure,
  type DocumentSelectionContext
} from '@marktext/document-view'
import bus from '../bus'
import { deepClone } from '../util'
import listToTree, { type ListItem, type TreeNode } from '../util/listToTree'
import {
  createDocumentState,
  defaultFileState
} from './help'
import notice from '../services/notification'
import {
  QuickOpenCommand
} from '../commands'
import { defineStore } from 'pinia'
import { usePreferencesStore } from './preferences'
import { useProjectStore } from './project'
import { useLayoutStore } from './layout'
import { useMainStore } from '.'
import { t } from '../i18n'
import { debouncedSendBufferedState, sendBufferedState } from './bufferedState'
import type {
  IFileState,
  FileNotification
} from '@shared/types/files'
import type { InlineFormat, NodeId } from '@marktext/document-core'
import type {
  DocumentCoreHistoryState,
  DocumentCoreLifecycleIntent
} from '@shared/types/documentCore'
import type {
  DocumentFormatMenuState,
  DocumentSelectionMenuState
} from '@shared/types/documentSelection'
import { DOCUMENT_SELECTION_BLOCK_KINDS } from '@shared/types/documentSelection'
import {
  decodeBufferedState,
  type BufferedState
} from '@shared/types/bufferedState'
import {
  closeDocumentCoreTab
} from '../components/editorWithTabs/documentCoreTabLifecycle'
import {
  decodeDocumentCoreExternalChangeResult,
  decodeDocumentCorePathReceipt,
  decodeDocumentCoreSavedReceipt,
  decodeDocumentCoreTabDescriptor
} from '../components/editorWithTabs/documentFileClientCodec'
import {
  copyUploaderDeletionUrl
} from '../services/uploaderClient'
import type {
  UploaderDeletionClipboardCapability
} from '@shared/types/clipboardTransactions'

// ----------------------------------------------------------------------------
// Local helper types
// ----------------------------------------------------------------------------

interface TocItem extends ListItem {
  nodeId: NodeId
  slug: string
  content: string
  lvl: number
}

type TocTreeNode = TreeNode<TocItem>

interface PushTabNotificationPayload {
  tabId: string
  msg: string
  showConfirm?: boolean
  style?: string
  exclusiveType?: string
  action?: FileNotification['action']
}

interface AutoSavePayload {
  id: string
  pathname: string
}

interface ContentChangePayload {
  id: string
  markdown: string
  wordCount?: IFileState['wordCount']
  cursor?: unknown
  documentCoreHistory?: DocumentCoreHistoryState
  toc?: TocItem[]
  blocks?: unknown
}

export interface FlushActiveEditorRequest {
  readonly defer: () => void
  readonly complete: () => void
  readonly fail: (error: unknown) => void
}

function afterActiveEditorFlush(
  complete: () => void
): void {
  let deferred = false
  let terminal = false
  const request: FlushActiveEditorRequest = Object.freeze({
    defer: () => {
      if (!terminal) deferred = true
    },
    complete: () => {
      if (terminal) return
      terminal = true
      complete()
    },
    fail: (error: unknown) => {
      if (terminal) return
      terminal = true
      reportAsyncFailure(error, 'Document persistence lease')
    }
  })
  bus.emit('flush-active-editor', request)
  // Synchronous listeners ignore the request object but update the store
  // before emit returns. Preserve that contract while allowing the
  // main-owned document-core path to defer the save request until input settles.
  if (!deferred && !terminal) request.complete()
}

// ----------------------------------------------------------------------------
// State shape
// ----------------------------------------------------------------------------

export interface EditorState {
  currentFile: IFileState | null
  tabs: IFileState[]
  tabIdToIndex: Record<string, number>
  listToc: TocItem[]
  toc: TocTreeNode[]
}

const autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const restoredScrollByDocument = new Map<string, number>()

export const useEditorStore = defineStore('editor', {
  state: (): EditorState => ({
    currentFile: null,
    tabs: [],
    tabIdToIndex: {},
    listToc: [],
    toc: []
  }),

  actions: {
    updateTabIdToIndex(): void {
      this.tabIdToIndex = this.tabs.reduce<Record<string, number>>((map, tab, index) => {
        map[tab.id] = index
        return map
      }, {})
    },

    CREATE_BUFFERED_STATE(): ReturnType<typeof createBufferedEditorState> {
      return createBufferedEditorState(this.$state)
    },

    RESTORE_BUFFERED_STATE(state: unknown): void {
      let bufferedState: BufferedState
      try {
        bufferedState = decodeBufferedState(state)
      } catch (error) {
        reportAsyncFailure(error, 'Window UI restoration')
        return
      }
      restoredScrollByDocument.clear()
      for (const tab of bufferedState.tabs) {
        restoredScrollByDocument.set(tab.documentId, tab.scrollTop)
      }
      const projectStore = useProjectStore()
      const layoutStore = useLayoutStore()
      projectStore.RESTORE_BUFFERED_STATE(bufferedState.project)
      layoutStore.RESTORE_BUFFERED_STATE(bufferedState.layout)
    },

    /**
     * Update scroll position for the currentFile
     */
    updateScrollPosition(id: string, scrollTop: number): void {
      if (!(id in this.tabIdToIndex)) {
        console.warn('updateScrollPosition: Cannot find tab index for id:', id)
        return
      }

      const tab = this.tabs[this.tabIdToIndex[id]]
      if (tab) {
        tab.scrollTop = scrollTop
      }
      debouncedSendBufferedState()
    },

    /**
     * Push a tab specific notification on stack that never disappears.
     */
    pushTabNotification(data: PushTabNotificationPayload): void {
      const defaultAction: FileNotification['action'] = () => {}
      const { tabId, msg } = data
      const action = data.action || defaultAction
      const showConfirm = data.showConfirm || false
      const style = data.style || 'info'
      // Whether only one notification should exist.
      const exclusiveType = data.exclusiveType || ''

      const tab = this.tabs.find((t) => t.id === tabId)
      if (!tab) {
        console.error(t('store.editor.tabNotFound'))
        return
      }

      const { notifications } = tab

      // Remove the old notification if only one should exist.
      if (exclusiveType) {
        const index = notifications.findIndex((n) => n.exclusiveType === exclusiveType)
        if (index >= 0) {
          // Reorder current notification
          notifications.splice(index, 1)
        }
      }

      // Push new notification on stack.
      notifications.push({
        msg,
        showConfirm,
        style,
        exclusiveType,
        action
      })
    },

    NAVIGATE_DOCUMENT_ANCHOR(anchorSlug: string): void {
      if (!anchorSlug) return

      // Resolve heading anchors through the parser-owned outline.
      for (const item of this.listToc) {
        if (item.slug === anchorSlug) {
          bus.emit('scroll-to-header', item.nodeId)
          return
        }
      }

      // Fall back to a non-heading target: a custom `<a id="...">` (or any
      // element with a matching id) rendered in the document.
      const anchorElement = document.getElementById(anchorSlug)
      if (anchorElement) {
        bus.emit('scroll-to-anchor-element', anchorElement)
      }
    },

    LISTEN_SCREEN_SHOT(): void {
      window.electron.ipcRenderer.on('mt::screenshot-captured', (_, source) => {
        bus.emit('screenshot-captured', source)
      })
    },

    SEARCH(value: IFileState['searchMatches']): void {
      if (!this.currentFile) return
      this.currentFile.searchMatches = deepClone(value) // deep clone to trigger state changes
    },

    SHOW_IMAGE_DELETION_CAPABILITY(
      capability: UploaderDeletionClipboardCapability
    ): void {
      notice
        .notify({
          title: t('store.editor.imageDeletionUrlTitle'),
          message: t('store.editor.imageDeletionUrlMessage', { url: '' }),
          showConfirm: true,
          time: 20000
        })
        .then(async() => {
          await copyUploaderDeletionUrl(capability)
        })
        .catch((error: unknown) => {
          reportAsyncFailure(error, 'Uploader deletion URL copy')
        })
    },

    // Flush admitted input before persistence or tab lifecycle work. Main then
    // leases and writes the canonical head; the renderer never supplies bytes.
    flushActiveEditor(): void {
      bus.emit('flush-active-editor')
    },

    FILE_SAVE(): void {
      if (!this.currentFile) return
      const { id } = this.currentFile
      afterActiveEditorFlush(() => {
        if (!id) return
        window.electron.ipcRenderer.invoke('mt::document-core::save', {
          documentId: id,
          mode: 'save'
        }).catch((error: unknown) => {
          reportAsyncFailure(error, 'Document save')
        })
      })
    },

    // need pass some data to main process when `save` menu item clicked
    LISTEN_FOR_SAVE(): void {
      window.electron.ipcRenderer.on('mt::editor-ask-file-save', () => {
        this.FILE_SAVE()
      })
      bus.on('mt::editor-ask-file-save', () => {
        this.FILE_SAVE()
      })
    },

    FILE_SAVE_AS(): void {
      if (!this.currentFile) return
      const { id } = this.currentFile
      afterActiveEditorFlush(() => {
        if (!id) return
        window.electron.ipcRenderer.invoke('mt::document-core::save', {
          documentId: id,
          mode: 'save-as'
        }).catch((error: unknown) => {
          reportAsyncFailure(error, 'Document save as')
        })
      })
    },

    // need pass some data to main process when `save as` menu item clicked
    LISTEN_FOR_SAVE_AS(): void {
      window.electron.ipcRenderer.on('mt::editor-ask-file-save-as', () => {
        this.FILE_SAVE_AS()
      })
      bus.on('mt::editor-ask-file-save-as', () => {
        this.FILE_SAVE_AS()
      })
    },

    LISTEN_FOR_FILE_RECEIPTS(): void {
      window.electron.ipcRenderer.on(
        'mt::document-core::saved',
        (_, rawReceipt: unknown) => {
          let receipt
          try {
            receipt = decodeDocumentCoreSavedReceipt(rawReceipt)
          } catch (error) {
            reportAsyncFailure(error, 'Document save receipt')
            return
          }
          const tab = this.tabs.find(
            ({ id }) => id === receipt.documentId
          )
          if (tab === undefined) return
          const existingTab = this.tabs.find(candidate =>
            candidate.id !== receipt.documentId &&
            window.fileUtils.isSamePathSync(
              candidate.pathname,
              receipt.pathname
            )
          )
          if (existingTab !== undefined) {
            this.CLOSE_TAB(existingTab)
          }
          tab.pathname = receipt.pathname
          tab.filename = window.path.basename(receipt.pathname)
          tab.documentCoreHistory = receipt.historyState
          tab.isSaved = !receipt.historyState.dirty
          debouncedSendBufferedState()
        }
      )
    },

    APPLY_PATH_RECEIPT(rawReceipt: unknown): void {
      const receipt = decodeDocumentCorePathReceipt(rawReceipt)
      const tab = this.tabs.find(({ id }) => id === receipt.documentId)
      if (tab === undefined) {
        throw new Error(
          `Cannot apply path receipt for unknown tab ${receipt.documentId}`
        )
      }
      tab.pathname = receipt.pathname
      tab.filename = receipt.filename
      debouncedSendBufferedState()
    },

    LISTEN_FOR_CLOSE(): void {
      window.electron.ipcRenderer.on('mt::ask-for-close', () => {
        afterActiveEditorFlush(() => {
          sendBufferedState()
            .catch((cause: unknown) => {
              reportAsyncFailure(cause, 'Buffered state persistence before closing')
            })
            .then(() => {
              this.REQUEST_DOCUMENT_LIFECYCLE({ kind: 'close-window' }, false)
            })
        })
      })
    },

    LISTEN_FOR_SAVE_CLOSE(): void {
      window.electron.ipcRenderer.on('mt::document-core::closed', (_, tabIdList) => {
        if (Array.isArray(tabIdList) && tabIdList.length) {
          this.CLOSE_TABS(tabIdList).catch((error: unknown) => {
            reportAsyncFailure(error, 'Document tab release')
          })
        }
      })
    },

    ASK_FOR_SAVE_ALL(closeTabs: boolean): void {
      this.REQUEST_DOCUMENT_LIFECYCLE({
        kind: closeTabs ? 'close-all' : 'save-all'
      })
    },

    MOVE_FILE_TO(): void {
      if (!this.currentFile) return
      const { id, pathname } = this.currentFile
      if (!id) return
      if (!pathname) {
        this.FILE_SAVE()
      } else {
        afterActiveEditorFlush(() => {
          window.electron.ipcRenderer.invoke(
            'mt::document-core::relocate',
            {
              documentId: id,
              intent: { kind: 'move-to' }
            }
          ).then((receipt: unknown) => {
            if (receipt !== null) this.APPLY_PATH_RECEIPT(receipt)
          }).catch((error: unknown) => {
            reportAsyncFailure(error, 'Document move')
          })
        })
      }
    },

    LISTEN_FOR_MOVE_TO(): void {
      window.electron.ipcRenderer.on('mt::editor-move-file', () => {
        this.MOVE_FILE_TO()
      })
      bus.on('mt::editor-move-file', () => {
        this.MOVE_FILE_TO()
      })
    },

    LISTEN_FOR_RENAME(): void {
      window.electron.ipcRenderer.on('mt::editor-rename-file', () => {
        this.RESPONSE_FOR_RENAME()
      })
      bus.on('mt::editor-rename-file', () => {
        this.RESPONSE_FOR_RENAME()
      })
    },

    RESPONSE_FOR_RENAME(): void {
      if (!this.currentFile) return
      const { id, pathname } = this.currentFile
      if (!id) return
      if (!pathname) {
        this.FILE_SAVE()
      } else {
        afterActiveEditorFlush(() => {
          bus.emit('rename')
        })
      }
    },

    RENAME(newFilename: string): void {
      if (!this.currentFile) return
      const { id, filename } = this.currentFile
      if (typeof filename === 'string' && filename !== newFilename) {
        window.electron.ipcRenderer.invoke(
          'mt::document-core::relocate',
          {
            documentId: id,
            intent: {
              kind: 'rename',
              filename: newFilename
            }
          }
        ).then((receipt: unknown) => {
          if (receipt !== null) this.APPLY_PATH_RECEIPT(receipt)
        }).catch((error: unknown) => {
          reportAsyncFailure(error, 'Document rename')
        })
      }
    },

    UPDATE_CURRENT_FILE(currentFile: IFileState): void {
      const oldCurrentFile = this.currentFile
      let didUpdateCurrentFile = false
      if (oldCurrentFile == null || oldCurrentFile.id !== currentFile.id) {
        const { id, cursor, scrollTop, blocks } =
          currentFile
        // Must run while `currentFile` still points at the outgoing tab, so its
        // flushed edit is attributed to that tab and not lost on switch (#2938).
        if (oldCurrentFile) {
          this.flushActiveEditor()
        }
        this.currentFile = currentFile
        didUpdateCurrentFile = true

        if (!this.tabs.some((file) => file.id === currentFile.id)) {
          this.tabs.push(currentFile)
          this.updateTabIdToIndex()
        }

        bus.emit('file-changed', {
          id,
          cursor,
          renderCursor: true,
          scrollTop,
          blocks
        })
      }

      if (didUpdateCurrentFile) {
        debouncedSendBufferedState()
      }
    },

    // This events are only used during window creation.
    LISTEN_FOR_BOOTSTRAP_WINDOW(): void {
      const preferencesStore = usePreferencesStore()
      const layoutStore = useLayoutStore()
      const projectStore = useProjectStore()
      const mainStore = useMainStore()

      // Delay load runtime commands and initialize commands.
      setTimeout(() => {
        bus.emit(
          'cmd::register-command',
          new QuickOpenCommand({
            editor: this,
            preferences: preferencesStore,
            project: projectStore
          })
        )
        setTimeout(() => {
          window.electron.ipcRenderer.send('mt::request-keybindings')
          bus.emit('cmd::sort-commands')
        }, 100)
      }, 400)

      window.electron.ipcRenderer.on('mt::bootstrap-editor', (_, config) => {
        const {
          sideBarVisibility,
          tabBarVisibility,
          sourceCodeModeEnabled
        } = config

        window.electron.ipcRenderer.send('mt::window-initialized')
        mainStore.SET_INITIALIZED()
        layoutStore.SET_LAYOUT({
          rightColumn: 'files',
          showSideBar: !!sideBarVisibility,
          showTabBar: !!tabBarVisibility
        })
        layoutStore.DISPATCH_LAYOUT_MENU_ITEMS()
        preferencesStore.SET_MODE({
          type: 'sourceCode',
          checked: !!sourceCodeModeEnabled
        })
      })
    },

    // Main admits every document before the renderer receives its opaque id.
    LISTEN_FOR_NEW_TAB(): void {
      window.electron.ipcRenderer.on(
        'mt::document-core::tab-opened',
        (_, rawDescriptor: unknown) => {
          let descriptor
          try {
            descriptor = decodeDocumentCoreTabDescriptor(rawDescriptor)
          } catch (error) {
            reportAsyncFailure(error, 'Document tab admission')
            return
          }
          const existing = this.tabs.find(
            ({ id }) => id === descriptor.documentId
          )
          if (existing !== undefined) {
            if (descriptor.selected) this.UPDATE_CURRENT_FILE(existing)
            return
          }
          const state = createDocumentState({
            filename: descriptor.filename,
            pathname: descriptor.pathname ?? '',
            isSaved: true,
            markdown: '',
            scrollTop:
              restoredScrollByDocument.get(descriptor.documentId) ?? 0
          }, descriptor.documentId)
          restoredScrollByDocument.delete(descriptor.documentId)
          this.SHOW_TAB_VIEW(false)
          if (descriptor.selected) {
            this.UPDATE_CURRENT_FILE(state)
          } else {
            this.tabs.push(state)
            this.updateTabIdToIndex()
            debouncedSendBufferedState()
          }
        }
      )
    },

    CLOSE_TAB(file: IFileState | null = null): Promise<void> {
      const target = file ?? this.currentFile
      if (target === null) return Promise.resolve()
      return this.REQUEST_DOCUMENT_LIFECYCLE({
        kind: 'close-document',
        documentId: target.id
      })
    },

    LISTEN_FOR_CLOSE_TAB(): void {
      window.electron.ipcRenderer.on('mt::editor-close-tab', () => {
        this.CLOSE_TAB()
      })
      bus.on('mt::editor-close-tab', () => {
        this.CLOSE_TAB()
      })
    },

    LISTEN_FOR_TAB_CYCLE(): void {
      window.electron.ipcRenderer.on('mt::tabs-cycle-left', () => {
        this.CYCLE_TABS(false)
      })
      window.electron.ipcRenderer.on('mt::tabs-cycle-right', () => {
        this.CYCLE_TABS(true)
      })
      bus.on('mt::tabs-cycle-left', () => {
        this.CYCLE_TABS(false)
      })
      bus.on('mt::tabs-cycle-right', () => {
        this.CYCLE_TABS(true)
      })
    },

    LISTEN_FOR_SWITCH_TABS(): void {
      window.electron.ipcRenderer.on('mt::switch-tab-by-index', (_, index) => {
        this.SWITCH_TAB_BY_INDEX(index)
      })
      window.electron.ipcRenderer.on('mt::switch-tab-by-file_path', (_, filePath) => {
        this.SWITCH_TAB_BY_FILEPATH(filePath)
      })
    },

    CLOSE_OTHER_TABS(file: IFileState): void {
      this.REQUEST_DOCUMENT_LIFECYCLE({
        kind: 'close-others',
        keepDocumentId: file.id
      }).catch((error: unknown) => {
        reportAsyncFailure(error, 'Close other documents')
      })
    },

    CLOSE_SAVED_TABS(): void {
      this.REQUEST_DOCUMENT_LIFECYCLE({ kind: 'close-saved' })
        .catch((error: unknown) => {
          reportAsyncFailure(error, 'Close saved documents')
        })
    },

    CLOSE_ALL_TABS(): void {
      this.REQUEST_DOCUMENT_LIFECYCLE({ kind: 'close-all' })
        .catch((error: unknown) => {
          reportAsyncFailure(error, 'Close all documents')
        })
    },

    async CLOSE_TABS(tabIdList: string[]): Promise<void> {
      if (!tabIdList || tabIdList.length === 0) return

      await Promise.all(tabIdList
        .filter((id) => this.tabs.some((file) => file.id === id))
        .map(id => closeDocumentCoreTab(id)))
      let tabIndex = 0
      tabIdList.forEach((id) => {
        const index = this.tabs.findIndex((f) => f.id === id)
        if (index === -1) return

        const timer = autoSaveTimers.get(id)
        if (timer !== undefined) clearTimeout(timer)
        autoSaveTimers.delete(id)
        this.tabs.splice(index, 1)
        if (this.currentFile?.id === id) {
          this.currentFile = null
          if (tabIdList.length === 1) {
            tabIndex = index
          }
        }
      })

      this.updateTabIdToIndex() // Update before sending it out to prevent stale mappings.

      if (this.currentFile == null && this.tabs.length > 0) {
        this.currentFile =
          this.tabs[tabIndex] ?? this.tabs[tabIndex - 1] ?? this.tabs[0] ?? null
        if (this.currentFile && typeof this.currentFile.markdown === 'string') {
          const { id, cursor, scrollTop, blocks } =
            this.currentFile
          bus.emit('file-changed', {
            id,
            cursor,
            renderCursor: true,
            scrollTop,
            blocks
          })
        }
      }

      if (this.tabs.length === 0) {
        this.listToc = []
        this.toc = []
      }
      debouncedSendBufferedState()
    },

    REQUEST_DOCUMENT_LIFECYCLE(
      intent: DocumentCoreLifecycleIntent,
      settleActiveEditor = true
    ): Promise<void> {
      const invoke = async(): Promise<void> => {
        try {
          await window.electron.ipcRenderer.invoke(
            'mt::document-core::lifecycle',
            intent
          )
        } catch (error) {
          reportAsyncFailure(error, 'Document lifecycle')
        }
      }
      if (!settleActiveEditor) return invoke()
      return new Promise((resolve) => {
        afterActiveEditorFlush(() => {
          invoke().then(resolve)
        })
      })
    },

    EXCHANGE_TABS_BY_ID(tabIDs: { fromId: string; toId: string | null }): void {
      const { fromId, toId } = tabIDs
      const { tabs } = this
      const moveItem = <T>(arr: T[], from: number, to: number): boolean => {
        if (from === to) return true
        const len = arr.length
        const item = arr.splice(from, 1)
        if (item.length === 0) return false

        arr.splice(to, 0, item[0]!)
        return arr.length === len
      }

      const fromIndex = tabs.findIndex((t) => t.id === fromId)
      if (fromIndex === -1) return

      if (!toId) {
        moveItem(tabs, fromIndex, tabs.length - 1)
      } else {
        const toIndex = tabs.findIndex((t) => t.id === toId)
        if (toIndex === -1) return
        const realToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex
        moveItem(tabs, fromIndex, realToIndex)
      }
      this.updateTabIdToIndex()
      debouncedSendBufferedState()
    },

    RENAME_FILE(file: IFileState): void {
      this.UPDATE_CURRENT_FILE(file)
      bus.emit('rename')
    },

    // Direction is a boolean where false is left and true right.
    CYCLE_TABS(direction: boolean): void {
      const { tabs, currentFile } = this
      if (tabs.length <= 1) {
        return
      }

      const currentIndex = tabs.findIndex((t) => t.id === currentFile?.id)
      if (currentIndex === -1) {
        console.error('CYCLE_TABS: Cannot find current tab index.')
        return
      }

      let nextTabIndex = 0
      if (!direction) {
        // Switch tab to the left.
        nextTabIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1
      } else {
        // Switch tab to the right.
        nextTabIndex = (currentIndex + 1) % tabs.length
      }

      const nextTab = tabs[nextTabIndex]
      if (!nextTab || !nextTab.id) {
        console.error(`CYCLE_TABS: Cannot find next tab (index="${nextTabIndex}").`)
        return
      }

      this.UPDATE_CURRENT_FILE(nextTab)
    },

    SWITCH_TAB_BY_FILEPATH(filePath: string): void {
      const { tabs } = this

      if (!filePath) {
        console.warn('Invalid file path:', filePath)
        return
      }

      const nextTabIndex = tabs.findIndex((t) => t.pathname === filePath)
      if (nextTabIndex === -1) {
        console.error('Cannot find tab with pathname:', filePath)
        return
      }
      const next = tabs[nextTabIndex]
      if (next) this.UPDATE_CURRENT_FILE(next)
    },

    SWITCH_TAB_BY_INDEX(nextTabIndex: number): void {
      const { tabs, currentFile } = this
      if (nextTabIndex < 0 || nextTabIndex >= tabs.length) {
        console.warn('Invalid tab index:', nextTabIndex)
        return
      }

      const currentIndex = tabs.findIndex((t) => t.id === currentFile?.id)
      if (currentIndex === -1) {
        console.error('Cannot find current tab index.')
        return
      }

      const nextTab = tabs[nextTabIndex]
      if (!nextTab || !nextTab.id) {
        console.error(`Cannot find tab by index="${nextTabIndex}".`)
        return
      }
      this.UPDATE_CURRENT_FILE(nextTab)
    },

    SHOW_TAB_VIEW(always: boolean): void {
      const { tabs } = this
      const layoutStore = useLayoutStore()
      if (always || tabs.length === 1) {
        layoutStore.SET_LAYOUT({ showTabBar: true })
        layoutStore.DISPATCH_LAYOUT_MENU_ITEMS()
      }
    },

    /**
     * Replaces the table of contents with a fresh snapshot from the engine.
     *
     * Used on file load and tab switch, which publish a mounted snapshot rather
     * than a mutation notification. Assigns unconditionally: this is a re-seed
     * on load/switch, so there is no `equal` guard to short-circuit — the
     * incoming snapshot always wins, even if it happens to deep-equal the
     * current TOC.
     * @param toc Flat list of headings returned by the active document view.
     */
    UPDATE_TOC(toc: TocItem[]): void {
      this.listToc = toc ?? []
      this.toc = listToTree<TocItem>(toc ?? [])
    },

    /**
     * Recomputes the active tab's word-count snapshot after an engine load.
     *
     * Load and tab-switch publications cannot use
     * `LISTEN_FOR_CONTENT_CHANGE`: that action also owns dirty/save bookkeeping.
     * This seed updates only the derived counter and deliberately leaves
     * document state untouched.
     */
    UPDATE_WORD_COUNT(wordCount: IFileState['wordCount']): void {
      if (!this.currentFile) {
        throw new Error('Cannot update word count without an active file.')
      }
      this.currentFile.wordCount = wordCount
    },

    // Cache a verified publication from either semantic or Source presentation.
    // It may arrive after a tab switch, so document identity is mandatory.
    LISTEN_FOR_CONTENT_CHANGE({
      id,
      markdown,
      wordCount,
      cursor,
      documentCoreHistory,
      toc,
      blocks
    }: ContentChangePayload): void {
      const preferencesStore = usePreferencesStore()
      const { autoSave } = preferencesStore
      if (!id) {
        throw new Error('Listen for document change but id was not set!')
      } else if (this.tabs.length === 0) {
        return
      } else if (!(id in this.tabIdToIndex)) {
        // This only happens when the sourceCode tries to write a stale id via prepareTabSwitch() but the tab
        // has already been closed. In this case we can safely ignore the update.
        return
      }

      const tab = this.tabs[this.tabIdToIndex[id]!]
      if (!tab) return

      const { pathname, markdown: oldMarkdown } = tab
      tab.markdown = markdown

      if (wordCount) tab.wordCount = wordCount
      if (cursor) tab.cursor = cursor
      if (documentCoreHistory) {
        tab.documentCoreHistory = documentCoreHistory
      }
      if (blocks) tab.blocks = blocks

      // Only update TOC if it's the current file
      if (id === this.currentFile?.id && toc && !equal(toc, this.listToc)) {
        this.listToc = toc
        this.toc = listToTree<TocItem>(toc)
      }

      if (documentCoreHistory === undefined && markdown !== oldMarkdown) {
        throw new Error(
          'Document content changed without main-owned history state'
        )
      }
      const isDirty = documentCoreHistory?.dirty ?? !tab.isSaved
      if (isDirty) {
        tab.isSaved = false
        if (pathname && autoSave) {
          this.HANDLE_AUTO_SAVE({
            id,
            pathname
          })
        }
      } else if (documentCoreHistory !== undefined) {
        tab.isSaved = true
      }
      debouncedSendBufferedState()
    },

    APPLY_DOCUMENT_CORE_HISTORY_STATE(
      id: string,
      state: DocumentCoreHistoryState
    ): void {
      const index = this.tabIdToIndex[id]
      if (index === undefined) return
      const tab = this.tabs[index]
      if (!tab) return
      tab.documentCoreHistory = state
      tab.isSaved = !state.dirty
      debouncedSendBufferedState()
    },

    HANDLE_AUTO_SAVE({ id, pathname }: AutoSavePayload): void {
      if (!id || !pathname) {
        throw new Error('HANDLE_AUTO_SAVE: Invalid tab.')
      }

      const preferencesStore = usePreferencesStore()
      const { autoSaveDelay } = preferencesStore

      if (autoSaveTimers.has(id)) {
        const timer = autoSaveTimers.get(id)
        clearTimeout(timer)
        autoSaveTimers.delete(id)
      }
      const timer = setTimeout(() => {
        autoSaveTimers.delete(id)

        afterActiveEditorFlush(() => {
          const tab = this.tabs.find((t) => t.id === id)
          if (tab && !tab.isSaved) {
            const persist = async(): Promise<void> => {
              await window.electron.ipcRenderer.invoke(
                'mt::document-core::save',
                { documentId: id, mode: 'autosave' }
              )
            }
            persist().catch((error: unknown) => {
              reportAsyncFailure(error, 'Document autosave lease')
            })
          }
        })
      }, autoSaveDelay)
      autoSaveTimers.set(id, timer)
    },

    SELECTION_CHANGE(context: DocumentSelectionContext): void {
      if (this.currentFile && context.selectedText.length > 0) {
        this.currentFile.searchMatches = {
          matches: [],
          index: -1,
          value: context.selectedText
        }
      }

      window.electron.ipcRenderer.send(
        'mt::editor-selection-changed',
        createApplicationMenuState(context)
      )
    },

    // Persist the caret for a tab without the heavy content-change pipeline. A
    // pure caret move (click / arrow key) publishes selection but no document
    // mutation, so `tab.cursor` — the position replayed when the tab is
    // re-activated — would otherwise only track the last edit, losing a
    // click-moved caret across an in-session tab switch. Lightweight by design:
    // it stores only the serialized caret, skipping markdown/blocks/TOC
    // re-derivation and save/dirty bookkeeping.
    PERSIST_CURSOR(id: string, cursor: unknown): void {
      if (!id || !cursor) return
      const index = this.tabIdToIndex[id]
      if (index == null) return
      const tab = this.tabs[index]
      if (tab) tab.cursor = cursor
    },

    SELECTION_FORMATS(formats: readonly InlineFormat[]): void {
      window.electron.ipcRenderer.send(
        'mt::update-format-menu',
        createSelectionFormatState(formats)
      )
    },

    LISTEN_FOR_EXTERNAL_FILE_CHANGE(): void {
      window.electron.ipcRenderer.on(
        'mt::document-core::external-change',
        (_, rawResult: unknown) => {
          let result
          try {
            result = decodeDocumentCoreExternalChangeResult(rawResult)
          } catch (error) {
            reportAsyncFailure(error, 'External document change')
            return
          }
          const tab = this.tabs.find(({ id }) => id === result.documentId)
          if (tab === undefined) return
          const cancelAutosave = (): void => {
            const timer = autoSaveTimers.get(tab.id)
            if (timer !== undefined) clearTimeout(timer)
            autoSaveTimers.delete(tab.id)
          }
          const attachReloadedDocument = (): void => {
            if (this.currentFile?.id !== tab.id) return
            bus.emit('file-changed', {
              id: tab.id,
              cursor: tab.cursor,
              renderCursor: true,
              scrollTop: tab.scrollTop
            })
          }
          if (result.kind === 'unchanged') return
          cancelAutosave()
          if (result.kind === 'reloaded') {
            tab.documentCoreHistory = result.historyState
            tab.isSaved = !result.historyState.dirty
            attachReloadedDocument()
            debouncedSendBufferedState()
            return
          }
          if (result.kind === 'removed') {
            tab.isSaved = false
            this.pushTabNotification({
              tabId: tab.id,
              msg: t('store.editor.fileRemovedOnDisk', {
                name: tab.filename
              }),
              style: 'warn',
              showConfirm: false,
              exclusiveType: 'file_changed',
              action: () => {
                window.electron.ipcRenderer.invoke(
                  'mt::document-core::resolve-external-change',
                  {
                    documentId: tab.id,
                    resolution: 'keep'
                  }
                ).then((rawResolution) => {
                  decodeDocumentCoreExternalChangeResult(rawResolution)
                  debouncedSendBufferedState()
                }).catch((error: unknown) => {
                  reportAsyncFailure(
                    error,
                    'Removed document resolution'
                  )
                })
              }
            })
            debouncedSendBufferedState()
            return
          }
          if (!('historyState' in result)) return

          tab.documentCoreHistory = result.historyState
          tab.isSaved = false
          this.pushTabNotification({
            tabId: tab.id,
            msg: t('store.editor.fileChangedOnDisk', {
              name: tab.filename
            }),
            showConfirm: true,
            style: 'warn',
            exclusiveType: 'file_changed',
            action: (status) => {
              window.electron.ipcRenderer.invoke(
                'mt::document-core::resolve-external-change',
                {
                  documentId: tab.id,
                  resolution: status ? 'reload' : 'keep'
                }
              ).then((rawResolution) => {
                const resolution =
                  decodeDocumentCoreExternalChangeResult(rawResolution)
                if (
                  resolution.kind === 'reloaded' ||
                  resolution.kind === 'unchanged'
                ) {
                  tab.documentCoreHistory = resolution.historyState
                  tab.isSaved = !resolution.historyState.dirty
                  attachReloadedDocument()
                }
                debouncedSendBufferedState()
              }).catch((error: unknown) => {
                reportAsyncFailure(
                  error,
                  'External document change resolution'
                )
              })
            }
          })
          debouncedSendBufferedState()
        }
      )
    },

    SELECT_IMAGE_SOURCE() {
      return window.electron.ipcRenderer.invoke(
        'mt::image-assets::select-native-source'
      )
    },

    EDIT_ZOOM(zoomFactor: number): void {
      const preferencesStore = usePreferencesStore()
      zoomFactor = Number.parseFloat(zoomFactor.toFixed(3))
      const { zoom } = preferencesStore
      if (zoom !== zoomFactor) {
        preferencesStore.SET_SINGLE_PREFERENCE({ type: 'zoom', value: zoomFactor })
      }
      window.electron.webFrame.setZoomFactor(zoomFactor)
    },

    LISTEN_WINDOW_ZOOM(): void {
      window.electron.ipcRenderer.on('mt::window-zoom', (_, zoomFactor) => {
        this.EDIT_ZOOM(zoomFactor)
      })
      bus.on('mt::window-zoom', (zoomFactor) => {
        this.EDIT_ZOOM(zoomFactor as number)
      })
    },

    LISTEN_FOR_RELOAD_IMAGES(): void {
      window.electron.ipcRenderer.on('mt::invalidate-image-cache', () => {
        bus.emit('invalidate-image-cache')
      })
    },

    LISTEN_FOR_CONTEXT_MENU(): void {
      // The context menu's editing rows ride the one editor-command
      // channel; only spelling remains context-menu-specific.

      // Spelling
      window.electron.ipcRenderer.on('mt::spelling-replace-misspelling', (_, info) => {
        bus.emit('replace-misspelling', info)
      })
      window.electron.ipcRenderer.on('mt::spelling-show-switch-language', () => {
        bus.emit('open-command-spellchecker-switch-language')
      })
    },

    LISTEN_FOR_STATE_REPLACE(): void {
      window.electron.ipcRenderer.on('mt::document-core::restore-window-ui', (_, state) => {
        this.RESTORE_BUFFERED_STATE(state)
      })
    }
  }
})

// ----------------------------------------------------------------------------

export const createApplicationMenuState = (
  context: DocumentSelectionContext
): DocumentSelectionMenuState => {
  const lists = context.blockPath.filter(node => node.kind === 'list')
  const heading = [...context.blockPath]
    .reverse()
    .find(node => node.kind === 'heading')
  const headingLevel = heading?.attributes.level
  // blockPath ends at the innermost node under the caret, which can be an
  // inline kind ('text', 'emphasis', …). The menu vocabulary is closed over
  // BLOCK kinds, and main drops the whole update when an unknown kind appears
  // — which silently froze Format and Paragraph at their last state.
  const blockVocabulary: readonly string[] = DOCUMENT_SELECTION_BLOCK_KINDS
  const activeBlockKinds = Object.freeze(
    [...new Set(context.blockPath.map(node => node.kind))]
      .filter(kind => blockVocabulary.includes(kind))
  )
  return Object.freeze({
    activeBlockKinds,
    headingLevel:
      typeof headingLevel === 'number' &&
      Number.isInteger(headingLevel) &&
      headingLevel >= 1 &&
      headingLevel <= 6
        ? headingLevel as 1 | 2 | 3 | 4 | 5 | 6
        : null,
    isDisabled: context.flags.isTable,
    isMultiblock: context.flags.isMultiblock,
    isLooseList: context.flags.isLooseList,
    isTaskList: context.flags.isTaskList,
    isOrderedList: lists.some(node => node.attributes.ordered === true),
    isUnorderedList: lists.some(node =>
      node.attributes.ordered !== true &&
      node.attributes.taskList !== true),
    isCodeLike: context.flags.isCodeLike,
    isCodeBlock: context.flags.isCodeBlock,
    isTable: context.flags.isTable,
    hasFrontMatter: context.flags.hasFrontMatter
  })
}

/**
 * Creates a object that contains the formats selection state.
 */
export const createSelectionFormatState = (
  formats: readonly InlineFormat[]
): DocumentFormatMenuState => {
  const state: Record<keyof DocumentFormatMenuState, boolean> = {
    strong: false,
    em: false,
    u: false,
    sup: false,
    sub: false,
    mark: false,
    inline_code: false,
    inline_math: false,
    del: false,
    link: false,
    image: false
  }
  const menuKey: Readonly<
    Partial<Record<InlineFormat, keyof DocumentFormatMenuState>>
  > = {
    strong: 'strong',
    emphasis: 'em',
    underline: 'u',
    superscript: 'sup',
    subscript: 'sub',
    highlight: 'mark',
    'inline-code': 'inline_code',
    'inline-math': 'inline_math',
    strikethrough: 'del',
    link: 'link',
    image: 'image'
  }
  for (const format of formats) {
    const key = menuKey[format]
    if (key !== undefined) state[key] = true
  }
  return Object.freeze(state)
}

interface BufferedTabState {
  documentId: string
  scrollTop: number
}

const createBufferedTabState = (tab: Partial<IFileState> & { id: string }): BufferedTabState => {
  return {
    documentId: tab.id,
    scrollTop:
      typeof tab.scrollTop === 'number' &&
      Number.isFinite(tab.scrollTop) &&
      tab.scrollTop >= 0
        ? tab.scrollTop
        : defaultFileState.scrollTop
  }
}

interface BufferedEditorState {
  currentDocumentId: string | null
  tabs: BufferedTabState[]
}

const createBufferedEditorState = (state: unknown): BufferedEditorState | null => {
  const s = state as
    | {
      tabs?: unknown
      currentFile?: { id?: string } | null
    }
    | null
    | undefined
  if (!s || !Array.isArray(s.tabs)) {
    return null
  }

  return {
    currentDocumentId: s.currentFile?.id || null,
    tabs: (s.tabs as Array<Partial<IFileState> & { id: string }>)
      .map(createBufferedTabState)
  }
}
