import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'
import type { WindowClosePreparedReply } from '@shared/types/ipc'

let nextRequestId = 0
const preparingWindows = new WeakMap<BrowserWindow, number>()

export const isWindowPreparingToClose = (win: BrowserWindow): boolean => preparingWindows.has(win)

ipcMain.on('mt::window-close-resumed', (event, requestId: number) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win !== null && win.webContents === event.sender && preparingWindows.get(win) === requestId) { preparingWindows.delete(win) }
})

/** The renderer holds input ownership retired until cancellation or destruction. */
export const prepareWindowClose = (win: BrowserWindow) => {
  const requestId = ++nextRequestId
  preparingWindows.set(win, requestId)
  const ready = new Promise<Extract<WindowClosePreparedReply, { files: unknown }>>(
    (resolve, reject) => {
      const cleanup = (): void => {
        ipcMain.removeListener('mt::window-close-prepared', onReply)
        win.webContents.removeListener('destroyed', onDestroyed)
        win.webContents.removeListener('render-process-gone', onDestroyed)
      }
      const onReply = (event: IpcMainEvent, reply: WindowClosePreparedReply): void => {
        if (event.sender !== win.webContents || reply.requestId !== requestId) return
        cleanup()
        if ('error' in reply) reject(new Error(reply.error))
        else resolve(reply)
      }
      const onDestroyed = (): void => {
        cleanup()
        reject(new Error('Editor exited before preserving input for close'))
      }
      ipcMain.on('mt::window-close-prepared', onReply)
      win.webContents.once('destroyed', onDestroyed)
      win.webContents.once('render-process-gone', onDestroyed)
      try {
        win.webContents.send('mt::prepare-window-close', requestId)
      } catch (error) {
        cleanup()
        reject(error)
      }
    }
  )
  return { requestId, ready }
}
