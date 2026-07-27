import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  clipboard: {
    readHTML: vi.fn(),
    readText: vi.fn()
  },
  ipcMain: {
    handle: vi.fn((
      channel: string,
      handler: (...args: unknown[]) => unknown
    ) => handlers.set(channel, handler))
  }
}))

const { registerDocumentClipboardPasteHandler } =
  await import('main_renderer/ipc/documentClipboardPaste')
const {
  createDocumentClipboardHtmlAuthority,
  encodeDocumentClipboardHtml
} = await import('main_renderer/ipc/documentClipboardHtmlAuthority')

const target = Object.freeze({
  session: 'session:owned',
  revision: 'revision:current',
  view: 'markup',
  anchor: Object.freeze({ offset: 3, affinity: 'previous' }),
  focus: Object.freeze({ offset: 8, affinity: 'next' })
})

const request = Object.freeze({
  schema: 'document-clipboard-paste-1',
  documentId: 'document:owned',
  baseSnapshotId: 'snapshot:current',
  target
})

describe('document clipboard paste IPC effect gate', () => {
  beforeEach(() => handlers.clear())

  it('rejects renderer text before revision checks, reads, or dispatch', async() => {
    const assertRevision = vi.fn()
    const readText = vi.fn()
    const dispatch = vi.fn()
    registerDocumentClipboardPasteHandler({
      assertRevision,
      readHtml: vi.fn(() => ''),
      readText,
      dispatch
    })
    const handler = handlers.get('mt::document::paste-clipboard')

    await expect(handler?.(
      { sender: { id: 7 } },
      {
        ...request,
        text: 'renderer-forged clipboard material'
      }
    )).rejects.toThrow(/closed|field/i)

    expect(assertRevision).not.toHaveBeenCalled()
    expect(readText).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('authenticates the owner and revision before reading the OS clipboard', async() => {
    const assertRevision = vi.fn(async() => {
      throw new Error('foreign or stale document target')
    })
    const readText = vi.fn(() => 'must not be observed')
    const readHtml = vi.fn(() => '<p>must not be observed</p>')
    const dispatch = vi.fn()
    registerDocumentClipboardPasteHandler({
      assertRevision,
      readHtml,
      readText,
      dispatch
    })
    const handler = handlers.get('mt::document::paste-clipboard')

    await expect(handler?.(
      { sender: { id: 19 } },
      request
    )).rejects.toThrow(/foreign|stale/i)

    expect(readHtml).not.toHaveBeenCalled()
    expect(readText).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('prefers exact authenticated source retained in OS clipboard HTML', async() => {
    const sender = { id: 23 }
    const assertRevision = vi.fn(async() => {})
    const readHtml = vi.fn(() =>
      encodeDocumentClipboardHtml(
        '{++exact source++}',
        '<p>projected plain text</p>'
      )
    )
    const readText = vi.fn(() => 'projected plain text')
    const publication = Object.freeze({
      baseSnapshotId: 'snapshot:current',
      envelope: Object.freeze({})
    })
    const dispatch = vi.fn(async() => publication as never)
    registerDocumentClipboardPasteHandler({
      assertRevision,
      readHtml,
      readText,
      dispatch
    })
    const handler = handlers.get('mt::document::paste-clipboard')

    await expect(handler?.({ sender }, request)).resolves.toBe(publication)

    expect(assertRevision).toHaveBeenCalledWith(
      sender,
      'document:owned',
      'revision:current'
    )
    expect(assertRevision.mock.invocationCallOrder[0])
      .toBeLessThan(readHtml.mock.invocationCallOrder[0])
    expect(readText).not.toHaveBeenCalled()
    expect(readHtml).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledWith(sender, {
      documentId: 'document:owned',
      baseSnapshotId: 'snapshot:current',
      intent: {
        kind: 'paste-text',
        target,
        text: '{++exact source++}',
        source: 'raw-source-import'
      }
    })
  })

  it('rejects a malformed private HTML envelope without downgrading to plain text', async() => {
    const readText = vi.fn(() => 'projected plain text')
    const dispatch = vi.fn()
    const malformed = encodeDocumentClipboardHtml('{++exact++}')
      .replace('-->', '')
    registerDocumentClipboardPasteHandler({
      assertRevision: vi.fn(async() => {}),
      readHtml: vi.fn(() => malformed),
      readText,
      dispatch
    })
    const handler = handlers.get('mt::document::paste-clipboard')

    await expect(handler?.(
      { sender: { id: 27 } },
      request
    )).rejects.toThrow(/clipboard html envelope/i)

    expect(readText).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('treats a foreign signed envelope as external OS plain text', async() => {
    const sender = { id: 28 }
    const foreignAuthority = createDocumentClipboardHtmlAuthority(
      Uint8Array.from({ length: 32 }, (_, index) => 255 - index)
    )
    const readText = vi.fn(() => '{++external text++}')
    const publication = Object.freeze({
      baseSnapshotId: 'snapshot:current',
      envelope: Object.freeze({})
    })
    const dispatch = vi.fn(async() => publication as never)
    registerDocumentClipboardPasteHandler({
      assertRevision: vi.fn(async() => {}),
      readHtml: vi.fn(() =>
        foreignAuthority.encode('{++foreign raw source++}')
      ),
      readText,
      dispatch
    })
    const handler = handlers.get('mt::document::paste-clipboard')

    await expect(handler?.({ sender }, request)).resolves.toBe(publication)

    expect(readText).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledWith(sender, {
      documentId: 'document:owned',
      baseSnapshotId: 'snapshot:current',
      intent: {
        kind: 'paste-text',
        target,
        text: '{++external text++}',
        source: 'external-text'
      }
    })
  })

  it('falls back to OS plain text when no private HTML envelope exists', async() => {
    const sender = { id: 29 }
    const assertRevision = vi.fn(async() => {})
    const readHtml = vi.fn(() => '<p>external plain text</p>')
    const readText = vi.fn(() => 'external plain text')
    const publication = Object.freeze({
      baseSnapshotId: 'snapshot:current',
      envelope: Object.freeze({})
    })
    const dispatch = vi.fn(async() => publication as never)
    registerDocumentClipboardPasteHandler({
      assertRevision,
      readHtml,
      readText,
      dispatch
    })
    const handler = handlers.get('mt::document::paste-clipboard')

    await expect(handler?.({ sender }, request)).resolves.toBe(publication)

    expect(readHtml).toHaveBeenCalledOnce()
    expect(readText).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledWith(sender, {
      documentId: 'document:owned',
      baseSnapshotId: 'snapshot:current',
      intent: {
        kind: 'paste-text',
        target,
        text: 'external plain text',
        source: 'external-text'
      }
    })
  })
})
