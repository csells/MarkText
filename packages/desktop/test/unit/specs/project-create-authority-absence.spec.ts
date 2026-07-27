import path from 'path'
import { readFile } from 'fs/promises'
import { describe, expect, it } from 'vitest'

const desktopRoot = path.resolve(__dirname, '../../../')

async function source(relativePath: string): Promise<string> {
  return await readFile(path.join(desktopRoot, relativePath), 'utf8')
}

describe('project-create authority absence', () => {
  it('keeps directory watcher add events metadata-only', async() => {
    const watcher = await source('src/main/filesystem/watcher.ts')
    expect(watcher).not.toMatch(/loadMarkdownFile/)
    expect(watcher).not.toMatch(/file\.data|data\s*:/)
  })

  it('has no renderer file creation, preflight, or watcher-open cache', async() => {
    const project = await source('src/renderer/src/store/project.ts')
    const fileSystem = await source(
      'src/renderer/src/services/uploaderClient.ts'
    )
    const preload = await source('src/preload/index.ts')
    const globalTypes = await source('src/types/global.d.ts')
    const ipcTypes = await source('src/shared/types/ipc.ts')

    expect(project).not.toMatch(/newFileNameCache/)
    expect(project).not.toMatch(/fileUtils\.pathExists/)
    expect(project).not.toMatch(/getFileStateFromData/)
    expect(fileSystem).not.toMatch(/export\s+const\s+create\b/)
    expect(preload).not.toMatch(/pathExists\s*:/)
    expect(preload).not.toMatch(/outputFile\s*:/)
    expect(globalTypes).not.toMatch(/\bpathExists\s*\(/)
    expect(globalTypes).not.toMatch(/\boutputFile\s*\(/)
    expect(ipcTypes).not.toMatch(/mt::fs::path-exists/)
    expect(ipcTypes).not.toMatch(/mt::fs::output-file/)
  })
})
