import equal from 'deep-equal'
import type { FileDocumentPayload, IFileState } from '@shared/types/files'

export interface FileChangePayload {
  pathname: string
  data: FileDocumentPayload
}

// Markdown sent with the most recent in-flight save request, per tab id.
// mt::tab-saved echoes only the id, so this is the renderer's record of the
// bytes actually written — the only valid source for the merge base.
export const pendingSaveSnapshots = new Map<string, string>()

// Complete a save against the recorded snapshot: the disk base advances to
// the WRITTEN bytes; the tab is clean only if the buffer still matches them
// (the user may have kept editing during the async write).
export const completeTabSaveFromSnapshot = (tab: IFileState, savedMarkdown: string): void => {
  tab.diskBaseMarkdown = savedMarkdown
  if (tab.markdown === savedMarkdown) {
    markTabSavedAtCurrentHistory(tab)
    return
  }
  tab.isSaved = false
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

export const requireDiskBaseMarkdown = (tab: IFileState): string => {
  if (typeof tab.diskBaseMarkdown !== 'string') {
    throw new Error(`dirty external merge requires diskBaseMarkdown for tab ${tab.id}`)
  }
  return tab.diskBaseMarkdown
}
