import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

import {
  firstWindowWithPerformanceScheduling,
  PERFORMANCE_CHROMIUM_SCHEDULING_POLICY,
  PERFORMANCE_CHROMIUM_SCHEDULING_SWITCHES,
  PERFORMANCE_WINDOW_SCHEDULING_INSTALLER_SOURCE,
  withPerformanceChromiumScheduling
} from '../../e2e/helpers/performanceChromiumLaunchPolicy'

describe('hidden performance Chromium launch policy', () => {
  it('uses one exact anti-throttling policy for external and Playwright launches', () => {
    expect(PERFORMANCE_CHROMIUM_SCHEDULING_POLICY)
      .toBe('hidden-unthrottled-rendering-v2')
    expect(PERFORMANCE_CHROMIUM_SCHEDULING_SWITCHES).toEqual([
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows'
    ])

    const externalArgs = withPerformanceChromiumScheduling([
      '--inspect-brk=5858',
      '--remote-debugging-port=5859',
      'upstream.md'
    ])
    const playwrightElectronArgs = withPerformanceChromiumScheduling([
      '--user-data-dir',
      '/tmp/profile',
      'core.md'
    ])

    expect(externalArgs).toEqual([
      ...PERFORMANCE_CHROMIUM_SCHEDULING_SWITCHES,
      '--inspect-brk=5858',
      '--remote-debugging-port=5859',
      'upstream.md'
    ])
    expect(playwrightElectronArgs).toEqual([
      ...PERFORMANCE_CHROMIUM_SCHEDULING_SWITCHES,
      '--user-data-dir',
      '/tmp/profile',
      'core.md'
    ])
    expect(Object.isFrozen(PERFORMANCE_CHROMIUM_SCHEDULING_SWITCHES)).toBe(true)
    expect(Object.isFrozen(externalArgs)).toBe(true)
    expect(Object.isFrozen(playwrightElectronArgs)).toBe(true)
  })

  it('disables webContents throttling for safe existing and future windows', () => {
    class SchedulingApplication extends EventEmitter {}
    const calls: string[] = []
    const window = (name: string, options: Readonly<{
      readonly destroyed?: boolean
      readonly missingWebContents?: boolean
      readonly destroyedWebContents?: boolean
    }> = {}) => ({
      isDestroyed: () => options.destroyed === true,
      webContents: options.missingWebContents
        ? undefined
        : {
          isDestroyed: () => options.destroyedWebContents === true,
          setBackgroundThrottling: (enabled: boolean) => {
            calls.push(`${name}:${String(enabled)}`)
          }
        }
    })
    const existing = window('existing')
    const app = new SchedulingApplication()
    const BrowserWindow = {
      getAllWindows: () => [
        existing,
        window('destroyed-window', { destroyed: true }),
        window('missing-web-contents', { missingWebContents: true }),
        window('destroyed-web-contents', { destroyedWebContents: true })
      ]
    }

    expect(runInNewContext(
      `(${PERFORMANCE_WINDOW_SCHEDULING_INSTALLER_SOURCE})({ app, BrowserWindow })`,
      { app, BrowserWindow }
    )).toBe(true)
    app.emit('browser-window-created', {}, window('future'))
    app.emit('browser-window-created', {}, window('future-destroyed', {
      destroyedWebContents: true
    }))

    expect(calls).toEqual(['existing:false', 'future:false'])
  })

  it('installs Core main-process scheduling before observing its first window', async() => {
    const order: string[] = []
    const firstWindow = Object.freeze({ kind: 'renderer' })
    const app = new EventEmitter()
    const coreWindow = (name: string) => ({
      isDestroyed: (): boolean => false,
      webContents: {
        isDestroyed: (): boolean => false,
        setBackgroundThrottling: (enabled: boolean): void => {
          order.push(`${name}:${String(enabled)}`)
        }
      }
    })
    const existingWindow = coreWindow('existing-window')
    const application = {
      evaluate: async(
        installer: (electron: Readonly<{
          app: EventEmitter
          BrowserWindow: Readonly<{ getAllWindows: () => unknown[] }>
        }>) => boolean
      ): Promise<boolean> => {
        order.push('scheduling-start')
        const installed = installer({
          app,
          BrowserWindow: { getAllWindows: () => [existingWindow] }
        })
        order.push('scheduling-complete')
        return installed
      },
      firstWindow: async(): Promise<typeof firstWindow> => {
        order.push('first-window')
        return firstWindow
      }
    }

    await expect(firstWindowWithPerformanceScheduling(
      application as unknown as Parameters<
        typeof firstWindowWithPerformanceScheduling
      >[0]
    ))
      .resolves.toBe(firstWindow)
    expect(order).toEqual([
      'scheduling-start',
      'existing-window:false',
      'scheduling-complete',
      'first-window'
    ])
    app.emit('browser-window-created', {}, coreWindow('future-window'))
    expect(order.at(-1)).toBe('future-window:false')
  })
})
