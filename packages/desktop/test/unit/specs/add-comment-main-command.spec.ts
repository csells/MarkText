import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getApplicationMenu, menuItem, send } = vi.hoisted(() => ({
  getApplicationMenu: vi.fn(),
  menuItem: { enabled: false },
  send: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: { on: vi.fn() },
  Menu: { getApplicationMenu }
}))

vi.mock('electron-log', () => ({
  default: { error: vi.fn() }
}))

vi.mock('main_renderer/i18n', () => ({
  t: (key: string) => key
}))

import { COMMANDS } from 'main_renderer/commands'
import { editorAddComment, isAddCommentMenuEnabled } from 'main_renderer/menu/actions/edit'
import reviewMenuTemplate from 'main_renderer/menu/templates/review'
import type Keybindings from 'main_renderer/keyboard/shortcutHandler'

const win = {
  webContents: { send }
} as never

describe('main Add Comment command gating', () => {
  beforeEach(() => {
    send.mockReset()
    menuItem.enabled = false
    getApplicationMenu.mockReturnValue({
      getMenuItemById: (id: string) => (id === 'review.add-comment' ? menuItem : undefined)
    })
  })

  it('fails closed when the menu state says Add Comment is disabled', () => {
    expect(isAddCommentMenuEnabled()).toBe(false)

    editorAddComment(win)

    expect(send).not.toHaveBeenCalled()
  })

  it('sends the renderer action when Add Comment is enabled', () => {
    menuItem.enabled = true
    expect(isAddCommentMenuEnabled()).toBe(true)

    editorAddComment(win)

    expect(send).toHaveBeenCalledWith('mt::editor-edit-action', 'addComment')
  })

  it('builds Add Comment disabled until renderer selection state enables it', () => {
    const template = reviewMenuTemplate({
      getAccelerator: vi.fn(() => null)
    } as unknown as Keybindings)
    const addCommentItem = (template.submenu as Array<{ id?: string; enabled?: boolean }>).find(
      item => item.id === COMMANDS.REVIEW_ADD_COMMENT
    )

    expect(addCommentItem?.enabled).toBe(false)
  })
})
