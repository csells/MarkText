import { dialog, Menu, shell, type MessageBoxOptions, type PopupOptions } from 'electron'
import log from 'electron-log'
import { isHiddenE2eWindow } from './windowActivationPolicy'

/** A native dialog a hidden test run asked for, which was answered without showing it. */
export interface HiddenModeDialog {
  readonly method: string
  readonly message: string
}

/** A native menu or shell action a hidden test run asked for, which was not performed. */
export interface HiddenModeCall {
  readonly method: string
  readonly detail: string
}

type HiddenModeGlobal = typeof globalThis & {
  __marktextHiddenDialogs?: HiddenModeDialog[]
  __marktextHiddenMenuPopups?: HiddenModeCall[]
  __marktextHiddenShellCalls?: HiddenModeCall[]
  __marktextRendererGone?: string[]
}

// Kept on the main process's global, where a test reads them through `app.evaluate`.
const hiddenModeGlobal = globalThis as HiddenModeGlobal

/** A renderer that went away in a hidden run, recorded instead of shown. */
export const recordHiddenRendererGone = (reason: string): void => {
  hiddenModeGlobal.__marktextRendererGone ??= []
  hiddenModeGlobal.__marktextRendererGone.push(reason)
}

/** Electron's own cancel choice: the first `cancel` or `no` button, else the first. */
const cancelResponse = (options: MessageBoxOptions): number => {
  if (options.cancelId !== undefined) return options.cancelId
  const index = (options.buttons ?? []).findIndex((label) => /^(cancel|no)$/iu.test(label.replace(/&/gu, '')))
  return index < 0 ? 0 : index
}

const messageBoxOptions = (args: readonly unknown[]): MessageBoxOptions =>
  (args.length > 1 ? args[1] : args[0]) as MessageBoxOptions

/**
 * A hidden test run (`isHiddenE2eWindow`) puts nothing on the user's screen
 * and launches nothing: each native dialog, sheet, context menu and shell
 * action is logged and recorded instead. A dialog is answered as its Cancel,
 * a menu as dismissed, and a shell action as done. A test that needs another
 * answer replaces the method, as the specs' stubs do.
 */
export const installHiddenModeDialogGuard = (): void => {
  if (!isHiddenE2eWindow()) return
  const answer = (method: string, message: string): void => {
    log.warn(`Hidden run did not show ${method}: ${message}`)
    hiddenModeGlobal.__marktextHiddenDialogs ??= []
    hiddenModeGlobal.__marktextHiddenDialogs.push({ method, message })
  }
  const target = dialog as unknown as Record<string, unknown>
  target.showMessageBox = async(...args: unknown[]) => {
    const options = messageBoxOptions(args)
    answer('showMessageBox', options.message)
    return { response: cancelResponse(options), checkboxChecked: false }
  }
  target.showMessageBoxSync = (...args: unknown[]) => {
    const options = messageBoxOptions(args)
    answer('showMessageBoxSync', options.message)
    return cancelResponse(options)
  }
  target.showOpenDialog = async(...args: unknown[]) => {
    answer('showOpenDialog', String((messageBoxOptions(args) as { title?: string }).title ?? ''))
    return { canceled: true, filePaths: [] }
  }
  target.showOpenDialogSync = (...args: unknown[]) => {
    answer('showOpenDialogSync', String((messageBoxOptions(args) as { title?: string }).title ?? ''))
    return undefined
  }
  target.showSaveDialog = async(...args: unknown[]) => {
    answer('showSaveDialog', String((messageBoxOptions(args) as { title?: string }).title ?? ''))
    return { canceled: true, filePath: '' }
  }
  target.showSaveDialogSync = (...args: unknown[]) => {
    answer('showSaveDialogSync', String((messageBoxOptions(args) as { title?: string }).title ?? ''))
    return ''
  }
  target.showErrorBox = (title: string, content: string) => {
    answer('showErrorBox', `${title}: ${content}`)
  }
  target.showCertificateTrustDialog = async() => {
    answer('showCertificateTrustDialog', '')
  }
  const perform = (key: '__marktextHiddenMenuPopups' | '__marktextHiddenShellCalls', method: string, detail: string): void => {
    log.warn(`Hidden run did not perform ${method}: ${detail}`)
    hiddenModeGlobal[key] ??= []
    hiddenModeGlobal[key].push({ method, detail })
  }
  Menu.prototype.popup = function(this: Menu, options?: PopupOptions) {
    perform('__marktextHiddenMenuPopups', 'popup', this.items.map((item) => item.label).filter(Boolean).join(' | '))
    // The menu closes at once, as when dismissed.
    if (options?.callback !== undefined) setImmediate(options.callback)
  }
  Menu.prototype.closePopup = function() {
    perform('__marktextHiddenMenuPopups', 'closePopup', '')
  }
  const shellTarget = shell as unknown as Record<string, unknown>
  shellTarget.openExternal = async(url: string) => {
    perform('__marktextHiddenShellCalls', 'openExternal', url)
  }
  shellTarget.openPath = async(path: string) => {
    perform('__marktextHiddenShellCalls', 'openPath', path)
    return ''
  }
  shellTarget.showItemInFolder = (path: string) => {
    perform('__marktextHiddenShellCalls', 'showItemInFolder', path)
  }
  shellTarget.beep = () => {
    perform('__marktextHiddenShellCalls', 'beep', '')
  }
}
