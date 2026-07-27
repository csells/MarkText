import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = path.resolve(__dirname, '../../..')
const source = (relativePath: string): string =>
  fs.readFileSync(path.join(desktopRoot, relativePath), 'utf8')

describe('native-menu sender authority', () => {
  it('exposes no renderer-supplied window identity for menu state', () => {
    const ipc = source('src/shared/types/ipc.ts')
    const renderer = [
      'src/renderer/src/store/layout.ts',
      'src/renderer/src/store/preferences.ts',
      'src/renderer/src/store/editor.ts',
      'src/renderer/src/components/editorWithTabs/editor.vue'
    ].map(source).join('\n')
    const menu = source('src/main/menu/index.ts')

    for (const channel of [
      'mt::editor-selection-changed',
      'mt::set-document-clipboard-menu-state',
      'mt::set-editor-format-menus-enabled',
      'mt::update-format-menu',
      'mt::update-sidebar-menu',
      'mt::view-layout-changed'
    ]) {
      const contractStart = ipc.indexOf(`'${channel}'`)
      expect(contractStart).toBeGreaterThanOrEqual(0)
      expect(ipc.slice(contractStart, contractStart + 180))
        .not.toContain('windowId')
    }
    expect(renderer).not.toMatch(
      /(?:editor-selection-changed|set-document-clipboard-menu-state|set-editor-format-menus-enabled|update-format-menu|update-sidebar-menu|view-layout-changed)[\s\S]{0,80}windowId/
    )
    expect(menu).not.toContain(
      "ipcMain.on('mt::add-recently-used-document'"
    )
    expect(ipc).not.toContain("'mt::add-recently-used-document'")
  })
})
