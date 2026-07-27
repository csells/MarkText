import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn()
  },
  ipcMain: {
    handle: vi.fn((
      channel: string,
      handler: (...args: unknown[]) => unknown
    ) => handlers.set(channel, handler))
  }
}))

vi.mock('main_renderer/presentationPolicy', () => ({
  presentationPolicy: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
    showItemInFolder: vi.fn()
  }
}))

vi.mock('main_renderer/ipc/documentCore', () => ({
  listDocumentCoreRecoveryWindows: vi.fn(async() => []),
  describeDocumentCoreFile: vi.fn()
}))

vi.mock('main_renderer/imageAssets/imageAssetSettings', () => ({
  readImageAssetProjectRoot: vi.fn(),
  readImageAssetSettings: vi.fn()
}))

vi.mock('main_renderer/presentation/staticOutputAuthority', () => ({
  resolveStaticOutput: vi.fn()
}))

const { registerPresentationEffectHandlers } =
  await import('main_renderer/ipc/presentationEffects')

function dependencies() {
  return {
    openExternal: vi.fn(async() => {}),
    openPath: vi.fn(async() => ''),
    showItemInFolder: vi.fn(),
    describeDocument: vi.fn(() => ({
      pathname: '/retained/document.md'
    })),
    resolveProjectRoot: vi.fn(() => '/retained/project'),
    readImageSettings: vi.fn(() => ({
      configuredFolderPath: '/retained/images'
    })),
    resolveStaticOutput: vi.fn(() => '/retained/export.pdf'),
    reportError: vi.fn()
  }
}

describe('presentation effect IPC gate', () => {
  beforeEach(() => handlers.clear())

  it('rejects extras on every closed request before any lookup or effect', async() => {
    const deps = dependencies()
    registerPresentationEffectHandlers(deps)
    const attempts = [
      [
        'mt::external-resource::open',
        {
          schema: 'external-resource-open-1',
          target: 'documentation-basics',
          url: 'https://attacker.invalid'
        }
      ],
      [
        'mt::document::reveal',
        {
          schema: 'document-reveal-1',
          documentId: 'document:one',
          pathname: '/attacker/chosen'
        }
      ],
      [
        'mt::project::reveal',
        {
          schema: 'project-reveal-1',
          entrySegments: ['guides', 'note.md'],
          root: '/attacker/chosen'
        }
      ],
      [
        'mt::image-folder::open',
        {
          schema: 'image-folder-open-1',
          pathname: '/attacker/chosen'
        }
      ],
      [
        'mt::static-output::reveal',
        {
          schema: 'static-output-reveal-1',
          documentId: 'document:one',
          revisionId: 'revision:one',
          consumer: 'pdf',
          view: 'markup',
          targetPath: '/attacker/chosen'
        }
      ]
    ] as const

    for (const [channel, request] of attempts) {
      await expect(
        handlers.get(channel)?.({ sender: { id: 7 } }, request)
      ).rejects.toThrow(/closed|field/i)
    }

    for (const dependency of Object.values(deps)) {
      expect(dependency).not.toHaveBeenCalled()
    }
  })

  it('maps an enumerated external resource to a main-owned URL', async() => {
    const deps = dependencies()
    registerPresentationEffectHandlers(deps)

    await expect(handlers.get('mt::external-resource::open')?.(
      { sender: { id: 7 } },
      {
        schema: 'external-resource-open-1',
        target: 'documentation-basics'
      }
    )).resolves.toBe(true)

    expect(deps.openExternal).toHaveBeenCalledWith(
      'https://marktext.me/docs/basics'
    )
  })

  it('resolves reveal paths from retained identities', async() => {
    const deps = dependencies()
    registerPresentationEffectHandlers(deps)
    const sender = { id: 7 }

    await handlers.get('mt::document::reveal')?.(
      { sender },
      {
        schema: 'document-reveal-1',
        documentId: 'document:one'
      }
    )
    await handlers.get('mt::project::reveal')?.(
      { sender },
      {
        schema: 'project-reveal-1',
        entrySegments: ['guides', 'note.md']
      }
    )
    await handlers.get('mt::image-folder::open')?.(
      { sender },
      {
        schema: 'image-folder-open-1'
      }
    )
    await handlers.get('mt::static-output::reveal')?.(
      { sender },
      {
        schema: 'static-output-reveal-1',
        documentId: 'document:one',
        revisionId: 'revision:one',
        consumer: 'pdf',
        view: 'markup'
      }
    )

    expect(deps.describeDocument).toHaveBeenCalledWith(
      sender,
      'document:one'
    )
    expect(deps.resolveProjectRoot).toHaveBeenCalledWith(sender)
    expect(deps.readImageSettings).toHaveBeenCalledOnce()
    expect(deps.resolveStaticOutput).toHaveBeenCalledWith(
      sender,
      {
        schema: 'static-output-reveal-1',
        documentId: 'document:one',
        revisionId: 'revision:one',
        consumer: 'pdf',
        view: 'markup'
      }
    )
    expect(deps.showItemInFolder).toHaveBeenNthCalledWith(
      1,
      path.resolve('/retained/document.md')
    )
    expect(deps.showItemInFolder).toHaveBeenNthCalledWith(
      2,
      path.resolve('/retained/project/guides/note.md')
    )
    expect(deps.openPath).toHaveBeenCalledWith(
      path.resolve('/retained/images')
    )
    expect(deps.showItemInFolder).toHaveBeenNthCalledWith(
      3,
      path.resolve('/retained/export.pdf')
    )
  })

  it('does not reveal a forged document identity', async() => {
    const deps = dependencies()
    deps.describeDocument.mockImplementation(() => {
      throw new Error('Foreign document')
    })
    registerPresentationEffectHandlers(deps)

    await expect(handlers.get('mt::document::reveal')?.(
      { sender: { id: 7 } },
      {
        schema: 'document-reveal-1',
        documentId: 'document:foreign'
      }
    )).resolves.toBe(false)

    expect(deps.showItemInFolder).not.toHaveBeenCalled()
    expect(deps.reportError).toHaveBeenCalledOnce()
  })

  it('rejects project traversal before retained-root lookup', async() => {
    const deps = dependencies()
    registerPresentationEffectHandlers(deps)

    await expect(handlers.get('mt::project::reveal')?.(
      { sender: { id: 7 } },
      {
        schema: 'project-reveal-1',
        entrySegments: ['..', 'outside.md']
      }
    )).rejects.toThrow(/segment|safe/i)

    expect(deps.resolveProjectRoot).not.toHaveBeenCalled()
    expect(deps.showItemInFolder).not.toHaveBeenCalled()
  })
})
