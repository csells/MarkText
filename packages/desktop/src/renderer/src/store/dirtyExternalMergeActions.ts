import bus from '../bus'
import { t } from '../i18n'
import { deepClone } from '../util'
import { getBlankFileState } from './help'
import { debouncedSendBufferedState, sendBufferedState } from './bufferedState'
import { usePreferencesStore } from './preferences'
import { resolveConflictMarker, type ThreeWayMergeConflict } from '../util/threeWayMerge'
import { mergeDirtyExternalMarkdown } from '../util/dirtyExternalMerge'
import {
  initialMergeSessionState,
  reduceMergeSession,
  type MergeSessionEffect,
  type MergeSessionEvent,
  type MergeSessionState
} from './mergeSession'
import type { IFileState } from '@shared/types/files'
import {
  clearExclusiveTabNotification,
  type FileChangePayload,
  isSamePersistenceSnapshot,
  markTabSavedAtCurrentHistory,
  type PushTabNotificationPayload,
  requireDiskBaseMarkdown
} from './editorPersistence'

// The dirty-buffer + external-file-change reconciliation subsystem. All
// decisions live in the pure per-tab reducer (./mergeSession.ts); this module
// is its interpreter: it translates watcher/worker/UI happenings into events,
// hands the reducer the reality snapshots it decides from, and executes the
// returned effects as store mutations. Nothing here decides — a branch in
// this file is only ever "which store mutation implements this effect".

export interface MergeConflictState {
  // Monotonic session token: every (re)derivation mints a new one so the
  // dialog can remount its panes when the displayed session is superseded.
  // Globally monotonic (not the reducer's per-tab id) because the store has
  // a single dialog slot shared by every tab.
  session: number
  // Liveness snapshot: the session may act only while the tab's buffer and
  // disk base still hold exactly these values (a save, edit, or newer disk
  // change moves them and supersedes the session).
  expectedMarkdown: string
  expectedDiskBase: string | undefined
  tabId: string
  pathname: string
  filename: string
  baseMarkdown: string
  localMarkdown: string
  remoteMarkdown: string
  resultMarkdown: string
  conflicts: ThreeWayMergeConflict[]
  fileChange: FileChangePayload
  validationError?: string
}

interface DirtyExternalMergeStore {
  tabs: IFileState[]
  currentFile: IFileState | null
  mergeConflict: MergeConflictState | null
  SHOW_TAB_VIEW: (show: boolean) => void
  updateTabIdToIndex: () => void
  pushTabNotification: (payload: PushTabNotificationPayload) => void
  loadChange: (change: FileChangePayload, options?: { preserveDirty?: boolean }) => void
  APPLY_DIRTY_EXTERNAL_MERGE: (
    change: FileChangePayload,
    mergedMarkdown: string,
    options?: { origin?: 'auto' | 'accepted' }
  ) => void
  HANDLE_DIRTY_EXTERNAL_CHANGE: (
    tab: IFileState,
    change: FileChangePayload,
    options?: { forceReview?: boolean }
  ) => Promise<void>
  OPEN_DIRTY_EXTERNAL_MERGE_CONFLICT: (
    tab: IFileState,
    change: FileChangePayload,
    baseMarkdown: string,
    resultMarkdown: string,
    conflicts: ThreeWayMergeConflict[]
  ) => void
  CREATE_DIRTY_RELOAD_RECOVERY_TAB: (sourceTab: IFileState) => IFileState
}

// Reducer state per tab, held per store instance so a fresh store (each unit
// test, every window) starts with fresh sessions while notification closures
// capturing one store keep addressing its machines.
const mergeSessionsByStore = new WeakMap<DirtyExternalMergeStore, Map<string, MergeSessionState>>()

let mergeConflictMaterializationCounter = 0

const sessionsFor = (store: DirtyExternalMergeStore): Map<string, MergeSessionState> => {
  let sessions = mergeSessionsByStore.get(store)
  if (!sessions) {
    sessions = new Map()
    mergeSessionsByStore.set(store, sessions)
  }
  return sessions
}

const sessionStateFor = (store: DirtyExternalMergeStore, tabId: string): MergeSessionState =>
  sessionsFor(store).get(tabId) ?? initialMergeSessionState()

// Runs the reducer and executes its effects in order. Synchronous effects
// mutate the store before this returns; the promise settles once an emitted
// start-merge (if any) has run to completion, so async callers can await the
// whole merge chain while UI callers observe the sync mutations immediately.
const dispatchAndExecute = (
  store: DirtyExternalMergeStore,
  tabId: string,
  event: MergeSessionEvent
): Promise<void> => {
  const { state, effects } = reduceMergeSession(sessionStateFor(store, tabId), event)
  sessionsFor(store).set(tabId, state)

  let pending: Promise<void> = Promise.resolve()
  for (const effect of effects) {
    switch (effect.type) {
      case 'start-merge':
        pending = runMerge(store, tabId, effect)
        break
      case 'apply-merge':
        applyDirtyExternalMerge(store, effect.fileChange, effect.merged, {
          origin: effect.origin
        })
        break
      case 'open-resolver':
        executeOpenResolver(store, tabId, effect)
        break
      case 'close-resolver':
        if (store.mergeConflict?.tabId === tabId) {
          store.mergeConflict = null
          debouncedSendBufferedState()
        }
        break
      case 'validation-error':
        executeValidationError(store, tabId, effect)
        break
      case 'load-disk':
        if (effect.reason === 'reload-disk') {
          executeReloadFromDisk(store, effect)
        } else {
          executeCleanSync(store, effect)
        }
        break
      case 'create-recovery-tab':
        executeCreateRecoveryTab(store, tabId)
        break
    }
  }
  return pending
}

// Reality-sync events (buffer-edited, saved, tab-closed) emit only
// synchronous effects, so the returned promise is already settled; the catch
// still surfaces an executor throwing rather than swallowing it.
const dispatchRealityEvent = (
  store: DirtyExternalMergeStore,
  tabId: string,
  event: MergeSessionEvent
): void => {
  dispatchAndExecute(store, tabId, event).catch((err) => {
    console.error('Failed to reconcile merge-session reality:', err)
  })
}

// Report reality drift to the reducer before delivering a decision-bearing
// event: the buffer, saved flag, disk base, and tab existence all move
// through store code that does not dispatch merge events (typing, saves,
// closing tabs), so the interpreter reconciles them lazily at each decision
// point. Returns the live tab, or null when it no longer exists.
const syncReality = (store: DirtyExternalMergeStore, tabId: string): IFileState | null => {
  const tab = store.tabs.find((candidate) => candidate.id === tabId) ?? null
  if (!tab) {
    dispatchRealityEvent(store, tabId, { type: 'tab-closed' })
    return null
  }

  let state = sessionStateFor(store, tabId)
  const expectedLocal =
    state.kind === 'merging' ? state.local : state.kind === 'reviewing' ? state.currentLocal : null
  if (expectedLocal !== null && tab.markdown !== expectedLocal) {
    dispatchRealityEvent(store, tabId, { type: 'buffer-edited', local: tab.markdown })
  }

  state = sessionStateFor(store, tabId)
  const baseMoved =
    state.kind === 'merging'
      ? tab.isSaved || tab.diskBaseMarkdown !== state.base
      : state.kind === 'reviewing'
        ? tab.isSaved ||
          tab.diskBaseMarkdown !== state.session.expectedDiskBase ||
          !window.fileUtils.isSamePathSync(tab.pathname, state.session.fileChange.pathname)
        : false
  if (baseMoved) {
    dispatchRealityEvent(store, tabId, { type: 'saved' })
  }
  return tab
}

const runMerge = async(
  store: DirtyExternalMergeStore,
  tabId: string,
  effect: Extract<MergeSessionEffect, { type: 'start-merge' }>
): Promise<void> => {
  let merged: { mergedMarkdown: string; conflicts: ThreeWayMergeConflict[] }
  try {
    merged = await mergeDirtyExternalMarkdown({
      base: effect.base,
      local: effect.local,
      remote: effect.remote
    })
  } catch (err) {
    console.error('Dirty external merge failed:', err)
    syncReality(store, tabId)
    await dispatchAndExecute(store, tabId, {
      type: 'merge-failed',
      requestId: effect.requestId
    })
    return
  }
  syncReality(store, tabId)
  await dispatchAndExecute(store, tabId, {
    type: 'merge-resolved',
    requestId: effect.requestId,
    merged: merged.mergedMarkdown,
    conflicts: merged.conflicts
  })
}

const executeOpenResolver = (
  store: DirtyExternalMergeStore,
  tabId: string,
  effect: Extract<MergeSessionEffect, { type: 'open-resolver' }>
): void => {
  const tab = store.tabs.find((candidate) => candidate.id === tabId)
  if (!tab) return

  const { session } = effect
  mergeConflictMaterializationCounter += 1
  store.mergeConflict = {
    session: mergeConflictMaterializationCounter,
    expectedMarkdown: session.expectedLocal,
    expectedDiskBase: session.expectedDiskBase,
    tabId,
    pathname: session.fileChange.pathname,
    filename: tab.filename,
    baseMarkdown: session.paneBase,
    localMarkdown: session.paneLocal,
    remoteMarkdown: session.remote,
    resultMarkdown: session.result,
    conflicts: session.conflicts,
    fileChange: session.fileChange,
    validationError: undefined
  }
  if (effect.withNotification) {
    store.pushTabNotification({
      tabId,
      msg: t('store.editor.fileChangedOnDiskMergeConflict', { name: tab.filename }),
      showConfirm: true,
      confirmLabel: t('editor.mergeConflict.title'),
      style: 'warn',
      exclusiveType: 'file_changed',
      action: (status) => {
        if (!status) return
        const currentTab = syncReality(store, tabId)
        if (!currentTab) return
        dispatchAndExecute(store, tabId, {
          type: 'review-requested',
          paneBase: session.paneBase,
          paneLocal: session.paneLocal,
          expectedLocal: session.expectedLocal,
          expectedDiskBase: session.expectedDiskBase,
          result: session.result,
          conflicts: session.conflicts,
          fileChange: session.fileChange,
          currentLocal: currentTab.markdown,
          currentBase: currentTab.diskBaseMarkdown,
          persistenceEqual: isSamePersistenceSnapshot(currentTab, session.fileChange.data)
        }).catch((err) => {
          console.error('Failed to re-open dirty external merge conflict:', err)
        })
      }
    })
  }
  debouncedSendBufferedState()
}

const executeValidationError = (
  store: DirtyExternalMergeStore,
  tabId: string,
  effect: Extract<MergeSessionEffect, { type: 'validation-error' }>
): void => {
  const conflict = store.mergeConflict
  if (!conflict || conflict.tabId !== tabId) return
  store.mergeConflict = {
    ...conflict,
    resultMarkdown: effect.result,
    validationError:
      effect.code === 'unresolved-conflict'
        ? t('editor.mergeConflict.unresolvedConflict')
        : t('editor.mergeConflict.invalidCommentSyntax')
  }
}

// The `local === remote` decision-table row: adopt the disk copy as the new
// base; a byte-affecting persistence difference keeps the tab dirty.
const executeCleanSync = (
  store: DirtyExternalMergeStore,
  effect: Extract<MergeSessionEffect, { type: 'load-disk' }>
): void => {
  store.loadChange(effect.fileChange, effect.preserveDirty ? { preserveDirty: true } : undefined)
  const nextTab = store.tabs.find((candidate) =>
    window.fileUtils.isSamePathSync(candidate.pathname, effect.fileChange.pathname)
  )
  if (!nextTab) return

  nextTab.diskBaseMarkdown = effect.fileChange.data.markdown
  if (effect.preserveDirty) nextTab.isSaved = false
  debouncedSendBufferedState()
}

const executeCreateRecoveryTab = (store: DirtyExternalMergeStore, tabId: string): void => {
  const tab = store.tabs.find((candidate) => candidate.id === tabId)
  if (!tab) return

  clearExclusiveTabNotification(tab, 'file_changed')
  const recoveryTab = store.CREATE_DIRTY_RELOAD_RECOVERY_TAB(tab)
  store.pushTabNotification({
    tabId: tab.id,
    msg: t('store.editor.fileChangedOnDiskRecoveryCreated', {
      name: recoveryTab.filename
    }),
    showConfirm: false,
    exclusiveType: 'file_changed_recovery'
  })
}

const executeReloadFromDisk = (
  store: DirtyExternalMergeStore,
  effect: Extract<MergeSessionEffect, { type: 'load-disk' }>
): void => {
  sendBufferedState()
    .catch((err) => {
      console.error('Failed to flush dirty reload recovery tab:', err)
    })
    .finally(() => {
      store.loadChange(effect.fileChange)
    })
}

export function createDirtyReloadRecoveryTab(
  store: DirtyExternalMergeStore,
  sourceTab: IFileState
): IFileState {
  bus.emit('flush-active-editor')

  const latestTab = store.tabs.find((tab) => tab.id === sourceTab.id) ?? sourceTab
  const preferencesStore = usePreferencesStore()
  const { defaultEncoding, endOfLine } = preferencesStore
  const markdown = typeof latestTab.markdown === 'string' ? latestTab.markdown : ''
  const lineEnding = latestTab.lineEnding ?? endOfLine
  const recoveryTab = getBlankFileState(
    store.tabs,
    latestTab.encoding?.encoding ?? defaultEncoding,
    lineEnding,
    markdown
  )

  recoveryTab.isSaved = false
  recoveryTab.encoding = deepClone(latestTab.encoding ?? recoveryTab.encoding)
  recoveryTab.lineEnding = lineEnding
  recoveryTab.adjustLineEndingOnSave = latestTab.adjustLineEndingOnSave
  recoveryTab.trimTrailingNewline = latestTab.trimTrailingNewline
  if (latestTab.wordCount !== undefined) recoveryTab.wordCount = deepClone(latestTab.wordCount)
  if (latestTab.cursor !== undefined) recoveryTab.cursor = deepClone(latestTab.cursor)
  if (latestTab.muyaIndexCursor !== undefined) {
    recoveryTab.muyaIndexCursor = deepClone(latestTab.muyaIndexCursor)
  }
  recoveryTab.history = { stack: [], index: -1 }
  recoveryTab.lastSavedHistoryId = -1

  store.SHOW_TAB_VIEW(false)
  store.tabs.push(recoveryTab)
  store.updateTabIdToIndex()
  debouncedSendBufferedState()
  return recoveryTab
}

export function applyDirtyExternalMerge(
  store: DirtyExternalMergeStore,
  change: FileChangePayload,
  mergedMarkdown: string,
  // 'auto': the watcher merged disjoint edits silently — offer Undo/Review.
  // 'accepted': the user just resolved this merge in the dialog — a second
  // notification offering to Undo/Review it again would be noise.
  options: { origin?: 'auto' | 'accepted' } = {}
): void {
  const tab = store.tabs.find((t) => window.fileUtils.isSamePathSync(t.pathname, change.pathname))
  if (!tab) return

  const baseMarkdownBeforeMerge = requireDiskBaseMarkdown(tab)
  const localMarkdownBeforeMerge = tab.markdown
  const mergedChange: FileChangePayload = {
    ...change,
    data: {
      ...change.data,
      markdown: mergedMarkdown
    }
  }
  const origin = options.origin ?? 'auto'
  const cleanAfterApply = origin === 'auto' && mergedMarkdown === change.data.markdown
  store.loadChange(mergedChange, { preserveDirty: !cleanAfterApply })

  const nextTab = store.tabs.find((t) =>
    window.fileUtils.isSamePathSync(t.pathname, change.pathname)
  )
  if (!nextTab) return

  nextTab.diskBaseMarkdown = change.data.markdown
  // A background tab's engine never saw this merge: journal the pre-merge
  // buffer so activation can seed a rebuild-undo boundary from it. The
  // foreground path records its boundary directly via replaceContent.
  if (store.currentFile?.id !== nextTab.id) {
    nextTab.preMergeJournal = {
      markdown: localMarkdownBeforeMerge,
      cursor: nextTab.muyaIndexCursor ?? null,
      mergedAt: new Date().toISOString()
    }
  }
  if (cleanAfterApply) {
    markTabSavedAtCurrentHistory(nextTab)
  } else if (origin === 'accepted') {
    nextTab.isSaved = false
    // The 'resolve the merge to continue' banner served its purpose.
    clearExclusiveTabNotification(nextTab, 'file_changed')
  } else {
    nextTab.isSaved = false
    store.pushTabNotification({
      tabId: nextTab.id,
      msg: t('store.editor.fileChangedOnDiskAutoMerged', { name: nextTab.filename }),
      showConfirm: true,
      confirmLabel: t('menu.edit.undo'),
      secondaryLabel: t('menu.review.review'),
      exclusiveType: 'file_changed',
      action: (status) => {
        if (!status) return

        const actionTab = store.tabs.find(
          (t) => t.id === nextTab.id && window.fileUtils.isSamePathSync(t.pathname, change.pathname)
        )
        if (!actionTab) return
        if (
          actionTab.isSaved ||
          actionTab.markdown !== mergedMarkdown ||
          actionTab.diskBaseMarkdown !== change.data.markdown
        ) {
          return
        }

        if (status === 'secondary') {
          syncReality(store, actionTab.id)
          dispatchAndExecute(store, actionTab.id, {
            type: 'review-requested',
            paneBase: baseMarkdownBeforeMerge,
            paneLocal: localMarkdownBeforeMerge,
            expectedLocal: mergedMarkdown,
            expectedDiskBase: change.data.markdown,
            result: mergedMarkdown,
            conflicts: [],
            fileChange: change,
            currentLocal: actionTab.markdown,
            currentBase: actionTab.diskBaseMarkdown,
            persistenceEqual: isSamePersistenceSnapshot(actionTab, change.data)
          }).catch((err) => {
            console.error('Failed to review an auto-applied merge:', err)
          })
          return
        }

        store.loadChange(
          {
            ...change,
            data: {
              ...change.data,
              markdown: localMarkdownBeforeMerge
            }
          },
          { preserveDirty: true }
        )

        const restoredTab = store.tabs.find((t) =>
          window.fileUtils.isSamePathSync(t.pathname, change.pathname)
        )
        if (!restoredTab) return

        restoredTab.diskBaseMarkdown = change.data.markdown
        restoredTab.isSaved = false
        debouncedSendBufferedState()
      }
    })
  }
  debouncedSendBufferedState()
}

export function openDirtyExternalMergeConflict(
  store: DirtyExternalMergeStore,
  tab: IFileState,
  change: FileChangePayload,
  baseMarkdown: string,
  resultMarkdown: string,
  conflicts: ThreeWayMergeConflict[]
): void {
  syncReality(store, tab.id)
  dispatchAndExecute(store, tab.id, {
    type: 'review-requested',
    paneBase: baseMarkdown,
    paneLocal: tab.markdown,
    expectedLocal: tab.markdown,
    expectedDiskBase: tab.diskBaseMarkdown,
    result: resultMarkdown,
    conflicts,
    fileChange: change,
    currentLocal: tab.markdown,
    currentBase: tab.diskBaseMarkdown,
    persistenceEqual: isSamePersistenceSnapshot(tab, change.data),
    withNotification: true
  }).catch((err) => {
    console.error('Failed to open dirty external merge conflict:', err)
  })
}

export function cancelDirtyExternalMergeConflict(store: DirtyExternalMergeStore): void {
  const conflict = store.mergeConflict
  if (!conflict) return
  dispatchAndExecute(store, conflict.tabId, { type: 'cancel' }).catch((err) => {
    console.error('Failed to cancel dirty external merge conflict:', err)
  })
}

export function acceptDirtyExternalMergeConflict(
  store: DirtyExternalMergeStore,
  mergedMarkdown: string
): void {
  const conflict = store.mergeConflict
  if (!conflict) return

  const tab = syncReality(store, conflict.tabId)
  if (!tab) return

  dispatchAndExecute(store, conflict.tabId, {
    type: 'accept',
    result: mergedMarkdown,
    persistenceEqual: isSamePersistenceSnapshot(tab, conflict.fileChange.data)
  }).catch((err) => {
    console.error('Failed to re-derive a stale merge-conflict session:', err)
  })
}

export function reconcileRestoredDiskChanges(store: DirtyExternalMergeStore): void {
  for (const tab of store.tabs) {
    const restoredDiskDocument = tab.restoredDiskDocument
    delete tab.restoredDiskDocument
    if (!restoredDiskDocument || tab.isSaved || !tab.pathname) continue

    if (
      typeof tab.diskBaseMarkdown === 'string' &&
      restoredDiskDocument.markdown === tab.diskBaseMarkdown
    ) {
      continue
    }

    store
      .HANDLE_DIRTY_EXTERNAL_CHANGE(tab, {
        pathname: tab.pathname,
        data: {
          ...restoredDiskDocument,
          filename: restoredDiskDocument.filename || tab.filename
        }
      })
      .catch((err) => {
        console.error('Failed to reconcile restored disk changes:', err)
      })
  }
}

export function reloadDiskFromMergeConflict(store: DirtyExternalMergeStore): void {
  const conflict = store.mergeConflict
  if (!conflict) return

  const tab = syncReality(store, conflict.tabId)
  if (!tab) return

  dispatchAndExecute(store, conflict.tabId, { type: 'reload-disk' }).catch((err) => {
    console.error('Failed to reload disk from merge conflict:', err)
  })
}

export function resolveMergeConflictMarker(
  store: DirtyExternalMergeStore,
  conflictId: string,
  choice: 'local' | 'remote' | 'both'
): void {
  const pending = store.mergeConflict
  if (!pending) return

  const conflict = pending.conflicts.find((item) => item.id === conflictId)
  if (!conflict) return

  const resolved = resolveConflictMarker(pending.resultMarkdown, conflict, choice)
  // resolveConflictMarker splices by exact scaffolding match; if the user
  // edited inside the block it no longer matches and the click would be a
  // silent no-op. Surface that instead of leaving the button dead.
  if (resolved === pending.resultMarkdown) {
    pending.validationError = t('editor.mergeConflict.markerNotFound')
    return
  }
  pending.resultMarkdown = resolved
  pending.validationError = undefined
}

export async function handleDirtyExternalChange(
  store: DirtyExternalMergeStore,
  tab: IFileState,
  change: FileChangePayload,
  // When the user explicitly reopens the resolver from the notification,
  // a cleanly-mergeable result must still surface the dialog for review
  // rather than silently auto-applying it (the initial-change path auto-
  // applies clean merges, but an explicit review request must not).
  options: { forceReview?: boolean } = {}
): Promise<void> {
  const liveTab = syncReality(store, tab.id)
  if (!liveTab) return

  await dispatchAndExecute(store, tab.id, {
    type: 'disk-changed',
    fileChange: change,
    local: liveTab.markdown,
    base: liveTab.diskBaseMarkdown,
    persistenceEqual: isSamePersistenceSnapshot(liveTab, change.data),
    forceReview: options.forceReview === true
  })
}
