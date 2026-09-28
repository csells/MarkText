<template>
  <ul
    class="core-review-list"
    data-testid="critic-review-list"
    :aria-label="t('editor.coreReview.sidebarTitle')"
  >
    <li
      v-for="row in rows"
      :key="row.key"
      v-memo="row.entry === undefined ? [{}] : rowMemo(row.entry)"
      class="core-review-entry"
      :class="
        row.entry === undefined
          ? 'active draft'
          : { active: row.entry.item.range.start === activeStart || row.entry.item.range.start === composerStart }
      "
      :data-testid="row.entry === undefined ? 'critic-review-draft-entry' : 'critic-review-entry'"
    >
      <slot
        v-if="row.entry === undefined"
        name="composer"
      />
      <template v-else>
        <button
          type="button"
          :aria-pressed="row.entry.item.range.start === activeStart"
          :aria-label="entryName(row.entry)"
          :disabled="busy"
          @click="select(row.entry)"
        >
          <span
            class="core-review-entry-kind"
            :data-testid="row.entry.item.range.start === activeStart ? 'critic-review-kind' : undefined"
            :data-kind="row.entry.item.kind"
          >{{ t(`editor.coreReview.kinds.${row.entry.item.kind}`) }}</span>
          <span
            v-if="row.entry.excerpt !== undefined"
            :dir="textDirection"
            class="core-review-excerpt"
            v-html="rendered(row.entry.excerpt).html"
          />
          <span
            v-if="row.entry.replacementExcerpt !== undefined"
            :dir="textDirection"
            class="core-review-excerpt"
            v-html="rendered(row.entry.replacementExcerpt).html"
          />
        </button>
        <div
          v-if="row.entry.commentProjection"
          class="core-review-comment"
          :dir="textDirection"
        >
          <CoreDocumentProjection
            :projection="row.entry.commentProjection"
            kind="comment"
            :label="t('editor.coreReview.commentPrompt')"
          />
        </div>
        <slot
          v-if="composing && row.entry.item.range.start === composerStart"
          name="composer"
        />
        <slot
          v-else-if="row.entry.item.range.start === activeStart"
          name="actions"
        />
      </template>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import type { CoreReviewOverviewEntry } from '../../documentAuthority/coreProtocol'
import {
  renderMarkupPassageExcerpt,
  type MarkupPassageExcerpt
} from '../../documentConsumers/markdownProjectionHtml'
import type { MarkupPassage } from '../../documentConsumers/markupPassage'
import CoreDocumentProjection from './CoreDocumentProjection.vue'

const props = defineProps<{
  entries: readonly CoreReviewOverviewEntry[]
  activeStart?: number
  busy: boolean
  textDirection: string
  /** An open composer is in place of this entry's actions (Google Docs keeps it on its card). */
  composerStart?: number
  /** An open composer for a new item is a draft card at this source position. */
  draftStart?: number
  composing?: boolean
}>()
const emit = defineEmits<{ select: [start: number] }>()

const draftIndex = computed(() => {
  if (props.draftStart === undefined || props.composerStart !== undefined) return -1
  const start = props.draftStart
  const index = props.entries.findIndex((entry) => entry.item.range.start > start)
  return index < 0 ? props.entries.length : index
})

// An edit elsewhere moves an entry without changing its passages, so the
// rendering and the row of an unchanged entry are found by its passage.
const renderedPassages = new WeakMap<MarkupPassage, MarkupPassageExcerpt>()
const rendered = (passage: MarkupPassage): MarkupPassageExcerpt => {
  let excerpt = renderedPassages.get(passage)
  if (excerpt === undefined) {
    excerpt = renderMarkupPassageExcerpt(passage)
    renderedPassages.set(passage, excerpt)
  }
  return excerpt
}
const rowKeys = new WeakMap<MarkupPassage, number>()
let nextRowKey = 0
const rowKey = (entry: CoreReviewOverviewEntry): number | string => {
  const passage = entry.excerpt ?? entry.commentProjection ?? entry.replacementExcerpt
  if (passage === undefined) return `${entry.item.range.start}:${entry.item.range.end}`
  let key = rowKeys.get(passage)
  if (key === undefined) {
    key = nextRowKey++
    rowKeys.set(passage, key)
  }
  return key
}

// A row that is neither selected nor composing renders only from its
// entry's passages, so after an edit elsewhere it is not rendered again.
// The selected row renders its actions slot, which may change at any time.
const rowMemo = (entry: CoreReviewOverviewEntry): unknown[] => {
  const start = entry.item.range.start
  const live = start === props.activeStart || start === props.composerStart
  return [rowKey(entry), entry.item.kind, live ? {} : false, props.busy, props.textDirection]
}
// A kept row's handler belongs to the entry it was rendered for; select the
// entry now in its place.
const select = (entry: CoreReviewOverviewEntry): void => {
  const key = rowKey(entry)
  const current = props.entries.find((candidate) => rowKey(candidate) === key) ?? entry
  emit('select', current.item.range.start)
}

// A draft card for a new item stands before the entry at `draftIndex`.
const rows = computed(() => {
  const list: { key: number | string; entry?: CoreReviewOverviewEntry }[] = props.entries.map(
    (entry) => ({ key: rowKey(entry), entry })
  )
  if (props.composing && draftIndex.value >= 0) list.splice(draftIndex.value, 0, { key: 'draft' })
  return list
})

// The visible kind and excerpt are separate elements; join them into one
// readable accessible name.
const entryName = (entry: CoreReviewOverviewEntry): string => {
  const kind = t(`editor.coreReview.kinds.${entry.item.kind}`)
  const text = [entry.excerpt, entry.replacementExcerpt]
    .map((passage) => passage && rendered(passage).text)
    .filter((part) => part)
    .join(' → ')
  return text ? `${kind}: ${text}` : kind
}
</script>

<style scoped>
.core-review-list {
  list-style: none;
  padding: 0;
  margin: 12px 0;
}
.core-review-entry {
  border-left: 2px solid transparent;
  padding: 6px;
}
.core-review-entry.draft {
  padding: 6px 0;
}
.core-review-entry.active {
  border-left-color: var(--themeColor);
  background: var(--sideBarItemHoverBgColor);
}
.core-review-entry > button {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  text-align: left;
  border: 0;
  padding: 4px;
  color: var(--sideBarColor);
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.core-review-entry > button:hover {
  background: var(--sideBarItemHoverBgColor);
}
.core-review-entry > button:focus-visible {
  background: var(--sideBarItemHoverBgColor);
}
.core-review-entry-kind {
  font-weight: 600;
  font-size: 13px;
}
.core-review-excerpt {
  text-align: start;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  max-height: 5em;
  overflow: auto;
}
/* Review marks read as they do in the editor. */
.core-review-list :deep(.core-critic-addition),
.core-review-list :deep(.core-critic-substitution-new) {
  background: color-mix(in srgb, #3b9959 18%, transparent);
  text-decoration: underline;
  text-decoration-color: #3b9959;
}
.core-review-list :deep(.core-critic-deletion),
.core-review-list :deep(.core-critic-substitution-old) {
  background: color-mix(in srgb, #ce5555 14%, transparent);
  text-decoration: line-through;
  text-decoration-color: #ce5555;
}
.core-review-list :deep(.core-critic-highlight) {
  background: color-mix(in srgb, #d4ac33 26%, transparent);
}
.core-review-entry > .core-review-comment {
  color: var(--sideBarTextColor);
  font-size: 12px;
  padding: 0 4px;
  overflow-wrap: anywhere;
  user-select: text;
}
</style>
