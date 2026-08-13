import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const storeBoundary = vi.hoisted(() => ({
  schema: {} as Record<string, unknown>
}))

vi.mock('electron', () => ({
  app: { getLocale: () => 'en' },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { emit: () => {}, on: () => {} },
  nativeTheme: { shouldUseDarkColors: false }
}))
vi.mock('electron-log', () => ({
  default: { error: vi.fn(), info: vi.fn() }
}))
vi.mock('electron-store', () => ({
  default: class {
    private data: Record<string, unknown> = {}

    constructor(options: { schema: Record<string, unknown> }) {
      storeBoundary.schema = options.schema
    }

    get(key: string): unknown {
      return this.data[key]
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') this.data[key] = value
      else Object.assign(this.data, key)
    }

    delete(key: string): void {
      delete this.data[key]
    }

    get store(): Record<string, unknown> {
      return this.data
    }
  }
}))

import Preference from 'main_renderer/preferences'

const repoRoot = resolve(import.meta.dirname, '../../../../..')
const staticPath = resolve(repoRoot, 'packages/desktop/static')
const defaults = JSON.parse(readFileSync(
  resolve(staticPath, 'preference.json'),
  'utf8'
)) as Record<string, unknown>

const preferenceKeys = [
  'autoCheck',
  'autoGuessEncoding',
  'autoNormalizeLineEndings',
  'autoPairBracket',
  'autoPairMarkdownSyntax',
  'autoPairQuote',
  'autoSave',
  'autoSaveDelay',
  'bulletListMarker',
  'codeBlockLineNumbers',
  'codeFontFamily',
  'codeFontSize',
  'customCss',
  'darkModeTheme',
  'defaultDirectoryToOpen',
  'defaultEncoding',
  'editorFontFamily',
  'editorLineWidth',
  'endOfLine',
  'fileSortBy',
  'fileSortOrder',
  'followSystemTheme',
  'fontSize',
  'footnote',
  'frontmatterType',
  'hideLinkPopup',
  'hideQuickInsertHint',
  'hideScrollbar',
  'imageInsertAction',
  'imagePreferRelativeDirectory',
  'imageRelativeDirectoryBase',
  'imageRelativeDirectoryName',
  'isGitlabCompatibilityEnabled',
  'isHtmlEnabled',
  'language',
  'lastOpenedFolder',
  'lightModeTheme',
  'lineHeight',
  'listIndentation',
  'openedFilesInSidebar',
  'openFilesInNewWindow',
  'openFolderInNewWindow',
  'orderListDelimiter',
  'plantumlServer',
  'preferHeadingStyle',
  'preferLooseListItem',
  'restoreLayoutState',
  'searchExclusions',
  'searchFollowSymlinks',
  'searchIncludeHidden',
  'searchMaxFileSize',
  'searchNoIgnore',
  'sequenceTheme',
  'sideBarVisibility',
  'sourceCodeModeEnabled',
  'spellcheckerEnabled',
  'spellcheckerLanguage',
  'spellcheckerNoUnderline',
  'startUpAction',
  'superSubScript',
  'tabBarVisibility',
  'tabSize',
  'textDirection',
  'theme',
  'titleBarStyle',
  'treePathExcludePatterns',
  'trimTrailingNewline',
  'trimUnnecessaryCodeBlockEmptyLines',
  'watcherUsePolling',
  'wordWrapInToc',
  'wrapCodeBlocks',
  'zoom'
] as const

const previousStatic = global.__static
let preferences: Preference

describe('CriticMarkup Preference production surfaces', () => {
  beforeAll(() => {
    global.__static = staticPath
    preferences = new Preference({ preferencesPath: '/nonexistent/marktext-preferences-test' })
  })

  afterAll(() => {
    global.__static = previousStatic
  })

  it('registers and initializes every production preference surface with exact schema/default coverage', () => {
    const schemaKeys = Object.keys(storeBoundary.schema).sort()
    const expectedSchemaKeys = preferenceKeys
      .filter(key => key !== 'treePathExcludePatterns')
      .sort()

    expect(schemaKeys).toEqual(expectedSchemaKeys)
    expect(
      storeBoundary.schema.treePathExcludePatterns,
      'preference:treePathExcludePatterns is intentionally defaults-only'
    ).toBeUndefined()

    for (const key of preferenceKeys) {
      expect(
        key === 'treePathExcludePatterns' || key in storeBoundary.schema,
        `preference:${key}`
      ).toBe(true)
    }

    const initialized = preferences.getAll() as Record<string, unknown>
    expect(Object.keys(initialized).sort()).toEqual([...preferenceKeys].sort())

    for (const key of preferenceKeys) {
      expect(initialized[key], `preference:${key}`).toEqual(defaults[key])
    }
  })
})
