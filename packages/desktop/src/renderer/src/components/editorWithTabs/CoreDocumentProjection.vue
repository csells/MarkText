<template>
  <section
    class="core-document-projection"
    :class="{ 'core-comment-projection': kind === 'comment' }"
    :data-projection="kind"
    :aria-label="label"
    contenteditable="false"
    tabindex="0"
  >
    <div
      class="core-projection-content"
      :class="{ 'mu-container': kind !== 'comment' }"
      v-html="html"
    />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MarkdownAst } from '@marktext/document-core'

import { renderMarkdownProjectionToSafeHtml } from '@/documentConsumers/markdownProjectionHtml'

const props = defineProps<{
  projection: Readonly<{ ast: MarkdownAst }>
  kind: 'original' | 'revised' | 'comment'
  label: string
}>()
const html = computed(() => renderMarkdownProjectionToSafeHtml(props.projection))
</script>

<style scoped>
.core-document-projection {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
  user-select: text;
  color: inherit;
  font-family: inherit;
  line-height: inherit;
}

.core-projection-content :deep(pre) {
  overflow-x: auto;
  white-space: pre;
}

.core-projection-content :deep(img) {
  max-width: 100%;
}

.core-projection-content :deep(table) {
  border-collapse: collapse;
  max-width: 100%;
}

.core-projection-content :deep(th),
.core-projection-content :deep(td) {
  padding: 0.35em 0.65em;
  border: 1px solid var(--editorColor10, #8884);
}

.core-comment-projection {
  font-size: 0.9em;
  line-height: 1.5;
}

.core-comment-projection :deep(:first-child) {
  margin-top: 0;
}

.core-comment-projection :deep(:last-child) {
  margin-bottom: 0;
}
</style>
