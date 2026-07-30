import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ICriticMarkupReviewEditor,
  ICriticMarkupReviewItem,
  ICriticMarkupReviewSnapshot
} from '@marktext/document-view'

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
  payloadSource: 'review note',
  content: 'review note',
  anchorId: 'critic-highlight-1',
  anchorText: 'selected words'
}

const snapshot: ICriticMarkupReviewSnapshot = {
  revisionId: 'revision:1',
  items: [comment],
  currentItemId: comment.id,
  canCreateAddition: true,
  canCreateDeletion: true,
  canCreateSubstitution: true,
  canCreateHighlight: true,
  canCreateComment: true,
  canNavigate: true,
  canResolveCurrent: true,
  canResolveAll: true,
  trackChanges: false,
  projection: 'marked'
}

class FakeReviewEngine {
  private readonly listeners = new Set<(value: ICriticMarkupReviewSnapshot) => void>()

  subscribeReview = vi.fn((listener: (value: ICriticMarkupReviewSnapshot) => void) => {
    this.listeners.add(listener)
    return {
      dispose: () => this.listeners.delete(listener)
    }
  })

  getCriticMarkupReviewSnapshot = vi.fn(() => snapshot)
  getCriticMarkupCommentAtPoint = vi.fn(() => comment)
  editCriticMarkupComment = vi.fn(async() => false)
  commitAuthoringSelection = vi.fn()
  createCriticMarkup = vi.fn(async() => true)
  focusCriticMarkup = vi.fn(() => comment)
  navigateCriticMarkup = vi.fn(() => comment)
  resolveCriticMarkup = vi.fn(async() => true)
  resolveAllCriticMarkup = vi.fn(async() => 0)
  configure = vi.fn(async() => {})
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
          documentId: ref('document:1'),
          sourceCode: ref(false),
          requestText: async() => null,
          cancelTextRequest: () => {},
          commandNotificationSink: { pushTabNotification: () => {} },
          translate: key => key
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
        let rejectEdit: ((saved: boolean) => void) | undefined
        engine.editCriticMarkupComment.mockReturnValueOnce(
          new Promise<boolean>((resolve) => {
            rejectEdit = resolve
          })
        )
        await wrapper.get('.comment-edit .submit').trigger('click')
        await nextTick()

        expect(engine.editCriticMarkupComment).toHaveBeenLastCalledWith({
          revisionId: 'revision:1',
          nodeId: comment.id
        }, draft)
        expect(wrapper.get<HTMLTextAreaElement>('.comment-edit textarea').element.value)
          .toBe(draft)
        expect(wrapper.get('.comment-edit').attributes('aria-busy')).toBe('true')
        expect(wrapper.find('.comment-edit-failure').exists()).toBe(false)

        rejectEdit?.(false)
        await flushController()

        const failure = wrapper.get('.comment-edit-failure')
        expect(failure.text()).toBe(
          "Couldn't save this comment. Your draft was kept; review the document and try again."
        )
        expect(failure.attributes('role')).toBe('alert')
        expect(failure.attributes('aria-live')).toBe('polite')
        expect(wrapper.get('.comment-edit').attributes('aria-busy')).toBe('false')
        expect(focus).toHaveBeenCalled()

        engine.editCriticMarkupComment.mockRejectedValueOnce(
          new Error('main rejected the edit')
        )
        await wrapper.get('.comment-edit .submit').trigger('click')
        await flushController()

        expect(wrapper.get<HTMLTextAreaElement>('.comment-edit textarea').element.value)
          .toBe(draft)
        expect(wrapper.get('.comment-edit-failure').attributes('role')).toBe('alert')

        engine.editCriticMarkupComment.mockResolvedValueOnce(true)
        await wrapper.get('.comment-edit .submit').trigger('click')
        await flushController()

        expect(engine.editCriticMarkupComment).toHaveBeenLastCalledWith({
          revisionId: 'revision:1',
          nodeId: comment.id
        }, draft)
        expect(wrapper.find('.comment-edit').exists()).toBe(false)
      } finally {
        focus.mockRestore()
      }
    } finally {
      wrapper.unmount()
    }
  })
})
