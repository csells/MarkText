import log from 'electron-log/renderer'
import RendererPaths from './node/paths'
import { createRendererErrorHandler } from './rendererError'

let exceptionLogger: (s: unknown) => void = (s) => console.error(s)

const configureLogger = (): void => {
  const isDev = window.electron?.process?.env?.NODE_ENV === 'development'
  log.transports.console.level = isDev ? 'info' : false // mirror to window console
  exceptionLogger = log.error
}

interface UrlArgs {
  type: string | null
  debug: boolean
  userDataPath: string | null
  windowId: number
  initialState: {
    codeFontFamily?: string
    codeFontSize?: number
    hideScrollbar: boolean
    theme?: string
    titleBarStyle?: string
  }
}

const parseUrlArgs = (): UrlArgs => {
  const params = new URLSearchParams(window.location.search)
  const codeFontFamily = params.get('cff')
  const codeFontSizeValue = params.get('cfs')
  const codeFontSize = codeFontSizeValue === null
    ? undefined
    : Number(codeFontSizeValue)
  const debug = params.get('debug') === '1'
  const hideScrollbar = params.get('hsb') === '1'
  const theme = params.get('theme')
  const titleBarStyleValue = params.get('tbs')
  const titleBarStyle =
    titleBarStyleValue === 'custom' || titleBarStyleValue === 'native'
      ? titleBarStyleValue
      : undefined
  const userDataPath = params.get('udp')
  const windowId = Number(params.get('wid'))
  const type = params.get('type')

  if (Number.isNaN(windowId)) {
    throw new Error('Error while parsing URL arguments: windowId!')
  }

  return {
    type,
    debug,
    userDataPath,
    windowId,
    initialState: {
      ...(codeFontFamily === null ? {} : { codeFontFamily }),
      ...(codeFontSize === undefined || !Number.isFinite(codeFontSize)
        ? {}
        : { codeFontSize }),
      hideScrollbar,
      ...(theme === null ? {} : { theme }),
      ...(titleBarStyle === undefined ? {} : { titleBarStyle })
    }
  }
}

const handleRendererError = createRendererErrorHandler({
  log: error => exceptionLogger(error),
  send: payload => window.electron.ipcRenderer.send('mt::handle-renderer-error', payload),
  fallback: event => console.error(event)
})

const bootstrapRenderer = (): void => {
  // Register renderer exception handler
  window.addEventListener('error', handleRendererError)
  window.addEventListener('unhandledrejection', handleRendererError)

  const { debug, initialState, userDataPath, windowId, type } = parseUrlArgs()
  // RendererPaths throws when userDataPath is missing; preserve that runtime check.
  const paths = new RendererPaths(userDataPath as string)
  const marktext = {
    initialState,
    env: {
      debug,
      paths,
      windowId,
      type
    },
    paths
  }
  // `global` is not available in a sandboxed renderer — attach to window.
  // RendererPaths has no string index signature, so widen through `unknown`.
  window.marktext = marktext as unknown as Window['marktext']

  configureLogger()
}

export default bootstrapRenderer
