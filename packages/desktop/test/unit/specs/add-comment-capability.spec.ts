import { beforeEach, describe, expect, it, vi } from 'vitest'

const { emit } = vi.hoisted(() => ({
  emit: vi.fn()
}))

vi.mock('@/bus', () => ({
  default: { emit }
}))

import {
  ADD_COMMENT_CAPABILITY_CHANGED,
  isAddCommentCapabilityEnabled,
  publishAddCommentCapability,
  publishSourceAddCommentCapability
} from '@/review/addCommentCapability'

describe('add comment capability publisher', () => {
  beforeEach(() => {
    emit.mockClear()
    ;(
      globalThis as unknown as {
        window: {
          marktext?: { env: { windowId: number } }
          electron: { ipcRenderer: { send: ReturnType<typeof vi.fn> } }
        }
      }
    ).window = {
      marktext: { env: { windowId: 42 } },
      electron: { ipcRenderer: { send: vi.fn() } }
    }
    publishAddCommentCapability(false)
    emit.mockClear()
  })

  it('updates the renderer cache and emits the shared capability event', () => {
    publishAddCommentCapability(true)

    expect(isAddCommentCapabilityEnabled()).toBe(true)
    expect(emit).toHaveBeenCalledWith(ADD_COMMENT_CAPABILITY_CHANGED, true)
  })

  it('publishes source-mode capability to renderer state and main-process menus', () => {
    publishSourceAddCommentCapability(true)

    expect(isAddCommentCapabilityEnabled()).toBe(true)
    expect(emit).toHaveBeenCalledWith(ADD_COMMENT_CAPABILITY_CHANGED, true)
    expect(window.electron.ipcRenderer.send).toHaveBeenCalledWith(
      'mt::editor-add-comment-selection-changed',
      42,
      true
    )
  })
})
