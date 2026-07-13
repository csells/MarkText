import {
  NativeElectronPresentationSurface,
  type BrowserWindow,
  type ChildProcess,
  type ElectronPresentationSurface,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type SaveDialogOptions,
  type SaveDialogReturnValue,
  type WebContents,
  type WebContentsPrintOptions
} from './electronPresentationSurface'
import {
  BackgroundPresentationGuard,
  type PresentationRuntimeState
} from './backgroundPresentationGuard'

export type { PresentationRuntimeState } from './backgroundPresentationGuard'

interface ApplicationPresentationSurface {
  setActivationPolicy?(policy: 'accessory'): void
  dock?: { hide(): void }
  commandLine: { appendSwitch(name: string): void }
}

interface WindowPresentationSurface {
  isMinimized(): boolean
  restore(): void
  isVisible(): boolean
  show(): void
  focus(): void
  moveTop(): void
}

interface WindowStatePresentationSurface {
  maximize(): void
  unmaximize(): void
  setFullScreen(flag: boolean): void
  setAlwaysOnTop(flag: boolean): void
}

interface PresentationPolicyOptions {
  background: boolean
  nativeSurface: ElectronPresentationSurface
}

export class PresentationPolicy {
  readonly background: boolean
  private readonly guard: BackgroundPresentationGuard
  private readonly nativeSurface: ElectronPresentationSurface

  constructor({ background, nativeSurface }: PresentationPolicyOptions) {
    this.background = background
    this.nativeSurface = nativeSurface
    this.guard = new BackgroundPresentationGuard(background)
  }

  get state(): PresentationRuntimeState {
    return this.guard.state
  }

  configureApplication(app: ApplicationPresentationSurface): void {
    this.guard.configureApplication(app)
  }

  deriveWindowOptions<T extends object>(options: T): T {
    return this.guard.deriveWindowOptions(options)
  }

  bringToFront(win: WindowPresentationSurface): boolean {
    if (!this.guard.allowsPresentation()) return false
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
    win.moveTop()
    return true
  }

  activateExistingWindow(
    win: Pick<WindowPresentationSurface, 'focus' | 'moveTop'>,
    strategy: 'focus' | 'move-top'
  ): boolean {
    if (!this.guard.allowsPresentation()) return false
    if (strategy === 'focus') win.focus()
    else win.moveTop()
    return true
  }

  setWindowMaximized(
    win: Pick<WindowStatePresentationSurface, 'maximize' | 'unmaximize'>,
    flag: boolean
  ): boolean {
    if (!this.guard.allowsPresentation()) return false
    if (flag) win.maximize()
    else win.unmaximize()
    return true
  }

  setWindowFullScreen(
    win: Pick<WindowStatePresentationSurface, 'setFullScreen'>,
    flag: boolean
  ): boolean {
    if (!this.guard.allowsPresentation()) return false
    win.setFullScreen(flag)
    return true
  }

  setWindowAlwaysOnTop(
    win: Pick<WindowStatePresentationSurface, 'setAlwaysOnTop'>,
    flag: boolean
  ): boolean {
    if (!this.guard.allowsPresentation()) return false
    win.setAlwaysOnTop(flag)
    return true
  }

  runInteractiveNative<T>(name: string, operation: () => T): T {
    if (!this.guard.allowsPresentation()) {
      throw new Error(`Cannot present ${name} while MarkText is running in background mode.`)
    }
    return operation()
  }

  popupMenu<T>(menu: { popup(options: T): void }, options: T): void {
    this.runInteractiveNative('menu.popup', () => menu.popup(options))
  }

  showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue>
  showMessageBox(window: BrowserWindow, options: MessageBoxOptions): Promise<MessageBoxReturnValue>
  showMessageBox(
    windowOrOptions: BrowserWindow | MessageBoxOptions,
    options?: MessageBoxOptions
  ): Promise<MessageBoxReturnValue> {
    return this.runInteractiveNative('dialog.showMessageBox', () => options
      ? this.nativeSurface.showMessageBox(windowOrOptions as BrowserWindow, options)
      : this.nativeSurface.showMessageBox(windowOrOptions as MessageBoxOptions))
  }

  showErrorBox(title: string, content: string): void {
    this.runInteractiveNative('dialog.showErrorBox', () =>
      this.nativeSurface.showErrorBox(title, content))
  }

  showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue>
  showOpenDialog(window: BrowserWindow, options: OpenDialogOptions): Promise<OpenDialogReturnValue>
  showOpenDialog(
    windowOrOptions: BrowserWindow | OpenDialogOptions,
    options?: OpenDialogOptions
  ): Promise<OpenDialogReturnValue> {
    return this.runInteractiveNative('dialog.showOpenDialog', () => options
      ? this.nativeSurface.showOpenDialog(windowOrOptions as BrowserWindow, options)
      : this.nativeSurface.showOpenDialog(windowOrOptions as OpenDialogOptions))
  }

  showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogReturnValue>
  showSaveDialog(window: BrowserWindow, options: SaveDialogOptions): Promise<SaveDialogReturnValue>
  showSaveDialog(
    windowOrOptions: BrowserWindow | SaveDialogOptions,
    options?: SaveDialogOptions
  ): Promise<SaveDialogReturnValue> {
    return this.runInteractiveNative('dialog.showSaveDialog', () => options
      ? this.nativeSurface.showSaveDialog(windowOrOptions as BrowserWindow, options)
      : this.nativeSurface.showSaveDialog(windowOrOptions as SaveDialogOptions))
  }

  captureMacOsScreen(callback: (error: Error | null) => void): ChildProcess {
    return this.runInteractiveNative('screen-capture', () =>
      this.nativeSurface.captureMacOsScreen(callback))
  }

  openExternal(url: string): Promise<void> {
    return this.runInteractiveNative('shell.openExternal', () =>
      this.nativeSurface.openExternal(url))
  }

  openPath(filePath: string): Promise<string> {
    return this.runInteractiveNative('shell.openPath', () =>
      this.nativeSurface.openPath(filePath))
  }

  showItemInFolder(filePath: string): void {
    this.runInteractiveNative('shell.showItemInFolder', () =>
      this.nativeSurface.showItemInFolder(filePath))
  }

  printWebContents(
    webContents: Pick<WebContents, 'print'>,
    options: WebContentsPrintOptions,
    callback: (success: boolean, failureReason: string) => void
  ): void {
    this.runInteractiveNative('webContents.print', () =>
      this.nativeSurface.printWebContents(webContents, options, callback))
  }
}

export const presentationPolicy = new PresentationPolicy({
  background: process.env.MARKTEXT_TEST_BACKGROUND !== undefined &&
    process.env.MARKTEXT_TEST_BACKGROUND !== '0',
  nativeSurface: new NativeElectronPresentationSurface()
})
