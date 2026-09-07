<template>
  <ul
    class="core-review-list"
    data-testid="critic-review-list"
    :aria-label="t('editor.coreReview.sidebarTitle')"
  >
    <li
      v-for="entry in entries"
      :key="`${entry.item.range.start}:${entry.item.range.end}`"
      class="core-review-entry"
      :class="{ active: entry.item.range.start === activeStart }"
      data-testid="critic-review-entry"
    >
      <button
        type="button"
        :aria-pressed="entry.item.range.start === activeStart"
        :disabled="busy"
        @click="$emit('select', entry.item.range.start)"
      >
        <span
          class="core-review-entry-kind"
          :data-testid="entry.item.range.start === activeStart ? 'critic-review-kind' : undefined"
          :data-kind="entry.item.kind"
        >{{ t(`editor.coreReview.kinds.${entry.item.kind}`) }}</span>
        <span
          v-if="entry.text !== undefined"
          class="core-review-excerpt"
          :class="entry.item.kind"
        >{{ entry.text }}</span>
        <span
          v-if="entry.replacementText !== undefined"
          class="core-review-excerpt addition"
        >{{ entry.replacementText }}</span>
      </button>
      <CoreDocumentProjection
        v-if="entry.commentProjection"
        :projection="entry.commentProjection"
        kind="comment"
        :label="t('editor.coreReview.commentPrompt')"
      />
      <slot
        v-if="entry.item.range.start === activeStart"
        name="actions"
      />
    </li>
  </ul>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import type { CoreReviewOverviewEntry } from '../../documentAuthority/coreProtocol'
import CoreDocumentProjection from './CoreDocumentProjection.vue'

defineProps<{
  entries: readonly CoreReviewOverviewEntry[]
  activeStart?: number
  busy: boolean
}>()
defineEmits<{ select: [start: number] }>()
</script>

<style scoped>
.core-review-list { list-style: none; padding: 0; margin: 12px 0; }
.core-review-entry { border-bottom: 1px solid var(--floatBorderColor); border-left: 2px solid transparent; padding: 6px; }
.core-review-entry.active { border-left-color: var(--themeColor); background: var(--itemBgColor); }
.core-review-entry > button { display: flex; flex-direction: column; gap: 4px; width: 100%; text-align: left; border: 0; padding: 4px; }
.core-review-entry-kind { font-weight: 600; font-size: 12px; }
.core-review-excerpt { overflow-wrap: anywhere; white-space: pre-wrap; max-height: 5em; overflow: auto; }
.core-review-excerpt.addition { text-decoration: underline; text-decoration-color: var(--themeColor); }
.core-review-excerpt.deletion, .core-review-excerpt.substitution { text-decoration: line-through; }
.core-review-entry > .core-document-projection { font-size: 12px; padding: 0 4px; overflow-wrap: anywhere; user-select: text; }
</style>
