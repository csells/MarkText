import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Real-mount component spec per specs/architecture/test-infrastructure.md:
// interactions go through the rendered DOM, state is arranged on real Pinia
// stores, and outcomes are asserted on bus emissions and the DOM.

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      marktext?: { env: { windowId: number } }
      fileUtils?: { isSamePathSync: (a: string, b: string) => boolean }
      electron?: {
        osUsername?: string
        clipboard: { writeText: (s: string) => void }
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.marktext ??= { env: { windowId: 1 } }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
  w.window.electron ??= {
    clipboard: { writeText: () => {} },
    ipcRenderer: { send: () => {}, on: () => {} }
  }
})

vi.mock('@/services/notification', () => ({ default: { notify: vi.fn(), name: 'notify' } }))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve(true))
}))
vi.mock(import('vue-i18n'), async(importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useI18n: (() => ({ t: (key: string) => key })) as unknown as typeof actual.useI18n
  }
})

import bus from '@/bus'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import Comments from '@/components/sideBar/comments.vue'

interface CommentReply {
  author: string
  createdAt: string
  body: string
}

interface CommentThread {
  id: string
  status: 'open' | 'resolved'
  authors?: string[]
  replies: CommentReply[]
}

const elementStubs = {
  'el-button': {
    props: ['disabled', 'icon', 'size', 'type', 'circle'],
    template:
      '<button type="button" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
  },
  'el-input': {
    props: ['modelValue', 'placeholder', 'autosize', 'type'],
    emits: ['update:modelValue'],
    methods: {
      focus(): void {
        /* focus target for the compose handoff */
      }
    },
    template:
      '<textarea :placeholder="placeholder" :value="modelValue" ' +
      '@input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-tooltip': { template: '<span><slot /></span>' },
  'el-icon': true
}

const makeComments = (
  threads: CommentThread[] = [],
  diagnostics: Array<{ code: string; id: string; message: string }> = []
) => ({ threads, ranges: [], diagnostics })

const reply = (author: string, createdAt: string, body: string): CommentReply => ({
  author,
  createdAt,
  body
})

let wrapper: VueWrapper | null = null

const mountSidebar = () => {
  wrapper = mount(Comments, { global: { stubs: elementStubs }, attachTo: document.body })
  return wrapper
}

const thread = (id: string) => wrapper!.find(`section.thread[data-comment-id="${id}"]`)
const replyBox = (id: string) => thread(id).find('.reply-box textarea')
const buttonWithText = (root: ReturnType<typeof thread> | VueWrapper, text: string) =>
  (root as VueWrapper).findAll('button').find((b) => b.text().includes(text))!

describe('comments sidebar (mounted)', () => {
  let emit: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    wrapper?.unmount()
    wrapper = null
    emit = vi.spyOn(bus, 'emit')
  })

  it('edits a deterministic reply index without rewriting sibling replies', async() => {
    const store = useEditorStore()
    store.comments = makeComments([
      {
        id: 'cmt_1',
        status: 'open',
        authors: ['Ada', 'Grace'],
        replies: [
          reply('Ada', '2026-06-30T10:00:00.000Z', 'first'),
          reply('Grace', '2026-06-30T11:00:00.000Z', 'second')
        ]
      }
    ]) as never
    mountSidebar()

    // Open the SECOND reply's edit box, change it, save.
    await thread('cmt_1').findAll('.entry-edit')[1].trigger('click')
    const editBox = thread('cmt_1').find('.reply-edit-box textarea')
    await editBox.setValue('second edited')
    await buttonWithText(thread('cmt_1') as never, 'saveEdit').trigger('click')

    expect(emit).toHaveBeenCalledWith('comment:edit', {
      id: 'cmt_1',
      patch: expect.objectContaining({
        replies: [
          { author: 'Ada', createdAt: '2026-06-30T10:00:00.000Z', body: 'first' },
          { author: 'Grace', createdAt: '2026-06-30T11:00:00.000Z', body: 'second edited' }
        ]
      })
    })
  })

  it('does not overwrite a different reply when the array shifts under an open edit box', async() => {
    const store = useEditorStore()
    store.comments = makeComments([
      {
        id: 'cmt_1',
        status: 'open',
        replies: [
          reply('Ada', '2026-06-30T10:00:00.000Z', 'first'),
          reply('Grace', '2026-06-30T11:00:00.000Z', 'second')
        ]
      }
    ]) as never
    mountSidebar()

    await thread('cmt_1').findAll('.entry-edit')[1].trigger('click')
    await thread('cmt_1').find('.reply-edit-box textarea').setValue('second edited')

    // An earlier reply was removed elsewhere: index 1 now points at a
    // different reply (distinct createdAt). Save must abort, not clobber it.
    store.comments = makeComments([
      {
        id: 'cmt_1',
        status: 'open',
        replies: [
          reply('Ada', '2026-06-30T10:00:00.000Z', 'first'),
          reply('Zoe', '2026-06-30T12:00:00.000Z', 'third')
        ]
      }
    ]) as never
    await nextTick()
    emit.mockClear()
    await buttonWithText(thread('cmt_1') as never, 'saveEdit').trigger('click')

    expect(emit).not.toHaveBeenCalledWith('comment:edit', expect.anything())
  })

  it('prunes drafts for a comment id that disappears, so a recycled id starts clean', async() => {
    const store = useEditorStore()
    const threads: CommentThread[] = [
      { id: 'cmt_1', status: 'open', replies: [reply('Ada', 't1', 'x')] },
      { id: 'cmt_2', status: 'open', replies: [reply('Ada', 't1', 'y')] }
    ]
    store.comments = makeComments(threads) as never
    mountSidebar()

    await replyBox('cmt_1').setValue('live')
    await replyBox('cmt_2').setValue('stale')

    // cmt_2 disappears (its markers were deleted) …
    store.comments = makeComments([threads[0]]) as never
    await nextTick()
    // … and a later thread recycles the id: its compose box must be empty.
    store.comments = makeComments(threads) as never
    await nextTick()

    expect((replyBox('cmt_1').element as HTMLTextAreaElement).value).toBe('live')
    expect((replyBox('cmt_2').element as HTMLTextAreaElement).value).toBe('')
  })

  it('gates Add Comment on the shared predicate from the store', async() => {
    const store = useEditorStore()
    store.comments = makeComments() as never
    mountSidebar()

    const addButton = buttonWithText(wrapper!, 'sideBar.comments.add')
    expect(addButton.attributes('disabled')).toBeDefined()
    await addButton.trigger('click')
    expect(emit).not.toHaveBeenCalledWith('addComment')

    store.addCommentEnabled = true
    await nextTick()
    expect(addButton.attributes('disabled')).toBeUndefined()
    await addButton.trigger('click')
    expect(emit).toHaveBeenCalledWith('addComment')
  })

  it('filters visible threads by open and resolved status', async() => {
    const store = useEditorStore()
    store.comments = makeComments([
      { id: 'open1', status: 'open', replies: [] },
      { id: 'resolved1', status: 'resolved', replies: [] }
    ]) as never
    mountSidebar()

    const visibleIds = () =>
      wrapper!.findAll('section.thread').map((node) => node.attributes('data-comment-id'))

    // Defaults to open-only; 'all' shows both.
    expect(visibleIds()).toEqual(['open1'])
    await buttonWithText(wrapper!, 'sideBar.comments.all').trigger('click')
    expect(visibleIds()).toEqual(['open1', 'resolved1'])
    await buttonWithText(wrapper!, 'sideBar.comments.resolved').trigger('click')
    expect(visibleIds()).toEqual(['resolved1'])
    await buttonWithText(wrapper!, 'sideBar.comments.open').trigger('click')
    expect(visibleIds()).toEqual(['open1'])
  })

  it('uses the configured comment author for new replies and returns focus to the document', async() => {
    const store = useEditorStore()
    const preferences = usePreferencesStore()
    preferences.commentAuthorName = 'Chris Sells'
    store.comments = makeComments([
      { id: 'cmt_1', status: 'open', replies: [reply('Ada', 't1', 'x')] }
    ]) as never
    mountSidebar()

    await replyBox('cmt_1').setValue('Looks good')
    await buttonWithText(thread('cmt_1') as never, 'sideBar.comments.reply').trigger('click')

    expect(emit).toHaveBeenCalledWith('comment:reply', {
      id: 'cmt_1',
      reply: { author: 'Chris Sells', body: 'Looks good' }
    })
    expect(emit).toHaveBeenCalledWith('editor-focus')
  })

  it('falls back to the OS user name when no author is configured', async() => {
    const win = window as unknown as { electron: { osUsername?: string } }
    const original = win.electron.osUsername
    win.electron.osUsername = 'csells'
    try {
      const store = useEditorStore()
      usePreferencesStore().commentAuthorName = ''
      store.comments = makeComments([
        { id: 'cmt_1', status: 'open', replies: [reply('Ada', 't1', 'x')] }
      ]) as never
      mountSidebar()

      await replyBox('cmt_1').setValue('Nice')
      await buttonWithText(thread('cmt_1') as never, 'sideBar.comments.reply').trigger('click')

      expect(emit).toHaveBeenCalledWith('comment:reply', {
        id: 'cmt_1',
        reply: { author: 'csells', body: 'Nice' }
      })
    } finally {
      win.electron.osUsername = original
    }
  })

  it('discards an empty newly composed thread when the sidebar unmounts', async() => {
    const store = useEditorStore()
    store.comments = makeComments([{ id: 'cmt_1', status: 'open', replies: [] }]) as never
    mountSidebar()
    store.composeCommentId = 'cmt_1'
    await vi.waitFor(() => {
      expect(store.composeCommentId).toBeNull()
    })

    wrapper!.unmount()
    wrapper = null

    expect(emit).toHaveBeenCalledWith('comment:discard', 'cmt_1')
  })

  it('keeps a typed newly composed draft when the sidebar unmounts', async() => {
    const store = useEditorStore()
    store.comments = makeComments([{ id: 'cmt_1', status: 'open', replies: [] }]) as never
    mountSidebar()
    store.composeCommentId = 'cmt_1'
    await vi.waitFor(() => {
      expect(store.composeCommentId).toBeNull()
    })
    await replyBox('cmt_1').setValue('draft text')

    wrapper!.unmount()
    wrapper = null

    expect(emit).not.toHaveBeenCalledWith('comment:discard', 'cmt_1')
  })

  it('explicitly cancels a composed draft by discarding the thread', async() => {
    const store = useEditorStore()
    store.comments = makeComments([{ id: 'cmt_1', status: 'open', replies: [] }]) as never
    mountSidebar()
    store.composeCommentId = 'cmt_1'
    await vi.waitFor(() => {
      expect(store.composeCommentId).toBeNull()
    })
    await replyBox('cmt_1').setValue('draft text')

    await buttonWithText(thread('cmt_1') as never, 'sideBar.comments.cancelEdit').trigger('click')

    expect(emit).toHaveBeenCalledWith('comment:discard', 'cmt_1')
    expect((replyBox('cmt_1').element as HTMLTextAreaElement).value).toBe('')
  })

  it('emits diagnostic focus requests by id', async() => {
    const store = useEditorStore()
    store.comments = makeComments(
      [],
      [{ code: 'orphan-metadata', id: 'broken', message: 'orphaned' }]
    ) as never
    mountSidebar()

    await wrapper!.find('button.diagnostic').trigger('click')

    expect(emit).toHaveBeenCalledWith('comment:diagnostic-focus', 'broken')
  })

  it('scrolls a newly activated thread card into view (document -> sidebar)', async() => {
    // jsdom has no scrollIntoView; install one to observe.
    const scrolled = vi.fn()
    ;(Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrolled
    const store = useEditorStore()
    store.comments = makeComments([{ id: 'cmt_1', status: 'open', replies: [] }]) as never
    mountSidebar()

    store.activeCommentIds = ['cmt_1'] as never
    await vi.waitFor(() => {
      expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' })
    })
  })

  it('does not scroll the list for the echo of a sidebar click', async() => {
    // jsdom has no scrollIntoView; install one to observe.
    const scrolled = vi.fn()
    ;(Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrolled
    const store = useEditorStore()
    store.comments = makeComments([{ id: 'cmt_1', status: 'open', replies: [] }]) as never
    mountSidebar()

    await thread('cmt_1').find('.thread-main').trigger('click')
    expect(emit).toHaveBeenCalledWith('comment:focus', 'cmt_1')

    store.activeCommentIds = ['cmt_1'] as never
    await nextTick()
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))

    expect(scrolled).not.toHaveBeenCalled()
  })
})
