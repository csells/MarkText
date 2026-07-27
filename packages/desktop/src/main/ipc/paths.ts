import { ipcMain } from 'electron'
import { isSamePathSync } from 'common/filesystem/paths'

export const registerPathHandlers = (): void => {
  // The renderer's preload computes isChildOfDirectory / hasMarkdownExtension
  // locally (pure string ops, no IPC). Only `is-same-sync` requires fs in
  // the rare case-insensitive path check.
  ipcMain.on('mt::paths::is-same-sync', (event, a: string, b: string) => {
    event.returnValue = isSamePathSync(a, b, true)
  })
}
