import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

import {
  captureUpstreamElectronHiddenPage,
  installUpstreamExternalHiddenPolicy,
  upstreamExternalHiddenPolicyExpression,
  upstreamInspectorExceptionMessage,
  type UpstreamInspectorResponse
} from '../../e2e/helpers/upstreamBaselineHiddenPolicy'

describe('upstream baseline external hidden policy', () => {
  it('installs in the paused CommonJS entry context before application launch', async() => {
    const calls: Array<Readonly<{
      readonly method: string
      readonly params: Readonly<Record<string, unknown>>
    }>> = []
    let releaseEntry: (() => void) | undefined
    const entryReady = new Promise<void>(resolve => {
      releaseEntry = resolve
    })
    const send = async(
      method: string,
      params: Readonly<Record<string, unknown>> = {}
    ): Promise<UpstreamInspectorResponse> => {
      calls.push(Object.freeze({ method, params }))
      if (method === 'Runtime.runIfWaitingForDebugger') releaseEntry?.()
      if (method === 'Debugger.evaluateOnCallFrame') {
        return Object.freeze({
          result: Object.freeze({
            result: Object.freeze({ value: true })
          })
        })
      }
      if (method === 'Runtime.evaluate') {
        return Object.freeze({
          result: Object.freeze({
            exceptionDetails: Object.freeze({
              text: 'Uncaught',
              exception: Object.freeze({
                description: 'ReferenceError: require is not defined'
              })
            })
          })
        })
      }
      return Object.freeze({})
    }

    await installUpstreamExternalHiddenPolicy({
      send,
      waitForPaused: async() => {
        await entryReady
        return Object.freeze({
          callFrames: Object.freeze([
            Object.freeze({ callFrameId: 'commonjs-entry' })
          ])
        })
      }
    })

    expect(calls.map(call => call.method)).toEqual([
      'Runtime.enable',
      'Debugger.enable',
      'Runtime.runIfWaitingForDebugger',
      'Debugger.evaluateOnCallFrame',
      'Debugger.resume'
    ])
    expect(calls[3]?.params).toMatchObject({
      callFrameId: 'commonjs-entry',
      returnByValue: true
    })
    expect(calls[3]?.params.expression).toContain("require('electron')")
    expect(calls[3]?.params.expression).toContain('app.setActivationPolicy')
    expect(calls[3]?.params.expression).toContain('accessory')
    expect(calls[3]?.params.expression).toContain(
      'external-inspector-transparent-render-active-v3'
    )
  })

  it('reports the inspector exception description hidden by generic CDP text', () => {
    expect(upstreamInspectorExceptionMessage({
      result: {
        exceptionDetails: {
          text: 'Uncaught',
          exception: {
            description: 'ReferenceError: require is not defined'
          }
        }
      }
    })).toBe('ReferenceError: require is not defined')
  })

  it('captures the exact target through the retained main-process policy', async() => {
    const sends: Array<Readonly<{
      readonly method: string
      readonly params: Readonly<Record<string, unknown>>
    }>> = []
    const channel = {
      send: async(
        method: string,
        params: Readonly<Record<string, unknown>> = {}
      ): Promise<UpstreamInspectorResponse> => {
        sends.push(Object.freeze({ method, params }))
        return Object.freeze({
          result: Object.freeze({
            result: Object.freeze({
              value: Object.freeze({ empty: false })
            })
          })
        })
      },
      waitForPaused: async() => ({ callFrames: [] })
    }

    await expect(captureUpstreamElectronHiddenPage(
      channel,
      'renderer-target-7'
    )).resolves.toEqual({ empty: false })
    expect(sends).toEqual([{
      method: 'Runtime.evaluate',
      params: {
        expression: expect.stringContaining('renderer-target-7'),
        awaitPromise: true,
        returnByValue: true
      }
    }])
  })

  it('installs exact hidden capture for existing target WebContents', async() => {
    const exactContents = {
      isDestroyed: () => false,
      setBackgroundThrottling: () => {},
      capturePage: vi.fn(async(
        rect: unknown,
        options: Readonly<Record<string, boolean>>
      ) => {
        expect(rect).toBeUndefined()
        expect(options).toEqual({ stayHidden: true, stayAwake: true })
        return { isEmpty: () => false }
      })
    }
    const otherContents = { isDestroyed: () => false }
    let visible = false
    let opacity = 1
    let focusable = true
    const exactWindow = {
      webContents: exactContents,
      isDestroyed: () => false,
      setOpacity: (value: number) => { opacity = value },
      setFocusable: (value: boolean) => { focusable = value },
      setIgnoreMouseEvents: () => {},
      setHiddenInMissionControl: () => {},
      setSkipTaskbar: () => {},
      showInactive: () => { visible = true },
      isVisible: () => visible,
      getOpacity: () => opacity,
      isFocused: () => false,
      isFocusable: () => focusable,
      isAlwaysOnTop: () => false,
      getMediaSourceId: () => 'window:81:0',
      getTitle: () => 'sample.md — MarkText',
      getBounds: () => ({ x: 20, y: 30, width: 900, height: 700 })
    }
    const app = Object.assign(new EventEmitter(), {
      isActive: () => false,
      hide: () => {},
      show: () => {},
      isReady: () => false,
      setActivationPolicy: () => {},
      whenReady: async() => {}
    })
    const context = {
      require: () => ({
        app,
        BrowserWindow: {
          getAllWindows: () => [],
          fromWebContents: (contents: unknown) =>
            contents === exactContents ? exactWindow : undefined
        },
        webContents: {
          fromDevToolsTargetId: (targetId: string) =>
            targetId === 'renderer-target-7' ? exactContents : otherContents
        }
      }),
      clearTimeout,
      setImmediate,
      setTimeout
    } as Record<string, unknown>
    expect(runInNewContext(upstreamExternalHiddenPolicyExpression, context))
      .toBe(true)
    const installed = context.__marktextUpstreamHiddenLaunch as Readonly<{
      readonly activate: (targetId: string) => Promise<unknown>
      readonly capturePage: (targetId: string) => Promise<{
        readonly empty: boolean
      }>
    }>

    await expect(installed.capturePage('renderer-target-7'))
      .rejects.toThrow(/transparent render-active inactive state/i)
    expect(exactContents.capturePage).not.toHaveBeenCalled()
    await installed.activate('renderer-target-7')
    await expect(installed.capturePage('renderer-target-7'))
      .resolves.toEqual({ empty: false })
    expect(exactContents.capturePage).toHaveBeenCalledOnce()
  })

  it('exposes exact transparent render-active lifecycle without focus calls', async() => {
    const lifecycle: string[] = []
    let visible = false
    let opacity = 1
    let focusable = true
    class TransparentWindow extends EventEmitter {
      readonly webContents = {
        isDestroyed: (): boolean => false,
        setBackgroundThrottling: (enabled: boolean): void => {
          lifecycle.push(`schedule:${String(enabled)}`)
        }
      }

      isDestroyed(): boolean { return false }
      setOpacity(value: number): void {
        opacity = value
        lifecycle.push(`opacity:${String(value)}`)
      }

      setFocusable(value: boolean): void {
        focusable = value
        lifecycle.push(`focusable:${String(value)}`)
      }

      setIgnoreMouseEvents(value: boolean): void {
        lifecycle.push(`ignore-mouse:${String(value)}`)
      }

      setHiddenInMissionControl(value: boolean): void {
        lifecycle.push(`mission-control:${String(value)}`)
      }

      setSkipTaskbar(value: boolean): void {
        lifecycle.push(`skip-taskbar:${String(value)}`)
      }

      showInactive(): void {
        visible = true
        lifecycle.push('show-inactive')
      }

      hide(): void {
        visible = false
        lifecycle.push('hide')
      }

      close(): void { lifecycle.push('close') }
      focus(): void { throw new Error('Window focus is prohibited') }
      isVisible(): boolean { return visible }
      getOpacity(): number { return opacity }
      isFocused(): boolean { return false }
      isFocusable(): boolean { return focusable }
      isAlwaysOnTop(): boolean { return false }
      getMediaSourceId(): string { return 'window:81:0' }
      getTitle(): string { return 'sample.md — MarkText' }
      getBounds(): Readonly<{ x: number; y: number; width: number; height: number }> {
        return { x: 20, y: 30, width: 900, height: 700 }
      }
    }

    class TransparentApplication extends EventEmitter {
      activationPolicies: string[] = []

      setActivationPolicy(policy: string): void {
        this.activationPolicies.push(policy)
      }

      isActive(): boolean { return false }
      hide(): void { lifecycle.push('app-hide') }
      show(): void { lifecycle.push('app-show') }
      isReady(): boolean { return false }
      whenReady(): Promise<void> { return new Promise(() => {}) }
      focus(): void { throw new Error('Application focus is prohibited') }
    }

    const app = new TransparentApplication()
    const window = new TransparentWindow()
    const context = {
      require: () => ({
        app,
        BrowserWindow: {
          getAllWindows: () => [window],
          fromWebContents: () => window
        },
        webContents: {
          fromDevToolsTargetId: () => window.webContents
        }
      }),
      clearTimeout,
      setImmediate,
      setTimeout
    } as Record<string, unknown>
    expect(runInNewContext(upstreamExternalHiddenPolicyExpression, context))
      .toBe(true)
    const installed = context.__marktextUpstreamHiddenLaunch as Readonly<{
      activate: (targetId: string) => Promise<unknown>
      inspect: (targetId: string) => unknown
      close: (targetId: string) => boolean
    }>

    await expect(installed.activate('renderer-target-7')).resolves.toEqual({
      windowNumber: 81,
      visible: true,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      title: 'sample.md — MarkText',
      bounds: { x: 20, y: 30, width: 900, height: 700 }
    })
    expect(installed.inspect('renderer-target-7')).toEqual({
      windowNumber: 81,
      visible: true,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      title: 'sample.md — MarkText',
      bounds: { x: 20, y: 30, width: 900, height: 700 }
    })
    expect(installed.close('renderer-target-7')).toBe(true)

    expect(app.activationPolicies).toEqual(['accessory'])
    expect(lifecycle.indexOf('opacity:0'))
      .toBeLessThan(lifecycle.indexOf('show-inactive'))
    expect(lifecycle.indexOf('focusable:false'))
      .toBeLessThan(lifecycle.indexOf('show-inactive'))
    expect(lifecycle.indexOf('ignore-mouse:true'))
      .toBeLessThan(lifecycle.indexOf('show-inactive'))
    expect(lifecycle.slice(-7)).toEqual([
      'hide',
      'opacity:1',
      'focusable:true',
      'ignore-mouse:false',
      'mission-control:false',
      'skip-taskbar:false',
      'close'
    ])
  })
})
