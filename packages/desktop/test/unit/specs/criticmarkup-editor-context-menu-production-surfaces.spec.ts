import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  appended: [] as MenuItemConstructorOptions[],
  ipcEmit: vi.fn(),
  popup: vi.fn()
}))
const spellchecker = vi.hoisted(() => ({ addToDictionary: vi.fn(() => true) }))

vi.mock('electron', () => {
  class MenuItem {
    constructor(options: MenuItemConstructorOptions) {
      Object.assign(this, options)
    }
  }
  class Menu {
    append(item: MenuItemConstructorOptions): void {
      electron.appended.push(item)
    }

    popup(options: unknown): void {
      electron.popup(options)
    }
  }
  return {
    ipcMain: { emit: electron.ipcEmit },
    Menu,
    MenuItem
  }
})
vi.mock('electron-log', () => ({ default: { error: vi.fn() } }))
vi.mock('main_renderer/config', () => ({ isOsx: false }))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))
vi.mock('main_renderer/spellchecker', () => ({
  addToDictionary: spellchecker.addToDictionary
}))

import { showEditorContextMenu } from 'main_renderer/contextMenu/editor'

const send = vi.fn()
const replaceMisspelling = vi.fn()
const fakeWindow = {
  webContents: { replaceMisspelling, send }
} as unknown as BrowserWindow

const params = (
  selectionText: string,
  misspelledWord?: string,
  dictionarySuggestions?: string[]
) => ({
  isEditable: true,
  selectionText,
  editFlags: {
    canCut: true,
    canCopy: true,
    canPaste: true,
    canEditRichly: true
  },
  misspelledWord,
  dictionarySuggestions,
  x: 12,
  y: 34
})

const show = (
  selectionText: string,
  misspelledWord?: string,
  dictionarySuggestions?: string[]
): void => {
  showEditorContextMenu(
    fakeWindow,
    {},
    params(selectionText, misspelledWord, dictionarySuggestions),
    true
  )
}

const click = (item: MenuItemConstructorOptions): void => {
  if (typeof item.click !== 'function') {
    throw new Error(`Context-menu item ${item.label ?? item.id} requires a click callback`)
  }
  item.click(item as never, fakeWindow, {} as KeyboardEvent)
}

const required = <Value>(value: Value | undefined, itemId: string): Value => {
  if (value === undefined) throw new Error(`Missing context-menu surface ${itemId}`)
  return value
}

describe('CriticMarkup editor context-menu production surfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electron.appended.length = 0
  })

  it('exposes exact native clipboard roles and renderer edit actions', () => {
    show('selected')

    const items = Object.fromEntries(electron.appended
      .filter(item => item.id)
      .map(item => [item.id, item]))

    expect({
      'menu-entry:contextMenu.cut': items.cutMenuItem?.role,
      'menu-entry:contextMenu.copy': items.copyMenuItem?.role,
      'menu-entry:contextMenu.paste': items.pasteMenuItem?.role
    }).toEqual({
      'menu-entry:contextMenu.cut': 'cut',
      'menu-entry:contextMenu.copy': 'copy',
      'menu-entry:contextMenu.paste': 'paste'
    })

    const rendererActions = [
      ['menu-entry:contextMenu.copyAsRich', 'copyAsRichMenuItem', ['mt::cm-copy-as-rich']],
      ['menu-entry:contextMenu.copyAsHtml', 'copyAsHtmlMenuItem', ['mt::cm-copy-as-html']],
      ['menu-entry:contextMenu.pasteAsPlainText', 'pasteAsPlainTextMenuItem', ['mt::cm-paste-as-plain-text']],
      ['menu-entry:contextMenu.insertParagraphBefore', 'insertParagraphBeforeMenuItem', ['mt::cm-insert-paragraph', 'before']],
      ['menu-entry:contextMenu.insertParagraphAfter', 'insertParagraphAfterMenuItem', ['mt::cm-insert-paragraph', 'after']]
    ] as const

    for (const [itemId, id, expected] of rendererActions) {
      send.mockClear()
      click(required(items[id], itemId))
      expect(send.mock.calls, itemId).toEqual([expected])
    }

    expect(electron.popup.mock.calls).toEqual([[{
      window: fakeWindow,
      x: 12,
      y: 34
    }]])
  })

  it('routes spelling root, language, and dictionary surfaces to exact boundaries', () => {
    show('typo', 'typo', [])
    const spelling = electron.appended.find(item => item.label === 'contextMenu.spelling')
    const misspelledSubmenu = spelling?.submenu as MenuItemConstructorOptions[]

    expect(spelling?.label, 'menu-entry:contextMenu.spelling')
      .toBe('contextMenu.spelling')

    const changeLanguage = required(misspelledSubmenu.find(
      item => item.label === 'contextMenu.changeLanguage'
    ), 'menu-entry:contextMenu.changeLanguage')
    click(changeLanguage)
    expect(send.mock.calls, 'menu-entry:contextMenu.changeLanguage')
      .toEqual([['mt::spelling-show-switch-language']])

    vi.clearAllMocks()
    const add = required(misspelledSubmenu.find(
      item => item.label === 'contextMenu.addToDictionary'
    ), 'menu-entry:contextMenu.addToDictionary')
    click(add)
    expect(spellchecker.addToDictionary.mock.calls, 'menu-entry:contextMenu.addToDictionary')
      .toEqual([[fakeWindow, 'typo']])
    expect(replaceMisspelling.mock.calls, 'menu-entry:contextMenu.addToDictionary')
      .toEqual([['typo']])

    vi.clearAllMocks()
    electron.appended.length = 0
    show('correct')
    const correctSpelling = electron.appended.find(
      item => item.label === 'contextMenu.spelling'
    )
    const correctSubmenu = correctSpelling?.submenu as MenuItemConstructorOptions[]
    const edit = required(correctSubmenu.find(
      item => item.label === 'contextMenu.editDictionary'
    ), 'menu-entry:contextMenu.editDictionary')
    click(edit)
    expect(electron.ipcEmit.mock.calls, 'menu-entry:contextMenu.editDictionary')
      .toEqual([['app-create-settings-window', 'spelling']])
  })
})
