import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

import {
  activateInstalledPerformanceWindow,
  assertMacWindowServerTransparentRenderActive,
  assertTransparentRenderActiveInactive,
  closeInstalledPerformanceWindow,
  firstWindowWithPerformanceScheduling,
  PERFORMANCE_CHROMIUM_SCHEDULING_POLICY,
  PERFORMANCE_CHROMIUM_SCHEDULING_SWITCHES,
  PERFORMANCE_WINDOW_PRESENTATION_POLICY,
  PERFORMANCE_WINDOW_SCHEDULING_INSTALLER_SOURCE,
  inspectInstalledPerformanceWindow,
  withPerformanceChromiumScheduling
} from '../../e2e/helpers/performanceChromiumLaunchPolicy'

describe('hidden performance Chromium launch policy', () => {
  it('deactivates, restores, and settles the exact transparent window without focus', async() => {
    const calls: string[] = []
    let active = true
    const exactContents = {
      isDestroyed: () => false,
      setBackgroundThrottling: (enabled: boolean) => {
        calls.push(`schedule:${String(enabled)}`)
      }
    }
    const exactWindow = {
      webContents: exactContents,
      isDestroyed: () => false,
      setOpacity: (opacity: number) => calls.push(`opacity:${String(opacity)}`),
      setFocusable: (focusable: boolean) =>
        calls.push(`focusable:${String(focusable)}`),
      setIgnoreMouseEvents: (ignored: boolean) =>
        calls.push(`ignore-mouse:${String(ignored)}`),
      setHiddenInMissionControl: (hidden: boolean) =>
        calls.push(`mission-control:${String(hidden)}`),
      setSkipTaskbar: (skip: boolean) => calls.push(`skip-taskbar:${String(skip)}`),
      showInactive: () => calls.push('show-inactive'),
      focus: () => { throw new Error('Window focus is prohibited') },
      isVisible: () => true,
      getOpacity: () => 0,
      isFocused: () => false,
      isFocusable: () => false,
      isAlwaysOnTop: () => false,
      getTitle: () => 'sample.md — MarkText',
      getBounds: () => ({ x: 20, y: 30, width: 900, height: 700 })
    }
    const app = Object.assign(new EventEmitter(), {
      isActive: () => active,
      setActivationPolicy: (policy: string) => calls.push(`policy:${policy}`),
      hide: () => {
        calls.push('app-hide')
        queueMicrotask(() => {
          active = false
          app.emit('did-resign-active')
        })
      },
      show: () => calls.push('app-show'),
      focus: () => { throw new Error('Application focus is prohibited') }
    })
    const context = {
      app,
      BrowserWindow: {
        getAllWindows: () => [],
        fromWebContents: (contents: unknown) =>
          contents === exactContents ? exactWindow : undefined
      },
      webContents: {
        fromDevToolsTargetId: (targetId: string) =>
          targetId === 'renderer-target-7' ? exactContents : undefined
      },
      clearTimeout,
      setImmediate,
      setTimeout
    } as Record<string, unknown>

    expect(runInNewContext(
      `(${PERFORMANCE_WINDOW_SCHEDULING_INSTALLER_SOURCE})({ app, BrowserWindow, webContents })`,
      context
    )).toBe(true)
    const lifecycle = context.__marktextPerformanceWindowLifecycle as Readonly<{
      readonly activate: (targetId: string) => Promise<unknown>
    }>
    const state = await lifecycle.activate('renderer-target-7')

    expect(PERFORMANCE_WINDOW_PRESENTATION_POLICY)
      .toBe('transparent-render-active-inactive-v2')
    expect(calls).toEqual([
      'policy:accessory',
      'schedule:false',
      'opacity:0',
      'focusable:false',
      'ignore-mouse:true',
      'mission-control:true',
      'skip-taskbar:true',
      'app-hide',
      'app-show',
      'show-inactive'
    ])
    expect(() => assertTransparentRenderActiveInactive(state))
      .not.toThrow()
  })

  it('checks and closes the same exact installed renderer lifecycle', async() => {
    const calls: string[] = []
    const state = Object.freeze({
      visible: true,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      title: 'sample.md — MarkText',
      bounds: Object.freeze({ x: 20, y: 30, width: 900, height: 700 })
    })
    const application = {
      evaluate: async(
        evaluator: (electron: unknown, input: unknown) => unknown,
        input: unknown
      ) => {
        const scope = globalThis as typeof globalThis & {
          __marktextPerformanceWindowLifecycle?: Readonly<{
            activate: (targetId: string) => typeof state
            inspect: (targetId: string) => typeof state
            close: (targetId: string) => boolean
          }>
        }
        scope.__marktextPerformanceWindowLifecycle = Object.freeze({
          activate: targetId => {
            calls.push(`activate:${targetId}`)
            return state
          },
          inspect: targetId => {
            calls.push(`inspect:${targetId}`)
            return state
          },
          close: targetId => {
            calls.push(`close:${targetId}`)
            return true
          }
        })
        try {
          return await evaluator({}, input)
        } finally {
          delete scope.__marktextPerformanceWindowLifecycle
        }
      }
    }

    await expect(activateInstalledPerformanceWindow(
      application as never,
      'renderer-target-7'
    )).resolves.toEqual(state)
    await expect(inspectInstalledPerformanceWindow(
      application as never,
      'renderer-target-7'
    )).resolves.toEqual(state)
    await expect(closeInstalledPerformanceWindow(
      application as never,
      'renderer-target-7'
    )).resolves.toBeUndefined()
    expect(calls).toEqual([
      'activate:renderer-target-7',
      'inspect:renderer-target-7',
      'close:renderer-target-7'
    ])
  })

  it('fails closed when an active app never resigns before presentation', async() => {
    const calls: string[] = []
    const contents = {
      isDestroyed: () => false,
      setBackgroundThrottling: () => undefined
    }
    const window = {
      webContents: contents,
      isDestroyed: () => false,
      setOpacity: () => undefined,
      setFocusable: () => undefined,
      setIgnoreMouseEvents: () => undefined,
      setHiddenInMissionControl: () => undefined,
      showInactive: () => calls.push('show-inactive')
    }
    const app = Object.assign(new EventEmitter(), {
      isActive: () => true,
      hide: () => calls.push('app-hide'),
      show: () => calls.push('app-show')
    })
    const context = {
      app,
      BrowserWindow: {
        getAllWindows: () => [],
        fromWebContents: () => window
      },
      webContents: { fromDevToolsTargetId: () => contents },
      clearTimeout: () => undefined,
      setImmediate,
      setTimeout: (callback: () => void) => {
        queueMicrotask(callback)
        return 1
      }
    } as Record<string, unknown>
    runInNewContext(
      `(${PERFORMANCE_WINDOW_SCHEDULING_INSTALLER_SOURCE})({ app, BrowserWindow, webContents })`,
      context
    )
    const lifecycle = context.__marktextPerformanceWindowLifecycle as Readonly<{
      readonly activate: (targetId: string) => Promise<unknown>
    }>

    await expect(lifecycle.activate('renderer-target-7'))
      .rejects.toThrow(/did-resign-active/i)
    expect(calls).toEqual(['app-hide'])
  })

  it('rejects restoration that reactivates the app after a real resign', async() => {
    const calls: string[] = []
    let active = true
    const contents = {
      isDestroyed: () => false,
      setBackgroundThrottling: () => undefined
    }
    const window = {
      webContents: contents,
      isDestroyed: () => false,
      setOpacity: () => undefined,
      setFocusable: () => undefined,
      setIgnoreMouseEvents: () => undefined,
      setHiddenInMissionControl: () => undefined,
      showInactive: () => calls.push('show-inactive'),
      isVisible: () => true,
      getOpacity: () => 0,
      isFocused: () => false,
      isFocusable: () => false,
      isAlwaysOnTop: () => false,
      getTitle: () => 'sample.md — MarkText',
      getBounds: () => ({ x: 20, y: 30, width: 900, height: 700 })
    }
    const app = Object.assign(new EventEmitter(), {
      isActive: () => active,
      hide: () => {
        calls.push('app-hide')
        active = false
        app.emit('did-resign-active')
      },
      show: () => {
        calls.push('app-show')
        active = true
      }
    })
    const context = {
      app,
      BrowserWindow: {
        getAllWindows: () => [],
        fromWebContents: () => window
      },
      webContents: { fromDevToolsTargetId: () => contents },
      clearTimeout,
      setImmediate,
      setTimeout
    } as Record<string, unknown>
    runInNewContext(
      `(${PERFORMANCE_WINDOW_SCHEDULING_INSTALLER_SOURCE})({ app, BrowserWindow, webContents })`,
      context
    )
    const lifecycle = context.__marktextPerformanceWindowLifecycle as Readonly<{
      readonly activate: (targetId: string) => Promise<unknown>
    }>

    await expect(lifecycle.activate('renderer-target-7'))
      .rejects.toThrow(/did not settle inactive/i)
    expect(calls).toEqual(['app-hide', 'app-show', 'show-inactive'])
  })

  it('rejects any window that is not render-active, transparent, and inactive', () => {
    expect(() => assertTransparentRenderActiveInactive({
      visible: false,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      title: 'sample.md — MarkText',
      bounds: { x: 20, y: 30, width: 900, height: 700 }
    })).toThrow(/presentation invariant failed/i)
    expect(() => assertTransparentRenderActiveInactive({
      visible: true,
      opacity: 0.01,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      title: 'sample.md — MarkText',
      bounds: { x: 20, y: 30, width: 900, height: 700 }
    })).toThrow(/presentation invariant failed/i)
    expect(() => assertTransparentRenderActiveInactive({
      visible: true,
      opacity: 0,
      focused: true,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      title: 'sample.md — MarkText',
      bounds: { x: 20, y: 30, width: 900, height: 700 }
    })).toThrow(/presentation invariant failed/i)
  })

  it('requires one exact on-screen layer-zero alpha-zero WindowServer match', () => {
    const expected = Object.freeze({ x: 20, y: 30, width: 900, height: 700 })
    const expectedWindow = Object.freeze({
      bounds: expected,
      title: 'sample.md — MarkText'
    })
    expect(() => assertMacWindowServerTransparentRenderActive([
      {
        windowNumber: 81,
        ownerProcessId: 1234,
        title: 'sample.md — MarkText',
        bounds: expected,
        alpha: 0,
        layer: 0,
        onScreen: true
      }
    ], 1234, expectedWindow)).not.toThrow()

    for (const invalid of [
      { alpha: 0.01 },
      { layer: 1 },
      { onScreen: false },
      { ownerProcessId: 9999 },
      { title: 'other.md — MarkText' }
    ]) {
      expect(() => assertMacWindowServerTransparentRenderActive([
        {
          windowNumber: 81,
          ownerProcessId: 1234,
          title: 'sample.md — MarkText',
          bounds: expected,
          alpha: 0,
          layer: 0,
          onScreen: true,
          ...invalid
        }
      ], 1234, expectedWindow)).toThrow(/WindowServer presentation invariant failed/i)
    }
    expect(() => assertMacWindowServerTransparentRenderActive([
      {
        windowNumber: 81,
        ownerProcessId: 1234,
        title: 'sample.md — MarkText',
        bounds: expected,
        alpha: 0,
        layer: 0,
        onScreen: true
      },
      {
        windowNumber: 82,
        ownerProcessId: 1234,
        title: 'sample.md — MarkText',
        bounds: expected,
        alpha: 0,
        layer: 0,
        onScreen: true
      }
    ], 1234, expectedWindow)).toThrow(/exactly one matching window/i)
  })

  it('reports one bounded frozen snapshot of only the run-owned WindowServer candidates', () => {
    const expectedWindow = Object.freeze({
      title: 'sample.md — MarkText',
      bounds: Object.freeze({ x: 20, y: 30, width: 900, height: 700 })
    })
    const runOwnedCandidates = Array.from({ length: 10 }, (_, index) => ({
      windowNumber: 80 + index,
      ownerProcessId: 1234,
      title: `candidate-${String(index)}.md — MarkText`,
      bounds: { x: 20 + index, y: 30, width: 900, height: 700 },
      alpha: 0,
      layer: 0,
      onScreen: true
    }))
    const otherProcess = {
      ...runOwnedCandidates[0],
      windowNumber: 999,
      ownerProcessId: 9999,
      title: 'private-other-process-window'
    }

    let thrown: unknown
    try {
      assertMacWindowServerTransparentRenderActive(
        [otherProcess, ...runOwnedCandidates],
        1234,
        expectedWindow
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    const diagnostic = (thrown as Error & {
      readonly diagnostic?: Readonly<{
        readonly expected: Readonly<{
          readonly processId: number
          readonly title: string
          readonly bounds: Readonly<{
            readonly x: number
            readonly y: number
            readonly width: number
            readonly height: number
          }>
        }>
        readonly candidateRowCount: number
        readonly exactMatchCount: number
        readonly candidateRows: readonly Readonly<{
          readonly ownerProcessId: number
          readonly title: string
          readonly bounds: Readonly<Record<string, number>>
        }>[]
      }>
    }).diagnostic
    expect(diagnostic).toMatchObject({
      expected: {
        processId: 1234,
        title: 'sample.md — MarkText',
        bounds: { x: 20, y: 30, width: 900, height: 700 }
      },
      candidateRowCount: 10,
      exactMatchCount: 0
    })
    expect(diagnostic?.candidateRows).toHaveLength(8)
    expect(diagnostic?.candidateRows.every(row =>
      row.ownerProcessId === 1234 &&
      !row.title.includes('private-other-process-window')
    )).toBe(true)
    expect(Object.isFrozen(diagnostic)).toBe(true)
    expect(Object.isFrozen(diagnostic?.expected)).toBe(true)
    expect(Object.isFrozen(diagnostic?.expected.bounds)).toBe(true)
    expect(Object.isFrozen(diagnostic?.candidateRows)).toBe(true)
    expect(diagnostic?.candidateRows.every(row =>
      Object.isFrozen(row) && Object.isFrozen(row.bounds)
    )).toBe(true)
    expect((thrown as Error).message).toContain('"candidateRowCount":10')
  })

  it('bounds WindowServer diagnostic titles without weakening exact title matching', () => {
    const longExpectedTitle = `${'expected'.repeat(2_000)} — MarkText`
    const longCandidateTitle = `${'candidate'.repeat(2_000)} — MarkText`
    let thrown: unknown
    try {
      assertMacWindowServerTransparentRenderActive([{
        windowNumber: 81,
        ownerProcessId: 1234,
        title: longCandidateTitle,
        bounds: { x: 20, y: 30, width: 900, height: 700 },
        alpha: 0,
        layer: 0,
        onScreen: true
      }], 1234, {
        title: longExpectedTitle,
        bounds: { x: 20, y: 30, width: 900, height: 700 }
      })
    } catch (error) {
      thrown = error
    }

    const diagnostic = (thrown as Error & {
      readonly diagnostic: Readonly<{
        readonly expected: Readonly<{ readonly title: string }>
        readonly candidateRows: readonly Readonly<{ readonly title: string }>[]
      }>
    }).diagnostic
    expect(diagnostic.expected.title.length).toBeLessThanOrEqual(160)
    expect(diagnostic.candidateRows[0].title.length).toBeLessThanOrEqual(160)
    expect((thrown as Error).message.length).toBeLessThan(4_096)
  })

  it('reports duplicate exact WindowServer matches without discarding either row', () => {
    const expectedWindow = {
      title: 'sample.md — MarkText',
      bounds: { x: 20, y: 30, width: 900, height: 700 }
    }
    const rows = [81, 82].map(windowNumber => ({
      windowNumber,
      ownerProcessId: 1234,
      title: expectedWindow.title,
      bounds: { ...expectedWindow.bounds },
      alpha: 0,
      layer: 0,
      onScreen: true
    }))
    let thrown: unknown
    try {
      assertMacWindowServerTransparentRenderActive(
        rows,
        1234,
        expectedWindow
      )
    } catch (error) {
      thrown = error
    }

    const diagnostic = (thrown as Error & {
      readonly diagnostic: Readonly<{
        readonly candidateRowCount: number
        readonly exactMatchCount: number
        readonly candidateRows: readonly Readonly<{
          readonly windowNumber: number
        }>[]
      }>
    }).diagnostic
    expect(diagnostic).toMatchObject({
      candidateRowCount: 2,
      exactMatchCount: 2,
      candidateRows: [{ windowNumber: 81 }, { windowNumber: 82 }]
    })
    expect(Object.isFrozen(diagnostic.candidateRows)).toBe(true)
  })

  it('hides, restores, and closes the exact window without focusing it', () => {
    const calls: string[] = []
    const contents = {
      isDestroyed: () => false,
      setBackgroundThrottling: () => {}
    }
    const window = {
      webContents: contents,
      isDestroyed: () => false,
      setOpacity: (value: number) => calls.push(`opacity:${String(value)}`),
      setFocusable: (value: boolean) => calls.push(`focusable:${String(value)}`),
      setIgnoreMouseEvents: (value: boolean) =>
        calls.push(`ignore-mouse:${String(value)}`),
      setHiddenInMissionControl: (value: boolean) =>
        calls.push(`mission-control:${String(value)}`),
      setSkipTaskbar: (value: boolean) => calls.push(`skip-taskbar:${String(value)}`),
      hide: () => calls.push('hide'),
      close: () => calls.push('close'),
      focus: () => { throw new Error('Window focus is prohibited') }
    }
    const context = {
      app: Object.assign(new EventEmitter(), { isActive: () => false }),
      BrowserWindow: {
        getAllWindows: () => [],
        fromWebContents: () => window
      },
      webContents: { fromDevToolsTargetId: () => contents }
    } as Record<string, unknown>
    runInNewContext(
      `(${PERFORMANCE_WINDOW_SCHEDULING_INSTALLER_SOURCE})({ app, BrowserWindow, webContents })`,
      context
    )
    const lifecycle = context.__marktextPerformanceWindowLifecycle as Readonly<{
      close: (targetId: string) => boolean
    }>

    expect(lifecycle.close('renderer-target-7')).toBe(true)
    expect(calls).toEqual([
      'hide',
      'opacity:1',
      'focusable:true',
      'ignore-mouse:false',
      'mission-control:false',
      'skip-taskbar:false',
      'close'
    ])
  })
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
      readonly missingPresentationMethods?: boolean
    }> = {}) => ({
      isDestroyed: () => options.destroyed === true,
      setOpacity: options.missingPresentationMethods
        ? undefined
        : (opacity: number) => calls.push(`${name}:opacity:${String(opacity)}`),
      setFocusable: (focusable: boolean) =>
        calls.push(`${name}:focusable:${String(focusable)}`),
      setIgnoreMouseEvents: (ignored: boolean) =>
        calls.push(`${name}:ignore-mouse:${String(ignored)}`),
      setHiddenInMissionControl: (hidden: boolean) =>
        calls.push(`${name}:mission:${String(hidden)}`),
      setSkipTaskbar: (skip: boolean) =>
        calls.push(`${name}:skip-taskbar:${String(skip)}`),
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
        window('destroyed-web-contents', { destroyedWebContents: true }),
        window('missing-presentation-methods', { missingPresentationMethods: true })
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

    expect(calls).toEqual([
      'existing:false',
      'existing:opacity:0',
      'existing:focusable:false',
      'existing:ignore-mouse:true',
      'existing:mission:true',
      'existing:skip-taskbar:true',
      'future:false',
      'future:opacity:0',
      'future:focusable:false',
      'future:ignore-mouse:true',
      'future:mission:true',
      'future:skip-taskbar:true'
    ])
  })

  it('installs Core main-process scheduling before observing its first window', async() => {
    const order: string[] = []
    const firstWindow = Object.freeze({ kind: 'renderer' })
    const app = Object.assign(new EventEmitter(), {
      setActivationPolicy: (policy: string) => order.push(`policy:${policy}`)
    })
    const coreWindow = (name: string) => ({
      isDestroyed: (): boolean => false,
      setOpacity: (opacity: number): void => {
        order.push(`${name}:opacity:${String(opacity)}`)
      },
      setFocusable: (focusable: boolean): void => {
        order.push(`${name}:focusable:${String(focusable)}`)
      },
      setIgnoreMouseEvents: (ignored: boolean): void => {
        order.push(`${name}:ignore-mouse:${String(ignored)}`)
      },
      setHiddenInMissionControl: (hidden: boolean): void => {
        order.push(`${name}:mission:${String(hidden)}`)
      },
      setSkipTaskbar: (skip: boolean): void => {
        order.push(`${name}:skip-taskbar:${String(skip)}`)
      },
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
          webContents: Readonly<Record<string, unknown>>
        }>) => boolean
      ): Promise<boolean> => {
        order.push('scheduling-start')
        const installed = installer({
          app,
          BrowserWindow: { getAllWindows: () => [existingWindow] },
          webContents: {}
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
      'policy:accessory',
      'existing-window:false',
      'existing-window:opacity:0',
      'existing-window:focusable:false',
      'existing-window:ignore-mouse:true',
      'existing-window:mission:true',
      'existing-window:skip-taskbar:true',
      'scheduling-complete',
      'first-window'
    ])
    app.emit('browser-window-created', {}, coreWindow('future-window'))
    expect(order.slice(-6)).toEqual([
      'future-window:false',
      'future-window:opacity:0',
      'future-window:focusable:false',
      'future-window:ignore-mouse:true',
      'future-window:mission:true',
      'future-window:skip-taskbar:true'
    ])
  })
})
