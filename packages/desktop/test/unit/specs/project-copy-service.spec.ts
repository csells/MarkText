import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  copyProjectEntry
} from 'main_renderer/project/projectCopy'

const directories: string[] = []

afterEach(async() => {
  await Promise.all(directories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function project() {
  const root = await mkdtemp(path.join(tmpdir(), 'marktext-project-copy-'))
  directories.push(root)
  await mkdir(path.join(root, 'guides'))
  await mkdir(path.join(root, 'archive'))
  await writeFile(path.join(root, 'guides', 'note.md'), 'source bytes')
  return root
}

describe('main-owned project copy', () => {
  it('copies an unopened entry exclusively beneath the retained root', async() => {
    const root = await project()
    const source = path.join(root, 'guides', 'note.md')
    const target = path.join(root, 'archive', 'note.md')

    await expect(copyProjectEntry({
      root,
      intent: {
        schema: 'project-copy-intent-1',
        kind: 'file',
        entrySegments: ['guides', 'note.md'],
        targetParentSegments: ['archive']
      },
      findOpenDocument: () => null,
      openDocumentsUnder: () => []
    })).resolves.toEqual({
      schema: 'project-copy-receipt-1',
      kind: 'file',
      sourcePathname: source,
      entry: {
        pathname: target,
        name: 'note.md',
        isFile: true,
        isDirectory: false,
        isMarkdown: true
      }
    })
    expect(await readFile(source, 'utf8')).toBe('source bytes')
    expect(await readFile(target, 'utf8')).toBe('source bytes')
  })

  it('rejects an open source before copying stale on-disk bytes', async() => {
    const root = await project()
    const copyEntry = vi.fn(async() => {})

    await expect(copyProjectEntry({
      root,
      intent: {
        schema: 'project-copy-intent-1',
        kind: 'file',
        entrySegments: ['guides', 'note.md'],
        targetParentSegments: ['archive']
      },
      findOpenDocument: () => 'document:1',
      openDocumentsUnder: () => [],
      copyEntry
    })).rejects.toThrow(/close.*open file/i)
    expect(copyEntry).not.toHaveBeenCalled()
  })

  it('rejects a directory with open descendants before copy mutation', async() => {
    const root = await project()
    const copyEntry = vi.fn(async() => {})

    await expect(copyProjectEntry({
      root,
      intent: {
        schema: 'project-copy-intent-1',
        kind: 'directory',
        entrySegments: ['guides'],
        targetParentSegments: ['archive']
      },
      findOpenDocument: () => null,
      openDocumentsUnder: () => [{
        documentId: 'document:1',
        filename: 'note.md',
        pathname: path.join(root, 'guides', 'note.md')
      }],
      copyEntry
    })).rejects.toThrow(/open descendant/i)
    expect(copyEntry).not.toHaveBeenCalled()
  })

  it('never overwrites an existing target', async() => {
    const root = await project()
    const target = path.join(root, 'archive', 'note.md')
    await writeFile(target, 'existing')

    await expect(copyProjectEntry({
      root,
      intent: {
        schema: 'project-copy-intent-1',
        kind: 'file',
        entrySegments: ['guides', 'note.md'],
        targetParentSegments: ['archive']
      },
      findOpenDocument: () => null,
      openDocumentsUnder: () => []
    })).rejects.toThrow(/exists/i)
    expect(await readFile(target, 'utf8')).toBe('existing')
  })
})
