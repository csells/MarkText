import { describe, it, expect } from 'vitest'
import { type Menu } from 'electron'

import { updateSelectionMenus } from 'main_renderer/menu/actions/paragraph'
import type { DocumentSelectionMenuState } from '@shared/types/documentSelection'

// Real paragraph submenu ids (see src/main/menu/templates/paragraph.ts). The
// source reads the paragraph entry via getMenuItemById('paragraphMenuEntry').
const PARAGRAPH_MENU_IDS = [
  'heading1MenuItem',
  'heading2MenuItem',
  'heading3MenuItem',
  'heading4MenuItem',
  'heading5MenuItem',
  'heading6MenuItem',
  'upgradeHeadingMenuItem',
  'degradeHeadingMenuItem',
  'tableMenuItem',
  'codeFencesMenuItem',
  'quoteBlockMenuItem',
  'mathBlockMenuItem',
  'htmlBlockMenuItem',
  'orderListMenuItem',
  'bulletListMenuItem',
  'taskListMenuItem',
  'looseListItemMenuItem',
  'paragraphMenuItem',
  'horizontalLineMenuItem',
  'frontMatterMenuItem'
]

// Real format submenu ids (see src/main/menu/templates/format.ts).
const FORMAT_MENU_IDS = [
  'strongMenuItem',
  'emphasisMenuItem',
  'underlineMenuItem',
  'superscriptMenuItem',
  'subscriptMenuItem',
  'highlightMenuItem',
  'inlineCodeMenuItem',
  'inlineMathMenuItem',
  'strikeMenuItem',
  'hyperlinkMenuItem',
  'imageMenuItem'
]

// `updateSelectionMenus` enables/disables (and re-checks) menu items via a
// loosely-typed Electron application menu surface: `getMenuItemById(id)`
// returns an object whose `submenu.items` are menu items keyed by `id`.
const makeMenu = () => {
  const paragraphItems = PARAGRAPH_MENU_IDS.map((id) => ({ id, enabled: true, checked: false }))
  const formatItems = FORMAT_MENU_IDS.map((id) => ({ id, enabled: true, checked: false }))
  return {
    paragraphItems,
    formatItems,
    getMenuItemById: (id: string) => {
      if (id === 'paragraphMenuEntry') return { submenu: { items: paragraphItems } }
      if (id === 'formatMenuItem') return { submenu: { items: formatItems } }
      return undefined
    }
  }
}

type FakeMenu = ReturnType<typeof makeMenu>

const enabledIds = (items: FakeMenu['paragraphItems']) =>
  items.filter((i) => i.enabled).map((i) => i.id)

const selectionState = (
  overrides: Partial<DocumentSelectionMenuState> = {}
): DocumentSelectionMenuState => ({
  activeBlockKinds: ['paragraph'],
  headingLevel: null,
  isDisabled: false,
  isMultiblock: false,
  isLooseList: false,
  isTaskList: false,
  isOrderedList: false,
  isUnorderedList: false,
  isCodeLike: false,
  isCodeBlock: false,
  isTable: false,
  hasFrontMatter: false,
  ...overrides
})

describe('updateSelectionMenus', () => {
  it('disables every Paragraph submenu item when the selection is disabled (table/multi-block)', () => {
    const menu = makeMenu()

    updateSelectionMenus(menu as unknown as Menu, selectionState({ isDisabled: true }))

    expect(enabledIds(menu.paragraphItems)).toEqual([])
    expect(menu.paragraphItems.every((i) => i.enabled === false)).toBe(true)
  })

  it('leaves the Format submenu fully enabled for a disabled selection (it is reset first)', () => {
    const menu = makeMenu()

    updateSelectionMenus(menu as unknown as Menu, selectionState({ isDisabled: true }))

    expect(menu.formatItems.every((i) => i.enabled === true)).toBe(true)
  })

  it('enables only the honest set in Paragraph and disables link/image in Format for a multiline selection', () => {
    const menu = makeMenu()

    updateSelectionMenus(menu as unknown as Menu, selectionState({ isMultiblock: true }))

    // Paragraph: only code/quote/ordered/bullet/task are actionable across blocks.
    expect(enabledIds(menu.paragraphItems).sort()).toEqual(
      ['bulletListMenuItem', 'codeFencesMenuItem', 'orderListMenuItem', 'quoteBlockMenuItem', 'taskListMenuItem'].sort()
    )

    // Format: only link/image are disabled.
    const formatDisabled = menu.formatItems.filter((i) => !i.enabled).map((i) => i.id)
    expect(formatDisabled.sort()).toEqual(['hyperlinkMenuItem', 'imageMenuItem'].sort())
  })

  it('disables every Format submenu item for code content and re-enables codeFences (Paragraph)', () => {
    const menu = makeMenu()

    updateSelectionMenus(menu as unknown as Menu, {
      ...selectionState(),
      activeBlockKinds: ['code-block'],
      isCodeLike: true,
      isCodeBlock: true
    })

    // Every format item is disabled inside code content.
    expect(menu.formatItems.every((i) => i.enabled === false)).toBe(true)

    // Paragraph submenu is disabled wholesale by isCodeFences...
    const paraItem = (id: string) => menu.paragraphItems.find((i) => i.id === id)!
    expect(paraItem('paragraphMenuItem').enabled).toBe(false)
    expect(paraItem('heading1MenuItem').enabled).toBe(false)
    // The selected code block keeps its own conversion toggle available.
    expect(paraItem('codeFencesMenuItem').enabled).toBe(true)
  })

  it('disables loose-list-item when the selection is not in a list', () => {
    const menu = makeMenu()

    updateSelectionMenus(menu as unknown as Menu, selectionState())

    const loose = menu.paragraphItems.find((i) => i.id === 'looseListItemMenuItem')!
    expect(loose.enabled).toBe(false)
  })

  it('keeps loose-list-item enabled in a list', () => {
    const menu = makeMenu()

    updateSelectionMenus(menu as unknown as Menu, selectionState({
      activeBlockKinds: ['list', 'list-item', 'paragraph'],
      isUnorderedList: true
    }))

    const loose = menu.paragraphItems.find((i) => i.id === 'looseListItemMenuItem')!
    expect(loose.enabled).toBe(true)
  })

  it('checks the parser-derived heading level', () => {
    const menu = makeMenu()

    updateSelectionMenus(menu as unknown as Menu, selectionState({
      activeBlockKinds: ['heading'],
      headingLevel: 1
    }))

    const checked = menu.paragraphItems.filter((i) => i.checked).map((i) => i.id)
    expect(checked).toEqual(['heading1MenuItem'])
  })
})

describe('updateSelectionMenus — front matter', () => {
  it('disables Front Matter when the document already has front matter', () => {
    const menu = makeMenu()

    updateSelectionMenus(menu as unknown as Menu, selectionState({ hasFrontMatter: true }))

    const fm = menu.paragraphItems.find((i) => i.id === 'frontMatterMenuItem')!
    expect(fm.enabled).toBe(false)
  })

  it('keeps Front Matter enabled when the document has none', () => {
    const menu = makeMenu()

    updateSelectionMenus(menu as unknown as Menu, selectionState())

    const fm = menu.paragraphItems.find((i) => i.id === 'frontMatterMenuItem')!
    expect(fm.enabled).toBe(true)
  })
})

describe('updateSelectionMenus — format disabled in non-formattable blocks', () => {
  it('disables all format items in parser-owned code-like blocks', () => {
    const menu = makeMenu()

    updateSelectionMenus(menu as unknown as Menu, selectionState({
      activeBlockKinds: ['math-block'],
      isCodeLike: true
    }))

    expect(menu.formatItems.every((i) => i.enabled === false)).toBe(true)
  })

  it('keeps format items enabled inside a table (disabled paragraph, not code)', () => {
    const menu = makeMenu()

    updateSelectionMenus(menu as unknown as Menu, selectionState({
      activeBlockKinds: ['table', 'table-cell'],
      isTable: true,
      isDisabled: true
    }))

    expect(menu.formatItems.every((i) => i.enabled === true)).toBe(true)
  })
})

describe('updateSelectionMenus — list kinds', () => {
  it('checks the task list but not bullet for a task selection', () => {
    const menu = makeMenu()
    updateSelectionMenus(menu as unknown as Menu, selectionState({
      activeBlockKinds: ['list', 'list-item', 'paragraph'],
      isTaskList: true
    }))
    const ids = menu.paragraphItems.filter((i) => i.checked).map((i) => i.id)
    expect(ids).toContain('taskListMenuItem')
    expect(ids).not.toContain('bulletListMenuItem')
  })

  it('checks every parser-derived list kind in a nested selection', () => {
    const menu = makeMenu()
    updateSelectionMenus(menu as unknown as Menu, selectionState({
      activeBlockKinds: ['list', 'list-item', 'paragraph'],
      isOrderedList: true,
      isTaskList: true,
      isUnorderedList: true
    }))
    const ids = menu.paragraphItems.filter((i) => i.checked).map((i) => i.id).sort()
    expect(ids).toEqual(['bulletListMenuItem', 'orderListMenuItem', 'taskListMenuItem'].sort())
  })

  it('keeps loose-list-item enabled inside a task list', () => {
    const menu = makeMenu()
    updateSelectionMenus(menu as unknown as Menu, selectionState({
      activeBlockKinds: ['list', 'list-item', 'paragraph'],
      isTaskList: true
    }))
    const loose = menu.paragraphItems.find((i) => i.id === 'looseListItemMenuItem')!
    expect(loose.enabled).toBe(true)
  })
})
