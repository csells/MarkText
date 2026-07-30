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
import { useProjectStore } from '@/store/project'
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
  payloadSource: 'note',
  content: 'note'
}

describe('Review sidebar shell native comment editing', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('exposes localized rail buttons with active state and Enter/Space activation', async() => {
    const layout = useLayoutStore()
    const project = useProjectStore()
    const openSettings = vi.spyOn(project, 'OPEN_SETTING_WINDOW')
    layout.SET_LAYOUT({ rightColumn: 'files', showSideBar: true })

    const wrapper = shallowMount(SideBar)
    const railButtons = wrapper.findAll('button[data-side-bar-action]')

    expect(railButtons.map(button => button.attributes('aria-label'))).toEqual([
      'Files',
      'Search',
      'Table of Contents',
      'Review',
      'Settings'
    ])

    const filesButton = wrapper.get('button[data-side-bar-action="files"]')
    const reviewButton = wrapper.get('button[data-side-bar-action="review"]')
    const settingsButton = wrapper.get('button[data-side-bar-action="settings"]')

    expect(filesButton.attributes('aria-pressed')).toBe('true')
    expect(reviewButton.attributes('aria-pressed')).toBe('false')

    await reviewButton.trigger('keydown', { key: 'Enter' })
    expect(layout.rightColumn).toBe('review')
    expect(reviewButton.attributes('aria-pressed')).toBe('true')

    await reviewButton.trigger('keydown', { key: ' ' })
    expect(layout.rightColumn).toBe('')
    expect(reviewButton.attributes('aria-pressed')).toBe('false')

    await filesButton.trigger('click')
    expect(layout.rightColumn).toBe('files')
    expect(filesButton.attributes('aria-pressed')).toBe('true')

    await settingsButton.trigger('keydown', { key: 'Enter' })
    expect(openSettings).toHaveBeenCalledOnce()

    wrapper.unmount()
  })

  it('opens Review for an Edit Comment request that arrived while another panel was visible', async() => {
    const review = useCriticMarkupReviewStore()
    const layout = useLayoutStore()
    review.UPDATE({
      documentId: 'document:1',
      revisionId: 'revision:1',
      available: true,
      items: [comment],
      currentItemId: comment.id,
      trackChanges: false,
      projection: 'marked'
    })
    review.REQUEST_COMMENT_EDIT({
      documentId: 'document:1',
      target: {
        revisionId: 'revision:1',
        nodeId: comment.id
      }
    })

    const wrapper = shallowMount(SideBar)
    await nextTick()

    expect(layout.rightColumn).toBe('review')
    expect(layout.showSideBar).toBe(true)
    wrapper.unmount()
  })
})
