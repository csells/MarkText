import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

import {
  activateInstalledPerformanceWindow,
  awaitMacWindowServerPresentationConvergence,
  assertMacWindowServerTransparentRenderActive,
  assertTransparentRenderActiveInactive,
  closeInstalledPerformanceWindow,
  firstWindowWithPerformanceScheduling,
  MacWindowServerPresentationConvergenceError,
  MacWindowServerPresentationSnapshotError,
  PERFORMANCE_CHROMIUM_SCHEDULING_POLICY,
  PERFORMANCE_CHROMIUM_SCHEDULING_SWITCHES,
  PERFORMANCE_WINDOW_PRESENTATION_POLICY,
  PERFORMANCE_WINDOW_SCHEDULING_INSTALLER_SOURCE,
  queryMacWindowServerPresentation,
  queryMacWindowServerPresentationSnapshot,
  inspectInstalledPerformanceWindow,
  withPerformanceChromiumScheduling
} from '../../e2e/helpers/performanceChromiumLaunchPolicy'

describe('hidden performance Chromium launch policy', () => {
  it('propagates an empty active-display topology without readiness waits', async() => {
    const calls: string[] = []

    await expect(awaitMacWindowServerPresentationConvergence({
      processId: 1234,
      inspectElectron: async() => Object.freeze({
        windowNumber: 82,
        visible: true,
        opacity: 0,
        focused: false,
        focusable: false,
        alwaysOnTop: false,
        appActive: false,
        visibleOnAllWorkspaces: true,
        hiddenInMissionControl: true,
        title: 'sample.md — MarkText',
        bounds: Object.freeze({ x: 20, y: 30, width: 900, height: 700 })
      }),
      inspectWindowServer: () => {
        calls.push('native')
        return queryMacWindowServerPresentationSnapshot(1234, () =>
          JSON.stringify({ windows: [], displayTopology: [] }))
      },
      wait: async() => { calls.push('wait') }
    })).rejects.toMatchObject({
      name: 'MacWindowServerPresentationSnapshotError',
      diagnostic: {
        reason: 'active-display-topology-empty',
        expectedProcessId: 1234,
        windowRowCount: 0,
        activeDisplayCount: 0
      }
    })
    expect(calls).toEqual(['native'])
  })

  it('waits for two exact paired native matches after a transient Space translation', async() => {
    const electronState = Object.freeze({
      windowNumber: 60_506,
      visible: true,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      visibleOnAllWorkspaces: true,
      hiddenInMissionControl: true,
      title: 'Untitled-1',
      bounds: Object.freeze({ x: 264, y: 130, width: 1_200, height: 800 })
    })
    const nativeBounds = [-54, 264, 264]
    const calls: string[] = []

    await expect(awaitMacWindowServerPresentationConvergence({
      processId: 54_128,
      inspectElectron: async() => {
        calls.push('electron')
        return electronState
      },
      inspectWindowServer: () => {
        calls.push('native')
        const x = nativeBounds.shift()
        if (x === undefined) throw new Error('Unexpected native inspection')
        return Object.freeze({
          displayTopologySha256: 'a'.repeat(64),
          windows: Object.freeze([Object.freeze({
            windowNumber: 60_506,
            ownerProcessId: 54_128,
            title: 'Untitled-1',
            bounds: Object.freeze({ x, y: 130, width: 1_200, height: 800 }),
            alpha: 0,
            layer: 0,
            onScreen: true
          })])
        })
      },
      wait: async() => { calls.push('wait') },
      now: () => 0
    })).resolves.toEqual(electronState)
    expect(calls).toEqual([
      'electron', 'native', 'wait',
      'electron', 'native', 'wait',
      'electron', 'native'
    ])
  })

  it('waits for optional on-screen metadata before two exact native matches', async() => {
    const state = Object.freeze({
      windowNumber: 61_327,
      visible: true,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      visibleOnAllWorkspaces: true,
      hiddenInMissionControl: true,
      title: 'index.html',
      bounds: Object.freeze({ x: 264, y: 130, width: 1_200, height: 800 })
    })
    const onScreen = [null, true, true]
    const calls: string[] = []

    await expect(awaitMacWindowServerPresentationConvergence({
      processId: 81_205,
      inspectElectron: async() => state,
      inspectWindowServer: () => {
        const value = onScreen.shift()
        if (value === undefined) throw new Error('Unexpected native inspection')
        calls.push(`native:${String(value)}`)
        const bounds = value === null
          ? Object.freeze({ ...state.bounds, x: -54 })
          : state.bounds
        return Object.freeze({
          displayTopologySha256: 'a'.repeat(64),
          windows: Object.freeze([Object.freeze({
            windowNumber: 61_327,
            ownerProcessId: 81_205,
            title: 'index.html',
            bounds,
            alpha: 0,
            layer: 0,
            onScreen: value
          })])
        })
      },
      wait: async() => { calls.push('wait') },
      now: () => 0
    })).resolves.toEqual(state)
    expect(calls).toEqual([
      'native:null', 'wait',
      'native:true', 'wait',
      'native:true'
    ])
  })

  it('resets an existing exact-match streak when on-screen metadata disappears', async() => {
    const state = Object.freeze({
      windowNumber: 61_327,
      visible: true,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      visibleOnAllWorkspaces: true,
      hiddenInMissionControl: true,
      title: 'index.html',
      bounds: Object.freeze({ x: 264, y: 130, width: 1_200, height: 800 })
    })
    const onScreen = [true, null, true, true]
    let inspections = 0
    let waits = 0

    await expect(awaitMacWindowServerPresentationConvergence({
      processId: 81_205,
      inspectElectron: async() => state,
      inspectWindowServer: () => {
        const value = onScreen.shift()
        if (value === undefined) throw new Error('Unexpected native inspection')
        inspections += 1
        return Object.freeze({
          displayTopologySha256: 'a'.repeat(64),
          windows: Object.freeze([Object.freeze({
            windowNumber: 61_327,
            ownerProcessId: 81_205,
            title: 'index.html',
            bounds: state.bounds,
            alpha: 0,
            layer: 0,
            onScreen: value
          })])
        })
      },
      wait: async() => { waits += 1 },
      now: () => 0
    })).resolves.toEqual(state)
    expect({ inspections, waits }).toEqual({ inspections: 4, waits: 3 })
  })

  it('fails persistent origin mismatch with the complete bounded observation history', async() => {
    const electronState = Object.freeze({
      windowNumber: 60_506,
      visible: true,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      visibleOnAllWorkspaces: true,
      hiddenInMissionControl: true,
      title: 'Untitled-1',
      bounds: Object.freeze({ x: 264, y: 130, width: 1_200, height: 800 })
    })
    let thrown: unknown
    try {
      await awaitMacWindowServerPresentationConvergence({
        processId: 54_128,
        inspectElectron: async() => electronState,
        inspectWindowServer: () => Object.freeze({
          displayTopologySha256: 'a'.repeat(64),
          windows: Object.freeze([Object.freeze({
            windowNumber: 60_506,
            ownerProcessId: 54_128,
            title: 'Untitled-1',
            bounds: Object.freeze({ x: -54, y: 130, width: 1_200, height: 800 }),
            alpha: 0,
            layer: 0,
            onScreen: true
          })])
        }),
        wait: async() => undefined,
        now: () => 0
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MacWindowServerPresentationConvergenceError)
    expect((thrown as MacWindowServerPresentationConvergenceError).diagnostic)
      .toMatchObject({
        reason: 'readiness-exhausted',
        history: Array.from({ length: 101 }, (_, index) => ({
          attempt: index + 1,
          outcome: 'origin-mismatch',
          electronBounds: { x: 264, y: 130, width: 1_200, height: 800 },
          nativeBounds: { x: -54, y: 130, width: 1_200, height: 800 }
        }))
      })
    expect(Object.isFrozen(
      (thrown as MacWindowServerPresentationConvergenceError).diagnostic.history
    )).toBe(true)
  })

  it('fails persistent absent on-screen metadata with the complete bounded observation history', async() => {
    const state = Object.freeze({
      windowNumber: 61_327,
      visible: true,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      visibleOnAllWorkspaces: true,
      hiddenInMissionControl: true,
      title: 'index.html',
      bounds: Object.freeze({ x: 264, y: 130, width: 1_200, height: 800 })
    })
    let thrown: unknown
    try {
      await awaitMacWindowServerPresentationConvergence({
        processId: 81_205,
        inspectElectron: async() => state,
        inspectWindowServer: () => Object.freeze({
          displayTopologySha256: 'a'.repeat(64),
          windows: Object.freeze([Object.freeze({
            windowNumber: 61_327,
            ownerProcessId: 81_205,
            title: 'index.html',
            bounds: state.bounds,
            alpha: 0,
            layer: 0,
            onScreen: null
          })])
        }),
        wait: async() => undefined,
        now: () => 0
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MacWindowServerPresentationConvergenceError)
    expect((thrown as MacWindowServerPresentationConvergenceError).diagnostic)
      .toMatchObject({
        reason: 'readiness-exhausted',
        history: Array.from({ length: 101 }, (_, index) => ({
          attempt: index + 1,
          outcome: 'on-screen-metadata-absent',
          electronBounds: { x: 264, y: 130, width: 1_200, height: 800 },
          nativeBounds: { x: 264, y: 130, width: 1_200, height: 800 }
        }))
      })
  })

  it('fails explicit off-screen state on the first inspection without waiting', async() => {
    const state = Object.freeze({
      windowNumber: 61_327,
      visible: true,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      visibleOnAllWorkspaces: true,
      hiddenInMissionControl: true,
      title: 'index.html',
      bounds: Object.freeze({ x: 264, y: 130, width: 1_200, height: 800 })
    })
    let inspections = 0
    let waits = 0

    await expect(awaitMacWindowServerPresentationConvergence({
      processId: 81_205,
      inspectElectron: async() => state,
      inspectWindowServer: () => {
        inspections += 1
        return Object.freeze({
          displayTopologySha256: 'a'.repeat(64),
          windows: Object.freeze([Object.freeze({
            windowNumber: 61_327,
            ownerProcessId: 81_205,
            title: 'index.html',
            bounds: state.bounds,
            alpha: 0,
            layer: 0,
            onScreen: false
          })])
        })
      },
      wait: async() => { waits += 1 },
      now: () => 0
    })).rejects.toThrow(/WindowServer presentation invariant failed/i)
    expect({ inspections, waits }).toEqual({ inspections: 1, waits: 0 })
  })

  it('does not let absent on-screen metadata mask another native invariant defect', async() => {
    const state = Object.freeze({
      windowNumber: 61_327,
      visible: true,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      visibleOnAllWorkspaces: true,
      hiddenInMissionControl: true,
      title: 'index.html',
      bounds: Object.freeze({ x: 264, y: 130, width: 1_200, height: 800 })
    })
    const exact = Object.freeze({
      windowNumber: 61_327,
      ownerProcessId: 81_205,
      title: 'index.html',
      bounds: state.bounds,
      alpha: 0,
      layer: 0,
      onScreen: null
    })
    const invalidRows = [
      [{ ...exact, windowNumber: 61_328 }],
      [exact, exact],
      [{ ...exact, ownerProcessId: 81_206 }],
      [{ ...exact, title: 'other.html' }],
      [{ ...exact, bounds: null }],
      [{ ...exact, bounds: { ...state.bounds, width: 1_201 } }],
      [{ ...exact, alpha: 0.01 }],
      [{ ...exact, layer: 1 }]
    ]

    for (const windows of invalidRows) {
      let inspections = 0
      let waits = 0
      await expect(awaitMacWindowServerPresentationConvergence({
        processId: 81_205,
        inspectElectron: async() => state,
        inspectWindowServer: () => {
          inspections += 1
          return Object.freeze({
            displayTopologySha256: 'a'.repeat(64),
            windows: Object.freeze(windows)
          })
        },
        wait: async() => { waits += 1 },
        now: () => 0
      })).rejects.toThrow(/WindowServer presentation invariant failed/i)
      expect({ inspections, waits }).toEqual({ inspections: 1, waits: 0 })
    }
  })

  it('keeps observing past sixteen transient samples through the readiness deadline', async() => {
    const state = Object.freeze({
      windowNumber: 60_506,
      visible: true,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      visibleOnAllWorkspaces: true,
      hiddenInMissionControl: true,
      title: 'Untitled-1',
      bounds: Object.freeze({ x: 264, y: 130, width: 1_200, height: 800 })
    })
    let elapsedMs = 0
    let inspections = 0

    await expect(awaitMacWindowServerPresentationConvergence({
      processId: 54_128,
      inspectElectron: async() => state,
      inspectWindowServer: () => {
        inspections += 1
        return Object.freeze({
          displayTopologySha256: 'a'.repeat(64),
          windows: Object.freeze([Object.freeze({
            windowNumber: 60_506,
            ownerProcessId: 54_128,
            title: 'Untitled-1',
            bounds: Object.freeze({
              x: inspections <= 20 ? -54 : 264,
              y: 130,
              width: 1_200,
              height: 800
            }),
            alpha: 0,
            layer: 0,
            onScreen: true
          })])
        })
      },
      wait: async milliseconds => { elapsedMs += milliseconds },
      now: () => elapsedMs
    })).resolves.toEqual(state)
    expect({ inspections, elapsedMs }).toEqual({
      inspections: 22,
      elapsedMs: 1_050
    })
  })

  it('does not accept the second exact match after the readiness deadline', async() => {
    const state = Object.freeze({
      windowNumber: 81,
      visible: true,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      visibleOnAllWorkspaces: true,
      hiddenInMissionControl: true,
      title: 'sample.md — MarkText',
      bounds: Object.freeze({ x: 20, y: 30, width: 900, height: 700 })
    })
    const times = [0, 0, 0, 6_000]
    const now = (): number => times.shift() ?? 6_000
    let thrown: unknown
    try {
      await awaitMacWindowServerPresentationConvergence({
        processId: 1_234,
        inspectElectron: async() => state,
        inspectWindowServer: () => Object.freeze({
          displayTopologySha256: 'a'.repeat(64),
          windows: Object.freeze([Object.freeze({
            windowNumber: 81,
            ownerProcessId: 1_234,
            title: state.title,
            bounds: state.bounds,
            alpha: 0,
            layer: 0,
            onScreen: true
          })])
        }),
        wait: async() => undefined,
        now
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MacWindowServerPresentationConvergenceError)
    expect((thrown as MacWindowServerPresentationConvergenceError).diagnostic)
      .toMatchObject({
        reason: 'readiness-exhausted',
        history: [
          { attempt: 1, elapsedMs: 0, outcome: 'match' },
          { attempt: 2, elapsedMs: 6_000, outcome: 'match' }
        ]
      })
  })

  it('fails closed when Electron logical bounds change during native convergence', async() => {
    const electronX = [264, 300]
    const nativeX = [-54, 300]
    const next = (values: number[], label: string): number => {
      const value = values.shift()
      if (value === undefined) throw new Error(`Unexpected ${label} inspection`)
      return value
    }
    let thrown: unknown
    try {
      await awaitMacWindowServerPresentationConvergence({
        processId: 54_128,
        inspectElectron: async() => Object.freeze({
          windowNumber: 60_506,
          visible: true,
          opacity: 0,
          focused: false,
          focusable: false,
          alwaysOnTop: false,
          appActive: false,
          visibleOnAllWorkspaces: true,
          hiddenInMissionControl: true,
          title: 'Untitled-1',
          bounds: Object.freeze({
            x: next(electronX, 'Electron'),
            y: 130,
            width: 1_200,
            height: 800
          })
        }),
        inspectWindowServer: () => Object.freeze({
          displayTopologySha256: 'a'.repeat(64),
          windows: Object.freeze([Object.freeze({
            windowNumber: 60_506,
            ownerProcessId: 54_128,
            title: 'Untitled-1',
            bounds: Object.freeze({
              x: next(nativeX, 'native'),
              y: 130,
              width: 1_200,
              height: 800
            }),
            alpha: 0,
            layer: 0,
            onScreen: true
          })])
        }),
        wait: async() => undefined,
        now: () => 0
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MacWindowServerPresentationConvergenceError)
    expect((thrown as MacWindowServerPresentationConvergenceError).diagnostic)
      .toMatchObject({
        reason: 'electron-state-changed',
        history: [
          { attempt: 1, outcome: 'origin-mismatch' },
          {
            attempt: 2,
            outcome: 'electron-state-changed',
            electronBounds: { x: 300 },
            nativeBounds: { x: 300 }
          }
        ]
      })
  })

  it('fails closed when native display topology changes during convergence', async() => {
    const topology = ['a'.repeat(64), 'b'.repeat(64)]
    const nextTopology = (): string => {
      const value = topology.shift()
      if (value === undefined) throw new Error('Unexpected topology inspection')
      return value
    }
    const state = Object.freeze({
      windowNumber: 81,
      visible: true,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      visibleOnAllWorkspaces: true,
      hiddenInMissionControl: true,
      title: 'sample.md — MarkText',
      bounds: Object.freeze({ x: 20, y: 30, width: 900, height: 700 })
    })
    let thrown: unknown
    try {
      await awaitMacWindowServerPresentationConvergence({
        processId: 1_234,
        inspectElectron: async() => state,
        inspectWindowServer: () => Object.freeze({
          displayTopologySha256: nextTopology(),
          windows: Object.freeze([Object.freeze({
            windowNumber: 81,
            ownerProcessId: 1_234,
            title: state.title,
            bounds: state.bounds,
            alpha: 0,
            layer: 0,
            onScreen: true
          })])
        }),
        wait: async() => undefined,
        now: () => 0
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MacWindowServerPresentationConvergenceError)
    expect((thrown as MacWindowServerPresentationConvergenceError).diagnostic)
      .toMatchObject({
        reason: 'display-topology-changed',
        history: [
          { attempt: 1, outcome: 'match', displayTopologySha256: 'a'.repeat(64) },
          {
            attempt: 2,
            outcome: 'display-topology-changed',
            displayTopologySha256: 'b'.repeat(64)
          }
        ]
      })
  })

  it('never waits through a native identity or non-origin invariant violation', async() => {
    const state = Object.freeze({
      windowNumber: 81,
      visible: true,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      visibleOnAllWorkspaces: true,
      hiddenInMissionControl: true,
      title: 'sample.md — MarkText',
      bounds: Object.freeze({ x: 20, y: 30, width: 900, height: 700 })
    })
    const exact = Object.freeze({
      windowNumber: 81,
      ownerProcessId: 1_234,
      title: state.title,
      bounds: state.bounds,
      alpha: 0,
      layer: 0,
      onScreen: true
    })
    const invalidRows = [
      [],
      [exact, exact],
      [{ ...exact, ownerProcessId: 9_999 }],
      [{ ...exact, title: 'other.md — MarkText' }],
      [{ ...exact, bounds: { ...state.bounds, width: 901 } }],
      [{ ...exact, alpha: 0.01 }],
      [{ ...exact, layer: 1 }],
      [{ ...exact, onScreen: false }]
    ]

    for (const windows of invalidRows) {
      let inspections = 0
      let waits = 0
      await expect(awaitMacWindowServerPresentationConvergence({
        processId: 1_234,
        inspectElectron: async() => state,
        inspectWindowServer: () => {
          inspections += 1
          return Object.freeze({
            displayTopologySha256: 'a'.repeat(64),
            windows: Object.freeze(windows)
          })
        },
        wait: async() => { waits += 1 },
        now: () => 0
      })).rejects.toThrow(/WindowServer presentation invariant failed/i)
      expect({ inspections, waits }).toEqual({ inspections: 1, waits: 0 })
    }
  })

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
      setVisibleOnAllWorkspaces: (
        visible: boolean,
        options: Readonly<{
          visibleOnFullScreen?: boolean
          skipTransformProcessType?: boolean
        }>
      ) => calls.push(
        `all-workspaces:${String(visible)}:${JSON.stringify(options)}`
      ),
      setSkipTaskbar: (skip: boolean) => calls.push(`skip-taskbar:${String(skip)}`),
      showInactive: () => calls.push('show-inactive'),
      focus: () => { throw new Error('Window focus is prohibited') },
      isVisible: () => true,
      getOpacity: () => 0,
      isFocused: () => false,
      isFocusable: () => false,
      isAlwaysOnTop: () => false,
      isVisibleOnAllWorkspaces: () => true,
      isHiddenInMissionControl: () => true,
      getMediaSourceId: () => 'window:81:0',
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

    expect(calls).toEqual([
      'policy:accessory',
      'schedule:false',
      'opacity:0',
      'focusable:false',
      'ignore-mouse:true',
      'mission-control:true',
      'all-workspaces:true:{"visibleOnFullScreen":true,"skipTransformProcessType":true}',
      'skip-taskbar:true',
      'app-hide',
      'app-show',
      'show-inactive'
    ])
    expect(PERFORMANCE_WINDOW_PRESENTATION_POLICY)
      .toBe('transparent-render-active-inactive-v6')
    expect(state).toMatchObject({
      windowNumber: 81,
      visibleOnAllWorkspaces: true,
      hiddenInMissionControl: true
    })
    expect(() => assertTransparentRenderActiveInactive(state))
      .not.toThrow()
  })

  it('checks and closes the same exact installed renderer lifecycle', async() => {
    const calls: string[] = []
    const state = Object.freeze({
      windowNumber: 81,
      visible: true,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      visibleOnAllWorkspaces: true,
      hiddenInMissionControl: true,
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
      setVisibleOnAllWorkspaces: () => undefined,
      isVisibleOnAllWorkspaces: () => true,
      isHiddenInMissionControl: () => true,
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

  it('fails closed when an exact window lacks any workspace policy API', async() => {
    const workspaceApis = [
      'setVisibleOnAllWorkspaces',
      'isVisibleOnAllWorkspaces',
      'isHiddenInMissionControl'
    ] as const

    for (const missingApi of workspaceApis) {
      let showInactiveCalls = 0
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
        setVisibleOnAllWorkspaces: () => undefined,
        isVisibleOnAllWorkspaces: () => true,
        isHiddenInMissionControl: () => true,
        showInactive: () => { showInactiveCalls += 1 }
      } as Record<string, unknown>
      window[missingApi] = undefined
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
        readonly activate: (targetId: string) => Promise<unknown>
      }>

      await expect(lifecycle.activate('renderer-target-7'))
        .rejects.toThrow(/cannot be prepared/i)
      expect(showInactiveCalls).toBe(0)
    }
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
      setVisibleOnAllWorkspaces: () => undefined,
      showInactive: () => calls.push('show-inactive'),
      isVisible: () => true,
      getOpacity: () => 0,
      isFocused: () => false,
      isFocusable: () => false,
      isAlwaysOnTop: () => false,
      isVisibleOnAllWorkspaces: () => true,
      isHiddenInMissionControl: () => true,
      getMediaSourceId: () => 'window:81:0',
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
      windowNumber: 81,
      visible: false,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      visibleOnAllWorkspaces: true,
      hiddenInMissionControl: true,
      title: 'sample.md — MarkText',
      bounds: { x: 20, y: 30, width: 900, height: 700 }
    })).toThrow(/presentation invariant failed/i)
    expect(() => assertTransparentRenderActiveInactive({
      windowNumber: 81,
      visible: true,
      opacity: 0.01,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      visibleOnAllWorkspaces: true,
      hiddenInMissionControl: true,
      title: 'sample.md — MarkText',
      bounds: { x: 20, y: 30, width: 900, height: 700 }
    })).toThrow(/presentation invariant failed/i)
    expect(() => assertTransparentRenderActiveInactive({
      windowNumber: 81,
      visible: true,
      opacity: 0,
      focused: true,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      visibleOnAllWorkspaces: true,
      hiddenInMissionControl: true,
      title: 'sample.md — MarkText',
      bounds: { x: 20, y: 30, width: 900, height: 700 }
    })).toThrow(/presentation invariant failed/i)
    expect(() => assertTransparentRenderActiveInactive({
      windowNumber: 81,
      visible: true,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      visibleOnAllWorkspaces: false,
      hiddenInMissionControl: true,
      title: 'sample.md — MarkText',
      bounds: { x: 20, y: 30, width: 900, height: 700 }
    })).toThrow(/presentation invariant failed/i)
    expect(() => assertTransparentRenderActiveInactive({
      windowNumber: 81,
      visible: true,
      opacity: 0,
      focused: false,
      focusable: false,
      alwaysOnTop: false,
      appActive: false,
      visibleOnAllWorkspaces: true,
      hiddenInMissionControl: false,
      title: 'sample.md — MarkText',
      bounds: { x: 20, y: 30, width: 900, height: 700 }
    })).toThrow(/presentation invariant failed/i)
  })

  it('requires one exact on-screen layer-zero alpha-zero WindowServer match', () => {
    const expected = Object.freeze({ x: 20, y: 30, width: 900, height: 700 })
    const expectedWindow = Object.freeze({
      windowNumber: 81,
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
      { onScreen: null },
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
    ], 1234, expectedWindow)).not.toThrow()
  })

  it('selects the exact CGWindow ID before checking native presentation invariants', () => {
    const expectedWindow = {
      windowNumber: 82,
      title: 'sample.md — MarkText',
      bounds: { x: 20, y: 30, width: 900, height: 700 }
    }
    const otherwiseIdenticalRows = [81, 82].map(windowNumber => ({
      windowNumber,
      ownerProcessId: 1234,
      title: expectedWindow.title,
      bounds: { ...expectedWindow.bounds },
      alpha: 0,
      layer: 0,
      onScreen: true
    }))

    expect(() => assertMacWindowServerTransparentRenderActive(
      otherwiseIdenticalRows,
      1234,
      expectedWindow
    )).not.toThrow()
  })

  it('retains an exact optionAll row with missing native metadata as a precise red', () => {
    const expectedWindow = {
      windowNumber: 82,
      title: 'sample.md — MarkText',
      bounds: { x: 20, y: 30, width: 900, height: 700 }
    }
    let thrown: unknown
    try {
      assertMacWindowServerTransparentRenderActive([{
        windowNumber: 82,
        ownerProcessId: 1234,
        title: null,
        bounds: null,
        alpha: 0,
        layer: 0,
        onScreen: null
      }], 1234, expectedWindow)
    } catch (error) {
      thrown = error
    }

    const diagnostic = (thrown as Error & {
      readonly diagnostic?: Readonly<{
        readonly candidateRowCount: number
        readonly exactMatchCount: number
        readonly candidateRows: readonly unknown[]
      }>
    }).diagnostic
    expect((thrown as Error).name)
      .toBe('MacWindowServerPresentationInvariantError')
    expect(diagnostic).toMatchObject({
      candidateRowCount: 1,
      exactMatchCount: 1,
      candidateRows: [{
        windowNumber: 82,
        ownerProcessId: 1234,
        title: null,
        bounds: null,
        alpha: 0,
        layer: 0,
        onScreen: null
      }]
    })
  })

  it('reports the exact offscreen CGWindow row instead of treating it as absent', () => {
    const row = {
      windowNumber: 82,
      ownerProcessId: 1234,
      title: 'sample.md — MarkText',
      bounds: { x: 20, y: 30, width: 900, height: 700 },
      alpha: 0,
      layer: 0,
      onScreen: false
    }
    let thrown: unknown
    try {
      assertMacWindowServerTransparentRenderActive([row], 1234, {
        windowNumber: 82,
        title: row.title,
        bounds: row.bounds
      })
    } catch (error) {
      thrown = error
    }

    expect((thrown as Error & {
      readonly diagnostic?: unknown
    }).diagnostic).toMatchObject({
      reason: 'exact-window-state',
      candidateRowCount: 1,
      exactMatchCount: 1,
      candidateRows: [{ windowNumber: 82, onScreen: false }]
    })
  })

  it('keeps the exact invalid CGWindow row inside the bounded diagnostic cap', () => {
    const unrelatedRows = Array.from({ length: 9 }, (_, index) => ({
      windowNumber: 100 + index,
      ownerProcessId: 1234,
      title: `other-${String(index)}`,
      bounds: { x: index, y: 0, width: 100, height: 100 },
      alpha: 0,
      layer: 0,
      onScreen: true
    }))
    const exactOffscreenRow = {
      windowNumber: 82,
      ownerProcessId: 1234,
      title: 'sample.md — MarkText',
      bounds: { x: 20, y: 30, width: 900, height: 700 },
      alpha: 0,
      layer: 0,
      onScreen: false
    }
    let thrown: unknown
    try {
      assertMacWindowServerTransparentRenderActive(
        [...unrelatedRows, exactOffscreenRow],
        1234,
        {
          windowNumber: 82,
          title: exactOffscreenRow.title,
          bounds: exactOffscreenRow.bounds
        }
      )
    } catch (error) {
      thrown = error
    }

    const diagnostic = (thrown as Error & {
      readonly diagnostic?: Readonly<{
        readonly candidateRows: readonly Readonly<{
          readonly windowNumber: number | null
          readonly onScreen: boolean | null
        }>[]
      }>
    }).diagnostic
    expect(diagnostic?.candidateRows).toHaveLength(8)
    expect(diagnostic?.candidateRows[0])
      .toMatchObject({ windowNumber: 82, onScreen: false })
  })

  it('queries optionAll and transports every PID row without eliding null metadata', () => {
    const calls: Array<Readonly<{
      executable: string
      arguments: readonly string[]
    }>> = []
    const rows = queryMacWindowServerPresentation(1234, (
      executable,
      arguments_
    ) => {
      calls.push({ executable, arguments: arguments_ })
      return JSON.stringify([{
        windowNumber: 82,
        ownerProcessId: 1234,
        title: null,
        bounds: null,
        alpha: 0,
        layer: 0,
        onScreen: null
      }])
    })

    expect(rows).toEqual([{
      windowNumber: 82,
      ownerProcessId: 1234,
      title: null,
      bounds: null,
      alpha: 0,
      layer: 0,
      onScreen: null
    }])
    expect(calls).toHaveLength(1)
    expect(calls[0].executable).toBe('/usr/bin/swift')
    expect(calls[0].arguments.at(-1)).toBe('1234')
    expect(calls[0].arguments[1]).toContain('.optionAll')
    expect(calls[0].arguments[1]).not.toContain('.optionOnScreenOnly')
    expect(calls[0].arguments[1]).not.toContain('rawRows.compactMap')
  })

  it('authenticates the active native display topology with each WindowServer query', () => {
    const calls: string[][] = []
    const snapshot = queryMacWindowServerPresentationSnapshot(1234, (
      _executable,
      arguments_
    ) => {
      calls.push([...arguments_])
      return JSON.stringify({
        windows: [{
          windowNumber: 82,
          ownerProcessId: 1234,
          title: 'sample.md — MarkText',
          bounds: { x: 20, y: 30, width: 900, height: 700 },
          alpha: 0,
          layer: 0,
          onScreen: true
        }],
        displayTopology: [{
          displayId: 1,
          bounds: { x: 0, y: 0, width: 1_728, height: 1_117 },
          pixelsWide: 3_456,
          pixelsHigh: 2_234
        }]
      })
    })

    expect(snapshot).toEqual({
      displayTopologySha256:
        'a7a53057036c5c93ef413aabff5298caaefae4253f6da78317b9697b06e43706',
      windows: [{
        windowNumber: 82,
        ownerProcessId: 1234,
        title: 'sample.md — MarkText',
        bounds: { x: 20, y: 30, width: 900, height: 700 },
        alpha: 0,
        layer: 0,
        onScreen: true
      }]
    })
    expect(calls[0]?.[1]).toContain('CGGetActiveDisplayList')
    expect(calls[0]?.at(-1)).toBe('1234')
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.windows)).toBe(true)
  })

  it('rejects an empty active-display topology with a bounded typed diagnostic', () => {
    let thrown: unknown
    try {
      queryMacWindowServerPresentationSnapshot(1234, () => JSON.stringify({
        windows: [],
        displayTopology: []
      }))
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      name: 'MacWindowServerPresentationSnapshotError',
      diagnostic: {
        reason: 'active-display-topology-empty',
        expectedProcessId: 1234,
        windowRowCount: 0,
        activeDisplayCount: 0
      }
    })
    expect(thrown).toBeInstanceOf(MacWindowServerPresentationSnapshotError)
  })

  it('diagnoses an inactive sleeping main display separately from active topology', () => {
    let probeSource = ''
    let thrown: unknown
    try {
      queryMacWindowServerPresentationSnapshot(1234, (
        _executable,
        arguments_
      ) => {
        probeSource = arguments_[1] ?? ''
        return JSON.stringify({
          windows: [],
          displayTopology: [],
          onlineDisplayCount: 1,
          mainDisplay: { id: 1, active: false, asleep: true }
        })
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      name: 'MacWindowServerPresentationSnapshotError',
      diagnostic: {
        reason: 'active-display-topology-empty',
        expectedProcessId: 1234,
        windowRowCount: 0,
        activeDisplayCount: 0,
        onlineDisplayCount: 1,
        mainDisplay: { id: 1, active: false, asleep: true }
      }
    })
    expect(probeSource).toContain('CGGetOnlineDisplayList')
    expect(probeSource).toContain('CGMainDisplayID')
    expect(probeSource).toContain('CGDisplayIsActive')
    expect(probeSource).toContain('CGDisplayIsAsleep')
  })

  it('reports one bounded frozen snapshot of only the run-owned WindowServer candidates', () => {
    const expectedWindow = Object.freeze({
      windowNumber: 10_000,
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
          readonly windowNumber: number
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
        windowNumber: 10_000,
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
        windowNumber: 81,
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
      windowNumber: 81,
      title: 'sample.md — MarkText',
      bounds: { x: 20, y: 30, width: 900, height: 700 }
    }
    const rows = [81, 82].map(sourceRow => ({
      windowNumber: 81,
      ownerProcessId: 1234,
      title: `${expectedWindow.title}-${String(sourceRow)}`,
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
      candidateRows: [{ windowNumber: 81 }, { windowNumber: 81 }]
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
      setVisibleOnAllWorkspaces: (
        visible: boolean,
        options: Readonly<{
          visibleOnFullScreen?: boolean
          skipTransformProcessType?: boolean
        }>
      ) => calls.push(
        `all-workspaces:${String(visible)}:${JSON.stringify(options)}`
      ),
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
      'all-workspaces:false:{"visibleOnFullScreen":false,"skipTransformProcessType":true}',
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
      setVisibleOnAllWorkspaces: (
        visible: boolean,
        options: Readonly<{
          visibleOnFullScreen?: boolean
          skipTransformProcessType?: boolean
        }>
      ) => calls.push(
        `${name}:all-workspaces:${String(visible)}:${JSON.stringify(options)}`
      ),
      isVisibleOnAllWorkspaces: () => true,
      isHiddenInMissionControl: () => true,
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
      'existing:all-workspaces:true:{"visibleOnFullScreen":true,"skipTransformProcessType":true}',
      'existing:skip-taskbar:true',
      'future:false',
      'future:opacity:0',
      'future:focusable:false',
      'future:ignore-mouse:true',
      'future:mission:true',
      'future:all-workspaces:true:{"visibleOnFullScreen":true,"skipTransformProcessType":true}',
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
      setVisibleOnAllWorkspaces: (
        visible: boolean,
        options: Readonly<{
          visibleOnFullScreen?: boolean
          skipTransformProcessType?: boolean
        }>
      ): void => {
        order.push(
          `${name}:all-workspaces:${String(visible)}:${JSON.stringify(options)}`
        )
      },
      isVisibleOnAllWorkspaces: (): boolean => true,
      isHiddenInMissionControl: (): boolean => true,
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
      'existing-window:all-workspaces:true:{"visibleOnFullScreen":true,"skipTransformProcessType":true}',
      'existing-window:skip-taskbar:true',
      'scheduling-complete',
      'first-window'
    ])
    app.emit('browser-window-created', {}, coreWindow('future-window'))
    expect(order.slice(-7)).toEqual([
      'future-window:false',
      'future-window:opacity:0',
      'future-window:focusable:false',
      'future-window:ignore-mouse:true',
      'future-window:mission:true',
      'future-window:all-workspaces:true:{"visibleOnFullScreen":true,"skipTransformProcessType":true}',
      'future-window:skip-taskbar:true'
    ])
  })
})
