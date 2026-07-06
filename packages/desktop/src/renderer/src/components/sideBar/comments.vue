<template>
  <div
    ref="threadsRoot"
    class="side-bar-comments"
  >
    <header class="comments-header">
      <div>
        <div class="title">
          {{ t('sideBar.comments.title') }}
        </div>
        <div class="summary">
          {{ summaryText }}
        </div>
      </div>
      <el-button
        size="small"
        :icon="Plus"
        :disabled="!canAddComment"
        @click="addComment"
      >
        {{ t('sideBar.comments.add') }}
      </el-button>
    </header>

    <div class="comment-filters">
      <button
        type="button"
        :class="{ active: commentFilter === 'all' }"
        @click="commentFilter = 'all'"
      >
        {{ t('sideBar.comments.all') }}
      </button>
      <button
        type="button"
        :class="{ active: commentFilter === 'open' }"
        @click="commentFilter = 'open'"
      >
        {{ t('sideBar.comments.open') }}
      </button>
      <button
        type="button"
        :class="{ active: commentFilter === 'resolved' }"
        @click="commentFilter = 'resolved'"
      >
        {{ t('sideBar.comments.resolved') }}
      </button>
    </div>

    <section
      v-if="comments.diagnostics.length"
      class="diagnostics"
    >
      <div class="section-title">
        {{ t('sideBar.comments.diagnostics') }}
      </div>
      <button
        v-for="(diagnostic, index) of comments.diagnostics"
        :key="`${diagnostic.code}:${diagnostic.id}:${index}`"
        class="diagnostic"
        type="button"
        @click="focusDiagnostic(diagnostic.id)"
      >
        <span class="diagnostic-code">{{ diagnostic.code }}</span>
        <span>{{ diagnostic.message }}</span>
      </button>
    </section>

    <div
      v-if="visibleThreads.length === 0"
      class="empty"
    >
      {{ t('sideBar.comments.empty') }}
    </div>

    <section
      v-for="thread of visibleThreads"
      :key="thread.id"
      class="thread"
      :data-comment-id="thread.id"
      :class="{
        active: activeCommentIds.includes(thread.id),
        resolved: thread.status === 'resolved'
      }"
    >
      <button
        class="thread-main"
        type="button"
        @click="focusComment(thread.id)"
      >
        <span
          class="status"
          :class="thread.status"
        >{{ statusLabel(thread.status) }}</span>
      </button>

      <div
        v-if="thread.replies.length"
        class="replies"
      >
        <div
          v-for="(reply, index) of thread.replies"
          :key="`${thread.id}:${index}:${reply.createdAt}`"
          class="reply"
        >
          <div class="entry-head">
            <span
              class="avatar"
              :style="avatarStyle(reply.author)"
            >{{ initials(reply.author) }}</span>
            <span class="entry-author">{{ reply.author || t('sideBar.comments.defaultAuthor') }}</span>
            <span class="entry-date">{{ formatDate(reply.createdAt) }}</span>
            <el-tooltip :content="t('sideBar.comments.edit')">
              <el-button
                class="entry-edit"
                circle
                size="small"
                :icon="EditPen"
                @click.stop="beginEditReply(thread, index)"
              />
            </el-tooltip>
          </div>
          <p
            v-if="!editingReplies[replyEditKey(thread.id, index)]"
            class="entry-body"
          >
            {{ reply.body }}
          </p>
          <div
            v-else
            class="edit-box reply-edit-box"
          >
            <el-input
              v-model="editDrafts[replyEditKey(thread.id, index)]"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 4 }"
              :placeholder="t('sideBar.comments.editPlaceholder')"
              @keydown.enter="submitOnModEnter($event, () => submitEditReply(thread, index))"
              @keydown.esc.prevent.stop="cancelEditReply(thread.id, index)"
            />
            <div class="edit-actions">
              <el-button
                size="small"
                :icon="Close"
                @click="cancelEditReply(thread.id, index)"
              >
                {{ t('sideBar.comments.cancelEdit') }}
              </el-button>
              <el-button
                size="small"
                type="primary"
                :icon="Check"
                :disabled="!editDrafts[replyEditKey(thread.id, index)]?.trim()"
                @click="submitEditReply(thread, index)"
              >
                {{ t('sideBar.comments.saveEdit') }}
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <div class="thread-actions">
        <el-tooltip :content="t('sideBar.comments.jump')">
          <el-button
            circle
            size="small"
            :icon="Aim"
            @click="focusComment(thread.id)"
          />
        </el-tooltip>
        <el-tooltip :content="t('sideBar.comments.edit')">
          <el-button
            circle
            size="small"
            :icon="EditPen"
            @click="beginEdit(thread)"
          />
        </el-tooltip>
        <el-tooltip
          v-if="thread.status === 'open'"
          :content="t('sideBar.comments.resolve')"
        >
          <el-button
            circle
            size="small"
            :icon="Check"
            @click="resolveComment(thread.id)"
          />
        </el-tooltip>
        <el-tooltip
          v-else
          :content="t('sideBar.comments.reopen')"
        >
          <el-button
            circle
            size="small"
            :icon="RefreshLeft"
            @click="reopenComment(thread.id)"
          />
        </el-tooltip>
      </div>

      <div
        v-if="!thread.replies.length && editingReplies[replyEditKey(thread.id, 0)]"
        class="edit-box"
      >
        <el-input
          v-model="editDrafts[replyEditKey(thread.id, 0)]"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 4 }"
          :placeholder="t('sideBar.comments.editPlaceholder')"
          @keydown.enter="submitOnModEnter($event, () => submitEdit(thread))"
          @keydown.esc.prevent.stop="cancelEditReply(thread.id, 0)"
        />
        <div class="edit-actions">
          <el-button
            size="small"
            :icon="Close"
            @click="cancelEditReply(thread.id, 0)"
          >
            {{ t('sideBar.comments.cancelEdit') }}
          </el-button>
          <el-button
            size="small"
            type="primary"
            :icon="Check"
            :disabled="!editDrafts[replyEditKey(thread.id, 0)]?.trim()"
            @click="submitEdit(thread)"
          >
            {{ t('sideBar.comments.saveEdit') }}
          </el-button>
        </div>
      </div>

      <div class="reply-box">
        <div class="entry-head compose-head">
          <span
            class="avatar"
            :style="avatarStyle(commentAuthorName)"
          >{{ initials(commentAuthorName) }}</span>
          <span class="entry-author">{{ commentAuthorName }}</span>
        </div>
        <el-input
          :ref="setReplyInputRefFor(thread.id)"
          v-model="replyDrafts[thread.id]"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 4 }"
          :placeholder="thread.replies.length
            ? t('sideBar.comments.replyPlaceholder')
            : t('sideBar.comments.commentPlaceholder')"
          @keydown.enter="submitOnModEnter($event, () => submitReply(thread.id))"
          @keydown.esc.prevent.stop="composeEscape(thread.id)"
        />
        <div class="compose-actions">
          <el-button
            v-if="composingThreadIds[thread.id] && !thread.replies.length"
            size="small"
            @click="discardComposedThread(thread.id)"
          >
            {{ t('sideBar.comments.cancelEdit') }}
          </el-button>
          <el-button
            size="small"
            type="primary"
            :disabled="!replyDrafts[thread.id]?.trim()"
            @click="submitReply(thread.id)"
          >
            {{ thread.replies.length
              ? t('sideBar.comments.reply')
              : t('sideBar.comments.comment') }}
          </el-button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { ICommentThread } from '@muyajs/core'
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Aim, Check, Close, EditPen, Plus, RefreshLeft } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import bus from '@/bus'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'

const { t } = useI18n()
const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()
const { comments, activeCommentIds, addCommentEnabled: canAddComment, composeCommentId } = storeToRefs(editorStore)
const replyDrafts = reactive<Record<string, string>>({})
const editDrafts = reactive<Record<string, string>>({})
const editingReplies = reactive<Record<string, boolean>>({})
const composingThreadIds = reactive<Record<string, boolean>>({})
// createdAt of the reply an open edit box targets, so a submit can detect that
// the reply array shifted underneath (index-based identity would otherwise
// overwrite a different reply).
const editReplyAnchors = reactive<Record<string, string>>({})
const replyInputs = new Map<string, { focus: () => void }>()
type CommentFilter = 'all' | 'open' | 'resolved'
const commentFilter = ref<CommentFilter>('open')

const summaryText = computed(() => {
  const openCount = comments.value.threads.filter((thread) => thread.status === 'open').length
  return t('sideBar.comments.summary', {
    count: comments.value.threads.length,
    open: openCount
  })
})

const statusLabel = (status: string): string =>
  status === 'resolved' ? t('sideBar.comments.resolved') : t('sideBar.comments.open')

const visibleThreads = computed(() => {
  if (commentFilter.value === 'all') return comments.value.threads
  return comments.value.threads.filter(thread => thread.status === commentFilter.value)
})

const commentAuthorName = computed(() => {
  const configured = (preferencesStore.commentAuthorName ?? '').trim()
  const osName = (window.electron?.osUsername ?? '').trim()
  return configured || osName || t('sideBar.comments.defaultAuthor')
})

const initials = (name?: string): string => {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
}

// Deterministic per-author colour so avatars stay stable and distinguishable.
const avatarStyle = (name?: string): Record<string, string> => {
  const trimmed = (name ?? '').trim() || '?'
  let hash = 0
  for (let i = 0; i < trimmed.length; i++) hash = (hash * 31 + trimmed.charCodeAt(i)) | 0
  return { backgroundColor: `hsl(${Math.abs(hash) % 360}, 45%, 45%)` }
}

// Comment ids are recycled (nextCommentId fills the lowest free cmt_N), so an
// unsent reply/edit draft for a thread that has since disappeared must be
// dropped — otherwise it would resurface, pre-filled, on an unrelated new thread
// that happens to reuse the id.
watch(
  () => comments.value.threads.map(thread => thread.id),
  (ids) => {
    const live = new Set(ids)
    const threadIdOf = (key: string): string => key.slice(0, key.lastIndexOf(':')) || key
    for (const key of Object.keys(replyDrafts)) {
      if (!live.has(key)) delete replyDrafts[key]
    }
    for (const key of Object.keys(composingThreadIds)) {
      if (!live.has(key)) delete composingThreadIds[key]
    }
    for (const key of Object.keys(editDrafts)) {
      if (!live.has(threadIdOf(key))) delete editDrafts[key]
    }
    for (const key of Object.keys(editingReplies)) {
      if (!live.has(threadIdOf(key))) delete editingReplies[key]
    }
    for (const key of Object.keys(editReplyAnchors)) {
      if (!live.has(threadIdOf(key))) delete editReplyAnchors[key]
    }
  }
)

const formatDate = (value?: string): string => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const addComment = (): void => {
  if (!canAddComment.value) return

  bus.emit('addComment')
}

const setReplyInputRef = (id: string, input: unknown): void => {
  if (input && typeof (input as { focus?: unknown }).focus === 'function') {
    replyInputs.set(id, input as { focus: () => void })
  } else {
    replyInputs.delete(id)
  }
}

const setReplyInputRefFor = (id: string) => (input: unknown): void => {
  setReplyInputRef(id, input)
}

const focusReplyInput = (id: string): void => {
  const textarea = (): HTMLTextAreaElement | undefined => {
    const thread = Array.from(
      document.querySelectorAll<HTMLElement>('.side-bar-comments .thread')
    ).find(item => item.dataset.commentId === id)
    return thread?.querySelector<HTMLTextAreaElement>('.reply-box textarea') ?? undefined
  }
  const focus = (): void => {
    // Stop once the thread is no longer composing (submitted/discarded), so a
    // late retry can't yank focus back from the document after Cmd+Enter.
    if (!composingThreadIds[id]) return
    const box = textarea()
    if (box && document.activeElement !== box) {
      replyInputs.get(id)?.focus()
      box.focus()
    }
  }

  // Add Comment first re-focuses the editor and edits the document, both of
  // which can grab focus back; retry across a short window so the compose box
  // wins, stopping early once it already holds focus.
  nextTick(() => {
    for (const delay of [0, 80, 200, 400]) setTimeout(focus, delay)
  })
}

const handleComposeComment = (id: unknown): void => {
  if (typeof id !== 'string') return

  composingThreadIds[id] = true
  replyDrafts[id] = replyDrafts[id] ?? ''
  focusReplyInput(id)
}

const threadsRoot = ref<HTMLElement | null>(null)
// A sidebar click on a thread activates that thread in the document, which
// echoes back as an activeCommentIds change; scrolling the list the user is
// already interacting with would yank it out from under their pointer.
let suppressActiveScrollUntil = 0

const scrollActiveThreadIntoView = (): void => {
  const root = threadsRoot.value
  const id = activeCommentIds.value[0]
  if (!root || !id) return

  // Comment ids are parser-constrained to \w[\w-]* (COMMENT_ID_PATTERN), so
  // they are attribute-selector-safe without escaping.
  root.querySelector(`[data-comment-id="${id}"]`)?.scrollIntoView({ block: 'nearest' })
}

watch(activeCommentIds, (ids, previous) => {
  if (performance.now() < suppressActiveScrollUntil) return

  const previousIds = new Set(previous ?? [])
  if (!ids.some((id) => !previousIds.has(id))) return

  nextTick().then(scrollActiveThreadIntoView)
})

const focusComment = (id: string): void => {
  suppressActiveScrollUntil = performance.now() + 500
  bus.emit('comment:focus', id)
}

const focusDiagnostic = (id: string): void => {
  bus.emit('comment:diagnostic-focus', id)
}

const resolveComment = (id: string): void => {
  bus.emit('comment:resolve', id)
}

const reopenComment = (id: string): void => {
  bus.emit('comment:reopen', id)
}

const replyEditKey = (id: string, replyIndex: number): string => `${id}:${replyIndex}`

const beginEditReply = (thread: ICommentThread, replyIndex: number): void => {
  if (!Number.isInteger(replyIndex) || replyIndex < 0) return

  const key = replyEditKey(thread.id, replyIndex)
  editingReplies[key] = true
  editDrafts[key] = thread.replies[replyIndex]?.body ?? ''
  editReplyAnchors[key] = thread.replies[replyIndex]?.createdAt ?? ''
}

const beginEdit = (thread: ICommentThread): void => {
  beginEditReply(thread, 0)
}

const cancelEditReply = (id: string, replyIndex: number): void => {
  const key = replyEditKey(id, replyIndex)
  editingReplies[key] = false
  editDrafts[key] = ''
  delete editReplyAnchors[key]
  // Cancelling an edit returns focus (and the caret) to the document.
  bus.emit('editor-focus')
}

const submitEditReply = (thread: ICommentThread, replyIndex: number): void => {
  if (!Number.isInteger(replyIndex) || replyIndex < 0) return

  const key = replyEditKey(thread.id, replyIndex)
  const body = editDrafts[key]?.trim()
  if (!body) return

  const updatedAt = new Date().toISOString()
  const existingReply = thread.replies[replyIndex]
  if (!existingReply && (replyIndex !== 0 || thread.replies.length > 0)) return
  // The reply array shifted while the edit box was open — the index now points
  // at a different reply, so abort rather than overwrite the wrong one.
  const anchor = editReplyAnchors[key]
  if (existingReply && anchor && existingReply.createdAt !== anchor) {
    cancelEditReply(thread.id, replyIndex)
    return
  }

  const author = existingReply?.author || commentAuthorName.value
  const replies = existingReply
    ? thread.replies.map((reply, index) => (index === replyIndex ? { ...reply, body } : reply))
    : [{ author, createdAt: updatedAt, body }]

  bus.emit('comment:edit', {
    id: thread.id,
    patch: {
      authors: thread.authors?.length ? thread.authors : [author],
      updatedAt,
      replies
    }
  })
  cancelEditReply(thread.id, replyIndex)
}

const submitEdit = (thread: ICommentThread): void => {
  submitEditReply(thread, 0)
}

// Cmd/Ctrl+Enter submits from any comment textarea; a bare Enter still inserts
// a newline.
const submitOnModEnter = (event: KeyboardEvent, submit: () => void): void => {
  if (!(event.metaKey || event.ctrlKey)) return
  event.preventDefault()
  submit()
}

const submitReply = (id: string): void => {
  const body = replyDrafts[id]?.trim()
  if (!body) return

  bus.emit('comment:reply', {
    id,
    reply: {
      author: commentAuthorName.value,
      body
    }
  })
  replyDrafts[id] = ''
  delete composingThreadIds[id]
  // Posting a comment is a punctuation mark on editing, not the start of a
  // commenting session — hand focus back to the document.
  bus.emit('editor-focus')
}

const discardComposedThread = (id: string): void => {
  if (!composingThreadIds[id]) return

  delete replyDrafts[id]
  delete composingThreadIds[id]
  bus.emit('comment:discard', id)
  // Cancelling a just-added comment hands focus (and the caret) back to the doc.
  bus.emit('editor-focus')
}

// Esc from a compose/reply box: discard a brand-new (empty) comment, or just
// close a reply, and return focus to the editor either way.
const composeEscape = (id: string): void => {
  const thread = comments.value.threads.find(item => item.id === id)
  if (thread && composingThreadIds[id] && !thread.replies.length) {
    discardComposedThread(id)
    return
  }
  replyDrafts[id] = ''
  delete composingThreadIds[id]
  bus.emit('editor-focus')
}

const discardEmptyComposedThreads = (): void => {
  const threadsById = new Map(comments.value.threads.map(thread => [thread.id, thread]))
  for (const id of Object.keys(composingThreadIds)) {
    const thread = threadsById.get(id)
    if (!thread || thread.replies.length || replyDrafts[id]?.trim()) continue
    discardComposedThread(id)
  }
}

// Durable compose signal: fires on mount too (immediate), so Add Comment focuses
// the box even when it just mounted this sidebar. Clear it once consumed.
watch(
  composeCommentId,
  (id) => {
    if (typeof id !== 'string' || !id) return
    handleComposeComment(id)
    editorStore.SET_COMPOSE_COMMENT_ID(null)
  },
  { immediate: true, flush: 'post' }
)

onBeforeUnmount(() => {
  discardEmptyComposedThreads()
})
</script>

<style scoped>
.side-bar-comments {
  height: 100%;
  overflow: auto;
  padding: 30px 12px 24px;
  box-sizing: border-box;
}

.comments-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.title {
  color: var(--sideBarTitleColor);
  font-weight: 600;
  font-size: 16px;
  line-height: 22px;
}

.summary {
  color: var(--sideBarColor);
  opacity: 0.6;
  font-size: 12px;
  line-height: 18px;
  margin-top: 2px;
  white-space: nowrap;
}

.comment-filters {
  display: flex;
  gap: 6px;
  margin: 0 0 14px;
}

.comment-filters button {
  border: 1px solid var(--itemBgColor);
  background: transparent;
  color: var(--sideBarColor);
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}

.comment-filters button.active {
  border-color: var(--themeColor);
  color: var(--themeColor);
}

.section-title {
  color: var(--sideBarTitleColor);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.diagnostics {
  border: 1px solid var(--itemBgColor);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}

.diagnostic {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--sideBarColor);
  font-size: 12px;
  line-height: 17px;
  padding: 6px 0;
  text-align: left;
  cursor: pointer;
}

.diagnostic-code {
  color: var(--themeColor);
  font-weight: 600;
}

.empty {
  color: var(--sideBarColor);
  opacity: 0.6;
  font-size: 13px;
  line-height: 20px;
  padding-top: 8px;
}

/* Each thread is a Google-Docs-style card. */
.thread {
  border: 1px solid var(--itemBgColor);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
}

.thread.active {
  border-color: var(--themeColor);
  box-shadow: 0 0 0 1px var(--themeColor);
}

.thread.resolved {
  opacity: 0.6;
}

.thread-main {
  display: flex;
  width: 100%;
  border: 0;
  padding: 0;
  margin: 0;
  background: transparent;
  cursor: pointer;
}

.status {
  border-radius: 10px;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 16px;
  background: var(--itemBgColor);
  color: var(--sideBarColor);
}

.status.resolved {
  color: var(--themeColor);
}

/* A single comment or reply: avatar + author + date, then the body. */
.entry-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.avatar {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}

.entry-author {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--sideBarTitleColor);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-date {
  flex: 0 0 auto;
  color: var(--sideBarColor);
  opacity: 0.6;
  font-size: 11px;
  line-height: 16px;
}

.entry-edit {
  flex: 0 0 auto;
  opacity: 0;
  transition: opacity 0.1s ease;
}

.reply:hover .entry-edit {
  opacity: 1;
}

.entry-body {
  margin: 4px 0 0 32px;
  color: var(--sideBarColor);
  font-size: 13px;
  line-height: 19px;
  white-space: pre-wrap;
  user-select: text;
}

.replies {
  margin-top: 4px;
}

.reply {
  padding: 6px 0;
}

.thread-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.compose-head {
  margin-bottom: 6px;
}

.reply-box,
.edit-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.compose-actions,
.edit-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
