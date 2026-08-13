import type { BrowserWindow, MenuItem, MenuItemConstructorOptions } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const boundaries = vi.hoisted(() => ({
  checkUpdates: vi.fn(),
  openExternal: vi.fn()
}))

vi.mock('electron', () => ({
  shell: { openExternal: boundaries.openExternal }
}))
vi.mock('common/filesystem', () => ({ isFile: () => true }))
vi.mock('main_renderer/menu/actions/marktext', () => ({
  checkUpdates: boundaries.checkUpdates
}))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import helpMenu from 'main_renderer/menu/templates/help'

const send = vi.fn()
const fakeWindow = {
  webContents: { send }
} as unknown as BrowserWindow

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
const originalAppImage = process.env.APPIMAGE
Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
Object.defineProperty(process, 'resourcesPath', { configurable: true, value: '/tmp' })
process.env.APPIMAGE = '1'
const template = helpMenu()
if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath)
else Reflect.deleteProperty(process, 'resourcesPath')
if (originalAppImage === undefined) delete process.env.APPIMAGE
else process.env.APPIMAGE = originalAppImage

const submenu = template.submenu as MenuItemConstructorOptions[]

const clickHelpMenu = async(label: string): Promise<void> => {
  const item = submenu.find(candidate => candidate.label === label)
  if (typeof item?.click !== 'function') {
    throw new Error(`Help menu item ${label} requires a click callback`)
  }
  await item.click({} as MenuItem, fakeWindow, {} as KeyboardEvent)
}

describe('CriticMarkup Help production surfaces', () => {
  beforeEach(() => vi.clearAllMocks())

  it('routes every external Help menu surface to its exact trusted URL', async() => {
    const surfaces = [
      ['menu-entry:menu.help.markdownReference', 'menu.help.markdownReference', 'https://marktext.me/docs/markdown-syntax'],
      ['menu-entry:menu.help.changelog', 'menu.help.changelog', 'https://github.com/marktext/marktext/releases'],
      ['menu-entry:menu.help.followUs', 'menu.help.followUs', 'https://twitter.com/marktextapp'],
      ['menu-entry:menu.help.support', 'menu.help.support', 'https://github.com/sponsors/marktext'],
      ['menu-entry:menu.help.askQuestion', 'menu.help.askQuestion', 'https://github.com/marktext/marktext/discussions'],
      ['menu-entry:menu.help.reportBug', 'menu.help.reportBug', 'https://github.com/marktext/marktext/issues'],
      ['menu-entry:menu.help.viewSource', 'menu.help.viewSource', 'https://github.com/marktext/marktext'],
      ['menu-entry:menu.help.license', 'menu.help.license', 'https://github.com/marktext/marktext/blob/develop/LICENSE']
    ] as const

    for (const [itemId, label, url] of surfaces) {
      boundaries.openExternal.mockClear()
      await clickHelpMenu(label)
      expect(boundaries.openExternal.mock.calls, itemId).toEqual([[url]])
    }
  })

  it('routes platform Help actions to their exact application boundaries', async() => {
    await clickHelpMenu('menu.help.checkUpdates')
    expect(boundaries.checkUpdates.mock.calls, 'menu-entry:menu.help.checkUpdates')
      .toEqual([[fakeWindow]])

    await clickHelpMenu('menu.help.about')
    expect(send.mock.calls, 'menu-entry:menu.help.about')
      .toEqual([['mt::about-dialog']])
  })

  it('exposes the Help root as the container for the proven leaf surfaces', () => {
    expect({
      itemId: 'menu-entry:menu.help.help',
      label: template.label,
      role: template.role
    }).toEqual({
      itemId: 'menu-entry:menu.help.help',
      label: 'menu.help.help',
      role: 'help'
    })
  })
})
