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
        @click="addComment"
      >
        {{ t('sideBar.comments.add') }}
      </el-button>
    </header>

    <section
      v-if="comments.diagnostics.length"
      class="diagnostics"
    >
      <div class="section-title">
        {{ t('sideBar.comments.diagnostics') }}
      </div>
      <div
        v-for="diagnostic of comments.diagnostics"
        :key="`${diagnostic.code}:${diagnostic.id}`"
        class="diagnostic"
      >
        <span class="diagnostic-code">{{ diagnostic.code }}</span>
        <span>{{ diagnostic.message }}</span>
      </div>
    </section>

    <div
      v-if="comments.threads.length === 0"
      class="empty"
    >
      {{ t('sideBar.comments.empty') }}
    </div>

    <section
      v-for="thread of comments.threads"
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
          </div>
          <p>{{ reply.body }}</p>
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
        v-if="editingThreads[thread.id]"
        class="edit-box"
      >
        <el-input
          v-model="editDrafts[thread.id]"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 4 }"
          :placeholder="t('sideBar.comments.editPlaceholder')"
        />
        <div class="edit-actions">
          <el-button
            size="small"
            :icon="Close"
            @click="cancelEdit(thread.id)"
          >
            {{ t('sideBar.comments.cancelEdit') }}
          </el-button>
          <el-button
            size="small"
            type="primary"
            :icon="Check"
            :disabled="!editDrafts[thread.id]?.trim()"
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
import type { ICommentThread } from '@muyajs/core'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive } from 'vue'
import { storeToRefs } from 'pinia'
import { Aim, Check, Close, EditPen, Plus, Promotion, RefreshLeft } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import bus from '@/bus'
import { useEditorStore } from '@/store/editor'

const { t } = useI18n()
const editorStore = useEditorStore()
const { comments, activeCommentIds } = storeToRefs(editorStore)
const replyDrafts = reactive<Record<string, string>>({})
const editDrafts = reactive<Record<string, string>>({})
const editingThreads = reactive<Record<string, boolean>>({})
const replyInputs = new Map<string, { focus: () => void }>()

const summaryText = computed(() => {
  const openCount = comments.value.threads.filter((thread) => thread.status === 'open').length
  return t('sideBar.comments.summary', {
    count: comments.value.threads.length,
    open: openCount
  })
})

const statusLabel = (status: string): string =>
  status === 'resolved' ? t('sideBar.comments.resolved') : t('sideBar.comments.open')

const formatDate = (value?: string): string => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const addComment = (): void => {
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

  replyDrafts[id] = replyDrafts[id] ?? ''
  focusReplyInput(id)
}

const focusComment = (id: string): void => {
  bus.emit('comment:focus', id)
}

const resolveComment = (id: string): void => {
  bus.emit('comment:resolve', id)
}

const reopenComment = (id: string): void => {
  bus.emit('comment:reopen', id)
}

const beginEdit = (thread: ICommentThread): void => {
  editingThreads[thread.id] = true
  editDrafts[thread.id] = thread.replies[0]?.body ?? ''
}

const cancelEdit = (id: string): void => {
  editingThreads[id] = false
  editDrafts[id] = ''
}

const submitEdit = (thread: ICommentThread): void => {
  const body = editDrafts[thread.id]?.trim()
  if (!body) return

  const updatedAt = new Date().toISOString()
  const author = thread.replies[0]?.author || t('sideBar.comments.defaultAuthor')
  const replies = thread.replies.length
    ? thread.replies.map((reply, index) => (index === 0 ? { ...reply, body } : reply))
    : [{ author, createdAt: updatedAt, body }]

  bus.emit('comment:edit', {
    id: thread.id,
    patch: {
      authors: thread.authors?.length ? thread.authors : [author],
      updatedAt,
      replies
    }
  })
  cancelEdit(thread.id)
}

const submitReply = (id: string): void => {
  const body = replyDrafts[id]?.trim()
  if (!body) return

  bus.emit('comment:reply', {
    id,
    reply: {
      author: t('sideBar.comments.defaultAuthor'),
      body
    }
  })
  replyDrafts[id] = ''
}

onMounted(() => {
  bus.on('comment:compose', handleComposeComment)
})

onBeforeUnmount(() => {
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

.title {
  color: var(--sideBarTitleColor);
  font-weight: 600;
  font-size: 16px;
  line-height: 24px;
}

.summary,
.meta,
.reply-meta {
  color: var(--sideBarColor);
  opacity: 0.72;
  font-size: 12px;
  line-height: 18px;
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
  color: var(--sideBarColor);
  font-size: 12px;
  line-height: 17px;
  padding: 8px 0;
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
