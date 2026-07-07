import type { BrowserWindow } from 'electron'

const addCommentSelectionByWindowId = new Map<number, boolean>()

export const updateEditorContextAddCommentSelection = (
  windowId: number,
  enabled: boolean
): void => {
  addCommentSelectionByWindowId.set(windowId, enabled)
}

// Called when a window closes so the per-window selection state does not leak.
export const clearEditorContextAddCommentSelection = (windowId: number): void => {
  addCommentSelectionByWindowId.delete(windowId)
}

export const editorContextAddCommentEnabled = (windowId: number): boolean =>
  addCommentSelectionByWindowId.get(windowId) === true

export const isEditorContextAddCommentEnabled = (
  win: Pick<BrowserWindow, 'id'>,
  hasText: boolean
): boolean => {
  const selectionState = addCommentSelectionByWindowId.get(win.id)
  return hasText && selectionState === true
}

export const canExecuteEditorContextAddComment = (
  win: Pick<BrowserWindow, 'id'>
): boolean => isEditorContextAddCommentEnabled(win, true)
