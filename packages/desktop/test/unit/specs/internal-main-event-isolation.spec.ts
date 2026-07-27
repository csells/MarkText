import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const desktopRoot = path.resolve(__dirname, '../../..')
const source = (relative: string): string =>
  readFileSync(path.join(desktopRoot, relative), 'utf8')

const sourceTree = (relative: string): string => {
  const root = path.join(desktopRoot, relative)
  const visit = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) return visit(absolute)
      return entry.isFile() && entry.name.endsWith('.ts')
        ? [readFileSync(absolute, 'utf8')]
        : []
    })
  return visit(root).join('\n')
}

const INTERNAL_CHANNELS = Object.freeze([
  'app-create-editor-window',
  'app-create-settings-window',
  'app-new-untitled-tab-by-id',
  'app-open-directory-by-id',
  'app-open-file-by-id',
  'app-open-files-by-id',
  'app-open-markdown-by-id',
  'broadcast-preferences-changed',
  'broadcast-user-data-changed',
  'menu-add-recently-used',
  'menu-clear-recently-used',
  'screen-capture',
  'set-user-preference',
  'watcher-unwatch-all-by-id',
  'watcher-unwatch-directory',
  'watcher-unwatch-file',
  'watcher-watch-directory',
  'watcher-watch-file',
  'window-add-file-path',
  'window-change-file-path',
  'window-close-by-id',
  'window-file-saved',
  'window-remove-file-path',
  'window-reload-by-id',
  'window-toggle-always-on-top'
])

describe('main-only event isolation', () => {
  it('uses a private in-process emitter rather than Electron renderer IPC', () => {
    const internalBus = source('src/main/utils/internalIpc.ts')
    expect(internalBus).not.toContain("from 'electron'")
    expect(internalBus).not.toContain('ipcMain')

    const mainSources = sourceTree('src/main')
    expect(mainSources).not.toContain('ipcMain.emit(')
  })

  it('does not publish main-only channel names through the preload send contract', () => {
    const ipcTypes = source('src/shared/types/ipc.ts')
    const sendStart = ipcTypes.indexOf('export interface IpcSendChannels')
    const sendEnd = ipcTypes.indexOf(
      '// =================================================================\\n' +
      '// Sync channels',
      sendStart
    )
    const rendererSendContract = ipcTypes.slice(sendStart, sendEnd)
    for (const channel of INTERNAL_CHANNELS) {
      expect(rendererSendContract, channel).not.toContain(`'${channel}'`)
    }
  })
})
