import WindowManager from '../app/windowManager'
import Preference from '../preferences'
import EditorBufferStore from '../editorBufferStore'
import DataCenter from '../dataCenter'
import Keybindings from '../keyboard/shortcutHandler'
import AppMenu from '../menu'
import { loadMenuCommands } from '../menu/actions'
import { CommandManager, loadDefaultCommands } from '../commands'
import type { AppEnvironment } from './env'
import type AppPaths from './paths'
import {
  configureImageAssetProjectRoot,
  configureImageAssetSettings
} from '../imageAssets/imageAssetSettings'
import {
  configureUploaderSettings
} from '../uploader/uploaderSettings'
import {
  configureProjectSearchAuthority
} from '../projectSearch/projectSearchAuthority'
import { WindowType } from '../windows/base'
import type EditorWindow from '../windows/editor'

class Accessor {
  public env: AppEnvironment
  public paths: AppPaths
  public preferences: Preference
  public dataCenter: DataCenter
  public editorBufferStore: EditorBufferStore
  public commandManager: CommandManager
  public keybindings: Keybindings
  public menu: AppMenu
  public windowManager: WindowManager

  /**
   * @param appEnvironment The application environment instance.
   */
  constructor(appEnvironment: AppEnvironment) {
    const userDataPath = appEnvironment.paths.userDataPath

    this.env = appEnvironment
    this.paths = appEnvironment.paths // export paths to make it better accessible

    this.preferences = new Preference(this.paths)
    this.dataCenter = new DataCenter(this.paths)
    this.editorBufferStore = new EditorBufferStore(this.paths)

    this.commandManager = CommandManager
    this._loadCommands()

    this.keybindings = new Keybindings(this.commandManager, appEnvironment)
    this.menu = new AppMenu(this.preferences, this.keybindings, userDataPath)
    this.windowManager = new WindowManager(this.menu, this.preferences, this.editorBufferStore)
    this.editorBufferStore.configureCheckpointAuthority(
      (windowId, intent) => {
        const candidate = this.windowManager.get(windowId)
        if (!candidate || candidate.type !== WindowType.EDITOR) {
          throw new Error(
            'Window UI checkpoint requires a sender-owned editor window'
          )
        }
        return (candidate as EditorWindow)
          .authorizeWindowUiCheckpoint(intent)
      }
    )
    configureImageAssetSettings(() => ({
      configuredFolderPath:
        this.dataCenter.store.get('imageFolderPath') as string,
      relativeDirectoryName:
        this.preferences.getItem<string>('imageRelativeDirectoryName') ||
        'assets',
      relativeDirectoryBase:
        this.preferences.getItem<string>('imageRelativeDirectoryBase') ===
        'folder'
          ? 'project'
          : 'document'
    }))
    configureImageAssetProjectRoot((windowId) => {
      const candidate = this.windowManager.get(windowId) as
        | { readonly openedRootDirectory?: unknown }
        | undefined
      return typeof candidate?.openedRootDirectory === 'string' &&
        candidate.openedRootDirectory.length > 0
        ? candidate.openedRootDirectory
        : null
    })
    configureUploaderSettings(() => ({
      currentUploader: this.dataCenter.store.get('currentUploader'),
      cliScript: this.dataCenter.store.get('cliScript')
    }))
    configureProjectSearchAuthority((windowId) => {
      const candidate = this.windowManager.get(windowId) as
        | { readonly openedRootDirectory?: unknown }
        | undefined
      const root =
        typeof candidate?.openedRootDirectory === 'string' &&
        candidate.openedRootDirectory.length > 0
          ? candidate.openedRootDirectory
          : null
      return {
        root,
        settings: {
          exclusions:
            this.preferences.getItem<string[]>('searchExclusions') || [],
          maxFileSize:
            this.preferences.getItem<string>('searchMaxFileSize') || '',
          includeHidden:
            this.preferences.getItem<boolean>('searchIncludeHidden') === true,
          noIgnore:
            this.preferences.getItem<boolean>('searchNoIgnore') === true
        }
      }
    })
  }

  private _loadCommands(): void {
    const { commandManager } = this
    loadDefaultCommands(commandManager)
    loadMenuCommands(commandManager)

    if (this.env.isDevMode) {
      commandManager.__verifyDefaultCommands()
    }
  }
}

export default Accessor
