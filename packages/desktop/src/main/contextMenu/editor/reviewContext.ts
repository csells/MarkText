import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron'
import log from 'electron-log'
import type { ReviewContextReply } from '../../../common/commands/review'

let nextRequest = 0

/** Native menu construction waits for a reply from this window's document owner. */
export const requestReviewContext = (win: BrowserWindow, x: number, y: number): Promise<ReviewContextReply | undefined> => {
  const requestId = ++nextRequest
  return new Promise((resolve, reject) => {
    const finish = (reply?: ReviewContextReply, error?: unknown, notify = true): void => {
      clearTimeout(timer)
      ipcMain.removeListener('mt::review-context-reply', onReply)
      win.webContents.removeListener('destroyed', onDestroyed)
      if (error !== undefined) {
        if (notify && !win.webContents.isDestroyed()) {
          try { win.webContents.send('mt::editor-review-context-closed', requestId) } catch (cleanupError) {
            log.error('Unable to clear failed review context request', cleanupError)
          }
        }
        reject(error)
      } else resolve(reply)
    }
    const onReply = (event: IpcMainEvent, reply: ReviewContextReply): void => {
      if (event.sender !== win.webContents || reply.requestId !== requestId) return
      finish(reply, reply.error ? new Error(reply.error) : undefined)
    }
    const onDestroyed = (): void => finish()
    const timer = setTimeout(() => finish(undefined, new Error('Review context request timed out')), 3000)
    ipcMain.on('mt::review-context-reply', onReply)
    win.webContents.once('destroyed', onDestroyed)
    try { win.webContents.send('mt::editor-review-context-request', { requestId, x, y }) } catch (error) {
      finish(undefined, error, false)
    }
  })
}
