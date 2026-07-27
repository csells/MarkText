import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const desktopRoot = path.resolve(__dirname, '../../../')

async function source(relativePath: string): Promise<string> {
  return await readFile(path.join(desktopRoot, relativePath), 'utf8')
}

describe('uploader authority cutover', () => {
  it('has one typed upload route with no renderer settings or shell authority', async() => {
    await expect(source('src/renderer/src/util/fileSystem.ts'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    const [
      mainUploader,
      uploaderService,
      rendererClient,
      sharedTypes,
      preload,
      globalTypes,
      ipcTypes
    ] = await Promise.all([
      source('src/main/ipc/uploader.ts'),
      source('src/main/uploader/uploaderService.ts'),
      source('src/renderer/src/services/uploaderClient.ts'),
      source('src/shared/types/uploader.ts'),
      source('src/preload/index.ts'),
      source('src/types/global.d.ts'),
      source('src/shared/types/ipc.ts')
    ])

    expect(mainUploader).not.toMatch(/\bexec\s*\(/)
    expect(mainUploader).not.toContain('command-exists')
    expect(mainUploader).not.toContain('writeBinaryToTmp')
    expect(uploaderService).toContain('execFile(')
    expect(uploaderService).not.toMatch(/\bexec\s*\(/)
    expect(uploaderService).not.toMatch(/shell\s*:\s*true/)
    expect(rendererClient).not.toContain('preferences')
    expect(rendererClient).not.toContain('currentUploader')
    expect(rendererClient).not.toContain('cliScript')
    expect(sharedTypes).not.toContain('preferences')
    expect(sharedTypes).not.toContain('currentUploader')
    expect(sharedTypes).not.toContain('cliScript')
    expect(sharedTypes).not.toContain('isPath')
    expect(preload).not.toMatch(/uploadImage:\s*\(req:\s*unknown/)
    expect(globalTypes).not.toMatch(/uploadImage\(req:\s*unknown/)
    expect(ipcTypes).not.toMatch(
      /mt::uploader::upload[^}]+unknown/
    )
  })

  it('does not expose an arbitrary path through uploader availability', async() => {
    const [
      sharedTypes,
      runtimeCodec,
      rendererClient
    ] = await Promise.all([
      source('src/shared/types/uploader.ts'),
      source('src/main/ipc/uploaderRuntimeCodec.ts'),
      source('src/renderer/src/services/uploaderClient.ts')
    ])
    const availabilityTypes = sharedTypes.slice(
      sharedTypes.indexOf('export type UploaderAvailabilityRequest'),
      sharedTypes.indexOf('export interface UploaderAvailabilityReceipt')
    )
    const availabilityCodec = runtimeCodec.slice(
      runtimeCodec.indexOf(
        'export function decodeUploaderAvailabilityRequest'
      )
    )

    expect(availabilityTypes).not.toContain('executablePath')
    expect(availabilityTypes).not.toContain('pathname')
    expect(availabilityCodec).not.toContain('executablePath')
    expect(availabilityCodec).not.toContain('pathname')
    expect(rendererClient).not.toMatch(
      /inspectConfiguredUploader[\s\S]*executablePath/
    )
  })

  it('replaces the generic renderer command probe with uploader availability', async() => {
    const [
      ipcIndex,
      preload,
      globalTypes,
      ipcTypes,
      uploaderPreferences
    ] = await Promise.all([
      source('src/main/ipc/index.ts'),
      source('src/preload/index.ts'),
      source('src/types/global.d.ts'),
      source('src/shared/types/ipc.ts'),
      source(
        'src/renderer/src/prefComponents/image/components/uploader/index.vue'
      )
    ])
    const production = [
      ipcIndex,
      preload,
      globalTypes,
      ipcTypes,
      uploaderPreferences
    ].join('\n')

    expect(production).not.toContain('mt::cmd::exists')
    expect(production).not.toContain('commandExists')
    expect(uploaderPreferences).toContain('inspectConfiguredUploader')
  })

  it('removes every generic renderer filesystem read and executable channel', async() => {
    const [
      preload,
      globalTypes,
      ipcTypes
    ] = await Promise.all([
      source('src/preload/index.ts'),
      source('src/types/global.d.ts'),
      source('src/shared/types/ipc.ts')
    ])
    const production = [
      preload,
      globalTypes,
      ipcTypes
    ].join('\n')

    for (const channel of [
      'mt::fs::is-file',
      'mt::fs::is-directory',
      'mt::fs::stat',
      'mt::fs::read-file',
      'mt::fs::readdir',
      'mt::fs::is-executable'
    ]) {
      expect(production).not.toContain(channel)
    }
    expect(preload).not.toMatch(/\bisExecutable\s*:/)
    expect(globalTypes).not.toMatch(/\bisExecutable\s*\(/)
  })

  it('carries the exact image admission through upload and insertion', async() => {
    const editor = await source(
      'src/renderer/src/components/editorWithTabs/editor.vue'
    )
    const routeStart = editor.indexOf(
      "if (action === 'upload'"
    )
    const routeEnd = editor.indexOf(
      'const storage =',
      routeStart
    )
    const uploadRoute = editor.slice(routeStart, routeEnd)

    expect(uploadRoute).toContain('admission.documentId')
    expect(uploadRoute).toContain('completeUploadedImageInsertion')
    expect(uploadRoute).not.toContain('tab.pathname')
    expect(uploadRoute).not.toContain('preferencesStore')
  })

  it('revalidates the admitted target after File bytes load and before upload', async() => {
    const editor = await source(
      'src/renderer/src/components/editorWithTabs/editor.vue'
    )
    const fileRead = editor.indexOf('await imageAssetSourceFromFile(image)')
    const revalidation = editor.indexOf(
      'await assertImageInsertionAdmission',
      fileRead
    )
    const upload = editor.indexOf('uploaded = await uploadImage', revalidation)

    expect(fileRead).toBeGreaterThan(-1)
    expect(revalidation).toBeGreaterThan(fileRead)
    expect(upload).toBeGreaterThan(revalidation)
  })

  it('has no renderer path-to-uploader-setting mutation route', async() => {
    const [
      dataCenter,
      rendererStore,
      uploaderPreferences,
      ipcTypes
    ] = await Promise.all([
      source('src/main/dataCenter/index.ts'),
      source('src/renderer/src/store/preferences.ts'),
      source(
        'src/renderer/src/prefComponents/image/components/uploader/index.vue'
      ),
      source('src/shared/types/ipc.ts')
    ])
    const production = [
      dataCenter,
      rendererStore,
      uploaderPreferences,
      ipcTypes
    ].join('\n')

    expect(production).not.toContain('mt::set-user-data')
    expect(dataCenter).not.toContain('RENDERER_MUTABLE_DATA_KEYS')
    expect(rendererStore).not.toContain("type: 'cliScript'")
    expect(uploaderPreferences).toContain('readonly')
    expect(ipcTypes).toContain("'mt::uploader::select'")
    expect(ipcTypes).toContain(
      "'mt::uploader::choose-custom-executable'"
    )
  })
})
