import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

import {
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
    expect(calls[3]?.params.expression).toContain(
      "app.setActivationPolicy('accessory')"
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

  it('conceals window and application activation without focus reentrancy', async() => {
    class HiddenWindow extends EventEmitter {
      skipTaskbarCalls = 0
      hideCalls = 0
      blurCalls = 0

      isDestroyed(): boolean { return false }
      setSkipTaskbar(): void { this.skipTaskbarCalls += 1 }
      hide(): void { this.hideCalls += 1 }
      blur(): void { this.blurCalls += 1 }
    }

    class HiddenApplication extends EventEmitter {
      activationPolicies: string[] = []
      hideCalls = 0
      dockHideCalls = 0
      readonly dock = { hide: (): void => { this.dockHideCalls += 1 } }

      setActivationPolicy(policy: string): void {
        this.activationPolicies.push(policy)
      }

      hide(): void {
        this.hideCalls += 1
        this.emit('activate')
      }

      isReady(): boolean { return true }
      async whenReady(): Promise<void> {}
    }

    const app = new HiddenApplication()
    const window = new HiddenWindow()
    expect(runInNewContext(upstreamExternalHiddenPolicyExpression, {
      require: () => ({
        app,
        BrowserWindow: { getAllWindows: () => [window] }
      })
    })).toBe(true)
    await Promise.resolve()

    app.emit('browser-window-created', {}, window)
    window.emit('show')
    window.emit('focus')
    app.emit('browser-window-focus', {}, window)
    app.emit('activate')

    expect(app.activationPolicies).toEqual(['accessory'])
    expect(app.hideCalls).toBe(6)
    expect(app.dockHideCalls).toBe(6)
    expect(window.skipTaskbarCalls).toBe(1)
    expect(window.hideCalls).toBe(6)
    expect(window.blurCalls).toBe(6)
  })
})
