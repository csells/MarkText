import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ICriticMarkupReviewEditor,
  ICriticMarkupReviewItem,
  ICriticMarkupReviewSnapshot
} from '@muyajs/core'

const { ipcSend } = vi.hoisted(() => {
  const send = vi.fn()
  const w = globalThis as unknown as {
    window?: { electron?: { ipcRenderer?: unknown } }
  }
  w.window ??= {}
  w.window.electron = {
    ipcRenderer: {
      send,
      on: () => () => {}
    }
  }
  return { ipcSend: send }
})

import ReviewSidebar from '@/components/sideBar/review.vue'
import { useCriticMarkupReviewController } from '@/components/editorWithTabs/useCriticMarkupReviewController'

const comment: ICriticMarkupReviewItem = {
  id: 'critic-comment-1',
  type: 'comment',
  path: [0, 'text'],
  start: 10,
  end: 26,
  sourceStart: 10,
  sourceEnd: 26,
  raw: '{>>review note<<}',
  content: 'review note',
  anchorId: 'critic-highlight-1',
  anchorText: 'selected words'
}

const snapshot: ICriticMarkupReviewSnapshot = {
  items: [comment],
  currentItemId: comment.id,
  canCreateAddition: true,
  canCreateDeletion: true,
  canCreateSubstitution: true,
  canCreateHighlight: true,
  canCreateComment: true,
  canResolveCurrent: true,
  canResolveAll: true,
  trackChanges: false,
  projection: 'marked'
}

class FakeReviewEngine {
  private readonly listeners = new Set<(value: ICriticMarkupReviewSnapshot) => void>()

  on = vi.fn((_event: string, listener: (value: ICriticMarkupReviewSnapshot) => void) => {
    this.listeners.add(listener)
  })

  off = vi.fn((_event: string, listener: (value: ICriticMarkupReviewSnapshot) => void) => {
    this.listeners.delete(listener)
  })

  getCriticMarkupReviewSnapshot = vi.fn(() => snapshot)
  getCriticMarkupCommentAtPoint = vi.fn(() => comment)
  editCriticMarkupComment = vi.fn(() => false)
  commitAuthoringSelection = vi.fn()
  createCriticMarkup = vi.fn(() => true)
  focusCriticMarkup = vi.fn(() => comment)
  navigateCriticMarkup = vi.fn(() => comment)
  resolveCriticMarkup = vi.fn(() => true)
  resolveAllCriticMarkup = vi.fn(() => 0)
  setOptions = vi.fn()
}

const messages = {
  en: {
    sideBar: {
      review: {
        title: 'Review',
        summary: '{count} review items',
        trackChanges: 'Track Changes',
        unavailable: 'Review is unavailable in this view.',
        empty: 'No review items',
        removeComment: 'Remove comment',
        removeHighlight: 'Remove highlight',
        types: { comment: 'Comment' },
        addComment: 'Comment',
        cancel: 'Cancel',
        commentPlaceholder: 'Add a comment...',
        composeTitle: 'New comment',
        edit: 'Edit',
        saveEdit: 'Save',
        commentEditFailed: "Couldn't save this comment. Your draft was kept; review the document and try again."
      }
    },
    menu: {
      review: {
        trackChanges: 'Track Changes',
        acceptCurrent: 'Accept Change',
        rejectCurrent: 'Reject Change',
        showMarked: 'Show Markup',
        showOriginal: 'Show Original',
        showRevised: 'Show Revised'
      }
    }
  }
}

const flushController = async(): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

describe('CriticMarkup comment edit acknowledgement', () => {
  beforeEach(() => {
    ipcSend.mockClear()
    document.body.innerHTML = ''
  })

  it('keeps a rejected draft visible, then closes only after the engine accepts it', async() => {
    const engine = new FakeReviewEngine()
    const pinia = createPinia()
    setActivePinia(pinia)
    const host = defineComponent({
      setup() {
        useCriticMarkupReviewController({
          editor: shallowRef(engine as unknown as ICriticMarkupReviewEditor),
          fileId: ref('file-1'),
          sourceCode: ref(false),
          requestText: async() => null,
          cancelTextRequest: () => {}
        })
        return () => h(ReviewSidebar)
      }
    })
    const wrapper = mount(host, {
      attachTo: document.body,
      global: {
        plugins: [
          pinia,
          createI18n({ legacy: false, locale: 'en', messages })
        ],
        stubs: { ElSwitch: true }
      }
    })

    try {
      await flushController()
      await wrapper.get('.review-card-focus').trigger('click')
      await nextTick()

      const draft = ' revised note with boundary spaces '
      await wrapper.get('.comment-edit textarea').setValue(draft)
      const focus = vi.spyOn(HTMLElement.prototype, 'focus')
      try {
        await wrapper.get('.comment-edit .submit').trigger('click')
        await nextTick()

        expect(engine.editCriticMarkupComment).toHaveBeenLastCalledWith(comment, draft)
        expect(wrapper.get<HTMLTextAreaElement>('.comment-edit textarea').element.value)
          .toBe(draft)
        const failure = wrapper.get('.comment-edit-failure')
        expect(failure.text()).toBe(
          "Couldn't save this comment. Your draft was kept; review the document and try again."
        )
        expect(failure.attributes('role')).toBeUndefined()
        expect(failure.attributes('aria-live')).toBeUndefined()
        expect(focus).not.toHaveBeenCalled()

        engine.editCriticMarkupComment.mockReturnValue(true)
        await wrapper.get('.comment-edit .submit').trigger('click')
        await nextTick()

        expect(engine.editCriticMarkupComment).toHaveBeenLastCalledWith(comment, draft)
        expect(wrapper.find('.comment-edit').exists()).toBe(false)
      } finally {
        focus.mockRestore()
      }
    } finally {
      wrapper.unmount()
    }
  })
})
