import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const packagesRoot = path.resolve(__dirname, '../../../../')

async function source(relativePath: string): Promise<string> {
  return await readFile(path.join(packagesRoot, relativePath), 'utf8')
}

async function rendererSources(directory: string): Promise<string[]> {
  const absolute = path.join(packagesRoot, directory)
  const entries = await readdir(absolute, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async(entry) => {
    const relative = path.join(directory, entry.name)
    if (entry.isDirectory()) return await rendererSources(relative)
    if (!entry.isFile() || !/\.(ts|vue)$/.test(entry.name)) return []
    return [await source(relative)]
  }))
  return nested.flat()
}

describe('clipboard authority absence', () => {
  it('does not expose a generic renderer OS clipboard or pathname reader', async() => {
    const [preload, ipcTypes, globals, renderer, documentView] =
      await Promise.all([
        source('desktop/src/preload/index.ts'),
        source('desktop/src/shared/types/ipc.ts'),
        source('desktop/src/types/global.d.ts'),
        rendererSources('desktop/src/renderer/src'),
        source('document-view/src/documentCore/documentCoreView.ts')
      ])
    const production = [preload, ipcTypes, globals, ...renderer].join('\n')

    expect(production).not.toContain('mt::clipboard::read-text')
    expect(production).not.toContain('mt::clipboard::write-text')
    expect(production).not.toContain('mt::clipboard::guess-file-path')
    expect(production).not.toContain('window.electron.clipboard')
    expect(production).not.toContain('guessClipboardFilePath')
    expect(documentView).not.toMatch(/\bpasteAsPlainText\s*[:=]/)
  })

  it('has no renderer-addressable generic clipboard handler module', async() => {
    await expect(access(path.join(
      packagesRoot,
      'desktop/src/main/ipc/clipboard.ts'
    ))).rejects.toThrow()
  })
})
