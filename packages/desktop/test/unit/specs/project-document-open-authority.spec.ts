import path from 'node:path'
import {
  mkdtemp,
  mkdir,
  realpath,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import {
  authorizeProjectDocumentOpen
} from 'main_renderer/project/projectDocumentOpenAuthority'

const createdDirectories: string[] = []

async function fixture(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  createdDirectories.push(directory)
  return directory
}

afterEach(async() => {
  await Promise.all(createdDirectories.splice(0).map(directory => fs.remove(directory)))
})

describe('main-owned project document admission', () => {
  it('resolves a Markdown file contained by the retained real project root', async() => {
    const root = await fixture('mt-project-open-root-')
    await mkdir(path.join(root, 'notes'))
    const candidate = path.join(root, 'notes', 'one.md')
    await writeFile(candidate, '# One', 'utf8')

    await expect(authorizeProjectDocumentOpen({
      root,
      candidatePath: candidate,
      findOpenedPath: () => null
    })).resolves.toEqual({
      kind: 'admit',
      pathname: await realpath(candidate)
    })
  })

  it('selects an already admitted external document without reading it again', async() => {
    const outside = await fixture('mt-project-open-external-')
    const opened = path.join(outside, 'already-open.md')
    await writeFile(opened, '# Existing', 'utf8')

    await expect(authorizeProjectDocumentOpen({
      root: null,
      candidatePath: opened,
      findOpenedPath: candidate => candidate === opened ? opened : null
    })).resolves.toEqual({
      kind: 'select-existing',
      pathname: opened
    })
  })

  it('rejects a new admission when no retained project root exists', async() => {
    const outside = await fixture('mt-project-open-unowned-')
    const candidate = path.join(outside, 'not-admitted.md')
    await writeFile(candidate, '# Not admitted', 'utf8')

    await expect(authorizeProjectDocumentOpen({
      root: null,
      candidatePath: candidate,
      findOpenedPath: () => null
    })).rejects.toThrow(/retained project root/i)
  })

  it.each([
    ['outside project', 'outside.md'],
    ['non-Markdown file', 'inside.txt']
  ])('rejects an unowned %s before admission', async(_label, filename) => {
    const root = await fixture('mt-project-open-root-')
    const outside = await fixture('mt-project-open-outside-')
    const candidate = filename === 'inside.txt'
      ? path.join(root, filename)
      : path.join(outside, filename)
    await writeFile(candidate, 'secret', 'utf8')

    await expect(authorizeProjectDocumentOpen({
      root,
      candidatePath: candidate,
      findOpenedPath: () => null
    })).rejects.toThrow(/project|markdown|owned|contained/i)
  })

  it('rejects a project symlink that resolves outside the retained root', async() => {
    const root = await fixture('mt-project-open-root-')
    const outside = await fixture('mt-project-open-outside-')
    const secret = path.join(outside, 'secret.md')
    const candidate = path.join(root, 'escape.md')
    await writeFile(secret, 'secret', 'utf8')
    await symlink(secret, candidate)

    await expect(authorizeProjectDocumentOpen({
      root,
      candidatePath: candidate,
      findOpenedPath: () => null
    })).rejects.toThrow(/project|escape|contained/i)
  })

  it('rejects a Markdown-named directory as a non-file', async() => {
    const root = await fixture('mt-project-open-root-')
    const candidate = path.join(root, 'folder.md')
    await mkdir(candidate)

    await expect(authorizeProjectDocumentOpen({
      root,
      candidatePath: candidate,
      findOpenedPath: () => null
    })).rejects.toThrow(/regular file/i)
  })

  it('admits an internal symlink only as its canonical contained target', async() => {
    const root = await fixture('mt-project-open-root-')
    const target = path.join(root, 'target.md')
    const candidate = path.join(root, 'alias.md')
    await writeFile(target, '# Target', 'utf8')
    await symlink(target, candidate)

    await expect(authorizeProjectDocumentOpen({
      root,
      candidatePath: candidate,
      findOpenedPath: () => null
    })).resolves.toEqual({
      kind: 'admit',
      pathname: await realpath(target)
    })
  })
})
