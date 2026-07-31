/**
 * IPC channel contract — single source of truth for renderer↔main messaging.
 *
 * Four channel categories:
 *   - IpcInvokeChannels      : renderer → main, returns Promise<T>
 *   - IpcSendChannels        : renderer → main, fire-and-forget
 *   - IpcSyncChannels        : renderer → main, synchronous
 *   - IpcMainEventChannels   : main → renderer, push events (renderer .on)
 *
 * To register a new channel:
 *   1. Add an entry to the appropriate interface here.
 *   2. Wire the handler in src/main (ipcMain.handle / ipcMain.on / webContents.send).
 *   3. Wire the caller via the typed preload bridge in src/preload/index.ts.
 */

import type { IKeyboardLayoutInfo, IKeyboardMapping } from 'native-keymap'
import type {
  BootstrapEditorConfig,
  ExportType
} from './files'
import type { BufferedState as BufferedStateType } from './bufferedState'
import type {
  CriticMarkupCommentEditRequest,
  CriticMarkupEditorContextRequest,
  CriticMarkupEditorContextResponse,
  CriticMarkupReviewMenuState
} from './criticMarkup'
import type { MenuTemplate, MenuPopupPosition } from './menu'
import type {
  DocumentFormatMenuState,
  DocumentSelectionMenuState,
  WindowLayoutMenuState
} from './documentSelection'
import type { ParagraphDocumentAction } from './paragraphDocumentAction'
import type {
  DocumentCapabilityMenuState,
  DocumentClipboardMenuState,
  DocumentSurfaceContextRequest,
  DocumentSurfaceContextResponse
} from './documentSurface'
import type { RendererPreferences } from './preferences'
import type {
  ImageAssetActivationReceipt,
  ImageAssetActivationRequest,
  ImageAssetInsertReceipt,
  ImageAssetInsertRequest,
  ImageDisplayReceipt,
  ImageDisplayRequest,
  ImageSourceCapability
} from './imageAsset'
import type {
  UploaderAvailabilityReceipt,
  UploaderAvailabilityRequest,
  UploaderCustomExecutableReceipt,
  UploaderSelectionReceipt,
  UploaderSelectionRequest,
  UploaderUploadReceipt,
  UploaderUploadRequest
} from './uploader'
import type {
  DocumentRevealRequest,
  ExternalResourceOpenRequest,
  ImageFolderOpenRequest,
  ProjectRevealRequest,
  StaticOutputRevealRequest
} from './presentationEffects'
import type {
  ProjectCreateIntent,
  ProjectCreateReceipt
} from './projectCreate'
import type {
  ProjectRelocateIntent,
  ProjectRelocateReceipt
} from './projectRelocation'
import type {
  ProjectDeleteIntent,
  ProjectDeleteReceipt
} from './projectDeletion'
import type {
  ProjectCopyIntent,
  ProjectCopyReceipt
} from './projectCopy'
import type {
  ProjectDocumentOpenReceipt,
  ProjectDocumentOpenRequest
} from './projectDocumentOpen'
import type {
  DocumentImportBinaryReceipt,
  DocumentImportBinaryRequest
} from './documentImport'
import type {
  DocumentClipboardPasteRequest,
  DocumentPathClipboardReceipt,
  DocumentPathClipboardRequest,
  UploaderDeletionClipboardReceipt,
  UploaderDeletionClipboardRequest
} from './clipboardTransactions'
import type {
  ProjectSearchErrorEnvelope,
  ProjectSearchMatchEnvelope,
  ProjectSearchProgressEnvelope,
  ProjectSearchRequest,
  ProjectSearchStartReceipt,
  ProjectSearchTerminalEnvelope
} from './projectSearch'
import type {
  DocumentCoreCancelDispatchRequest,
  DocumentCoreAttachRequest,
  DocumentCoreClipboardWriteReceipt,
  DocumentCoreClipboardWriteRequest,
  DocumentCoreCompleteDispatchRequest,
  DocumentCoreDispatchTicketReceipt,
  DocumentCoreAwaitSettledRequest,
  DocumentCoreLifecycleIntent,
  DocumentCoreLifecycleReceipt,
  DocumentCoreMainDispatchRequest,
  DocumentCoreMainSelectRequest,
  DocumentCoreSettledReceipt,
  DocumentCoreOpenLinkReceipt,
  DocumentCoreOpenLinkRequest,
  DocumentCorePublication,
  DocumentCoreReconfigureMarkdownOptionsRequest,
  DocumentCoreRelocateRequest,
  DocumentCorePathReceipt,
  DocumentCoreResolveExternalChangeRequest,
  DocumentCoreExternalChangeResult,
  DocumentCoreSaveReceipt,
  DocumentCoreSaveRequest,
  DocumentCoreStaticSinkReceipt,
  DocumentCoreStaticSinkRequest,
  DocumentCoreExportThemeDescriptor,
  DocumentCoreTabDescriptor
} from './documentCore'
import type { SessionCancelResult } from '@marktext/document-core'

// =================================================================
// Invoke channels (renderer → main, returns Promise<T>)
// =================================================================

export interface IpcInvokeChannels {
  // Main owns every parse. The renderer sends inert sample text and receives
  // sanitized HTML; it never builds a configuration or opens a revision.
  'mt::preview::render-sample': {
    args: [markdown: string]
    ret: string
  }
  'mt::project::create': {
    args: [intent: ProjectCreateIntent]
    ret: ProjectCreateReceipt
  }
  'mt::project::relocate': {
    args: [intent: ProjectRelocateIntent]
    ret: ProjectRelocateReceipt
  }
  'mt::project::delete': {
    args: [intent: ProjectDeleteIntent]
    ret: ProjectDeleteReceipt
  }
  'mt::project::copy': {
    args: [intent: ProjectCopyIntent]
    ret: ProjectCopyReceipt
  }
  'mt::project::open-document': {
    args: [request: ProjectDocumentOpenRequest]
    ret: ProjectDocumentOpenReceipt
  }
  'mt::document-import::binary': {
    args: [request: DocumentImportBinaryRequest]
    ret: DocumentImportBinaryReceipt
  }
  'mt::document::copy-path': {
    args: [request: DocumentPathClipboardRequest]
    ret: DocumentPathClipboardReceipt
  }
  'mt::document::paste-clipboard': {
    args: [request: DocumentClipboardPasteRequest]
    ret: DocumentCorePublication
  }
  'mt::uploader::copy-deletion-url': {
    args: [request: UploaderDeletionClipboardRequest]
    ret: UploaderDeletionClipboardReceipt
  }
  'mt::document-core::attach': {
    args: [request: DocumentCoreAttachRequest]
    ret: DocumentCorePublication
  }
  'mt::document-core::save': {
    args: [request: DocumentCoreSaveRequest]
    ret: DocumentCoreSaveReceipt
  }
  'mt::document-core::relocate': {
    args: [request: DocumentCoreRelocateRequest]
    ret: DocumentCorePathReceipt | null
  }
  'mt::document-core::resolve-external-change': {
    args: [request: DocumentCoreResolveExternalChangeRequest]
    ret: DocumentCoreExternalChangeResult
  }
  'mt::document-core::lifecycle': {
    args: [intent: DocumentCoreLifecycleIntent]
    ret: DocumentCoreLifecycleReceipt
  }
  'mt::document-core::write-clipboard': {
    args: [request: DocumentCoreClipboardWriteRequest]
    ret: DocumentCoreClipboardWriteReceipt
  }
  'mt::document-core::open-link': {
    args: [request: DocumentCoreOpenLinkRequest]
    ret: DocumentCoreOpenLinkReceipt
  }
  'mt::document-core::dispatch-start': {
    args: [request: DocumentCoreMainDispatchRequest]
    ret: DocumentCoreDispatchTicketReceipt
  }
  'mt::document-core::dispatch-complete': {
    args: [request: DocumentCoreCompleteDispatchRequest]
    ret: DocumentCorePublication
  }
  'mt::document-core::dispatch-cancel': {
    args: [request: DocumentCoreCancelDispatchRequest]
    ret: SessionCancelResult
  }
  'mt::document-core::reconfigure-markdown-options': {
    args: [request: DocumentCoreReconfigureMarkdownOptionsRequest]
    ret: DocumentCorePublication
  }
  'mt::document-core::materialize-static': {
    args: [request: DocumentCoreStaticSinkRequest]
    ret: DocumentCoreStaticSinkReceipt
  }
  'mt::document-core::list-export-themes': {
    args: []
    ret: readonly DocumentCoreExportThemeDescriptor[]
  }
  'mt::document-core::select': {
    args: [request: DocumentCoreMainSelectRequest]
    ret: DocumentCorePublication
  }
  'mt::document-core::await-settled': {
    args: [request: DocumentCoreAwaitSettledRequest]
    ret: DocumentCoreSettledReceipt
  }
  'mt::image-assets::activate-document': {
    args: [request: ImageAssetActivationRequest]
    ret: ImageAssetActivationReceipt
  }
  'mt::image-assets::insert': {
    args: [request: ImageAssetInsertRequest]
    ret: ImageAssetInsertReceipt
  }
  'mt::image-assets::resolve-display': {
    args: [request: ImageDisplayRequest]
    ret: ImageDisplayReceipt
  }
  'mt::image-assets::select-native-source': {
    args: []
    ret: ImageSourceCapability | null
  }
  'mt::boot-info-async': { args: []; ret: BootInfo }
  'mt::fonts::list': { args: []; ret: string[] }
  'mt::i18n::is-supported': { args: [lang: string]; ret: boolean }
  'mt::i18n::load': { args: [language: string]; ret: Record<string, unknown> }
  'mt::i18n::supported': { args: []; ret: string[] }
  'mt::keybinding-get-keyboard-info': { args: []; ret: KeyboardInfo }
  'mt::keybinding-get-pref-keybindings': {
    args: []
    ret: { defaultKeybindings: Map<string, string>; userKeybindings: Map<string, string> }
  }
  'mt::keybinding-save-user-keybindings': { args: [bindings: unknown]; ret: boolean }
  'mt::rg::start': {
    args: [request: ProjectSearchRequest]
    ret: ProjectSearchStartReceipt
  }
  'mt::external-resource::open': {
    args: [request: ExternalResourceOpenRequest]
    ret: boolean
  }
  'mt::document::reveal': {
    args: [request: DocumentRevealRequest]
    ret: boolean
  }
  'mt::project::reveal': {
    args: [request: ProjectRevealRequest]
    ret: boolean
  }
  'mt::image-folder::open': {
    args: [request: ImageFolderOpenRequest]
    ret: boolean
  }
  'mt::static-output::reveal': {
    args: [request: StaticOutputRevealRequest]
    ret: boolean
  }
  'mt::spellchecker-get-available-dictionaries': { args: []; ret: string[] }
  'mt::spellchecker-get-custom-dictionary-words': { args: []; ret: string[] }
  'mt::spellchecker-remove-word': { args: [word: string]; ret: boolean }
  'mt::spellchecker-set-enabled': { args: [enabled: boolean]; ret: void }
  'mt::spellchecker-switch-language': { args: [language: string]; ret: void }
  'mt::uploader::availability': {
    args: [request: UploaderAvailabilityRequest]
    ret: UploaderAvailabilityReceipt
  }
  'mt::uploader::upload': {
    args: [request: UploaderUploadRequest]
    ret: UploaderUploadReceipt
  }
  'mt::uploader::select': {
    args: [request: UploaderSelectionRequest]
    ret: UploaderSelectionReceipt
  }
  'mt::uploader::choose-custom-executable': {
    args: []
    ret: UploaderCustomExecutableReceipt
  }
  'mt::win::is-fullscreen': { args: []; ret: boolean }
  'mt::win::is-maximized': { args: []; ret: boolean }
  // Main derives the BrowserWindow via BrowserWindow.fromWebContents(e.sender);
  // no need to pass windowId. Payload is the editor+project+layout snapshot.
  'update-buffer-state': { args: [payload: unknown]; ret: boolean }
}

// =================================================================
// Send channels (renderer → main, fire-and-forget)
// =================================================================

export interface IpcSendChannels {
  'mt::NEED_UPDATE': [payload?: unknown]
  'mt::app-try-quit': []
  'mt::ask-for-modify-image-folder-path': []
  'mt::ask-for-open-project-in-sidebar': []
  'mt::ask-for-user-data': []
  'mt::ask-for-user-preference': []
  'mt::check-for-update': []
  'mt::cm-editor-context-response': [response: CriticMarkupEditorContextResponse]
  'mt::document-surface-context-response': [
    response: DocumentSurfaceContextResponse
  ]
  'mt::cmd-close-window': []
  'mt::cmd-import-file': []
  'mt::cmd-new-editor-window': []
  'mt::cmd-open-file': []
  'mt::cmd-new-tab': []
  'mt::cmd-open-folder': []
  'mt::cmd-toggle-autosave': []
  'mt::editor-selection-changed': [state: DocumentSelectionMenuState]
  'mt::get-current-language': []
  'mt::handle-renderer-error': [error: unknown]
  'mt::keybinding-debug-dump-keyboard-info': []
  'mt::make-screenshot': []
  'mt::menu::popup': [template: MenuTemplate, position?: MenuPopupPosition]
  'mt::menu::popup-application': [position?: MenuPopupPosition]
  'mt::open-keybindings-config': []
  'mt::open-setting-window': []
  'mt::request-keybindings': []
  'mt::set-editor-format-menus-enabled': [enabled: boolean]
  'mt::set-document-clipboard-menu-state': [
    state: DocumentClipboardMenuState
  ]
  'mt::set-document-capability-menu-state': [
    state: DocumentCapabilityMenuState
  ]
  'mt::update-review-menu': [state: CriticMarkupReviewMenuState]
  'mt::rg::cancel': [searchId: string]
  'mt::select-default-directory-to-open': []
  'mt::set-user-preference': [partial: Partial<RendererPreferences>]
  'mt::update-format-menu': [state: DocumentFormatMenuState]
  'mt::update-sidebar-menu': [visible: boolean]
  'mt::view-layout-changed': [layout: WindowLayoutMenuState]
  'mt::win::close': []
  'mt::win::maximize': []
  'mt::win::minimize': []
  'mt::win::set-fullscreen': [flag: boolean]
  'mt::win::toggle-fullscreen': []
  'mt::win::toggle-maximize': []
  'mt::win::unmaximize': []
  'mt::window-initialized': []
  'mt::window-toggle-always-on-top': []
}

// =================================================================
// Sync channels (synchronous renderer → main)
// =================================================================

export interface IpcSyncChannels {
  'mt::boot-info': { args: []; ret: BootInfo }
  'mt::paths::is-same-sync': { args: [a: string, b: string]; ret: boolean }
}

// =================================================================
// Push events (main → renderer, listened on ipcRenderer.on)
// =================================================================

export interface IpcMainEventChannels {
  'language-changed': [language: string]
  'mt::UPDATE_AVAILABLE': [info?: unknown]
  'mt::UPDATE_DOWNLOADED': [info?: unknown]
  'mt::UPDATE_ERROR': [error: unknown]
  'mt::UPDATE_NOT_AVAILABLE': [info?: unknown]
  'mt::about-dialog': []
  'mt::ask-for-close': []
  'mt::bootstrap-editor': [config: BootstrapEditorConfig]
  'mt::cm-copy-as-html': []
  'mt::cm-copy-as-rich': []
  'mt::cm-edit-comment': [request: CriticMarkupCommentEditRequest]
  'mt::cm-insert-paragraph': [direction: 'before' | 'after']
  'mt::cm-paste-as-plain-text': []
  'mt::cm-query-editor-context': [request: CriticMarkupEditorContextRequest]
  'mt::query-document-surface-context': [
    request: DocumentSurfaceContextRequest
  ]
  'mt::current-language': [language: string]
  'mt::editor-ask-file-save': []
  'mt::editor-ask-file-save-as': []
  'mt::editor-close-tab': [tabId?: string]
  'mt::editor-edit-action': [action: string]
  'mt::editor-format-action': [payload: { type: string }]
  'mt::editor-move-file': []
  'mt::editor-paragraph-action': [payload: ParagraphDocumentAction]
  'mt::editor-rename-file': []
  'mt::execute-command-by-id': [commandId: string]
  'mt::file-saved': [tabId: string]
  'mt::document-core::closed': [documentIds: readonly string[]]
  'mt::document-core::saved': [receipt: DocumentCoreSaveReceipt]
  'mt::document-core::tab-opened': [descriptor: DocumentCoreTabDescriptor]
  'mt::document-core::external-change': [result: DocumentCoreExternalChangeResult]
  'mt::invalidate-image-cache': []
  'mt::keybindings-response': [bindings: unknown]
  'mt::document-core::restore-window-ui': [state: BufferedStateType]
  'mt::menu::click': [menuId: string]
  'mt::menu::closed': []
  'mt::open-directory': [directoryPath: string]
  'mt::pandoc-not-exists': [opts: Record<string, unknown>]
  'mt::rg::cancelled': [payload: ProjectSearchTerminalEnvelope]
  'mt::rg::done': [payload: ProjectSearchTerminalEnvelope]
  'mt::rg::error': [payload: ProjectSearchErrorEnvelope]
  'mt::rg::match': [payload: ProjectSearchMatchEnvelope]
  'mt::rg::progress': [payload: ProjectSearchProgressEnvelope]
  'mt::screenshot-captured': [source: ImageSourceCapability | null]
  'mt::set-view-layout': [layout: unknown]
  'mt::show-command-palette': []
  'mt::show-export-dialog': [type: ExportType]
  'mt::show-notification': [payload: unknown]
  'mt::spelling-replace-misspelling': [payload: unknown]
  'mt::spelling-show-switch-language': []
  'mt::switch-tab-by-file_path': [filePath: string]
  'mt::switch-tab-by-index': [index: number]
  'mt::tabs-cycle-left': []
  'mt::tabs-cycle-right': []
  'mt::toggle-view-layout-entry': [entry: string]
  'mt::toggle-view-mode-entry': [entry: string]
  'mt::update-object-tree': [payload: unknown]
  'mt::user-preference': [partial: Partial<RendererPreferences>]
  'mt::window-active-status': [active: boolean]
  'mt::window-enter-full-screen': []
  'mt::window-leave-full-screen': []
  'mt::window-maximize': []
  'mt::window-unmaximize': []
  'mt::window-zoom': [zoomLevel: number]
  'settings::change-tab': [tab: string]
}

// =================================================================
// Auxiliary types
// =================================================================

/**
 * Snapshot of the active OS keyboard layout, returned by
 * `mt::keybinding-get-keyboard-info`. Mirrors the runtime shape produced
 * by `native-keymap` (see `src/main/keyboard/index.ts#getKeyboardInfo`).
 */
export interface KeyboardInfo {
  layout: IKeyboardLayoutInfo
  keymap: IKeyboardMapping
}

export interface BootInfo {
  buildCommit: string
  platform: NodeJS.Platform
  arch: string
  versions: Record<string, string>
  env: Record<string, string>
  paths: {
    resources: string
    userData: string
    cwd: string
  }
  isUpdatable: boolean
  MARKDOWN_INCLUSIONS: string[]
}

// =================================================================
// Helper types for the preload bridge generic wrappers
// =================================================================

export type InvokeArgs<K extends keyof IpcInvokeChannels> = IpcInvokeChannels[K]['args']
export type InvokeRet<K extends keyof IpcInvokeChannels> = IpcInvokeChannels[K]['ret']

export type SyncArgs<K extends keyof IpcSyncChannels> = IpcSyncChannels[K]['args']
export type SyncRet<K extends keyof IpcSyncChannels> = IpcSyncChannels[K]['ret']

export type SendArgs<K extends keyof IpcSendChannels> = IpcSendChannels[K]

export type EventArgs<K extends keyof IpcMainEventChannels> = IpcMainEventChannels[K]
