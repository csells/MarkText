import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
const runtime = vi.hoisted(() => ({ ipc: undefined as unknown as EventEmitter }))
vi.mock('electron', async() => {
  const { EventEmitter } = await import('node:events')
  runtime.ipc = new EventEmitter()
  return { ipcMain: runtime.ipc }
})
import { requestReviewContext } from '../../../src/main/contextMenu/editor/reviewContext'

afterEach(() => { vi.useRealTimers() })
function windowFixture() {
  const webContents = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => false })
  return { webContents, win: { webContents } as unknown as BrowserWindow }
}

describe('native review context request ownership', () => {
  it('ignores another window and releases request listeners after the matching reply', async() => {
    const { webContents, win } = windowFixture()
    const pending = requestReviewContext(win, 12, 34)
    const request = webContents.send.mock.calls[0][1]
    runtime.ipc.emit('mt::review-context-reply', { sender: {} }, { requestId: request.requestId, commands: ['remove'] })
    expect(runtime.ipc.listenerCount('mt::review-context-reply')).toBe(1)
    runtime.ipc.emit('mt::review-context-reply', { sender: webContents }, { requestId: request.requestId, commands: ['accept'] })
    await expect(pending).resolves.toEqual({ requestId: request.requestId, commands: ['accept'] })
    expect(runtime.ipc.listenerCount('mt::review-context-reply')).toBe(0)
    expect(webContents.listenerCount('destroyed')).toBe(0)
  })
  it('reports renderer failure, clears the renderer target, and releases listeners', async() => {
    const { webContents, win } = windowFixture()
    const pending = requestReviewContext(win, 12, 34)
    const request = webContents.send.mock.calls[0][1]
    runtime.ipc.emit('mt::review-context-reply', { sender: webContents }, { requestId: request.requestId, error: 'Core failure' })
    await expect(pending).rejects.toThrow('Core failure')
    expect(webContents.send).toHaveBeenLastCalledWith('mt::editor-review-context-closed', request.requestId)
    expect(runtime.ipc.listenerCount('mt::review-context-reply')).toBe(0)
    expect(webContents.listenerCount('destroyed')).toBe(0)
  })
  it('bounds an unavailable renderer and releases pending ownership', async() => {
    vi.useFakeTimers()
    const { webContents, win } = windowFixture()
    const pending = requestReviewContext(win, 12, 34)
    const rejected = expect(pending).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(3000)
    await rejected
    expect(runtime.ipc.listenerCount('mt::review-context-reply')).toBe(0)
    expect(webContents.listenerCount('destroyed')).toBe(0)
  })
  it('immediately cleans up when sending the initial request throws and preserves that error', async() => {
    vi.useFakeTimers()
    const { webContents, win } = windowFixture()
    const failure = new Error('Renderer disconnected during send')
    webContents.send.mockImplementation(() => { throw failure })
    await expect(requestReviewContext(win, 12, 34)).rejects.toBe(failure)
    expect(runtime.ipc.listenerCount('mt::review-context-reply')).toBe(0)
    expect(webContents.listenerCount('destroyed')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(3000)
    expect(webContents.send).toHaveBeenCalledOnce()
  })
  it('releases listeners and timer when the requesting renderer is destroyed', async() => {
    vi.useFakeTimers()
    const { webContents, win } = windowFixture()
    const pending = requestReviewContext(win, 12, 34)
    webContents.emit('destroyed')
    await expect(pending).resolves.toBeUndefined()
    expect(runtime.ipc.listenerCount('mt::review-context-reply')).toBe(0)
    expect(webContents.listenerCount('destroyed')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
