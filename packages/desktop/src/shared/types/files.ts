import type { DocumentCoreHistoryState } from './documentCore'

// Closed file/tab presentation shapes shared between main and renderer.

export interface SerializedStat {
  size: number
  mtimeMs: number
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink?: boolean
}

export interface FileWordCount {
  paragraph: number
  word: number
  character: number
  all: number
}

export interface FileSearchMatches {
  index: number
  matches: unknown[]
  value: string
}

/**
 * Per-tab renderer cache. The main-owned document session is authoritative;
 * this shape carries presentation metadata and verified publication mirrors.
 * Mirrors `defaultFileState` in
 * `src/renderer/src/store/help.ts`.
 */
export interface IFileState {
  id: string
  filename: string
  // Empty for untitled documents.
  pathname: string
  markdown: string
  isSaved: boolean
  documentCoreHistory: DocumentCoreHistoryState | null
  cursor: unknown
  wordCount: FileWordCount
  searchMatches: FileSearchMatches
  scrollTop: number
  notifications: FileNotification[]
  // Render block tree; only populated for the actively edited tab.
  blocks?: unknown
}

/**
 * Per-tab notification banner. Pushed via the editor store's
 * `pushTabNotification` action; consumed by `notifications.vue`.
 */
export interface FileNotification {
  msg: string
  showConfirm: boolean
  style: string
  exclusiveType: string
  action: (status?: unknown) => void
}

export type ITab = IFileState

export interface FileChangeDetail {
  pathname: string
  type?: string
  [key: string]: unknown
}

export interface BootstrapEditorConfig {
  isNewWindow?: boolean
  sideBarVisibility: boolean
  tabBarVisibility: boolean
  sourceCodeModeEnabled: boolean
  preferences?: unknown
  userKeybindings?: unknown
  recentlyUsedFiles?: string[]
  windowId?: number
  [key: string]: unknown
}

export type ExportType = 'pdf' | 'html' | 'styledHtml' | 'png' | 'jpeg'
