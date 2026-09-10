<template>
  <div
    class="editor-with-tabs"
    :style="{ 'max-width': `calc(100vw - ${effectiveSideBarWidth}px)` }"
  >
    <tabs v-show="showTabBar" />
    <CoreDraftRecoveryPanel
      :drafts="coreRecoveryDrafts"
      :error="coreDraftBackupError"
      :pending-text="coreUnbackedDraft?.visibleText"
      :text-direction="textDirection"
      @archive="archiveCoreRecoveryDraft"
      @reveal="revealCoreRecoveryDraft"
      @retry="retryCoreDraftBackup"
    />
    <div class="container">
      <editor
        v-if="!coreCloseInputsRetired"
        ref="coreEditor"
        :key="coreEditorGeneration"
        :markdown="coreProjectionMarkdown ?? markdown"
        :cursor="cursor"
        :muya-index-cursor="muyaIndexCursor"
        :text-direction="textDirection"
        :platform="platform"
        :core-required="coreMode"
        :core-lease="wysiwygCoreLease"
        :core-plain-text-view="corePlainTextView"
        :core-performance-trace="corePerformanceTrace"
        :core-test-crash-worker="coreTestCrashWorker"
        :core-test-stale-next-transaction="coreTestStaleNextTransaction"
        @core-fault="handleCoreViewFault"
      />
      <source-code
        v-if="!coreCloseInputsRetired && coreSourceVisible && (!coreMode || activeCoreLease)"
        ref="coreSourceEditor"
        :key="coreSourceGeneration"
        :markdown="coreProjectionMarkdown ?? markdown"
        :muya-index-cursor="muyaIndexCursor"
        :text-direction="textDirection"
        :core-lease="activeCoreLease"
        :core-performance-trace="corePerformanceTrace"
        :initial-view-state="coreSourceViewState"
        @core-fault="handleCoreViewFault"
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
import { coreMarkdownOptionsFromPreferences } from '@/documentAuthority/coreMarkdownPreferences'
import { useLayoutStore } from '@/store/layout'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import {
  createCoreDocumentSessionManager,
  createEditorCoreBinding,
  createLocalCoreOwner,
  canonicalCoreLineEnding,
  coordinateCoreDocumentRecovery,
  coreDocumentRecoveryAuthority,
  coreDocumentReloadAuthority,
  coreDocumentSaveAuthority,
  createCoreAuthorityPerformanceTrace,
  measureCoreDocumentOpen,
  resolveCoreDocumentLaunchPolicy,
  handoffCorePlainTextView,
  leaseCorePlainTextView,
  type CoreDocumentViewLease,
  type CoreAuthorityPerformanceTrace,
  type CoreModelTestControl
} from '@/documentAuthority'
import {
  createCoreTeardownDraftPreserver,
  teardownCoreDocumentSessions
} from '@/documentAuthority/coreDocumentSessionTeardown'
import { retireClosedCoreDocumentSessions } from '@/documentAuthority/coreDocumentSessionRetirement'
import {
  handoffCoreDocumentView,
  type CoreDocumentViewState
} from '@/documentAuthority/coreDocumentViewHandoff'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type {
  CoreRecoveryDraftInput,
  CoreRecoveryDraftRecord
} from '@shared/types/coreRecoveryDraft'
import type { MuyaPlainTextViewResult } from '@/documentAuthority/muyaPlainTextView'
import type { CodeMirrorViewState } from '@/documentAuthority/codeMirrorViewState'
import Tabs from './tabs.vue'
import Editor from './editor.vue'
import SourceCode from './sourceCode.vue'
import TabNotifications from './notifications.vue'
import CoreDraftRecoveryPanel from './CoreRecoveryDrafts.vue'

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
const coreMarkdownOptions = computed(() => coreMarkdownOptionsFromPreferences(preferencesStore))
const { currentFile } = storeToRefs(editorStore)
const coreLaunchPolicy = resolveCoreDocumentLaunchPolicy(window.electron.process.env)
const coreMode = coreLaunchPolicy.coreEnabled
interface CoreModelOwnerRegistration {
  control?: CoreModelTestControl
}
const coreModelOwners = new Map<string, CoreModelOwnerRegistration>()
const coreManager = coreMode
  ? createCoreDocumentSessionManager({
    createBinding: (documentId) => {
      const owner: CoreModelOwnerRegistration = {}
      coreModelOwners.set(documentId, owner)
      return createEditorCoreBinding(
        createLocalCoreOwner({
          onFailure: (error) => handleCoreModelFailure(documentId, owner, error),
          ...(coreLaunchPolicy.testControlsEnabled
            ? {
                registerTestControl: (control: CoreModelTestControl) => {
                  owner.control = control
                }
              }
            : {})
        })
      )
    }
  })
  : undefined
const openedCoreDocuments = new Set<string>()
const coreSaveRegistrations = new Map<string, () => void>()
const coreReloadRegistrations = new Map<string, () => void>()
const coreRecoveryRegistrations = new Map<string, () => void>()
const coreEditor = ref<InstanceType<typeof Editor>>()
const coreSourceEditor = ref<InstanceType<typeof SourceCode>>()
const coreSourceViewState = shallowRef<CodeMirrorViewState>()
const coreCloseInputsRetired = ref(false)
const coreClosePending = ref(false)
const coreRecoveryDrafts = shallowRef<readonly CoreRecoveryDraftRecord[]>([])
const coreDraftBackupError = ref('')
const coreUnbackedDraft = shallowRef<CoreRecoveryDraftInput>()
let coreDraftFaultLease: CoreDocumentViewLease | undefined
const preservedCoreDrafts = new WeakSet<CoreRecoveryDraftInput>()
let coreDraftFault: unknown
const revealCoreRecoveryDraft = (path: string): void => window.electron.shell.showItemInFolder(path)
const archiveCoreRecoveryDraft = async (id: string): Promise<void> => {
  await window.electron.ipcRenderer.invoke('mt::core-draft::archive', id)
  coreRecoveryDrafts.value = coreRecoveryDrafts.value.filter((draft) => draft.id !== id)
}
const preventUnbackedDraftClose = (event: BeforeUnloadEvent): void => {
  if (coreUnbackedDraft.value === undefined) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(async () => {
  window.addEventListener('beforeunload', preventUnbackedDraftClose)
  try {
    const retained = await window.electron.ipcRenderer.invoke('mt::core-draft::list')
    coreRecoveryDrafts.value = [
      ...new Map(
        [...retained, ...coreRecoveryDrafts.value].map((draft) => [draft.id, draft])
      ).values()
    ]
  } catch (error) {
    coreDraftBackupError.value = error instanceof Error ? error.message : String(error)
  }
})
onBeforeUnmount(() => window.removeEventListener('beforeunload', preventUnbackedDraftClose))
const coreLease = shallowRef<CoreDocumentViewLease>()
const coreSourceGeneration = ref(0)
const coreEditorGeneration = ref(0)
const coreProjectionMarkdown = ref<string>()
const corePlainTextView = shallowRef<Extract<MuyaPlainTextViewResult, { kind: 'view' }>>()
const corePerformanceTrace: CoreAuthorityPerformanceTrace | undefined =
  coreMode && window.electron.process.env.PERF_TESTING === 'true'
    ? createCoreAuthorityPerformanceTrace()
    : undefined
const coreViewState = ref<CoreDocumentViewState>(props.sourceCode ? 'source' : 'wysiwyg')
let coreTransition = Promise.resolve()
let coreOwnerDisposed = false

const activeCoreLease = computed(() =>
  coreViewState.value === 'source' && coreLease.value?.documentId === currentFile.value?.id
    ? coreLease.value
    : undefined
)
const wysiwygCoreLease = computed(() =>
  coreViewState.value === 'wysiwyg' &&
  corePlainTextView.value !== undefined &&
  coreLease.value?.documentId === currentFile.value?.id
    ? coreLease.value
    : undefined
)
const coreSourceVisible = computed(
  () => props.sourceCode || (coreMode && coreViewState.value !== 'wysiwyg')
)
const coreTestCrashWorker = computed<(() => void) | undefined>(() => {
  const documentId = coreLease.value?.documentId
  if (!coreLaunchPolicy.testControlsEnabled || documentId === undefined) return undefined
  return () => {
    const control = coreModelOwners.get(documentId)?.control
    if (control === undefined) throw new Error('Core model test control is unavailable')
    control.crash()
  }
})
const coreTestStaleNextTransaction = computed<(() => void) | undefined>(() => {
  const documentId = coreLease.value?.documentId
  if (!coreLaunchPolicy.testControlsEnabled || documentId === undefined) return undefined
  return () => {
    const control = coreModelOwners.get(documentId)?.control
    if (control === undefined) throw new Error('Core model test control is unavailable')
    control.staleNextTransaction()
  }
})

const preserveCoreRecoveryDraft = (
  draft: CoreRecoveryDraftInput,
  lease: CoreDocumentViewLease
): void => {
  if (preservedCoreDrafts.has(draft)) return
  coreUnbackedDraft.value = draft
  coreDraftFaultLease = lease
  const result = window.electron.ipcRenderer.sendSync('mt::core-draft::preserve', draft)
  if (!result.ok) throw new Error(result.message)
  preservedCoreDrafts.add(draft)
  coreRecoveryDrafts.value = [...coreRecoveryDrafts.value, result.record]
}

const handleCoreViewFault = (error: unknown): void => {
  const lease = coreDraftFaultLease ?? coreLease.value
  if (lease === undefined) {
    console.error('Core WYSIWYG recovery has no active view lease', error)
    return
  }
  if (coreDocumentRecoveryAuthority.settled(lease.documentId) !== undefined) return
  coreDraftFault = error
  try {
    const draft = coreUnbackedDraft.value ?? lease.captureRecoveryDraft(error)
    if (draft !== undefined) preserveCoreRecoveryDraft(draft, lease)
    coreUnbackedDraft.value = undefined
    coreDraftFaultLease = undefined
    coreDraftBackupError.value = ''
  } catch (backupError) {
    coreDraftBackupError.value =
      backupError instanceof Error ? backupError.message : String(backupError)
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
  recovery.catch((recoveryError) => {
    console.error('Core WYSIWYG recovery failed', recoveryError)
  })
  console.error('Core WYSIWYG operation requires reconciliation', error)
}
// Model failure belongs to its document even between native actions.
// Registration identity fences owners retired by recovery or replacement.
const handleCoreModelFailure = (
  documentId: string,
  owner: CoreModelOwnerRegistration,
  error: Error
): void => {
  const current = () =>
    !coreOwnerDisposed &&
    openedCoreDocuments.has(documentId) &&
    coreModelOwners.get(documentId) === owner
  if (!current()) return
  if (coreLease.value?.documentId === documentId) {
    handleCoreViewFault(error)
    return
  }
  const recovery = coreTransition.then(async () => {
    if (!current()) return
    if (coreLease.value?.documentId === documentId) {
      handleCoreViewFault(error)
      return
    }
    if (coreManager === undefined) return
    const lease = coreManager.lease(documentId)
    lease.faultView(error)
    const replacement = await coreManager.recover(lease)
    const snapshot = await coreManager.saveBarrier(documentId)
    editorStore.RECONCILE_CORE_SOURCE_AT_HANDOFF(documentId, snapshot.source)
    editorStore.REGISTER_CORE_SAVE_IDENTITY(documentId, replacement.identity)
    await coreManager.handoff(replacement)
  })
  coreTransition = recovery.catch((recoveryError) => {
    console.error('Inactive Core document recovery failed', recoveryError)
  })
}

const retryCoreDraftBackup = (): void => handleCoreViewFault(coreDraftFault)

const prepareCoreReplacementView = async (
  lease: CoreDocumentViewLease,
  surface: 'source' | 'wysiwyg'
): Promise<() => void> => {
  const sourceViewState =
    surface === 'source' ? coreSourceEditor.value?.captureViewState() : undefined
  const projection =
    surface === 'wysiwyg'
      ? await lease.projectAcknowledgedPlainTextView(lease.identity.revision)
      : undefined
  const view = projection?.view
  if (view !== undefined && view.kind !== 'view') {
    throw new Error('Core replacement has no WYSIWYG view')
  }
  const source = view?.markdown ?? (await lease.sourceAtBarrier())
  return () => {
    // A replacement lease and its initial text must come from the same revision.
    // Reusing the outgoing Source snapshot can make the next edit address old bytes.
    editorStore.REGISTER_CORE_SAVE_IDENTITY(lease.documentId, lease.identity)
    coreProjectionMarkdown.value = source
    corePlainTextView.value = view
    coreSourceViewState.value = sourceViewState
    coreLease.value = lease
    if (surface === 'wysiwyg') coreEditorGeneration.value += 1
    else coreSourceGeneration.value += 1
    coreViewState.value = surface
  }
}

watch(coreMarkdownOptions, (options) => {
  if (!coreManager || coreClosePending.value) return
  const change = coreTransition.then(async () => {
    if (coreOwnerDisposed) return
    await nextTick()
    for (const documentId of openedCoreDocuments) {
      if (coreLease.value?.documentId === documentId) {
        const view = coreViewState.value === 'source' ? coreSourceEditor.value : coreEditor.value
        if (!view) throw new Error('Core preference view is unavailable')
        await view.configureCorePreferences(options)
      } else {
        // Inactive tabs have no native input owner, but retain their actor and
        // undo history. Their next view consumes the configured projection.
        const lease = coreManager.lease(documentId)
        try {
          const outcome = await lease.binding.submit({
            kind: 'configure',
            options,
            projections: []
          }).acknowledged
          if (outcome.type !== 'applied') throw new Error('Core preferences were rejected')
          editorStore.REGISTER_CORE_SAVE_IDENTITY(documentId, lease.identity)
        } finally {
          await coreManager.handoff(lease)
        }
      }
    }
  })
  coreTransition = change.catch((error) => handleCoreViewFault(error))
  // Saved-state refresh crosses the owner transition barrier; never await it
  // from inside that same transition.
  change
    .then(async () => {
      for (const documentId of openedCoreDocuments) {
        const snapshot = await coreManager.saveBarrier(documentId)
        await editorStore.REFRESH_CORE_SAVED_STATE(documentId, snapshot.identity)
      }
    })
    .catch((error) => handleCoreViewFault(error))
})

watch(
  [
    () => props.sourceCode,
    () => currentFile.value?.id,
    () => editorStore.tabs.map((tab) => tab.id).join('\u0000'),
    () => coreClosePending.value
  ],
  ([sourceMode, documentId, tabIds], previous) => {
    if (!coreMode || coreManager === undefined || coreClosePending.value) return
    // A refused close retained its original live view. Do not acquire a
    // second lease just because close admission reopened.
    if (
      previous[3] === true &&
      previous[0] === sourceMode &&
      previous[1] === documentId &&
      previous[2] === tabIds &&
      coreLease.value !== undefined
    ) { return }
    const file = currentFile.value
    const target =
      file === null
        ? undefined
        : Object.freeze({
          id: file.id,
          source: file.markdown,
          lineEnding: canonicalCoreLineEnding(file.lineEnding)
        })
    const liveDocumentIds = new Set(editorStore.tabs.map((tab) => tab.id))
    if (!sourceMode && target !== undefined && coreLease.value?.documentId !== target.id) {
      coreViewState.value = 'reconciling'
    }
    const nextTransition = coreTransition.then(async () => {
      if (coreOwnerDisposed) return
      const prior = coreLease.value
      if (prior !== undefined) coreSourceViewState.value = undefined
      if (!sourceMode && prior === undefined && target !== undefined) {
        if (!openedCoreDocuments.has(target.id)) {
          await measureCoreDocumentOpen(corePerformanceTrace, target.id, () =>
            coreManager.open({
              documentId: target.id,
              source: target.source,
              options: coreMarkdownOptions.value,
              lineEnding: target.lineEnding
            })
          )
          openedCoreDocuments.add(target.id)
        }
        const incoming = await leaseCorePlainTextView(coreManager, target.id)
        editorStore.REGISTER_CORE_SAVE_IDENTITY(target.id, incoming.lease.identity)
        coreLease.value = incoming.lease
        corePlainTextView.value = incoming.view
        coreProjectionMarkdown.value = incoming.view.markdown
        coreEditorGeneration.value += 1
        coreViewState.value = 'wysiwyg'
        return
      }
      if (!sourceMode && prior !== undefined && target?.id !== prior.documentId) {
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
          await measureCoreDocumentOpen(corePerformanceTrace, target.id, () =>
            coreManager.open({
              documentId: target.id,
              source: target.source,
              options: coreMarkdownOptions.value,
              lineEnding: target.lineEnding
            })
          )
          openedCoreDocuments.add(target.id)
        }
        const incoming = await leaseCorePlainTextView(coreManager, target.id)
        editorStore.REGISTER_CORE_SAVE_IDENTITY(target.id, incoming.lease.identity)
        coreLease.value = incoming.lease
        corePlainTextView.value = incoming.view
        coreProjectionMarkdown.value = incoming.view.markdown
        coreEditorGeneration.value += 1
        coreViewState.value = 'wysiwyg'
        return
      }
      if (
        prior !== undefined &&
        !sourceMode &&
        coreViewState.value === 'source' &&
        target?.id === prior.documentId
      ) {
        coreViewState.value = 'reconciling'
        try {
          const handoff = await handoffCorePlainTextView(coreManager, prior)
          editorStore.REGISTER_CORE_SAVE_IDENTITY(prior.documentId, handoff.lease.identity)
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
        prior !== undefined &&
        sourceMode &&
        coreViewState.value === 'wysiwyg' &&
        target?.id === prior.documentId
      ) {
        coreViewState.value = 'reconciling'
        const snapshot = await coreManager.saveBarrier(prior.documentId)
        await coreManager.handoff(prior)
        coreLease.value = undefined
        corePlainTextView.value = undefined
        coreProjectionMarkdown.value = snapshot.source
        coreEditorGeneration.value += 1
      }
      if (prior !== undefined && (!sourceMode || target?.id !== prior.documentId)) {
        if (!sourceMode) {
          await handoffCoreDocumentView({
            manager: coreManager,
            lease: prior,
            reconcile: (documentId, source) => {
              editorStore.RECONCILE_CORE_SOURCE_AT_HANDOFF(documentId, source)
            },
            setState: (state) => {
              coreViewState.value = state
            }
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
            editorStore.RECONCILE_CORE_SOURCE_AT_HANDOFF(documentId, snapshot.source)
          }
          await coreManager.close(documentId)
          openedCoreDocuments.delete(documentId)
          coreSaveRegistrations.get(documentId)?.()
          coreSaveRegistrations.delete(documentId)
          coreReloadRegistrations.get(documentId)?.()
          coreReloadRegistrations.delete(documentId)
          coreRecoveryRegistrations.get(documentId)?.()
          coreRecoveryRegistrations.delete(documentId)
          coreModelOwners.delete(documentId)
        }
        return
      }
      await retireClosedCoreDocumentSessions({
        manager: coreManager,
        openedDocumentIds: openedCoreDocuments,
        liveDocumentIds,
        registrations: coreSaveRegistrations
      })
      for (const documentId of coreModelOwners.keys()) {
        if (!liveDocumentIds.has(documentId)) {
          coreModelOwners.delete(documentId)
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
        await measureCoreDocumentOpen(corePerformanceTrace, target.id, () =>
          coreManager.open({
            documentId: target.id,
            source: target.source,
            options: coreMarkdownOptions.value,
            lineEnding: target.lineEnding
          })
        )
        openedCoreDocuments.add(target.id)
      }
      await coreManager.activate(target.id)
      const incomingLease = coreManager.lease(target.id)
      coreProjectionMarkdown.value = await incomingLease.sourceAtBarrier()
      editorStore.REGISTER_CORE_SAVE_IDENTITY(target.id, incomingLease.identity)
      coreLease.value = incomingLease
      corePlainTextView.value = undefined
      coreViewState.value = 'source'
    })
    if (target !== undefined && !coreSaveRegistrations.has(target.id)) {
      let settledTransition: Promise<void> | undefined
      const unregister = coreDocumentSaveAuthority.register(
        target.id,
        async () => {
          await coreDocumentRecoveryAuthority.settled(target.id)
          const transition = coreTransition
          await transition
          const snapshot = await coreManager.saveBarrier(target.id)
          settledTransition = transition
          return snapshot
        },
        (identity) =>
          !coreOwnerDisposed &&
          settledTransition === coreTransition &&
          coreDocumentRecoveryAuthority.settled(target.id) === undefined &&
          coreManager.isSaveSnapshotCurrent(target.id, identity)
      )
      coreSaveRegistrations.set(target.id, unregister)
    }
    if (target !== undefined && !coreReloadRegistrations.has(target.id)) {
      const unregister = coreDocumentReloadAuthority.register(target.id, (input) => {
        const replacement = coreTransition.then(async () => {
          if (coreOwnerDisposed) throw new Error('Core document owner is disposed')
          const activeLease =
            coreLease.value?.documentId === input.documentId ? coreLease.value : undefined
          const outgoingLease = activeLease ?? coreManager.lease(input.documentId)
          const incomingLease = await coreManager.replace(outgoingLease, input)
          if (activeLease === undefined) {
            await coreManager.handoff(incomingLease)
            return () => {}
          }
          await coreManager.activate(input.documentId)
          const publish = await prepareCoreReplacementView(
            incomingLease,
            props.sourceCode ? 'source' : 'wysiwyg'
          )
          return () => {
            if (coreLease.value !== activeLease) {
              throw new Error('Core document view changed before reload publication')
            }
            publish()
          }
        })
        coreTransition = replacement.then(() => {}).catch(() => {})
        return replacement
      })
      coreReloadRegistrations.set(target.id, unregister)
    }
    if (target !== undefined && !coreRecoveryRegistrations.has(target.id)) {
      const unregister = coreDocumentRecoveryAuthority.register(target.id, (request) => {
        const recoverWysiwyg = coreViewState.value === 'wysiwyg'
        const recovery = coreTransition.then(async () => {
          if (coreOwnerDisposed) throw new Error('Core document owner is disposed')
          await coordinateCoreDocumentRecovery({
            request,
            manager: coreManager,
            currentLease: () => coreLease.value,
            setRecovering: () => {
              coreViewState.value = 'reconciling'
            },
            reconcileSource: (documentId, source) => {
              editorStore.RECONCILE_CORE_SOURCE_AT_HANDOFF(documentId, source)
            },
            publishLease: async (incomingLease) => {
              const publish = await prepareCoreReplacementView(
                incomingLease,
                recoverWysiwyg ? 'wysiwyg' : 'source'
              )
              publish()
            }
          })
        })
        coreTransition = recovery.catch((error) => {
          console.error('Core document recovery failed', error)
        })
        return recovery
      })
      coreRecoveryRegistrations.set(target.id, unregister)
    }
    coreTransition = nextTransition.catch((error) => {
      if (target !== undefined && !openedCoreDocuments.has(target.id)) {
        coreSaveRegistrations.get(target.id)?.()
        coreSaveRegistrations.delete(target.id)
        coreReloadRegistrations.get(target.id)?.()
        coreReloadRegistrations.delete(target.id)
        coreRecoveryRegistrations.get(target.id)?.()
        coreRecoveryRegistrations.delete(target.id)
        coreModelOwners.delete(target.id)
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

// Close retires input surfaces, not document actors. The same actors/history
// remain available if native confirmation or Save As is cancelled.
const assertCoreCloseAllowed = (): void => {
  coreEditor.value?.assertCloseAllowed()
  coreSourceEditor.value?.assertCloseAllowed()
}
const unregisterCoreClose = coreDocumentSaveAuthority.registerClose(
  () => {
    if (coreClosePending.value) throw new Error('Window close is already pending')
    coreClosePending.value = true
    let releaseOwners: (() => void) | undefined
    const restoreInput = async (): Promise<void> => {
      releaseOwners?.()
      releaseOwners = undefined
      coreCloseInputsRetired.value = false
      coreClosePending.value = false
      // The existing tab/surface watcher remounts the current selection from its
      // retained actor; it also handles a tab selected while native UI was open.
      await nextTick()
      await coreTransition
      await nextTick()
      const target = currentFile.value?.id
      const view = props.sourceCode ? coreSourceEditor.value : coreEditor.value
      if (
        coreManager !== undefined &&
        target !== undefined &&
        (coreLease.value?.documentId !== target || view === undefined)
      ) {
        coreClosePending.value = true
        coreCloseInputsRetired.value = true
        await nextTick()
        throw new Error('Unable to restore the document input owner after closing was cancelled')
      }
    }
    const work = coreTransition.then(async () => {
      assertCoreCloseAllowed()
      const retire = async (): Promise<void> => {
        const prior = coreLease.value
        // Composition and already prepared input complete while their native
        // listeners and recovery capture still own the active view.
        if (prior !== undefined) await coreManager?.saveBarrier(prior.documentId)
        if (coreViewState.value === 'source') {
          coreSourceViewState.value = coreSourceEditor.value?.captureViewState()
        } else if (currentFile.value?.id === prior?.documentId && currentFile.value !== null) {
          currentFile.value.muyaIndexCursor = coreEditor.value?.captureViewState() ?? null
        }
        coreCloseInputsRetired.value = true
        await nextTick()
        // Native destruction flushes before listeners detach. The second barrier
        // drains those deliveries before relinquishing this view's live lease.
        if (prior !== undefined) await coreManager?.handoff(prior)
        coreLease.value = undefined
      }
      if (coreManager === undefined) await retire()
      else releaseOwners = await coreManager.prepareClose(retire)
    })
    coreTransition = work.catch(() => {})
    let held = true
    return {
      ready: work,
      async resume (): Promise<void> {
        if (!held) return
        await coreTransition
        await restoreInput()
        held = false
      }
    }
  },
  assertCoreCloseAllowed,
  () => coreClosePending.value
)
onBeforeUnmount(unregisterCoreClose)

onBeforeUnmount(() => {
  coreOwnerDisposed = true
  let retainedForRecovery = false
  if (coreManager !== undefined) {
    teardownCoreDocumentSessions({
      manager: coreManager,
      transition: coreTransition,
      finalLease: () => coreLease.value,
      clearFinalLease: () => {
        coreLease.value = undefined
      },
      documentIds: openedCoreDocuments,
      preserveFailure: createCoreTeardownDraftPreserver({
        preserve: (draft, lease) => {
          preserveCoreRecoveryDraft(draft, lease)
          coreUnbackedDraft.value = undefined
          coreDraftFaultLease = undefined
        }
      })
    })
      .catch((error) => {
        retainedForRecovery = true
        console.error('Core document teardown failed', error)
      })
      .finally(() => {
        if (retainedForRecovery) return
        for (const unregister of coreSaveRegistrations.values()) unregister()
        coreSaveRegistrations.clear()
        for (const unregister of coreReloadRegistrations.values()) unregister()
        coreReloadRegistrations.clear()
        for (const unregister of coreRecoveryRegistrations.values()) unregister()
        coreRecoveryRegistrations.clear()
        coreModelOwners.clear()
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
