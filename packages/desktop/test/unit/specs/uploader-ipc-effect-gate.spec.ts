import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((
      channel: string,
      handler: (...args: unknown[]) => unknown
    ) => handlers.set(channel, handler))
  }
}))

const { registerUploaderHandlers } =
  await import('main_renderer/ipc/uploader')

describe('uploader IPC effect gate', () => {
  beforeEach(() => handlers.clear())

  it('rejects renderer uploader, CLI, and document-path authority before all effects', async() => {
    const describeDocument = vi.fn()
    const readSettings = vi.fn()
    const resolvePicgoExecutable = vi.fn()
    const executeFile = vi.fn()
    registerUploaderHandlers({
      describeDocument,
      readSettings,
      resolvePicgoExecutable,
      executeFile
    })
    const handler = handlers.get('mt::uploader::upload')

    await expect(handler?.(
      { sender: { id: 7 } },
      {
        pathname: '/notes/renderer-owned.md',
        image: '/tmp/cat.png',
        isPath: true,
        preferences: {
          currentUploader: 'cliScript',
          cliScript: '/tmp/attacker'
        }
      }
    )).rejects.toThrow(/closed|schema|field/i)

    expect(describeDocument).not.toHaveBeenCalled()
    expect(readSettings).not.toHaveBeenCalled()
    expect(resolvePicgoExecutable).not.toHaveBeenCalled()
    expect(executeFile).not.toHaveBeenCalled()
  })

  it('stops a forged opaque document identity before settings or process access', async() => {
    const describeDocument = vi.fn(() => {
      throw new Error('foreign document')
    })
    const readSettings = vi.fn()
    const resolvePicgoExecutable = vi.fn()
    const executeFile = vi.fn()
    registerUploaderHandlers({
      describeDocument,
      readSettings,
      resolvePicgoExecutable,
      executeFile
    })
    const handler = handlers.get('mt::uploader::upload')
    const sender = { id: 41 }

    await expect(handler?.(
      { sender },
      {
        schema: 'uploader-upload-1',
        documentId: 'document:spoofed',
        source: {
          kind: 'binary',
          name: 'cat.png',
          mediaType: 'image/png',
          bytes: new Uint8Array([
            0x89, 0x50, 0x4e, 0x47,
            0x0d, 0x0a, 0x1a, 0x0a
          ])
        }
      }
    )).rejects.toThrow(/foreign/i)

    expect(describeDocument).toHaveBeenCalledWith(
      sender,
      'document:spoofed'
    )
    expect(readSettings).not.toHaveBeenCalled()
    expect(resolvePicgoExecutable).not.toHaveBeenCalled()
    expect(executeFile).not.toHaveBeenCalled()
  })

  it('decodes availability requests before executable lookup', async() => {
    const resolvePicgoExecutable = vi.fn()
    registerUploaderHandlers({
      describeDocument: vi.fn(),
      readSettings: vi.fn(),
      resolvePicgoExecutable,
      executeFile: vi.fn()
    })
    const handler = handlers.get('mt::uploader::availability')

    await expect(handler?.(
      { sender: { id: 7 } },
      {
        schema: 'uploader-availability-1',
        kind: 'picgo',
        executablePath: '/renderer/injected'
      }
    )).rejects.toThrow(/closed|field/i)

    expect(resolvePicgoExecutable).not.toHaveBeenCalled()
  })
})
