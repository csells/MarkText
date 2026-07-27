import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  relocateProjectEntry
} from 'main_renderer/project/projectRelocation'

const directories: string[] = []

afterEach(async() => {
  await Promise.all(directories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function project() {
  const root = await mkdtemp(path.join(tmpdir(), 'marktext-project-move-'))
  directories.push(root)
  await mkdir(path.join(root, 'guides'))
  return root
}

describe('main-owned project relocation', () => {
  it('moves an unopened entry under the retained root without overwriting', async() => {
    const root = await project()
    const source = path.join(root, 'guides', 'old.md')
    await mkdir(path.join(root, 'archive'))
    await writeFile(source, 'owned bytes')

    const receipt = await relocateProjectEntry({
      root,
      intent: {
        schema: 'project-relocate-intent-1',
        kind: 'file',
        entrySegments: ['guides', 'old.md'],
        targetParentSegments: ['archive'],
        newName: 'new.md'
      },
      findOpenDocument: () => null,
      openDocumentsUnder: () => [],
      relocateOpenDocument: vi.fn()
    })

    const target = path.join(root, 'archive', 'new.md')
    await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(target, 'utf8')).toBe('owned bytes')
    expect(receipt).toEqual({
      schema: 'project-relocate-receipt-1',
      kind: 'file',
      previousPathname: source,
      entry: {
        pathname: target,
        name: 'new.md',
        isFile: true,
        isDirectory: false,
        isMarkdown: true
      },
      document: null
    })
  })

  it('routes an open file through the serialized document host transaction', async() => {
    const root = await project()
    const source = path.join(root, 'guides', 'old.md')
    const target = path.join(root, 'guides', 'new.md')
    await writeFile(source, 'owned bytes')
    const documentReceipt = Object.freeze({
      schema: 'document-core-path-receipt-1' as const,
      documentId: 'document:1',
      previousPathname: source,
      pathname: target,
      filename: 'new.md'
    })
    const relocateOpenDocument = vi.fn(async() => documentReceipt)
    const moveEntry = vi.fn(async() => {})

    const receipt = await relocateProjectEntry({
      root,
      intent: {
        schema: 'project-relocate-intent-1',
        kind: 'file',
        entrySegments: ['guides', 'old.md'],
        targetParentSegments: ['guides'],
        newName: 'new.md'
      },
      findOpenDocument: pathname =>
        pathname === source ? 'document:1' : null,
      openDocumentsUnder: () => [],
      relocateOpenDocument,
      moveEntry
    })

    expect(moveEntry).not.toHaveBeenCalled()
    expect(relocateOpenDocument).toHaveBeenCalledWith('document:1', target)
    expect(receipt.document).toBe(documentReceipt)
  })

  it('rejects a directory with any open descendant before filesystem mutation', async() => {
    const root = await project()
    const source = path.join(root, 'guides')
    const moveEntry = vi.fn(async() => {})

    await expect(relocateProjectEntry({
      root,
      intent: {
        schema: 'project-relocate-intent-1',
        kind: 'directory',
        entrySegments: ['guides'],
        targetParentSegments: [],
        newName: 'manual'
      },
      findOpenDocument: () => null,
      openDocumentsUnder: () => [{
        documentId: 'document:1',
        filename: 'old.md',
        pathname: path.join(source, 'old.md')
      }],
      relocateOpenDocument: vi.fn(),
      moveEntry
    })).rejects.toThrow(/open.*descendant|close.*file/i)

    expect(moveEntry).not.toHaveBeenCalled()
    expect((await stat(source)).isDirectory()).toBe(true)
  })

  it('preserves both entries when the target already exists', async() => {
    const root = await project()
    const source = path.join(root, 'guides', 'old.md')
    const target = path.join(root, 'guides', 'taken.md')
    await writeFile(source, 'source')
    await writeFile(target, 'target')

    await expect(relocateProjectEntry({
      root,
      intent: {
        schema: 'project-relocate-intent-1',
        kind: 'file',
        entrySegments: ['guides', 'old.md'],
        targetParentSegments: ['guides'],
        newName: 'taken.md'
      },
      findOpenDocument: () => null,
      openDocumentsUnder: () => [],
      relocateOpenDocument: vi.fn()
    })).rejects.toThrow()

    expect(await readFile(source, 'utf8')).toBe('source')
    expect(await readFile(target, 'utf8')).toBe('target')
  })
})
