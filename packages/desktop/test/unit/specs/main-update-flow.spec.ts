import { beforeEach, describe, expect, it, vi } from 'vitest'

// The auto-update flow must never cost the user their work or their update
// button: a downloaded update runs every window's NORMAL close guard (the
// unsaved-changes save dance) instead of force-quitting over open documents,
// and a transient updater error must not permanently disable "Check for
// Updates" for the rest of the session.

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

const makeWin = () => ({ close: vi.fn(), webContents: { send: vi.fn() } })

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

  it('update-downloaded runs the window close guards instead of force-quitting', async() => {
    const winA = makeWin()
    const winB = makeWin()
    getAllWindows.mockReturnValue([winA, winB])

    fireUpdater('update-downloaded', {})
    await settle()

    // No force quit over open documents — the guarded close runs instead.
    expect(quitAndInstall).not.toHaveBeenCalled()
    expect(winA.close).toHaveBeenCalledTimes(1)
    expect(winB.close).toHaveBeenCalledTimes(1)

    // Once every window has actually closed (saves confirmed), install.
    const allClosed = appHandlers.get('window-all-closed')
    if (!allClosed) throw new Error('window-all-closed handler was not registered')
    allClosed()
    await settle()
    expect(quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('window-all-closed without a pending update never installs', async() => {
    const allClosed = appHandlers.get('window-all-closed')
    if (!allClosed) throw new Error('window-all-closed handler was not registered')
    allClosed()
    await settle()
    expect(quitAndInstall).not.toHaveBeenCalled()
  })
})
