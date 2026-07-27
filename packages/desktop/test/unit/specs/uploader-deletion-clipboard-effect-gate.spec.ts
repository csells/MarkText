import { beforeEach, describe, expect, it, vi } from 'vitest'

const { clipboardWriteText, handlers } = vi.hoisted(() => ({
  clipboardWriteText: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  clipboard: {
    writeText: clipboardWriteText
  },
  ipcMain: {
    handle: vi.fn((
      channel: string,
      handler: (...args: unknown[]) => unknown
    ) => handlers.set(channel, handler))
  }
}))

const { registerUploaderDeletionClipboardHandler } =
  await import('main_renderer/ipc/uploaderDeletionClipboard')

describe('uploader deletion clipboard IPC effect gate', () => {
  beforeEach(() => {
    clipboardWriteText.mockReset()
    handlers.clear()
  })

  it('rejects renderer-supplied deletion material before consume or write', async() => {
    const consume = vi.fn()
    registerUploaderDeletionClipboardHandler({
      consume
    })
    const handler = handlers.get('mt::uploader::copy-deletion-url')

    await expect(handler?.(
      { sender: { id: 7 } },
      {
        schema: 'uploader-deletion-clipboard-request-1',
        token: 'token:owned',
        url: 'https://attacker.example/delete/forged'
      }
    )).rejects.toThrow(/closed|field/i)

    expect(consume).not.toHaveBeenCalled()
    expect(clipboardWriteText).not.toHaveBeenCalled()
  })

  it('writes only main-retained material and consumes the capability once', async() => {
    const consume = vi.fn((
      senderId: number,
      token: string
    ) => {
      expect(senderId).toBe(11)
      expect(token).toBe('token:owned')
      return 'https://images.example/delete/secret'
    })
    registerUploaderDeletionClipboardHandler({
      consume
    })
    const handler = handlers.get('mt::uploader::copy-deletion-url')

    await expect(handler?.(
      { sender: { id: 11 } },
      {
        schema: 'uploader-deletion-clipboard-request-1',
        token: 'token:owned'
      }
    )).resolves.toEqual({
      schema: 'uploader-deletion-clipboard-receipt-1',
      kind: 'written'
    })

    expect(consume).toHaveBeenCalledOnce()
    expect(clipboardWriteText)
      .toHaveBeenCalledOnce()
    expect(clipboardWriteText)
      .toHaveBeenCalledWith('https://images.example/delete/secret')
  })
})
