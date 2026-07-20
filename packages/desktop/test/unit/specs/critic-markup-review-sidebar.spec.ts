import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import bus from '@/bus'
import ReviewSidebar from '@/components/sideBar/review.vue'
import {
  isCriticMarkupCommentEditSubmission,
  type CriticMarkupCommentEditSubmission
} from '@/components/editorWithTabs/criticMarkupCommentEdit'
import { useCriticMarkupReviewStore } from '@/store/criticMarkupReview'
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
  content: 'note',
  anchorId: 'highlight-1',
  anchorText: 'selected text'
}

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: {} }
})

describe('CriticMarkup Review sidebar comment interaction', () => {
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView | undefined

  beforeEach(() => {
    const pinia = createPinia()
    setActivePinia(pinia)
    originalScrollIntoView = Element.prototype.scrollIntoView
  })

  afterEach(() => {
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        configurable: true,
        value: originalScrollIntoView
      })
    } else {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })

  it('does not scroll when the caret passively selects a comment card', async() => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    })
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      fileId: 'file-1',
      available: true,
      items: [comment],
      currentItemId: null,
      trackChanges: false,
      projection: 'marked'
    })
    const wrapper = mount(ReviewSidebar, {
      global: {
        plugins: [i18n],
        stubs: { ElSwitch: true }
      }
    })

    store.UPDATE({ ...store.snapshot, currentItemId: comment.id })
    await nextTick()
    await nextTick()

    expect(wrapper.find(`[data-critic-id="${comment.id}"]`).classes()).toContain('active')
    expect(scrollIntoView).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('opens the inline editor when the comment card is clicked', async() => {
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      fileId: 'file-1',
      available: true,
      items: [comment],
      currentItemId: comment.id,
      trackChanges: false,
      projection: 'marked'
    })
    const wrapper = mount(ReviewSidebar, {
      global: {
        plugins: [i18n],
        stubs: { ElSwitch: true }
      }
    })

    await wrapper.get('.review-card-focus').trigger('click')
    await nextTick()

    const editor = wrapper.get<HTMLTextAreaElement>('.comment-edit textarea')
    expect(editor.element.value).toBe(comment.content)
    wrapper.unmount()
  })

  it('drops an edit draft when another file reuses the same source-derived id', async() => {
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      fileId: 'file-1',
      available: true,
      items: [comment],
      currentItemId: comment.id,
      trackChanges: false,
      projection: 'marked'
    })
    const wrapper = mount(ReviewSidebar, {
      global: {
        plugins: [i18n],
        stubs: { ElSwitch: true }
      }
    })

    await wrapper.get('.review-card-focus').trigger('click')
    await wrapper.get('.comment-edit textarea').setValue('draft for file one')
    store.UPDATE({
      fileId: 'file-2',
      available: true,
      items: [
        {
          ...comment,
          raw: '{>>different note<<}',
          content: 'different note'
        }
      ],
      currentItemId: comment.id,
      trackChanges: false,
      projection: 'marked'
    })
    await nextTick()

    expect(wrapper.find('.comment-edit').exists()).toBe(false)
    wrapper.unmount()
  })

  it('preserves intentional boundary whitespace when an existing comment is saved', async() => {
    const whitespaceComment: CriticMarkupSidebarItem = {
      ...comment,
      raw: '{>> note <<}',
      content: ' note '
    }
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      fileId: 'file-1',
      available: true,
      items: [whitespaceComment],
      currentItemId: whitespaceComment.id,
      trackChanges: false,
      projection: 'marked'
    })
    const wrapper = mount(ReviewSidebar, {
      global: {
        plugins: [i18n],
        stubs: { ElSwitch: true }
      }
    })
    const edit = vi.fn()
    bus.on('critic-markup-comment-edit', edit)

    try {
      await wrapper.get('.review-card-focus').trigger('click')
      await nextTick()
      await wrapper.get('.comment-edit .submit').trigger('click')

      expect(edit).toHaveBeenCalledWith(
        expect.objectContaining({
          target: whitespaceComment,
          text: ' note '
        })
      )
    } finally {
      bus.off('critic-markup-comment-edit', edit)
      wrapper.unmount()
    }
  })

  it('preserves intentional boundary whitespace when a new comment is submitted', async() => {
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      fileId: 'file-1',
      available: true,
      items: [],
      currentItemId: null,
      trackChanges: false,
      projection: 'marked'
    })
    store.SET_COMPOSING(true)
    const wrapper = mount(ReviewSidebar, {
      global: {
        plugins: [i18n],
        stubs: { ElSwitch: true }
      }
    })
    const submit = vi.fn()
    bus.on('critic-markup-comment-submit', submit)

    try {
      await wrapper.get('.comment-compose textarea').setValue(' note ')
      await wrapper.get('.comment-compose .submit').trigger('click')

      expect(submit).toHaveBeenCalledWith(' note ')
    } finally {
      bus.off('critic-markup-comment-submit', submit)
      wrapper.unmount()
    }
  })

  it('consumes a native Edit Comment request that arrived before the panel mounted', async() => {
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      fileId: 'file-1',
      available: true,
      items: [comment],
      currentItemId: comment.id,
      trackChanges: false,
      projection: 'marked'
    })
    store.REQUEST_COMMENT_EDIT({ fileId: 'file-1', target: comment })

    const wrapper = mount(ReviewSidebar, {
      global: {
        plugins: [i18n],
        stubs: { ElSwitch: true }
      }
    })
    await nextTick()
    await nextTick()

    expect(wrapper.get<HTMLTextAreaElement>('.comment-edit textarea').element.value).toBe(
      comment.content
    )
    expect(store.commentEditRequest).toBeNull()
    wrapper.unmount()
  })

  it('retains a native Edit Comment request until its exact target is published', async() => {
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      fileId: 'file-1',
      available: true,
      items: [],
      currentItemId: null,
      trackChanges: false,
      projection: 'marked'
    })
    store.REQUEST_COMMENT_EDIT({ fileId: 'file-1', target: comment })

    const wrapper = mount(ReviewSidebar, {
      global: {
        plugins: [i18n],
        stubs: { ElSwitch: true }
      }
    })
    await nextTick()

    expect(wrapper.find('.comment-edit').exists()).toBe(false)
    expect(store.commentEditRequest).toEqual({ fileId: 'file-1', target: comment })

    store.UPDATE({
      fileId: 'file-1',
      available: true,
      items: [comment],
      currentItemId: comment.id,
      trackChanges: false,
      projection: 'marked'
    })
    await nextTick()
    await nextTick()

    expect(wrapper.get<HTMLTextAreaElement>('.comment-edit textarea').element.value).toBe(
      comment.content
    )
    expect(store.commentEditRequest).toBeNull()
    wrapper.unmount()
  })

  it('does not reset an unsaved draft when Edit Comment is requested again', async() => {
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      fileId: 'file-1',
      available: true,
      items: [comment],
      currentItemId: comment.id,
      trackChanges: false,
      projection: 'marked'
    })
    const wrapper = mount(ReviewSidebar, {
      global: {
        plugins: [i18n],
        stubs: { ElSwitch: true }
      }
    })

    await wrapper.get('.review-card-focus').trigger('click')
    await wrapper.get('.comment-edit textarea').setValue('unsaved draft')
    store.REQUEST_COMMENT_EDIT({ fileId: 'file-1', target: comment })
    await nextTick()
    await nextTick()

    expect(wrapper.get<HTMLTextAreaElement>('.comment-edit textarea').element.value).toBe(
      'unsaved draft'
    )
    expect(store.commentEditRequest).toBeNull()
    wrapper.unmount()
  })

  it('drops a draft after a synchronous file-away and file-back publication', async() => {
    const store = useCriticMarkupReviewStore()
    const fileOne = {
      fileId: 'file-1',
      available: true,
      items: [comment],
      currentItemId: comment.id,
      trackChanges: false,
      projection: 'marked' as const
    }
    store.UPDATE(fileOne)
    const wrapper = mount(ReviewSidebar, {
      global: {
        plugins: [i18n],
        stubs: { ElSwitch: true }
      }
    })

    await wrapper.get('.review-card-focus').trigger('click')
    await wrapper.get('.comment-edit textarea').setValue('draft for file one')
    store.UPDATE({ ...fileOne, fileId: 'file-2' })
    store.UPDATE(fileOne)
    await nextTick()

    expect(wrapper.find('.comment-edit').exists()).toBe(false)
    wrapper.unmount()
  })

  it('ignores a delayed acknowledgement after the draft changes away and back', async() => {
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      fileId: 'file-1',
      available: true,
      items: [comment],
      currentItemId: comment.id,
      trackChanges: false,
      projection: 'marked'
    })
    const wrapper = mount(ReviewSidebar, {
      global: {
        plugins: [i18n],
        stubs: { ElSwitch: true }
      }
    })
    let submission: CriticMarkupCommentEditSubmission | null = null
    const capture = (value: unknown): void => {
      if (isCriticMarkupCommentEditSubmission(value)) submission = value
    }
    bus.on('critic-markup-comment-edit', capture)

    try {
      await wrapper.get('.review-card-focus').trigger('click')
      await wrapper.get('.comment-edit textarea').setValue('draft A')
      await wrapper.get('.comment-edit .submit').trigger('click')
      expect(submission).not.toBeNull()

      await wrapper.get('.comment-edit textarea').setValue('draft B')
      await wrapper.get('.comment-edit textarea').setValue('draft A')
      submission!.acknowledge({ outcome: 'saved' })
      await nextTick()

      expect(wrapper.get<HTMLTextAreaElement>('.comment-edit textarea').element.value).toBe(
        'draft A'
      )
    } finally {
      bus.off('critic-markup-comment-edit', capture)
      wrapper.unmount()
    }
  })
})
