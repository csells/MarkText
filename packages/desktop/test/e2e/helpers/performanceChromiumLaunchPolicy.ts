import { execFileSync } from 'node:child_process'

import type { app, BrowserWindow, webContents } from 'electron'
import type { ElectronApplication, Page } from 'playwright'

type PerformanceElectronApi = Readonly<{
  app: typeof app
  BrowserWindow: typeof BrowserWindow
  webContents: typeof webContents
}>

export const PERFORMANCE_CHROMIUM_SCHEDULING_POLICY =
  'hidden-unthrottled-rendering-v2' as const

export const PERFORMANCE_WINDOW_PRESENTATION_POLICY =
  'transparent-render-active-inactive-v1' as const

export interface PerformanceWindowPresentationState {
  readonly visible: boolean
  readonly opacity: number
  readonly focused: boolean
  readonly focusable: boolean
  readonly alwaysOnTop: boolean
  readonly appActive: boolean
  readonly title: string
  readonly bounds: Readonly<{
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }>
}

export interface MacWindowServerPresentationState {
  readonly windowNumber: number
  readonly ownerProcessId: number
  readonly bounds: PerformanceWindowPresentationState['bounds']
  readonly title: string
  readonly alpha: number
  readonly layer: number
  readonly onScreen: boolean
}

interface PerformanceWindowLifecycleApi {
  readonly activate: (targetId: string) => PerformanceWindowPresentationState
  readonly inspect: (targetId: string) => PerformanceWindowPresentationState
  readonly close: (targetId: string) => boolean
}

// Deliberately self-contained: Core serializes this into Electron's main
// process, while upstream installs the same source in a paused CommonJS frame.
export function installPerformanceWindowScheduling(
  electron: PerformanceElectronApi
): boolean {
  const { app, BrowserWindow, webContents } = electron
  if (typeof app.setActivationPolicy === 'function') {
    app.setActivationPolicy('accessory')
  }
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
  const prepareWindow = (
    window: Electron.BrowserWindow | undefined
  ): boolean => {
    if (window == null || window.isDestroyed?.() === true) return false
    if (
      typeof window.setOpacity !== 'function' ||
      typeof window.setFocusable !== 'function' ||
      typeof window.setIgnoreMouseEvents !== 'function' ||
      typeof window.setHiddenInMissionControl !== 'function'
    ) return false
    if (!disableWindowThrottling(window)) return false
    window.setOpacity(0)
    window.setFocusable(false)
    window.setIgnoreMouseEvents(true)
    window.setHiddenInMissionControl(true)
    if (typeof window.setSkipTaskbar === 'function') window.setSkipTaskbar(true)
    return true
  }
  const exactWindow = (targetId: string): Electron.BrowserWindow => {
    const contents = webContents.fromDevToolsTargetId(targetId)
    if (contents == null || contents.isDestroyed()) {
      throw new Error('Measured renderer WebContents is unavailable')
    }
    const window = BrowserWindow.fromWebContents(contents)
    if (window == null || window.isDestroyed()) {
      throw new Error('Measured renderer BrowserWindow is unavailable')
    }
    return window
  }
  const inspectWindow = (
    window: Electron.BrowserWindow
  ): PerformanceWindowPresentationState => Object.freeze({
    visible: window.isVisible(),
    opacity: window.getOpacity(),
    focused: window.isFocused(),
    focusable: window.isFocusable(),
    alwaysOnTop: window.isAlwaysOnTop(),
    appActive: app.isActive(),
    title: window.getTitle(),
    bounds: Object.freeze(window.getBounds())
  })
  const lifecycle: PerformanceWindowLifecycleApi = Object.freeze({
    activate: (targetId: string) => {
      const window = exactWindow(targetId)
      if (!prepareWindow(window) || typeof window.showInactive !== 'function') {
        throw new Error('Measured renderer BrowserWindow cannot be prepared')
      }
      window.showInactive()
      return inspectWindow(window)
    },
    inspect: (targetId: string) => inspectWindow(exactWindow(targetId)),
    close: (targetId: string) => {
      const window = exactWindow(targetId)
      window.hide()
      window.setOpacity(1)
      window.setFocusable(true)
      window.setIgnoreMouseEvents(false)
      window.setHiddenInMissionControl(false)
      if (typeof window.setSkipTaskbar === 'function') window.setSkipTaskbar(false)
      window.close()
      return true
    }
  })
  ;(globalThis as typeof globalThis & {
    __marktextPerformanceWindowLifecycle?: PerformanceWindowLifecycleApi
  }).__marktextPerformanceWindowLifecycle = lifecycle
  for (const window of BrowserWindow.getAllWindows()) {
    prepareWindow(window)
  }
  app.on('browser-window-created', (_event, window) => {
    prepareWindow(window)
  })
  return true
}

export const PERFORMANCE_WINDOW_SCHEDULING_INSTALLER_SOURCE =
  installPerformanceWindowScheduling.toString()

export const assertTransparentRenderActiveInactive: (
  value: unknown
) => asserts value is Readonly<PerformanceWindowPresentationState> = (
  value: unknown
): asserts value is Readonly<PerformanceWindowPresentationState> => {
  const state = value as Partial<PerformanceWindowPresentationState> | null
  if (
    state == null || state.visible !== true || state.opacity !== 0 ||
    state.focused !== false || state.focusable !== false ||
    state.alwaysOnTop !== false || state.appActive !== false ||
    typeof state.title !== 'string' ||
    state.bounds == null ||
    !Number.isFinite(state.bounds.x) || !Number.isFinite(state.bounds.y) ||
    !Number.isFinite(state.bounds.width) ||
    !Number.isFinite(state.bounds.height) ||
    state.bounds.width <= 0 || state.bounds.height <= 0
  ) {
    throw new Error(
      `Performance window presentation invariant failed: ${JSON.stringify(value)}`
    )
  }
}

export const assertMacWindowServerTransparentRenderActive = (
  windows: readonly MacWindowServerPresentationState[],
  expectedProcessId: number,
  expectedWindow: Pick<PerformanceWindowPresentationState, 'bounds' | 'title'>
): void => {
  const expectedBounds = expectedWindow.bounds
  const matchingWindows = windows.filter(window =>
    window.ownerProcessId === expectedProcessId &&
    window.title === expectedWindow.title &&
    window.bounds.x === expectedBounds.x &&
    window.bounds.y === expectedBounds.y &&
    window.bounds.width === expectedBounds.width &&
    window.bounds.height === expectedBounds.height
  )
  if (matchingWindows.length !== 1) {
    throw new Error(
      'WindowServer presentation invariant failed: expected exactly one matching window'
    )
  }
  const [window] = matchingWindows
  if (
    !Number.isSafeInteger(window.windowNumber) || window.windowNumber < 1 ||
    window.onScreen !== true || window.alpha !== 0 || window.layer !== 0
  ) {
    throw new Error(
      `WindowServer presentation invariant failed: ${JSON.stringify(window)}`
    )
  }
}

const MAC_WINDOW_SERVER_PROBE_SOURCE = `
import CoreGraphics
import Foundation

let ownerProcessId = Int32(CommandLine.arguments.last!)!
let rawRows = CGWindowListCopyWindowInfo(
  [.optionOnScreenOnly, .excludeDesktopElements],
  kCGNullWindowID
) as! [[String: Any]]
let rows: [[String: Any]] = rawRows.compactMap { row in
  guard
    let rowOwnerProcessId = row[kCGWindowOwnerPID as String] as? Int,
    rowOwnerProcessId == Int(ownerProcessId),
    let windowNumber = row[kCGWindowNumber as String] as? Int,
    let alpha = row[kCGWindowAlpha as String] as? Double,
    let layer = row[kCGWindowLayer as String] as? Int,
    let onScreen = row[kCGWindowIsOnscreen as String] as? Bool,
    let title = row[kCGWindowName as String] as? String,
    let bounds = row[kCGWindowBounds as String] as? [String: Any],
    let x = bounds["X"] as? Double,
    let y = bounds["Y"] as? Double,
    let width = bounds["Width"] as? Double,
    let height = bounds["Height"] as? Double
  else { return nil }
  return [
    "windowNumber": windowNumber,
    "ownerProcessId": rowOwnerProcessId,
    "title": title,
    "bounds": ["x": x, "y": y, "width": width, "height": height],
    "alpha": alpha,
    "layer": layer,
    "onScreen": onScreen
  ]
}
let output = try! JSONSerialization.data(withJSONObject: rows)
print(String(data: output, encoding: .utf8)!)
`

export const assertMacWindowServerPresentation = (
  expectedProcessId: number,
  expectedWindow: Pick<PerformanceWindowPresentationState, 'bounds' | 'title'>
): void => {
  if (process.platform !== 'darwin') {
    throw new Error('Transparent render-active performance evidence requires macOS')
  }
  const output = execFileSync(
    '/usr/bin/swift',
    ['-e', MAC_WINDOW_SERVER_PROBE_SOURCE, String(expectedProcessId)],
    { encoding: 'utf8' }
  )
  const windows = JSON.parse(output) as readonly MacWindowServerPresentationState[]
  assertMacWindowServerTransparentRenderActive(
    windows,
    expectedProcessId,
    expectedWindow
  )
}

const installedPerformanceWindowCommand = async(
  application: ElectronApplication,
  targetId: string,
  command: 'activate' | 'inspect' | 'close'
): Promise<unknown> => application.evaluate(
  (_electron, input) => {
    const lifecycle = (globalThis as typeof globalThis & {
      __marktextPerformanceWindowLifecycle?: PerformanceWindowLifecycleApi
    }).__marktextPerformanceWindowLifecycle
    if (lifecycle === undefined) {
      throw new Error('Performance window lifecycle is not installed')
    }
    return lifecycle[input.command](input.targetId)
  },
  { command, targetId }
)

export const activateInstalledPerformanceWindow = async(
  application: ElectronApplication,
  targetId: string
): Promise<Readonly<PerformanceWindowPresentationState>> => {
  const state = await installedPerformanceWindowCommand(
    application,
    targetId,
    'activate'
  )
  assertTransparentRenderActiveInactive(state)
  return state
}

export const inspectInstalledPerformanceWindow = async(
  application: ElectronApplication,
  targetId: string
): Promise<Readonly<PerformanceWindowPresentationState>> => {
  const state = await installedPerformanceWindowCommand(
    application,
    targetId,
    'inspect'
  )
  assertTransparentRenderActiveInactive(state)
  return state
}

export const closeInstalledPerformanceWindow = async(
  application: ElectronApplication,
  targetId: string
): Promise<void> => {
  const closed = await installedPerformanceWindowCommand(
    application,
    targetId,
    'close'
  )
  if (closed !== true) throw new Error('Performance window lifecycle cleanup failed')
}

// Transparent render-active measurement windows keep one Chromium scheduling policy in
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
