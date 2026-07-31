// Renderer-side global declarations: build-time defines (electron-vite
// `define` block in electron.vite.config.ts), the contextBridge surface
// exposed by src/preload/index.ts, and renderer globals used by the app shell.

import type {
  IpcInvokeChannels,
  IpcSendChannels,
  IpcSyncChannels,
  IpcMainEventChannels,
  BootInfo
} from '@shared/types/ipc'
import type { MenuTemplate, MenuPopupPosition } from '@shared/types/menu'
import type { DocumentCoreExecutionReport } from '@shared/types/documentCore'
import type {
  UploaderAvailabilityReceipt,
  UploaderAvailabilityRequest,
  UploaderUploadReceipt,
  UploaderUploadRequest
} from '@shared/types/uploader'
import type {
  UploaderDeletionClipboardReceipt,
  UploaderDeletionClipboardRequest
} from '@shared/types/clipboardTransactions'
import type {
  ProjectSearchErrorEnvelope,
  ProjectSearchMatchEnvelope,
  ProjectSearchProgressEnvelope,
  ProjectSearchRequest,
  ProjectSearchStartReceipt,
  ProjectSearchTerminalEnvelope
} from '@shared/types/projectSearch'

declare global {
  // eslint-disable-next-line camelcase
  var __mt_captured_errors__: Array<{
    source: 'main' | 'renderer' | 'startup' | 'crash'
    name: string
    message: string
    stack?: string
  }> | undefined

  // ---- Build-time defines (electron-vite `define`) ----
  const MARKTEXT_BUILD_COMMIT: string
  const MARKTEXT_VERSION: string
  const MARKTEXT_VERSION_STRING: string
  const __static: string

  // ---- contextBridge surface ----

  interface ElectronIpcRenderer {
    send<K extends keyof IpcSendChannels>(channel: K, ...args: IpcSendChannels[K]): void
    sendSync<K extends keyof IpcSyncChannels>(
      channel: K,
      ...args: IpcSyncChannels[K]['args']
    ): IpcSyncChannels[K]['ret']
    invoke<K extends keyof IpcInvokeChannels>(
      channel: K,
      ...args: IpcInvokeChannels[K]['args']
    ): Promise<IpcInvokeChannels[K]['ret']>
    on<K extends keyof IpcMainEventChannels>(
      channel: K,
      listener: (event: unknown, ...args: IpcMainEventChannels[K]) => void
    ): () => void
    once<K extends keyof IpcMainEventChannels>(
      channel: K,
      listener: (event: unknown, ...args: IpcMainEventChannels[K]) => void
    ): () => void
    removeAllListeners(channel: keyof IpcMainEventChannels | string): void
  }

  interface ElectronWebFrameAPI {
    setZoomFactor(factor: number): void
    setZoomLevel(level: number): void
  }

  interface ElectronWindowControlAPI {
    minimize(): void
    maximize(): void
    unmaximize(): void
    toggleMaximize(): void
    close(): void
    setFullScreen(flag: boolean): void
    toggleFullScreen(): void
    isMaximized(): Promise<boolean>
    isFullScreen(): Promise<boolean>
    popupMenu(template: MenuTemplate, position?: MenuPopupPosition): void
    popupApplicationMenu(position?: MenuPopupPosition): void
  }

  interface ElectronAPI {
    buildCommit: string
    ipcRenderer: ElectronIpcRenderer
    webFrame: ElectronWebFrameAPI
    process: {
      platform: NodeJS.Platform
      arch?: string
      versions: Record<string, string>
      env: Record<string, string>
      resourcesPath?: string
      cwd?: string
    }
    paths: Partial<BootInfo['paths']>
    isUpdatable: boolean
    windowControl: ElectronWindowControlAPI
  }

  interface FileUtilsAPI {
    isChildOfDirectory(dir: string, child: string): boolean
    hasMarkdownExtension(filename: string): boolean
    isSamePathSync(a: string, b: string, isNormalized?: boolean): boolean
    MARKDOWN_INCLUSIONS: string[]
  }

  interface PathAPI {
    basename(path: string, ext?: string): string
    dirname(path: string): string
    extname(path: string): string
    join(...paths: string[]): string
    resolve(...paths: string[]): string
    relative(from: string, to: string): string
    isAbsolute(path: string): boolean
    normalize(path: string): string
    parse(path: string): { root: string; dir: string; base: string; ext: string; name: string }
    format(pathObject: {
      root?: string
      dir?: string
      base?: string
      ext?: string
      name?: string
    }): string
    sep: string
    delimiter: string
  }

  interface I18nUtilsAPI {
    loadTranslations(language: string): Promise<Record<string, unknown>>
  }

  interface RipgrepAPI {
    start(request: ProjectSearchRequest): Promise<ProjectSearchStartReceipt>
    cancel(searchId: string): void
    onMatch(handler: (payload: ProjectSearchMatchEnvelope) => void): () => void
    onProgress(handler: (payload: ProjectSearchProgressEnvelope) => void): () => void
    onDone(handler: (payload: ProjectSearchTerminalEnvelope) => void): () => void
    onError(handler: (payload: ProjectSearchErrorEnvelope) => void): () => void
    onCancelled(handler: (payload: ProjectSearchTerminalEnvelope) => void): () => void
  }

  interface UploaderAPI {
    uploadImage(request: UploaderUploadRequest): Promise<UploaderUploadReceipt>
    inspectAvailability(
      request: UploaderAvailabilityRequest
    ): Promise<UploaderAvailabilityReceipt>
    copyDeletionUrl(
      request: UploaderDeletionClipboardRequest
    ): Promise<UploaderDeletionClipboardReceipt>
  }

  interface FontsAPI {
    list(): Promise<string[]>
  }

  interface ProcessShim {
    platform: NodeJS.Platform
    arch?: string
    versions: Record<string, string>
    env: Record<string, string>
    resourcesPath?: string
    cwd: () => string | undefined
    nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => void
  }

  interface MarkTextE2EReadOnlyBridge {
    /** Read the active canonical document without entering source mode or mutating it. */
    readCanonicalMarkdown(): string
    /** Read the latest worker-local production operation measurement. */
    readLastExecutionReport(): DocumentCoreExecutionReport | null
  }

  interface Window {
    electron: ElectronAPI
    fileUtils: FileUtilsAPI
    path: PathAPI
    i18nUtils: I18nUtilsAPI
    ripgrep: RipgrepAPI
    uploader: UploaderAPI
    fonts: FontsAPI
    process: ProcessShim
    /** Present only when the explicit E2E read-only bridge flag is enabled. */
    __marktextE2EReadOnly?: MarkTextE2EReadOnlyBridge
    marktext?: {
      env?: { windowId: number; [key: string]: unknown }
      initialState?: {
        codeFontFamily?: string
        codeFontSize?: number
        hideScrollbar?: boolean
        theme?: string
        titleBarStyle?: 'custom' | 'native'
      }
      paths?: { [key: string]: unknown }
      [key: string]: unknown
    }
  }
}

export {}
