import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = path.resolve(__dirname, '../../..')
const source = (relative: string): string =>
  fs.readFileSync(path.join(desktopRoot, relative), 'utf8')

describe('image asset mutation authority', () => {
  it('exposes one closed insertion transaction and no generic renderer mutation API', () => {
    const preload = source('src/preload/index.ts')
    const ipcTypes = source('src/shared/types/ipc.ts')
    const globals = source('src/types/global.d.ts')
    const rendererFileSystem = source(
      'src/renderer/src/services/uploaderClient.ts'
    )

    for (const forbidden of [
      'mt::fs::copy',
      'mt::fs::ensure-dir',
      'mt::fs::write-file'
    ]) {
      expect(preload).not.toContain(forbidden)
      expect(ipcTypes).not.toContain(forbidden)
    }
    expect(fs.existsSync(path.join(
      desktopRoot,
      'src/main/ipc/fs.ts'
    ))).toBe(false)
    expect(globals).not.toMatch(/\bcopy\(src: string, dest: string\)/)
    expect(globals).not.toMatch(/\bensureDir\(p: string\)/)
    expect(globals).not.toMatch(/\bwriteFile\(p: string/)
    expect(rendererFileSystem).not.toContain('moveImageToFolder')
    expect(ipcTypes).toContain("'mt::image-assets::insert'")
    expect(ipcTypes).toContain("'mt::image-assets::activate-document'")
    expect(ipcTypes).not.toContain("'mt::image-assets::ingest'")
  })

  it('does not let the image ingestion request carry any destination field', () => {
    const contract = source('src/shared/types/imageAsset.ts')
    expect(contract).not.toMatch(/\b(targetPath|outputDir|destination)\??:/)
    expect(contract).not.toContain("readonly kind: 'local-file'")
    expect(contract).not.toMatch(/\bpathname\s*:/)
    expect(contract).toContain('readonly documentId: string')
    expect(contract).toContain('readonly baseSnapshotId: string')
    expect(contract).toContain('readonly revisionId: string')
    expect(contract).toContain('readonly target: ModelSelection')
    expect(contract).toContain('readonly storage: ImageAssetStorage')
  })

  it('changes the configured folder only through a main-owned native picker', () => {
    const ipcTypes = source('src/shared/types/ipc.ts')
    const dataCenter = source('src/main/dataCenter/index.ts')
    const preferenceStore = source('src/renderer/src/store/preferences.ts')

    expect(ipcTypes).toContain(
      "'mt::ask-for-modify-image-folder-path': []"
    )
    expect(dataCenter).not.toMatch(
      /mt::ask-for-modify-image-folder-path'[^]*imagePath\?: string/
    )
    expect(dataCenter).toContain(
      "ipcMain.handle('mt::image-assets::select-native-source'"
    )
    expect(dataCenter).toContain('mintImageSourceCapability')
    expect(preferenceStore).toContain(
      "send('mt::ask-for-modify-image-folder-path')"
    )
  })

  it('has no renderer-owned document directory or local image path resolver', () => {
    const rendererStore = source('src/renderer/src/store/editor.ts')
    const globals = source('src/types/global.d.ts')
    const ipcTypes = source('src/shared/types/ipc.ts')
    const viewRenderer = source('../document-view/src/documentCore/renderBlocks.ts')

    expect(rendererStore).not.toContain('window.DIRNAME')
    expect(globals).not.toMatch(/\bDIRNAME\b/)
    expect(fs.existsSync(path.join(
      desktopRoot,
      'src/renderer/src/util/resolveLinkHref.ts'
    ))).toBe(false)
    expect(ipcTypes).toContain("'mt::image-assets::resolve-display'")
    expect(viewRenderer).not.toContain('file://')
    expect(viewRenderer).toContain('presentLocalImage')
  })
})
