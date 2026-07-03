<template>
  <div class="side-bar-comments">
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
        <span class="thread-title">
          <span class="thread-id">#{{ thread.id }}</span>
          <span class="status">{{ statusLabel(thread.status) }}</span>
        </span>
        <span
          v-if="thread.authors?.length"
          class="meta"
        >
          {{ thread.authors.join(', ') }}
        </span>
        <span
          v-if="thread.updatedAt || thread.createdAt"
          class="meta"
        >
          {{ formatDate(thread.updatedAt ?? thread.createdAt) }}
        </span>
        <span
          v-if="rangePreview(thread.id)"
          class="range-preview"
        >
          {{ rangePreview(thread.id) }}
        </span>
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
          <div class="reply-meta">
            <span>{{ reply.author }}</span>
            <span>{{ formatDate(reply.createdAt) }}</span>
            <el-tooltip :content="t('sideBar.comments.edit')">
              <el-button
                circle
                size="small"
                :icon="EditPen"
                @click.stop="beginEditReply(thread, index)"
              />
            </el-tooltip>
          </div>
          <p v-if="!editingReplies[replyEditKey(thread.id, index)]">
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
        <el-input
          :ref="setReplyInputRefFor(thread.id)"
          v-model="replyDrafts[thread.id]"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 4 }"
          :placeholder="t('sideBar.comments.replyPlaceholder')"
        />
        <el-button
          v-if="composingThreadIds[thread.id] && !thread.replies.length"
          size="small"
          :icon="Close"
          @click="discardComposedThread(thread.id)"
        >
          {{ t('sideBar.comments.cancelEdit') }}
        </el-button>
        <el-button
          size="small"
          :icon="Promotion"
          :disabled="!replyDrafts[thread.id]?.trim()"
          @click="submitReply(thread.id)"
        >
          {{ t('sideBar.comments.reply') }}
        </el-button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { ICommentRange, ICommentThread } from '@muyajs/core'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Aim, Check, Close, EditPen, Plus, Promotion, RefreshLeft } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import bus from '@/bus'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'

const { t } = useI18n()
const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()
const { comments, activeCommentIds, addCommentEnabled: canAddComment } = storeToRefs(editorStore)
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
const commentFilter = ref<CommentFilter>('all')

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

const rangePreview = (id: string): string =>
  comments.value.ranges.find((range: ICommentRange) => range.id === id)?.preview ?? ''

const commentAuthorName = computed(() => {
  const configured = (preferencesStore.commentAuthorName ?? '').trim()
  return configured || t('sideBar.comments.defaultAuthor')
})

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
  const focus = (): void => {
    replyInputs.get(id)?.focus()
    const thread = Array.from(
      document.querySelectorAll<HTMLElement>('.side-bar-comments .thread')
    ).find(item => item.dataset.commentId === id)
    thread?.querySelector<HTMLTextAreaElement>('.reply-box textarea')?.focus()
  }

  nextTick(() => {
    focus()
    setTimeout(focus)
  })
}

const handleComposeComment = (id: unknown): void => {
  if (typeof id !== 'string') return

  composingThreadIds[id] = true
  replyDrafts[id] = replyDrafts[id] ?? ''
  focusReplyInput(id)
}

const focusComment = (id: string): void => {
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
}

const discardComposedThread = (id: string): void => {
  if (!composingThreadIds[id]) return

  delete replyDrafts[id]
  delete composingThreadIds[id]
  bus.emit('comment:discard', id)
}

const discardEmptyComposedThreads = (): void => {
  const threadsById = new Map(comments.value.threads.map(thread => [thread.id, thread]))
  for (const id of Object.keys(composingThreadIds)) {
    const thread = threadsById.get(id)
    if (!thread || thread.replies.length || replyDrafts[id]?.trim()) continue
    discardComposedThread(id)
  }
}

onMounted(() => {
  bus.on('comment:compose', handleComposeComment)
})

onBeforeUnmount(() => {
  discardEmptyComposedThreads()
  bus.off('comment:compose', handleComposeComment)
})
</script>

<style scoped>
.side-bar-comments {
  height: 100%;
  overflow: auto;
  padding: 34px 16px 20px;
  box-sizing: border-box;
}

.comments-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 18px;
}

.comment-filters {
  display: flex;
  gap: 6px;
  margin: -6px 0 14px;
}

.comment-filters button {
  border: 1px solid var(--itemBgColor);
  background: transparent;
  color: var(--sideBarColor);
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}

.comment-filters button.active {
  border-color: var(--themeColor);
  color: var(--themeColor);
}

.title {
  color: var(--sideBarTitleColor);
  font-weight: 600;
  font-size: 16px;
  line-height: 24px;
}

.summary,
.meta,
.range-preview,
.reply-meta {
  color: var(--sideBarColor);
  opacity: 0.72;
  font-size: 12px;
  line-height: 18px;
}

.range-preview {
  display: -webkit-box;
  overflow: hidden;
  margin-top: 6px;
  font-style: italic;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.section-title {
  color: var(--sideBarTitleColor);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.diagnostics {
  border-bottom: 1px solid var(--itemBgColor);
  padding-bottom: 12px;
  margin-bottom: 8px;
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
  padding: 8px 0;
  text-align: left;
  cursor: pointer;
}

.diagnostic-code {
  color: var(--themeColor);
  font-weight: 600;
}

.empty {
  color: var(--sideBarColor);
  opacity: 0.72;
  font-size: 13px;
  line-height: 20px;
  padding-top: 12px;
}

.thread {
  border-bottom: 1px solid var(--itemBgColor);
  padding: 12px 0 14px;
}

.thread.active {
  border-left: 3px solid var(--themeColor);
  padding-left: 10px;
}

.thread.resolved {
  opacity: 0.68;
}

.thread-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  border: 0;
  padding: 0;
  margin: 0;
  color: var(--sideBarColor);
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.thread-main:hover .thread-id {
  color: var(--themeColor);
}

.thread-title,
.reply-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.thread-id {
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}

.status {
  border: 1px solid var(--itemBgColor);
  border-radius: 6px;
  padding: 1px 6px;
  font-size: 11px;
  line-height: 16px;
}

.replies {
  margin-top: 10px;
}

.reply {
  padding: 8px 0;
}

.reply p {
  margin: 4px 0 0;
  color: var(--sideBarColor);
  font-size: 13px;
  line-height: 19px;
  white-space: pre-wrap;
  user-select: text;
}

.thread-actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}

.reply-box,
.edit-box {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.edit-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
