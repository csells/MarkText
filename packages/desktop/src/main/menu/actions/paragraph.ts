import { type BrowserWindow, type Menu, type MenuItem } from 'electron'
import { COMMANDS } from '../../commands'
import type { CommandManager } from '../../commands'
import type {
  DocumentSelectionMenuState
} from '../../../shared/types/documentSelection'
import type {
  EditorCommandId
} from '../../../shared/types/editorCommands'

type Win = BrowserWindow | null | undefined

const dispatchParagraphAction = (
  win: Win,
  command: EditorCommandId
): void => {
  if (win && win.webContents) {
    win.webContents.send('mt::editor-command', command)
  }
}

export const bulletList = (win: Win): void => {
  dispatchParagraphAction(win, 'bullet-list')
}

export const codeFence = (win: Win): void => {
  dispatchParagraphAction(win, 'code-fence')
}

export const degradeHeading = (win: Win): void => {
  dispatchParagraphAction(win, 'degrade-heading')
}

export const frontMatter = (win: Win): void => {
  dispatchParagraphAction(win, 'front-matter')
}

export const heading1 = (win: Win): void => {
  dispatchParagraphAction(win, 'heading-1')
}

export const heading2 = (win: Win): void => {
  dispatchParagraphAction(win, 'heading-2')
}

export const heading3 = (win: Win): void => {
  dispatchParagraphAction(win, 'heading-3')
}

export const heading4 = (win: Win): void => {
  dispatchParagraphAction(win, 'heading-4')
}

export const heading5 = (win: Win): void => {
  dispatchParagraphAction(win, 'heading-5')
}

export const heading6 = (win: Win): void => {
  dispatchParagraphAction(win, 'heading-6')
}

export const horizontalLine = (win: Win): void => {
  dispatchParagraphAction(win, 'thematic-break')
}

export const htmlBlock = (win: Win): void => {
  dispatchParagraphAction(win, 'html-block')
}

export const looseListItem = (win: Win): void => {
  dispatchParagraphAction(win, 'loose-list-item')
}

export const mathFormula = (win: Win): void => {
  dispatchParagraphAction(win, 'math-block')
}

export const orderedList = (win: Win): void => {
  dispatchParagraphAction(win, 'ordered-list')
}

export const paragraph = (win: Win): void => {
  dispatchParagraphAction(win, 'paragraph')
}

export const quoteBlock = (win: Win): void => {
  dispatchParagraphAction(win, 'quote-block')
}

export const table = (win: Win): void => {
  dispatchParagraphAction(win, 'insert-table')
}

export const taskList = (win: Win): void => {
  dispatchParagraphAction(win, 'task-list')
}

export const increaseHeading = (win: Win): void => {
  dispatchParagraphAction(win, 'upgrade-heading')
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
  // G5: row availability is the capability record's job
  // (mt::set-document-capability-menu-state); this writer owns only the
  // checked state the selection implies.
  setCheckedMenuItem(applicationMenu, state)
}
