import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  Menu: class {},
  MenuItem: class {},
  BrowserWindow: class {}
}))

vi.mock('main_renderer/i18n', () => ({
  t: (key: string) => key
}))

import {
  clearEditorContextAddCommentSelection,
  isEditorContextAddCommentEnabled,
  updateEditorContextAddCommentSelection
} from 'main_renderer/contextMenu/editor'
import { getAddComment } from 'main_renderer/contextMenu/editor/menuItems'

describe('editor context menu Add Comment state', () => {
  it('stays disabled until renderer commentability state has arrived', () => {
    expect(isEditorContextAddCommentEnabled({ id: 1001 }, true)).toBe(false)
    expect(isEditorContextAddCommentEnabled({ id: 1002 }, false)).toBe(false)
  })

  it('uses renderer commentability state when available', () => {
    updateEditorContextAddCommentSelection(2001, false)
    expect(isEditorContextAddCommentEnabled({ id: 2001 }, true)).toBe(false)

    updateEditorContextAddCommentSelection(2001, true)
    expect(isEditorContextAddCommentEnabled({ id: 2001 }, true)).toBe(true)
    expect(isEditorContextAddCommentEnabled({ id: 2001 }, false)).toBe(false)
  })

  it('drops per-window state when the window closes', () => {
    updateEditorContextAddCommentSelection(4001, true)
    expect(isEditorContextAddCommentEnabled({ id: 4001 }, true)).toBe(true)

    clearEditorContextAddCommentSelection(4001)

    // Back to the pre-arrival default; the entry is no longer retained.
    expect(isEditorContextAddCommentEnabled({ id: 4001 }, true)).toBe(false)
  })

  it('fails closed through the same predicate when clicked directly', () => {
    const send = vi.fn()
    const win = { id: 3001, webContents: { send } }

    updateEditorContextAddCommentSelection(3001, false)
    getAddComment().click?.({} as never, win as never, {} as never)

    expect(send).not.toHaveBeenCalled()
  })
})
