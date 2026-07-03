import { parseMarkdownComments } from '@muyajs/core'
import bus from '../bus'
import { t } from '../i18n'
import { deepClone } from '../util'
import { getBlankFileState } from './help'
import { debouncedSendBufferedState, sendBufferedState } from './bufferedState'
import { usePreferencesStore } from './preferences'
import {
  containsConflictScaffolding,
  createWholeFileConflict,
  resolveConflictMarker,
  type ThreeWayMergeConflict,
  type ThreeWayMergeResult
} from '../util/threeWayMerge'
import { mergeDirtyExternalMarkdown } from '../util/dirtyExternalMerge'
import type { IFileState } from '@shared/types/files'
import {
  clearExclusiveTabNotification,
  type EditorStore,
  type FileChangePayload,
  isSamePersistenceSnapshot,
  markTabSavedAtCurrentHistory
} from './editor'

// The dirty-buffer + external-file-change reconciliation subsystem. These were
// actions on the (already very large) editor store; they are pure functions
// taking the store so the store keeps only thin delegators. Behavior is
// unchanged — `this` simply became the explicit `store` parameter.

export interface MergeConflictState {
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

// Per-tab generation counter so a slow async merge whose inputs changed (the
// user kept typing, or the tab closed) is discarded instead of clobbering the
// current state.
const dirtyExternalMergeRequestIds = new Map<string, number>()

const commentDiagnosticOccurrences = (markdown: string): Map<string, number> => {
  const counts = new Map<string, number>()
  const add = (key: string): void => {
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  try {
    for (const diagnostic of parseMarkdownComments(markdown).diagnostics) {
      // Identity only — no source positions. A clean merge shifts offsets, and
      // a position-bearing key would make every pre-existing diagnostic look
      // "new", escalating the merge to a conflict dialog whose Accept can then
      // never pass validation. Multiplicity is handled by the counts map.
      add(
        JSON.stringify({
          code: diagnostic.code,
          id: diagnostic.id ?? null,
          message: diagnostic.message
        })
      )
    }
  } catch (err) {
    add(`parse-error:${String(err)}`)
  }
  return counts
}

const introducesNewCommentDiagnostics = (
  mergedMarkdown: string,
  localMarkdown: string,
  remoteMarkdown: string
): boolean => {
  const localCounts = commentDiagnosticOccurrences(localMarkdown)
  const remoteCounts = commentDiagnosticOccurrences(remoteMarkdown)

  for (const [key, count] of commentDiagnosticOccurrences(mergedMarkdown)) {
    const existingCount = Math.max(localCounts.get(key) ?? 0, remoteCounts.get(key) ?? 0)
    if (count > existingCount) return true
  }
  return false
}

export function createDirtyReloadRecoveryTab(store: EditorStore, sourceTab: IFileState): IFileState {
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
  store: EditorStore,
  change: FileChangePayload,
  mergedMarkdown: string,
  options: { keepDirty?: boolean } = {}
): void {
  const tab = store.tabs.find((t) =>
    window.fileUtils.isSamePathSync(t.pathname, change.pathname)
  )
  if (!tab) return

  const baseMarkdownBeforeMerge = typeof tab.diskBaseMarkdown === 'string' ? tab.diskBaseMarkdown : ''
  const localMarkdownBeforeMerge = tab.markdown
  const mergedChange: FileChangePayload = {
    ...change,
    data: {
      ...change.data,
      markdown: mergedMarkdown
    }
  }
  const cleanAfterApply = !options.keepDirty && mergedMarkdown === change.data.markdown
  store.loadChange(mergedChange, { preserveDirty: !cleanAfterApply })

  const nextTab = store.tabs.find((t) =>
    window.fileUtils.isSamePathSync(t.pathname, change.pathname)
  )
  if (!nextTab) return

  nextTab.diskBaseMarkdown = change.data.markdown
  if (cleanAfterApply) {
    markTabSavedAtCurrentHistory(nextTab)
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

        const actionTab = store.tabs.find((t) =>
          t.id === nextTab.id && window.fileUtils.isSamePathSync(t.pathname, change.pathname)
        )
        const actionTabDiskBase =
          typeof actionTab?.diskBaseMarkdown === 'string' ? actionTab.diskBaseMarkdown : ''
        if (
          !actionTab ||
          actionTab.isSaved ||
          actionTab.markdown !== mergedMarkdown ||
          actionTabDiskBase !== change.data.markdown
        ) {
          return
        }

        if (status === 'secondary') {
          store.mergeConflict = {
            tabId: actionTab.id,
            pathname: change.pathname,
            filename: actionTab.filename,
            baseMarkdown: baseMarkdownBeforeMerge,
            localMarkdown: localMarkdownBeforeMerge,
            remoteMarkdown: change.data.markdown,
            resultMarkdown: mergedMarkdown,
            conflicts: [],
            fileChange: change,
            validationError: undefined
          }
          debouncedSendBufferedState()
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
  store: EditorStore,
  tab: IFileState,
  change: FileChangePayload,
  baseMarkdown: string,
  resultMarkdown: string,
  conflicts: ThreeWayMergeConflict[]
): void {
  const mergeConflict = {
    tabId: tab.id,
    pathname: change.pathname,
    filename: tab.filename,
    baseMarkdown,
    localMarkdown: tab.markdown,
    remoteMarkdown: change.data.markdown,
    resultMarkdown,
    conflicts,
    fileChange: change,
    validationError: undefined
  }
  store.mergeConflict = mergeConflict
  store.pushTabNotification({
    tabId: tab.id,
    msg: t('store.editor.fileChangedOnDiskMergeConflict', { name: tab.filename }),
    showConfirm: true,
    confirmLabel: t('editor.mergeConflict.title'),
    style: 'warn',
    exclusiveType: 'file_changed',
    action: (status) => {
      if (!status) return
      const currentTab = store.tabs.find((t) => t.id === mergeConflict.tabId)
      if (!currentTab) return
      // The user may have kept editing after dismissing the dialog, so the
      // captured localMarkdown/resultMarkdown are stale. Re-merge from the
      // tab's current content instead of applying an outdated result.
      if (currentTab.markdown !== mergeConflict.localMarkdown) {
        store.HANDLE_DIRTY_EXTERNAL_CHANGE(currentTab, mergeConflict.fileChange, {
          forceReview: true
        }).catch((err) => {
          console.error('Failed to re-open dirty external merge conflict:', err)
        })
        return
      }
      store.mergeConflict = { ...mergeConflict }
      debouncedSendBufferedState()
    }
  })
  debouncedSendBufferedState()
}

export function cancelDirtyExternalMergeConflict(store: EditorStore): void {
  store.mergeConflict = null
  debouncedSendBufferedState()
}

export function acceptDirtyExternalMergeConflict(store: EditorStore, mergedMarkdown: string): void {
  const conflict = store.mergeConflict
  if (!conflict) return

  // Never write generated conflict scaffolding into the document: an
  // unresolved (or hand-mangled) marker block must be resolved first.
  if (containsConflictScaffolding(mergedMarkdown)) {
    store.mergeConflict = {
      ...conflict,
      resultMarkdown: mergedMarkdown,
      validationError: t('editor.mergeConflict.unresolvedConflict')
    }
    return
  }

  if (
    introducesNewCommentDiagnostics(
      mergedMarkdown,
      conflict.localMarkdown,
      conflict.remoteMarkdown
    )
  ) {
    store.mergeConflict = {
      ...conflict,
      resultMarkdown: mergedMarkdown,
      validationError: t('editor.mergeConflict.invalidCommentSyntax')
    }
    return
  }

  store.mergeConflict = null
  store.APPLY_DIRTY_EXTERNAL_MERGE(conflict.fileChange, mergedMarkdown, { keepDirty: true })
}

export function reconcileRestoredDiskChanges(store: EditorStore): void {
  for (const tab of store.tabs as Array<IFileState & { restoredDiskDocument?: FileChangePayload['data'] }>) {
    const restoredDiskDocument = tab.restoredDiskDocument
    delete tab.restoredDiskDocument
    if (!restoredDiskDocument || tab.isSaved || !tab.pathname) continue

    const baseMarkdown = typeof tab.diskBaseMarkdown === 'string' ? tab.diskBaseMarkdown : ''
    if (restoredDiskDocument.markdown === baseMarkdown) continue

    store.HANDLE_DIRTY_EXTERNAL_CHANGE(tab, {
      pathname: tab.pathname,
      data: {
        ...restoredDiskDocument,
        filename: restoredDiskDocument.filename || tab.filename
      }
    }).catch((err) => {
      console.error('Failed to reconcile restored disk changes:', err)
    })
  }
}

export function reloadDiskFromMergeConflict(store: EditorStore): void {
  const conflict = store.mergeConflict
  if (!conflict) return

  const tab = store.tabs.find((t) => t.id === conflict.tabId)
  store.mergeConflict = null
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
  sendBufferedState()
    .catch((err) => {
      console.error('Failed to flush dirty reload recovery tab:', err)
    })
    .finally(() => {
      store.loadChange(conflict.fileChange)
    })
}

export function resolveMergeConflictMarker(
  store: EditorStore,
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
  store: EditorStore,
  tab: IFileState,
  change: FileChangePayload,
  // When the user explicitly reopens the resolver from the notification,
  // a cleanly-mergeable result must still surface the dialog for review
  // rather than silently auto-applying it (the initial-change path auto-
  // applies clean merges, but an explicit review request must not).
  options: { forceReview?: boolean } = {}
): Promise<void> {
  const { data } = change
  // All-in on the three-way merge: an external change to a file the user is
  // still editing is always reconciled by merging, never by a reload
  // prompt. local===remote is handled before this point; remote===base has
  // no new disk content relative to the edit base and is ignored here.
  // Without a recorded base we cannot merge, so an empty base surfaces the
  // difference in the conflict resolver rather than silently dropping either side.
  const baseMarkdown = typeof tab.diskBaseMarkdown === 'string' ? tab.diskBaseMarkdown : ''
  const localMarkdown = tab.markdown
  if (localMarkdown === data.markdown) {
    const preserveDirty = !isSamePersistenceSnapshot(tab, data)
    store.loadChange(change, preserveDirty ? { preserveDirty: true } : undefined)
    const nextTab = store.tabs.find((candidate) =>
      window.fileUtils.isSamePathSync(candidate.pathname, change.pathname)
    )
    if (!nextTab) return

    nextTab.diskBaseMarkdown = data.markdown
    if (preserveDirty) nextTab.isSaved = false
    debouncedSendBufferedState()
    return
  }
  if (data.markdown === baseMarkdown) return

  const requestId = (dirtyExternalMergeRequestIds.get(tab.id) ?? 0) + 1
  dirtyExternalMergeRequestIds.set(tab.id, requestId)

  const isStaleDirtyMergeResult = (): boolean =>
    dirtyExternalMergeRequestIds.get(tab.id) !== requestId ||
    !store.tabs.some((candidate) => candidate.id === tab.id) ||
    tab.markdown !== localMarkdown ||
    tab.isSaved ||
    (typeof tab.diskBaseMarkdown === 'string' ? tab.diskBaseMarkdown : '') !== baseMarkdown

  let mergeResult: ThreeWayMergeResult
  try {
    mergeResult = await mergeDirtyExternalMarkdown({
      base: baseMarkdown,
      local: localMarkdown,
      remote: data.markdown
    })
  } catch (err) {
    console.error('Dirty external merge failed:', err)
    if (isStaleDirtyMergeResult()) return

    const fallback = createWholeFileConflict(baseMarkdown, localMarkdown, data.markdown)
    store.OPEN_DIRTY_EXTERNAL_MERGE_CONFLICT(
      tab,
      change,
      baseMarkdown,
      fallback.mergedMarkdown,
      fallback.conflicts
    )
    return
  }
  if (isStaleDirtyMergeResult()) return

  if (mergeResult.conflicts.length === 0) {
    // A clean merge auto-applies on the initial change, but an explicit
    // reopen (forceReview) surfaces the dialog so the user can inspect it.
    if (
      options.forceReview ||
      introducesNewCommentDiagnostics(mergeResult.mergedMarkdown, localMarkdown, data.markdown)
    ) {
      store.OPEN_DIRTY_EXTERNAL_MERGE_CONFLICT(
        tab,
        change,
        baseMarkdown,
        mergeResult.mergedMarkdown,
        []
      )
      return
    }

    store.APPLY_DIRTY_EXTERNAL_MERGE(change, mergeResult.mergedMarkdown)
    return
  }

  store.OPEN_DIRTY_EXTERNAL_MERGE_CONFLICT(
    tab,
    change,
    baseMarkdown,
    mergeResult.mergedMarkdown,
    mergeResult.conflicts
  )
}
