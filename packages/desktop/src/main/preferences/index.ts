import fs from 'fs'
import path from 'path'
import Store, { type Schema } from 'electron-store'
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import log from 'electron-log'
import { emitInternalChannel, onInternalChannel } from '../utils/internalIpc'
import { getSupportedLanguages, isLanguageSupported } from 'common/i18n'
import { TypedEmitter } from '@shared/types/typedEmitter'
import {
  assertPersistedPreferencePatch,
  decodeRendererPreferencePatch,
  rendererPreferencePatch,
  type IUserPreferences,
  type PersistedPreferenceKey
} from '@shared/types/preferences'
import { migratePersistedPreferences } from './legacyProfileMigration'
import schema from './schema.json'

const PREFERENCES_FILE_NAME = 'preferences'

// The preference store has no event namespace of its own.
type PreferenceEvents = Record<never, never[]>

// Structural subset of EnvPaths/AppPaths — only `preferencesPath` is read here.
interface AppPaths {
  readonly preferencesPath: string
}

class Preference extends TypedEmitter<PreferenceEvents> {
  public readonly preferencesPath: string
  public readonly hasPreferencesFile: boolean
  public readonly store: Store<IUserPreferences>
  public readonly staticPath: string

  /**
   * @param paths The path instance.
   *
   * NOTE: This throws an exception when validation fails.
   */
  constructor(paths: AppPaths) {
    // TODO: Preferences should not loaded if global.MARKTEXT_SAFE_MODE is set.
    super()

    const { preferencesPath } = paths
    this.preferencesPath = preferencesPath
    this.hasPreferencesFile = fs.existsSync(
      path.join(this.preferencesPath, `./${PREFERENCES_FILE_NAME}.json`)
    )
    this.store = new Store<IUserPreferences>({
      schema: schema as unknown as Schema<IUserPreferences>,
      name: PREFERENCES_FILE_NAME
    })

    this.staticPath = path.join(global.__static, 'preference.json')
    this.init()
  }

  init = (): void => {
    let defaultSettings: Record<string, unknown> | null = null
    try {
      defaultSettings = JSON.parse(fs.readFileSync(this.staticPath, { encoding: 'utf8' }) || '{}')

      // Set best theme on first application start.
      if (nativeTheme.shouldUseDarkColors) {
        defaultSettings!.theme = 'dark'
      }

      // Set system language on first application start
      if (!this.hasPreferencesFile) {
        const systemLanguage = this._getSystemLanguage()
        if (systemLanguage) {
          defaultSettings!.language = systemLanguage
        }
      }
    } catch (err) {
      log.error(err)
    }

    if (!defaultSettings) {
      throw new Error('Can not load static preference.json file')
    }

    // I don't know why `this.store.size` is 3 when first load, so I just check file existed.
    if (!this.hasPreferencesFile) {
      this.store.set(assertPersistedPreferencePatch(defaultSettings))
    } else {
      // The profile may be shared with another MarkText install, so keys this
      // build does not know are that install's user data: renamed settings
      // are carried forward value-preservingly, everything else stays on disk
      // untouched and is filtered at each read instead of deleted.
      const userSetting = this.getAll() as Record<string, unknown>
      const migration = migratePersistedPreferences(userSetting)
      const additions: Record<string, unknown> = { ...migration.renamed }
      for (const key in defaultSettings) {
        if (!(key in userSetting) && !(key in additions)) {
          additions[key] = defaultSettings[key]
        }
      }
      if (Object.keys(additions).length > 0) {
        this.store.set(assertPersistedPreferencePatch(additions))
      }
      if (migration.unknown.length > 0) {
        log.info(
          `Preferences carry ${migration.unknown.length} key(s) from ` +
          'another MarkText install; leaving them untouched: ' +
          migration.unknown.join(', ')
        )
      }
    }

    this._listenForIpcMain()
  }

  getAll(): IUserPreferences {
    return this.store.store as IUserPreferences
  }

  setItem(key: PersistedPreferenceKey, value: unknown): void {
    this.store.set(key, value as never)
    emitInternalChannel('broadcast-preferences-changed', { [key]: value })
  }

  getItem<T = unknown>(key: string): T {
    return this.store.get(key) as T
  }

  /**
   * Change multiple setting entries.
   *
   * @param settings A settings object or subset object with key/value entries.
   */
  setItems(settings: unknown): void {
    const validated = assertPersistedPreferencePatch(settings)
    Object.keys(validated).forEach((key) => {
      const preferenceKey = key as PersistedPreferenceKey
      this.setItem(preferenceKey, validated[preferenceKey])
    })
  }

  exportJSON(): void {
    // todo
  }

  importJSON(): void {
    // todo
  }

  _listenForIpcMain(): void {
    ipcMain.on('mt::ask-for-user-preference', (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (win) {
        win.webContents.send(
          'mt::user-preference',
          rendererPreferencePatch(this.getAll())
        )
      }
    })
    ipcMain.on('mt::set-user-preference', (_e, settings: unknown) => {
      // Untrusted IPC input: a refused patch is logged and dropped. Throwing
      // here is an uncaught exception in main — a process-killing dialog —
      // and a stale renderer or legacy-profile echo has caused exactly that.
      const outcome = decodeRendererPreferencePatch(settings)
      if (outcome.kind === 'rejected') {
        log.error(`Rejected renderer preference patch: ${outcome.reason}`)
        return
      }
      this.setItems(outcome.patch)
    })
    ipcMain.on('mt::cmd-toggle-autosave', () => {
      this.setItem('autoSave', !this.getItem('autoSave'))
    })

    onInternalChannel('set-user-preference', (settings: unknown) => {
      this.setItems(settings)
    })
  }

  /**
   * Gets the system language, or null if it's not in the supported list
   * @returns Supported system language code or null
   */
  _getSystemLanguage(): string | null {
    try {
      // Get the system language
      const systemLocale = app.getLocale()
      log.info(`System locale detected: ${systemLocale}`)

      // Get the list of supported languages
      const supportedLanguages = getSupportedLanguages()

      // Directly match the full language code (e.g. zh-CN)
      if (isLanguageSupported(systemLocale)) {
        log.info(`Using system language: ${systemLocale}`)
        return systemLocale
      }

      // Attempt to match the primary part of the language (e.g. zh)
      const primaryLanguage = systemLocale.split('-')[0]!
      const matchedLanguage = supportedLanguages.find((lang) => lang.startsWith(primaryLanguage))

      if (matchedLanguage) {
        log.info(`Using matched language: ${matchedLanguage} for system locale: ${systemLocale}`)
        return matchedLanguage
      }

      log.info(`System language ${systemLocale} not supported, will use default language`)
      return null
    } catch (error) {
      log.error('Error detecting system language:', error)
      return null
    }
  }
}

export default Preference
