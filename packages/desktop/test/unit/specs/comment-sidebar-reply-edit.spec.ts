import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse, compileScript } from 'vue/compiler-sfc'
import ts from 'typescript'
import { computed, nextTick, reactive, ref } from 'vue'

const here = dirname(fileURLToPath(import.meta.url))
const vuePath = resolve(here, '../../../src/renderer/src/components/sideBar/comments.vue')

interface CommentReply {
  author: string
  createdAt: string
  body: string
}

interface CommentThread {
  id: string
  status: 'open' | 'resolved'
  authors?: string[]
  createdAt?: string
  updatedAt?: string
  replies: CommentReply[]
}

interface CommentRange {
  id: string
  preview: string
}

interface SetupBindings {
  addComment: () => void
  beginEditReply: (thread: CommentThread, replyIndex: number) => void
  canAddComment: { value: boolean }
  commentFilter: { value: 'all' | 'open' | 'resolved' }
  submitEditReply: (thread: CommentThread, replyIndex: number) => void
  submitReply: (id: string) => void
  editDrafts: Record<string, string>
  focusDiagnostic: (id: string) => void
  rangePreview: (id: string) => string
  replyDrafts: Record<string, string>
  visibleThreads: { value: CommentThread[] }
}

const loadComponent = (deps: Record<string, unknown>) => {
  const src = readFileSync(vuePath, 'utf8')
  const { descriptor } = parse(src)
  const compiled = compileScript(descriptor, { id: 'test' })
  const noImports = compiled.content.replace(
    /^\s*import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm,
    ''
  )
  const js = ts.transpileModule(noImports, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    '__deps',
    'exports',
    'module',
    `const { _defineComponent, computed, nextTick, onBeforeUnmount, onMounted,
      reactive, ref, watch, storeToRefs, Aim, Check, Close, EditPen, Plus, Promotion,
      RefreshLeft, useI18n, bus, useEditorStore, usePreferencesStore } = __deps
    ${js}
    return module.exports`
  ) as (deps: Record<string, unknown>, exports: object, module: object) => {
    default: { setup: (props: unknown, ctx: { expose: () => void }) => SetupBindings }
  }

  const m = { exports: {} as Record<string, unknown> }
  return factory(deps, m.exports, m).default
}

const makeBindings = (
  initialComments: {
    threads?: CommentThread[]
    ranges?: CommentRange[]
    diagnostics?: unknown[]
  } = {},
  options: {
    commentAuthorName?: string
  } = {}
) => {
  const emit = vi.fn()
  const mounted: Array<() => void> = []
  const beforeUnmount: Array<() => void> = []
  const watchers: Array<{ cb: (value: unknown) => void }> = []
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const deps = {
    _defineComponent: (o: unknown) => o,
    computed,
    nextTick,
    onBeforeUnmount: (fn: () => void) => beforeUnmount.push(fn),
    onMounted: (fn: () => void) => mounted.push(fn),
    reactive,
    ref,
    watch: (_source: unknown, cb: (value: unknown) => void) => watchers.push({ cb }),
    storeToRefs: () => ({
      comments: ref({
        threads: initialComments.threads ?? [],
        ranges: initialComments.ranges ?? [],
        diagnostics: initialComments.diagnostics ?? []
      }),
      activeCommentIds: ref([])
    }),
    Aim: {},
    Check: {},
    Close: {},
    EditPen: {},
    Plus: {},
    Promotion: {},
    RefreshLeft: {},
    useI18n: () => ({ t: (key: string) => key === 'sideBar.comments.defaultAuthor' ? 'Reviewer' : key }),
    bus: {
      on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
      off: (event: string) => handlers.delete(event),
      emit
    },
    useEditorStore: () => ({}),
    usePreferencesStore: () => ({
      commentAuthorName: options.commentAuthorName ?? ''
    })
  }

  const comp = loadComponent(deps)
  const ret = comp.setup({}, { expose: () => {} })
  mounted.forEach(fn => fn())
  const triggerThreadIds = (ids: string[]): void => watchers.forEach(w => w.cb(ids))
  return { ret, emit, handlers, beforeUnmount, triggerThreadIds }
}

describe('comments sidebar reply editing', () => {
  it('edits a deterministic reply index without rewriting sibling replies', () => {
    const { ret, emit } = makeBindings()
    const thread: CommentThread = {
      id: 'cmt_1',
      status: 'open',
      authors: ['Ada', 'Grace'],
      replies: [
        { author: 'Ada', createdAt: '2026-06-30T10:00:00.000Z', body: 'first' },
        { author: 'Grace', createdAt: '2026-06-30T11:00:00.000Z', body: 'second' }
      ]
    }

    ret.beginEditReply(thread, 1)
    ret.editDrafts['cmt_1:1'] = 'second edited'
    ret.submitEditReply(thread, 1)

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

  it('prunes reply/edit drafts for a comment id that is no longer present', () => {
    const { ret, triggerThreadIds } = makeBindings({
      threads: [{ id: 'cmt_1', status: 'open', authors: [], replies: [] }]
    })
    ret.replyDrafts.cmt_1 = 'live'
    ret.replyDrafts.cmt_2 = 'stale'
    ret.editDrafts['cmt_2:0'] = 'stale edit'
    ret.editingReplies['cmt_2:0'] = true

    // cmt_2 disappears (e.g. its markers were deleted) — its drafts must not
    // survive to resurface on a future thread that reuses the id.
    triggerThreadIds(['cmt_1'])

    expect(ret.replyDrafts.cmt_1).toBe('live')
    expect(ret.replyDrafts.cmt_2).toBeUndefined()
    expect(ret.editDrafts['cmt_2:0']).toBeUndefined()
    expect(ret.editingReplies['cmt_2:0']).toBeUndefined()
  })

  it('does not emit Add Comment while the shared predicate is disabled', () => {
    const { ret, emit, handlers } = makeBindings()

    expect(ret.canAddComment.value).toBe(false)
    ret.addComment()
    expect(emit).not.toHaveBeenCalledWith('addComment')

    handlers.get('editor-add-comment-enabled-changed')?.(true)
    expect(ret.canAddComment.value).toBe(true)
    ret.addComment()
    expect(emit).toHaveBeenCalledWith('addComment')
  })

  it('exposes readable range previews by comment id', () => {
    const { ret } = makeBindings({
      ranges: [
        { id: 'cmt_1', preview: 'reviewed paragraph text' },
        { id: 'cmt_2', preview: 'other text' }
      ]
    })

    expect(ret.rangePreview('cmt_1')).toBe('reviewed paragraph text')
    expect(ret.rangePreview('missing')).toBe('')
  })

  it('filters visible threads by open and resolved status', () => {
    const openThread: CommentThread = { id: 'open', status: 'open', replies: [] }
    const resolvedThread: CommentThread = { id: 'resolved', status: 'resolved', replies: [] }
    const { ret } = makeBindings({ threads: [openThread, resolvedThread] })

    expect(ret.visibleThreads.value.map(thread => thread.id)).toEqual(['open', 'resolved'])

    ret.commentFilter.value = 'open'
    expect(ret.visibleThreads.value.map(thread => thread.id)).toEqual(['open'])

    ret.commentFilter.value = 'resolved'
    expect(ret.visibleThreads.value.map(thread => thread.id)).toEqual(['resolved'])
  })

  it('uses the configured comment author for new replies', () => {
    const { ret, emit } = makeBindings({}, { commentAuthorName: 'Chris Sells' })

    ret.replyDrafts.cmt_1 = 'Looks good'
    ret.submitReply('cmt_1')

    expect(emit).toHaveBeenCalledWith('comment:reply', {
      id: 'cmt_1',
      reply: {
        author: 'Chris Sells',
        body: 'Looks good'
      }
    })
  })

  it('emits diagnostic focus requests by id', () => {
    const { ret, emit } = makeBindings()

    ret.focusDiagnostic('broken')

    expect(emit).toHaveBeenCalledWith('comment:diagnostic-focus', 'broken')
  })
})
