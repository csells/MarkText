<template>
  <div
    ref="reviewRegion"
    class="side-bar-review"
    role="region"
    :aria-label="t('sideBar.review.title')"
    tabindex="-1"
  >
    <header class="review-header">
      <div>
        <div class="title">
          {{ t('sideBar.review.title') }}
        </div>
        <div
          v-if="snapshot.available"
          class="summary"
          aria-live="polite"
        >
          {{ t('sideBar.review.summary', { count: snapshot.items.length }) }}
        </div>
      </div>
      <label
        class="track-changes"
        :title="t(trackChangesCommand.menuLabelKey)"
      >
        <span>{{ t('sideBar.review.trackChanges') }}</span>
        <el-switch
          :model-value="snapshot.trackChanges"
          :disabled="!snapshot.available"
          :aria-label="t('sideBar.review.trackChanges')"
          size="small"
          @change="toggleTrackChanges"
        />
      </label>
    </header>

    <div
      class="projection-picker"
      role="group"
      :aria-label="t('menu.review.display')"
    >
      <button
        v-for="option of projectionOptions"
        :key="option.projection"
        type="button"
        :class="{ active: snapshot.projection === option.projection }"
        :disabled="!snapshot.available"
        :aria-pressed="snapshot.projection === option.projection"
        @click="selectProjection(option.commandId)"
      >
        {{ t(option.label) }}
      </button>
    </div>

    <section
      v-if="composing"
      class="comment-compose"
    >
      <div class="section-title">
        {{ t('sideBar.review.composeTitle') }}
      </div>
      <textarea
        ref="composeInput"
        v-model="composeDraft"
        class="comment-compose-input"
        rows="3"
        :placeholder="t('sideBar.review.commentPlaceholder')"
        :aria-label="t('sideBar.review.commentPlaceholder')"
        @keydown.enter="onComposeEnter"
        @keydown.esc.prevent="cancelCompose"
      />
      <div class="comment-compose-actions">
        <button
          type="button"
          @click="cancelCompose"
        >
          {{ t('sideBar.review.cancel') }}
        </button>
        <button
          type="button"
          class="submit"
          :disabled="!composeDraft.trim()"
          @click="submitCompose"
        >
          {{ t('sideBar.review.addComment') }}
        </button>
      </div>
    </section>

    <div
      v-if="!snapshot.available"
      class="empty"
    >
      {{ t('sideBar.review.unavailable') }}
    </div>
    <div
      v-else-if="snapshot.items.length === 0"
      class="empty"
    >
      {{ t('sideBar.review.empty') }}
    </div>
    <div
      v-else
      class="review-list"
    >
      <section
        v-for="(item, index) of snapshot.items"
        :key="item.id"
        class="review-card"
        :class="[`type-${item.type}`, { active: snapshot.currentItemId === item.id }]"
        :data-critic-id="item.id"
        role="group"
        :aria-labelledby="`review-card-label-${index}`"
      >
        <button
          v-show="editingId !== item.id"
          :id="`review-card-label-${index}`"
          type="button"
          class="review-card-focus"
          :aria-current="snapshot.currentItemId === item.id ? 'true' : undefined"
          @click="activateItem(item)"
        >
          <span class="card-head">
            <span class="type-label">{{ typeLabel(item.type) }}</span>
            <span class="position">#{{ index + 1 }}</span>
          </span>

          <span
            v-if="item.type === 'comment' && item.anchorText"
            class="comment-anchor"
            :title="item.anchorText"
          >{{ item.anchorText }}</span>

          <span
            v-if="item.type === 'substitution'"
            class="substitution"
          >
            <span class="old-content">
              <span class="content-prefix">−</span>
              <span>{{ item.oldContent }}</span>
            </span>
            <span class="new-content">
              <span class="content-prefix">+</span>
              <span>{{ item.newContent }}</span>
            </span>
          </span>
          <span
            v-else
            class="item-content"
            :title="item.content"
          >
            {{ item.content }}
          </span>
        </button>

        <div
          v-if="editingId === item.id"
          class="comment-edit"
          :aria-busy="editSaving"
        >
          <textarea
            ref="editInput"
            v-model="editDraft"
            class="comment-compose-input"
            rows="3"
            :disabled="editSaving"
            :aria-label="t('sideBar.review.edit')"
            @input="onEditInput"
            @keydown.enter="onEditEnter($event, item)"
            @keydown.esc.prevent="cancelEdit()"
          />
          <p
            v-if="editFailed"
            class="comment-edit-failure"
            role="alert"
            aria-live="polite"
          >
            {{ t('sideBar.review.commentEditFailed') }}
          </p>
          <div class="comment-compose-actions">
            <button
              type="button"
              @click="cancelEdit()"
            >
              {{ t('sideBar.review.cancel') }}
            </button>
            <button
              type="button"
              class="submit"
              :disabled="editSaving || !editDraft.trim()"
              @click="submitEdit(item)"
            >
              {{ t('sideBar.review.saveEdit') }}
            </button>
          </div>
        </div>

        <div class="card-actions">
          <button
            v-if="item.type === 'comment' && editingId !== item.id"
            type="button"
            @click.stop="beginEdit(item)"
          >
            {{ t('sideBar.review.edit') }}
          </button>
          <button
            v-if="isChange(item.type)"
            type="button"
            class="accept"
            @click.stop="actOnItem('accept', item)"
          >
            {{ t(acceptCurrentCommand.menuLabelKey) }}
          </button>
          <button
            v-if="isChange(item.type)"
            type="button"
            @click.stop="actOnItem('reject', item)"
          >
            {{ t(rejectCurrentCommand.menuLabelKey) }}
          </button>
          <button
            v-else
            type="button"
            @click.stop="actOnItem('remove-annotation', item)"
          >
            {{ item.type === 'comment'
              ? t('sideBar.review.removeComment')
              : t('sideBar.review.removeHighlight') }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import bus from '@/bus'
import { useCriticMarkupReviewStore } from '@/store/criticMarkupReview'
import type { CriticMarkupCommentEditSubmission } from '../editorWithTabs/criticMarkupCommentEdit'
import {
  REVIEW_COMMAND_DESCRIPTORS,
  type ReviewCommand,
  type ReviewCommandId,
  type ReviewCommandDescriptor
} from '../../../../common/commands/review'
import type {
  CriticMarkupProjection,
  CriticMarkupReviewAction,
  CriticMarkupSidebarItem,
  CriticMarkupSidebarItemAction,
  CriticMarkupType
} from '@shared/types/criticMarkup'

const { t } = useI18n()
const reviewStore = useCriticMarkupReviewStore()
const { snapshot, composing, commentEditRequest } = storeToRefs(reviewStore)
const reviewRegion = ref<HTMLElement | null>(null)
const composeInput = ref<HTMLTextAreaElement | null>(null)
const composeDraft = ref('')

// The compose box opens when the editor's composer requests a comment; focus
// it once it mounts and start from an empty draft each time. `immediate` so a
// panel that mounts while already composing (the sidebar was switched to Review
// by the add-comment action) still focuses its box.
watch(composing, (active) => {
  composeDraft.value = ''
  if (active) {
    nextTick(() => composeInput.value?.focus())
  }
}, { immediate: true })

const submitCompose = (): void => {
  const text = composeDraft.value
  if (!text.trim()) return
  bus.emit('critic-markup-comment-submit', text)
  composeDraft.value = ''
  // Posting a comment is punctuation on editing, not the start of a session —
  // hand focus back to the document.
  bus.emit('editor-focus')
}

const cancelCompose = (): void => {
  bus.emit('critic-markup-comment-cancel')
  composeDraft.value = ''
  bus.emit('editor-focus')
}

// Enter submits; Shift+Enter inserts a newline.
const onComposeEnter = (event: KeyboardEvent): void => {
  if (event.shiftKey) return
  event.preventDefault()
  submitCompose()
}

// Editing a comment in place: click Edit on the card to open an inline box
// prefilled with the comment; Save rewrites the {>>...<<} body via the engine.
const editingId = ref<string | null>(null)
const editDraft = ref('')
const editFailed = ref(false)
const editSaving = ref(false)
const editInput = ref<HTMLTextAreaElement | HTMLTextAreaElement[] | null>(null)
let editSubmissionVersion = 0
let editingIndex = -1
let pendingActionFocus: Readonly<{
  documentId: string
  nodeId: string
  index: number
}> | null = null
interface CommentEditIdentity {
  documentId: string
  revisionId: string
  nodeId: string
}
const editingTarget = ref<CommentEditIdentity | null>(null)

const matchesEditIdentity = (
  identity: CommentEditIdentity,
  documentId: string | null,
  revisionId: string | null,
  item: CriticMarkupSidebarItem
): boolean =>
  identity.documentId === documentId &&
  identity.revisionId === revisionId &&
  identity.nodeId === item.id

const focusEditInput = (): void => {
  nextTick(() => {
    const box = Array.isArray(editInput.value) ? editInput.value[0] : editInput.value
    box?.focus()
  })
}

const beginEdit = (item: CriticMarkupSidebarItem): void => {
  const documentId = snapshot.value.documentId
  const revisionId = snapshot.value.revisionId
  if (!documentId || !revisionId) return
  editSubmissionVersion += 1
  editingTarget.value = {
    documentId,
    revisionId,
    nodeId: item.id
  }
  editingId.value = item.id
  editingIndex = snapshot.value.items.findIndex(candidate => candidate.id === item.id)
  editDraft.value = item.content ?? ''
  editFailed.value = false
  editSaving.value = false
  // The ref lives inside the card v-for, so Vue may collect it as an array;
  // focus the single mounted edit box either way.
  focusEditInput()
}

watch(
  [commentEditRequest, snapshot],
  ([pending, current]) => {
    if (
      !pending ||
      pending.documentId !== current.documentId ||
      pending.target.revisionId !== current.revisionId
    ) return
    const target = current.items.find(item =>
      item.type === 'comment' &&
      item.id === pending.target.nodeId)
    if (!target) return

    reviewStore.TAKE_COMMENT_EDIT()
    const identity = editingTarget.value
    if (identity && matchesEditIdentity(
      identity,
      current.documentId,
      current.revisionId,
      target
    )) {
      focusEditInput()
      return
    }
    beginEdit(target)
  },
  { immediate: true }
)

const activateItem = (item: CriticMarkupSidebarItem): void => {
  if (item.type === 'comment') {
    beginEdit(item)
    return
  }
  actOnItem('focus', item)
}

const focusReviewCard = (nodeId: string): void => {
  nextTick(() => {
    nextTick(() => {
      const card = [...(reviewRegion.value?.querySelectorAll<HTMLElement>(
        '.review-card'
      ) ?? [])].find(candidate => candidate.dataset.criticId === nodeId)
      card?.querySelector<HTMLButtonElement>('.review-card-focus')?.focus()
    })
  })
}

const cancelEdit = (restoreFocus = true): void => {
  const nodeId = editingTarget.value?.nodeId ?? null
  editSubmissionVersion += 1
  editingTarget.value = null
  editingId.value = null
  editingIndex = -1
  editDraft.value = ''
  editFailed.value = false
  editSaving.value = false
  if (restoreFocus && nodeId !== null) focusReviewCard(nodeId)
}

const onEditInput = (): void => {
  editSubmissionVersion += 1
  editFailed.value = false
}

const submitEdit = (item: CriticMarkupSidebarItem): void => {
  if (editSaving.value) return
  const identity = editingTarget.value
  if (!identity || !matchesEditIdentity(
    identity,
    snapshot.value.documentId,
    snapshot.value.revisionId,
    item
  )) {
    cancelEdit()
    return
  }
  const text = editDraft.value
  if (!text.trim()) return
  const version = ++editSubmissionVersion
  editFailed.value = false
  editSaving.value = true
  const submission: CriticMarkupCommentEditSubmission = {
    documentId: identity.documentId,
    target: {
      revisionId: identity.revisionId,
      nodeId: identity.nodeId
    },
    text,
    acknowledge: (result) => {
      // Ignore an acknowledgement for a draft that the user has since edited,
      // cancelled, or replaced with another comment.
      if (
        version !== editSubmissionVersion ||
        editingTarget.value !== identity ||
        editingId.value !== item.id ||
        editDraft.value !== text
      ) {
        return
      }
      editSaving.value = false
      if (result.outcome === 'saved') {
        cancelEdit()
      } else {
        editFailed.value = true
        focusEditInput()
      }
    }
  }
  bus.emit('critic-markup-comment-edit', submission)
}

const onEditEnter = (event: KeyboardEvent, item: CriticMarkupSidebarItem): void => {
  if (event.shiftKey) return
  event.preventDefault()
  submitEdit(item)
}

// A comment whose card is mid-edit can disappear, move, change source identity,
// or be replaced by a same-offset comment in another file. Drop that draft
// rather than ever submitting it against a different document revision.
watch(
  snapshot,
  (current) => {
    const pending = pendingActionFocus
    if (pending !== null) {
      if (pending.documentId !== current.documentId) {
        pendingActionFocus = null
      } else if (!current.items.some(item => item.id === pending.nodeId)) {
        pendingActionFocus = null
        const next = current.items[Math.min(
          pending.index,
          Math.max(0, current.items.length - 1)
        )]
        if (next === undefined) {
          nextTick(() => reviewRegion.value?.focus())
        } else {
          focusReviewCard(next.id)
        }
      }
    }

    const identity = editingTarget.value
    if (!identity) return
    const stillCurrent = current.items.some(item =>
      matchesEditIdentity(
        identity,
        current.documentId,
        current.revisionId,
        item
      ))
    if (!stillCurrent) {
      const sameDocument = identity.documentId === current.documentId
      const next = sameDocument
        ? current.items.find(item => item.id === identity.nodeId) ??
          current.items[Math.min(
            Math.max(0, editingIndex),
            Math.max(0, current.items.length - 1)
          )]
        : undefined
      cancelEdit(false)
      if (next !== undefined) {
        focusReviewCard(next.id)
      } else if (sameDocument) {
        nextTick(() => reviewRegion.value?.focus())
      }
    }
  },
  { flush: 'sync' }
)

const reviewCommand = (action: CriticMarkupReviewAction): ReviewCommand => {
  const descriptor = REVIEW_COMMAND_DESCRIPTORS.find((candidate) => candidate.action === action)
  if (!descriptor) throw new TypeError(`Unknown CriticMarkup Review action: ${action}`)
  return descriptor
}

const trackChangesCommand = reviewCommand('toggle-track-changes')
const acceptCurrentCommand = reviewCommand('accept-current')
const rejectCurrentCommand = reviewCommand('reject-current')

const projectionOptions: Array<{
  projection: CriticMarkupProjection
  commandId: ReviewCommandId
  label: string
}> = REVIEW_COMMAND_DESCRIPTORS
  .filter((descriptor) => descriptor.group === 'projection')
  .map((descriptor) => {
    const metadata: ReviewCommandDescriptor = descriptor
    if (!metadata.projection) {
      throw new TypeError(`Review projection command ${metadata.id} has no projection.`)
    }
    return {
      projection: metadata.projection,
      commandId: descriptor.id,
      label: metadata.menuLabelKey
    }
  })

const changeTypes = new Set<CriticMarkupType>(['addition', 'deletion', 'substitution'])
const isChange = (type: CriticMarkupType): boolean => changeTypes.has(type)
const typeLabel = (type: CriticMarkupType): string => t(`sideBar.review.types.${type}`)

const selectProjection = (commandId: ReviewCommandId): void => {
  if (!snapshot.value.available) return
  bus.emit('cmd::execute', commandId)
}

const toggleTrackChanges = (value: string | number | boolean): void => {
  if (!snapshot.value.available || Boolean(value) === snapshot.value.trackChanges) return
  bus.emit('cmd::execute', trackChangesCommand.id)
}

const actOnItem = (
  action: CriticMarkupSidebarItemAction['action'],
  target: CriticMarkupSidebarItem
): void => {
  const documentId = snapshot.value.documentId
  const revisionId = snapshot.value.revisionId
  if (!documentId || !revisionId) return
  if (action !== 'focus') {
    pendingActionFocus = {
      documentId,
      nodeId: target.id,
      index: Math.max(
        0,
        snapshot.value.items.findIndex(item => item.id === target.id)
      )
    }
  }
  bus.emit('critic-markup-review-item', {
    documentId,
    action,
    target: {
      revisionId,
      nodeId: target.id
    }
  })
}

</script>

<style scoped>
.side-bar-review {
  height: 100%;
  overflow: auto;
  padding: 30px 12px 24px;
  box-sizing: border-box;
}

.review-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.title {
  color: var(--sideBarTitleColor);
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
}

.summary {
  margin-top: 2px;
  color: var(--sideBarColor);
  font-size: 12px;
  line-height: 18px;
  opacity: 0.65;
}

.track-changes {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  color: var(--sideBarColor);
  font-size: 11px;
  line-height: 14px;
  white-space: nowrap;
}

.projection-picker {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 3px;
  margin-bottom: 14px;
  border-radius: 6px;
  background: var(--itemBgColor);
}

.projection-picker button,
.card-actions button {
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--sideBarColor);
  cursor: pointer;
  font: inherit;
}

.projection-picker button {
  min-width: 0;
  padding: 4px 3px;
  font-size: 11px;
  line-height: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.projection-picker button.active {
  color: var(--themeColor);
  background: var(--sideBarBgColor);
  box-shadow: 0 0 0 1px var(--themeColor10);
}

.empty {
  padding: 8px 2px;
  color: var(--sideBarColor);
  font-size: 13px;
  line-height: 20px;
  opacity: 0.65;
}

.comment-compose {
  margin-bottom: 14px;
  padding: 10px;
  border: 1px solid var(--themeColor);
  border-radius: 7px;
  box-shadow: 0 0 0 1px var(--themeColor10);
}

.section-title {
  margin-bottom: 6px;
  color: var(--sideBarTitleColor);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 16px;
  text-transform: uppercase;
}

.comment-compose-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 7px 8px;
  border: 1px solid var(--itemBgColor);
  border-radius: 5px;
  background: var(--sideBarBgColor);
  color: var(--sideBarTextColor);
  font: inherit;
  font-size: 12px;
  line-height: 17px;
  resize: vertical;
}

.comment-compose-input:focus {
  outline: none;
  border-color: var(--themeColor);
}

.comment-compose-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
}

.comment-edit-failure {
  margin: 6px 0 0;
  color: var(--notificationErrorBg, var(--themeColor));
  font-size: 11px;
  line-height: 16px;
}

.comment-compose-actions button {
  padding: 4px 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--sideBarColor);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  line-height: 16px;
}

.comment-compose-actions button.submit {
  background: var(--themeColor);
  color: #fff;
}

.comment-compose-actions button.submit:disabled {
  opacity: 0.5;
  cursor: default;
}

.review-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.review-card {
  border: 1px solid var(--itemBgColor);
  border-left-width: 3px;
  border-radius: 7px;
  color: var(--sideBarTextColor);
  overflow: hidden;
}

.review-card-focus {
  display: block;
  width: 100%;
  padding: 9px 10px 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.review-card-focus:hover {
  background: var(--sideBarItemHoverBgColor);
  outline: none;
}

.side-bar-review:focus-visible,
.projection-picker button:focus-visible,
.comment-compose-input:focus-visible,
.comment-compose-actions button:focus-visible,
.review-card-focus:focus-visible,
.card-actions button:focus-visible {
  outline: 2px solid var(--themeColor);
  outline-offset: 2px;
}

.review-card.active {
  border-color: var(--themeColor);
  box-shadow: 0 0 0 1px var(--themeColor10);
}

.review-card.type-addition {
  border-left-color: var(--successColor, var(--themeColor));
}

.review-card.type-deletion {
  border-left-color: var(--notificationErrorColor, var(--themeColor));
}

.review-card.type-substitution,
.review-card.type-highlight,
.review-card.type-comment {
  border-left-color: var(--themeColor);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 5px;
}

.type-label {
  color: var(--sideBarTitleColor);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 16px;
  text-transform: uppercase;
}

.position {
  color: var(--sideBarColor);
  font-size: 10px;
  line-height: 14px;
  opacity: 0.45;
}

.comment-anchor {
  display: -webkit-box;
  overflow: hidden;
  margin-bottom: 5px;
  padding-left: 6px;
  border-left: 2px solid var(--themeColor);
  color: var(--sideBarColor);
  font-size: 11px;
  line-height: 16px;
  opacity: 0.7;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.item-content,
.substitution {
  margin: 0;
  color: var(--sideBarTextColor);
  font-size: 12px;
  line-height: 17px;
  overflow-wrap: anywhere;
  user-select: text;
  white-space: pre-wrap;
}

.item-content {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.substitution {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.old-content,
.new-content {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr);
}

.old-content {
  text-decoration: line-through;
  opacity: 0.7;
}

.new-content {
  color: var(--successColor, var(--sideBarTextColor));
}

.content-prefix {
  font-weight: 600;
  text-decoration: none;
}

.card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 5px;
  padding: 0 10px 8px;
  margin-top: 8px;
}

.card-actions button {
  padding: 3px 7px;
  font-size: 11px;
  line-height: 16px;
}

.card-actions button:hover {
  color: var(--themeColor);
  background: var(--itemBgColor);
}

.card-actions button.accept {
  color: var(--successColor, var(--themeColor));
}
</style>
