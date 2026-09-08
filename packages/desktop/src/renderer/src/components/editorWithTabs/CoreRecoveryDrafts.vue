<template>
  <section
    v-if="drafts.length || error"
    class="core-recovery-drafts"
    :aria-label="t('editor.coreRecovery.title')"
  >
    <p
      v-if="error"
      role="alert"
    >
      {{ t('editor.coreRecovery.backupError', { error }) }}
      <button
        v-if="pendingText !== undefined"
        type="button"
        class="button small"
        @click="$emit('retry')"
      >
        {{ t('editor.coreRecovery.retry') }}
      </button>
    </p>
    <textarea
      v-if="pendingText !== undefined"
      :value="pendingText"
      :dir="textDirection"
      readonly
      :aria-label="t('editor.coreRecovery.draftText')"
    />
    <details
      v-for="draft in drafts"
      :key="draft.id"
      open
      data-testid="core-recovery-draft"
    >
      <summary>
        {{ t('editor.coreRecovery.draft', { name: draft.pathname || draft.documentId }) }}
      </summary>
      <p
        v-if="draft.readError"
        role="alert"
      >
        {{ t('editor.coreRecovery.unreadable', { error: draft.readError }) }}
      </p>
      <p v-else>
        {{ t('editor.coreRecovery.explanation') }}
      </p>
      <textarea
        v-if="!draft.readError"
        :value="draft.visibleText"
        :dir="textDirection"
        readonly
        :aria-label="t('editor.coreRecovery.draftText')"
      />
      <div>
        <button
          type="button"
          class="button small"
          @click="$emit('reveal', draft.artifactPath)"
        >
          {{ t('editor.coreRecovery.showBackup') }}
        </button>
        <button
          type="button"
          class="button small"
          @click="$emit('archive', draft.id)"
        >
          {{ t('editor.coreRecovery.resolved') }}
        </button>
      </div>
    </details>
  </section>
</template>

<script setup lang="ts">
import type { CoreRecoveryDraftRecord } from '@shared/types/coreRecoveryDraft'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
defineProps<{
  drafts: readonly CoreRecoveryDraftRecord[]
  error: string
  pendingText?: string
  textDirection: string
}>()
defineEmits<{
  (event: 'archive', id: string): void
  (event: 'reveal', path: string): void
  (event: 'retry'): void
}>()
</script>

<style scoped>
.core-recovery-drafts {
  position: relative;
  z-index: 5;
  max-height: 45vh;
  overflow: auto;
  padding: 12px 18px;
  background: var(--notificationWarningBg);
  color: var(--notificationWarningColor);
  font-size: 13px;
}
details + details {
  margin-top: 12px;
}
summary {
  cursor: pointer;
  font-weight: 600;
}
p {
  margin: 8px 0;
}
textarea {
  display: block;
  width: 100%;
  min-height: 80px;
  max-height: 160px;
  resize: vertical;
  user-select: text;
}
button {
  margin: 8px 12px 0 0;
  cursor: pointer;
}
</style>
