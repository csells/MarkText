<template>
  <form
    v-if="modelValue"
    class="core-comment-editor"
    data-testid="critic-review-comment-editor"
    :aria-label="label"
    :aria-busy="submitting"
    @submit.prevent="submit"
  >
    <label class="core-comment-label">
      <span>{{ label }}</span>
      <textarea
        ref="input"
        v-model="draft"
        data-testid="critic-review-comment-input"
        rows="6"
        :disabled="submitting"
        :aria-invalid="Boolean(error)"
        spellcheck="true"
        @keydown="onKeydown"
      />
    </label>
    <p
      v-if="targetChanged"
      class="core-comment-error"
      role="alert"
    >
      {{ targetChangedLabel }}
    </p>
    <p
      v-if="error"
      class="core-comment-error"
      role="alert"
    >
      {{ error }}
    </p>
    <div class="core-comment-actions">
      <button
        type="button"
        data-testid="critic-review-comment-cancel"
        :disabled="submitting"
        @click="cancel"
      >
        {{ cancelLabel }}
      </button>
      <button
        type="submit"
        data-testid="critic-review-comment-submit"
        :disabled="submitting || targetChanged"
      >
        {{ submitLabel }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: boolean
  targetId: string
  defaultText?: string
  submitting?: boolean
  error?: string
  label?: string
  submitLabel?: string
  cancelLabel?: string
  targetChangedLabel?: string
}>(), {
  defaultText: '',
  submitting: false,
  error: '',
  label: 'Comment',
  submitLabel: 'Save comment',
  cancelLabel: 'Cancel',
  targetChangedLabel: 'The review selection changed. Your draft is preserved. Cancel it before starting another comment.'
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [draft: { targetId: string, text: string }]
  cancel: [draft: { targetId: string, text: string }]
}>()
const input = ref<HTMLTextAreaElement>()
const draft = ref('')
const target = ref(props.targetId)
const targetChanged = ref(false)

watch(() => props.modelValue, async (open) => {
  if (!open) return
  target.value = props.targetId
  draft.value = props.defaultText
  targetChanged.value = false
  await nextTick()
  input.value?.focus()
}, { immediate: true })

watch(() => props.targetId, value => {
  if (props.modelValue && value !== target.value) targetChanged.value = true
})

const submit = (): void => {
  if (props.submitting || targetChanged.value || props.targetId !== target.value) return
  emit('submit', { targetId: target.value, text: draft.value })
}
const cancel = (): void => {
  if (props.submitting) return
  emit('cancel', { targetId: target.value, text: draft.value })
  emit('update:modelValue', false)
}
const onKeydown = (event: KeyboardEvent): void => {
  if (event.isComposing) return
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    event.stopPropagation()
    submit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancel()
  }
}
</script>

<style scoped>
.core-comment-editor {
  display: grid;
  gap: 12px;
  width: 100%;
  min-width: 0;
  padding: 12px;
  box-sizing: border-box;
  border: 1px solid var(--floatBorderColor);
  border-radius: 6px;
  background: var(--floatBgColor);
  color: var(--editorColor);
  font: inherit;
}

.core-comment-label {
  display: grid;
  gap: 8px;
}

textarea {
  width: 100%;
  min-height: 7em;
  box-sizing: border-box;
  resize: vertical;
  padding: 8px;
  border: 1px solid var(--floatBorderColor);
  border-radius: 4px;
  background: var(--editorBgColor);
  color: inherit;
  font: inherit;
  line-height: 1.5;
}

.core-comment-error {
  margin: 0;
  font-size: 0.9em;
}

.core-comment-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

button {
  padding: 5px 10px;
  border: 1px solid var(--floatBorderColor);
  border-radius: 4px;
  background: var(--buttonBgColor);
  color: inherit;
  font: inherit;
  cursor: pointer;
}

button:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
