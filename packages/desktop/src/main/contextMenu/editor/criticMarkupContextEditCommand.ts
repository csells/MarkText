import type { BrowserWindow, WebFrameMain } from 'electron'
import type { CriticMarkupCommentEditRequest } from '@shared/types/criticMarkup'
import { REVIEW_CONTEXT_EDIT_COMMAND } from '../../../common/commands/review'
import type { CommandManager } from '../../commands'

interface PendingCriticMarkupCommentEdit {
  readonly frame: WebFrameMain
  readonly request: CriticMarkupCommentEditRequest
}

const pendingByWindow = new WeakMap<
  BrowserWindow,
  PendingCriticMarkupCommentEdit
>()

export const armCriticMarkupCommentEdit = (
  win: BrowserWindow,
  frame: WebFrameMain,
  request: CriticMarkupCommentEditRequest
): void => {
  pendingByWindow.set(win, { frame, request })
}

export const clearCriticMarkupCommentEdit = (win: BrowserWindow): void => {
  pendingByWindow.delete(win)
}

export const executePendingCriticMarkupCommentEdit = (
  win: BrowserWindow | null | undefined
): boolean => {
  if (win === null || win === undefined) return false
  const pending = pendingByWindow.get(win)
  pendingByWindow.delete(win)
  if (pending === undefined || pending.frame.isDestroyed()) return false
  try {
    pending.frame.send('mt::cm-edit-comment', pending.request)
    return true
  } catch {
    return false
  }
}

export const loadCriticMarkupContextEditCommand = (
  commandManager: CommandManager
): void => {
  commandManager.add(
    REVIEW_CONTEXT_EDIT_COMMAND.id,
    (win: BrowserWindow | null | undefined) =>
      executePendingCriticMarkupCommentEdit(win)
  )
}
