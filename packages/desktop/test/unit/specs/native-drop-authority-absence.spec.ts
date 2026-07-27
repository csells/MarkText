import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = path.resolve(__dirname, '../../..')
const source = (relative: string): string =>
  fs.readFileSync(path.join(desktopRoot, relative), 'utf8')

describe('native drop authority absence', () => {
  it('has no renderer pathname or fire-and-forget drop channel', () => {
    const ipc = source('src/shared/types/ipc.ts')
    const contract = source('src/shared/types/documentImport.ts')
    const preload = source('src/preload/index.ts')
    const globals = source('src/types/global.d.ts')
    const renderer = source('src/renderer/src/components/import/index.vue')
    const mainFileActions = source('src/main/menu/actions/file.ts')
    const windowManager = source('src/main/app/windowManager.ts')

    for (const text of [ipc, renderer, mainFileActions]) {
      expect(text).not.toContain('mt::window::drop')
    }
    expect(preload).not.toContain('webUtils')
    expect(globals).not.toContain('ElectronWebUtilsAPI')
    expect(renderer).not.toContain('getPathForFile')
    expect(contract).not.toMatch(/\b(pathname|windowId|root|executable|outputPath)\??:/)
    expect(ipc).toContain("'mt::document-import::binary'")
    expect(windowManager).toContain('registerDocumentImportBinaryHandler')
    expect(windowManager).toContain('admitImportedMarkdown')
  })
})
