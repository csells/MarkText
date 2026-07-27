import { type BrowserWindow, type Menu, type MenuItem } from 'electron'
import { COMMANDS } from '../../commands'
import type { CommandManager } from '../../commands'
import type {
  DocumentSelectionMenuState
} from '../../../shared/types/documentSelection'
import {
  PARAGRAPH_DOCUMENT_ACTIONS,
  type ParagraphDocumentAction
} from '../../../shared/types/paragraphDocumentAction'

type Win = BrowserWindow | null | undefined

// Paragraph-menu items that can actually be executed across a multi-block
// selection; everything else is disabled when the selection spans blocks.
const CROSS_BLOCK_ENABLED_PARAGRAPH: readonly string[] = [
  'codeFencesMenuItem',
  'quoteBlockMenuItem',
  'orderListMenuItem',
  'bulletListMenuItem',
  'taskListMenuItem'
]

const dispatchParagraphAction = (
  win: Win,
  action: ParagraphDocumentAction
): void => {
  if (win && win.webContents) {
    win.webContents.send('mt::editor-paragraph-action', action)
  }
}

export const bulletList = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.bulletList)
}

export const codeFence = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.codeFence)
}

export const degradeHeading = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.degradeHeading)
}

export const frontMatter = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.frontMatter)
}

export const heading1 = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.heading1)
}

export const heading2 = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.heading2)
}

export const heading3 = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.heading3)
}

export const heading4 = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.heading4)
}

export const heading5 = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.heading5)
}

export const heading6 = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.heading6)
}

export const horizontalLine = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.horizontalLine)
}

export const htmlBlock = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.htmlBlock)
}

export const looseListItem = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.looseListItem)
}

export const mathFormula = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.mathFormula)
}

export const orderedList = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.orderedList)
}

export const paragraph = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.paragraph)
}

export const quoteBlock = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.quoteBlock)
}

export const table = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.table)
}

export const taskList = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.taskList)
}

export const increaseHeading = (win: Win): void => {
  dispatchParagraphAction(win, PARAGRAPH_DOCUMENT_ACTIONS.upgradeHeading)
}

// --- Commands -------------------------------------------------------------

export const loadParagraphCommands = (commandManager: CommandManager): void => {
  commandManager.add(COMMANDS.PARAGRAPH_BULLET_LIST, bulletList)
  commandManager.add(COMMANDS.PARAGRAPH_CODE_FENCE, codeFence)
  commandManager.add(COMMANDS.PARAGRAPH_DEGRADE_HEADING, degradeHeading)
  commandManager.add(COMMANDS.PARAGRAPH_FRONT_MATTER, frontMatter)
  commandManager.add(COMMANDS.PARAGRAPH_HEADING_1, heading1)
  commandManager.add(COMMANDS.PARAGRAPH_HEADING_2, heading2)
  commandManager.add(COMMANDS.PARAGRAPH_HEADING_3, heading3)
  commandManager.add(COMMANDS.PARAGRAPH_HEADING_4, heading4)
  commandManager.add(COMMANDS.PARAGRAPH_HEADING_5, heading5)
  commandManager.add(COMMANDS.PARAGRAPH_HEADING_6, heading6)
  commandManager.add(COMMANDS.PARAGRAPH_HORIZONTAL_LINE, horizontalLine)
  commandManager.add(COMMANDS.PARAGRAPH_HTML_BLOCK, htmlBlock)
  commandManager.add(COMMANDS.PARAGRAPH_LOOSE_LIST_ITEM, looseListItem)
  commandManager.add(COMMANDS.PARAGRAPH_MATH_FORMULA, mathFormula)
  commandManager.add(COMMANDS.PARAGRAPH_ORDERED_LIST, orderedList)
  commandManager.add(COMMANDS.PARAGRAPH_PARAGRAPH, paragraph)
  commandManager.add(COMMANDS.PARAGRAPH_QUOTE_BLOCK, quoteBlock)
  commandManager.add(COMMANDS.PARAGRAPH_TABLE, table)
  commandManager.add(COMMANDS.PARAGRAPH_TASK_LIST, taskList)
  commandManager.add(COMMANDS.PARAGRAPH_INCREASE_HEADING, increaseHeading)
}

// --- IPC events -------------------------------------------------------------

// NOTE: Don't use static `getMenuItemById` here, instead request the menu by
//       window id from `AppMenu` manager.

const setParagraphMenuItemStatus = (applicationMenu: Menu, bool: boolean): void => {
  const paragraphMenuItem = applicationMenu.getMenuItemById('paragraphMenuEntry')!
  paragraphMenuItem.submenu!.items.forEach((item: MenuItem) => (item.enabled = bool))
}

const setMultipleStatus = (
  applicationMenu: Menu,
  list: readonly string[],
  status: boolean
): void => {
  const paragraphMenuItem = applicationMenu.getMenuItemById('paragraphMenuEntry')!
  paragraphMenuItem.submenu!.items
    .filter((item: MenuItem) => item.id && list.includes(item.id))
    .forEach((item: MenuItem) => (item.enabled = status))
}

export type SelectionState = DocumentSelectionMenuState

const setCheckedMenuItem = (
  applicationMenu: Menu,
  state: SelectionState
): void => {
  const paragraphMenuItem = applicationMenu.getMenuItemById('paragraphMenuEntry')!
  paragraphMenuItem.submenu!.items.forEach((item: MenuItem) => (item.checked = false))
  paragraphMenuItem.submenu!.items.forEach((item: MenuItem) => {
    const id = item.id
    if (!id) return
    const heading = /^heading([1-6])MenuItem$/.exec(id)
    if (heading !== null) {
      item.checked = state.headingLevel === Number(heading[1])
      return
    }
    const kinds = new Set(state.activeBlockKinds)
    item.checked =
      (id === 'looseListItemMenuItem' && state.isLooseList) ||
      (id === 'tableMenuItem' && state.isTable) ||
      (id === 'codeFencesMenuItem' && kinds.has('code-block')) ||
      (id === 'htmlBlockMenuItem' && kinds.has('html-block')) ||
      (id === 'mathBlockMenuItem' && kinds.has('math-block')) ||
      (id === 'quoteBlockMenuItem' && kinds.has('blockquote')) ||
      (id === 'orderListMenuItem' && state.isOrderedList) ||
      (id === 'bulletListMenuItem' && state.isUnorderedList) ||
      (id === 'taskListMenuItem' && state.isTaskList) ||
      (
        id === 'paragraphMenuItem' &&
        kinds.has('paragraph') &&
        !state.isOrderedList &&
        !state.isUnorderedList &&
        !state.isTaskList
      ) ||
      (id === 'horizontalLineMenuItem' && kinds.has('thematic-break')) ||
      (id === 'frontMatterMenuItem' && kinds.has('front-matter'))
  })
}

/**
 * Update paragraph menu entires from given state.
 *
 * @param applicationMenu The application menu instance.
 * @param state The selection information.
 */
export const updateSelectionMenus = (
  applicationMenu: Menu,
  state: SelectionState
): void => {
  const {
    isDisabled,
    isMultiblock,
    isCodeLike,
    isCodeBlock
  } = state

  // Reset format menu.
  const formatMenuItem: MenuItem = applicationMenu.getMenuItemById('formatMenuItem')!
  formatMenuItem.submenu!.items.forEach((item: MenuItem) => (item.enabled = true))

  // Handle menu checked.
  setCheckedMenuItem(applicationMenu, state)

  // Reset paragraph menu.
  setParagraphMenuItemStatus(applicationMenu, !isDisabled)
  if (isDisabled) {
    return
  }

  if (isCodeLike) {
    setParagraphMenuItemStatus(applicationMenu, false)

    // Non-formattable code-like content (code/math/html/frontmatter/diagram):
    // disable every format item. Tables never reach here (they return early via
    // isDisabled) so table cells keep formatting.
    formatMenuItem.submenu!.items.forEach((item: MenuItem) => (item.enabled = false))

    // A code line is selected — re-enable the code-fence toggle.
    if (isCodeBlock) {
      setMultipleStatus(applicationMenu, ['codeFencesMenuItem'], true)
    }
  } else if (isMultiblock) {
    // Format: link/image are meaningless across a multi-block selection.
    formatMenuItem.submenu!.items
      .filter((item: MenuItem) => item.id === 'hyperlinkMenuItem' || item.id === 'imageMenuItem')
      .forEach((item: MenuItem) => (item.enabled = false))
    // Paragraph: enable only the items that have a defined cross-block action.
    const paragraphMenu = applicationMenu.getMenuItemById('paragraphMenuEntry')!
    paragraphMenu.submenu!.items.forEach((item: MenuItem) => {
      if (item.id) {
        item.enabled = CROSS_BLOCK_ENABLED_PARAGRAPH.includes(item.id)
      }
    })
  }

  // Disable loose list item when not inside any list (bullet / ordered / task).
  if (!state.isUnorderedList && !state.isOrderedList && !state.isTaskList) {
    setMultipleStatus(applicationMenu, ['looseListItemMenuItem'], false)
  }

  // Front matter may exist at most once per document; disable the menu item
  // whenever the document already has one.
  if (state.hasFrontMatter) {
    setMultipleStatus(applicationMenu, ['frontMatterMenuItem'], false)
  }
}
