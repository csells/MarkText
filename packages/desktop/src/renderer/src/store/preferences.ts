import { defineStore } from 'pinia'
import { reportAsyncFailure } from '@marktext/document-view'
import type {
  WindowLayoutMenuState
} from '@shared/types/documentSelection'
import bus from '../bus'
import { setLanguage } from '../i18n'

// Finite-value unions where the runtime currently constrains the field.
// We keep these as plain strings everywhere else to avoid forcing prematurely
// narrow casts on consumers that read raw values from disk.
export type TitleBarStyle = 'custom' | 'native'
export type StartUpAction = 'folder' | 'openLastFolder' | 'blank' | 'restoreAll'
export type TextDirection = 'ltr' | 'rtl'
export type ImageInsertAction = 'folder' | 'path' | 'upload'
export type ImageRelativeDirectoryBase = 'file' | 'folder'
export type FileSortBy = 'created' | 'modified' | 'title'
export type FileSortOrder = 'asc' | 'desc'

export interface PreferencesState {
  // ----- General -----
  autoSave: boolean
  autoSaveDelay: number
  titleBarStyle: TitleBarStyle
  openFilesInNewWindow: boolean
  openFolderInNewWindow: boolean
  zoom: number
  hideScrollbar: boolean
  wordWrapInToc: boolean
  fileSortBy: FileSortBy
  fileSortOrder: FileSortOrder
  startUpAction: StartUpAction
  restoreLayoutState: boolean
  defaultDirectoryToOpen: string
  lastOpenedFolder: string
  treePathExcludePatterns: string[]
  language: string

  // ----- Editor / typography -----
  editorFontFamily: string
  fontSize: number
  lineHeight: number
  codeFontSize: number
  codeFontFamily: string
  wrapCodeBlocks: boolean
  editorLineWidth: string

  // ----- Markdown editing -----
  autoPairBracket: boolean
  autoPairMarkdownSyntax: boolean
  autoPairQuote: boolean
  textDirection: TextDirection
  hideQuickInsertHint: boolean
  imageInsertAction: ImageInsertAction
  imagePreferRelativeDirectory: boolean
  imageRelativeDirectoryBase: ImageRelativeDirectoryBase
  imageRelativeDirectoryName: string
  hideLinkPopup: boolean
  autoCheck: boolean

  subscriptAndSuperscript: boolean
  footnotes: boolean
  gitLabMath: boolean
  // ----- Theme -----
  theme: string
  followSystemTheme: boolean
  lightModeTheme: string
  darkModeTheme: string
  customCss: string

  // ----- Spellchecker -----
  spellcheckerEnabled: boolean
  spellcheckerNoUnderline: boolean
  spellcheckerLanguage: string

  // ----- Side bar / tab bar visibility (persisted) -----
  sideBarVisibility: boolean
  tabBarVisibility: boolean
  sourceCodeModeEnabled: boolean
  openedFilesInSidebar: boolean

  watcherUsePolling: boolean

  // ----- Edit modes (per-window, not persisted) -----
  typewriter: boolean
  focus: boolean
  sourceCode: boolean

  // ----- User config -----
  imageFolderPath: string
  webImages: unknown[]
  cloudImages: unknown[]
  currentUploader: string
  cliScript: string
}

interface SingleSetPreferencePayload {
  type: keyof PreferencesState
  value: unknown
}

interface ModeTogglePayload {
  type: keyof PreferencesState | 'typewriter' | 'focus' | 'sourceCode'
  checked: boolean
}

export const usePreferencesStore = defineStore('preferences', {
  state: (): PreferencesState => ({
    autoSave: false,
    autoSaveDelay: 5000,
    titleBarStyle: 'custom',
    openFilesInNewWindow: false,
    openFolderInNewWindow: false,
    zoom: 1.0,
    hideScrollbar: false,
    wordWrapInToc: false,
    fileSortBy: 'modified',
    fileSortOrder: 'asc',
    startUpAction: 'restoreAll',
    restoreLayoutState: true,
    defaultDirectoryToOpen: '',
    lastOpenedFolder: '',
    treePathExcludePatterns: [],
    language: 'en',

    editorFontFamily: 'Open Sans',
    fontSize: 16,
    lineHeight: 1.6,
    codeFontSize: 14,
    codeFontFamily: 'DejaVu Sans Mono',
    wrapCodeBlocks: true,
    editorLineWidth: '',

    autoPairBracket: true,
    autoPairMarkdownSyntax: true,
    autoPairQuote: true,
    textDirection: 'ltr',
    hideQuickInsertHint: false,
    imageInsertAction: 'path',
    imagePreferRelativeDirectory: false,
    imageRelativeDirectoryBase: 'file',
    imageRelativeDirectoryName: 'assets',
    hideLinkPopup: false,
    autoCheck: false,

    subscriptAndSuperscript: false,
    footnotes: false,
    gitLabMath: false,
    theme: 'light',
    followSystemTheme: false,
    lightModeTheme: 'light',
    darkModeTheme: 'dark',
    customCss: '',

    spellcheckerEnabled: false,
    spellcheckerNoUnderline: false,
    spellcheckerLanguage: 'en-US',

    // Default values that are overwritten with the entries below.
    sideBarVisibility: false,
    tabBarVisibility: false,
    sourceCodeModeEnabled: false,
    openedFilesInSidebar: true,

    watcherUsePolling: false,

    // --------------------------------------------------------------------------

    // Edit modes of the current window (not part of persistent settings)
    typewriter: false, // typewriter mode
    focus: false,
    sourceCode: false, // source code mode

    // user configration
    imageFolderPath: '',
    webImages: [],
    cloudImages: [],
    currentUploader: 'picgo',
    cliScript: ''
  }),

  getters: {
    getAll: (state): PreferencesState => state
  },

  actions: {
    SET_USER_PREFERENCE(preference: Partial<PreferencesState>): void {
      const oldLanguage = this.language
      const state = this.$state as unknown as Record<string, unknown>

      Object.keys(preference).forEach((key) => {
        if (!Object.hasOwn(state, key)) {
          throw new TypeError(`Unknown renderer preference: ${key}`)
        }
        const incoming = (preference as Record<string, unknown>)[key]
        if (typeof incoming !== 'undefined') {
          state[key] = incoming
        }
      })

      // Update i18n language if language preference changed
      const lang = (preference as { language?: string }).language
      if (lang && lang !== oldLanguage) {
        setLanguage(lang)
      }
    },

    SET_MODE({ type, checked }: ModeTogglePayload): void {
      ;(this as unknown as Record<string, unknown>)[type as string] = checked
    },

    TOGGLE_VIEW_MODE(entryName: keyof PreferencesState | string): void {
      const target = this as unknown as Record<string, unknown>
      target[entryName as string] = !target[entryName as string]
    },

    ASK_FOR_USER_PREFERENCE(): void {
      window.electron.ipcRenderer.send('mt::ask-for-user-preference')
      window.electron.ipcRenderer.send('mt::ask-for-user-data')

      window.electron.ipcRenderer.on('mt::user-preference', (_e, preferences) => {
        this.SET_USER_PREFERENCE(preferences as Partial<PreferencesState>)
      })
    },

    SET_SINGLE_PREFERENCE({ type, value }: SingleSetPreferencePayload): void {
      // Update local state
      ;(this as unknown as Record<string, unknown>)[type] = value

      // Update i18n language if language preference changed
      if (type === 'language' && typeof value === 'string') {
        setLanguage(value)
      }

      // save to electron-store
      window.electron.ipcRenderer.send('mt::set-user-preference', { [type]: value })
    },

    async SELECT_UPLOADER(
      kind: 'picgo' | 'custom-cli'
    ): Promise<boolean> {
      try {
        const receipt = await window.electron.ipcRenderer.invoke(
          'mt::uploader::select',
          {
            schema: 'uploader-selection-1',
            kind
          }
        )
        this.currentUploader =
          receipt.kind === 'custom-cli' ? 'cliScript' : 'picgo'
        return true
      } catch (error) {
        reportAsyncFailure(error, 'Uploader selection')
        return false
      }
    },

    async CHOOSE_CUSTOM_UPLOADER_EXECUTABLE(): Promise<string | null> {
      try {
        const receipt = await window.electron.ipcRenderer.invoke(
          'mt::uploader::choose-custom-executable'
        )
        if (!receipt.selected) return null
        this.cliScript = receipt.executablePath
        return receipt.executablePath
      } catch (error) {
        reportAsyncFailure(error, 'Uploader executable selection')
        return null
      }
    },

    SET_IMAGE_FOLDER_PATH(): void {
      window.electron.ipcRenderer.send('mt::ask-for-modify-image-folder-path')
    },

    SELECT_DEFAULT_DIRECTORY_TO_OPEN(): void {
      window.electron.ipcRenderer.send('mt::select-default-directory-to-open')
    },

    LISTEN_FOR_VIEW(): void {
      window.electron.ipcRenderer.on('mt::show-command-palette', () => {
        bus.emit('show-command-palette')
      })
      window.electron.ipcRenderer.on('mt::toggle-view-mode-entry', (_event, entryName) => {
        if (
          entryName !== 'sourceCode' &&
          entryName !== 'typewriter' &&
          entryName !== 'focus'
        ) return
        this.TOGGLE_VIEW_MODE(entryName)
        const target = this as unknown as Record<string, unknown>
        this.DISPATCH_EDITOR_VIEW_STATE({
          [entryName]: target[entryName] === true
        })
      })
    },

    // Toggle a view option and notify main process to toggle menu item.
    LISTEN_TOGGLE_VIEW(): void {
      bus.on('view:toggle-view-entry', (entryName) => {
        if (
          entryName !== 'sourceCode' &&
          entryName !== 'typewriter' &&
          entryName !== 'focus'
        ) return
        const name = entryName
        this.TOGGLE_VIEW_MODE(name)
        const target = this as unknown as Record<string, unknown>
        this.DISPATCH_EDITOR_VIEW_STATE({ [name]: target[name] === true })
      })
    },

    DISPATCH_EDITOR_VIEW_STATE(viewState: WindowLayoutMenuState): void {
      window.electron.ipcRenderer.send('mt::view-layout-changed', viewState)
    }
  }
})
