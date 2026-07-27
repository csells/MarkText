// Sandboxed preload: only `electron` can be required, and only a tiny subset of
// `process` is available (platform, versions, env). Everything else lives in
// the main process and is reached via IPC.
//
// All IPC traffic is funneled through the typed generics in
// `@shared/types/ipc` so channel names, argument tuples and return shapes
// are checked at the call site.

import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { IpcRendererEvent } from 'electron'
import pathe from 'pathe'

import type {
  IpcInvokeChannels,
  IpcSendChannels,
  IpcSyncChannels,
  IpcMainEventChannels,
  BootInfo
} from '@shared/types/ipc'
import type {
  UploaderAvailabilityRequest,
  UploaderUploadRequest
} from '@shared/types/uploader'
import type {
  UploaderDeletionClipboardRequest
} from '@shared/types/clipboardTransactions'
import type {
  ProjectSearchErrorEnvelope,
  ProjectSearchMatchEnvelope,
  ProjectSearchProgressEnvelope,
  ProjectSearchRequest,
  ProjectSearchTerminalEnvelope
} from '@shared/types/projectSearch'

type RendererEventListener<K extends keyof IpcMainEventChannels> = (
  event: IpcRendererEvent,
  ...args: IpcMainEventChannels[K]
) => void

const invoke = <K extends keyof IpcInvokeChannels>(
  channel: K,
  ...args: IpcInvokeChannels[K]['args']
): Promise<IpcInvokeChannels[K]['ret']> => ipcRenderer.invoke(channel, ...args)

const send = <K extends keyof IpcSendChannels>(channel: K, ...args: IpcSendChannels[K]): void =>
  ipcRenderer.send(channel, ...args)

// One synchronous handshake at startup so the renderer can read platform/env
// without an `await` from inside Vue computed properties etc.
const bootInfo = ipcRenderer.sendSync('mt::boot-info') as BootInfo | undefined

const ipcWrapper = {
  send,
  sendSync: <K extends keyof IpcSyncChannels>(
    channel: K,
    ...args: IpcSyncChannels[K]['args']
  ): IpcSyncChannels[K]['ret'] => ipcRenderer.sendSync(channel, ...args),
  invoke,
  on: <K extends keyof IpcMainEventChannels>(
    channel: K,
    listener: RendererEventListener<K>
  ): (() => void) => {
    const subscription = (event: IpcRendererEvent, ...args: unknown[]): void => {
      listener(event, ...(args as IpcMainEventChannels[K]))
    }
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },
  once: <K extends keyof IpcMainEventChannels>(
    channel: K,
    listener: RendererEventListener<K>
  ): (() => void) => {
    const subscription = (event: IpcRendererEvent, ...args: unknown[]): void => {
      listener(event, ...(args as IpcMainEventChannels[K]))
    }
    ipcRenderer.once(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },
  removeAllListeners: (channel: keyof IpcMainEventChannels | string): void => {
    ipcRenderer.removeAllListeners(channel as string)
  }
}

const webFrameAPI = {
  setZoomFactor: (factor: number): void => {
    if (typeof factor === 'number' && factor > 0) webFrame.setZoomFactor(factor)
  },
  setZoomLevel: (level: number): void => {
    if (typeof level === 'number') webFrame.setZoomLevel(level)
  }
}

const windowControlAPI = {
  minimize: () => send('mt::win::minimize'),
  maximize: () => send('mt::win::maximize'),
  unmaximize: () => send('mt::win::unmaximize'),
  toggleMaximize: () => send('mt::win::toggle-maximize'),
  close: () => send('mt::win::close'),
  setFullScreen: (flag: boolean) => send('mt::win::set-fullscreen', flag),
  toggleFullScreen: () => send('mt::win::toggle-fullscreen'),
  isMaximized: () => invoke('mt::win::is-maximized'),
  isFullScreen: () => invoke('mt::win::is-fullscreen'),
  popupMenu: (template: unknown, position?: { x: number; y: number }) =>
    send('mt::menu::popup', template as never, position),
  popupApplicationMenu: (position?: { x: number; y: number }) =>
    send('mt::menu::popup-application', position)
}

// These three predicates are pure path-string operations: implementing them
// in the preload keeps them synchronous so existing call sites like
// `tabs.find(t => isSamePathSync(t.pathname, ...))` keep returning the right
// item instead of a truthy Promise.
const MARKDOWN_EXTENSIONS = [
  'markdown',
  'mdown',
  'mkdn',
  'md',
  'mkd',
  'mdwn',
  'mdtxt',
  'mdtext',
  'mdx',
  'text',
  'txt'
] as const

const hasMarkdownExtension = (filename: string): boolean => {
  if (!filename || typeof filename !== 'string') return false
  return MARKDOWN_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(`.${ext}`))
}

const isChildOfDirectory = (dir: string, child: string): boolean => {
  if (!dir || !child) return false
  const relative = pathe.relative(dir, child)
  return !!relative && !relative.startsWith('..') && !pathe.isAbsolute(relative)
}

const isSamePathSync = (pathA: string, pathB: string, isNormalized: boolean = false): boolean => {
  if (!pathA || !pathB) return false
  const a = isNormalized ? pathA : pathe.normalize(pathA)
  const b = isNormalized ? pathB : pathe.normalize(pathB)
  if (a.length !== b.length) return false
  if (a === b) return true
  if (a.toLowerCase() === b.toLowerCase()) {
    // Case-insensitive filesystem fallback — block briefly on a sync IPC
    // because callers (tab matching) need a boolean answer right now.
    try {
      return ipcRenderer.sendSync('mt::paths::is-same-sync', a, b)
    } catch {
      return false
    }
  }
  return false
}

const fileUtilsAPI = {
  // Pure-string predicates — synchronous, no IPC for the common case.
  isChildOfDirectory,
  hasMarkdownExtension,
  isSamePathSync,
  MARKDOWN_INCLUSIONS: bootInfo?.MARKDOWN_INCLUSIONS || []
}

const i18nAPI = {
  loadTranslations: (language: string) => invoke('mt::i18n::load', language)
}

const ripgrepAPI = {
  start: (request: ProjectSearchRequest) =>
    invoke('mt::rg::start', request),
  cancel: (searchId: string) => send('mt::rg::cancel', searchId),
  onMatch: (handler: (payload: ProjectSearchMatchEnvelope) => void) => {
    const sub = (_e: IpcRendererEvent, payload: ProjectSearchMatchEnvelope) =>
      handler(payload)
    ipcRenderer.on('mt::rg::match', sub)
    return () => ipcRenderer.removeListener('mt::rg::match', sub)
  },
  onProgress: (handler: (payload: ProjectSearchProgressEnvelope) => void) => {
    const sub = (_e: IpcRendererEvent, payload: ProjectSearchProgressEnvelope) =>
      handler(payload)
    ipcRenderer.on('mt::rg::progress', sub)
    return () => ipcRenderer.removeListener('mt::rg::progress', sub)
  },
  onDone: (handler: (payload: ProjectSearchTerminalEnvelope) => void) => {
    const sub = (_e: IpcRendererEvent, payload: ProjectSearchTerminalEnvelope) =>
      handler(payload)
    ipcRenderer.on('mt::rg::done', sub)
    return () => ipcRenderer.removeListener('mt::rg::done', sub)
  },
  onError: (handler: (payload: ProjectSearchErrorEnvelope) => void) => {
    const sub = (_e: IpcRendererEvent, payload: ProjectSearchErrorEnvelope) =>
      handler(payload)
    ipcRenderer.on('mt::rg::error', sub)
    return () => ipcRenderer.removeListener('mt::rg::error', sub)
  },
  onCancelled: (handler: (payload: ProjectSearchTerminalEnvelope) => void) => {
    const sub = (_e: IpcRendererEvent, payload: ProjectSearchTerminalEnvelope) =>
      handler(payload)
    ipcRenderer.on('mt::rg::cancelled', sub)
    return () => ipcRenderer.removeListener('mt::rg::cancelled', sub)
  }
}

const uploaderAPI = {
  uploadImage: (request: UploaderUploadRequest) =>
    invoke('mt::uploader::upload', request),
  inspectAvailability: (request: UploaderAvailabilityRequest) =>
    invoke('mt::uploader::availability', request),
  copyDeletionUrl: (request: UploaderDeletionClipboardRequest) =>
    invoke('mt::uploader::copy-deletion-url', request)
}

const fontsAPI = {
  list: () => invoke('mt::fonts::list')
}

const electronAPI = {
  buildCommit: bootInfo?.buildCommit ?? 'unavailable',
  ipcRenderer: ipcWrapper,
  webFrame: webFrameAPI,
  process: {
    platform: bootInfo?.platform || process.platform,
    arch: bootInfo?.arch,
    versions: bootInfo?.versions || {},
    env: bootInfo?.env || {},
    resourcesPath: bootInfo?.paths?.resources,
    cwd: bootInfo?.paths?.cwd
  },
  paths: bootInfo?.paths || {},
  isUpdatable: !!bootInfo?.isUpdatable,
  windowControl: windowControlAPI
}

// Expose a Node-`path`-compatible API to the renderer. `pathe` is a
// cross-platform reimplementation that always uses `/` separators and works
// inside a sandboxed renderer.
const pathAPI = {
  basename: (...args: Parameters<typeof pathe.basename>) => pathe.basename(...args),
  dirname: (...args: Parameters<typeof pathe.dirname>) => pathe.dirname(...args),
  extname: (...args: Parameters<typeof pathe.extname>) => pathe.extname(...args),
  join: (...args: string[]) => pathe.join(...args),
  resolve: (...args: string[]) => pathe.resolve(...args),
  relative: (...args: Parameters<typeof pathe.relative>) => pathe.relative(...args),
  isAbsolute: (...args: Parameters<typeof pathe.isAbsolute>) => pathe.isAbsolute(...args),
  normalize: (...args: Parameters<typeof pathe.normalize>) => pathe.normalize(...args),
  parse: (...args: Parameters<typeof pathe.parse>) => pathe.parse(...args),
  format: (...args: Parameters<typeof pathe.format>) => pathe.format(...args),
  sep: pathe.sep,
  delimiter: pathe.delimiter
  // Note: `pathe.posix` / `pathe.win32` are intentionally not exposed.
  // Each contains a self-reference (`pathe.posix.posix === pathe.posix`),
  // which breaks structured cloning inside `contextBridge.exposeInMainWorld`.
  // No code in this repo reads `window.path.posix` / `window.path.win32`.
}

// Bundled third-party packages occasionally read `process.platform` at module
// load time (e.g. @hfelix/electron-localshortcut/src/utils.js). Expose a
// minimal browser-safe `process` global so those imports don't throw before
// the Vue app can mount.
const processShim = {
  platform: bootInfo?.platform || process.platform,
  arch: bootInfo?.arch,
  versions: bootInfo?.versions || {},
  env: bootInfo?.env || {},
  resourcesPath: bootInfo?.paths?.resources,
  cwd: () => bootInfo?.paths?.cwd,
  // Some libraries call `process.nextTick`; map it to the microtask queue.
  nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
    Promise.resolve().then(() => fn(...args))
}

try {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('process', processShim)
  contextBridge.exposeInMainWorld('fileUtils', fileUtilsAPI)
  contextBridge.exposeInMainWorld('path', pathAPI)
  contextBridge.exposeInMainWorld('i18nUtils', i18nAPI)
  contextBridge.exposeInMainWorld('ripgrep', ripgrepAPI)
  contextBridge.exposeInMainWorld('uploader', uploaderAPI)
  contextBridge.exposeInMainWorld('fonts', fontsAPI)
} catch (error) {
  console.error(error)
}
