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

const { registerDocumentImportBinaryHandler } = await import(
  'main_renderer/ipc/documentImportBinary'
)

describe('binary document-import IPC effect gate', () => {
  beforeEach(() => handlers.clear())

  it('admits dropped Markdown bytes only as a sender-owned untitled document', async() => {
    const sender = { id: 41 }
    const editor = {
      admitImportedMarkdown: vi.fn(async() => {}),
      notifyPandocUnavailable: vi.fn()
    }
    const resolveEditor = vi.fn(() => editor)
    const decodeMarkdown = vi.fn(() => '# Imported')
    const isPandocAvailable = vi.fn()
    const convertPandoc = vi.fn()
    registerDocumentImportBinaryHandler({
      resolveEditor,
      decodeMarkdown,
      isPandocAvailable,
      convertPandoc
    })
    const bytes = new Uint8Array([0x23, 0x20, 0x49])

    await expect(handlers.get('mt::document-import::binary')?.(
      { sender },
      {
        schema: 'document-import-binary-request-1',
        name: 'notes.MD',
        bytes
      }
    )).resolves.toEqual({
      schema: 'document-import-binary-receipt-1',
      disposition: 'opened-markdown'
    })

    expect(resolveEditor).toHaveBeenCalledWith(sender)
    expect(decodeMarkdown).toHaveBeenCalledWith(bytes)
    expect(editor.admitImportedMarkdown).toHaveBeenCalledWith('# Imported')
    expect(isPandocAvailable).not.toHaveBeenCalled()
    expect(convertPandoc).not.toHaveBeenCalled()
  })

  it('converts bounded non-Markdown content without exposing a renderer path', async() => {
    const editor = {
      admitImportedMarkdown: vi.fn(async() => {}),
      notifyPandocUnavailable: vi.fn()
    }
    const resolveEditor = vi.fn(() => editor)
    const decodeMarkdown = vi.fn()
    const isPandocAvailable = vi.fn(() => true)
    const convertPandoc = vi.fn(async() => '# Converted')
    registerDocumentImportBinaryHandler({
      resolveEditor,
      decodeMarkdown,
      isPandocAvailable,
      convertPandoc
    })
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])

    await expect(handlers.get('mt::document-import::binary')?.(
      { sender: { id: 41 } },
      {
        schema: 'document-import-binary-request-1',
        name: 'proposal.DOCX',
        bytes
      }
    )).resolves.toEqual({
      schema: 'document-import-binary-receipt-1',
      disposition: 'converted'
    })

    expect(isPandocAvailable).toHaveBeenCalledOnce()
    expect(convertPandoc).toHaveBeenCalledWith('docx', bytes)
    expect(editor.admitImportedMarkdown).toHaveBeenCalledWith('# Converted')
    expect(decodeMarkdown).not.toHaveBeenCalled()
  })

  it('reports unavailable Pandoc without conversion or document admission', async() => {
    const editor = {
      admitImportedMarkdown: vi.fn(),
      notifyPandocUnavailable: vi.fn()
    }
    const convertPandoc = vi.fn()
    registerDocumentImportBinaryHandler({
      resolveEditor: vi.fn(() => editor),
      decodeMarkdown: vi.fn(),
      isPandocAvailable: vi.fn(() => false),
      convertPandoc
    })

    await expect(handlers.get('mt::document-import::binary')?.(
      { sender: { id: 41 } },
      {
        schema: 'document-import-binary-request-1',
        name: 'proposal.docx',
        bytes: new Uint8Array([0x50, 0x4b])
      }
    )).resolves.toEqual({
      schema: 'document-import-binary-receipt-1',
      disposition: 'pandoc-unavailable'
    })

    expect(editor.notifyPandocUnavailable).toHaveBeenCalledOnce()
    expect(convertPandoc).not.toHaveBeenCalled()
    expect(editor.admitImportedMarkdown).not.toHaveBeenCalled()
  })

  it('rejects forged path and process fields before sender, read, or process effects', async() => {
    const resolveEditor = vi.fn()
    const decodeMarkdown = vi.fn()
    const isPandocAvailable = vi.fn()
    const convertPandoc = vi.fn()
    registerDocumentImportBinaryHandler({
      resolveEditor,
      decodeMarkdown,
      isPandocAvailable,
      convertPandoc
    })
    const handler = handlers.get('mt::document-import::binary')

    await expect(handler?.(
      { sender: { id: 41 } },
      {
        schema: 'document-import-binary-request-1',
        name: 'attacker.docx',
        bytes: new Uint8Array([0x50, 0x4b]),
        pathname: '/private/attacker-selected.docx',
        executable: '/private/attacker-selected-pandoc',
        outputPath: '/private/attacker-output.md'
      }
    )).rejects.toThrow(/closed|field/i)

    expect(resolveEditor).not.toHaveBeenCalled()
    expect(decodeMarkdown).not.toHaveBeenCalled()
    expect(isPandocAvailable).not.toHaveBeenCalled()
    expect(convertPandoc).not.toHaveBeenCalled()
  })

  it('rejects an unsupported filename before sender lookup or process probing', async() => {
    const resolveEditor = vi.fn()
    const decodeMarkdown = vi.fn()
    const isPandocAvailable = vi.fn()
    const convertPandoc = vi.fn()
    registerDocumentImportBinaryHandler({
      resolveEditor,
      decodeMarkdown,
      isPandocAvailable,
      convertPandoc
    })

    await expect(handlers.get('mt::document-import::binary')?.(
      { sender: { id: 41 } },
      {
        schema: 'document-import-binary-request-1',
        name: 'run-me.exe',
        bytes: new Uint8Array([0x4d, 0x5a])
      }
    )).rejects.toThrow(/unsupported|filename|extension/i)

    expect(resolveEditor).not.toHaveBeenCalled()
    expect(decodeMarkdown).not.toHaveBeenCalled()
    expect(isPandocAvailable).not.toHaveBeenCalled()
    expect(convertPandoc).not.toHaveBeenCalled()
  })

  it('requires a sender-owned editor before decoding or converting content', async() => {
    const decodeMarkdown = vi.fn()
    const isPandocAvailable = vi.fn()
    const convertPandoc = vi.fn()
    registerDocumentImportBinaryHandler({
      resolveEditor: vi.fn(() => null),
      decodeMarkdown,
      isPandocAvailable,
      convertPandoc
    })

    await expect(handlers.get('mt::document-import::binary')?.(
      { sender: { id: 99 } },
      {
        schema: 'document-import-binary-request-1',
        name: 'notes.md',
        bytes: new Uint8Array([0x23, 0x20, 0x58])
      }
    )).rejects.toThrow(/sender-owned editor/i)

    expect(decodeMarkdown).not.toHaveBeenCalled()
    expect(isPandocAvailable).not.toHaveBeenCalled()
    expect(convertPandoc).not.toHaveBeenCalled()
  })
})
