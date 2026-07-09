import { autoUpdater } from 'electron-updater'
import { BrowserWindow, Menu, ipcMain } from 'electron'
import { COMMANDS } from '../../commands'
import type { CommandManager } from '../../commands'
import { isOsx } from '../../config'

let runningUpdate = false
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
  installUpdateWhenWindowsClose()
})

// Run every window's NORMAL close guard (mt::ask-for-close → the
// unsaved-changes save dance) instead of force-quitting over the user's open
// documents, then quitAndInstall — but ONLY once the windows that were open at
// download time have all actually closed AND no window remains. Scoping the
// install to THESE windows' 'closed' events (rather than a sticky flag + the
// global 'window-all-closed') means a canceled close, or a window the user
// reopened to keep working, simply never triggers the install: it rides
// electron-updater's autoInstallOnAppQuit on the next real quit instead. A
// later, unrelated window-all-closed can no longer force-quit the app.
function installUpdateWhenWindowsClose(): void {
  const windows = BrowserWindow.getAllWindows()
  if (windows.length === 0) {
    setImmediate(() => autoUpdater.quitAndInstall())
    return
  }

  let pendingClose = windows.length
  const onWindowClosed = (): void => {
    pendingClose -= 1
    if (pendingClose > 0) return
    // Every targeted window closed; install only if the app truly has no
    // window left. A window still open here means the user kept working (a
    // canceled-then-reopened close, or a freshly-opened window) — defer.
    if (BrowserWindow.getAllWindows().length === 0) {
      setImmediate(() => autoUpdater.quitAndInstall())
    }
  }

  for (const openWindow of windows) {
    openWindow.once('closed', onWindowClosed)
    openWindow.close()
  }
}

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
