import { describe, expect, it, vi } from 'vitest'

import {
  armCriticMarkupCommentEdit,
  clearCriticMarkupCommentEdit,
  executePendingCriticMarkupCommentEdit,
  loadCriticMarkupContextEditCommand
} from 'main_renderer/contextMenu/editor/criticMarkupContextEditCommand'

const request = {
  documentId: 'document:1',
  target: {
    revisionId: 'revision:1',
    nodeId: 'critic-comment:1'
  }
}

const fakeWindow = () => ({})

const fakeFrame = () => ({
  isDestroyed: vi.fn(() => false),
  send: vi.fn()
})

describe('typed CriticMarkup context edit command', () => {
  it('executes an authenticated right-click target once', () => {
    const win = fakeWindow()
    const frame = fakeFrame()
    armCriticMarkupCommentEdit(win as never, frame as never, request)

    expect(executePendingCriticMarkupCommentEdit(win as never)).toBe(true)
    expect(frame.send).toHaveBeenCalledWith('mt::cm-edit-comment', request)
    expect(executePendingCriticMarkupCommentEdit(win as never)).toBe(false)
  })

  it('fails closed when context changes or its originating frame is gone', () => {
    const win = fakeWindow()
    const frame = fakeFrame()
    armCriticMarkupCommentEdit(win as never, frame as never, request)
    clearCriticMarkupCommentEdit(win as never)
    expect(executePendingCriticMarkupCommentEdit(win as never)).toBe(false)

    armCriticMarkupCommentEdit(win as never, frame as never, request)
    frame.isDestroyed.mockReturnValue(true)
    expect(executePendingCriticMarkupCommentEdit(win as never)).toBe(false)
    expect(frame.send).not.toHaveBeenCalled()
  })

  it('registers the same typed command for real user keybindings', () => {
    const add = vi.fn()
    loadCriticMarkupContextEditCommand({ add } as never)
    expect(add).toHaveBeenCalledWith(
      'review.edit-context-comment',
      expect.any(Function)
    )

    const win = fakeWindow()
    const frame = fakeFrame()
    armCriticMarkupCommentEdit(win as never, frame as never, request)
    const execute = add.mock.calls[0][1] as (window: unknown) => boolean
    expect(execute(win)).toBe(true)
    expect(frame.send).toHaveBeenCalledWith('mt::cm-edit-comment', request)
  })
})
