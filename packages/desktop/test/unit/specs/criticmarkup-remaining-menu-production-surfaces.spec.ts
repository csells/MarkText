import type { BrowserWindow, MenuItem, MenuItemConstructorOptions } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sideBar = vi.hoisted(() => ({
  copy: vi.fn(),
  cut: vi.fn(),
  newDirectory: vi.fn(),
  newFile: vi.fn(),
  paste: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  showInFolder: vi.fn()
}))
const edit = vi.hoisted(() => ({ lineEnding: vi.fn() }))
const theme = vi.hoisted(() => ({
  selectTheme: vi.fn(),
  setFollowSystemTheme: vi.fn()
}))

vi.mock('@/contextMenu/sideBar/actions', () => sideBar)
vi.mock('main_renderer/menu/actions/edit', () => ({
  editorCopyAsHtml: vi.fn(),
  editorCopyAsRich: vi.fn(),
  editorCreateParagraph: vi.fn(),
  editorDeleteParagraph: vi.fn(),
  editorDuplicate: vi.fn(),
  editorFind: vi.fn(),
  editorFindNext: vi.fn(),
  editorFindPrevious: vi.fn(),
  editorPasteAsPlainText: vi.fn(),
  editorRedo: vi.fn(),
  editorReplace: vi.fn(),
  editorSelectAll: vi.fn(),
  editorUndo: vi.fn(),
  findInFolder: vi.fn(),
  lineEnding: edit.lineEnding,
  nativeCopy: vi.fn(),
  nativeCut: vi.fn(),
  nativePaste: vi.fn(),
  screenshot: vi.fn()
}))
vi.mock('main_renderer/menu/actions/format', () => ({}))
vi.mock('main_renderer/menu/actions/theme', () => theme)
vi.mock('main_renderer/config', () => ({ isOsx: false }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))

import {
  getCOPY,
  getCUT,
  getDELETE,
  getNewDirectory,
  getNewFile,
  getPASTE,
  getRENAME,
  getShowInFolder
} from '@/contextMenu/sideBar/menuItems'
import editMenuTemplate from 'main_renderer/menu/templates/edit'
import formatMenuTemplate from 'main_renderer/menu/templates/format'
import themeMenuTemplate from 'main_renderer/menu/templates/theme'

const fakeWindow = { id: 42 } as unknown as BrowserWindow

const click = (item: MenuItemConstructorOptions): void => {
  if (typeof item.click !== 'function') {
    throw new Error(`Menu item ${item.label ?? item.id} requires a click callback`)
  }
  item.click(item as unknown as MenuItem, fakeWindow, {} as KeyboardEvent)
}

const find = (
  items: MenuItemConstructorOptions[],
  label: string
): MenuItemConstructorOptions => {
  const item = items.find(candidate => candidate.label === label)
  if (!item) throw new Error(`Missing menu item ${label}`)
  return item
}

describe('CriticMarkup remaining menu production surfaces', () => {
  beforeEach(() => vi.clearAllMocks())

  it('routes every Sidebar context-menu item to its exact filesystem action', () => {
    const surfaces = [
      ['menu-entry:contextMenu.sideBar.newFile', getNewFile, sideBar.newFile],
      ['menu-entry:contextMenu.sideBar.newDirectory', getNewDirectory, sideBar.newDirectory],
      ['menu-entry:contextMenu.sideBar.copy', getCOPY, sideBar.copy],
      ['menu-entry:contextMenu.sideBar.cut', getCUT, sideBar.cut],
      ['menu-entry:contextMenu.sideBar.paste', getPASTE, sideBar.paste],
      ['menu-entry:contextMenu.sideBar.rename', getRENAME, sideBar.rename],
      ['menu-entry:contextMenu.sideBar.moveToTrash', getDELETE, sideBar.remove],
      ['menu-entry:contextMenu.sideBar.showInFolder', getShowInFolder, sideBar.showInFolder]
    ] as const

    for (const [itemId, factory, action] of surfaces) {
      click(factory())
      expect(action.mock.calls, itemId).toEqual([[]])
      action.mockClear()
    }
  })

  it('routes Edit line-ending choices and exposes their exact containers', () => {
    const template = editMenuTemplate({ getAccelerator: () => undefined } as never)
    const submenu = template.submenu as MenuItemConstructorOptions[]
    const lineEnding = find(submenu, 'menu.edit.lineEnding')
    const choices = lineEnding.submenu as MenuItemConstructorOptions[]

    expect(template.label, 'menu-entry:menu.edit.edit').toBe('menu.edit.edit')
    expect(lineEnding.label, 'menu-entry:menu.edit.lineEnding').toBe('menu.edit.lineEnding')

    click(find(choices, 'menu.edit.lineEndingCrlf'))
    expect(edit.lineEnding.mock.calls, 'menu-entry:menu.edit.lineEndingCrlf')
      .toEqual([[fakeWindow, 'crlf']])

    edit.lineEnding.mockClear()
    click(find(choices, 'menu.edit.lineEndingLf'))
    expect(edit.lineEnding.mock.calls, 'menu-entry:menu.edit.lineEndingLf')
      .toEqual([[fakeWindow, 'lf']])
  })

  it('exposes the Format root for its already-proven executable leaves', () => {
    const template = formatMenuTemplate({ getAccelerator: () => undefined } as never)
    expect({
      itemId: 'menu-entry:menu.format.format',
      id: template.id,
      label: template.label,
      leafCount: (template.submenu as MenuItemConstructorOptions[])
        .filter(item => typeof item.click === 'function').length
    }).toEqual({
      itemId: 'menu-entry:menu.format.format',
      id: 'formatMenuItem',
      label: 'menu.format.format',
      leafCount: 12
    })
  })

  it('exposes exact Theme root, groups, and follow-system disabled notice', () => {
    const template = themeMenuTemplate({
      getAll: () => ({ theme: 'dark', followSystemTheme: true })
    } as never)
    const submenu = template.submenu as MenuItemConstructorOptions[]

    expect(template.label, 'menu-entry:menu.theme.theme').toBe('menu.theme.theme')
    expect(find(submenu, 'menu.theme.lightThemes').submenu,
      'menu-entry:menu.theme.lightThemes').toHaveLength(10)
    expect(find(submenu, 'menu.theme.darkThemes').submenu,
      'menu-entry:menu.theme.darkThemes').toHaveLength(23)
    expect(find(submenu, 'menu.theme.followThemDisabled'),
      'menu-entry:menu.theme.followThemDisabled').toMatchObject({
      label: 'menu.theme.followThemDisabled',
      enabled: false
    })
  })
})
