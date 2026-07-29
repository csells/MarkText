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
const reviewTarget = Object.freeze({
  revisionId: 'revision:1',
  nodeId: comment.id
})
const firstChange: CriticMarkupSidebarItem = {
  id: 'addition-1',
  type: 'addition',
  path: [0, 'text'],
  start: 0,
  end: 3,
  sourceStart: 0,
  sourceEnd: 7,
  raw: '{++one++}',
  content: 'one'
}
const secondChange: CriticMarkupSidebarItem = {
  ...firstChange,
  id: 'addition-2',
  start: 4,
  end: 7,
  sourceStart: 8,
  sourceEnd: 17,
  raw: '{++two++}',
  content: 'two'
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

  it('publishes Review region, projection, card-group, and active-item semantics', () => {
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      documentId: 'document:1',
      revisionId: 'revision:1',
      available: true,
      items: [comment],
      currentItemId: comment.id,
      trackChanges: false,
      projection: 'original'
    })
    const wrapper = mount(ReviewSidebar, {
      global: {
        plugins: [i18n],
        stubs: { ElSwitch: true }
      }
    })

    expect(wrapper.get('.side-bar-review').attributes()).toMatchObject({
      role: 'region',
      'aria-label': 'sideBar.review.title'
    })
    expect(wrapper.get('.summary').attributes('aria-live')).toBe('polite')
    expect(wrapper.get('el-switch-stub').attributes('aria-label'))
      .toBe('sideBar.review.trackChanges')
    expect(wrapper.get('.projection-picker').attributes()).toMatchObject({
      role: 'group',
      'aria-label': 'menu.review.display'
    })
    expect(
      wrapper.findAll('.projection-picker button')
        .map(button => button.attributes('aria-pressed'))
    ).toEqual(['false', 'true', 'false'])
    const card = wrapper.get('.review-card')
    const focus = wrapper.get('.review-card-focus')
    expect(card.attributes('role')).toBe('group')
    expect(card.attributes('aria-labelledby')).toBe(focus.attributes('id'))
    expect(focus.attributes('aria-current')).toBe('true')

    wrapper.unmount()
  })

  it('does not scroll when the caret passively selects a comment card', async() => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    })
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      documentId: 'document:1',
      revisionId: 'revision:1',
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
      documentId: 'document:1',
      revisionId: 'revision:1',
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
    expect(editor.attributes('aria-label')).toBe('sideBar.review.edit')
    wrapper.unmount()
  })

  it('returns keyboard focus to the comment card when inline editing is cancelled', async() => {
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      documentId: 'document:1',
      revisionId: 'revision:1',
      available: true,
      items: [comment],
      currentItemId: comment.id,
      trackChanges: false,
      projection: 'marked'
    })
    const wrapper = mount(ReviewSidebar, {
      attachTo: document.body,
      global: {
        plugins: [i18n],
        stubs: { ElSwitch: true }
      }
    })

    const card = wrapper.get<HTMLButtonElement>('.review-card-focus')
    card.element.focus()
    await card.trigger('click')
    await nextTick()
    const textarea = wrapper.get<HTMLTextAreaElement>('.comment-edit textarea')
    expect(document.activeElement).toBe(textarea.element)

    await textarea.trigger('keydown', { key: 'Escape' })
    await nextTick()
    expect(document.activeElement).toBe(
      wrapper.get<HTMLButtonElement>('.review-card-focus').element
    )

    wrapper.unmount()
  })

  it('moves keyboard focus to the next Review card after an action removes its card', async() => {
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      documentId: 'document:1',
      revisionId: 'revision:1',
      available: true,
      items: [firstChange, secondChange],
      currentItemId: firstChange.id,
      trackChanges: false,
      projection: 'marked'
    })
    const wrapper = mount(ReviewSidebar, {
      attachTo: document.body,
      global: {
        plugins: [i18n],
        stubs: { ElSwitch: true }
      }
    })

    const accept = wrapper.findAll<HTMLButtonElement>('.review-card .accept')[0]
    if (!accept) throw new TypeError('Expected the first Accept action')
    accept.element.focus()
    await accept.trigger('click')
    // Node ids are parser-issued per revision and positional, so the engine
    // may re-issue the accepted card's id to the surviving node. What proves
    // the action landed is the target revision being replaced — never the old
    // id's absence from the new list.
    const survivor = { ...secondChange, id: firstChange.id }
    store.UPDATE({
      ...store.snapshot,
      revisionId: 'revision:2',
      items: [survivor],
      currentItemId: survivor.id
    })
    await nextTick()
    await nextTick()

    const remaining = wrapper.get<HTMLButtonElement>('.review-card-focus')
    expect(remaining.attributes('data-critic-id')).toBeUndefined()
    expect(
      remaining.element.closest<HTMLElement>('.review-card')?.dataset.criticId
    ).toBe(survivor.id)
    expect(document.activeElement).toBe(remaining.element)

    wrapper.unmount()
  })

  it('restores Review card focus after the editor projection handoff completes', async() => {
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      documentId: 'document:1',
      revisionId: 'revision:1',
      available: true,
      items: [firstChange, secondChange],
      currentItemId: firstChange.id,
      trackChanges: false,
      projection: 'revised'
    })
    const wrapper = mount(ReviewSidebar, {
      attachTo: document.body,
      global: {
        plugins: [i18n],
        stubs: { ElSwitch: true }
      }
    })
    const editorSurface = document.createElement('div')
    editorSurface.tabIndex = 0
    document.body.appendChild(editorSurface)

    const accept = wrapper.findAll<HTMLButtonElement>('.review-card .accept')[0]
    if (!accept) throw new TypeError('Expected the first Accept action')
    accept.element.focus()
    await accept.trigger('click')
    store.UPDATE({
      ...store.snapshot,
      revisionId: 'revision:2',
      items: [secondChange],
      currentItemId: secondChange.id,
      projection: 'marked'
    })
    nextTick(() => editorSurface.focus())
    await nextTick()
    await nextTick()

    expect(document.activeElement).toBe(
      wrapper.get<HTMLButtonElement>('.review-card-focus').element
    )

    wrapper.unmount()
    editorSurface.remove()
  })

  it('returns focus to an edited comment card after its committed revision publishes', async() => {
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      documentId: 'document:1',
      revisionId: 'revision:1',
      available: true,
      items: [comment],
      currentItemId: comment.id,
      trackChanges: false,
      projection: 'marked'
    })
    const wrapper = mount(ReviewSidebar, {
      attachTo: document.body,
      global: {
        plugins: [i18n],
        stubs: { ElSwitch: true }
      }
    })

    const card = wrapper.get<HTMLButtonElement>('.review-card-focus')
    card.element.focus()
    await card.trigger('click')
    await nextTick()
    expect(document.activeElement).toBe(
      wrapper.get<HTMLTextAreaElement>('.comment-edit textarea').element
    )

    store.UPDATE({
      ...store.snapshot,
      revisionId: 'revision:2',
      items: [{ ...comment, raw: '{>>edited<<}', content: 'edited' }]
    })
    await nextTick()
    await nextTick()

    expect(wrapper.find('.comment-edit').exists()).toBe(false)
    expect(document.activeElement).toBe(
      wrapper.get<HTMLButtonElement>('.review-card-focus').element
    )

    wrapper.unmount()
  })

  it('drops an edit draft when another file reuses the same source-derived id', async() => {
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      documentId: 'document:1',
      revisionId: 'revision:1',
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
      documentId: 'document:2',
      revisionId: 'revision:2',
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
      documentId: 'document:1',
      revisionId: 'revision:1',
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
          target: reviewTarget,
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
      documentId: 'document:1',
      revisionId: 'revision:1',
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
      expect(wrapper.get('.comment-compose textarea').attributes('aria-label'))
        .toBe('sideBar.review.commentPlaceholder')
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
      documentId: 'document:1',
      revisionId: 'revision:1',
      available: true,
      items: [comment],
      currentItemId: comment.id,
      trackChanges: false,
      projection: 'marked'
    })
    store.REQUEST_COMMENT_EDIT({
      documentId: 'document:1',
      target: reviewTarget
    })

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
      documentId: 'document:1',
      revisionId: 'revision:1',
      available: true,
      items: [],
      currentItemId: null,
      trackChanges: false,
      projection: 'marked'
    })
    store.REQUEST_COMMENT_EDIT({
      documentId: 'document:1',
      target: reviewTarget
    })

    const wrapper = mount(ReviewSidebar, {
      global: {
        plugins: [i18n],
        stubs: { ElSwitch: true }
      }
    })
    await nextTick()

    expect(wrapper.find('.comment-edit').exists()).toBe(false)
    expect(store.commentEditRequest).toEqual({
      documentId: 'document:1',
      target: reviewTarget
    })

    store.UPDATE({
      documentId: 'document:1',
      revisionId: 'revision:1',
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
      documentId: 'document:1',
      revisionId: 'revision:1',
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
    store.REQUEST_COMMENT_EDIT({
      documentId: 'document:1',
      target: reviewTarget
    })
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
      documentId: 'document:1',
      revisionId: 'revision:1',
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
    store.UPDATE({
      ...fileOne,
      documentId: 'document:2',
      revisionId: 'revision:2'
    })
    store.UPDATE(fileOne)
    await nextTick()

    expect(wrapper.find('.comment-edit').exists()).toBe(false)
    wrapper.unmount()
  })

  it('ignores a delayed acknowledgement after the editor cancels and reopens', async() => {
    const store = useCriticMarkupReviewStore()
    store.UPDATE({
      documentId: 'document:1',
      revisionId: 'revision:1',
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
    const submissions: CriticMarkupCommentEditSubmission[] = []
    const capture = (value: unknown): void => {
      if (isCriticMarkupCommentEditSubmission(value)) submissions.push(value)
    }
    bus.on('critic-markup-comment-edit', capture)

    try {
      await wrapper.get('.review-card-focus').trigger('click')
      await wrapper.get('.comment-edit textarea').setValue('draft A')
      await wrapper.get('.comment-edit .submit').trigger('click')
      expect(submissions).toHaveLength(1)
      expect(wrapper.get('.comment-edit textarea').attributes('disabled'))
        .toBeDefined()

      await wrapper.get('.comment-edit button:not(.submit)').trigger('click')
      await wrapper.get('.review-card-focus').trigger('click')
      await wrapper.get('.comment-edit textarea').setValue('new draft')
      const pendingSubmission = submissions[0]
      if (pendingSubmission === undefined) {
        throw new TypeError('Expected the pending comment-edit submission')
      }
      pendingSubmission.acknowledge({ outcome: 'saved' })
      await nextTick()

      expect(wrapper.get<HTMLTextAreaElement>('.comment-edit textarea').element.value).toBe(
        'new draft'
      )
    } finally {
      bus.off('critic-markup-comment-edit', capture)
      wrapper.unmount()
    }
  })

  it('requires document identity on the renderer-local edit command', () => {
    const acknowledge = vi.fn()
    expect(isCriticMarkupCommentEditSubmission({
      target: reviewTarget,
      text: 'note',
      acknowledge
    })).toBe(false)
    expect(isCriticMarkupCommentEditSubmission({
      documentId: 'document:1',
      target: reviewTarget,
      text: 'note',
      acknowledge
    })).toBe(true)
  })
})
