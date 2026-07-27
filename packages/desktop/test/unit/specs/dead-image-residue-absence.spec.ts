import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(__dirname, '../../../../..')
const desktopRoot = path.join(repositoryRoot, 'packages/desktop')

async function repositorySource(relativePath: string): Promise<string> {
  return await readFile(path.join(repositoryRoot, relativePath), 'utf8')
}

async function desktopSource(relativePath: string): Promise<string> {
  return await readFile(path.join(desktopRoot, relativePath), 'utf8')
}

describe('dead image-path residue absence', () => {
  it.each([
    'src/main/utils/imagePathAutoComplement.ts',
    'src/renderer/src/util/resolveImageSrc.ts',
    'test/unit/specs/image-path-autocomplete.spec.ts',
    'test/unit/specs/printService-image.spec.ts'
  ])('physically removes %s', async relativePath => {
    await expect(desktopSource(relativePath)).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('removes the image-path request, dynamic response, and watcher cleanup', async() => {
    const [
      app,
      editActions,
      editorStore,
      ipcTypes
    ] = await Promise.all([
      desktopSource('src/main/app/index.ts'),
      desktopSource('src/main/menu/actions/edit.ts'),
      desktopSource('src/renderer/src/store/editor.ts'),
      desktopSource('src/shared/types/ipc.ts')
    ])
    const production = [app, editActions, editorStore, ipcTypes].join('\n')

    for (const removed of [
      'imagePathAutoComplement',
      'ASK_FOR_IMAGE_AUTO_PATH',
      'mt::ask-for-image-auto-path',
      'mt::response-of-image-path-',
      'searchFilesAndDir'
    ]) {
      expect(production).not.toContain(removed)
    }
  })

  it('removes the unused extension hash and autocomplete dependency', async() => {
    const [
      config,
      packageJson,
      lockfile,
      licenses
    ] = await Promise.all([
      desktopSource('src/main/config.ts'),
      desktopSource('package.json'),
      repositorySource('pnpm-lock.yaml'),
      desktopSource('build/THIRD-PARTY-LICENSES.txt')
    ])

    expect(config).not.toContain('EXTENSION_HASN')
    expect(packageJson).not.toContain('fuzzaldrin')
    expect(lockfile).not.toContain('fuzzaldrin')
    expect(licenses).not.toContain('fuzzaldrin')
  })
})
