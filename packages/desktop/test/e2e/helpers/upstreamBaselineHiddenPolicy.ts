import {
  assertTransparentRenderActiveInactive,
  PERFORMANCE_WINDOW_SCHEDULING_INSTALLER_SOURCE,
  type PerformanceWindowPresentationState
} from './performanceChromiumLaunchPolicy'
import {
  PERFORMANCE_PRESENTATION_CAPTURE_OPTIONS,
  type PerformanceHiddenPageCaptureResult
} from './performancePresentationCheckpoint'

export interface UpstreamInspectorResponse {
  readonly id?: number
  readonly error?: { readonly message?: string }
  readonly result?: {
    readonly result?: { readonly value?: unknown }
    readonly exceptionDetails?: {
      readonly text?: string
      readonly exception?: { readonly description?: string }
    }
  }
}

interface UpstreamInspectorPausedEvent {
  readonly callFrames: readonly Readonly<{ readonly callFrameId: string }>[]
}

export interface UpstreamInspectorChannel {
  readonly send: (
    method: string,
    params?: Readonly<Record<string, unknown>>
  ) => Promise<UpstreamInspectorResponse>
  readonly waitForPaused: () => Promise<UpstreamInspectorPausedEvent>
}

export const upstreamExternalHiddenPolicyExpression = `(() => {
  const { app, BrowserWindow, webContents } = require('electron')
  const installPerformanceWindowScheduling = (
    ${PERFORMANCE_WINDOW_SCHEDULING_INSTALLER_SOURCE}
  )
  installPerformanceWindowScheduling({ app, BrowserWindow, webContents })
  const lifecycle = globalThis.__marktextPerformanceWindowLifecycle
  if (lifecycle === undefined) {
    throw new Error('Performance window lifecycle is unavailable')
  }
  globalThis.__marktextUpstreamHiddenLaunch = Object.freeze({
    boundary: 'external-inspector-transparent-render-active-v3',
    activate: targetId => lifecycle.activate(targetId),
    inspect: targetId => lifecycle.inspect(targetId),
    close: targetId => lifecycle.close(targetId),
    capturePage: async targetId => {
      const contents = webContents.fromDevToolsTargetId(targetId)
      if (contents === undefined || contents.isDestroyed()) {
        throw new Error('Measured renderer WebContents is unavailable')
      }
      const window = BrowserWindow.fromWebContents(contents)
      if (window == null || window.isDestroyed()) {
        throw new Error('Measured renderer BrowserWindow is unavailable')
      }
      const state = lifecycle.inspect(targetId)
      if (
        !state.visible || state.opacity !== 0 || state.focused ||
        state.focusable || state.alwaysOnTop || state.appActive ||
        !state.visibleOnAllWorkspaces || !state.hiddenInMissionControl
      ) {
        throw new Error(
          'Measured renderer is not in transparent render-active inactive state'
        )
      }
      const image = await contents.capturePage(
        undefined,
        ${JSON.stringify(PERFORMANCE_PRESENTATION_CAPTURE_OPTIONS)}
      )
      return Object.freeze({ empty: image.isEmpty() })
    }
  })
  return true
})()`

export const upstreamInspectorExceptionMessage = (
  response: UpstreamInspectorResponse
): string | undefined => response.result?.exceptionDetails?.exception?.description ??
  response.result?.exceptionDetails?.text

export const captureUpstreamElectronHiddenPage = async(
  channel: UpstreamInspectorChannel,
  targetId: string
): Promise<Readonly<PerformanceHiddenPageCaptureResult>> => {
  const response = await channel.send('Runtime.evaluate', {
    expression: 'globalThis.__marktextUpstreamHiddenLaunch.capturePage(' +
      `${JSON.stringify(targetId)})`,
    awaitPromise: true,
    returnByValue: true
  })
  const failure = upstreamInspectorExceptionMessage(response)
  if (failure !== undefined) throw new Error(failure)
  const value = response.result?.result?.value as Readonly<{
    readonly empty?: unknown
  }> | undefined
  if (typeof value?.empty !== 'boolean') {
    throw new Error('Upstream hidden capture result is invalid')
  }
  return Object.freeze({ empty: value.empty })
}

const upstreamPerformanceWindowCommand = async(
  channel: UpstreamInspectorChannel,
  targetId: string,
  command: 'activate' | 'inspect' | 'close'
): Promise<unknown> => {
  const response = await channel.send('Runtime.evaluate', {
    expression: `globalThis.__marktextUpstreamHiddenLaunch.${command}(` +
      `${JSON.stringify(targetId)})`,
    awaitPromise: true,
    returnByValue: true
  })
  const failure = upstreamInspectorExceptionMessage(response)
  if (failure !== undefined) throw new Error(failure)
  return response.result?.result?.value
}

export const activateUpstreamPerformanceWindow = async(
  channel: UpstreamInspectorChannel,
  targetId: string
): Promise<Readonly<PerformanceWindowPresentationState>> => {
  const state = await upstreamPerformanceWindowCommand(
    channel,
    targetId,
    'activate'
  )
  assertTransparentRenderActiveInactive(state)
  return state
}

export const inspectUpstreamPerformanceWindow = async(
  channel: UpstreamInspectorChannel,
  targetId: string
): Promise<Readonly<PerformanceWindowPresentationState>> => {
  const state = await upstreamPerformanceWindowCommand(
    channel,
    targetId,
    'inspect'
  )
  assertTransparentRenderActiveInactive(state)
  return state
}

export const closeUpstreamPerformanceWindow = async(
  channel: UpstreamInspectorChannel,
  targetId: string
): Promise<void> => {
  const closed = await upstreamPerformanceWindowCommand(
    channel,
    targetId,
    'close'
  )
  if (closed !== true) throw new Error('Upstream performance window cleanup failed')
}

export const installUpstreamExternalHiddenPolicy = async(
  channel: UpstreamInspectorChannel
): Promise<void> => {
  await channel.send('Runtime.enable')
  await channel.send('Debugger.enable')
  const pausedAtEntry = channel.waitForPaused()
  await channel.send('Runtime.runIfWaitingForDebugger')
  const entry = await pausedAtEntry
  const callFrameId = entry.callFrames[0]?.callFrameId
  if (callFrameId === undefined) {
    throw new Error('Upstream main-process entry did not expose a call frame')
  }
  const installed = await channel.send('Debugger.evaluateOnCallFrame', {
    callFrameId,
    expression: upstreamExternalHiddenPolicyExpression,
    returnByValue: true
  })
  const failure = upstreamInspectorExceptionMessage(installed)
  if (failure !== undefined) throw new Error(failure)
  await channel.send('Debugger.resume')
}
