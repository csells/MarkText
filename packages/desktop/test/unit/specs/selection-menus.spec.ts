import { describe, it, expect } from 'vitest'
import { type Menu } from 'electron'

import { updateSelectionMenus } from 'main_renderer/menu/actions/paragraph'
import {
  documentCapabilityMenuState
} from '@/components/editorWithTabs/documentCapabilityMenu'
import {
  EDITOR_INTENT_KINDS,
  type IntentCapabilitySnapshot
} from '@marktext/document-core'
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

const ALL_ENABLED = Object.fromEntries(
  EDITOR_INTENT_KINDS.map(kind => [kind, { enabled: true }])
) as IntentCapabilitySnapshot

const CONVERSION_ROWS = [
  'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6',
  'upgradeHeading', 'degradeHeading', 'codeFences', 'quoteBlock',
  'mathBlock', 'htmlBlock', 'orderList', 'bulletList', 'taskList',
  'looseListItem', 'paragraph', 'horizontalLine', 'frontMatter'
] as const

const FORMAT_ROWS = [
  'strong', 'emphasis', 'underline', 'superscript', 'subscript',
  'highlight', 'inlineCode', 'inlineMath', 'strike', 'hyperlink',
  'clearFormat'
] as const

// G5: the one menu-row availability policy — capability snapshot x
// selection context x surface. Main projects; these rows pin the policy.
describe('documentCapabilityMenuState', () => {
  it('disables every conversion row for a disabled (table) selection but keeps formats', () => {
    const rows = documentCapabilityMenuState(
      ALL_ENABLED,
      selectionState({ isDisabled: true, isTable: true }),
      'markup'
    )
    for (const row of CONVERSION_ROWS) expect(rows[row], row).toBe(false)
    expect(rows.table).toBe(false)
    for (const row of FORMAT_ROWS) expect(rows[row], row).toBe(true)
    expect(rows.image).toBe(true)
  })

  it('enables only the honest cross-block set for a multiline selection', () => {
    const rows = documentCapabilityMenuState(
      ALL_ENABLED,
      selectionState({ isMultiblock: true }),
      'markup'
    )
    const enabled = CONVERSION_ROWS.filter(row => rows[row])
    expect(enabled.sort()).toEqual(
      ['bulletList', 'codeFences', 'orderList', 'quoteBlock', 'taskList'].sort()
    )
    expect(rows.table).toBe(false)
    expect(rows.hyperlink).toBe(false)
    expect(rows.image).toBe(false)
    expect(rows.strong).toBe(true)
  })

  it('disables every format row for code content and keeps the code-fence toggle', () => {
    const rows = documentCapabilityMenuState(
      ALL_ENABLED,
      selectionState({
        activeBlockKinds: ['code-block'],
        isCodeLike: true,
        isCodeBlock: true
      }),
      'markup'
    )
    for (const row of FORMAT_ROWS) expect(rows[row], row).toBe(false)
    expect(rows.image).toBe(false)
    expect(rows.paragraph).toBe(false)
    expect(rows.heading1).toBe(false)
    expect(rows.codeFences).toBe(true)
  })

  it('gates loose-list-item on list context and front matter on uniqueness', () => {
    const outside = documentCapabilityMenuState(
      ALL_ENABLED, selectionState(), 'markup'
    )
    expect(outside.looseListItem).toBe(false)
    expect(outside.frontMatter).toBe(true)
    const inside = documentCapabilityMenuState(
      ALL_ENABLED,
      selectionState({ isUnorderedList: true }),
      'markup'
    )
    expect(inside.looseListItem).toBe(true)
    const hasFront = documentCapabilityMenuState(
      ALL_ENABLED,
      selectionState({ hasFrontMatter: true }),
      'markup'
    )
    expect(hasFront.frontMatter).toBe(false)
  })

  it('folds the Source surface over structure and format rows but not Edit rows', () => {
    const rows = documentCapabilityMenuState(
      ALL_ENABLED, selectionState(), 'source'
    )
    expect(rows.undo).toBe(true)
    expect(rows.redo).toBe(true)
    expect(rows.duplicateBlock).toBe(true)
    for (const row of CONVERSION_ROWS) expect(rows[row], row).toBe(false)
    expect(rows.table).toBe(false)
    for (const row of FORMAT_ROWS) expect(rows[row], row).toBe(false)
    expect(rows.image).toBe(false)
  })

  it('reads the capability snapshot before any context', () => {
    const disabledConversions = documentCapabilityMenuState(
      Object.freeze({
        ...ALL_ENABLED,
        'convert-block': { enabled: false, reason: 'source-only-revision' }
      }) as IntentCapabilitySnapshot,
      selectionState(),
      'markup'
    )
    for (const row of CONVERSION_ROWS) {
      expect(disabledConversions[row], row).toBe(false)
    }
    expect(disabledConversions.table).toBe(true)
    const none = documentCapabilityMenuState(null, null, 'markup')
    expect(Object.values(none).every(bit => bit === false)).toBe(true)
  })
})

describe('updateSelectionMenus', () => {
  it('checks the parser-derived heading level and writes no enablement', () => {
    const menu = makeMenu()
    menu.paragraphItems.forEach((item) => (item.enabled = false))

    updateSelectionMenus(menu as unknown as Menu, selectionState({
      activeBlockKinds: ['heading'],
      headingLevel: 1
    }))

    const checked = menu.paragraphItems.filter((i) => i.checked).map((i) => i.id)
    expect(checked).toEqual(['heading1MenuItem'])
    // Row availability belongs to the capability record; the selection
    // writer owns only checked state.
    expect(menu.paragraphItems.every((i) => i.enabled === false)).toBe(true)
    expect(menu.formatItems.every((i) => i.enabled === true)).toBe(true)
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
})
