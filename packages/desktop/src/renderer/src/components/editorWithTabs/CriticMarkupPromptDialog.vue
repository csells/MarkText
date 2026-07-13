<template>
  <el-dialog
    v-model="visible"
    :show-close="false"
    :close-on-click-modal="false"
    :title="title"
    class="ag-critic-markup-dialog"
    width="454px"
    @closed="handleClosed"
  >
    <el-input
      ref="input"
      v-model="value"
      type="textarea"
      :rows="3"
      :placeholder="placeholder"
      @keydown.meta.enter="confirm"
      @keydown.ctrl.enter="confirm"
    />
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="cancel">
          {{ t('common.cancel') }}
        </el-button>
        <el-button
          type="primary"
          :disabled="kind === 'comment' && !value"
          @click="confirm"
        >
          {{ t('common.ok') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CriticMarkupPromptKind } from '@shared/types/criticMarkup'

const { t } = useI18n()
const visible = ref(false)
const kind = ref<CriticMarkupPromptKind>('comment')
const value = ref('')
const input = ref<{ focus: () => void } | null>(null)
let resolveRequest: ((value: string | null) => void) | null = null

const title = computed(() => t(
  kind.value === 'comment'
    ? 'editor.criticMarkup.commentTitle'
    : 'editor.criticMarkup.replacementTitle'
))
const placeholder = computed(() => t(
  kind.value === 'comment'
    ? 'editor.criticMarkup.commentPlaceholder'
    : 'editor.criticMarkup.replacementPlaceholder'
))

const settle = (result: string | null): void => {
  const resolve = resolveRequest
  resolveRequest = null
  visible.value = false
  resolve?.(result)
}

const request = (nextKind: CriticMarkupPromptKind): Promise<string | null> => {
  if (resolveRequest) settle(null)
  kind.value = nextKind
  value.value = ''
  visible.value = true
  nextTick(() => input.value?.focus())
  return new Promise((resolve) => {
    resolveRequest = resolve
  })
}

const cancel = (): void => settle(null)
const confirm = (): void => {
  if (kind.value === 'comment' && !value.value) return
  settle(value.value)
}
const handleClosed = (): void => {
  if (resolveRequest) settle(null)
}

onBeforeUnmount(cancel)
defineExpose({ request, cancel })
</script>
