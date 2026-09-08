<template>
  <section
    class="core-document-projection"
    :class="{ 'core-comment-projection': kind === 'comment' }"
    :data-projection="kind"
    :aria-label="label"
    :aria-busy="pending"
    contenteditable="false"
    tabindex="0"
    @click="followProjectionLink"
  >
    <div
      class="core-projection-content"
      :class="{ 'mu-container': kind !== 'comment' }"
      v-html="html"
    />
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, useId, watch, type Ref } from 'vue'
import type { MarkdownAst } from '@marktext/document-core'
import type { Muya } from '@muyajs/core'

import {
  renderMarkdownProjectionToSafeHtml,
  presentMarkdownProjectionHtml
} from '@/documentConsumers/markdownProjectionHtml'
import { createLatestViewRefresh } from '@/documentConsumers/latestViewRefresh'

const props = defineProps<{
  projection: Readonly<{ ast: MarkdownAst }>
  kind: 'original' | 'revised' | 'comment'
  label: string
}>()
const muya = inject<Ref<Muya | null>>('core-projection-muya', ref(null))
const settings = inject<Ref<{ htmlEnabled?: boolean }>>('core-projection-settings', ref({}))
const followLink = inject<(href: string, root: HTMLElement) => void>('core-projection-follow-link')
const followProjectionLink = (event: MouseEvent): void => {
  const link = event.target instanceof Element ? event.target.closest('a') : null
  const href = link?.getAttribute('href')
  if (!href || !(event.currentTarget instanceof HTMLElement)) return
  event.preventDefault()
  followLink?.(href, event.currentTarget)
}
const footnotePrefix = `${useId()}-`
const sourceHtml = computed(() =>
  renderMarkdownProjectionToSafeHtml(props.projection, {
    footnotePrefix,
    htmlEnabled: settings.value.htmlEnabled
  })
)
const html = ref(sourceHtml.value)
const error = ref('')
const pending = ref(false)
const refresh = createLatestViewRefresh<string>({
  publish: (value) => {
    html.value = value
  },
  pending: (value) => {
    pending.value = value
  },
  fault: (failure) => {
    error.value = failure instanceof Error ? failure.message : String(failure)
    pending.value = false
  }
})
watch(
  [sourceHtml, settings],
  () => {
    refresh.invalidate()
    error.value = ''
    html.value = sourceHtml.value
    refresh.request(() => presentMarkdownProjectionHtml(sourceHtml.value, muya.value ?? undefined))
  },
  { immediate: true, flush: 'post' }
)
onBeforeUnmount(() => refresh.dispose())
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

.core-document-projection:focus-visible {
  outline: 2px solid var(--themeColor);
  outline-offset: -2px;
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
