import { beforeEach, describe, expect, it, vi } from 'vitest'

// The auto-update flow must never cost the user their work, their update
// button, OR a running app: a downloaded update runs every window's NORMAL
// close guard (the unsaved-changes save dance) and installs only once the
// windows that were open when the update downloaded have all ACTUALLY closed
// and no window remains. A transient updater error must not permanently
// disable "Check for Updates". And a canceled update-close must never arm a
// force-quit on some later, unrelated window-all-closed.

const { updaterHandlers, appHandlers, quitAndInstall, checkForUpdates, getAllWindows } =
  vi.hoisted(() => ({
    updaterHandlers: new Map<string, (...args: unknown[]) => unknown>(),
    appHandlers: new Map<string, (...args: unknown[]) => unknown>(),
    quitAndInstall: vi.fn(),
    checkForUpdates: vi.fn(),
    getAllWindows: vi.fn(() => [] as unknown[])
  }))

vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: false,
    on: (event: string, listener: (...args: unknown[]) => unknown) => {
      updaterHandlers.set(event, listener)
    },
    quitAndInstall,
    checkForUpdates,
    downloadUpdate: vi.fn()
  }
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(), getAllWindows },
  Menu: { sendActionToFirstResponder: vi.fn() },
  app: {
    on: (event: string, listener: (...args: unknown[]) => unknown) => {
      appHandlers.set(event, listener)
    }
  },
  ipcMain: { on: vi.fn(), emit: vi.fn() }
}))

vi.mock('main_renderer/commands', () => ({ COMMANDS: {} }))
vi.mock('main_renderer/config', () => ({ isOsx: false }))

const { checkUpdates } = await import('main_renderer/menu/actions/marktext')

interface FakeWin {
  close: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  fireClosed: () => void
  webContents: { send: ReturnType<typeof vi.fn> }
}

const makeWin = (): FakeWin => {
  const closedListeners: Array<() => void> = []
  return {
    close: vi.fn(),
    once: vi.fn((event: string, cb: () => void) => {
      if (event === 'closed') closedListeners.push(cb)
    }),
    fireClosed: () => closedListeners.forEach((cb) => cb()),
    webContents: { send: vi.fn() }
  }
}

const fireUpdater = (event: string, ...args: unknown[]): void => {
  const handler = updaterHandlers.get(event)
  if (!handler) throw new Error(`autoUpdater handler for "${event}" was not registered`)
  handler(...args)
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

describe('auto-update flow', () => {
  beforeEach(() => {
    quitAndInstall.mockClear()
    checkForUpdates.mockClear()
    getAllWindows.mockReturnValue([])
  })

  it('an updater error re-enables Check for Updates', async() => {
    const win = makeWin()
    checkUpdates(win as never)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)

    fireUpdater('error', new Error('net::ERR_CONNECTION_RESET'))

    checkUpdates(win as never)
    expect(checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('runs the window close guards, then installs once every open window has actually closed', async() => {
    const winA = makeWin()
    const winB = makeWin()
    getAllWindows.mockReturnValue([winA, winB])

    fireUpdater('update-downloaded', {})
    await settle()

    // No force quit over open documents — the guarded close runs instead.
    expect(quitAndInstall).not.toHaveBeenCalled()
    expect(winA.close).toHaveBeenCalledTimes(1)
    expect(winB.close).toHaveBeenCalledTimes(1)

    // Both windows actually close (saves confirmed) and no window remains.
    getAllWindows.mockReturnValue([])
    winA.fireClosed()
    winB.fireClosed()
    await settle()
    expect(quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('installs immediately when no window is open at update time', async() => {
    getAllWindows.mockReturnValue([])
    fireUpdater('update-downloaded', {})
    await settle()
    expect(quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('a canceled update-close never force-quits on a later, unrelated window-all-closed', async() => {
    const win = makeWin()
    getAllWindows.mockReturnValue([win])

    fireUpdater('update-downloaded', {})
    await settle()
    expect(quitAndInstall).not.toHaveBeenCalled()

    // The user cancels the close and keeps working — the window never fires
    // 'closed'. MUCH later they close all windows in a normal quit unrelated
    // to the update. That must NOT force an install/restart.
    getAllWindows.mockReturnValue([])
    const allClosed = appHandlers.get('window-all-closed')
    if (allClosed) allClosed()
    await settle()

    expect(quitAndInstall).not.toHaveBeenCalled()
  })

  it('does not force-quit if a window remains after the targeted windows close (user reopened work)', async() => {
    const win = makeWin()
    getAllWindows.mockReturnValue([win])
    fireUpdater('update-downloaded', {})
    await settle()

    // The targeted window closes, but a new window is open now (the user kept
    // working) — defer to autoInstallOnAppQuit rather than force-quitting.
    getAllWindows.mockReturnValue([makeWin()])
    win.fireClosed()
    await settle()

    expect(quitAndInstall).not.toHaveBeenCalled()
  })
})
