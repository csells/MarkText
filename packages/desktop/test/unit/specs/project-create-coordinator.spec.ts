import { describe, expect, it, vi } from 'vitest'
import { coordinateProjectCreate } from 'main_renderer/project/projectCreateCoordinator'

describe('project-create coordinator', () => {
  it('uses only the retained root and EditorWindow admission seam', async() => {
    const createEntry = vi.fn(async({ root, admitFile }) => {
      await admitFile(`${root}/note.md`)
      return {
        schema: 'project-create-receipt-1' as const,
        kind: 'file' as const,
        entry: {
          pathname: `${root}/note.md`,
          name: 'note.md',
          isFile: true as const,
          isDirectory: false as const,
          isMarkdown: true as const
        }
      }
    })
    const editor = {
      openedRootDirectory: '/retained/project',
      admitProjectFile: vi.fn(async() => {})
    }

    const receipt = await coordinateProjectCreate(
      editor,
      {
        schema: 'project-create-intent-1',
        kind: 'file',
        parentSegments: [],
        name: 'note'
      },
      createEntry
    )

    expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({
      root: '/retained/project'
    }))
    expect(editor.admitProjectFile).toHaveBeenCalledWith('/retained/project/note.md')
    expect(receipt.kind).toBe('file')
  })

  it('rejects creation when the window retains no project root', async() => {
    await expect(coordinateProjectCreate(
      {
        openedRootDirectory: null,
        admitProjectFile: vi.fn(async() => {})
      },
      {
        schema: 'project-create-intent-1',
        kind: 'directory',
        parentSegments: [],
        name: 'drafts'
      }
    )).rejects.toThrow(/project root/i)
  })
})
