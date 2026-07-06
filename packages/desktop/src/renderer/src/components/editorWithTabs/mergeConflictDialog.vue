<template>
  <el-dialog
    v-model="visible"
    class="merge-conflict-dialog"
    :title="dialogTitle"
    :modal="true"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    width="92vw"
    @closed="handleClosed"
  >
    <div
      v-if="mergeConflict"
      class="merge-conflict"
    >
      <p
        class="merge-summary"
        :title="mergeConflict.pathname"
      >
        {{ t('editor.mergeConflict.summary') }}
      </p>
      <p
        v-if="validationError"
        class="merge-validation-error"
      >
        {{ validationError }}
      </p>
      <div class="merge-grid">
        <section class="merge-pane">
          <h3>{{ t('editor.mergeConflict.local') }}</h3>
          <div
            ref="localEditorEl"
            class="merge-editor"
          />
        </section>
        <section class="merge-pane">
          <h3>{{ t('editor.mergeConflict.remote') }}</h3>
          <div
            ref="remoteEditorEl"
            class="merge-editor"
          />
        </section>
        <section class="merge-pane result-pane">
          <h3>{{ t('editor.mergeConflict.result') }}</h3>
          <div
            ref="resultEditorEl"
            class="merge-editor"
          />
        </section>
      </div>
      <div
        v-if="mergeConflict.conflicts.length"
        class="conflict-list"
      >
        <div
          v-for="conflict in mergeConflict.conflicts"
          :key="conflict.id"
          class="conflict-row"
        >
          <span>
            {{
              t('editor.mergeConflict.conflictLabel', {
                id: conflict.id,
                start: conflict.baseStartLine,
                end: conflict.baseEndLine
              })
            }}
          </span>
          <div class="conflict-actions">
            <el-button
              size="small"
              @click="resolveConflict(conflict.id, 'local')"
            >
              {{ t('editor.mergeConflict.useLocal') }}
            </el-button>
            <el-button
              size="small"
              @click="resolveConflict(conflict.id, 'remote')"
            >
              {{ t('editor.mergeConflict.useRemote') }}
            </el-button>
            <el-button
              size="small"
              @click="resolveConflict(conflict.id, 'both')"
            >
              {{ t('editor.mergeConflict.useBoth') }}
            </el-button>
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="cancel">
          {{ t('editor.mergeConflict.keepEditing') }}
        </el-button>
        <el-button @click="reloadDisk">
          {{ t('editor.mergeConflict.reloadDisk') }}
        </el-button>
        <el-button
          type="primary"
          @click="acceptMerge"
        >
          {{ t('editor.mergeConflict.acceptMerge') }}
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import codeMirror from '../../codeMirror'
import { codeMirrorThemeFor } from '@/config'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { t } from '../../i18n'

type CMInstance = any
type ConflictChoice = 'local' | 'remote' | 'both'

const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()
const { mergeConflict } = storeToRefs(editorStore)
const { theme } = storeToRefs(preferencesStore)

const localEditorEl = ref<HTMLDivElement | null>(null)
const remoteEditorEl = ref<HTMLDivElement | null>(null)
const resultEditorEl = ref<HTMLDivElement | null>(null)
const localEditor = ref<CMInstance | null>(null)
const remoteEditor = ref<CMInstance | null>(null)
const resultEditor = ref<CMInstance | null>(null)
const closingByAction = ref(false)

const visible = computed({
  get: () => !!mergeConflict.value,
  set: (value: boolean) => {
    if (!value && !closingByAction.value) {
      editorStore.CANCEL_DIRTY_EXTERNAL_MERGE_CONFLICT()
    }
  }
})

const validationError = computed(() => mergeConflict.value?.validationError ?? '')

// The dialog is a global modal that can open for a background tab, so the
// header must identify the file being resolved.
const dialogTitle = computed(() => {
  const filename = mergeConflict.value?.filename
  const title = t('editor.mergeConflict.title')
  return filename ? `${title} \u2014 ${filename}` : title
})

const destroyEditor = (editor: CMInstance | null): void => {
  const wrapper = editor?.getWrapperElement?.()
  wrapper?.remove()
}

const destroyEditors = (): void => {
  destroyEditor(localEditor.value)
  destroyEditor(remoteEditor.value)
  destroyEditor(resultEditor.value)
  localEditor.value = null
  remoteEditor.value = null
  resultEditor.value = null
}

const createEditor = (parent: HTMLDivElement, value: string, readOnly: boolean): CMInstance =>
  codeMirror(parent, {
    value,
    mode: 'markdown-comments',
    theme: codeMirrorThemeFor(theme.value),
    lineNumbers: true,
    lineWrapping: true,
    // Default viewport virtualization stays on: the whole-file escalation
    // path exists precisely for documents too large to merge cell-by-cell,
    // and three unvirtualized panes of such a file would freeze the renderer.
    readOnly
  })

const mountEditors = async (): Promise<void> => {
  const conflict = mergeConflict.value
  if (!conflict) {
    destroyEditors()
    return
  }

  await nextTick()
  if (!localEditorEl.value || !remoteEditorEl.value || !resultEditorEl.value) return

  destroyEditors()
  localEditor.value = createEditor(localEditorEl.value, conflict.localMarkdown, true)
  remoteEditor.value = createEditor(remoteEditorEl.value, conflict.remoteMarkdown, true)
  resultEditor.value = createEditor(resultEditorEl.value, conflict.resultMarkdown, false)
}

watch(
  () => mergeConflict.value?.session,
  () => {
    mountEditors().catch((err) => {
      console.error('Failed to mount merge conflict editors:', err)
    })
  }
)

watch(theme, () => {
  const nextTheme = codeMirrorThemeFor(theme.value)
  localEditor.value?.setOption('theme', nextTheme)
  remoteEditor.value?.setOption('theme', nextTheme)
  resultEditor.value?.setOption('theme', nextTheme)
})

const syncResultToStore = (): void => {
  if (mergeConflict.value && resultEditor.value) {
    mergeConflict.value.resultMarkdown = resultEditor.value.getValue()
  }
}

const resolveConflict = (id: string, choice: ConflictChoice): void => {
  syncResultToStore()
  editorStore.RESOLVE_MERGE_CONFLICT_MARKER(id, choice)
  resultEditor.value?.setValue(mergeConflict.value?.resultMarkdown ?? '')
}

const cancel = (): void => {
  closingByAction.value = true
  editorStore.CANCEL_DIRTY_EXTERNAL_MERGE_CONFLICT()
  destroyEditors()
  nextTick(() => {
    closingByAction.value = false
  })
}

const reloadDisk = (): void => {
  closingByAction.value = true
  editorStore.RELOAD_DISK_FROM_MERGE_CONFLICT()
  destroyEditors()
  nextTick(() => {
    closingByAction.value = false
  })
}

const acceptMerge = (): void => {
  closingByAction.value = true
  const resultMarkdown = resultEditor.value?.getValue() ?? mergeConflict.value?.resultMarkdown ?? ''
  editorStore.ACCEPT_DIRTY_EXTERNAL_MERGE_CONFLICT(
    resultMarkdown
  )
  if (mergeConflict.value) {
    resultEditor.value?.setValue(mergeConflict.value.resultMarkdown ?? resultMarkdown)
    closingByAction.value = false
    return
  }

  destroyEditors()
  nextTick(() => {
    closingByAction.value = false
  })
}

const handleClosed = (): void => {
  destroyEditors()
}

onBeforeUnmount(() => {
  destroyEditors()
})
</script>

<style scoped>
.merge-conflict-dialog {
  :deep(.el-dialog__body) {
    padding-top: 8px;
  }
}

.merge-conflict {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.merge-summary {
  margin: 0;
  color: var(--editorColor);
  font-size: 13px;
}

.merge-validation-error {
  margin: 0;
  padding: 8px 10px;
  /* Amber warning accent, readable on light and dark dialog surfaces. */
  border: 1px solid #d97706;
  color: #d97706;
  font-size: 13px;
}

.merge-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  min-height: 46vh;
}

.merge-pane {
  min-width: 0;
  border: 1px solid var(--floatBorderColor);
  background: var(--editorBgColor);
}

.merge-pane h3 {
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--floatBorderColor);
}

.merge-editor {
  height: 46vh;
}

.merge-editor :deep(.CodeMirror) {
  height: 100%;
  font-size: 12px;
}

.conflict-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 120px;
  overflow: auto;
}

.conflict-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--floatBorderColor);
  font-size: 12px;
}

.conflict-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

@media (max-width: 960px) {
  .merge-grid {
    grid-template-columns: 1fr;
  }
}
</style>
