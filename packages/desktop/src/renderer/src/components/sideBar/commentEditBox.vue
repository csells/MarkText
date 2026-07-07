<template>
  <div class="edit-box" :class="boxClass">
    <el-input
      :model-value="modelValue"
      type="textarea"
      :autosize="{ minRows: 2, maxRows: 4 }"
      :placeholder="placeholder"
      @update:model-value="$emit('update:modelValue', $event)"
      @keydown.enter="onEnter"
      @keydown.esc.prevent.stop="$emit('cancel')"
    />
    <div class="edit-actions">
      <el-button
        size="small"
        :icon="Close"
        @click="$emit('cancel')"
      >
        {{ t('sideBar.comments.cancelEdit') }}
      </el-button>
      <el-button
        size="small"
        type="primary"
        :icon="Check"
        :disabled="!modelValue?.trim()"
        @click="$emit('save')"
      >
        {{ t('sideBar.comments.saveEdit') }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Check, Close } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps<{
  modelValue: string | undefined
  placeholder: string
  boxClass?: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'cancel'): void
  (event: 'save'): void
}>()

// Cmd/Ctrl+Enter submits; a plain Enter stays a newline in the textarea.
const onEnter = (event: KeyboardEvent): void => {
  if (event.metaKey || event.ctrlKey) {
    event.preventDefault()
    emit('save')
  }
}
</script>
