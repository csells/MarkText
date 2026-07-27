import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  clipboard: {
    writeText: vi.fn()
  },
  ipcMain: {
    handle: vi.fn((
      channel: string,
      handler: (...args: unknown[]) => unknown
    ) => handlers.set(channel, handler))
  }
}))

const { registerDocumentPathClipboardHandler } = await import(
  'main_renderer/ipc/documentPathClipboard'
)

describe('admitted document-path clipboard effect gate', () => {
  beforeEach(() => handlers.clear())

  it('copies only the sender-admitted pathname resolved by document identity', async() => {
    const sender = { id: 41 }
    const describeDocument = vi.fn(() => ({
      documentId: 'document:owned',
      pathname: '/admitted/project/notes.md'
    }))
    const writeText = vi.fn()
    registerDocumentPathClipboardHandler({
      describeDocument,
      writeText
    })

    await expect(handlers.get('mt::document::copy-path')?.(
      { sender },
      {
        schema: 'document-path-clipboard-1',
        documentId: 'document:owned'
      }
    )).resolves.toEqual({
      schema: 'document-path-clipboard-receipt-1',
      kind: 'written'
    })

    expect(describeDocument).toHaveBeenCalledWith(
      sender,
      'document:owned'
    )
    expect(writeText).toHaveBeenCalledWith('/admitted/project/notes.md')
  })

  it('rejects renderer path/window authority before document lookup or clipboard effects', async() => {
    const describeDocument = vi.fn()
    const writeText = vi.fn()
    registerDocumentPathClipboardHandler({
      describeDocument,
      writeText
    })

    await expect(handlers.get('mt::document::copy-path')?.(
      { sender: { id: 41 } },
      {
        schema: 'document-path-clipboard-1',
        documentId: 'document:owned',
        pathname: '/private/forged.md',
        windowId: 7
      }
    )).rejects.toThrow(/closed|field/i)

    expect(describeDocument).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
  })
})
