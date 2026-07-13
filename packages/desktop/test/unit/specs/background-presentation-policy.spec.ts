import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  dialog: {
    showMessageBox: vi.fn(),
    showErrorBox: vi.fn(),
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
    showItemInFolder: vi.fn()
  }
}))

import { PresentationPolicy } from 'main_renderer/presentationPolicy'

const makeApp = () => ({
  setActivationPolicy: vi.fn(),
  dock: { hide: vi.fn() },
  commandLine: { appendSwitch: vi.fn() }
})

const makeWindow = () => ({
  isMinimized: vi.fn(() => true),
  restore: vi.fn(),
  isVisible: vi.fn(() => false),
  show: vi.fn(),
  focus: vi.fn(),
  moveTop: vi.fn(),
  maximize: vi.fn(),
  unmaximize: vi.fn(),
  setFullScreen: vi.fn(),
  setAlwaysOnTop: vi.fn()
})

const makeNativeSurface = () => ({
  showMessageBox: vi.fn(),
  showErrorBox: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  captureMacOsScreen: vi.fn(),
  openExternal: vi.fn(() => Promise.resolve()),
  openPath: vi.fn(() => Promise.resolve('')),
  showItemInFolder: vi.fn(),
  printWebContents: vi.fn()
})

const makePolicy = (background: boolean): PresentationPolicy =>
  new PresentationPolicy({ background, nativeSurface: makeNativeSurface() })

const mainRoot = path.resolve(__dirname, '../../../src/main')
const policyPath = path.join(mainRoot, 'presentationPolicy.ts')
const electronSurfacePath = path.join(mainRoot, 'electronPresentationSurface.ts')

const sourceFiles = (directory: string): string[] => fs.readdirSync(directory, {
  withFileTypes: true
}).flatMap((entry) => {
  const fullPath = path.join(directory, entry.name)
  if (entry.isDirectory()) return sourceFiles(fullPath)
  return entry.name.endsWith('.ts') ? [fullPath] : []
})

describe('central background presentation policy', () => {
  it('configures a non-activating application exactly once in background mode', () => {
    const app = makeApp()
    const policy = makePolicy(true)

    policy.configureApplication(app)

    expect(app.setActivationPolicy).toHaveBeenCalledWith('accessory')
    expect(policy.state.activationPolicy).toBe('accessory')
    expect(app.dock.hide).toHaveBeenCalledTimes(1)
    expect(app.commandLine.appendSwitch.mock.calls).toEqual([
      ['disable-renderer-backgrounding'],
      ['disable-background-timer-throttling'],
      ['disable-backgrounding-occluded-windows']
    ])
  })

  it('derives hidden, unthrottled editor and settings options without mutating inputs', () => {
    const policy = makePolicy(true)
    const editor = { show: true, webPreferences: { spellcheck: true } }
    const settings = { show: true, webPreferences: { sandbox: true } }

    expect(policy.deriveWindowOptions(editor)).toEqual({
      show: false,
      webPreferences: { spellcheck: true, backgroundThrottling: false }
    })
    expect(policy.deriveWindowOptions(settings)).toEqual({
      show: false,
      webPreferences: { sandbox: true, backgroundThrottling: false }
    })
    expect(editor).toEqual({ show: true, webPreferences: { spellcheck: true } })
    expect(settings).toEqual({ show: true, webPreferences: { sandbox: true } })
  })

  it('owns every window show/focus decision', () => {
    const backgroundWindow = makeWindow()
    const background = makePolicy(true)
    expect(background.bringToFront(backgroundWindow)).toBe(false)
    expect(backgroundWindow.restore).not.toHaveBeenCalled()
    expect(backgroundWindow.show).not.toHaveBeenCalled()
    expect(backgroundWindow.focus).not.toHaveBeenCalled()
    expect(backgroundWindow.moveTop).not.toHaveBeenCalled()

    const interactiveWindow = makeWindow()
    const interactive = makePolicy(false)
    expect(interactive.bringToFront(interactiveWindow)).toBe(true)
    expect(interactiveWindow.restore).toHaveBeenCalledTimes(1)
    expect(interactiveWindow.show).toHaveBeenCalledTimes(1)
    expect(interactiveWindow.focus).toHaveBeenCalledTimes(1)
    expect(interactiveWindow.moveTop).toHaveBeenCalledTimes(1)
  })

  it('blocks every window-state transition that can present a hidden test window', () => {
    type WindowStatePolicy = {
      setWindowMaximized(window: ReturnType<typeof makeWindow>, flag: boolean): boolean
      setWindowFullScreen(window: ReturnType<typeof makeWindow>, flag: boolean): boolean
      setWindowAlwaysOnTop(window: ReturnType<typeof makeWindow>, flag: boolean): boolean
    }
    const backgroundWindow = makeWindow()
    const background = makePolicy(true) as WindowStatePolicy

    expect(background.setWindowMaximized(backgroundWindow, true)).toBe(false)
    expect(background.setWindowFullScreen(backgroundWindow, true)).toBe(false)
    expect(background.setWindowAlwaysOnTop(backgroundWindow, true)).toBe(false)
    expect(backgroundWindow.maximize).not.toHaveBeenCalled()
    expect(backgroundWindow.unmaximize).not.toHaveBeenCalled()
    expect(backgroundWindow.setFullScreen).not.toHaveBeenCalled()
    expect(backgroundWindow.setAlwaysOnTop).not.toHaveBeenCalled()

    const interactiveWindow = makeWindow()
    const interactive = makePolicy(false) as WindowStatePolicy
    expect(interactive.setWindowMaximized(interactiveWindow, true)).toBe(true)
    expect(interactive.setWindowMaximized(interactiveWindow, false)).toBe(true)
    expect(interactive.setWindowFullScreen(interactiveWindow, true)).toBe(true)
    expect(interactive.setWindowAlwaysOnTop(interactiveWindow, true)).toBe(true)
    expect(interactiveWindow.maximize).toHaveBeenCalledTimes(1)
    expect(interactiveWindow.unmaximize).toHaveBeenCalledTimes(1)
    expect(interactiveWindow.setFullScreen).toHaveBeenCalledWith(true)
    expect(interactiveWindow.setAlwaysOnTop).toHaveBeenCalledWith(true)
  })

  it('blocks native interactive UI such as dialogs and screen capture in background mode', () => {
    const operation = vi.fn(() => 7)
    const background = makePolicy(true)
    expect(() => background.runInteractiveNative('screen-capture', operation))
      .toThrow(/screen-capture.*background/i)
    expect(operation).not.toHaveBeenCalled()

    const interactive = makePolicy(false)
    expect(interactive.runInteractiveNative('screen-capture', operation)).toBe(7)
    expect(operation).toHaveBeenCalledTimes(1)
  })
})

describe('background presentation architecture fitness', () => {
  it('keeps the mode/environment decision in the policy owner only', () => {
    const offenders = sourceFiles(mainRoot)
      .filter((file) => file !== policyPath && file !== electronSurfacePath)
      .filter((file) => /MARKTEXT_TEST_BACKGROUND|isBackgroundTestMode/.test(
        fs.readFileSync(file, 'utf8')
      ))
      .map((file) => path.relative(mainRoot, file))

    expect(offenders).toEqual([])
  })

  it('routes direct native presentation through the policy owner', () => {
    const directPresentation = new RegExp(
      '(?:\\bdialog\\s*\\.\\s*(?:showMessageBox|showErrorBox|showOpenDialog|' +
      'showSaveDialog)\\s*\\(|\\bshell\\s*\\.\\s*(?:openExternal|openPath|' +
      'showItemInFolder)\\s*\\(|\\.\\s*(?:show|focus|moveTop|popup|print)\\s*\\(|' +
      '\\.\\s*(?:showInactive|maximize|unmaximize|setFullScreen|setAlwaysOnTop)\\s*\\(|' +
      '\\bexec\\s*\\(\\s*[\'"]screencapture)'
    )
    const offenders = sourceFiles(mainRoot)
      .filter((file) => file !== policyPath && file !== electronSurfacePath)
      .filter((file) => directPresentation.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(mainRoot, file))

    expect(offenders).toEqual([])
  })

  it('has no never-settling exception-handler path', () => {
    const exceptionHandler = fs.readFileSync(
      path.join(mainRoot, 'exceptionHandler.ts'),
      'utf8'
    )
    expect(exceptionHandler).not.toMatch(/new Promise\s*\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/)
    expect(exceptionHandler).toContain('exceptionReporter.handle')
  })
})
