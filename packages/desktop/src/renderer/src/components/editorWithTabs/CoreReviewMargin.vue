<template>
  <aside
    ref="margin"
    class="core-review-margin"
    :aria-label="t('editor.coreReview.comments')"
  >
    <article
      v-for="(comment, index) in comments"
      :key="`${comment.item.range.start}:${comment.item.range.end}`"
      class="core-margin-comment"
      :class="{ active: activeStart === comment.item.range.start }"
      :style="{ top: `${positions[index]}px` }"
      data-testid="critic-margin-comment"
    >
      <CoreDocumentProjection
        v-if="comment.commentProjection"
        :projection="comment.commentProjection"
        kind="comment"
        :label="t('editor.coreReview.commentPrompt')"
      />
      <button
        type="button"
        :disabled="busy"
        @click="emit('select', comment.item.range.start)"
      >
        {{ t('editor.coreReview.editComment') }}
      </button>
    </article>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CoreReviewOverviewEntry } from '@/documentAuthority/coreProtocol'
import CoreDocumentProjection from './CoreDocumentProjection.vue'

const props = defineProps<{
  comments: readonly (CoreReviewOverviewEntry & { top: number })[]
  activeStart?: number
  busy: boolean
}>()
const emit = defineEmits<{ select: [start: number] }>()
const { t } = useI18n()
const margin = ref<HTMLElement>()
const heights = ref<number[]>([])
const positions = computed(() => {
  let bottom = -Infinity
  return props.comments.map((comment, index) => {
    const top = Math.max(comment.top, bottom)
    bottom = top + (heights.value[index] ?? 90) + 12
    return top
  })
})
const measure = (): void => {
  heights.value = Array.from(margin.value?.querySelectorAll('article') ?? [], node => node.getBoundingClientRect().height)
}
const observer = new ResizeObserver(measure)
const observe = async (): Promise<void> => {
  await nextTick()
  observer.disconnect()
  for (const card of margin.value?.querySelectorAll('article') ?? []) observer.observe(card)
  measure()
}
watch(() => props.comments, observe)
onMounted(observe)
onBeforeUnmount(() => observer.disconnect())
</script>

<style scoped>
.core-review-margin { grid-row: 1; grid-column: 2; position: relative; min-height: 0; overflow: auto; border-left: 1px solid var(--floatBorderColor); }
.core-margin-comment { position: absolute; left: 12px; right: 12px; padding: 10px 12px; border: 1px solid var(--floatBorderColor); border-radius: 4px; background: var(--sideBarBgColor); color: var(--editorColor); font-size: 13px; line-height: 1.5; }
.core-margin-comment.active { border-color: var(--themeColor); }
.core-margin-comment button { margin-top: 8px; padding: 0; border: 0; background: transparent; color: var(--themeColor); font: inherit; font-size: 12px; cursor: pointer; }
.core-margin-comment button:disabled { opacity: 0.4; cursor: default; }
</style>
