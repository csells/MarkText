import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { PresentationPolicy } from 'main_renderer/presentationPolicy'

const mainRoot = path.resolve(__dirname, '../../../src/main')
const policyPath = path.join(mainRoot, 'presentationPolicy.ts')
const exceptionHandlerPath = path.join(mainRoot, 'exceptionHandler.ts')

const makeApplication = () => ({
  setActivationPolicy: vi.fn(),
  dock: { hide: vi.fn() },
  commandLine: { appendSwitch: vi.fn() }
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

describe('presentation policy composition', () => {
  it('uses an injected Electron surface instead of importing Electron in the policy core', async() => {
    const nativeSurface = makeNativeSurface()
    const policy = new PresentationPolicy({
      background: false,
      nativeSurface
    })

    await policy.openExternal('https://example.com')
    await policy.openPath('/tmp/example.md')
    policy.showItemInFolder('/tmp/example.md')
    policy.showErrorBox('Example', 'Details')

    expect(nativeSurface.openExternal).toHaveBeenCalledWith('https://example.com')
    expect(nativeSurface.openPath).toHaveBeenCalledWith('/tmp/example.md')
    expect(nativeSurface.showItemInFolder).toHaveBeenCalledWith('/tmp/example.md')
    expect(nativeSurface.showErrorBox).toHaveBeenCalledWith('Example', 'Details')
  })

  it('keeps background-mode state inside each guard instance', () => {
    const background = new PresentationPolicy({
      background: true,
      nativeSurface: makeNativeSurface()
    })
    const interactive = new PresentationPolicy({
      background: false,
      nativeSurface: makeNativeSurface()
    })

    background.configureApplication(makeApplication())
    interactive.configureApplication(makeApplication())

    expect(background.state).toEqual({
      mode: 'background',
      configured: true,
      derivedWindowCount: 0,
      activationPolicy: 'accessory'
    })
    expect(interactive.state).toEqual({
      mode: 'interactive',
      configured: true,
      derivedWindowCount: 0,
      activationPolicy: null
    })
    expect(Object.keys(globalThis).filter((key) => key.startsWith('__mt_'))).toEqual([])
  })
})

describe('presentation architecture fitness', () => {
  it('keeps the policy core free of Electron, process execution, globals, and error reporting', () => {
    const source = fs.readFileSync(policyPath, 'utf8')

    expect(source).not.toMatch(/from ['"]electron['"]|import\(['"]electron['"]\)/)
    expect(source).not.toMatch(/node:child_process|\bexec\s*\(/)
    expect(source).not.toMatch(/\bglobal(?:This)?\b|__mt_/)
    expect(source).not.toMatch(/captureError|handleError|ErrorDisposition|PresentationError/)
  })

  it('has no production native-stub backdoor or identity factory', () => {
    const source = fs.readFileSync(policyPath, 'utf8')

    expect(source).not.toMatch(/allowNativeStub|revokeNativeStub|_backgroundNativeStubs/)
    expect(source).not.toMatch(/createPresentationPolicy/)
  })

  it('owns capture and presentation of exceptions in the exception subsystem', () => {
    const source = fs.readFileSync(exceptionHandlerPath, 'utf8')

    expect(source).not.toContain('presentationPolicy.handleError')
    expect(source).toMatch(/capture|report/i)
  })
})
