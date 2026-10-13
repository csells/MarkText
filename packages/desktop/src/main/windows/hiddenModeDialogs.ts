import { dialog, type MessageBoxOptions } from 'electron'
import log from 'electron-log'
import { isHiddenE2eWindow } from './windowActivationPolicy'

/** A native dialog a hidden test run asked for, which was answered without showing it. */
export interface HiddenModeDialog {
  readonly method: string
  readonly message: string
}

type HiddenModeGlobal = typeof globalThis & {
  __marktextHiddenDialogs?: HiddenModeDialog[]
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
 * A hidden test run (`isHiddenE2eWindow`) never shows a native dialog or
 * sheet, which would put a window on the user's screen: each one is logged,
 * recorded and answered as its Cancel. A test that needs another answer
 * replaces the method, as the specs' stubs do.
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
}
