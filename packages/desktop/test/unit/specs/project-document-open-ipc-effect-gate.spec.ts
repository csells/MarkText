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

const { registerProjectDocumentOpenHandler } = await import(
  'main_renderer/ipc/projectDocumentOpen'
)

function editor(root: string | null = '/retained/project') {
  return {
    openedRootDirectory: root,
    findOpenedDocumentPath: vi.fn(() => null as string | null),
    selectOpenedDocumentByPath: vi.fn(),
    admitProjectFile: vi.fn(async() => {})
  }
}

describe('project-document open IPC effect gate', () => {
  beforeEach(() => handlers.clear())

  it('rejects renderer window, root, and options authority before sender or filesystem lookup', async() => {
    const resolveEditor = vi.fn()
    const authorize = vi.fn()
    registerProjectDocumentOpenHandler({
      resolveEditor,
      authorize
    })
    const handler = handlers.get('mt::project::open-document')

    await expect(handler?.(
      { sender: { id: 41 } },
      {
        schema: 'project-document-open-request-1',
        candidatePath: '/retained/project/notes.md',
        windowId: 7,
        root: '/forged/project',
        options: {
          cursor: { line: 99 }
        }
      }
    )).rejects.toThrow(/closed|field/i)

    expect(resolveEditor).not.toHaveBeenCalled()
    expect(authorize).not.toHaveBeenCalled()
  })

  it('uses only the sender-owned editor and retained root for admission', async() => {
    const sender = { id: 41 }
    const ownedEditor = editor()
    const resolveEditor = vi.fn(() => ownedEditor)
    const authorize = vi.fn(async(options: {
      candidatePath: string
      findOpenedPath: (candidatePath: string) => string | null
    }) => {
      expect(options.findOpenedPath(options.candidatePath)).toBeNull()
      return {
        kind: 'admit' as const,
        pathname: '/canonical/project/notes.md'
      }
    })
    registerProjectDocumentOpenHandler({
      resolveEditor,
      authorize
    })

    await expect(handlers.get('mt::project::open-document')?.(
      { sender },
      {
        schema: 'project-document-open-request-1',
        candidatePath: '/retained/project/notes.md'
      }
    )).resolves.toEqual({
      schema: 'project-document-open-receipt-1',
      disposition: 'admitted',
      pathname: '/canonical/project/notes.md'
    })

    expect(resolveEditor).toHaveBeenCalledWith(sender)
    expect(authorize).toHaveBeenCalledWith({
      root: '/retained/project',
      candidatePath: '/retained/project/notes.md',
      findOpenedPath: expect.any(Function)
    })
    expect(ownedEditor.admitProjectFile).toHaveBeenCalledWith(
      '/canonical/project/notes.md'
    )
    expect(ownedEditor.selectOpenedDocumentByPath).not.toHaveBeenCalled()
  })

  it('selects an already-admitted external document without a project root', async() => {
    const candidatePath = '/external/already-open.md'
    const ownedEditor = editor(null)
    ownedEditor.findOpenedDocumentPath.mockReturnValue(candidatePath)
    registerProjectDocumentOpenHandler({
      resolveEditor: vi.fn(() => ownedEditor)
    })

    await expect(handlers.get('mt::project::open-document')?.(
      { sender: { id: 41 } },
      {
        schema: 'project-document-open-request-1',
        candidatePath
      }
    )).resolves.toEqual({
      schema: 'project-document-open-receipt-1',
      disposition: 'selected-existing',
      pathname: candidatePath
    })

    expect(ownedEditor.selectOpenedDocumentByPath)
      .toHaveBeenCalledWith(candidatePath)
    expect(ownedEditor.admitProjectFile).not.toHaveBeenCalled()
  })

  it('rejects a new document without a project root before read or admission', async() => {
    const ownedEditor = editor(null)
    registerProjectDocumentOpenHandler({
      resolveEditor: vi.fn(() => ownedEditor)
    })

    await expect(handlers.get('mt::project::open-document')?.(
      { sender: { id: 41 } },
      {
        schema: 'project-document-open-request-1',
        candidatePath: '/external/not-admitted.md'
      }
    )).rejects.toThrow(/retained project root/i)

    expect(ownedEditor.selectOpenedDocumentByPath).not.toHaveBeenCalled()
    expect(ownedEditor.admitProjectFile).not.toHaveBeenCalled()
  })
})
