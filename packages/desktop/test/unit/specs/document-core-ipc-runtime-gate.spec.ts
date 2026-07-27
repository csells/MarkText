import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  clipboardWrite,
  createMainHost,
  createStaticSinkHost,
  showSaveDialog
} = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  clipboardWrite: vi.fn(),
  createMainHost: vi.fn(),
  createStaticSinkHost: vi.fn(),
  showSaveDialog: vi.fn()
}))

const hostMethods = Object.freeze({
  startDispatch: vi.fn(),
  reconfigureMarkdownOptions: vi.fn(),
  completeDispatch: vi.fn(),
  cancelDispatch: vi.fn(),
  select: vi.fn(),
  assertRevision: vi.fn(),
  materializeClipboard: vi.fn(),
  completeCut: vi.fn(),
  close: vi.fn(),
  detach: vi.fn()
})
const staticExecute = vi.fn()
const exportOptions = Object.freeze({
  title: 'Review',
  page: Object.freeze({
    size: Object.freeze({ kind: 'named' as const, name: 'A4' as const }),
    landscape: false,
    marginsMm: Object.freeze({
      top: 20,
      right: 15,
      bottom: 20,
      left: 15
    })
  }),
  theme: Object.freeze({
    kind: 'built-in' as const,
    name: 'default' as const
  }),
  typography: null,
  autoNumberHeadings: false,
  showFrontMatter: false,
  toc: Object.freeze({ title: '', includeTopHeading: true }),
  header: null,
  footer: null,
  headerFooterAppearance: null
})

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/marktext-ipc-gate') },
  BrowserWindow: {
    fromWebContents: vi.fn(() => ({ webContents: {} }))
  },
  clipboard: {
    write: clipboardWrite,
    writeText: clipboardWrite
  },
  ipcMain: {
    handle: vi.fn((
      channel: string,
      handler: (...args: unknown[]) => unknown
    ) => handlers.set(channel, handler))
  }
}))
vi.mock('main_renderer/documentCore/durableSessionJournalStorage', () => ({
  createFileDocumentSessionJournalStorage: vi.fn(() => ({}))
}))
vi.mock('main_renderer/documentCore/electronStaticSinkSurface', () => ({
  createElectronDocumentCoreStaticSinkSurface: vi.fn(() => ({}))
}))
vi.mock('main_renderer/documentCore/mainSessionHost', () => ({
  consumeDocumentCoreHostHtml: vi.fn(),
  createDocumentCoreMainSessionHost: createMainHost
}))
vi.mock('main_renderer/documentCore/staticSinkHost', () => ({
  createDocumentCoreStaticSinkHost: createStaticSinkHost
}))
vi.mock('main_renderer/presentationPolicy', () => ({
  presentationPolicy: { showSaveDialog }
}))

const { registerDocumentCoreHandlers } =
  await import('main_renderer/ipc/documentCore')
const { decodeDocumentClipboardHtml } =
  await import('main_renderer/ipc/documentClipboardHtmlAuthority')

const channels = Object.freeze([
  'mt::document-core::attach',
  'mt::document-core::save',
  'mt::document-core::write-clipboard',
  'mt::document-core::open-link',
  'mt::document-core::dispatch-start',
  'mt::document-core::reconfigure-markdown-options',
  'mt::document-core::dispatch-complete',
  'mt::document-core::dispatch-cancel',
  'mt::document-core::select',
  'mt::document-core::materialize-static'
])

describe('document-core IPC runtime effect gate', () => {
  beforeEach(() => {
    handlers.clear()
    clipboardWrite.mockReset()
    staticExecute.mockReset()
    showSaveDialog.mockReset()
    for (const method of Object.values(hostMethods)) method.mockReset()
    createMainHost.mockReset().mockReturnValue(hostMethods)
    createStaticSinkHost.mockReset().mockReturnValue({
      execute: staticExecute
    })
    registerDocumentCoreHandlers()
  })

  it.each(channels)(
    'rejects malformed %s input before attaching or performing any effect',
    async(channel) => {
      const handler = handlers.get(channel)
      expect(handler).toBeDefined()
      const once = vi.fn()
      const event = { sender: { id: 7, once } }

      await expect(Promise.resolve().then(
        () => handler?.(event, { injected: true })
      )).rejects.toThrow(/document-core|invalid|closed|fields/i)

      expect(once).not.toHaveBeenCalled()
      expect(createMainHost).not.toHaveBeenCalled()
      expect(createStaticSinkHost).not.toHaveBeenCalled()
      expect(clipboardWrite).not.toHaveBeenCalled()
      for (const method of Object.values(hostMethods)) {
        expect(method).not.toHaveBeenCalled()
      }
      expect(staticExecute).not.toHaveBeenCalled()
    }
  )

  it('rejects stale clipboard materialization before writing the OS clipboard', async() => {
    hostMethods.materializeClipboard.mockResolvedValue({
      kind: 'materialized',
      revision: { id: 'revision:current' },
      artifact: {
        kind: 'clipboard-text',
        plainText: 'authenticated'
      }
    })
    const handler = handlers.get('mt::document-core::write-clipboard')
    const event = { sender: { id: 7, once: vi.fn() } }

    await expect(handler?.(event, {
      documentId: 'document:1',
      revisionId: 'revision:stale',
      view: 'markup',
      consumer: 'copy-markdown',
      selection: { start: 0, end: 4 }
    })).rejects.toThrow(/stale|revision/i)

    expect(clipboardWrite).not.toHaveBeenCalled()
  })

  it('writes only the parser-materialized heading link for an opaque node target', async() => {
    hostMethods.materializeClipboard.mockResolvedValue({
      kind: 'materialized',
      revision: { id: 'revision:1' },
      artifact: {
        kind: 'clipboard-text',
        plainText: '#parser-owned'
      }
    })
    const handler = handlers.get('mt::document-core::write-clipboard')
    const event = { sender: { id: 7, once: vi.fn() } }

    await expect(handler?.(event, {
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'markup',
      consumer: 'copy-heading-link',
      targetNodeId: 'p1:heading:1'
    })).resolves.toEqual({
      kind: 'written',
      consumer: 'copy-heading-link'
    })

    expect(hostMethods.materializeClipboard).toHaveBeenCalledWith(
      'renderer:7',
      'document:1',
      'revision:1',
      {
        view: 'markup',
        consumer: 'copy-heading-link',
        targetNodeId: 'p1:heading:1'
      }
    )
    expect(clipboardWrite).toHaveBeenCalledWith('#parser-owned')
  })

  it('writes the retained core cut bundle before its one-use commit', async() => {
    const publication = {
      baseSnapshotId: 'snapshot:before-cut',
      envelope: { schema: 'wire-envelope-1' }
    }
    hostMethods.materializeClipboard.mockResolvedValue({
      kind: 'materialized',
      revision: { id: 'revision:1' },
      artifact: {
        kind: 'cut-preparation',
        ticketId: 'cut:1',
        bundle: {
          kind: 'clipboard-bundle',
          plainText: 'ell',
          privateSource: {
            text: 'ell'
          }
        }
      }
    })
    hostMethods.completeCut.mockResolvedValue(publication)
    const handler = handlers.get('mt::document-core::write-clipboard')
    const event = { sender: { id: 7, once: vi.fn() } }

    await expect(handler?.(event, {
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'markup',
      consumer: 'cut',
      selection: { start: 1, end: 4 }
    })).resolves.toEqual({
      kind: 'cut-committed',
      consumer: 'cut',
      publication
    })

    expect(clipboardWrite).toHaveBeenCalledOnce()
    expect(clipboardWrite).toHaveBeenCalledWith({
      text: 'ell',
      html: expect.any(String)
    })
    const carrier = (
      clipboardWrite.mock.calls[0]?.[0] as { html?: unknown } | undefined
    )?.html
    expect(typeof carrier).toBe('string')
    expect(decodeDocumentClipboardHtml(carrier as string)).toEqual({
      kind: 'authenticated',
      source: 'ell'
    })
    expect(carrier).toContain('<pre>ell</pre>')
    expect(hostMethods.completeCut).toHaveBeenCalledWith(
      'renderer:7',
      'document:1',
      'cut:1',
      true
    )
    expect(
      clipboardWrite.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    ).toBeLessThan(
      hostMethods.completeCut.mock.invocationCallOrder[0] ??
        Number.NEGATIVE_INFINITY
    )
  })

  it('revokes a prepared cut when the OS clipboard write fails', async() => {
    hostMethods.materializeClipboard.mockResolvedValue({
      kind: 'materialized',
      revision: { id: 'revision:1' },
      artifact: {
        kind: 'cut-preparation',
        ticketId: 'cut:failed-write',
        bundle: {
          kind: 'clipboard-bundle',
          plainText: 'ell'
        }
      }
    })
    hostMethods.completeCut.mockResolvedValue({ kind: 'cancelled' })
    clipboardWrite.mockImplementationOnce(() => {
      throw new Error('native clipboard unavailable')
    })
    const handler = handlers.get('mt::document-core::write-clipboard')
    const event = { sender: { id: 7, once: vi.fn() } }

    await expect(handler?.(event, {
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'markup',
      consumer: 'cut',
      selection: { start: 1, end: 4 }
    })).rejects.toThrow(/clipboard unavailable/i)

    expect(hostMethods.completeCut).toHaveBeenCalledWith(
      'renderer:7',
      'document:1',
      'cut:failed-write',
      false
    )
  })

  it('does not write or authorize a cut in a read-only projection', async() => {
    hostMethods.materializeClipboard.mockResolvedValue({
      kind: 'materialized',
      revision: { id: 'revision:1' },
      artifact: {
        kind: 'disabled',
        view: 'revised',
        consumer: 'cut',
        reason: 'read-only-view'
      }
    })
    const handler = handlers.get('mt::document-core::write-clipboard')
    const event = { sender: { id: 7, once: vi.fn() } }

    await expect(handler?.(event, {
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'revised',
      consumer: 'cut',
      selection: { start: 1, end: 4 }
    })).resolves.toEqual({
      kind: 'disabled',
      consumer: 'cut',
      reason: 'read-only-view'
    })
    expect(clipboardWrite).not.toHaveBeenCalled()
  })

  it('resolves a PDF target in main before entering the one static sink path', async() => {
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/tmp/review.pdf'
    })
    staticExecute.mockResolvedValue({
      kind: 'written',
      targetPath: '/tmp/review.pdf'
    })
    const handler = handlers.get('mt::document-core::materialize-static')
    const event = { sender: { id: 7, once: vi.fn() } }

    await expect(handler?.(event, {
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'revised',
      consumer: 'pdf',
      suggestedName: 'Review',
      options: exportOptions
    })).resolves.toMatchObject({
      kind: 'written',
      targetPath: '/tmp/review.pdf'
    })

    expect(showSaveDialog).toHaveBeenCalledOnce()
    expect(hostMethods.assertRevision).toHaveBeenCalledWith(
      'renderer:7',
      'document:1',
      'revision:1'
    )
    expect(
      hostMethods.assertRevision.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    ).toBeLessThan(
      showSaveDialog.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY
    )
    expect(staticExecute).toHaveBeenCalledWith(
      'renderer:7',
      {
        documentId: 'document:1',
        revisionId: 'revision:1',
        view: 'revised',
        consumer: 'pdf',
        targetPath: '/tmp/review.pdf',
        options: exportOptions
      }
    )
  })

  it('authenticates static ownership and revision before opening a native dialog', async() => {
    hostMethods.assertRevision.mockRejectedValue(
      new Error('Static sink requested a stale or foreign revision')
    )
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/tmp/should-not-open.pdf'
    })
    const handler = handlers.get('mt::document-core::materialize-static')
    const event = { sender: { id: 7, once: vi.fn() } }

    await expect(handler?.(event, {
      documentId: 'document:foreign',
      revisionId: 'revision:stale',
      view: 'revised',
      consumer: 'pdf',
      suggestedName: 'Review',
      options: exportOptions
    })).rejects.toThrow(/stale|foreign|revision/i)

    expect(hostMethods.assertRevision).toHaveBeenCalledWith(
      'renderer:7',
      'document:foreign',
      'revision:stale'
    )
    expect(showSaveDialog).not.toHaveBeenCalled()
    expect(createStaticSinkHost).not.toHaveBeenCalled()
    expect(staticExecute).not.toHaveBeenCalled()
  })

  it('rejects forged renderer output paths before dialogs or static sinks', async() => {
    const handler = handlers.get('mt::document-core::materialize-static')
    const once = vi.fn()
    const event = { sender: { id: 7, once } }

    for (const request of [
      {
        documentId: 'document:1',
        revisionId: 'revision:1',
        view: 'markup',
        consumer: 'styled-html',
        targetPath: '/tmp/forged.html',
        options: exportOptions
      },
      {
        documentId: 'document:1',
        revisionId: 'revision:1',
        view: 'markup',
        consumer: 'pdf',
        targetPath: '/tmp/forged.pdf',
        options: exportOptions
      },
      {
        documentId: 'document:1',
        revisionId: 'revision:1',
        view: 'markup',
        consumer: 'print',
        proofPath: '/tmp/forged-print.pdf',
        options: exportOptions
      }
    ]) {
      await expect(handler?.(event, request))
        .rejects.toThrow(/targetPath|proofPath|unknown|closed|fields/i)
    }

    expect(showSaveDialog).not.toHaveBeenCalled()
    expect(once).not.toHaveBeenCalled()
    expect(createMainHost).not.toHaveBeenCalled()
    expect(createStaticSinkHost).not.toHaveBeenCalled()
    expect(staticExecute).not.toHaveBeenCalled()
  })

  it('returns a closed cancellation receipt without creating a static host', async() => {
    showSaveDialog.mockResolvedValue({
      canceled: true,
      filePath: undefined
    })
    const handler = handlers.get('mt::document-core::materialize-static')
    const once = vi.fn()
    const event = { sender: { id: 7, once } }

    await expect(handler?.(event, {
      documentId: 'document:1',
      revisionId: 'revision:1',
      view: 'revised',
      consumer: 'styled-html',
      suggestedName: 'Review',
      options: exportOptions
    })).resolves.toEqual({
      schema: 'document-core-static-sink-receipt-1',
      kind: 'cancelled',
      consumer: 'styled-html',
      view: 'revised',
      revisionId: 'revision:1'
    })

    expect(showSaveDialog).toHaveBeenCalledOnce()
    expect(once).not.toHaveBeenCalled()
    expect(createMainHost).not.toHaveBeenCalled()
    expect(createStaticSinkHost).not.toHaveBeenCalled()
    expect(staticExecute).not.toHaveBeenCalled()
  })
})
