import { type BrowserWindow, type Menu } from 'electron'
import {
  REVIEW_COMMAND_DESCRIPTORS,
  type ReviewCommandDescriptor,
  type ReviewCommandId
} from '../../../common/commands/review'
import type { CommandManager } from '../../commands'
import type { CriticMarkupReviewMenuState } from '../../../shared/types/criticMarkup'

type Win = BrowserWindow | null | undefined

export const executeReviewCommand = (win: Win, commandId: ReviewCommandId): void => {
  win?.webContents.send('mt::execute-command-by-id', commandId)
}

export const loadReviewCommands = (commandManager: CommandManager): void => {
  REVIEW_COMMAND_DESCRIPTORS.forEach((descriptor) => {
    commandManager.add(descriptor.id, (win: Win) => executeReviewCommand(win, descriptor.id))
  })
}

export const updateReviewMenu = (
  applicationMenu: Menu,
  state: CriticMarkupReviewMenuState
): void => {
  REVIEW_COMMAND_DESCRIPTORS.forEach((descriptor) => {
    const metadata: ReviewCommandDescriptor = descriptor
    const item = applicationMenu.getMenuItemById(metadata.menuId)
    if (!item) return

    const capability = metadata.menuCapability
    const hasCapability = capability === undefined || state[capability]
    item.enabled = state.available && hasCapability &&
      (!metadata.requiresMarkedProjection || state.projection === 'marked')

    if (metadata.checkedState === 'trackChanges') {
      item.checked = state.trackChanges
    } else if (metadata.projection !== undefined) {
      item.checked = metadata.projection === state.projection
    }
  })

  // Source mode disables the whole Review submenu, including this nested
  // projection entry. A fresh WYSIWYG snapshot restores the entry itself.
  const display = applicationMenu.getMenuItemById('reviewDisplayMenuItem')
  if (display) display.enabled = state.available
}
