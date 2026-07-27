import path from 'node:path'
import { readFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const desktopRoot = path.resolve(__dirname, '../../../')

async function source(relativePath: string): Promise<string> {
  return await readFile(path.join(desktopRoot, relativePath), 'utf8')
}

async function rendererSources(directory: string): Promise<string[]> {
  const absolute = path.join(desktopRoot, directory)
  const entries = await readdir(absolute, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    const relative = path.join(directory, entry.name)
    if (entry.isDirectory()) return await rendererSources(relative)
    return /\.(?:ts|vue)$/u.test(entry.name) ? [await source(relative)] : []
  }))
  return nested.flat()
}

describe('presentation effect authority cutover', () => {
  it('physically removes the generic renderer shell bridge and IPC channels', async() => {
    await expect(source('src/main/ipc/shell.ts'))
      .rejects.toMatchObject({ code: 'ENOENT' })

    const [
      preload,
      globals,
      ipc,
      renderer
    ] = await Promise.all([
      source('src/preload/index.ts'),
      source('src/types/global.d.ts'),
      source('src/shared/types/ipc.ts'),
      rendererSources('src/renderer/src')
    ])
    const rendererContract = [preload, globals, ipc, ...renderer].join('\n')

    for (const residue of [
      'mt::shell::open-external',
      'mt::shell::open-path',
      'mt::shell::show-item',
      'window.electron.shell',
      'ElectronShellAPI'
    ]) {
      expect(rendererContract).not.toContain(residue)
    }
  })

  it('keeps every renderer external-resource request URL-free', async() => {
    const [
      service,
      commands,
      notifications,
      keybindings,
      uploader,
      general,
      exportSettings,
      folderSettings
    ] = await Promise.all([
      source('src/renderer/src/services/presentationEffects.ts'),
      source('src/renderer/src/commands/index.ts'),
      source('src/renderer/src/store/notification.ts'),
      source('src/renderer/src/prefComponents/keybindings/index.vue'),
      source('src/renderer/src/prefComponents/image/components/uploader/index.vue'),
      source('src/renderer/src/prefComponents/general/index.vue'),
      source('src/renderer/src/components/exportSettings/index.vue'),
      source('src/renderer/src/prefComponents/image/components/folderSetting/index.vue')
    ])
    const rendererExternalResources = [
      service,
      commands,
      notifications,
      keybindings,
      uploader,
      general,
      exportSettings,
      folderSettings
    ].join('\n')

    expect(rendererExternalResources).not.toMatch(/https?:\/\//u)
    expect(service).toContain("'mt::external-resource::open'")
    expect(service).not.toMatch(/\burl\b/u)
  })

  it('sends identities and project segments, never reveal paths', async() => {
    const [
      service,
      tabs,
      project,
      imageFolder,
      editor,
      documentCore
    ] = await Promise.all([
      source('src/renderer/src/services/presentationEffects.ts'),
      source('src/renderer/src/components/editorWithTabs/tabs.vue'),
      source('src/renderer/src/store/project.ts'),
      source('src/renderer/src/prefComponents/image/components/folderSetting/index.vue'),
      source('src/renderer/src/components/editorWithTabs/editor.vue'),
      source('src/main/ipc/documentCore.ts')
    ])

    expect(service).not.toMatch(
      /\b(?:pathname|fullPath|targetPath|imageFolderPath|url)\b/u
    )
    expect(tabs).toContain('revealDocument(tab.id)')
    expect(project).toContain('revealProjectEntry(entrySegments)')
    expect(imageFolder).toContain('openConfiguredImageFolder()')
    expect(editor).toContain('revealStaticOutput({')
    expect(documentCore).toContain('retainStaticOutput(')
  })
})
