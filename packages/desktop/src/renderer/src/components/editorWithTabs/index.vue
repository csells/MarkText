<template>
  <div
    class="editor-with-tabs"
    :style="{ 'max-width': `calc(100vw - ${effectiveSideBarWidth}px)` }"
  >
    <tabs v-show="showTabBar" />
    <div class="container">
      <editor
        :key="coreEditorGeneration"
        :markdown="coreProjectionMarkdown ?? markdown"
        :cursor="cursor"
        :muya-index-cursor="muyaIndexCursor"
        :text-direction="textDirection"
        :platform="platform"
        :core-lease="wysiwygCoreLease"
        :core-plain-text-view="corePlainTextView"
        :core-test-crash-worker="coreTestCrashWorker"
        :core-test-stale-next-transaction="coreTestStaleNextTransaction"
        @core-fault="handleCoreWysiwygFault"
      />
      <source-code
        v-if="coreSourceVisible && (!coreMode || activeCoreLease)"
        :key="coreSourceGeneration"
        :markdown="coreProjectionMarkdown ?? markdown"
        :muya-index-cursor="muyaIndexCursor"
        :text-direction="textDirection"
        :core-lease="activeCoreLease"
      />
      <div
        v-if="coreMode && coreViewState === 'reconciling'"
        class="core-view-handoff"
        aria-busy="true"
      />
    </div>
    <tab-notifications />
  </div>
</template>

<script setup lang="ts">
import { useLayoutStore } from '@/store/layout'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import {
  createCoreDocumentSessionManager,
  createEditorCoreBinding,
  createWorkerCorePort,
  canonicalCoreLineEnding,
  coordinateCoreDocumentRecovery,
  coreDocumentRecoveryAuthority,
  coreDocumentReloadAuthority,
  coreDocumentSaveAuthority,
  handoffCorePlainTextView,
  leaseCorePlainTextView,
  type CoreDocumentViewLease,
  type CoreWorkerTestControl
} from '@/documentAuthority'
import { teardownCoreDocumentSessions } from '@/documentAuthority/coreDocumentSessionTeardown'
import { retireClosedCoreDocumentSessions } from '@/documentAuthority/coreDocumentSessionRetirement'
import {
  handoffCoreDocumentView,
  type CoreDocumentViewState
} from '@/documentAuthority/coreDocumentViewHandoff'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { MuyaPlainTextViewResult } from '@/documentAuthority/muyaPlainTextView'
import Tabs from './tabs.vue'
import Editor from './editor.vue'
import SourceCode from './sourceCode.vue'
import TabNotifications from './notifications.vue'

const props = defineProps<{
  markdown: string
  // `cursor` originates as `IFileState.cursor` which is `unknown`
  // (see src/shared/types/files.ts); align here instead of forcing every
  // caller to widen.
  cursor: unknown
  muyaIndexCursor?: unknown
  sourceCode: boolean
  showTabBar: boolean
  textDirection: string
  platform: string
}>()

const { effectiveSideBarWidth } = storeToRefs(useLayoutStore())
const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()
const { currentFile } = storeToRefs(editorStore)
const coreMode = window.electron.process.env.PERF_TESTING === 'true' &&
  window.electron.process.env.MARKTEXT_DOCUMENT_CORE_MODE === '1'
const coreWorkerTestControls = new Map<string, CoreWorkerTestControl>()
const coreManager = coreMode
  ? createCoreDocumentSessionManager({
    createBinding: documentId => createEditorCoreBinding(createWorkerCorePort(
      undefined,
      {
        responseDelayMs: 250,
        registerTestControl: control => {
          coreWorkerTestControls.set(documentId, control)
        }
      }
    ))
  })
  : undefined
const openedCoreDocuments = new Set<string>()
const coreSaveRegistrations = new Map<string, () => void>()
const coreReloadRegistrations = new Map<string, () => void>()
const coreRecoveryRegistrations = new Map<string, () => void>()
const coreLease = shallowRef<CoreDocumentViewLease>()
const coreSourceGeneration = ref(0)
const coreEditorGeneration = ref(0)
const coreProjectionMarkdown = ref<string>()
const corePlainTextView = shallowRef<
  Extract<MuyaPlainTextViewResult, { kind: 'view' }>
>()
const coreViewState = ref<CoreDocumentViewState>(
  props.sourceCode ? 'source' : 'wysiwyg'
)
let coreTransition = Promise.resolve()
let coreOwnerDisposed = false

const activeCoreLease = computed(() =>
  coreViewState.value === 'source' &&
  coreLease.value?.documentId === currentFile.value?.id
    ? coreLease.value
    : undefined
)
const wysiwygCoreLease = computed(() =>
  coreViewState.value === 'wysiwyg' && corePlainTextView.value !== undefined &&
  coreLease.value?.documentId === currentFile.value?.id
    ? coreLease.value
    : undefined
)
const coreSourceVisible = computed(() =>
  props.sourceCode || (coreMode && coreViewState.value !== 'wysiwyg')
)
const coreTestCrashWorker = computed<(() => void) | undefined>(() => {
  const documentId = coreLease.value?.documentId
  if (!coreMode || documentId === undefined) return undefined
  return () => {
    const control = coreWorkerTestControls.get(documentId)
    if (control === undefined) throw new Error('Core Worker test control is unavailable')
    control.crash()
  }
})
const coreTestStaleNextTransaction = computed<(() => void) | undefined>(() => {
  const documentId = coreLease.value?.documentId
  if (!coreMode || documentId === undefined) return undefined
  return () => {
    const control = coreWorkerTestControls.get(documentId)
    if (control === undefined) throw new Error('Core Worker test control is unavailable')
    control.staleNextTransaction()
  }
})

const handleCoreWysiwygFault = (error: unknown): void => {
  const lease = coreLease.value
  if (lease === undefined) {
    console.error('Core WYSIWYG recovery has no active view lease', error)
    return
  }
  lease.faultView(error)
  const recovery = coreDocumentRecoveryAuthority.recover({
    documentId: lease.documentId,
    lease,
    error
  })
  if (recovery === undefined) {
    console.error('Core document recovery authority is unavailable', error)
    return
  }
  recovery.catch(recoveryError => {
    console.error('Core WYSIWYG recovery failed', recoveryError)
  })
  console.error('Core WYSIWYG operation requires reconciliation', error)
}

watch(
  [
    () => props.sourceCode,
    () => currentFile.value?.id,
    () => editorStore.tabs.map(tab => tab.id).join('\u0000')
  ],
  ([sourceMode]) => {
    if (!coreMode || coreManager === undefined) return
    const file = currentFile.value
    const target = file === null
      ? undefined
      : Object.freeze({
        id: file.id,
        source: file.markdown,
        lineEnding: canonicalCoreLineEnding(file.lineEnding)
      })
    const liveDocumentIds = new Set(editorStore.tabs.map(tab => tab.id))
    if (
      !sourceMode && target !== undefined &&
      coreLease.value?.documentId !== target.id
    ) {
      coreViewState.value = 'reconciling'
    }
    const nextTransition = coreTransition.then(async () => {
      if (coreOwnerDisposed) return
      const prior = coreLease.value
      if (!sourceMode && prior === undefined && target !== undefined) {
        if (!openedCoreDocuments.has(target.id)) {
          await coreManager.open({
            documentId: target.id,
            source: target.source,
            lineEnding: target.lineEnding
          })
          openedCoreDocuments.add(target.id)
        }
        const incoming = await leaseCorePlainTextView(coreManager, target.id)
        editorStore.REGISTER_CORE_SAVE_IDENTITY(
          target.id,
          incoming.lease.identity
        )
        coreLease.value = incoming.lease
        corePlainTextView.value = incoming.view
        coreProjectionMarkdown.value = incoming.view.markdown
        coreEditorGeneration.value += 1
        coreViewState.value = 'wysiwyg'
        return
      }
      if (
        !sourceMode && prior !== undefined &&
        target?.id !== prior.documentId
      ) {
        coreViewState.value = 'reconciling'
        await coreManager.handoff(prior)
        if (coreLease.value === prior) coreLease.value = undefined
        corePlainTextView.value = undefined
        coreProjectionMarkdown.value = undefined
        await retireClosedCoreDocumentSessions({
          manager: coreManager,
          openedDocumentIds: openedCoreDocuments,
          liveDocumentIds,
          registrations: coreSaveRegistrations
        })
        if (target === undefined) return
        if (!openedCoreDocuments.has(target.id)) {
          await coreManager.open({
            documentId: target.id,
            source: target.source,
            lineEnding: target.lineEnding
          })
          openedCoreDocuments.add(target.id)
        }
        const incoming = await leaseCorePlainTextView(coreManager, target.id)
        editorStore.REGISTER_CORE_SAVE_IDENTITY(
          target.id,
          incoming.lease.identity
        )
        coreLease.value = incoming.lease
        corePlainTextView.value = incoming.view
        coreProjectionMarkdown.value = incoming.view.markdown
        coreEditorGeneration.value += 1
        coreViewState.value = 'wysiwyg'
        return
      }
      if (
        prior !== undefined && !sourceMode &&
        coreViewState.value === 'source' && target?.id === prior.documentId
      ) {
        coreViewState.value = 'reconciling'
        try {
          const handoff = await handoffCorePlainTextView(coreManager, prior)
          editorStore.REGISTER_CORE_SAVE_IDENTITY(
            prior.documentId,
            handoff.lease.identity
          )
          coreLease.value = handoff.lease
          corePlainTextView.value = handoff.view
          coreProjectionMarkdown.value = handoff.view.markdown
          coreEditorGeneration.value += 1
          coreViewState.value = 'wysiwyg'
          return
        } catch (error) {
          coreViewState.value = 'source'
          throw error
        }
      }
      if (
        prior !== undefined && sourceMode &&
        coreViewState.value === 'wysiwyg' && target?.id === prior.documentId
      ) {
        coreViewState.value = 'reconciling'
        const snapshot = await coreManager.saveBarrier(prior.documentId)
        await coreManager.handoff(prior)
        coreLease.value = undefined
        corePlainTextView.value = undefined
        coreProjectionMarkdown.value = snapshot.source
        coreEditorGeneration.value += 1
      }
      if (
        prior !== undefined &&
        (!sourceMode || target?.id !== prior.documentId)
      ) {
        if (!sourceMode) {
          await handoffCoreDocumentView({
            manager: coreManager,
            lease: prior,
            reconcile: (documentId, source) => {
              editorStore.RECONCILE_CORE_SOURCE_AT_HANDOFF(documentId, source)
            },
            setState: state => { coreViewState.value = state }
          })
        } else {
          await coreManager.handoff(prior)
        }
        if (coreLease.value === prior) coreLease.value = undefined
      }
      if (!sourceMode) {
        coreProjectionMarkdown.value = undefined
        corePlainTextView.value = undefined
        for (const documentId of [...openedCoreDocuments]) {
          if (documentId !== prior?.documentId) {
            const snapshot = await coreManager.saveBarrier(documentId)
            editorStore.RECONCILE_CORE_SOURCE_AT_HANDOFF(
              documentId,
              snapshot.source
            )
          }
          await coreManager.close(documentId)
          openedCoreDocuments.delete(documentId)
          coreSaveRegistrations.get(documentId)?.()
          coreSaveRegistrations.delete(documentId)
          coreReloadRegistrations.get(documentId)?.()
          coreReloadRegistrations.delete(documentId)
          coreRecoveryRegistrations.get(documentId)?.()
          coreRecoveryRegistrations.delete(documentId)
          coreWorkerTestControls.delete(documentId)
        }
        return
      }
      await retireClosedCoreDocumentSessions({
        manager: coreManager,
        openedDocumentIds: openedCoreDocuments,
        liveDocumentIds,
        registrations: coreSaveRegistrations
      })
      for (const documentId of coreWorkerTestControls.keys()) {
        if (!liveDocumentIds.has(documentId)) {
          coreWorkerTestControls.delete(documentId)
        }
      }
      for (const [documentId, unregister] of coreReloadRegistrations) {
        if (liveDocumentIds.has(documentId)) continue
        unregister()
        coreReloadRegistrations.delete(documentId)
      }
      for (const [documentId, unregister] of coreRecoveryRegistrations) {
        if (liveDocumentIds.has(documentId)) continue
        unregister()
        coreRecoveryRegistrations.delete(documentId)
      }
      if (target === undefined) return
      if (!openedCoreDocuments.has(target.id)) {
        await coreManager.open({
          documentId: target.id,
          source: target.source,
          lineEnding: target.lineEnding
        })
        openedCoreDocuments.add(target.id)
      }
      await coreManager.activate(target.id)
      const incomingLease = coreManager.lease(target.id)
      editorStore.REGISTER_CORE_SAVE_IDENTITY(target.id, incomingLease.identity)
      coreLease.value = incomingLease
      corePlainTextView.value = undefined
      coreViewState.value = 'source'
    })
    if (target !== undefined && !coreSaveRegistrations.has(target.id)) {
      const unregister = coreDocumentSaveAuthority.register(target.id, async () => {
        await coreDocumentRecoveryAuthority.settled(target.id)
        await coreTransition
        return coreManager.saveBarrier(target.id)
      })
      coreSaveRegistrations.set(target.id, unregister)
    }
    if (target !== undefined && !coreReloadRegistrations.has(target.id)) {
      const unregister = coreDocumentReloadAuthority.register(target.id, input => {
        const replacement = coreTransition.then(async () => {
          if (coreOwnerDisposed) throw new Error('Core document owner is disposed')
          const activeLease = coreLease.value?.documentId === input.documentId
            ? coreLease.value
            : undefined
          const outgoingLease = activeLease ?? coreManager.lease(input.documentId)
          const incomingLease = await coreManager.replace(outgoingLease, input)
          if (activeLease === undefined) {
            await coreManager.handoff(incomingLease)
            return () => {}
          }
          await coreManager.activate(input.documentId)
          return () => {
            if (coreLease.value !== activeLease) {
              throw new Error('Core document view changed before reload publication')
            }
            editorStore.REGISTER_CORE_SAVE_IDENTITY(
              input.documentId,
              incomingLease.identity
            )
            coreLease.value = incomingLease
            coreSourceGeneration.value += 1
          }
        })
        coreTransition = replacement.then(() => {}).catch(() => {})
        return replacement
      })
      coreReloadRegistrations.set(target.id, unregister)
    }
    if (target !== undefined && !coreRecoveryRegistrations.has(target.id)) {
      const unregister = coreDocumentRecoveryAuthority.register(target.id, request => {
        const recoverWysiwyg = coreViewState.value === 'wysiwyg'
        const recovery = coreTransition.then(async () => {
          if (coreOwnerDisposed) throw new Error('Core document owner is disposed')
          await coordinateCoreDocumentRecovery({
            request,
            manager: coreManager,
            currentLease: () => coreLease.value,
            setRecovering: () => { coreViewState.value = 'reconciling' },
            reconcileSource: (documentId, source) => {
              editorStore.RECONCILE_CORE_SOURCE_AT_HANDOFF(documentId, source)
            },
            publishLease: async incomingLease => {
              editorStore.REGISTER_CORE_SAVE_IDENTITY(
                request.documentId,
                incomingLease.identity
              )
              if (recoverWysiwyg) {
                const projection = await coreManager.plainTextViewBarrier(
                  request.documentId
                )
                if (projection.view.kind !== 'view') {
                  throw new Error('Recovered Core document has no WYSIWYG view')
                }
                corePlainTextView.value = projection.view
                coreProjectionMarkdown.value = projection.view.markdown
                coreLease.value = incomingLease
                coreEditorGeneration.value += 1
                coreViewState.value = 'wysiwyg'
                return
              }
              coreLease.value = incomingLease
              coreSourceGeneration.value += 1
              coreViewState.value = 'source'
            }
          })
        })
        coreTransition = recovery.catch(error => {
          console.error('Core document recovery failed', error)
        })
        return recovery
      })
      coreRecoveryRegistrations.set(target.id, unregister)
    }
    coreTransition = nextTransition.catch(error => {
      if (
        target !== undefined &&
        !openedCoreDocuments.has(target.id)
      ) {
        coreSaveRegistrations.get(target.id)?.()
        coreSaveRegistrations.delete(target.id)
        coreReloadRegistrations.get(target.id)?.()
        coreReloadRegistrations.delete(target.id)
        coreRecoveryRegistrations.get(target.id)?.()
        coreRecoveryRegistrations.delete(target.id)
        coreWorkerTestControls.delete(target.id)
      }
      console.error('Core document session transition failed', error)
      if (!sourceMode) {
        coreViewState.value = 'source'
        preferencesStore.SET_MODE({ type: 'sourceCode', checked: true })
      }
    })
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  coreOwnerDisposed = true
  if (coreManager !== undefined) {
    teardownCoreDocumentSessions({
      manager: coreManager,
      transition: coreTransition,
      finalLease: () => coreLease.value,
      clearFinalLease: () => { coreLease.value = undefined },
      documentIds: openedCoreDocuments
    }).catch(error => {
      console.error('Core document teardown failed', error)
    }).finally(() => {
      for (const unregister of coreSaveRegistrations.values()) unregister()
      coreSaveRegistrations.clear()
      for (const unregister of coreReloadRegistrations.values()) unregister()
      coreReloadRegistrations.clear()
      for (const unregister of coreRecoveryRegistrations.values()) unregister()
      coreRecoveryRegistrations.clear()
      coreWorkerTestControls.clear()
      openedCoreDocuments.clear()
    })
  }
})
</script>

<style scoped>
.editor-with-tabs {
  position: relative;
  height: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;

  overflow: hidden;
  background: var(--editorBgColor);
  & > .container {
    position: relative;
    flex: 1;
    overflow: hidden;
  }
}

.core-view-handoff {
  position: absolute;
  z-index: 1000;
  inset: 0;
  background: var(--editorBgColor);
  pointer-events: all;
}
</style>
