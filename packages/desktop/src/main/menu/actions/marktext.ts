import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import { COMMANDS } from '../../commands'
import type { CommandManager } from '../../commands'
import { isOsx } from '../../config'

let runningUpdate = false
// Set when a downloaded update is waiting for the windows to finish their
// guarded close (the unsaved-changes save dance); the install runs only once
// the last window is actually gone.
let updatePendingInstall = false
let win: BrowserWindow | null = null

autoUpdater.autoDownload = false

autoUpdater.on('error', (error: Error) => {
  if (win) {
    // Preserve the JS behavior: it tolerated `null` here; the typed event
    // shape doesn't, but the same defensive code below stays in place.
    const err = error as Error | null
    win.webContents.send(
      'mt::UPDATE_ERROR',
      err === null ? 'Error: unknown' : (err.message || err).toString()
    )
  }
  // A transient failure (offline, server hiccup) must not permanently
  // disable "Check for Updates" for the rest of the session.
  runningUpdate = false
})

autoUpdater.on('update-available', (_info) => {
  if (win) {
    win.webContents.send(
      'mt::UPDATE_AVAILABLE',
      'Found an update, do you want download and install now?'
    )
  }
  runningUpdate = false
})

autoUpdater.on('update-not-available', (_info) => {
  if (win) {
    win.webContents.send('mt::UPDATE_NOT_AVAILABLE', 'Current version is up-to-date.')
  }
  runningUpdate = false
})

autoUpdater.on('update-downloaded', (_event) => {
  if (win) {
    win.webContents.send(
      'mt::UPDATE_DOWNLOADED',
      'Update downloaded, application will be quit for update...'
    )
  }
  // Run every window's NORMAL close guard (mt::ask-for-close → the
  // unsaved-changes save dance) instead of force-quitting over the user's
  // open documents. The install fires from 'window-all-closed' once the last
  // window is really gone; if the user cancels a close, the update simply
  // installs on the next regular quit (electron-updater's
  // autoInstallOnAppQuit default).
  updatePendingInstall = true
  for (const openWindow of BrowserWindow.getAllWindows()) {
    openWindow.close()
  }
})

app.on('window-all-closed', () => {
  if (updatePendingInstall) {
    updatePendingInstall = false
    setImmediate(() => autoUpdater.quitAndInstall())
  }
})

ipcMain.on('mt::NEED_UPDATE', (_e, { needUpdate }: { needUpdate: boolean }) => {
  if (needUpdate) {
    autoUpdater.downloadUpdate()
  } else {
    runningUpdate = false
  }
})

ipcMain.on('mt::check-for-update', (e) => {
  const senderWin = BrowserWindow.fromWebContents(e.sender)
  checkUpdates(senderWin)
})

// --------------------------------------------------------

export const userSetting = (): void => {
  ipcMain.emit('app-create-settings-window')
}

export const checkUpdates = (browserWindow: BrowserWindow | null): void => {
  if (!runningUpdate) {
    runningUpdate = true
    win = browserWindow
    autoUpdater.checkForUpdates()
  }
}

export const osxHide = (): void => {
  if (isOsx) {
    Menu.sendActionToFirstResponder('hide:')
  }
}

export const osxHideAll = (): void => {
  if (isOsx) {
    Menu.sendActionToFirstResponder('hideOtherApplications:')
  }
}

export const osxShowAll = (): void => {
  if (isOsx) {
    Menu.sendActionToFirstResponder('unhideAllApplications:')
  }
}

// --- Commands -------------------------------------------------------------

export const loadMarktextCommands = (commandManager: CommandManager): void => {
  commandManager.add(COMMANDS.MT_HIDE, osxHide)
  commandManager.add(COMMANDS.MT_HIDE_OTHERS, osxHideAll)
}
