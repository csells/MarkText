<template>
  <ul
    class="core-review-list"
    data-testid="critic-review-list"
    :aria-label="t('editor.coreReview.sidebarTitle')"
  >
    <template
      v-for="(entry, index) in entries"
      :key="`${entry.item.range.start}:${entry.item.range.end}`"
    >
      <li
        v-if="composing && index === draftIndex"
        class="core-review-entry active draft"
        data-testid="critic-review-draft-entry"
      >
        <slot name="composer" />
      </li>
      <li
        class="core-review-entry"
        :class="{ active: entry.item.range.start === activeStart || entry.item.range.start === composerStart }"
        data-testid="critic-review-entry"
      >
        <button
          type="button"
          :aria-pressed="entry.item.range.start === activeStart"
          :aria-label="entryName(entry)"
          :disabled="busy"
          @click="$emit('select', entry.item.range.start)"
        >
          <span
            class="core-review-entry-kind"
            :data-testid="entry.item.range.start === activeStart ? 'critic-review-kind' : undefined"
            :data-kind="entry.item.kind"
          >{{ t(`editor.coreReview.kinds.${entry.item.kind}`) }}</span>
          <span
            v-if="excerpts.get(entry)?.excerpt !== undefined"
            :dir="textDirection"
            class="core-review-excerpt"
            v-html="excerpts.get(entry)?.excerpt?.html"
          />
          <span
            v-if="excerpts.get(entry)?.replacement !== undefined"
            :dir="textDirection"
            class="core-review-excerpt"
            v-html="excerpts.get(entry)?.replacement?.html"
          />
        </button>
        <div
          v-if="entry.commentProjection"
          class="core-review-comment"
          :dir="textDirection"
        >
          <CoreDocumentProjection
            :projection="entry.commentProjection"
            kind="comment"
            :label="t('editor.coreReview.commentPrompt')"
          />
        </div>
        <slot
          v-if="composing && entry.item.range.start === composerStart"
          name="composer"
        />
        <slot
          v-else-if="entry.item.range.start === activeStart"
          name="actions"
        />
      </li>
    </template>
    <li
      v-if="composing && draftIndex === entries.length"
      class="core-review-entry active draft"
      data-testid="critic-review-draft-entry"
    >
      <slot name="composer" />
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
defineEmits<{ select: [start: number] }>()

const draftIndex = computed(() => {
  if (props.draftStart === undefined || props.composerStart !== undefined) return -1
  const start = props.draftStart
  const index = props.entries.findIndex((entry) => entry.item.range.start > start)
  return index < 0 ? props.entries.length : index
})

const excerpts = computed(
  () =>
    new Map(
      props.entries.map((entry) => [
        entry,
        {
          excerpt: entry.excerpt && renderMarkupPassageExcerpt(entry.excerpt),
          replacement: entry.replacementExcerpt && renderMarkupPassageExcerpt(entry.replacementExcerpt)
        } satisfies Record<string, MarkupPassageExcerpt | undefined>
      ])
    )
)

// The visible kind and excerpt are separate elements; join them into one
// readable accessible name.
const entryName = (entry: CoreReviewOverviewEntry): string => {
  const kind = t(`editor.coreReview.kinds.${entry.item.kind}`)
  const rendered = excerpts.value.get(entry)
  const text = [rendered?.excerpt?.text, rendered?.replacement?.text].filter((part) => part).join(' → ')
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
