import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createFileDocumentCoreExportThemeSource
} from 'main_renderer/documentCore/exportThemeSource'

const directories: string[] = []

afterEach(async() => {
  await Promise.all(directories.splice(0).map(async directory =>
    await rm(directory, { recursive: true, force: true })
  ))
})

async function themeDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'marktext-themes-'))
  directories.push(root)
  const directory = path.join(root, 'themes', 'export')
  await mkdir(directory, { recursive: true })
  return directory
}

describe('main-owned export theme source', () => {
  it('lists only regular CSS files and returns semantic names and labels', async() => {
    const directory = await themeDirectory()
    await writeFile(
      path.join(directory, 'research.css'),
      '/** Research Paper **/\\n.markdown-body{color:navy}',
      'utf8'
    )
    await writeFile(path.join(directory, 'notes.txt'), 'ignored', 'utf8')
    await mkdir(path.join(directory, 'nested.css'))
    const source = createFileDocumentCoreExportThemeSource(directory)

    await expect(source.listCustomThemes()).resolves.toEqual([
      {
        name: 'research.css',
        label: 'Research Paper'
      }
    ])
    await expect(source.cssFor({
      kind: 'custom',
      name: 'research.css'
    })).resolves.toContain('.markdown-body{color:navy}')
  })

  it('cannot follow a theme filename outside the fixed directory', async() => {
    const directory = await themeDirectory()
    const outside = path.join(path.dirname(directory), 'outside.css')
    await writeFile(outside, '.outside{}', 'utf8')
    await symlink(outside, path.join(directory, 'linked.css'))
    const source = createFileDocumentCoreExportThemeSource(directory)

    await expect(source.cssFor({
      kind: 'custom',
      name: '../outside.css'
    })).rejects.toThrow(/theme|filename|safe/i)
    await expect(source.cssFor({
      kind: 'custom',
      name: 'linked.css'
    })).rejects.toThrow(/theme|regular|symbolic/i)
    await expect(source.listCustomThemes()).resolves.toEqual([])
  })
})
