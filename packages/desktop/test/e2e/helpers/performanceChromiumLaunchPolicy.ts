import type { app, BrowserWindow } from 'electron'
import type { ElectronApplication, Page } from 'playwright'

type PerformanceElectronApi = Readonly<{
  app: typeof app
  BrowserWindow: typeof BrowserWindow
}>

export const PERFORMANCE_CHROMIUM_SCHEDULING_POLICY =
  'hidden-unthrottled-rendering-v2' as const

// Deliberately self-contained: Core serializes this into Electron's main
// process, while upstream installs the same source in a paused CommonJS frame.
export function installPerformanceWindowScheduling(
  electron: PerformanceElectronApi
): boolean {
  const { app, BrowserWindow } = electron
  const disableWindowThrottling = (
    window: Electron.BrowserWindow | undefined
  ): boolean => {
    if (window == null || window.isDestroyed?.() === true) return false
    const webContents = window.webContents
    if (
      webContents == null ||
      webContents.isDestroyed?.() === true ||
      typeof webContents.setBackgroundThrottling !== 'function'
    ) return false
    webContents.setBackgroundThrottling(false)
    return true
  }
  for (const window of BrowserWindow.getAllWindows()) {
    disableWindowThrottling(window)
  }
  app.on('browser-window-created', (_event, window) => {
    disableWindowThrottling(window)
  })
  return true
}

export const PERFORMANCE_WINDOW_SCHEDULING_INSTALLER_SOURCE =
  installPerformanceWindowScheduling.toString()

// Hidden measurement windows must keep the same Chromium scheduling policy in
// both implementations. These switches affect background scheduling only; the
// browser-event-to-DOM measurement boundary remains unchanged.
export const PERFORMANCE_CHROMIUM_SCHEDULING_SWITCHES = Object.freeze([
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows'
] as const)

export const withPerformanceChromiumScheduling = (
  applicationArguments: readonly string[]
): readonly string[] => Object.freeze([
  ...PERFORMANCE_CHROMIUM_SCHEDULING_SWITCHES,
  ...applicationArguments
])

export const firstWindowWithPerformanceScheduling = async(
  application: ElectronApplication
): Promise<Page> => {
  const installed = await application.evaluate(
    installPerformanceWindowScheduling
  )
  if (installed !== true) {
    throw new Error('Cannot install performance window scheduling policy')
  }
  return application.firstWindow()
}
