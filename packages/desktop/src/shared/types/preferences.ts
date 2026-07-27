export interface DocumentAppearancePreferences {
  editorFontFamily?: string
  fontSize?: number
  lineHeight?: number
  codeFontSize?: number
  codeFontFamily?: string
  wrapCodeBlocks?: boolean
  editorLineWidth?: string
}

export interface DocumentAuthoringPreferences {
  autoPairBracket?: boolean
  autoPairMarkdownSyntax?: boolean
  autoPairQuote?: boolean
}

export interface DocumentGrammarPreferences {
  subscriptAndSuperscript?: boolean
  footnotes?: boolean
  gitLabMath?: boolean
}

export interface DocumentToolPreferences {
  hideQuickInsertHint?: boolean
  hideLinkPopup?: boolean
  autoCheck?: boolean
  spellcheckerEnabled?: boolean
  spellcheckerNoUnderline?: boolean
}

export interface ReviewPreferences {
  criticMarkupTrackChanges?: boolean
  criticMarkupProjection?: 'marked' | 'original' | 'revised'
}

export interface IUserPreferences
  extends DocumentAppearancePreferences,
  DocumentAuthoringPreferences,
  DocumentGrammarPreferences,
  DocumentToolPreferences {
  autoSave?: boolean
  autoSaveDelay?: number
  titleBarStyle?: 'custom' | 'native'
  openFilesInNewWindow?: boolean
  openFolderInNewWindow?: boolean
  zoom?: number
  hideScrollbar?: boolean
  wordWrapInToc?: boolean
  sidebarColumn?: number
  fileSortBy?: 'created' | 'modified' | 'title'
  fileSortOrder?: 'asc' | 'desc'
  startUpAction?: 'folder' | 'openLastFolder' | 'blank' | 'restoreAll'
  defaultDirectoryToOpen?: string
  language?: string
  textDirection?: 'ltr' | 'rtl'
  theme?: string
  spellcheckerLanguage?: string
  imageInsertAction?: 'upload' | 'folder' | 'path'
  imagePreferRelativePath?: boolean
  imageFolderPath?: string
  screenshotFolderPath?: string
  imageBed?: { selected?: string; [key: string]: unknown }
  imageBedAlias?: { [key: string]: unknown }
  watcher?: { usePolling?: boolean; [key: string]: unknown }
  searchExclusions?: string[]
  searchMaxFileSize?: string
  searchIncludeHidden?: boolean
  searchNoIgnore?: boolean
  followSystemTheme?: boolean
  lightModeTheme?: string
  darkModeTheme?: string
  lastOpenedFolder?: string
  restoreLayoutState?: boolean
  watcherUsePolling?: boolean
  treePathExcludePatterns?: string[]
  customCss?: string
  imagePreferRelativeDirectory?: boolean
  imageRelativeDirectoryBase?: 'file' | 'folder'
  imageRelativeDirectoryName?: string
  sideBarVisibility?: boolean
  tabBarVisibility?: boolean
  sourceCodeModeEnabled?: boolean
  openedFilesInSidebar?: boolean
}

export interface LayoutState {
  rightColumn: 'files' | 'search' | 'toc'
  showSideBar: boolean
  showTabBar: boolean
}

export const PERSISTED_PREFERENCE_KEYS = Object.freeze([
  'autoSave',
  'autoSaveDelay',
  'titleBarStyle',
  'openFilesInNewWindow',
  'openFolderInNewWindow',
  'zoom',
  'hideScrollbar',
  'wordWrapInToc',
  'fileSortBy',
  'fileSortOrder',
  'lastOpenedFolder',
  'treePathExcludePatterns',
  'startUpAction',
  'defaultDirectoryToOpen',
  'language',
  'editorFontFamily',
  'fontSize',
  'lineHeight',
  'wrapCodeBlocks',
  'editorLineWidth',
  'codeFontSize',
  'codeFontFamily',
  'autoPairBracket',
  'autoPairMarkdownSyntax',
  'autoPairQuote',
  'textDirection',
  'hideQuickInsertHint',
  'hideLinkPopup',
  'autoCheck',
  'subscriptAndSuperscript',
  'footnotes',
  'gitLabMath',
  'theme',
  'followSystemTheme',
  'lightModeTheme',
  'restoreLayoutState',
  'darkModeTheme',
  'customCss',
  'spellcheckerEnabled',
  'spellcheckerNoUnderline',
  'spellcheckerLanguage',
  'imageInsertAction',
  'imagePreferRelativeDirectory',
  'imageRelativeDirectoryBase',
  'imageRelativeDirectoryName',
  'sideBarVisibility',
  'tabBarVisibility',
  'sourceCodeModeEnabled',
  'openedFilesInSidebar',
  'searchExclusions',
  'searchMaxFileSize',
  'searchIncludeHidden',
  'searchNoIgnore',
  'watcherUsePolling'
] as const satisfies readonly (keyof IUserPreferences)[])

export type PersistedPreferenceKey =
  (typeof PERSISTED_PREFERENCE_KEYS)[number]

const PERSISTED_PREFERENCE_KEY_SET: ReadonlySet<string> =
  new Set(PERSISTED_PREFERENCE_KEYS)

export const MAIN_ONLY_PREFERENCE_KEYS = Object.freeze([
  'searchExclusions',
  'searchMaxFileSize',
  'searchIncludeHidden',
  'searchNoIgnore'
] as const satisfies readonly (keyof IUserPreferences)[])

export type MainOnlyPreferenceKey =
  (typeof MAIN_ONLY_PREFERENCE_KEYS)[number]

export type RendererPreferences =
  Omit<IUserPreferences, MainOnlyPreferenceKey>

const MAIN_ONLY_PREFERENCE_KEY_SET: ReadonlySet<string> =
  new Set(MAIN_ONLY_PREFERENCE_KEYS)

export function assertPersistedPreferencePatch(
  value: unknown
): Partial<Pick<IUserPreferences, PersistedPreferenceKey>> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new TypeError('Persisted preferences must be an object')
  }
  for (const key of Object.keys(value)) {
    if (!PERSISTED_PREFERENCE_KEY_SET.has(key)) {
      throw new TypeError(`Unknown persisted preference: ${key}`)
    }
  }
  return value as Partial<Pick<IUserPreferences, PersistedPreferenceKey>>
}

export function assertRendererPreferencePatch(
  value: unknown
): Partial<RendererPreferences> {
  const persisted = assertPersistedPreferencePatch(value)
  for (const key of Object.keys(persisted)) {
    if (MAIN_ONLY_PREFERENCE_KEY_SET.has(key)) {
      throw new TypeError(
        `Main-owned preference ${key} cannot be changed by a renderer`
      )
    }
  }
  return persisted as Partial<RendererPreferences>
}

export function rendererPreferencePatch(
  value: Partial<IUserPreferences>
): Partial<RendererPreferences> {
  const renderer = { ...value }
  for (const key of MAIN_ONLY_PREFERENCE_KEYS) {
    delete renderer[key]
  }
  return renderer
}
