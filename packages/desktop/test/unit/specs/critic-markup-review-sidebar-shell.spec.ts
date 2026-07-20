import { createPinia, setActivePinia } from 'pinia'
import { shallowMount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: Record<string, unknown>
  }
  w.window ??= {}
  Object.assign(w.window, {
    path: {
      sep: '/',
      normalize: (path: string) => path,
      basename: (path: string) => path.split('/').at(-1) ?? path,
      dirname: (path: string) => path.slice(0, path.lastIndexOf('/'))
    },
    fileUtils: {
      hasMarkdownExtension: () => true,
      pathExists: async() => false
    },
    marktext: { env: { windowId: 1 } },
    electron: {
      ipcRenderer: {
        send: vi.fn(),
        on: vi.fn(() => () => {}),
        invoke: vi.fn(async() => undefined)
      }
    }
  })
})

import SideBar from '@/components/sideBar/index.vue'
import { useCriticMarkupReviewStore } from '@/store/criticMarkupReview'
import { useLayoutStore } from '@/store/layout'
import type { CriticMarkupSidebarItem } from '@shared/types/criticMarkup'

const comment: CriticMarkupSidebarItem = {
  id: 'comment-1',
  type: 'comment',
  path: [0, 'text'],
  start: 7,
  end: 17,
  sourceStart: 7,
  sourceEnd: 17,
  raw: '{>>note<<}',
  content: 'note'
}

describe('Review sidebar shell native comment editing', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('opens Review for an Edit Comment request that arrived while another panel was visible', async() => {
    const review = useCriticMarkupReviewStore()
    const layout = useLayoutStore()
    review.UPDATE({
      fileId: 'file-1',
      available: true,
      items: [comment],
      currentItemId: comment.id,
      trackChanges: false,
      projection: 'marked'
    })
    review.REQUEST_COMMENT_EDIT({ fileId: 'file-1', target: comment })

    const wrapper = shallowMount(SideBar)
    await nextTick()

    expect(layout.rightColumn).toBe('review')
    expect(layout.showSideBar).toBe(true)
    wrapper.unmount()
  })
})
