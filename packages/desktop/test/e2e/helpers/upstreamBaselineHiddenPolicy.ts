import {
  PERFORMANCE_WINDOW_SCHEDULING_INSTALLER_SOURCE
} from './performanceChromiumLaunchPolicy'

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

interface UpstreamInspectorChannel {
  readonly send: (
    method: string,
    params?: Readonly<Record<string, unknown>>
  ) => Promise<UpstreamInspectorResponse>
  readonly waitForPaused: () => Promise<UpstreamInspectorPausedEvent>
}

export const upstreamExternalHiddenPolicyExpression = `(() => {
  const { app, BrowserWindow } = require('electron')
  const installPerformanceWindowScheduling = (
    ${PERFORMANCE_WINDOW_SCHEDULING_INSTALLER_SOURCE}
  )
  installPerformanceWindowScheduling({ app, BrowserWindow })
  let concealmentActive = false
  const concealWindow = window => {
    if (window.isDestroyed()) return
    window.hide()
    window.blur()
  }
  const concealApplication = () => {
    if (concealmentActive) return
    concealmentActive = true
    try {
      for (const window of BrowserWindow.getAllWindows()) concealWindow(window)
      if (app.isReady()) {
        app.hide()
        app.dock?.hide()
      }
    } finally {
      concealmentActive = false
    }
  }
  globalThis.__marktextUpstreamHiddenLaunch = Object.freeze({
    boundary: 'external-inspector-hidden-cdp-v1'
  })
  app.on('browser-window-created', (_event, window) => {
    window.setSkipTaskbar(true)
    window.on('show', concealApplication)
    window.on('focus', concealApplication)
    concealApplication()
  })
  app.on('browser-window-focus', concealApplication)
  app.on('activate', concealApplication)
  app.setActivationPolicy('accessory')
  app.whenReady().then(concealApplication)
  return true
})()`

export const upstreamInspectorExceptionMessage = (
  response: UpstreamInspectorResponse
): string | undefined => response.result?.exceptionDetails?.exception?.description ??
  response.result?.exceptionDetails?.text

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
