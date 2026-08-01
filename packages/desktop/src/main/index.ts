import './globalSetting'
import path from 'path'
import { app, crashReporter } from 'electron'
import log from 'electron-log'
import { electronApp, optimizer } from '@electron-toolkit/utils'

import cli from './cli'
import setupExceptionHandler, { initExceptionLogger } from './exceptionHandler'
import setupEnvironment from './app/env'
import type { AppEnvironment } from './app/env'
import { getLogLevel } from './utils'
import Accessor from './app/accessor'
import App from './app'
import { t } from './i18n'
import { registerSandboxIpcHandlers } from './ipc'
import {
  bindPresentationPolicyFromEnvironment,
  presentationPolicy
} from './presentationPolicy'
import { exceptionReporter } from './exceptionReporting'
import {
  registerImageDisplayScheme
} from './imageAssets/imageDisplayProtocolRegistration'

// Set version strings into global and process.versions
process.env.MARKTEXT_VERSION = MARKTEXT_VERSION
process.env.MARKTEXT_VERSION_STRING = MARKTEXT_VERSION_STRING

// Main-loop stall attribution: renderer-bound sends serialize synchronously
// on the main thread, so when MARKTEXT_STALL_TRACE names a file every send
// above 20ms is logged with its channel to explain event-loop gaps.
// Main CPU attribution: when MARKTEXT_MAIN_CPU_PROF names a file, the whole
// main-process run is sampled and the profile written at quit, so an
// event-loop gap no wrapper can see still names its stack.
if (process.env.MARKTEXT_MAIN_CPU_PROF) {
  const profilePath = process.env.MARKTEXT_MAIN_CPU_PROF
  import('node:inspector').then(({ Session }) => {
    const session = new Session()
    session.connect()
    session.post('Profiler.enable', () => {
      session.post('Profiler.start', () => undefined)
    })
    // The e2e harness kills the app faster than a quit hook can flush, so
    // the capture window is fixed-length and the profile lands mid-run.
    setTimeout(() => {
      session.post('Profiler.stop', (error, result) => {
        if (error || result === undefined) return
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('node:fs').writeFileSync(
          profilePath,
          JSON.stringify(result.profile)
        )
      })
    }, 25_000).unref()
  })
}

if (process.env.MARKTEXT_STALL_TRACE) {
  const tracePath = process.env.MARKTEXT_STALL_TRACE
  import('electron').then(({ ipcMain }) => {
    const originalHandle = ipcMain.handle.bind(ipcMain)
    ipcMain.handle = (channel, listener) => originalHandle(
      channel,
      async(...listenerArguments) => {
        const startedAt = performance.now()
        try {
          return await listener(...listenerArguments)
        } finally {
          const elapsed = performance.now() - startedAt
          if (elapsed > 20) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('node:fs').appendFileSync(
              tracePath,
              JSON.stringify({
                span: `main:invoke:${channel}`,
                ms: elapsed,
                at: performance.now()
              }) + '\n'
            )
          }
        }
      }
    )
  })
  import('electron').then(({ webContents }) => {
    const prototype = (webContents as unknown as {
      prototype?: { send?: (...sendArguments: unknown[]) => unknown }
    }).prototype
    const originalSend = prototype?.send
    if (prototype === undefined || originalSend === undefined) return
    prototype.send = function tracedSend(...sendArguments: unknown[]) {
      const startedAt = performance.now()
      const result = originalSend.apply(this, sendArguments)
      const elapsed = performance.now() - startedAt
      if (elapsed > 20) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('node:fs').appendFileSync(
          tracePath,
          JSON.stringify({
            span: `main:send:${String(sendArguments[0])}`,
            ms: elapsed,
            at: performance.now()
          }) + '\n'
        )
      }
      return result
    }
  })
}

// -----------------------------------------------
// Exception handling and logging setup
setupExceptionHandler()
const args = cli()
const appEnvironment = setupEnvironment(args as Record<string, unknown>)

const initializeLogger = (env: AppEnvironment): void => {
  log.initialize() // allows listening for logs from the renderer process
  log.transports.console.level = process.env.NODE_ENV === 'development' ? 'info' : 'error'
  log.transports.file.resolvePathFn = (variables) => {
    // electron-log's PathVariables type doesn't model the browserWindow field
    // that's available at runtime for renderer-process logs. Cast through
    // unknown to access it without weakening the rest of the variables type.
    const vars = variables as unknown as { browserWindow?: { id?: number } }
    if (vars.browserWindow && vars.browserWindow.id) {
      return path.join(env.paths.logPath, `renderer-${vars.browserWindow.id}.log`)
    }
    return path.join(env.paths.logPath, 'main.log')
  }
  log.transports.file.level = getLogLevel()
  log.transports.file.sync = true
  log.errorHandler.startCatching({
    onError(error: unknown) {
      // This callback receives the full Error object with stack
      log.error('Uncaught Exception:', (error as Error)?.stack)
    }
  })
  initExceptionLogger()
}

initializeLogger(appEnvironment)

// Handles native level crashes
crashReporter.start({
  companyName: '',
  productName: 'marktext',
  uploadToServer: false, // collect locally
  compress: true
})

// -----------------------------------------------
// Disable GPU if requested
if (args['--disable-gpu']) {
  app.disableHardwareAcceleration()
}

bindPresentationPolicyFromEnvironment()
presentationPolicy.configureApplication(Object.assign(app, {
  preventAppSuspension: () => {
    import('electron').then(({ powerSaveBlocker }) => {
      powerSaveBlocker.start('prevent-app-suspension')
    })
  }
}))
registerImageDisplayScheme()

// Single instance lock (except macOS & development)
if (!process.mas && process.env.NODE_ENV !== 'development') {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    process.stdout.write(t('error.otherInstanceDetected'))
    process.exit(0)
  }
}

// Register sandbox-safe IPC handlers used by the contextBridge preload
registerSandboxIpcHandlers()

// Windows-specific AppUserModelID
electronApp.setAppUserModelId('com.electron.marktext')

// Dev shortcuts and reload suppression
app.on('browser-window-created', (_, window) => {
  optimizer.watchWindowShortcuts(window)
})

// Instantiate and start the main App controller
let accessor: Accessor
try {
  accessor = new Accessor(appEnvironment)
} catch (err) {
  const errorObj = err instanceof Error ? err : new Error(String(err))
  const msgHint = errorObj.message.includes('Config schema violation')
    ? t('error.configSchemaViolation')
    : ''
  log.error(t('error.initializationFailed', { hint: msgHint }), errorObj)

  const EXIT_ON_ERROR = !!process.env.MARKTEXT_EXIT_ON_ERROR
  const SHOW_ERROR_DIALOG = !process.env.MARKTEXT_ERROR_INTERACTION
  exceptionReporter.handle('startup', errorObj, () => {
    if (!EXIT_ON_ERROR && SHOW_ERROR_DIALOG) {
      presentationPolicy.showErrorBox(
        t('error.startupError'),
        `${msgHint}${errorObj.message}\n\n${errorObj.stack ?? ''}`
      )
    }
  }).catch((handlerError) => {
    log.error('Failed to process the startup error through presentation policy.', handlerError)
  })
  process.exit(1)
}
const appController = new App(accessor, args as unknown as { _: string[] })
appController.init()

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
