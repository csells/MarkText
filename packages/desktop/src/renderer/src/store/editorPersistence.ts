import equal from 'deep-equal'
import type { FileChangePayload, FileNotification, IFileState } from '@shared/types/files'

export type { FileChangePayload }

// Complete a save against the ground truth main echoed back: the disk base
// advances to the WRITTEN bytes; the tab is clean only if the buffer still
// matches them (the user may have kept editing during the async write).
export const completeTabSaveFromSnapshot = (tab: IFileState, savedMarkdown: string): void => {
  tab.diskBaseMarkdown = savedMarkdown
  if (tab.markdown === savedMarkdown) {
    markTabSavedAtCurrentHistory(tab)
    return
  }
  tab.isSaved = false
}

// The pushTabNotification payload — one definition; the editor store and the
// merge subsystem both consume it.
export interface PushTabNotificationPayload {
  tabId: string
  msg: string
  showConfirm?: boolean
  confirmLabel?: string
  secondaryLabel?: string
  style?: string
  exclusiveType?: string
  action?: FileNotification['action']
}

export const markTabSavedAtCurrentHistory = (tab: IFileState): void => {
  const lastEditIndex = tab.history.lastEditIndex
  if (
    typeof lastEditIndex === 'number' &&
    lastEditIndex >= 0 &&
    lastEditIndex < tab.history.stack.length
  ) {
    const entry = tab.history.stack[lastEditIndex]
    if (entry && typeof entry.id === 'number') {
      tab.lastSavedHistoryId = entry.id
    }
  }
  tab.diskBaseMarkdown = tab.markdown
  tab.isSaved = true
}

export const clearExclusiveTabNotification = (tab: IFileState, exclusiveType: string): void => {
  tab.notifications = tab.notifications.filter((n) => n.exclusiveType !== exclusiveType)
}

const normalizeEncodingForComparison = (encoding: unknown): unknown => {
  if (!encoding || typeof encoding !== 'object') return encoding

  const record = encoding as Record<string, unknown>
  return {
    encoding: record.encoding,
    isBom: record.isBom ?? record.hasBOM ?? false
  }
}

const filePersistenceSnapshot = (data: {
  encoding?: unknown
  lineEnding?: unknown
  adjustLineEndingOnSave?: unknown
  trimTrailingNewline?: unknown
  isMixedLineEndings?: unknown
}): Record<string, unknown> => ({
  encoding: normalizeEncodingForComparison(data.encoding),
  lineEnding: data.lineEnding,
  adjustLineEndingOnSave: data.adjustLineEndingOnSave,
  trimTrailingNewline: data.trimTrailingNewline,
  isMixedLineEndings: data.isMixedLineEndings ?? false
})

export const isSamePersistenceSnapshot = (
  tab: IFileState,
  data: FileChangePayload['data']
): boolean => equal(filePersistenceSnapshot(data), filePersistenceSnapshot(tab))
