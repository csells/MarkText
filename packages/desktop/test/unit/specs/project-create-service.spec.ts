import path from 'path'
import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs-extra'
import {
  createProjectEntry,
  type ProjectFileAdmission
} from 'main_renderer/project/projectCreateService'

const createdDirectories: string[] = []

async function projectFixture(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'marktext-project-create-'))
  createdDirectories.push(directory)
  return directory
}

afterEach(async() => {
  await Promise.all(createdDirectories.splice(0).map(directory => fs.remove(directory)))
})

describe('main-owned project create service', () => {
  it('exclusively creates an empty .md and delegates its only admission', async() => {
    const root = await projectFixture()
    await mkdir(path.join(root, 'guides'))
    const admit: ProjectFileAdmission = vi.fn(async() => {})

    const receipt = await createProjectEntry({
      root,
      intent: {
        schema: 'project-create-intent-1',
        kind: 'file',
        parentSegments: ['guides'],
        name: 'intro'
      },
      admitFile: admit
    })

    const pathname = path.join(root, 'guides', 'intro.md')
    expect(await readFile(pathname, 'utf8')).toBe('')
    expect(admit).toHaveBeenCalledOnce()
    expect(admit).toHaveBeenCalledWith(pathname)
    expect(receipt).toEqual({
      schema: 'project-create-receipt-1',
      kind: 'file',
      entry: {
        pathname,
        name: 'intro.md',
        isFile: true,
        isDirectory: false,
        isMarkdown: true
      }
    })
    expect(receipt).not.toHaveProperty('documentId')
    expect(receipt).not.toHaveProperty('source')
  })

  it('creates a directory and returns metadata without admitting a document', async() => {
    const root = await projectFixture()
    const admit: ProjectFileAdmission = vi.fn(async() => {})

    const receipt = await createProjectEntry({
      root,
      intent: {
        schema: 'project-create-intent-1',
        kind: 'directory',
        parentSegments: [],
        name: 'drafts'
      },
      admitFile: admit
    })

    expect(receipt.kind).toBe('directory')
    expect(receipt.entry).toMatchObject({
      pathname: path.join(root, 'drafts'),
      name: 'drafts',
      isFile: false,
      isDirectory: true,
      isMarkdown: false
    })
    expect(admit).not.toHaveBeenCalled()
  })

  it.each([
    { parentSegments: [], name: '/tmp/escape' },
    { parentSegments: [], name: '..' },
    { parentSegments: [], name: '../escape' },
    { parentSegments: [], name: 'nested/name' },
    { parentSegments: [], name: 'nested\\name' },
    { parentSegments: [], name: 'nul\u0000name' },
    { parentSegments: ['..'], name: 'escape' },
    { parentSegments: ['/tmp'], name: 'escape' },
    { parentSegments: ['nested/name'], name: 'escape' }
  ])('rejects unsafe relative intent %#', async({ parentSegments, name }) => {
    const root = await projectFixture()
    await expect(createProjectEntry({
      root,
      intent: {
        schema: 'project-create-intent-1',
        kind: 'file',
        parentSegments,
        name
      },
      admitFile: async() => {}
    })).rejects.toThrow()
  })

  it('rejects a parent symlink that escapes the retained project root', async() => {
    const root = await projectFixture()
    const outside = await projectFixture()
    await symlink(await realpath(outside), path.join(root, 'outside'))

    await expect(createProjectEntry({
      root,
      intent: {
        schema: 'project-create-intent-1',
        kind: 'file',
        parentSegments: ['outside'],
        name: 'escape'
      },
      admitFile: async() => {}
    })).rejects.toThrow(/project root|escape|symlink/i)

    await expect(fs.pathExists(path.join(outside, 'escape.md'))).resolves.toBe(false)
  })

  it('rejects collisions without altering the existing entry', async() => {
    const root = await projectFixture()
    const pathname = path.join(root, 'notes.md')
    await writeFile(pathname, 'keep me', 'utf8')

    await expect(createProjectEntry({
      root,
      intent: {
        schema: 'project-create-intent-1',
        kind: 'file',
        parentSegments: [],
        name: 'notes'
      },
      admitFile: async() => {}
    })).rejects.toMatchObject({ code: 'EEXIST' })

    expect(await readFile(pathname, 'utf8')).toBe('keep me')
  })

  it('rolls back the exclusively created file when document admission fails', async() => {
    const root = await projectFixture()
    const pathname = path.join(root, 'broken.md')

    await expect(createProjectEntry({
      root,
      intent: {
        schema: 'project-create-intent-1',
        kind: 'file',
        parentSegments: [],
        name: 'broken'
      },
      admitFile: async() => {
        throw new Error('admission failed')
      }
    })).rejects.toThrow('admission failed')

    await expect(fs.pathExists(pathname)).resolves.toBe(false)
  })
})
