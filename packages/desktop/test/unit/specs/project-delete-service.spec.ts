import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteProjectEntry
} from 'main_renderer/project/projectDelete'

const directories: string[] = []

afterEach(async() => {
  await Promise.all(directories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function project() {
  const root = await mkdtemp(path.join(tmpdir(), 'marktext-project-delete-'))
  directories.push(root)
  await mkdir(path.join(root, 'guides'))
  await writeFile(path.join(root, 'guides', 'old.md'), 'source')
  return root
}

describe('main-owned project delete', () => {
  it('trashes an unopened entry resolved beneath the retained root', async() => {
    const root = await project()
    const pathname = path.join(root, 'guides', 'old.md')
    const trashEntry = vi.fn(async() => {})

    await expect(deleteProjectEntry({
      root,
      intent: {
        schema: 'project-delete-intent-1',
        kind: 'file',
        entrySegments: ['guides', 'old.md']
      },
      findOpenDocument: () => null,
      openDocumentsUnder: () => [],
      trashEntry
    })).resolves.toEqual({
      schema: 'project-delete-receipt-1',
      kind: 'file',
      pathname
    })
    expect(trashEntry).toHaveBeenCalledWith(pathname)
  })

  it('visibly rejects an open file before trash mutation', async() => {
    const root = await project()
    const trashEntry = vi.fn(async() => {})

    await expect(deleteProjectEntry({
      root,
      intent: {
        schema: 'project-delete-intent-1',
        kind: 'file',
        entrySegments: ['guides', 'old.md']
      },
      findOpenDocument: () => 'document:1',
      openDocumentsUnder: () => [],
      trashEntry
    })).rejects.toThrow(/close.*open file/i)
    expect(trashEntry).not.toHaveBeenCalled()
  })

  it('visibly rejects a directory with an open descendant before trash mutation', async() => {
    const root = await project()
    const trashEntry = vi.fn(async() => {})

    await expect(deleteProjectEntry({
      root,
      intent: {
        schema: 'project-delete-intent-1',
        kind: 'directory',
        entrySegments: ['guides']
      },
      findOpenDocument: () => null,
      openDocumentsUnder: () => [{
        documentId: 'document:1',
        filename: 'old.md',
        pathname: path.join(root, 'guides', 'old.md')
      }],
      trashEntry
    })).rejects.toThrow(/open descendant/i)
    expect(trashEntry).not.toHaveBeenCalled()
  })
})
