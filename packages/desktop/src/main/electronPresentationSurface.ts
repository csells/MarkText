import * as electron from 'electron'
import type {
  BrowserWindow,
  MessageBoxOptions,
  MessageBoxReturnValue,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
  WebContents,
  WebContentsPrintOptions
} from 'electron'
import { exec, type ChildProcess } from 'node:child_process'

export type { ChildProcess }

export type {
  BrowserWindow,
  MessageBoxOptions,
  MessageBoxReturnValue,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
  WebContents,
  WebContentsPrintOptions
}

export interface ElectronPresentationSurface {
  showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue>
  showMessageBox(window: BrowserWindow, options: MessageBoxOptions): Promise<MessageBoxReturnValue>
  showErrorBox(title: string, content: string): void
  showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue>
  showOpenDialog(window: BrowserWindow, options: OpenDialogOptions): Promise<OpenDialogReturnValue>
  showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogReturnValue>
  showSaveDialog(window: BrowserWindow, options: SaveDialogOptions): Promise<SaveDialogReturnValue>
  captureMacOsScreen(callback: (error: Error | null) => void): ChildProcess
  openExternal(url: string): Promise<void>
  openPath(filePath: string): Promise<string>
  showItemInFolder(filePath: string): void
  printWebContents(
    webContents: Pick<WebContents, 'print'>,
    options: WebContentsPrintOptions,
    callback: (success: boolean, failureReason: string) => void
  ): void
}

export class NativeElectronPresentationSurface implements ElectronPresentationSurface {
  showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue>
  showMessageBox(window: BrowserWindow, options: MessageBoxOptions): Promise<MessageBoxReturnValue>
  showMessageBox(
    windowOrOptions: BrowserWindow | MessageBoxOptions,
    options?: MessageBoxOptions
  ): Promise<MessageBoxReturnValue> {
    return options
      ? electron.dialog.showMessageBox(windowOrOptions as BrowserWindow, options)
      : electron.dialog.showMessageBox(windowOrOptions as MessageBoxOptions)
  }

  showErrorBox(title: string, content: string): void {
    electron.dialog.showErrorBox(title, content)
  }

  showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue>
  showOpenDialog(window: BrowserWindow, options: OpenDialogOptions): Promise<OpenDialogReturnValue>
  showOpenDialog(
    windowOrOptions: BrowserWindow | OpenDialogOptions,
    options?: OpenDialogOptions
  ): Promise<OpenDialogReturnValue> {
    return options
      ? electron.dialog.showOpenDialog(windowOrOptions as BrowserWindow, options)
      : electron.dialog.showOpenDialog(windowOrOptions as OpenDialogOptions)
  }

  showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogReturnValue>
  showSaveDialog(window: BrowserWindow, options: SaveDialogOptions): Promise<SaveDialogReturnValue>
  showSaveDialog(
    windowOrOptions: BrowserWindow | SaveDialogOptions,
    options?: SaveDialogOptions
  ): Promise<SaveDialogReturnValue> {
    return options
      ? electron.dialog.showSaveDialog(windowOrOptions as BrowserWindow, options)
      : electron.dialog.showSaveDialog(windowOrOptions as SaveDialogOptions)
  }

  captureMacOsScreen(callback: (error: Error | null) => void): ChildProcess {
    return exec('screencapture -i -c', callback)
  }

  openExternal(url: string): Promise<void> {
    return electron.shell.openExternal(url)
  }

  openPath(filePath: string): Promise<string> {
    return electron.shell.openPath(filePath)
  }

  showItemInFolder(filePath: string): void {
    electron.shell.showItemInFolder(filePath)
  }

  printWebContents(
    webContents: Pick<WebContents, 'print'>,
    options: WebContentsPrintOptions,
    callback: (success: boolean, failureReason: string) => void
  ): void {
    webContents.print(options, callback)
  }
}
