<template>
  <div
    v-show="visible"
    class="image-viewer"
    role="dialog"
    aria-modal="true"
    :aria-label="t('editor.imageViewer.label')"
    @keydown.esc.stop.prevent="requestClose"
    @keydown.tab.prevent="focusClose"
  >
    <button
      ref="closeButton"
      type="button"
      class="icon-close"
      :aria-label="t('common.close')"
      @click="requestClose"
    >
      <CloseIcon aria-hidden="true" />
    </button>
    <div
      ref="content"
      class="image-viewer-content"
    />
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Close as CloseIcon } from '@element-plus/icons-vue'

const props = defineProps<{
  visible: boolean
}>()
const emit = defineEmits<{
  close: []
  restoreFocus: []
}>()
const { t } = useI18n()
const closeButton = ref<HTMLButtonElement | null>(null)
const content = ref<HTMLDivElement | null>(null)
let opener: HTMLElement | null = null

const focusClose = (): void => {
  closeButton.value?.focus()
}

const requestClose = (): void => {
  emit('close')
}

watch(
  () => props.visible,
  (visible, wasVisible) => {
    if (visible) {
      opener = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
      nextTick(focusClose)
      return
    }
    if (!wasVisible) return

    const target = opener
    opener = null
    nextTick(() => {
      if (target?.isConnected) {
        target.focus()
      } else {
        emit('restoreFocus')
      }
    })
  }
)

defineExpose({
  getContainer: (): HTMLDivElement | null => content.value
})
</script>
