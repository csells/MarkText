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
  'transparent-render-active-inactive-v3' as const

export interface PerformanceWindowPresentationState {
  readonly windowNumber: number
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
  readonly windowNumber: number | null
  readonly ownerProcessId: number
  readonly bounds: PerformanceWindowPresentationState['bounds'] | null
  readonly title: string | null
  readonly alpha: number | null
  readonly layer: number | null
  readonly onScreen: boolean | null
}

export interface MacWindowServerPresentationDiagnostic {
  readonly reason: 'exact-window-id-count' | 'exact-window-state'
  readonly expected: Readonly<{
    readonly processId: number
    readonly windowNumber: number
    readonly title: string
    readonly bounds: PerformanceWindowPresentationState['bounds']
  }>
  readonly candidateRowCount: number
  readonly exactMatchCount: number
  readonly candidateRows: readonly MacWindowServerPresentationState[]
}

export class MacWindowServerPresentationInvariantError extends Error {
  readonly diagnostic: MacWindowServerPresentationDiagnostic

  constructor(diagnostic: MacWindowServerPresentationDiagnostic) {
    super(
      diagnostic.reason === 'exact-window-id-count'
        ? 'WindowServer presentation invariant failed: expected exactly one ' +
          `matching window ID; diagnostic=${JSON.stringify(diagnostic)}`
        : 'WindowServer presentation invariant failed: exact window state ' +
          `is invalid; diagnostic=${JSON.stringify(diagnostic)}`
    )
    this.name = 'MacWindowServerPresentationInvariantError'
    this.diagnostic = diagnostic
  }
}

const MAC_WINDOW_SERVER_DIAGNOSTIC_TITLE_LIMIT = 160

function boundedMacWindowServerDiagnosticTitle(title: string): string
function boundedMacWindowServerDiagnosticTitle(title: null): null
function boundedMacWindowServerDiagnosticTitle(
  title: string | null
): string | null
function boundedMacWindowServerDiagnosticTitle(
  title: string | null
): string | null {
  if (title == null) return null
  return title.length <= MAC_WINDOW_SERVER_DIAGNOSTIC_TITLE_LIMIT
    ? title
    : `${title.slice(0, MAC_WINDOW_SERVER_DIAGNOSTIC_TITLE_LIMIT - 1)}…`
}

interface PerformanceWindowLifecycleApi {
  readonly activate: (
    targetId: string
  ) => Promise<PerformanceWindowPresentationState>
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
  ): PerformanceWindowPresentationState => {
    const mediaSourceId = window.getMediaSourceId()
    const match = /^window:([1-9][0-9]*):/u.exec(mediaSourceId)
    const windowNumber = Number(match?.[1])
    if (!Number.isSafeInteger(windowNumber) || windowNumber < 1) {
      throw new Error(
        `Measured renderer CGWindow identity is invalid: ${JSON.stringify(mediaSourceId)}`
      )
    }
    return Object.freeze({
      windowNumber,
      visible: window.isVisible(),
      opacity: window.getOpacity(),
      focused: window.isFocused(),
      focusable: window.isFocusable(),
      alwaysOnTop: window.isAlwaysOnTop(),
      appActive: app.isActive(),
      title: window.getTitle(),
      bounds: Object.freeze(window.getBounds())
    })
  }
  const settleTurn = async(): Promise<void> => new Promise(resolve => {
    setImmediate(resolve)
  })
  const deactivateApplication = async(): Promise<void> => {
    if (typeof app.hide !== 'function' || typeof app.show !== 'function') {
      throw new Error('Performance application cannot be deactivated')
    }
    if (app.isActive()) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          app.removeListener('did-resign-active', resigned)
          reject(new Error(
            'Performance application did not emit did-resign-active'
          ))
        }, 5_000)
        const resigned = (): void => {
          clearTimeout(timeout)
          resolve()
        }
        app.once('did-resign-active', resigned)
        app.hide()
      })
    } else {
      app.hide()
    }
    if (app.isActive()) {
      throw new Error('Performance application remained active after hide')
    }
    app.show()
  }
  const lifecycle: PerformanceWindowLifecycleApi = Object.freeze({
    activate: async(targetId: string) => {
      const window = exactWindow(targetId)
      if (!prepareWindow(window) || typeof window.showInactive !== 'function') {
        throw new Error('Measured renderer BrowserWindow cannot be prepared')
      }
      await deactivateApplication()
      window.showInactive()
      await settleTurn()
      const state = inspectWindow(window)
      if (
        !state.visible || state.opacity !== 0 || state.focused ||
        state.focusable || state.alwaysOnTop || state.appActive
      ) {
        throw new Error(
          `Performance window did not settle inactive: ${JSON.stringify(state)}`
        )
      }
      return state
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
    typeof state.windowNumber !== 'number' ||
    !Number.isSafeInteger(state.windowNumber) || state.windowNumber < 1 ||
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
  expectedWindow: Pick<
    PerformanceWindowPresentationState,
    'bounds' | 'title' | 'windowNumber'
  >
): void => {
  const expectedBounds = expectedWindow.bounds
  const matchingWindows = windows.filter(window =>
    window.windowNumber === expectedWindow.windowNumber
  )
  const diagnostic = (
    reason: MacWindowServerPresentationDiagnostic['reason']
  ): MacWindowServerPresentationDiagnostic => {
    const runOwnedWindows = windows
      .filter(window => window.ownerProcessId === expectedProcessId)
    const candidateRows = [
      ...runOwnedWindows.filter(window =>
        window.windowNumber === expectedWindow.windowNumber
      ),
      ...runOwnedWindows.filter(window =>
        window.windowNumber !== expectedWindow.windowNumber
      )
    ]
      .slice(0, 8)
      .map(window => Object.freeze({
        ...window,
        title: boundedMacWindowServerDiagnosticTitle(window.title),
        bounds: window.bounds == null
          ? null
          : Object.freeze({ ...window.bounds })
      }))
    return Object.freeze({
      reason,
      expected: Object.freeze({
        processId: expectedProcessId,
        windowNumber: expectedWindow.windowNumber,
        title: boundedMacWindowServerDiagnosticTitle(expectedWindow.title),
        bounds: Object.freeze({ ...expectedBounds })
      }),
      candidateRowCount: runOwnedWindows.length,
      exactMatchCount: matchingWindows.length,
      candidateRows: Object.freeze(candidateRows)
    })
  }
  if (matchingWindows.length !== 1) {
    throw new MacWindowServerPresentationInvariantError(
      diagnostic('exact-window-id-count')
    )
  }
  const [window] = matchingWindows
  if (window.ownerProcessId !== expectedProcessId) {
    throw new Error(
      `WindowServer presentation invariant failed: ${JSON.stringify(window)}`
    )
  }
  if (
    window.title !== expectedWindow.title ||
    window.bounds == null ||
    window.bounds.x !== expectedBounds.x ||
    window.bounds.y !== expectedBounds.y ||
    window.bounds.width !== expectedBounds.width ||
    window.bounds.height !== expectedBounds.height ||
    window.onScreen !== true || window.alpha !== 0 || window.layer !== 0
  ) {
    throw new MacWindowServerPresentationInvariantError(
      diagnostic('exact-window-state')
    )
  }
}

const MAC_WINDOW_SERVER_PROBE_SOURCE = `
import CoreGraphics
import Foundation

let ownerProcessId = Int32(CommandLine.arguments.last!)!
let rawRows = CGWindowListCopyWindowInfo(
  [.optionAll, .excludeDesktopElements],
  kCGNullWindowID
) as! [[String: Any]]
let rows: [[String: Any]] = rawRows.filter { row in
  row[kCGWindowOwnerPID as String] as? Int == Int(ownerProcessId)
}.map { row in
  let rawBounds = row[kCGWindowBounds as String] as? [String: Any]
  let encodedBounds: Any
  if
    let bounds = rawBounds,
    let x = bounds["X"] as? Double,
    let y = bounds["Y"] as? Double,
    let width = bounds["Width"] as? Double,
    let height = bounds["Height"] as? Double
  {
    encodedBounds = ["x": x, "y": y, "width": width, "height": height]
  } else {
    encodedBounds = NSNull()
  }
  return [
    "windowNumber": (row[kCGWindowNumber as String] as? Int)
      .map { $0 as Any } ?? NSNull(),
    "ownerProcessId": Int(ownerProcessId),
    "title": (row[kCGWindowName as String] as? String)
      .map { $0 as Any } ?? NSNull(),
    "bounds": encodedBounds,
    "alpha": (row[kCGWindowAlpha as String] as? Double)
      .map { $0 as Any } ?? NSNull(),
    "layer": (row[kCGWindowLayer as String] as? Int)
      .map { $0 as Any } ?? NSNull(),
    "onScreen": (row[kCGWindowIsOnscreen as String] as? Bool)
      .map { $0 as Any } ?? NSNull()
  ]
}
let output = try! JSONSerialization.data(withJSONObject: rows)
print(String(data: output, encoding: .utf8)!)
`

export type MacWindowServerProbe = (
  executable: string,
  arguments_: readonly string[]
) => string

const executeMacWindowServerProbe: MacWindowServerProbe = (
  executable,
  arguments_
) => execFileSync(executable, [...arguments_], { encoding: 'utf8' })

export const queryMacWindowServerPresentation = (
  expectedProcessId: number,
  execute: MacWindowServerProbe = executeMacWindowServerProbe
): readonly MacWindowServerPresentationState[] => {
  if (!Number.isSafeInteger(expectedProcessId) || expectedProcessId < 1) {
    throw new Error('WindowServer presentation process identity is invalid')
  }
  const output = execute(
    '/usr/bin/swift',
    ['-e', MAC_WINDOW_SERVER_PROBE_SOURCE, String(expectedProcessId)]
  )
  return JSON.parse(output) as readonly MacWindowServerPresentationState[]
}

export const assertMacWindowServerPresentation = (
  expectedProcessId: number,
  expectedWindow: Pick<
    PerformanceWindowPresentationState,
    'bounds' | 'title' | 'windowNumber'
  >
): void => {
  if (process.platform !== 'darwin') {
    throw new Error('Transparent render-active performance evidence requires macOS')
  }
  const windows = queryMacWindowServerPresentation(expectedProcessId)
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
