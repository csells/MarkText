import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const desktopRoot = path.resolve(__dirname, '../../../')

async function source(relativePath: string): Promise<string> {
  return await readFile(path.join(desktopRoot, relativePath), 'utf8')
}

describe('retired path authority absence', () => {
  it('has no renderer-authored document path transition channel', async() => {
    const [
      fileActions,
      windowManager,
      editor,
      ipcTypes
    ] = await Promise.all([
      source('src/main/menu/actions/file.ts'),
      source('src/main/app/windowManager.ts'),
      source('src/renderer/src/store/editor.ts'),
      source('src/shared/types/ipc.ts')
    ])
    const production = [fileActions, windowManager, editor, ipcTypes].join('\n')

    for (const retired of [
      'mt::rename',
      'mt::response-file-move-to',
      'mt::set-pathname',
      'mt::window-add-file-path',
      'mt::window-tab-closed',
      'RENAME_IF_NEEDED',
      'SET_SAVE_STATUS_WHEN_REMOVE'
    ]) {
      expect(production).not.toContain(retired)
    }
    expect(fileActions).not.toMatch(/\bfsRename\b/)
    expect(editor).not.toMatch(/newPathname|currentFile:\s*deepClone/)
  })

  it('has no renderer filesystem rename path for sidebar entries', async() => {
    const project = await source('src/renderer/src/store/project.ts')
    const fileSystem = await source(
      'src/renderer/src/services/uploaderClient.ts'
    )

    expect(project).not.toMatch(/\brename\s*\(\s*src/)
    expect(project).not.toMatch(/fileUtils\.move/)
    expect(project).not.toMatch(/fileUtils\.copy/)
    expect(fileSystem).not.toMatch(/export\s+const\s+rename\b/)
    expect(project).toContain("'mt::project::relocate'")
    expect(project).toContain("'mt::project::copy'")
  })

  it('has no arbitrary renderer move, unlink, empty-directory, or trash path', async() => {
    const [
      app,
      project,
      preload,
      globalTypes,
      ipcTypes
    ] = await Promise.all([
      source('src/main/app/index.ts'),
      source('src/renderer/src/store/project.ts'),
      source('src/preload/index.ts'),
      source('src/types/global.d.ts'),
      source('src/shared/types/ipc.ts')
    ])
    const production = [
      app,
      project,
      preload,
      globalTypes,
      ipcTypes
    ].join('\n')

    expect(production).not.toContain('mt::fs-trash-item')
    expect(production).not.toContain('mt::fs::move')
    expect(production).not.toContain('mt::fs::unlink')
    expect(production).not.toContain('mt::fs::empty-dir')
    expect(project).toContain("'mt::project::delete'")
  })
})
