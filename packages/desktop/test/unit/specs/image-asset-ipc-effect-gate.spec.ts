import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => null)
  },
  ipcMain: {
    handle: vi.fn((
      channel: string,
      handler: (...args: unknown[]) => unknown
    ) => handlers.set(channel, handler))
  }
}))

const { registerImageAssetHandlers } =
  await import('main_renderer/ipc/imageAssets')

function dependencies(
  describeDocument = vi.fn()
) {
  return {
    describeDocument,
    readSettings: vi.fn(),
    assertRevision: vi.fn(async() => {}),
    dispatchDocument: vi.fn(),
    sourceCapabilities: {
      mint: vi.fn(),
      consume: vi.fn(),
      revokeSender: vi.fn()
    },
    displayCapabilities: {
      mint: vi.fn(() => 'marktext-image://asset/opaque-token'),
      resolve: vi.fn(),
      revokeSender: vi.fn()
    },
    resolveDisplayPath: vi.fn(async() => ({
      kind: 'resolved' as const,
      pathname: '/private/main-only/cat.png'
    }))
  }
}

const target = {
  session: 'session:owned',
  revision: 'revision:one',
  view: 'markup',
  anchor: { offset: 0, affinity: 'next' },
  focus: { offset: 0, affinity: 'next' }
}

describe('image asset IPC effect gate', () => {
  beforeEach(() => handlers.clear())

  it('rejects a fabricated pathname before document, stat/read, settings, or dispatch effects', async() => {
    const deps = dependencies()
    registerImageAssetHandlers(deps)
    const handler = handlers.get('mt::image-assets::insert')
    expect(handler).toBeDefined()

    await expect(handler?.(
      { sender: { id: 7 } },
      {
        schema: 'image-asset-insert-1',
        documentId: 'document:owned',
        baseSnapshotId: 'snapshot:one',
        revisionId: 'revision:one',
        target,
        source: {
          kind: 'local-file',
          pathname: '/private/attacker-chosen.png'
        },
        storage: 'configured-folder',
        alt: ''
      }
    )).rejects.toThrow(/source|kind|closed/i)

    expect(deps.describeDocument).not.toHaveBeenCalled()
    expect(deps.assertRevision).not.toHaveBeenCalled()
    expect(deps.sourceCapabilities.consume).not.toHaveBeenCalled()
    expect(deps.readSettings).not.toHaveBeenCalled()
    expect(deps.dispatchDocument).not.toHaveBeenCalled()
  })

  it('rejects destination-bearing input before every effect', async() => {
    const deps = dependencies()
    registerImageAssetHandlers(deps)
    const handler = handlers.get('mt::image-assets::insert')

    await expect(handler?.(
      { sender: { id: 7 } },
      {
        schema: 'image-asset-insert-1',
        documentId: 'document:owned',
        baseSnapshotId: 'snapshot:one',
        revisionId: 'revision:one',
        target,
        source: {
          kind: 'binary',
          name: 'cat.png',
          mediaType: 'image/png',
          bytes: new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
          ])
        },
        storage: 'configured-folder',
        alt: '',
        targetPath: '/tmp/renderer-controlled'
      }
    )).rejects.toThrow(/closed|fields/i)

    expect(deps.describeDocument).not.toHaveBeenCalled()
    expect(deps.readSettings).not.toHaveBeenCalled()
  })

  it('authenticates the sender/document before activating a tab', async() => {
    const describeDocument = vi.fn(() => {
      throw new Error('foreign document')
    })
    const deps = dependencies(describeDocument)
    registerImageAssetHandlers(deps)
    const handler = handlers.get('mt::image-assets::activate-document')
    const sender = { id: 41 }

    expect(() => handler?.(
      { sender },
      {
        schema: 'image-asset-activation-1',
        documentId: 'document:spoofed'
      }
    )).toThrow(/foreign/)

    expect(describeDocument).toHaveBeenCalledWith(
      sender,
      'document:spoofed'
    )
    expect(deps.assertRevision).not.toHaveBeenCalled()
    expect(deps.readSettings).not.toHaveBeenCalled()
  })

  it('rejects path-bearing display input before every authority or filesystem effect', async() => {
    const deps = dependencies()
    registerImageAssetHandlers(deps)
    const handler = handlers.get('mt::image-assets::resolve-display')

    await expect(handler?.(
      { sender: { id: 7 } },
      {
        schema: 'image-display-1',
        documentId: 'document:owned',
        revisionId: 'revision:one',
        reference: 'assets/cat.png',
        pathname: '/private/renderer-chosen.png'
      }
    )).rejects.toThrow(/closed|fields/i)

    expect(deps.describeDocument).not.toHaveBeenCalled()
    expect(deps.assertRevision).not.toHaveBeenCalled()
    expect(deps.resolveDisplayPath).not.toHaveBeenCalled()
    expect(deps.displayCapabilities.mint).not.toHaveBeenCalled()
  })

  it('mints display authority only after active document and revision checks', async() => {
    const document = Object.freeze({
      documentId: 'document:owned',
      filename: 'note.md',
      pathname: '/notes/note.md'
    })
    const deps = dependencies(vi.fn(() => document))
    registerImageAssetHandlers(deps)
    const sender = { id: 41 }
    handlers.get('mt::image-assets::activate-document')?.(
      { sender },
      {
        schema: 'image-asset-activation-1',
        documentId: 'document:owned'
      }
    )

    const receipt = await handlers.get(
      'mt::image-assets::resolve-display'
    )?.(
      { sender },
      {
        schema: 'image-display-1',
        documentId: 'document:owned',
        revisionId: 'revision:one',
        reference: 'assets/cat.png'
      }
    )

    expect(deps.assertRevision).toHaveBeenCalledTimes(2)
    expect(deps.resolveDisplayPath).toHaveBeenCalledWith(
      document,
      'assets/cat.png'
    )
    expect(deps.displayCapabilities.mint).toHaveBeenCalledWith({
      senderId: 41,
      documentId: 'document:owned',
      revisionId: 'revision:one',
      reference: 'assets/cat.png',
      pathname: '/private/main-only/cat.png'
    })
    expect(receipt).toEqual({
      schema: 'image-display-receipt-1',
      kind: 'resolved',
      documentId: 'document:owned',
      revisionId: 'revision:one',
      reference: 'assets/cat.png',
      src: 'marktext-image://asset/opaque-token'
    })
    expect(JSON.stringify(receipt)).not.toContain('/private/main-only')
  })

  it('rejects a stale display request before path lookup or capability minting', async() => {
    const document = Object.freeze({
      documentId: 'document:owned',
      filename: 'note.md',
      pathname: '/notes/note.md'
    })
    const deps = dependencies(vi.fn(() => document))
    deps.assertRevision.mockRejectedValue(new Error('stale revision'))
    registerImageAssetHandlers(deps)
    const sender = { id: 41 }
    handlers.get('mt::image-assets::activate-document')?.(
      { sender },
      {
        schema: 'image-asset-activation-1',
        documentId: 'document:owned'
      }
    )

    await expect(handlers.get(
      'mt::image-assets::resolve-display'
    )?.(
      { sender },
      {
        schema: 'image-display-1',
        documentId: 'document:owned',
        revisionId: 'revision:stale',
        reference: 'assets/cat.png'
      }
    )).rejects.toThrow(/stale/i)

    expect(deps.resolveDisplayPath).not.toHaveBeenCalled()
    expect(deps.displayCapabilities.mint).not.toHaveBeenCalled()
  })

  it('rejects display authority for a document that is not the active tab', async() => {
    const describeDocument = vi.fn((_sender: unknown, documentId: string) => ({
      documentId,
      filename: 'note.md',
      pathname: `/notes/${documentId}.md`
    }))
    const deps = dependencies(describeDocument)
    registerImageAssetHandlers(deps)
    const sender = { id: 41 }
    handlers.get('mt::image-assets::activate-document')?.(
      { sender },
      {
        schema: 'image-asset-activation-1',
        documentId: 'document:one'
      }
    )

    await expect(handlers.get(
      'mt::image-assets::resolve-display'
    )?.(
      { sender },
      {
        schema: 'image-display-1',
        documentId: 'document:two',
        revisionId: 'revision:one',
        reference: 'assets/cat.png'
      }
    )).rejects.toThrow(/not active/i)

    expect(deps.resolveDisplayPath).not.toHaveBeenCalled()
    expect(deps.displayCapabilities.mint).not.toHaveBeenCalled()
  })

  it('cannot mint after the active tab changes during path resolution', async() => {
    const describeDocument = vi.fn((_sender: unknown, documentId: string) => ({
      documentId,
      filename: 'note.md',
      pathname: `/notes/${documentId}.md`
    }))
    let release: (() => void) | undefined
    const deps = dependencies(describeDocument)
    deps.resolveDisplayPath.mockImplementation(async() => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return {
        kind: 'resolved' as const,
        pathname: '/private/main-only/cat.png'
      }
    })
    registerImageAssetHandlers(deps)
    const sender = { id: 41 }
    const activate = handlers.get('mt::image-assets::activate-document')
    activate?.(
      { sender },
      {
        schema: 'image-asset-activation-1',
        documentId: 'document:one'
      }
    )
    const resolving = handlers.get(
      'mt::image-assets::resolve-display'
    )?.(
      { sender },
      {
        schema: 'image-display-1',
        documentId: 'document:one',
        revisionId: 'revision:one',
        reference: 'assets/cat.png'
      }
    ) as Promise<unknown>
    await vi.waitFor(() => expect(
      deps.resolveDisplayPath
    ).toHaveBeenCalledOnce())

    activate?.(
      { sender },
      {
        schema: 'image-asset-activation-1',
        documentId: 'document:two'
      }
    )
    release?.()

    await expect(resolving).rejects.toThrow(/deactivated/i)
    expect(deps.displayCapabilities.mint).not.toHaveBeenCalled()
  })
})
